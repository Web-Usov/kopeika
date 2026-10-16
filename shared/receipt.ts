// Splitting a receipt by line items. Pure, integer minor units, BigInt for the proportional part.
import { convertExactShares, SplitError } from './money.ts';

export type AdjustmentKind = 'service' | 'tip' | 'discount' | 'other';

export interface ReceiptItem {
  id: string | number;
  /** Line total in minor units, >= 0. */
  amount: number;
  /** Who shares the item equally; at least one member. */
  memberIds: number[];
}

export interface ReceiptAdjustment {
  kind: AdjustmentKind;
  /** Positive minor units; a discount is subtracted, everything else is added. */
  amount: number;
  /** proportional (default): by members' item subtotals; equal: evenly between all participants. */
  mode?: 'proportional' | 'equal';
}

/** Largest remainder over integer weights, exact with BigInt. Ties go to the earlier index. */
function apportion(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, w) => a + BigInt(w), 0n);
  const a = BigInt(amount);
  const parts = weights.map((w, idx) => {
    const n = a * BigInt(w);
    return { idx, base: n / total, rem: n % total };
  });
  let leftover = Number(a - parts.reduce((s, p) => s + p.base, 0n));
  const order = [...parts]
    .filter((p) => p.rem > 0n)
    .sort((x, y) => (x.rem === y.rem ? x.idx - y.idx : x.rem > y.rem ? -1 : 1));
  for (const p of order) {
    if (leftover <= 0) break;
    p.base += 1n;
    leftover -= 1;
  }
  return parts.map((p) => Number(p.base));
}

/**
 * Per-member amounts for a receipt, summing exactly to items total + surcharges - discounts.
 * Each item is split equally between its members; the item index rotates who gets the leftover unit.
 * Throws SplitError for unassigned items, bad numbers or a discount that exceeds the items total.
 */
export function computeReceiptShares(
  items: ReceiptItem[],
  adjustments: ReceiptAdjustment[] = [],
  receiptTotal?: number,
): Map<number, number> {
  const unassigned = items.filter((i) => i.memberIds.length === 0).map((i) => String(i.id));
  if (unassigned.length > 0) throw new SplitError('errors.receipt.unassigned', { ids: unassigned.join(', ') });

  const sub = new Map<number, number>();
  let itemsTotal = 0;
  items.forEach((item, idx) => {
    if (!Number.isSafeInteger(item.amount) || item.amount < 0) throw new SplitError('errors.receipt.badItem');
    if (new Set(item.memberIds).size !== item.memberIds.length)
      throw new SplitError('errors.split.duplicateParticipant');
    const n = item.memberIds.length;
    const base = Math.floor(item.amount / n);
    const extra = item.amount % n;
    item.memberIds.forEach((id, pos) => {
      // positions idx, idx+1, ... (cyclic) get the leftover units
      const gets = (pos - (idx % n) + n) % n < extra ? 1 : 0;
      sub.set(id, (sub.get(id) ?? 0) + base + gets);
    });
    itemsTotal += item.amount;
  });

  const ids = [...sub.keys()];
  const result = new Map(sub);
  let expected = itemsTotal;
  for (const adj of adjustments) {
    if (!Number.isSafeInteger(adj.amount) || adj.amount <= 0) throw new SplitError('errors.receipt.badAdjustment');
    if (ids.length === 0) throw new SplitError('errors.split.noParticipants');
    const weights = ids.map((id) => sub.get(id) ?? 0);
    const useEqual = adj.mode === 'equal' || weights.every((w) => w === 0);
    const parts = apportion(adj.amount, useEqual ? ids.map(() => 1) : weights);
    const sign = adj.kind === 'discount' ? -1 : 1;
    ids.forEach((id, i) => {
      result.set(id, (result.get(id) ?? 0) + sign * parts[i]);
    });
    expected += sign * adj.amount;
  }
  if (expected < 0 || [...result.values()].some((v) => v < 0)) throw new SplitError('errors.receipt.discountTooBig');
  if (receiptTotal !== undefined && receiptTotal !== expected) throw new SplitError('errors.split.sumMismatch');
  return result;
}

/** Receipt shares in a foreign currency → group currency, summing exactly to the converted total. */
export function convertReceiptShares(
  shares: Map<number, number>,
  rate: string,
  originalCurrency: string,
  groupCurrency: string,
): Map<number, number> {
  const inputs = [...shares].map(([memberId, value]) => ({ memberId, value }));
  return new Map(convertExactShares(inputs, rate, originalCurrency, groupCurrency).map((i) => [i.memberId, i.value]));
}
