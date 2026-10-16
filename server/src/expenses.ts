import { z } from 'zod';
import { CATEGORY_IDS, DEFAULT_CATEGORY } from '../../shared/categories.ts';
import { createT, type Lang } from '../../shared/i18n/index.ts';
import {
  CURRENCIES,
  computeShares,
  convertAmount,
  convertExactShares,
  normalizeRate,
  type SplitInput,
} from '../../shared/money.ts';
import { expenseSnapshot, logActivity } from './activity.ts';
import { all, one, run } from './db.ts';
import { fail } from './errors.ts';
import type { ExpenseRow, GroupRow } from './repo.ts';

export const expenseBody = z.object({
  kind: z.enum(['expense', 'transfer']).default('expense'),
  title: z.string().trim().max(100).default(''),
  // Ignored when originalAmount is given: the server computes it from the original amount and the rate.
  amount: z.number().int().min(0).max(1e12).default(0),
  // Foreign currency: all three or none. For splitMode "exact" the shares are then in the original currency.
  originalAmount: z.number().int().positive().max(1e12).optional(),
  originalCurrency: z.string().max(8).optional(),
  rate: z.string().max(32).optional(),
  payerId: z.number().int().positive(),
  splitMode: z.enum(['equal', 'shares', 'exact']),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(CATEGORY_IDS).optional(),
  shares: z
    .array(z.object({ memberId: z.number().int().positive(), value: z.number().int().min(0) }))
    .min(1)
    .max(100),
});
export type ExpenseBody = z.infer<typeof expenseBody>;

export interface Validated {
  computed: Map<number, number>;
  /** Canonical rate string when the expense is in a foreign currency. */
  rate: string | null;
}

export function validateExpense(group: GroupRow, body: ExpenseBody, lang: Lang): Validated {
  const groupId = group.id;
  const memberIds = new Set(all<{ id: number }>('SELECT id FROM members WHERE group_id = ?', groupId).map((m) => m.id));
  if (!memberIds.has(body.payerId) || body.shares.some((s) => !memberIds.has(s.memberId))) {
    throw fail(400, 'errors.foreignMember');
  }
  if (body.kind === 'transfer') {
    if (body.shares.length !== 1 || body.shares[0].memberId === body.payerId) throw fail(400, 'errors.badTransfer');
    body.splitMode = 'exact';
    body.shares[0].value = body.amount;
    body.title ||= createT(lang)('transfer.defaultTitle');
    body.category = DEFAULT_CATEGORY;
  } else if (!body.title) {
    throw fail(400, 'errors.titleRequired');
  }
  const foreign = [body.originalAmount, body.originalCurrency, body.rate].filter((v) => v !== undefined).length;
  if (foreign === 0) return { computed: computeShares(body.amount, body.splitMode, body.shares), rate: null };
  if (foreign !== 3 || body.kind === 'transfer') throw fail(400, 'errors.invalidData');
  const original = body.originalCurrency as string;
  if (!CURRENCIES.includes(original)) throw fail(400, 'errors.rate.unknownCurrency');
  if (original === group.currency) throw fail(400, 'errors.rate.sameCurrency');
  const rate = normalizeRate(body.rate as string);
  if (!rate) throw fail(400, 'errors.rate.invalid');
  const originalAmount = body.originalAmount as number;
  body.amount = convertAmount(originalAmount, rate, original, group.currency);
  if (body.splitMode !== 'exact') return { computed: computeShares(body.amount, body.splitMode, body.shares), rate };
  // Exact shares come in the original currency: check they add up there, then convert without losing a unit.
  computeShares(originalAmount, 'exact', body.shares);
  const converted: SplitInput[] = convertExactShares(body.shares, rate, original, group.currency);
  return { computed: computeShares(body.amount, 'exact', converted), rate };
}

export function saveShares(expenseId: number, body: ExpenseBody, computed: Map<number, number>) {
  run('DELETE FROM expense_shares WHERE expense_id = ?', expenseId);
  for (const s of body.shares) {
    run(
      'INSERT INTO expense_shares (expense_id, member_id, input, amount) VALUES (?, ?, ?, ?)',
      expenseId,
      s.memberId,
      body.splitMode === 'equal' ? 1 : s.value,
      computed.get(s.memberId)!,
    );
  }
}

/**
 * Validates and inserts an expense with its shares, logs it in the history and brings an archived group back.
 * Does not open a transaction: the caller wraps it (and whatever else must happen atomically) in `tx`.
 */
export function createExpense(group: GroupRow, userId: number, body: ExpenseBody, lang: Lang, recurring = false) {
  const { computed, rate } = validateExpense(group, body, lang);
  const res = run(
    `INSERT INTO expenses (group_id, kind, title, amount, payer_id, split_mode, spent_on, category, created_by,
                           original_amount, original_currency, rate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    group.id,
    body.kind,
    body.title,
    body.amount,
    body.payerId,
    body.splitMode,
    body.spentOn,
    body.category ?? DEFAULT_CATEGORY,
    userId,
    rate ? (body.originalAmount as number) : null,
    rate ? (body.originalCurrency as string) : null,
    rate,
  );
  const id = Number(res.lastInsertRowid);
  saveShares(id, body, computed);
  logActivity(group.id, userId, 'expense.create', {
    expenseId: id,
    expense: expenseSnapshot(id)!,
    ...(recurring ? { recurring: true } : {}),
  });
  run('UPDATE groups SET archived_at = NULL WHERE id = ?', group.id);
  return one<ExpenseRow>('SELECT * FROM expenses WHERE id = ?', id)!;
}
