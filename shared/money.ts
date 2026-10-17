// Pure money logic shared by the server and the Mini App.
// All amounts are integers in minor units (kopecks, cents).
import { type Lang, locale, type Params } from './i18n/index.ts';

export type SplitMode = 'equal' | 'shares' | 'exact';

export interface SplitInput {
  memberId: number;
  /** equal: ignored (presence = participates); shares: weight; exact: amount in minor units */
  value: number;
}

export type SplitKey =
  | 'errors.split.amountPositive'
  | 'errors.split.noParticipants'
  | 'errors.split.duplicateParticipant'
  | 'errors.split.badParticipantAmount'
  | 'errors.split.sumMismatch'
  | 'errors.split.sharesInteger'
  | 'errors.split.sharesMissing'
  | 'errors.receipt.unassigned'
  | 'errors.receipt.discountTooBig'
  | 'errors.receipt.badItem'
  | 'errors.receipt.badAdjustment'
  | 'errors.rate.invalid'
  | 'errors.rate.tooSmall';

/** Carries a dictionary key (not a text): the caller translates it into the user's language. */
export class SplitError extends Error {
  constructor(
    readonly key: SplitKey,
    readonly params?: Params,
  ) {
    super(key);
  }
}

/**
 * Turns the user's split input into exact per-member amounts that always sum to `amount`.
 * Leftover minor units from rounding go to members in input order (largest remainder first for shares).
 */
export function computeShares(amount: number, mode: SplitMode, inputs: SplitInput[]): Map<number, number> {
  if (!Number.isInteger(amount) || amount <= 0) throw new SplitError('errors.split.amountPositive');
  if (inputs.length === 0) throw new SplitError('errors.split.noParticipants');
  const ids = new Set(inputs.map((i) => i.memberId));
  if (ids.size !== inputs.length) throw new SplitError('errors.split.duplicateParticipant');

  const result = new Map<number, number>();

  if (mode === 'exact') {
    let sum = 0;
    for (const i of inputs) {
      if (!Number.isInteger(i.value) || i.value < 0) throw new SplitError('errors.split.badParticipantAmount');
      sum += i.value;
      result.set(i.memberId, i.value);
    }
    if (sum !== amount) throw new SplitError('errors.split.sumMismatch');
    return result;
  }

  const weights = inputs.map((i) => (mode === 'equal' ? 1 : i.value));
  if (weights.some((w) => !Number.isInteger(w) || w < 0)) throw new SplitError('errors.split.sharesInteger');
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) throw new SplitError('errors.split.sharesMissing');

  // Largest remainder method: floor everyone, then hand out the leftover units.
  const raw = inputs.map((i, idx) => {
    const exact = (amount * weights[idx]) / total;
    return { id: i.memberId, base: Math.floor(exact), rem: exact - Math.floor(exact), idx };
  });
  let leftover = amount - raw.reduce((a, r) => a + r.base, 0);
  const order = [...raw].sort((a, b) => b.rem - a.rem || a.idx - b.idx);
  for (const r of order) {
    if (leftover === 0) break;
    if (weights[r.idx] === 0) continue;
    r.base += 1;
    leftover -= 1;
  }
  for (const r of raw) result.set(r.id, r.base);
  return result;
}

export interface LedgerEntry {
  payerId: number;
  amount: number;
  shares: { memberId: number; amount: number }[];
}

/** Positive balance = the group owes this member; negative = member owes the group. */
export function computeBalances(memberIds: number[], entries: LedgerEntry[]): Map<number, number> {
  const balances = new Map<number, number>(memberIds.map((id) => [id, 0]));
  const add = (id: number, v: number) => balances.set(id, (balances.get(id) ?? 0) + v);
  for (const e of entries) {
    add(e.payerId, e.amount);
    for (const s of e.shares) add(s.memberId, -s.amount);
  }
  return balances;
}

/**
 * For each member who is in debt now: the moment (`at` of the ledger entry) their balance last went from >= 0 to < 0,
 * i.e. since when they have been continuously in debt. Entries must come in chronological order. Members who are not
 * in debt are absent from the result. Replaying the ledger keeps this exact: a debt that was fully repaid and
 * came back later counts from the new start, and a debt only partly repaid keeps its original start.
 */
export function debtSince<T>(memberIds: number[], entries: (LedgerEntry & { at: T })[]): Map<number, T> {
  const balances = new Map<number, number>(memberIds.map((id) => [id, 0]));
  const since = new Map<number, T>();
  for (const e of entries) {
    const delta = new Map<number, number>();
    delta.set(e.payerId, (delta.get(e.payerId) ?? 0) + e.amount);
    for (const s of e.shares) delta.set(s.memberId, (delta.get(s.memberId) ?? 0) - s.amount);
    for (const [id, d] of delta) {
      const before = balances.get(id) ?? 0;
      const after = before + d;
      balances.set(id, after);
      if (after < 0 && before >= 0) since.set(id, e.at);
      else if (after >= 0) since.delete(id);
    }
  }
  return since;
}

export interface Settlement {
  from: number;
  to: number;
  amount: number;
}

/** Greedy: repeatedly match the biggest debtor with the biggest creditor. At most n-1 transfers. */
export function settleUp(balances: Map<number, number>): Settlement[] {
  const debtors = [...balances].filter(([, b]) => b < 0).map(([id, b]) => ({ id, left: -b }));
  const creditors = [...balances].filter(([, b]) => b > 0).map(([id, b]) => ({ id, left: b }));
  const byLeft = (a: { left: number; id: number }, b: { left: number; id: number }) => b.left - a.left || a.id - b.id;
  const out: Settlement[] = [];
  debtors.sort(byLeft);
  creditors.sort(byLeft);
  while (debtors.length && creditors.length) {
    const d = debtors[0];
    const c = creditors[0];
    const amount = Math.min(d.left, c.left);
    out.push({ from: d.id, to: c.id, amount });
    d.left -= amount;
    c.left -= amount;
    if (d.left === 0) debtors.shift();
    if (c.left === 0) creditors.shift();
    debtors.sort(byLeft);
    creditors.sort(byLeft);
  }
  return out;
}

