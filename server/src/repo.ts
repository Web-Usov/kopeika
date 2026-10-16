import crypto from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import { achievementsFromFacts, spanBetween } from '../../shared/achievements.ts';
import { pickLang } from '../../shared/i18n/index.ts';
import { type SplitMode, settleUp } from '../../shared/money.ts';
import type { TelegramUser } from './auth.ts';
import { config } from './config.ts';
import { all, one, run } from './db.ts';
import { deserialize } from './paymentInfo.ts';
import { budgetExhausted, scanQuota } from './receipts/limits.ts';
import { receiptsEnabled } from './receipts/provider.ts';

export interface UserRow {
  id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  photo_url: string | null;
  notify: number;
  lang: string | null;
  receipt_consent_at: string | null;
  payment_info: string | null;
}

export type ChatFeed = 'off' | 'each' | 'daily';
export const CHAT_FEEDS: ChatFeed[] = ['off', 'each', 'daily'];

export interface GroupRow {
  id: number;
  name: string;
  currency: string;
  invite_code: string;
  created_by: number;
  created_at: string;
  archived_at: string | null;
  chat_id: number | null;
  chat_title: string | null;
  chat_feed: ChatFeed;
  last_digest_date: string | null;
  last_digest_at: string | null;
  is_demo: number;
}

export interface MemberRow {
  id: number;
  group_id: number;
  user_id: number | null;
  name: string;
  payment_info: string | null;
}

export interface ExpenseRow {
  id: number;
  group_id: number;
  kind: 'expense' | 'transfer';
  title: string;
  amount: number;
  payer_id: number;
  split_mode: SplitMode;
  spent_on: string;
  category: string;
  original_amount: number | null;
  original_currency: string | null;
  rate: string | null;
  created_by: number;
  created_at: string;
}

interface ShareRow {
  expense_id: number;
  member_id: number;
  input: number;
  amount: number;
}

export function displayName(u: { first_name: string; last_name?: string | null }): string {
  return [u.first_name, u.last_name].filter(Boolean).join(' ').slice(0, 64);
}

export function upsertUser(u: TelegramUser, opts: { notify?: boolean } = {}) {
  // `notify` only ever gets switched on here (Telegram told us we may write); switching off is explicit.
  const notify = opts.notify ?? u.allows_write_to_pm === true;
  run(
    `INSERT INTO users (id, first_name, last_name, username, photo_url, notify, lang)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       username = excluded.username,
       photo_url = COALESCE(excluded.photo_url, users.photo_url),
       notify = MAX(users.notify, excluded.notify),
       lang = COALESCE(excluded.lang, users.lang),
       updated_at = datetime('now')`,
    u.id,
    u.first_name,
    u.last_name ?? null,
    u.username ?? null,
    u.photo_url ?? null,
    notify ? 1 : 0,
    u.language_code ? pickLang(u.language_code) : null,
  );
}

export function newInviteCode(): string {
  return crypto.randomBytes(9).toString('base64url');
}

export function findMembership(groupId: number, userId: number) {
  return one<MemberRow>('SELECT * FROM members WHERE group_id = ? AND user_id = ?', groupId, userId);
}

/**
 * Member balances straight from SQL: paid (expenses by payer) minus owed (shares by member), per member.
 * Same numbers as `computeBalances` from shared/money.ts (a test compares them), without loading any ledger rows.
 * Positive = the group owes this member. `where` filters `members m`; its params follow.
 */
function memberBalances(where: string, ...params: number[]) {
  return all<{ id: number; group_id: number; balance: number }>(
    `SELECT m.id, m.group_id,
            COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.payer_id = m.id), 0)
          - COALESCE((SELECT SUM(s.amount) FROM expense_shares s WHERE s.member_id = m.id), 0) AS balance
     FROM members m WHERE ${where}`,
    ...params,
  );
}

