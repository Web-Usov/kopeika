// Exchange rates for foreign-currency expenses. Source: daily rates of the Bank of Russia (cbr-xml-daily.ru),
// which are RUB-based, so any other pair goes through the rouble. Rates are cached per (date, currency) in SQLite.
import { CURRENCIES, formatRate } from '../../shared/money.ts';
import { all, run, tx } from './db.ts';

const BASE_URL = 'https://www.cbr-xml-daily.ru';
const FETCH_TIMEOUT_MS = 5000;
/** How many days back to look when the source has no rates for a day (weekends, holidays). */
const MAX_FALLBACK_DAYS = 7;
const TODAY_TTL_MS = 30 * 60 * 1000;
/** Upper bound for the in-memory "today" tables (one per requested date, future dates included). */
const TODAY_MEMO_MAX = 50;

/** Carries a dictionary key: the API turns it into a translated message. */
export class RatesError extends Error {
  constructor(
    readonly status: 404 | 503,
    readonly key: 'errors.rate.unavailable' | 'errors.rate.notFound',
  ) {
    super(key);
  }
}

export type RatesFetcher = (url: string) => Promise<{ status: number; json(): Promise<unknown> }>;

const defaultFetcher: RatesFetcher = (url) => fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

let fetcher: RatesFetcher = defaultFetcher;
let todayFn = () => new Date().toISOString().slice(0, 10);

/** Tests only: replace the network and the clock; call without arguments to restore. */
export function setRatesTestHooks(hooks: { fetcher?: RatesFetcher; today?: () => string } = {}) {
  fetcher = hooks.fetcher ?? defaultFetcher;
  todayFn = hooks.today ?? (() => new Date().toISOString().slice(0, 10));
  todayMemo.clear();
}

interface Day {
  /** The day the source actually has rates for. */
  sourceDate: string;
  /** currency → RUB per 1 unit, decimal string */
  rub: Map<string, string>;
}

const shiftDay = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function parseDay(json: unknown, fallbackDate: string): Day | null {
  const j = json as { Date?: unknown; Valute?: Record<string, { Nominal?: unknown; Value?: unknown }> } | null;
  if (!j || typeof j !== 'object' || !j.Valute || typeof j.Valute !== 'object') return null;
  const rub = new Map<string, string>();
  for (const cur of CURRENCIES) {
    const v = j.Valute[cur];
    const nominal = Number(v?.Nominal);
    const value = Number(v?.Value);
    if (nominal > 0 && value > 0) rub.set(cur, formatRate(value / nominal));
  }
  const sourceDate =
    typeof j.Date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(j.Date) ? j.Date.slice(0, 10) : fallbackDate;
  return { sourceDate, rub };
}

/** Looks for the rates of `date`, walking back through days without a published table. */
async function fetchDay(date: string, today: string): Promise<Day> {
  for (let back = 0; back <= MAX_FALLBACK_DAYS; back++) {
    const d = shiftDay(date, -back);
    const url =
      d >= today ? `${BASE_URL}/daily_json.js` : `${BASE_URL}/archive/${d.replaceAll('-', '/')}/daily_json.js`;
    let res: Awaited<ReturnType<RatesFetcher>>;
    try {
      res = await fetcher(url);
    } catch {
      throw new RatesError(503, 'errors.rate.unavailable');
    }
    if (res.status === 404) continue;
    if (res.status !== 200) throw new RatesError(503, 'errors.rate.unavailable');
    const day = await res.json().then(
      (j) => parseDay(j, d),
      () => null,
    );
    if (!day) throw new RatesError(503, 'errors.rate.unavailable');
    return day;
  }
  throw new RatesError(404, 'errors.rate.notFound');
}

// Today's table can still change during the day, so it lives in memory for a while instead of the database.
const todayMemo = new Map<string, { at: number; day: Day }>();

/** Stores a table and keeps the memo bounded: expired entries go first, then the oldest ones. */
function memoize(date: string, day: Day) {
  const now = Date.now();
  todayMemo.delete(date);
  if (todayMemo.size >= TODAY_MEMO_MAX) {
    for (const [k, v] of todayMemo) if (now - v.at >= TODAY_TTL_MS) todayMemo.delete(k);
  }
  // Map keeps insertion order, and entries are re-inserted on every refresh, so the first key is the oldest.
  while (todayMemo.size >= TODAY_MEMO_MAX) todayMemo.delete(todayMemo.keys().next().value as string);
  todayMemo.set(date, { at: now, day });
}

/** Tests only: current number of memoized "today" tables. */
export const todayMemoSize = () => todayMemo.size;

async function rubPerUnit(currency: string, date: string): Promise<{ value: string; sourceDate: string }> {
  if (currency === 'RUB') return { value: '1', sourceDate: date };
  const today = todayFn();
  const isToday = date >= today;
  if (!isToday) {
    const cached = all<{ rub_per_unit: string; source_date: string }>(
      'SELECT rub_per_unit, source_date FROM rates WHERE date = ? AND currency = ?',
      date,
      currency,
    )[0];
    if (cached) return { value: cached.rub_per_unit, sourceDate: cached.source_date };
  }
  let day: Day | undefined;
  const memo = todayMemo.get(date);
  if (isToday && memo && Date.now() - memo.at < TODAY_TTL_MS) day = memo.day;
  if (!day) {
    day = await fetchDay(date, today);
    if (isToday) memoize(date, day);
    else {
      const stored = day;
      tx(() => {
        for (const [cur, v] of stored.rub)
          run(
            'INSERT OR REPLACE INTO rates (date, currency, rub_per_unit, source_date) VALUES (?, ?, ?, ?)',
            date,
            cur,
            v,
            stored.sourceDate,
          );
      });
    }
  }
  const value = day.rub.get(currency);
  if (!value) throw new RatesError(404, 'errors.rate.notFound');
  return { value, sourceDate: day.sourceDate };
}

export interface RateResult {
  /** Group-currency units per 1 unit of `currency`, decimal string. */
  rate: string;
  source: 'cbr';
  /** The day the rate is actually from (earlier than asked on weekends and holidays). */
  date: string;
}

/** Rate of `currency` in `base` on `date` (YYYY-MM-DD), via the rouble. */
export async function getRate(base: string, currency: string, date: string): Promise<RateResult> {
  const [from, to] = await Promise.all([rubPerUnit(currency, date), rubPerUnit(base, date)]);
  const rate = base === 'RUB' ? from.value : formatRate(Number(from.value) / Number(to.value));
  return { rate, source: 'cbr', date: currency === 'RUB' ? to.sourceDate : from.sourceDate };
}
