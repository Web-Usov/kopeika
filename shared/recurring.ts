// Schedules of recurring expenses. Pure date arithmetic on "YYYY-MM-DD" strings (calendar days, no time zones).

export type Period = 'monthly' | 'weekly';

/** At most this many missed occurrences are created after a long downtime; older ones are skipped. */
export const MAX_CATCH_UP = 3;

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const daysInMonth = (year: number, month0: number) => new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();

export function addDays(iso: string, n: number): string {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(iso: string): number {
  return ((parse(iso).getUTCDay() + 6) % 7) + 1;
}

/** Day of the month (1-31) for monthly, ISO weekday (1-7) for weekly. */
export function isValidDay(period: Period, day: number): boolean {
  return Number.isInteger(day) && day >= 1 && day <= (period === 'monthly' ? 31 : 7);
}

/** The first date on or after `from` that fits the schedule. A day beyond the end of a month means its last day. */
export function firstOccurrence(period: Period, day: number, from: string): string {
  if (period === 'weekly') return addDays(from, (day - isoWeekday(from) + 7) % 7);
  const [y, m] = from.split('-').map(Number);
  const inMonth = (year: number, month0: number) =>
    `${year}-${pad(month0 + 1)}-${pad(Math.min(day, daysInMonth(year, month0)))}`;
  const candidate = inMonth(y, m - 1);
  if (candidate >= from) return candidate;
  return m === 12 ? inMonth(y + 1, 0) : inMonth(y, m);
}

/** The first date strictly after `after` that fits the schedule. */
export function nextOccurrence(period: Period, day: number, after: string): string {
  return firstOccurrence(period, day, addDays(after, 1));
}

export interface DueResult {
  /** Dates to create expenses for, oldest first (at most `limit`, the most recent ones). */
  due: string[];
  /** How many older missed occurrences were dropped because of the limit. */
  skipped: number;
  /** The new value of next_date: the first occurrence after `today`. */
  next: string;
}

/** Which occurrences have come: from the template's next_date up to and including `today`. */
export function dueDates(
  template: { period: Period; day: number; nextDate: string },
  today: string,
  limit = MAX_CATCH_UP,
): DueResult {
  const all: string[] = [];
  let d = template.nextDate;
  while (d <= today && all.length < 100_000) {
    all.push(d);
    d = nextOccurrence(template.period, template.day, d);
  }
  return { due: all.slice(-limit), skipped: Math.max(0, all.length - limit), next: d };
}
