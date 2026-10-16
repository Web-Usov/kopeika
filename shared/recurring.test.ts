import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dueDates, firstOccurrence, isoWeekday, nextOccurrence } from './recurring.ts';

test('monthly: next month, same day', () => {
  assert.equal(nextOccurrence('monthly', 15, '2025-01-15'), '2025-02-15');
  assert.equal(nextOccurrence('monthly', 15, '2025-01-10'), '2025-01-15');
  assert.equal(nextOccurrence('monthly', 15, '2025-01-20'), '2025-02-15');
});

test('monthly: day 29-31 falls back to the last day of a short month', () => {
  assert.equal(nextOccurrence('monthly', 31, '2025-01-31'), '2025-02-28');
  assert.equal(nextOccurrence('monthly', 31, '2025-02-28'), '2025-03-31');
  assert.equal(nextOccurrence('monthly', 31, '2025-03-31'), '2025-04-30');
  assert.equal(nextOccurrence('monthly', 30, '2025-01-30'), '2025-02-28');
  assert.equal(nextOccurrence('monthly', 29, '2025-01-29'), '2025-02-28');
});

test('monthly: leap years', () => {
  assert.equal(nextOccurrence('monthly', 29, '2024-01-29'), '2024-02-29');
  assert.equal(nextOccurrence('monthly', 31, '2024-01-31'), '2024-02-29');
  assert.equal(nextOccurrence('monthly', 29, '2024-02-29'), '2024-03-29');
  assert.equal(nextOccurrence('monthly', 29, '2023-12-31'), '2024-01-29');
  assert.equal(nextOccurrence('monthly', 29, '2100-01-29'), '2100-02-28'); // 2100 is not a leap year
});

test('monthly: crossing the year', () => {
  assert.equal(nextOccurrence('monthly', 10, '2025-12-10'), '2026-01-10');
  assert.equal(nextOccurrence('monthly', 10, '2025-12-20'), '2026-01-10');
  assert.equal(firstOccurrence('monthly', 31, '2025-12-31'), '2025-12-31');
});

test('weekly', () => {
  assert.equal(isoWeekday('2025-01-06'), 1); // Monday
  assert.equal(isoWeekday('2025-01-12'), 7); // Sunday
  assert.equal(nextOccurrence('weekly', 1, '2025-01-06'), '2025-01-13');
  assert.equal(nextOccurrence('weekly', 3, '2025-01-06'), '2025-01-08');
  assert.equal(nextOccurrence('weekly', 1, '2025-01-12'), '2025-01-13');
  assert.equal(firstOccurrence('weekly', 1, '2025-01-06'), '2025-01-06');
  assert.equal(nextOccurrence('weekly', 1, '2024-12-30'), '2025-01-06');
});

test('dueDates: nothing before next_date, including a start in the future', () => {
  const tpl = { period: 'monthly' as const, day: 15, nextDate: '2025-03-15' };
  assert.deepEqual(dueDates(tpl, '2025-03-14'), { due: [], skipped: 0, next: '2025-03-15' });
});

test('dueDates: exactly one occurrence today', () => {
  const tpl = { period: 'monthly' as const, day: 15, nextDate: '2025-03-15' };
  assert.deepEqual(dueDates(tpl, '2025-03-15'), { due: ['2025-03-15'], skipped: 0, next: '2025-04-15' });
});

test('dueDates: end of month', () => {
  const tpl = { period: 'monthly' as const, day: 31, nextDate: '2025-01-31' };
  assert.deepEqual(dueDates(tpl, '2025-03-31'), {
    due: ['2025-01-31', '2025-02-28', '2025-03-31'],
    skipped: 0,
    next: '2025-04-30',
  });
});

test('dueDates: catch-up is capped, the most recent occurrences are kept', () => {
  const tpl = { period: 'monthly' as const, day: 1, nextDate: '2025-01-01' };
  const r = dueDates(tpl, '2025-06-10');
  assert.deepEqual(r.due, ['2025-04-01', '2025-05-01', '2025-06-01']);
  assert.equal(r.skipped, 3);
  assert.equal(r.next, '2025-07-01');
});

test('dueDates: weekly catch-up and custom limit', () => {
  const tpl = { period: 'weekly' as const, day: 1, nextDate: '2025-01-06' };
  const r = dueDates(tpl, '2025-01-28', 2);
  assert.deepEqual(r.due, ['2025-01-20', '2025-01-27']);
  assert.equal(r.skipped, 2);
  assert.equal(r.next, '2025-02-03');
});
