import { CURRENCIES, minorDigits } from '../../../shared/money.ts';
import type { RawReceipt } from './provider.ts';

export const MAX_ITEMS = 100;
const MAX_NAME = 100;
const MAX_MINOR = 1_000_000_000;

export type AdjustmentKind = 'tip' | 'service' | 'tax' | 'discount' | 'rounding' | 'other';
const KINDS: readonly AdjustmentKind[] = ['tip', 'service', 'tax', 'discount', 'rounding', 'other'];

export type ReceiptWarning = 'qty_mismatch' | 'low_confidence' | 'truncated' | 'dropped_total_line' | 'skipped_lines';

export interface ReceiptDraft {
  merchant: string | null;
  /** YYYY-MM-DD or null. */
  date: string | null;
  /** Detected currency from the supported list, or null (the client asks the user). */
  currency: string | null;
  items: { id: string; name: string; quantity?: string; amount: number }[];
  adjustments: { kind: AdjustmentKind; label: string; amount: number; percent: string | null }[];
  /** The printed total in minor units, or null if it could not be read. */
  total: number | null;
  /** True when the lines plus adjustments do not add up to the printed total. */
  mismatch: boolean;
  confidence: 'high' | 'medium' | 'low';
  warnings: ReceiptWarning[];
}

/** Thrown when the model says it is not a receipt, or nothing usable was read. */
export class ReceiptContentError extends Error {
  constructor(readonly kind: 'notReceipt' | 'unreadable') {
    super(kind);
  }
}

const SYMBOLS: Record<string, string> = {
  '₽': 'RUB',
  $: 'USD',
  '€': 'EUR',
  '₾': 'GEL',
  '₺': 'TRY',
  '₸': 'KZT',
  '֏': 'AMD',
  '₴': 'UAH',
  '฿': 'THB',
  '£': 'GBP',
  '¥': 'CNY',
  'د.إ': 'AED',
};

/** Currency from the model's hint: an ISO code from the supported list, or a symbol. The server decides, not the model. */
export function detectCurrency(hint: string | null): string | null {
  if (!hint) return null;
  const s = hint.trim();
  const code = s.toUpperCase();
  if (CURRENCIES.includes(code)) return code;
  return SYMBOLS[s] ?? null;
}

/**
 * Parses a printed amount ("1 234,50", "1.234,50", "1,234.50", "12.5", "-3,00", "(3.00)", "$82.93", "1 815,00 ₽", "руб. 120") into minor units
 * with integer arithmetic only. Returns null if it is not a clear number or does not fit `digits` decimals.
 */
