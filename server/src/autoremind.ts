// Automatic debt reminders (#135). Groups opt in with `groups.auto_remind`; once a day, in the morning (server time),
// the bot nudges debtors in private about debts from the current settlement plan.
//
// "Hanging for 7 days" rule: the debtor's balance has been negative continuously for at least 7 days, counted from
// the ledger entry that last took it from >= 0 to < 0 (the ledger is replayed in the order the entries were added,
// see `debtSince` in shared/money.ts). Partial repayment does not restart the count, full repayment does. It is the
// age of the debtor's balance, not of a particular plan pair: pairs in the plan can change, the debt does not.
//
// Cooldown: no reminder (manual or automatic, from anyone) for this debtor in this group during the last 7 days.
// Both kinds live in the `reminders` table, so they share it; a manual reminder resets the count for the bot too.
// The manual button keeps its own, shorter 1-day rule.
import { pickLang } from '../../shared/i18n/index.ts';
import { debtSince, type LedgerEntry, settleUp } from '../../shared/money.ts';
import { sendAutoRemind } from './bot.ts';
import { config } from './config.ts';
import { all, run } from './db.ts';
import { logTelegramError } from './logging.ts';
import { buildRemindMessage } from './notify.ts';
import { deserialize, isEmpty } from './paymentInfo.ts';
import { type GroupRow, groupBalances } from './repo.ts';
import { countEventSafe } from './stats.ts';

export const AUTO_REMIND_DAYS = 7;
/** Local hour from which the daily pass may run. */
export const AUTO_REMIND_HOUR = 10;
const CHECK_EVERY_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 3600_000;

/** UTC time in the SQLite format used by created_at columns. */
const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

/** Ledger of a group in the order it was added, with the moment of each entry. */
function ledger(groupId: number): (LedgerEntry & { at: string })[] {
  const expenses = all<{ id: number; payer_id: number; amount: number; created_at: string }>(
    'SELECT id, payer_id, amount, created_at FROM expenses WHERE group_id = ? ORDER BY created_at, id',
    groupId,
  );
  const shares = new Map<number, { memberId: number; amount: number }[]>();
  for (const s of all<{ expense_id: number; member_id: number; amount: number }>(
    'SELECT s.expense_id, s.member_id, s.amount FROM expense_shares s JOIN expenses e ON e.id = s.expense_id WHERE e.group_id = ?',
    groupId,
  )) {
    const list = shares.get(s.expense_id) ?? [];
    list.push({ memberId: s.member_id, amount: s.amount });
    shares.set(s.expense_id, list);
  }
  return expenses.map((e) => ({
    payerId: e.payer_id,
    amount: e.amount,
    shares: shares.get(e.id) ?? [],
    at: e.created_at,
  }));
}

interface MemberInfo {
  id: number;
  user_id: number | null;
  name: string;
  notify: number | null;
  lang: string | null;
  payment: string | null;
}

/**
 * One pass over every opted-in group. Returns how many reminders went out. Safe to call as often as you like:
 * the 7-day cooldown is written before sending (and taken back if the message did not go out).
 */
export async function runAutoReminds(now: Date, hour = AUTO_REMIND_HOUR): Promise<number> {
  if (now.getHours() < hour) return 0;
  let sent = 0;
  const groups = all<GroupRow>('SELECT * FROM groups WHERE auto_remind = 1 AND is_demo = 0 AND archived_at IS NULL');
  const cutoff = sqlTime(new Date(now.getTime() - AUTO_REMIND_DAYS * DAY_MS));
  for (const g of groups) {
    const plan = settleUp(groupBalances(g.id));
    if (plan.length === 0) continue;
    const since = debtSince(
      all<{ id: number }>('SELECT id FROM members WHERE group_id = ?', g.id).map((m) => m.id),
      ledger(g.id),
    );
    const members = new Map(
      all<MemberInfo>(
        `SELECT m.id, m.user_id, m.name, u.notify, u.lang,
                CASE WHEN m.user_id IS NULL THEN m.payment_info ELSE u.payment_info END AS payment
         FROM members m LEFT JOIN users u ON u.id = m.user_id WHERE m.group_id = ?`,
        g.id,
      ).map((m) => [m.id, m]),
    );
    // Debtors reminded recently, either way. Read once, so several pairs of one debtor go out together.
    const cooling = new Set(
      all<{ to_member: number }>(
        'SELECT DISTINCT to_member FROM reminders WHERE group_id = ? AND created_at > ?',
        g.id,
        cutoff,
      ).map((r) => r.to_member),
    );
    for (const pair of plan) {
      const debtor = members.get(pair.from);
      const creditor = members.get(pair.to);
      const debtStart = since.get(pair.from);
      if (!debtor || !creditor || debtStart === undefined || debtor.user_id === null || debtor.notify !== 1) continue;
      if (debtStart > cutoff || cooling.has(pair.from)) continue;
      const lang = pickLang(debtor.lang);
      const text = buildRemindMessage({
        lang,
        currency: g.currency,
        groupName: g.name,
        authorName: creditor.name,
        amount: pair.amount,
        hasPaymentInfo: !isEmpty(deserialize(creditor.payment)),
      });
      const id = Number(
        run(
          'INSERT INTO reminders (group_id, from_member, to_member, created_at, auto) VALUES (?, ?, ?, ?, 1)',
          g.id,
          pair.to,
          pair.from,
          sqlTime(now),
        ).lastInsertRowid,
      );
      if (await sendAutoRemind(debtor.user_id, text, g, lang)) {
        sent++;
        countEventSafe('debt.autoremind');
      } else {
        // Blocked bot or bot not ready: nothing is recorded, so the debtor is not penalised for it.
        run('DELETE FROM reminders WHERE id = ?', id);
      }
    }
  }
  return sent;
}

async function safeRun() {
  try {
    await runAutoReminds(new Date());
  } catch (e) {
    logTelegramError('Auto remind pass failed', e);
  }
}

/** Checks hourly; the pass is idempotent thanks to the cooldown rows, so restarts and DST do no harm. */
export function startAutoRemindSchedule() {
  if (config.dbPath === ':memory:') return;
  void safeRun();
  setInterval(() => void safeRun(), CHECK_EVERY_MS).unref();
}