/** Sum of real expenses (transfers excluded) per group. */
function totalsSpent(where: string, ...params: number[]) {
  const rows = all<{ group_id: number; total: number }>(
    `SELECT group_id, SUM(amount) AS total FROM expenses WHERE kind = 'expense' AND ${where} GROUP BY group_id`,
    ...params,
  );
  return new Map(rows.map((r) => [r.group_id, r.total]));
}

export function groupBalances(groupId: number) {
  return new Map(memberBalances('m.group_id = ?', groupId).map((r) => [r.id, r.balance]));
}

function loadMembers(groupId: number) {
  return all<
    MemberRow & {
      username: string | null;
      photo_url: string | null;
      user_payment_info: string | null;
      user_notify: number | null;
    }
  >(
    `SELECT m.*, u.username, u.photo_url, u.payment_info AS user_payment_info, u.notify AS user_notify FROM members m LEFT JOIN users u ON u.id = m.user_id
     WHERE m.group_id = ? ORDER BY m.id`,
    groupId,
  );
}

type ExpenseDto = ReturnType<typeof expenseDto>;

function expenseDto(e: ExpenseRow, shares: ShareRow[]) {
  return {
    id: e.id,
    kind: e.kind,
    title: e.title,
    amount: e.amount,
    originalAmount: e.original_amount,
    originalCurrency: e.original_currency,
    rate: e.rate,
    payerId: e.payer_id,
    splitMode: e.split_mode,
    spentOn: e.spent_on,
    category: e.kind === 'expense' ? e.category : null,
    createdAt: e.created_at,
    shares: shares.map((s) => ({ memberId: s.member_id, input: s.input, amount: s.amount })),
  };
}

function withShares(rows: ExpenseRow[]): ExpenseDto[] {
  if (rows.length === 0) return [];
  const byExpense = new Map<number, ShareRow[]>();
  // Ids are our own integers; chunked so a "load everything" call stays under SQLite's variable limit.
  for (let i = 0; i < rows.length; i += 500) {
    const ids = rows.slice(i, i + 500).map((e) => e.id);
    const shares = all<ShareRow>(
      `SELECT * FROM expense_shares WHERE expense_id IN (${ids.map(() => '?').join(',')}) ORDER BY rowid`,
      ...ids,
    );
    for (const s of shares) {
      const list = byExpense.get(s.expense_id);
      if (list) list.push(s);
      else byExpense.set(s.expense_id, [s]);
    }
  }
  return rows.map((e) => expenseDto(e, byExpense.get(e.id) ?? []));
}

export function countExpenses(groupId: number): number {
  return one<{ n: number }>('SELECT COUNT(*) AS n FROM expenses WHERE group_id = ?', groupId)!.n;
}

/**
 * Expenses newest first (by date, then id). `before` is the id of the last expense the caller already has:
 * only strictly older ones follow it. Without `limit` everything is returned.
 * Returns null when `before` is not an expense of this group (e.g. it was deleted meanwhile).
 */
export function listExpenses(groupId: number, opts: { before?: number; limit?: number } = {}): ExpenseDto[] | null {
  const params: SQLInputValue[] = [groupId];
  let cursor = '';
  if (opts.before !== undefined) {
    const at = one<{ spent_on: string }>(
      'SELECT spent_on FROM expenses WHERE id = ? AND group_id = ?',
      opts.before,
      groupId,
    );
    if (!at) return null;
    cursor = 'AND (spent_on < ? OR (spent_on = ? AND id < ?))';
    params.push(at.spent_on, at.spent_on, opts.before);
  }
  const limit = opts.limit === undefined ? '' : `LIMIT ${Math.trunc(opts.limit)}`;
  return withShares(
    all<ExpenseRow>(
      `SELECT * FROM expenses WHERE group_id = ? ${cursor} ORDER BY spent_on DESC, id DESC ${limit}`,
      ...params,
    ),
  );
}

/** One page of older expenses plus a flag whether more remain; null when the cursor is gone. */
export function expensesPage(groupId: number, opts: { before?: number; limit: number }) {
  const rows = listExpenses(groupId, { before: opts.before, limit: opts.limit + 1 });
  if (rows === null) return null;
  return { items: rows.slice(0, opts.limit), hasMore: rows.length > opts.limit };
}

