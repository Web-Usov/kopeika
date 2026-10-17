import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Achievement } from '../../shared/achievements.ts';
import type { ActivityEntry } from '../../shared/activity.ts';
import type { CategoryId, CategoryTotal } from '../../shared/categories.ts';
import type { SplitMode } from '../../shared/money.ts';
import type { ReceiptsProvider } from '../../shared/privacy.ts';
import type { Period } from '../../shared/recurring.ts';
import type { GroupSummary as GroupSummaryStats } from '../../shared/summary.ts';
import { lang, t } from './i18n.ts';
import { authHeader, inTelegram } from './tg.tsx';

export interface PaymentInfo {
  phone?: string;
  bank?: string;
  card?: string;
  link?: string;
  note?: string;
}

export const hasPaymentInfo = (p: PaymentInfo | undefined) => Boolean(p && Object.keys(p).length > 0);

export interface Member {
  id: number;
  name: string;
  hasTelegram: boolean;
  username: string | null;
  photoUrl: string | null;
  balance: number;
  paymentInfo: PaymentInfo;
  canNotify: boolean;
}

export interface Expense {
  id: number;
  kind: 'expense' | 'transfer';
  title: string;
  amount: number;
  /** Set when the expense was entered in another currency: `amount` is then the converted value. */
  originalAmount: number | null;
  originalCurrency: string | null;
  /** Group-currency units per 1 original unit, decimal string. */
  rate: string | null;
  payerId: number;
  splitMode: SplitMode;
  spentOn: string;
  /** null for transfers */
  category: CategoryId | null;
  createdAt: string;
  shares: { memberId: number; input: number; amount: number }[];
}

/** What the bot posts to the linked chat. */
export type ChatFeed = 'off' | 'each' | 'daily';

export interface GroupDetail {
  id: number;
  name: string;
  currency: string;
  inviteCode: string;
  inviteLink: string | null;
  isOwner: boolean;
  /** Sandbox group with made-up people: no invites, no bot, no chat link. */
  isDemo: boolean;
  archived: boolean;
  /** Linked Telegram chat (title only), if any. */
  autoRemind: boolean;
  chat: { title: string; feed: ChatFeed } | null;
  meId: number;
  totalSpent: number;
  members: Member[];
  /** Only the newest page; older ones come from loadMoreExpenses. Balances and totals cover all of them. */
  expenses: Expense[];
  expensesTotal: number;
  hasMoreExpenses: boolean;
  /** Computed by the server over all expenses. */
  achievements: Achievement[];
  settlements: { from: number; to: number; amount: number }[];
  /** Receipt scanning for this user in this group (#102). Absent on older servers. */
  receipts?: ReceiptQuota;
}

export interface ReceiptQuota {
  /** The feature exists for this group: show the button (in the closed beta also while access is still to be asked). */
  offered?: boolean;
  /** The group can scan right now. */
  enabled: boolean;
  /** Closed beta: the owner has to approve each group. */
  beta?: boolean;
  access?: 'none' | 'pending' | 'approved' | 'rejected';
  unlimited: boolean;
  used: number;
  limit: number;
  /** ISO time when the quota resets. */
  resetsAt: string | null;
}

/** The server's answer to a receipt photo (see server/src/receipts/normalize.ts). */
export interface ParsedReceipt {
  merchant: string | null;
  date: string | null;
  currency: string | null;
  items: { id: string; name: string; quantity?: string; amount: number }[];
  adjustments: { kind: string; label: string; amount: number; percent: string | null }[];
  total: number | null;
  mismatch: boolean;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
}

export interface GroupSummary {
  id: number;
  name: string;
  currency: string;
  membersCount: number;
  totalSpent: number;
  myBalance: number;
  archived: boolean;
  isDemo: boolean;
}

export interface InvitePreview {
  group: { id: number; name: string; currency: string; membersCount: number };
  isMember: boolean;
  unclaimed: { id: number; name: string }[];
}

export interface ChatLinkPreview {
  chatTitle: string;
  /** Group (of this user) the chat is linked to right now; linking replaces it. */
  replaces: { name: string } | null;
}

export interface ExpenseInput {
  kind?: 'expense' | 'transfer';
  title: string;
  /** Ignored by the server when originalAmount is given. */
  amount: number;
  originalAmount?: number;
  originalCurrency?: string;
  rate?: string;
  payerId: number;
  splitMode: SplitMode;
  spentOn: string;
  category?: CategoryId;
  shares: { memberId: number; value: number }[];
}

export interface Recurring {
  id: number;
  title: string;
  category: CategoryId;
  /** In the group currency. */
  amount: number;
  payerId: number;
  splitMode: SplitMode;
  shares: { memberId: number; value: number }[];
  period: Period;
  /** Day of the month (1-31) for monthly, ISO weekday (1-7) for weekly. */
  day: number;
  nextDate: string;
  active: boolean;
}

