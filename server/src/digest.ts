import { createT, type Lang, pickLang } from '../../shared/i18n/index.ts';
import { formatMoney } from '../../shared/money.ts';
import { appLink, sendToChat } from './bot.ts';
import type { ChatMessage } from './chatLink.ts';
import { balanceSections, esc } from './chatText.ts';
import { config } from './config.ts';
import { all, one, run } from './db.ts';
import { logTelegramError } from './logging.ts';
import { type GroupRow, groupBalanceSnapshot } from './repo.ts';

const CHECK_EVERY_MS = 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, '0');

/** Server-local calendar day, YYYY-MM-DD. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** UTC time in the SQLite format used by created_at columns. */
export function sqlTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** The digest is due once the local hour has come, and only once per local day. */
export function isDigestDue(now: Date, hour: number, lastDate: string | null): boolean {
  return now.getHours() >= hour && localDate(now) !== lastDate;
}

/** Start of the digest window: since the last digest, or the last 24 hours for the first one. */
export function digestSince(now: Date, lastAt: string | null): string {
  return lastAt ?? sqlTime(new Date(now.getTime() - 24 * 3600_000));
}

export interface DigestInput {
  lang: Lang;
  groupName: string;
  currency: string;
  /** Expenses (not transfers) added in the window. 0 = only edits and deletions happened. */
  newCount: number;
  newTotal: number;
  balances: { name: string; balance: number }[];
  settlements: { from: string; to: string; amount: number }[];
}

/** Text of the daily digest (HTML). Balance lists are the same as in /balance (chatText.ts). */
export function buildDigest(i: DigestInput): string {
  const t = createT(i.lang);
  const money = (v: number) => formatMoney(v, i.currency, i.lang);
  const summary =
    i.newCount > 0 ? t('bot.digestExpenses', { count: i.newCount, amount: money(i.newTotal) }) : t('bot.digestChanged');
  const head = `📊 <b>${t('bot.digestHead', { name: esc(i.groupName) })}</b>: ${summary}`;
  return `${head}\n\n${balanceSections(i.lang, { currency: i.currency, members: i.balances, settlements: i.settlements })}`;
}

/** Balances and the settlement plan with member names, as the digest text wants them. */
function digestBalances(g: GroupRow) {
  const snap = groupBalanceSnapshot(g);
  const names = new Map(snap.members.map((m) => [m.id, m.name]));
  return {
    balances: snap.members,
    settlements: snap.settlements.map((s) => ({
      from: names.get(s.from) ?? '',
      to: names.get(s.to) ?? '',
      amount: s.amount,
    })),
  };
}

/** Resolves true when the message went out. */
export type SendToChat = (group: GroupRow, text: string, button: ChatMessage['button']) => Promise<boolean>;

/**
 * Posts the digest to every group in "daily" mode that is due and had expense activity since the last digest.
 * The day is marked before sending and restored if the message did not go out (retry on the next check).
 * Returns the ids of the groups a digest was attempted for.
 */
export async function runDigests(
  now: Date,
  hour: number,
  send: SendToChat,
  link: (inviteCode: string) => string | null,
): Promise<number[]> {
  const handled: number[] = [];
  const groups = all<GroupRow>(
    "SELECT * FROM groups WHERE chat_feed = 'daily' AND chat_id IS NOT NULL AND is_demo = 0",
  );
  for (const g of groups) {
    if (!isDigestDue(now, hour, g.last_digest_date)) continue;
    const since = digestSince(now, g.last_digest_at);
    const changes = one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM activity WHERE group_id = ? AND action LIKE 'expense.%' AND created_at > ?",
      g.id,
      since,
    )?.n;
    if (!changes) continue;
    const added = one<{ n: number; total: number | null }>(
      "SELECT COUNT(*) AS n, SUM(amount) AS total FROM expenses WHERE group_id = ? AND kind = 'expense' AND created_at > ?",
      g.id,
      since,
    );
    // The chat has no single "author"; the group creator's language stands in for it.
    const lang = pickLang(one<{ lang: string | null }>('SELECT lang FROM users WHERE id = ?', g.created_by)?.lang);
    const text = buildDigest({
      lang,
      groupName: g.name,
      currency: g.currency,
      newCount: added?.n ?? 0,
      newTotal: added?.total ?? 0,
      ...digestBalances(g),
    });
    run('UPDATE groups SET last_digest_date = ?, last_digest_at = ? WHERE id = ?', localDate(now), sqlTime(now), g.id);
    const url = link(g.invite_code);
    const ok = await send(g, text, url ? { text: createT(lang)('bot.openGroup'), url } : undefined);
    if (!ok) {
      run(
        'UPDATE groups SET last_digest_date = ?, last_digest_at = ? WHERE id = ?',
        g.last_digest_date,
        g.last_digest_at,
        g.id,
      );
    }
    handled.push(g.id);
  }
  return handled;
}

async function safeRun() {
  try {
    await runDigests(new Date(), config.chatDigestHour, sendToChat, appLink);
  } catch (e) {
    logTelegramError('Chat digest failed', e);
  }
}

/** Checks hourly whether a digest is due (robust to restarts and DST); the check is idempotent per local day. */
export function startDigestSchedule() {
  if (config.dbPath === ':memory:') return;
  void safeRun();
  setInterval(() => void safeRun(), CHECK_EVERY_MS).unref();
}
