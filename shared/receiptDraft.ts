// Receipt draft on the client: the shape that the draft editor hands over to the "who ate what" step (#104),
// plus pure helpers (amount input, totals, photo size). Integer minor units, no floats in the money.
import { parseAmount } from './money.ts';

export type DraftAdjustmentKind = 'tip' | 'service' | 'tax' | 'discount' | 'rounding' | 'other';
export const DRAFT_ADJUSTMENT_KINDS: readonly DraftAdjustmentKind[] = [
  'service',
  'tip',
  'tax',
  'discount',
  'rounding',
  'other',
];

/** A confirmed draft: every field is valid, amounts are minor units of `currency`. */
export interface ReceiptDraft {
  merchant: string;
  /** YYYY-MM-DD, or '' when unknown. */
  date: string;
  currency: string;
  items: { id: string; name: string; quantity?: string; amount: number }[];
  /** Signed: a discount is negative. */
  adjustments: { id: string; kind: DraftAdjustmentKind; label: string; amount: number }[];
  /** Total printed on the receipt, or null when unknown / accepted as the sum of the lines. */
  total: number | null;
}

/** "12,5" / "-3" / "−3,50" → minor units (signed), null when it is not an amount. */
export function parseSignedAmount(input: string): number | null {
  const s = input.trim();
  const negative = /^[-−–]/.test(s);
  const v = parseAmount(negative ? s.slice(1) : s);
  if (v === null) return null;
  return negative ? -v : v;
}

/** Minor units → editable string, with a sign ("-0,5" is not lost, unlike in amountToInput). */
export function signedToInput(minor: number): string {
  const abs = Math.abs(minor);
  const int = Math.trunc(abs / 100);
  const frac = abs % 100;
  const body = frac === 0 ? String(int) : `${int},${String(frac).padStart(2, '0').replace(/0$/, '')}`;
  return minor < 0 ? `-${body}` : body;
}

export interface DraftTotals {
  items: number;
  adjustments: number;
  /** items + adjustments */
  sum: number;
  /** sum - printed total; null when there is no printed total. 0 means it adds up. */
  diff: number | null;
}

export function draftTotals(itemAmounts: number[], adjustmentAmounts: number[], printed: number | null): DraftTotals {
  const items = itemAmounts.reduce((a, b) => a + b, 0);
  const adjustments = adjustmentAmounts.reduce((a, b) => a + b, 0);
  const sum = items + adjustments;
  return { items, adjustments, sum, diff: printed === null ? null : sum - printed };
}

/** A line is usable when it has a name and a non-zero amount. */
export function isLineValid(name: string, amountInput: string): boolean {
  const v = parseSignedAmount(amountInput);
  return name.trim() !== '' && v !== null && v !== 0;
}

/** Sign that an adjustment kind implies: a discount takes money off, the rest add (rounding may go either way). */
export function adjustForKind(kind: DraftAdjustmentKind, amount: number): number {
  if (kind === 'discount') return -Math.abs(amount);
  if (kind === 'rounding') return amount;
  return Math.abs(amount);
}

/** Photo size so that the longest side is at most `max`; never enlarges. */
export function fitSize(width: number, height: number, max = 2000): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const k = max / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Length of base64 text for `bytes` bytes (what actually goes into the JSON body). */
export const base64Length = (bytes: number) => 4 * Math.ceil(bytes / 3);

/** The server takes at most 3 MiB of JSON; leave room for the other fields. */
export const MAX_PHOTO_BASE64 = 3 * 1024 * 1024 - 1024;
export const photoFits = (bytes: number) => base64Length(bytes) <= MAX_PHOTO_BASE64;
