// Pure money logic shared by the server and the Mini App.
// All amounts are integers in minor units (kopecks, cents).
import { type Lang, locale, type Params } from './i18n/index.ts';

export type SplitMode = 'equal' | 'shares' | 'exact';

export interface SplitInput {
  memberId: number;
  /** equal: ignored (presence = participates); shares: weight; exact: amount in minor units */
  value: number;
}

type SplitKey =
  | 'errors.split.amountPositive'
  | 'errors.split.noParticipants'
  | 'errors.split.duplicateParticipant'
  | 'errors.split.badParticipantAmount'
  | 'errors.split.sumMismatch'
  | 'errors.split.sharesInteger'
  | 'errors.split.sharesMissing';

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