export function getExpense(groupId: number, expenseId: number): ExpenseDto | null {
  const row = one<ExpenseRow>('SELECT * FROM expenses WHERE id = ? AND group_id = ?', expenseId, groupId);
  return row ? withShares([row])[0] : null;
}

/**
 * Compact view of the whole ledger for server-side aggregates (summary, category stats): no titles,
 * so it stays small even for a group at the expense quota.
 */
export function loadLedger(groupId: number) {
  const rows = all<Pick<ExpenseRow, 'id' | 'kind' | 'amount' | 'payer_id' | 'spent_on' | 'category'>>(
    'SELECT id, kind, amount, payer_id, spent_on, category FROM expenses WHERE group_id = ? ORDER BY spent_on DESC, id DESC',
    groupId,
  );
  const shares = new Map<number, { memberId: number; amount: number }[]>();
  for (const s of all<ShareRow>(
    'SELECT s.* FROM expense_shares s JOIN expenses e ON e.id = s.expense_id WHERE e.group_id = ?',
    groupId,
  )) {
    const list = shares.get(s.expense_id);
    const item = { memberId: s.member_id, amount: s.amount };
    if (list) list.push(item);
    else shares.set(s.expense_id, [item]);
  }
  return rows.map((e) => ({
    id: e.id,
    kind: e.kind,
    amount: e.amount,
    payerId: e.payer_id,
    spentOn: e.spent_on,
    category: e.kind === 'expense' ? e.category : null,
    shares: shares.get(e.id) ?? [],
  }));
}

/** Achievements over ALL expenses of the group (SQL aggregates), so they do not depend on the loaded page. */
export function groupAchievementList(group: GroupRow, memberCount: number, balances: Map<number, number>) {
  const f = one<{ n: number; days: number; cats: number; cur: number; lo: string | null; hi: string | null }>(
    `SELECT COUNT(*) AS n, COUNT(DISTINCT spent_on) AS days, COUNT(DISTINCT category) AS cats,
            COUNT(DISTINCT COALESCE(original_currency, ?)) AS cur, MIN(spent_on) AS lo, MAX(spent_on) AS hi
     FROM expenses WHERE group_id = ? AND kind = 'expense'`,
    group.currency,
    group.id,
  )!;
  return achievementsFromFacts({
    membersCount: memberCount,
    allSettled: [...balances.values()].every((b) => b === 0),
    expenseCount: f.n,
    daysCount: f.days,
    spanDays: f.lo && f.hi ? spanBetween(f.lo, f.hi) : 0,
    categoriesCount: f.cats,
    currenciesCount: f.cur,
  });
}

/**
 * Group screen payload. `expenses` holds only the newest page (config.expensesPage) unless `all` is set;
 * `expensesTotal` / `hasMoreExpenses` tell the client whether older ones exist. Balances, totals and the
 * settlement plan are always computed in SQL over every expense, never from the page.
 */