export function parseDecimal(input: string, digits: number): number | null {
  // Currency symbols, codes and words ("$", "฿", "руб.", "USD", "*") may surround the number but never sit inside it.
  const first = input.search(/\d/);
  if (first < 0) return null;
  let end = input.length;
  while (!/\d/.test(input[end - 1] as string)) end--;
  const junk = (part: string) => part.replace(/\p{L}+\.?/gu, '').replace(/[^\-−().,]/gu, '');
  let s = (junk(input.slice(0, first)) + input.slice(first, end) + junk(input.slice(end))).replace(/[\s  ']/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d[\d.,]*$/.test(s)) return null;
  // The last separator is the decimal mark, except when it is the only kind of separator and either repeats
  // or is followed by exactly three digits (a currency with fewer decimals): then it groups thousands.
  const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  let int = s;
  let frac = '';
  if (last >= 0) {
    const mark = s[last]!;
    const tail = s.slice(last + 1);
    const bothKinds = s.includes('.') && s.includes(',');
    const grouping = !bothKinds && (s.split(mark).length > 2 || (tail.length === 3 && digits < 3));
    if (!grouping) {
      int = s.slice(0, last);
      frac = tail;
    }
  }
  int = int.replace(/[.,]/g, '');
  if (int === '' || !/^\d+$/.test(int) || !/^\d*$/.test(frac)) return null;
  if (frac.length > digits && /[^0]/.test(frac.slice(digits))) return null;
  const fracPadded = frac.slice(0, digits).padEnd(digits, '0');
  if (int.length > 12) return null;
  const v = Number(int) * 10 ** digits + (fracPadded ? Number(fracPadded) : 0);
  if (!Number.isSafeInteger(v)) return null;
  return negative ? -v : v;
}

/** Strips control and invisible characters (incl. bidi marks), collapses whitespace, caps the length. */
const clean = (s: string, max: number) =>
  s
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

function parseQty(q: string): string | undefined {
  const s = q.trim().replace(',', '.');
  return /^\d{1,6}(\.\d{1,3})?$/.test(s) && Number(s) > 0 ? s : undefined;
}

/** Quantity times unit price in minor units, using integer math on the decimal quantity. */
function qtyTimes(qty: string, unit: number): number {
  const [i = '0', f = ''] = qty.split('.');
  const scale = 10 ** f.length;
  return Math.round((Number(i + f) * unit) / scale);
}

/**
 * Turns the model's answer into a trustworthy draft (spec 5.2): amounts to minor units of the receipt's
 * (or the group's) currency, bounds on every field, line sum checked against the printed total.
 */
export function normalizeReceipt(raw: RawReceipt, opts: { groupCurrency: string }): ReceiptDraft {
  if (!raw.isReceipt) throw new ReceiptContentError('notReceipt');

  const currency = detectCurrency(raw.currencyHint);
  const digits = minorDigits(currency ?? opts.groupCurrency);
  const warnings = new Set<ReceiptWarning>();

  let items: ReceiptDraft['items'] = [];
  for (const it of raw.items) {
    const amount = parseDecimal(it.lineTotal, digits);
    const name = clean(it.name, MAX_NAME);
    if (amount === null || amount === 0 || Math.abs(amount) > MAX_MINOR || name === '') {
      warnings.add('skipped_lines');
      continue;
    }
    const quantity = parseQty(it.qty);
    const unit = it.unitPrice === null ? null : parseDecimal(it.unitPrice, digits);
    // The printed line total wins; a disagreeing quantity x price is only flagged.
    if (quantity && unit !== null && Math.abs(qtyTimes(quantity, unit) - amount) > 1) warnings.add('qty_mismatch');
    items.push({ id: '', name, ...(quantity && quantity !== '1' ? { quantity } : {}), amount });
  }
  if (items.length > MAX_ITEMS) {
    items = items.slice(0, MAX_ITEMS);
    warnings.add('truncated');
  }

  const adjustments: ReceiptDraft['adjustments'] = [];
  for (const e of raw.extras) {
    let amount = parseDecimal(e.amount, digits);
    if (amount === null || amount === 0 || Math.abs(amount) > MAX_MINOR) {
      warnings.add('skipped_lines');
      continue;
    }
    const lower = e.kind.toLowerCase();
    const kind = KINDS.find((k) => k === lower) ?? 'other';
    if (kind === 'discount' && amount > 0) amount = -amount;
    const percent =
      e.percent && /^\d{1,3}([.,]\d{1,2})?$/.test(e.percent.trim()) ? e.percent.trim().replace(',', '.') : null;
    adjustments.push({ kind, label: clean(e.label, MAX_NAME), amount, percent });
  }

  let total = raw.printedTotal === null ? null : parseDecimal(raw.printedTotal, digits);
  if (total !== null && (total <= 0 || total > MAX_MINOR)) total = null;

  // A "Total" line mistaken for a purchase: one line equal to the total next to other lines.
  if (total !== null && items.length >= 2) {
    const kept = items.filter((i) => i.amount !== total);
    if (kept.length < items.length && kept.length > 0) {
      items = kept;
      warnings.add('dropped_total_line');
    }
  }
  items = items.map((i, n) => ({ ...i, id: `i${n + 1}` }));

  if (items.length === 0) throw new ReceiptContentError('unreadable');

  const sum = items.reduce((s, i) => s + i.amount, 0) + adjustments.reduce((s, a) => s + a.amount, 0);
  const mismatch = total !== null && sum !== total;
  if (raw.confidence === 'low') warnings.add('low_confidence');

  const date =
    raw.date && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) && !Number.isNaN(Date.parse(raw.date)) ? raw.date : null;
  const merchant = raw.merchant ? clean(raw.merchant, MAX_NAME) || null : null;

  return {
    merchant,
    date,
    currency,
    items,
    adjustments,
    total,
    mismatch,
    confidence: raw.confidence,
    warnings: [...warnings],
  };
}

/** How far the lines are from the printed total (for choosing the better of two attempts). */
export const mismatchSize = (d: ReceiptDraft): number =>
  d.total === null
    ? 0
    : Math.abs(d.items.reduce((s, i) => s + i.amount, 0) + d.adjustments.reduce((s, a) => s + a.amount, 0) - d.total);
