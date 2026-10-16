import type { ActivityAction, ActivityEntry, ActivityPayload, ExpenseSnapshot } from '../../shared/activity.ts';
import { all, one, run } from './db.ts';

/** Appends a history entry. Call it inside the same transaction as the change it describes. */
export function logActivity(groupId: number, userId: number, action: ActivityAction, payload: ActivityPayload) {
  run(
    'INSERT INTO activity (group_id, user_id, action, payload) VALUES (?, ?, ?, ?)',
    groupId,
    userId,
    action,
    JSON.stringify(payload),
  );
}

/** Snapshot of an expense with the names of the people involved, as they are right now. */
export function expenseSnapshot(expenseId: number): ExpenseSnapshot | null {
  const e = one<{ kind: 'expense' | 'transfer'; title: string; amount: number; payer_id: number; payer: string }>(
    `SELECT e.kind, e.title, e.amount, e.payer_id, m.name AS payer
     FROM expenses e JOIN members m ON m.id = e.payer_id WHERE e.id = ?`,
    expenseId,
  );
  if (!e) return null;
  const snap: ExpenseSnapshot = {
    kind: e.kind,
    title: e.title,
    amount: e.amount,
    payer: { id: e.payer_id, name: e.payer },
  };
  if (e.kind === 'transfer') {
    const to = one<{ id: number; name: string }>(
      `SELECT m.id, m.name FROM expense_shares s JOIN members m ON m.id = s.member_id WHERE s.expense_id = ? LIMIT 1`,
      expenseId,
    );
    if (to) snap.to = to;
  }
  return snap;
}

/** Stands in for a user whose account was deleted (see the last migration in db.ts). */
export const DELETED_USER_ID = 0;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** Newest first; `before` is the id of the last entry already shown. */
export function listActivity(
  groupId: number,
  before: number | undefined,
  limitRaw: number | undefined,
  deletedName = 'deleted user',
) {
  const limit = Math.min(Math.max(limitRaw ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const rows = all<{
    id: number;
    user_id: number;
    action: ActivityAction;
    payload: string;
    created_at: string;
    member_id: number | null;
    member_name: string | null;
    first_name: string | null;
  }>(
    `SELECT a.*, m.id AS member_id, m.name AS member_name, u.first_name
     FROM activity a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN members m ON m.group_id = a.group_id AND m.user_id = a.user_id
     WHERE a.group_id = ? AND (? IS NULL OR a.id < ?)
     ORDER BY a.id DESC LIMIT ?`,
    groupId,
    before ?? null,
    before ?? null,
    limit + 1,
  );
  const page = rows.slice(0, limit);
  const items: ActivityEntry[] = page.map((r) => ({
    id: r.id,
    action: r.action,
    actor: {
      memberId: r.member_id,
      name: r.member_name ?? (r.user_id === DELETED_USER_ID ? deletedName : (r.first_name ?? deletedName)),
    },
    payload: JSON.parse(r.payload) as ActivityPayload,
    createdAt: `${r.created_at.replace(' ', 'T')}Z`,
  }));
  return { items, nextBefore: rows.length > limit ? page[page.length - 1].id : null };
}