export interface RecurringInput {
  title: string;
  amount: number;
  payerId: number;
  splitMode: SplitMode;
  category?: CategoryId;
  shares: { memberId: number; value: number }[];
  period: Period;
  day: number;
  /** The first occurrence is the first fitting date on or after this one. */
  startDate?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    signal,
    headers: {
      Authorization: authHeader(),
      // Dev mode (no Telegram initData): tell the server which language to answer in.
      ...(inTelegram ? {} : { 'X-Lang': lang }),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new ApiError(
      (data as { error?: string }).error ?? t('common.errorStatus', { status: res.status }),
      res.status,
    );
  return data as T;
}

// --- Tiny cache so navigating between screens shows data instantly while it refreshes ---
const groupCache = new Map<number, GroupDetail>();
let groupsList: GroupSummary[] | undefined;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function setGroup(g: GroupDetail) {
  groupCache.set(g.id, g);
  groupsList = undefined; // balances changed; refetch the list next time
  emit();
}

export const getCachedGroup = (id: number) => groupCache.get(id);

export function forgetGroup(id: number) {
  groupCache.delete(id);
  groupsList = undefined;
  emit();
}

function useLoader<T>(get: () => T | undefined, load: () => Promise<void>, key: unknown) {
  const data = useSyncExternalStore(subscribe, get);
  const [error, setError] = useState<string>();
  useEffect(() => {
    setError(undefined);
    load().catch((e: Error) => setError(e.message));
  }, [key]);
  return { data, error };
}

const olderThan = (a: Expense, b: Expense) => a.spentOn < b.spentOn || (a.spentOn === b.spentOn && a.id < b.id);

/** A fresh first page keeps the older pages the user already loaded (they sit after its last item). */
function withLoadedTail(fresh: GroupDetail, old: GroupDetail | undefined): GroupDetail {
  const tail = fresh.expenses.at(-1);
  if (!old || !tail || !fresh.hasMoreExpenses) return fresh;
  const keep = old.expenses.filter((e) => olderThan(e, tail));
  if (keep.length === 0) return fresh;
  const expenses = [...fresh.expenses, ...keep];
  return { ...fresh, expenses, hasMoreExpenses: expenses.length < fresh.expensesTotal };
}

export function useGroup(id: number) {
  return useLoader(
    () => groupCache.get(id),
    async () => setGroup(withLoadedTail(await request<GroupDetail>('GET', `/groups/${id}`), groupCache.get(id))),
    id,
  );
}

/** Loads the next page of older expenses into the cached group. */
export async function loadMoreExpenses(id: number) {
  const g = groupCache.get(id);
  const last = g?.expenses.at(-1);
  if (!g || !last) return;
  const page = await request<{ items: Expense[] }>('GET', `/groups/${id}/expenses?before=${last.id}`);
  const cur = groupCache.get(id) ?? g;
  const have = new Set(cur.expenses.map((e) => e.id));
  const expenses = [...cur.expenses, ...page.items.filter((e) => !have.has(e.id))];
  groupCache.set(id, { ...cur, expenses, hasMoreExpenses: expenses.length < cur.expensesTotal });
  emit();
}

/** An expense by id: from the loaded page if it is there, otherwise fetched (it may be an old one). */
export function useExpense(groupId: number, expenseId: number | undefined, loaded: GroupDetail | undefined) {
  const found = expenseId ? loaded?.expenses.find((e) => e.id === expenseId) : undefined;
  const [fetched, setFetched] = useState<Expense>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!expenseId || found) return;
    request<Expense>('GET', `/groups/${groupId}/expenses/${expenseId}`).then(setFetched, () => setFailed(true));
  }, [groupId, expenseId, found]);
  const expense = found ?? (fetched?.id === expenseId ? fetched : undefined);
  return { expense, loading: Boolean(expenseId) && !expense && !failed };
}

export function useGroups() {
  return useLoader(
    () => groupsList,
    async () => {
      groupsList = await request<GroupSummary[]>('GET', '/groups');
      emit();
    },
    'groups',
  );
}

/** Drops everything cached about the user (after their data was deleted). */
export function clearCache() {
  groupCache.clear();
  groupsList = undefined;
  emit();
}

