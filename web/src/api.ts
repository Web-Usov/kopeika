import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ActivityEntry } from '../../shared/activity.ts';
import type { CategoryId } from '../../shared/categories.ts';
import type { SplitMode } from '../../shared/money.ts';
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
  userId: number | null;
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

export interface GroupDetail {
  id: number;
  name: string;
  currency: string;
  inviteCode: string;
  inviteLink: string | null;
  isOwner: boolean;
  archived: boolean;
  /** Linked Telegram chat (title only), if any. */
  chat: { title: string } | null;
  meId: number;
  totalSpent: number;
  members: Member[];
  expenses: Expense[];
  settlements: { from: number; to: number; amount: number }[];
}

export interface GroupSummary {
  id: number;
  name: string;
  currency: string;
  membersCount: number;
  totalSpent: number;
  myBalance: number;
  archived: boolean;
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

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
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

export function useGroup(id: number) {
  return useLoader(
    () => groupCache.get(id),
    async () => setGroup(await request<GroupDetail>('GET', `/groups/${id}`)),
    id,
  );
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

export const api = {
  me: () => request<{ id: number; name: string; notify: boolean }>('GET', '/me'),
  myPaymentInfo: () => request<PaymentInfo>('GET', '/me/payment-info'),
  setMyPaymentInfo: (info: PaymentInfo) => request<PaymentInfo>('PUT', '/me/payment-info', info),
  setMemberPaymentInfo: (id: number, memberId: number, paymentInfo: PaymentInfo) =>
    request<GroupDetail>('PATCH', `/groups/${id}/members/${memberId}`, { paymentInfo }),
  setNotify: (notify: boolean) => request('PUT', '/me', { notify }),
  createGroup: (body: { name: string; currency: string; memberNames: string[] }) =>
    request<GroupDetail>('POST', '/groups', body),
  renameGroup: (id: number, name: string) => request<GroupDetail>('PATCH', `/groups/${id}`, { name }),
  deleteGroup: (id: number) => request('DELETE', `/groups/${id}`),
  archiveGroup: (id: number) => request<GroupDetail>('POST', `/groups/${id}/archive`),
  unarchiveGroup: (id: number) => request<GroupDetail>('POST', `/groups/${id}/unarchive`),
  exportGroup: (id: number) => request<{ ok: true }>('POST', `/groups/${id}/export`),
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
  unlinkChat: (id: number) => request<GroupDetail>('POST', `/groups/${id}/chat/unlink`),
  addExpense: (id: number, body: ExpenseInput) => request<GroupDetail>('POST', `/groups/${id}/expenses`, body),
  updateExpense: (id: number, expenseId: number, body: ExpenseInput) =>
    request<GroupDetail>('PUT', `/groups/${id}/expenses/${expenseId}`, body),
  rate: (base: string, currency: string, date: string) =>
    request<{ rate: string; source: string; date: string }>(
      'GET',
      `/rates?base=${base}&currency=${currency}&date=${date}`,
    ),
  activity: (id: number, before?: number) =>
    request<{ items: ActivityEntry[]; nextBefore: number | null }>(
      'GET',
      `/groups/${id}/activity${before ? `?before=${before}` : ''}`,
    ),
  remind: (id: number, memberId: number) => request<{ ok: true }>('POST', `/groups/${id}/remind`, { memberId }),
  deleteExpense: (id: number, expenseId: number) =>
    request<GroupDetail>('DELETE', `/groups/${id}/expenses/${expenseId}`),
};