/** Parses user input like "1 234,5" or "99.90" into minor units. Returns null if invalid. */
export function parseAmount(input: string): number | null {
  const s = input.replace(/[\s ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [int, frac = ''] = s.split('.');
  const v = Number(int) * 100 + Number(`${frac}00`.slice(0, 2));
  return Number.isSafeInteger(v) ? v : null;
}

/** Minor units → editable string ("1234,5" style without grouping). */
export function amountToInput(minor: number): string {
  const int = Math.trunc(minor / 100);
  const frac = Math.abs(minor % 100);
  return frac === 0 ? String(int) : `${int},${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

export function formatMoney(minor: number, currency: string, lang: Lang): string {
  const hasFrac = minor % 100 !== 0;
  try {
    return new Intl.NumberFormat(locale(lang), {
      style: 'currency',
      currency,
      minimumFractionDigits: hasFrac ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(hasFrac ? 2 : 0)} ${currency}`;
  }
}

export const CURRENCIES = ['RUB', 'USD', 'EUR', 'GEL', 'TRY', 'KZT', 'AMD', 'BYN', 'UAH', 'THB', 'AED', 'CNY', 'GBP'];

/** Number of minor-unit digits of a currency (2 for everything we support today; JPY-like ones would be 0). */
export function minorDigits(currency: string): number {
  return ZERO_DIGIT_CURRENCIES.has(currency) ? 0 : 2;
}
const ZERO_DIGIT_CURRENCIES = new Set<string>(['JPY', 'KRW', 'VND']);

// --- Foreign-currency expenses ---
// A rate is a decimal string ("34.5" = group-currency units per 1 original unit) and is converted with BigInt,
// so no float ever touches the money: the same string gives the same amount on the server and in the app.

const RATE_RE = /^\d{1,9}(\.\d{1,12})?$/;
const MIN_RATE = 1e-7;
const MAX_RATE = 1e7;

interface Fraction {
  num: bigint;
  den: bigint;
}

/** Normalises user input ("34,5", " 0.0295 ") to a canonical decimal string, or null if it is not a sane rate. */
export function normalizeRate(input: string): string | null {
  const s = input.replace(/[\s ]/g, '').replace(',', '.');
  if (!RATE_RE.test(s)) return null;
  const v = Number(s);
  if (!(v >= MIN_RATE && v <= MAX_RATE)) return null;
  const [int, frac = ''] = s.split('.');
  const f = frac.replace(/0+$/, '');
  return f ? `${int.replace(/^0+(?=\d)/, '')}.${f}` : int.replace(/^0+(?=\d)/, '');
}

/** Formats a number as a rate string with ~6 significant digits (for rates fetched from a source). */
export function formatRate(value: number): string {
  if (!(value > 0) || !Number.isFinite(value)) return '0';
  const decimals = Math.min(12, Math.max(0, 5 - Math.floor(Math.log10(value))));
  return value.toFixed(decimals).replace(/\.?0+$/, '') || '0';
}

/** Group-currency minor units per one original minor unit, as an exact fraction. */
function rateFraction(rate: string, originalCurrency: string, groupCurrency: string): Fraction {
  const r = normalizeRate(rate);
  if (!r) throw new SplitError('errors.rate.invalid');
  const [int, frac = ''] = r.split('.');
  const num = BigInt(int + frac) * 10n ** BigInt(minorDigits(groupCurrency));
  const den = 10n ** BigInt(frac.length) * 10n ** BigInt(minorDigits(originalCurrency));
  return { num, den };
}

const divRound = (a: bigint, b: bigint) => (2n * a + b) / (2n * b); // half up, a >= 0

/** amount (group currency, minor units) = round half up of originalAmount × rate. */
export function convertAmount(
  originalAmount: number,
  rate: string,
  originalCurrency: string,
  groupCurrency: string,
): number {
  if (!Number.isInteger(originalAmount) || originalAmount <= 0) throw new SplitError('errors.split.amountPositive');
  const f = rateFraction(rate, originalCurrency, groupCurrency);
  const v = Number(divRound(BigInt(originalAmount) * f.num, f.den));
  if (v < 1) throw new SplitError('errors.rate.tooSmall');
  return v;
}

/**
 * Converts exact per-member amounts entered in the original currency into the group currency so that they
 * sum to exactly convertAmount(sum): everyone is rounded down, leftover units go to the biggest remainders.
 */
export function convertExactShares(
  inputs: SplitInput[],
  rate: string,
  originalCurrency: string,
  groupCurrency: string,
): SplitInput[] {
  const f = rateFraction(rate, originalCurrency, groupCurrency);
  const total = inputs.reduce((a, i) => a + i.value, 0);
  const target = convertAmount(total, rate, originalCurrency, groupCurrency);
  const parts = inputs.map((i, idx) => {
    const n = BigInt(i.value) * f.num;
    return { i, idx, base: n / f.den, rem: n % f.den };
  });
  let leftover = target - parts.reduce((a, p) => a + Number(p.base), 0);
  const order = parts
    .filter((p) => p.rem > 0n)
    .sort((a, b) => (a.rem === b.rem ? a.idx - b.idx : a.rem > b.rem ? -1 : 1));
  for (let k = 0; leftover > 0 && order.length > 0; k = (k + 1) % order.length, leftover--) order[k].base += 1n;
  return parts.map((p) => ({ memberId: p.i.memberId, value: Number(p.base) }));
}