export const api = {
  deleteMe: () => request<{ ok: true; groupsDeleted: number; groupsLeft: number }>('DELETE', '/me'),
  me: () =>
    request<{
      name: string;
      notify: boolean;
      receiptsEnabled?: boolean;
      receiptsProvider?: ReceiptsProvider;
      receiptConsent?: boolean;
    }>('GET', '/me'),
  parseReceipt: (id: number, body: { image: string; mediaType: string }, signal?: AbortSignal) =>
    request<ParsedReceipt>('POST', `/groups/${id}/receipts/parse`, body, signal),
  requestReceiptAccess: (id: number) =>
    request<GroupDetail>('POST', `/groups/${id}/receipts/access-request`, {}).then((g) => setGroup(g)),
  giveReceiptConsent: () => request<unknown>('POST', '/me/receipt-consent', {}),
  myPaymentInfo: () => request<PaymentInfo>('GET', '/me/payment-info'),
  setMyPaymentInfo: (info: PaymentInfo) => request<PaymentInfo>('PUT', '/me/payment-info', info),
  setMemberPaymentInfo: (id: number, memberId: number, paymentInfo: PaymentInfo) =>
    request<GroupDetail>('PATCH', `/groups/${id}/members/${memberId}`, { paymentInfo }),
  setNotify: (notify: boolean) => request('PUT', '/me', { notify }),
  createGroup: (body: { name: string; currency: string; memberNames: string[] }) =>
    request<GroupDetail>('POST', '/groups', body),
  renameGroup: (id: number, name: string) => request<GroupDetail>('PATCH', `/groups/${id}`, { name }),
  createDemo: () => request<GroupDetail>('POST', '/demo'),
  deleteGroup: (id: number) => request('DELETE', `/groups/${id}`),
  archiveGroup: (id: number) => request<GroupDetail>('POST', `/groups/${id}/archive`),
  unarchiveGroup: (id: number) => request<GroupDetail>('POST', `/groups/${id}/unarchive`),
  prepareShare: (id: number, kind: 'balance' | 'summary') =>
    request<{ id: string }>('POST', `/groups/${id}/share`, { kind }),
  /** Prepared request_chat button for WebApp.requestChat; the bot links the picked chat by itself. */
  prepareChatRequest: (id: number) => request<{ id: string }>('POST', `/groups/${id}/chat/request`),
  /** Refetches the group (the bot may have linked a chat meanwhile) and puts it in the cache. */
  reloadGroup: async (id: number) => {
    const fresh = await request<GroupDetail>('GET', `/groups/${id}`);
    setGroup(withLoadedTail(fresh, groupCache.get(id)));
    return fresh;
  },
  exportGroup: (id: number) => request<{ ok: true }>('POST', `/groups/${id}/export`),
  rotateInvite: (id: number) => request<GroupDetail>('POST', `/groups/${id}/invite/rotate`),
  removeMember: (id: number, memberId: number) =>
    request<GroupDetail>('POST', `/groups/${id}/members/${memberId}/remove`),
  leaveGroup: (id: number) => request('POST', `/groups/${id}/leave`),
  addMember: (id: number, name: string) => request<GroupDetail>('POST', `/groups/${id}/members`, { name }),
  renameMember: (id: number, memberId: number, name: string) =>
    request<GroupDetail>('PATCH', `/groups/${id}/members/${memberId}`, { name }),
  deleteMember: (id: number, memberId: number) => request<GroupDetail>('DELETE', `/groups/${id}/members/${memberId}`),
  invite: (code: string) => request<InvitePreview>('GET', `/invite/${encodeURIComponent(code)}`),
  join: (code: string, claimMemberId?: number) =>
    request<{ groupId: number }>('POST', `/invite/${encodeURIComponent(code)}/join`, { claimMemberId }),
  chatLink: (token: string) => request<ChatLinkPreview>('GET', `/chat-links/${encodeURIComponent(token)}`),
  attachChat: (token: string, groupId: number) =>
    request<GroupDetail>('POST', `/chat-links/${encodeURIComponent(token)}/attach`, { groupId }),
  setChatFeed: (id: number, feed: ChatFeed) => request<GroupDetail>('PUT', `/groups/${id}/chat/feed`, { feed }),
  setAutoRemind: (id: number, enabled: boolean) =>
    request<GroupDetail>('PUT', `/groups/${id}/auto-remind`, { enabled }),
  unlinkChat: (id: number) => request<GroupDetail>('POST', `/groups/${id}/chat/unlink`),
  addExpense: (id: number, body: ExpenseInput) => request<GroupDetail>('POST', `/groups/${id}/expenses`, body),
  updateExpense: (id: number, expenseId: number, body: ExpenseInput) =>
    request<GroupDetail>('PUT', `/groups/${id}/expenses/${expenseId}`, body),
  rate: (base: string, currency: string, date: string) =>
    request<{ rate: string; source: string; date: string }>(
      'GET',
      `/rates?base=${base}&currency=${currency}&date=${date}`,
    ),
  summary: (id: number) => request<GroupSummaryStats>('GET', `/groups/${id}/summary`),
  stats: (id: number) => request<{ group: CategoryTotal[]; mine: CategoryTotal[] }>('GET', `/groups/${id}/stats`),
  activity: (id: number, before?: number) =>
    request<{ items: ActivityEntry[]; nextBefore: number | null }>(
      'GET',
      `/groups/${id}/activity${before ? `?before=${before}` : ''}`,
    ),
  remind: (id: number, memberId: number) => request<{ ok: true }>('POST', `/groups/${id}/remind`, { memberId }),
  recurring: (id: number) => request<Recurring[]>('GET', `/groups/${id}/recurring`),
  addRecurring: (id: number, body: RecurringInput) => request<Recurring>('POST', `/groups/${id}/recurring`, body),
  setRecurringActive: (id: number, rid: number, active: boolean) =>
    request<Recurring>('PATCH', `/groups/${id}/recurring/${rid}`, { active }),
  deleteRecurring: (id: number, rid: number) => request('DELETE', `/groups/${id}/recurring/${rid}`),
  deleteExpense: (id: number, expenseId: number) =>
    request<GroupDetail>('DELETE', `/groups/${id}/expenses/${expenseId}`),
};
