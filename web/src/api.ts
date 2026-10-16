import { useEffect, useState, useSyncExternalStore } from 'react';
import type { SplitMode } from '../../shared/money.ts';
import { authHeader } from './tg.tsx';

export interface Member {
  id: number;
  name: string;
  userId: number | null;
  username: string | null;
  photoUrl: string | null;
  balance: number;
}

export interface Expense {
  id: number;
  kind: 'expense' | 'transfer';
  title: string;
  amount: number;
  payerId: number;
  splitMode: SplitMode;
  spentOn: string;
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
}

export interface InvitePreview {
  group: { id: number; name: string; currency: string; membersCount: number };
  isMember: boolean;
  unclaimed: { id: number; name: string }[];
}

export interface ExpenseInput {
  kind?: 'expense' | 'transfer';
  title: string;
  amount: number;
  payerId: number;
  splitMode: SplitMode;
  spentOn: string;
  shares: { memberId: number; value: number }[];
}

export class ApiError extends Error {}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { Authorization: authHeader(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Ошибка ${res.status}`);
  return data as T;
}

// --- Tiny cache so navigating between screens shows data instantly while it refreshes ---
const groupCache = new Map<number, GroupDetail>();
let groupsList: GroupSummary[] | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function setGroup(g: GroupDetail) {
  groupCache.set(g.id, g);
  groupsList = undefined; // balances changed; refetch the list next time
  emit();
}

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
  setNotify: (notify: boolean) => request('PUT', '/me', { notify }),
  createGroup: (body: { name: string; currency: string; memberNames: string[] }) =>
    request<GroupDetail>('POST', '/groups', body),
  renameGroup: (id: number, name: string) => request<GroupDetail>('PATCH', `/groups/${id}`, { name }),
  deleteGroup: (id: number) => request('DELETE', `/groups/${id}`),
  addMember: (id: number, name: string) => request<GroupDetail>('POST', `/groups/${id}/members`, { name }),
  renameMember: (id: number, memberId: number, name: string) =>
    request<GroupDetail>('PATCH', `/groups/${id}/members/${memberId}`, { name }),
  deleteMember: (id: number, memberId: number) => request<GroupDetail>('DELETE', `/groups/${id}/members/${memberId}`),
  invite: (code: string) => request<InvitePreview>('GET', `/invite/${encodeURIComponent(code)}`),
  join: (code: string, claimMemberId?: number) =>
    request<{ groupId: number }>('POST', `/invite/${encodeURIComponent(code)}/join`, { claimMemberId }),
  addExpense: (id: number, body: ExpenseInput) => request<GroupDetail>('POST', `/groups/${id}/expenses`, body),
  updateExpense: (id: number, expenseId: number, body: ExpenseInput) =>
    request<GroupDetail>('PUT', `/groups/${id}/expenses/${expenseId}`, body),
  deleteExpense: (id: number, expenseId: number) =>
    request<GroupDetail>('DELETE', `/groups/${id}/expenses/${expenseId}`),
};
