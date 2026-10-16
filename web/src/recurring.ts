import { addDays, type Period } from '../../shared/recurring.ts';
import { dateLocale, t } from './i18n.ts';

/** 2024-01-01 was a Monday: a handy anchor to name an ISO weekday in the user's language. */
const weekdayName = (isoWeekday: number) =>
  new Intl.DateTimeFormat(dateLocale, { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${addDays('2024-01-01', isoWeekday - 1)}T00:00:00Z`),
  );

/** "каждый месяц, 5-го числа" / "every week on Monday". */
export function scheduleText(period: Period, day: number): string {
  if (period === 'weekly') return t('recurring.weeklyOn', { weekday: weekdayName(day) });
  return day === 31 ? t('recurring.monthlyLast') : t('recurring.monthlyOn', { day });
}

/** "5 февраля" (with the year if it is not the current one). */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(dateLocale, {
    day: 'numeric',
    month: 'long',
    ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  }).format(new Date(y, m - 1, d));
}
