// "Who ate what": from a confirmed receipt draft and the picked members to per-member amounts.
// Pure, integer minor units; the arithmetic itself lives in receipt.ts.
import { computeReceiptShares, type ReceiptAdjustment } from './receipt.ts';
import type { ReceiptDraft } from './receiptDraft.ts';

export interface AssignItem {
  id: string;
  name: string;
  amount: number;
  memberIds: number[];
}

export type AdjustmentMode = 'proportional' | 'equal';

/**
 * Signed draft adjustments → what computeReceiptShares takes (positive amounts, a kind that says the sign).
 * Negative → discount; positive service/tip stay as they are; tax, rounding and other add up as 'other'. Zeros are dropped.
 */
export function toReceiptAdjustments(
  adjustments: ReceiptDraft['adjustments'],
  modes: Record<string, AdjustmentMode> = {},
): ReceiptAdjustment[] {
  return adjustments
    .filter((a) => a.amount !== 0)
    .map((a) => {
      const kind: ReceiptAdjustment['kind'] =
        a.amount < 0 ? 'discount' : a.kind === 'service' || a.kind === 'tip' ? a.kind : 'other';
      return { kind, amount: Math.abs(a.amount), mode: modes[a.id] ?? 'proportional' };
    });
}

/** Total of the receipt: lines plus signed adjustments. */
export const assignTotal = (items: { amount: number }[], adjustments: { amount: number }[]) =>
  items.reduce((a, i) => a + i.amount, 0) + adjustments.reduce((a, i) => a + i.amount, 0);

/** Per-member amounts, summing exactly to the receipt total. Throws SplitError (unassigned item, too big a discount). */
export function assignShares(
  items: AssignItem[],
  adjustments: ReceiptDraft['adjustments'],
  modes: Record<string, AdjustmentMode> = {},
): Map<number, number> {
  return computeReceiptShares(
    items.map((i) => ({ id: i.name || i.id, amount: i.amount, memberIds: i.memberIds })),
    toReceiptAdjustments(adjustments, modes),
    assignTotal(items, adjustments),
  );
}

/** "2" / "3.0" → 2 / 3 when it is a whole number of units worth splitting (2..30), else null. */
export function wholeQuantity(quantity: string | undefined): number | null {
  if (!quantity) return null;
  const n = Number(quantity.trim().replace(',', '.'));
  return Number.isInteger(n) && n >= 2 && n <= 30 ? n : null;
}

/** One line of `n` units → `n` lines whose amounts add up to the original (the leftover goes to the first ones). */
export function splitIntoUnits(item: AssignItem, n: number): AssignItem[] {
  const base = Math.floor(item.amount / n);
  const extra = item.amount % n;
  return Array.from({ length: n }, (_, k) => ({
    id: `${item.id}.${k + 1}`,
    name: `${item.name} ${k + 1}/${n}`,
    amount: base + (k < extra ? 1 : 0),
    memberIds: [],
  }));
}