export function groupDetail(group: GroupRow, me: MemberRow, inviteLink: string | null, opts: { all?: boolean } = {}) {
  const members = loadMembers(group.id);
  const balances = groupBalances(group.id);
  const expensesTotal = countExpenses(group.id);
  const expenses = listExpenses(group.id, opts.all ? {} : { limit: config.expensesPage }) ?? [];
  const totalSpent = totalsSpent('group_id = ?', group.id).get(group.id) ?? 0;
  return {
    id: group.id,
    name: group.name,
    currency: group.currency,
    inviteCode: group.invite_code,
    // The demo group cannot be joined, so it has no invite.
    inviteLink: group.is_demo ? null : inviteLink,
    isDemo: group.is_demo === 1,
    isOwner: group.created_by === me.user_id,
    archived: group.archived_at !== null,
    // Only the title: the numeric chat id never leaves the server.
    chat: group.chat_id === null ? null : { title: group.chat_title ?? '', feed: group.chat_feed },
    meId: me.id,
    totalSpent,
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      // The Telegram id stays on the server: the client only needs to know whether there is an account.
      hasTelegram: m.user_id !== null,
      username: m.username,
      photoUrl: m.photo_url,
      // Only ever returned to members of this group (loadGroupFor guards every caller).
      paymentInfo: deserialize(m.user_id === null ? m.payment_info : m.user_payment_info),
      // Whether the bot can write to this person; nothing else about their Telegram settings is exposed.
      canNotify: m.user_id !== null && m.user_notify === 1,
      balance: balances.get(m.id) ?? 0,
    })),
    expenses,
    achievements: groupAchievementList(group, members.length, balances),
    expensesTotal,
    hasMoreExpenses: expenses.length < expensesTotal,
    settlements: settleUp(balances),
    receipts: receiptsInfo(group),
  };
}

/** What the client needs to show the receipt button and the quota. Disabled in the demo and when the budget is spent. */
function receiptsInfo(group: GroupRow) {
  const q = scanQuota(group.id);
  return {
    enabled: receiptsEnabled() && group.is_demo === 0 && !budgetExhausted(),
    unlimited: q.unlimited,
    used: q.used,
    limit: q.limit,
    resetsAt: q.resetsAt,
  };
}

/** Everything a chat message needs about a group's balances; no viewer, so it works for people who aren't members. */
export function groupBalanceSnapshot(group: GroupRow) {
  const members = all<{ id: number; name: string }>(
    'SELECT id, name FROM members WHERE group_id = ? ORDER BY id',
    group.id,
  );
  const balances = groupBalances(group.id);
  return {
    totalSpent: totalsSpent('group_id = ?', group.id).get(group.id) ?? 0,
    members: members.map((m) => ({ id: m.id, name: m.name, balance: balances.get(m.id) ?? 0 })),
    settlements: settleUp(balances),
  };
}

export function groupsForUser(userId: number) {
  const groups = all<GroupRow & { member_id: number }>(
    `SELECT g.*, m.id AS member_id FROM groups g JOIN members m ON m.group_id = g.id
     WHERE m.user_id = ? ORDER BY g.created_at DESC, g.id DESC`,
    userId,
  );
  const totals = totalsSpent('group_id IN (SELECT group_id FROM members WHERE user_id = ?)', userId);
  // Only the viewer's own balance is needed here, not everyone's.
  const balanceOf = new Map(memberBalances('m.user_id = ?', userId).map((r) => [r.id, r.balance]));
  const counts = new Map(
    all<{ group_id: number; n: number }>(
      `SELECT group_id, COUNT(*) AS n FROM members
       WHERE group_id IN (SELECT group_id FROM members WHERE user_id = ?) GROUP BY group_id`,
      userId,
    ).map((r) => [r.group_id, r.n]),
  );
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    currency: g.currency,
    membersCount: counts.get(g.id) ?? 0,
    totalSpent: totals.get(g.id) ?? 0,
    myBalance: balanceOf.get(g.member_id) ?? 0,
    archived: g.archived_at !== null,
    isDemo: g.is_demo === 1,
  }));
}

/** Non-archived groups of a user for inline queries; the heavy ledger is loaded lazily via `snapshot()`. */
export function inlineGroupsForUser(userId: number) {
  const groups = all<GroupRow & { member_id: number }>(
    `SELECT g.*, m.id AS member_id FROM groups g JOIN members m ON m.group_id = g.id
     WHERE m.user_id = ? AND g.archived_at IS NULL AND g.is_demo = 0 ORDER BY g.created_at DESC, g.id DESC`,
    userId,
  );
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    currency: g.currency,
    inviteCode: g.invite_code,
    snapshot: () => {
      const snap = groupBalanceSnapshot(g);
      return { ...snap, myBalance: snap.members.find((m) => m.id === g.member_id)?.balance ?? 0 };
    },
  }));
}
