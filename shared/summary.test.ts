import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupSummary, type SummaryExpense, type SummaryInput, summaryShareText } from './summary.ts';

const members = [
  { id: 1, name: 'Аня' },
  { id: 2, name: 'Борис' },
  { id: 3, name: 'Вера' },
];
let nextId = 1;
const exp = (
  payerId: number,
  amount: number,
  category: string | null,
  spentOn = '2026-06-10',
  over: Partial<SummaryExpense> = {},
): SummaryExpense => ({
  id: nextId++,
  kind: 'expense',
  amount,
  payerId,
  spentOn,
  category,
  shares: members.map((m, i) => ({ memberId: m.id, amount: Math.floor(amount / 3) + (i === 0 ? amount % 3 : 0) })),
  ...over,
});

test('empty group', () => {
  const s = groupSummary({ members, expenses: [] });
  assert.equal(s.total, 0);
  assert.equal(s.count, 0);
  assert.equal(s.topCategory, null);
  assert.equal(s.topDay, null);
  assert.equal(s.biggest, null);
  assert.equal(s.firstDay, null);
  assert.ok(s.members.every((m) => m.title === null && m.paid === 0));
});

test('totals, paid, consumed, period, top day, top category, biggest', () => {
  const expenses = [
    exp(1, 3000, 'food', '2026-06-10'),
    exp(1, 6000, 'food', '2026-06-12'),
    exp(2, 1500, 'transport', '2026-06-12'),
    exp(3, 900, 'fun', '2026-06-14'),
  ];
  const s = groupSummary({ members, expenses });
  assert.equal(s.total, 11400);
  assert.equal(s.count, 4);
  assert.equal(s.firstDay, '2026-06-10');
  assert.equal(s.lastDay, '2026-06-14');
  assert.deepEqual(s.topCategory, { category: 'food', amount: 9000 });
  assert.deepEqual(s.topDay, { day: '2026-06-12', amount: 7500 });
  assert.equal(s.biggest?.amount, 6000);
  assert.equal(s.biggest?.payerId, 1);
  const byId = (id: number) => s.members.find((m) => m.id === id);
  assert.equal(byId(1)?.paid, 9000);
  assert.equal(byId(2)?.paid, 1500);
  assert.equal(
    s.members.reduce((a, m) => a + m.consumed, 0),
    11400,
  );
  assert.equal(s.members[0].id, 1); // sorted by paid
});

test('titles: sponsor, category, one per member, localized', () => {
  const expenses = [
    exp(1, 5000, 'food'),
    exp(1, 5000, 'food'),
    exp(1, 2000, 'transport'),
    exp(2, 1000, 'transport'),
    exp(2, 1000, 'transport'),
    exp(3, 500, 'fun'),
  ];
  const ru = groupSummary({ members, expenses }, 'ru');
  const en = groupSummary({ members, expenses }, 'en');
  const title = (s: typeof ru, id: number) => s.members.find((m) => m.id === id)?.title;
  assert.equal(title(ru, 1)?.id, 'sponsor');
  assert.equal(title(ru, 1)?.label, 'Спонсор');
  assert.equal(title(en, 1)?.label, 'Sponsor');
  // Аня уже Спонсор, поэтому «Гурман» ей не достаётся, других едоков нет
  assert.equal(title(ru, 2)?.id, 'transport');
  assert.equal(title(ru, 3), null); // одна трата в категории — ниже порога
  const ids = ru.members.map((m) => m.title?.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
});

test('titles need a threshold: few expenses or one member', () => {
  const two = groupSummary({ members, expenses: [exp(1, 5000, 'food'), exp(2, 100, 'food')] });
  assert.ok(two.members.every((m) => m.title === null));
  const solo = groupSummary({
    members: [members[0]],
    expenses: [exp(1, 100, 'food'), exp(1, 100, 'food'), exp(1, 100, 'food')],
  });
  assert.equal(solo.members[0].title, null);
  assert.equal(solo.total, 300);
});

test('generous: one outstanding payment', () => {
  const expenses = [exp(1, 1000, 'other'), exp(2, 1000, 'other'), exp(3, 20000, 'housing', '2026-06-11')];
  const s = groupSummary({ members, expenses });
  assert.equal(s.members.find((m) => m.id === 3)?.title?.id, 'generous'); // одна крупная трата — не «Спонсор», но «щедрый»
  const flat = groupSummary({ members, expenses: [exp(1, 1000, null), exp(2, 1000, null), exp(3, 1100, null)] });
  assert.ok(flat.members.every((m) => m.title?.id !== 'generous'));
});

test('ties are deterministic (lower id wins)', () => {
  const expenses = [exp(2, 1000, 'food'), exp(2, 1000, 'food'), exp(1, 1000, 'food'), exp(1, 1000, 'food')];
  const s = groupSummary({ members, expenses });
  assert.equal(s.members.find((m) => m.title?.id === 'sponsor')?.id, 1);
  assert.equal(s.members.find((m) => m.title?.id === 'food')?.id, 2);
  assert.equal(s.biggest?.id, expenses[0].id);
  const again = groupSummary({ members, expenses: [...expenses].reverse() });
  assert.equal(again.members.find((m) => m.title?.id === 'sponsor')?.id, 1);
});

test('transfers are ignored', () => {
  const transfer = exp(1, 99999, null, '2026-07-01', { kind: 'transfer', shares: [{ memberId: 2, amount: 99999 }] });
  const s = groupSummary({ members, expenses: [transfer, exp(2, 300, 'food')] });
  assert.equal(s.total, 300);
  assert.equal(s.count, 1);
  assert.equal(s.lastDay, '2026-06-10');
  assert.equal(s.members.find((m) => m.id === 1)?.paid, 0);
});

test('foreign-currency expense counts by its group-currency amount', () => {
  const e = { ...exp(1, 4500, 'food'), originalAmount: 50, originalCurrency: 'USD' };
  const s = groupSummary({ members, expenses: [e] });
  assert.equal(s.total, 4500);
});

test('unknown category falls back to other; unknown payer gets no titles', () => {
  const s = groupSummary({ members, expenses: [exp(1, 100, 'weird')] });
  assert.equal(s.topCategory?.category, 'other');
  const ghost = groupSummary({
    members,
    expenses: [exp(99, 100, 'food'), exp(99, 100, 'food'), exp(99, 100, 'food')],
  });
  assert.ok(ghost.members.every((m) => m.title === null));
});

test('share text: ru and en, no debts', () => {
  const input: SummaryInput = {
    members,
    expenses: [
      exp(1, 500000, 'food', '2026-06-10'),
      exp(1, 100000, 'food', '2026-06-12'),
      exp(2, 100000, 'fun', '2026-06-12'),
    ],
  };
  const ru = summaryShareText('Грузия', 'RUB', groupSummary(input, 'ru'), 'ru');
  assert.match(ru, /^🏆 Итоги «Грузия»/);
  assert.match(ru, /Потрачено .*7\s?000/);
  assert.match(ru, /3 траты/);
  assert.match(ru, /🍽 Топ-категория/);
  assert.match(ru, /👑 Аня — Спонсор/);
  assert.doesNotMatch(ru, /долж/i);
  const en = summaryShareText('Trip', 'RUB', groupSummary(input, 'en'), 'en');
  assert.match(en, /^🏆 Summary of “Trip”/);
  assert.match(en, /3 expenses/);
  assert.match(en, /👑 Аня — Sponsor/);
  const empty = summaryShareText('X', 'RUB', groupSummary({ members, expenses: [] }), 'ru');
  assert.match(empty, /Потрачено/);
});
