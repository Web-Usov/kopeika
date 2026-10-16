import crypto from 'node:crypto';
import { pickLang } from '../../shared/i18n/index.ts';
import { computeBalances, type LedgerEntry, type SplitMode, settleUp } from '../../shared/money.ts';
import type { TelegramUser } from './auth.ts';
import { all, one, run } from './db.ts';
import { deserialize } from './paymentInfo.ts';

export interface UserRow {
  id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  photo_url: string | null;
  notify: number;
  lang: string | null;
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

function loadLedger(groupId: number) {
  const members = all<
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
  const expenses = all<ExpenseRow>(
    'SELECT * FROM expenses WHERE group_id = ? ORDER BY spent_on DESC, id DESC',
    groupId,
  );
  const shares = all<ShareRow>(
    `SELECT s.* FROM expense_shares s JOIN expenses e ON e.id = s.expense_id WHERE e.group_id = ?`,
    groupId,
  );
  const sharesByExpense = new Map<number, ShareRow[]>();
  for (const s of shares) {
    const list = sharesByExpense.get(s.expense_id) ?? [];
    list.push(s);
    sharesByExpense.set(s.expense_id, list);
  }
  const entries: LedgerEntry[] = expenses.map((e) => ({
    payerId: e.payer_id,
    amount: e.amount,
    shares: (sharesByExpense.get(e.id) ?? []).map((s) => ({ memberId: s.member_id, amount: s.amount })),
  }));
  const balances = computeBalances(
    members.map((m) => m.id),
    entries,
  );
  return { members, expenses, sharesByExpense, balances };
}

export function groupDetail(group: GroupRow, me: MemberRow, inviteLink: string | null) {
  const { members, expenses, sharesByExpense, balances } = loadLedger(group.id);
  return {
    id: group.id,
    name: group.name,
    currency: group.currency,
    inviteCode: group.invite_code,
    inviteLink,
    isOwner: group.created_by === me.user_id,
    archived: group.archived_at !== null,
    // Only the title: the numeric chat id never leaves the server.
    chat: group.chat_id === null ? null : { title: group.chat_title ?? '', feed: group.chat_feed },
    meId: me.id,
    totalSpent: expenses.filter((e) => e.kind === 'expense').reduce((a, e) => a + e.amount, 0),
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      userId: m.user_id,
      username: m.username,
      photoUrl: m.photo_url,
      // Only ever returned to members of this group (loadGroupFor guards every caller).
      paymentInfo: deserialize(m.user_id === null ? m.payment_info : m.user_payment_info),
      // Whether the bot can write to this person; nothing else about their Telegram settings is exposed.
      canNotify: m.user_id !== null && m.user_notify === 1,
      balance: balances.get(m.id) ?? 0,
    })),
    expenses: expenses.map((e) => ({
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
      shares: (sharesByExpense.get(e.id) ?? []).map((s) => ({
        memberId: s.member_id,
        input: s.input,
        amount: s.amount,
      })),
    })),
    settlements: settleUp(balances),
  };
}

/** Everything a chat message needs about a group's balances; no viewer, so it works for people who aren't members. */
export function groupBalanceSnapshot(group: GroupRow) {
  const { members, expenses, balances } = loadLedger(group.id);
  return {
    totalSpent: expenses.filter((e) => e.kind === 'expense').reduce((a, e) => a + e.amount, 0),
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
  return groups.map((g) => {
    const { members, expenses, balances } = loadLedger(g.id);
    return {
      id: g.id,
      name: g.name,
      currency: g.currency,
      membersCount: members.length,
      totalSpent: expenses.filter((e) => e.kind === 'expense').reduce((a, e) => a + e.amount, 0),
      myBalance: balances.get(g.member_id) ?? 0,
      archived: g.archived_at !== null,
    };
  });
}

/** Non-archived groups of a user for inline queries; the heavy ledger is loaded lazily via `snapshot()`. */
export function inlineGroupsForUser(userId: number) {
  const groups = all<GroupRow & { member_id: number }>(
    `SELECT g.*, m.id AS member_id FROM groups g JOIN members m ON m.group_id = g.id
     WHERE m.user_id = ? AND g.archived_at IS NULL ORDER BY g.created_at DESC, g.id DESC`,
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
