import assert from 'node:assert/strict';
import { test } from 'node:test';
import { balanceText, helpText, privateBalanceText } from './chatText.ts';

const base = { groupName: 'Дача <3', currency: 'RUB', totalSpent: 1_500_000 };

test('balanceText ru: sorted balances, settlements, escaping', () => {
  const text = balanceText('ru', {
    ...base,
    members: [
      { name: 'Аня', balance: -5000 },
      { name: 'Боб', balance: 5000 },
      { name: 'Вика', balance: 0 },
    ],
    settlements: [{ from: 'Аня', to: 'Боб', amount: 5000 }],
  });
  assert.match(text, /<b>Дача &lt;3<\/b>/);
  assert.match(text, /Всего потрачено: .*15/);
  assert.ok(text.indexOf('Боб:') < text.indexOf('Аня:'));
  assert.doesNotMatch(text, /Вика/);
  assert.match(text, /Как рассчитаться/);
  assert.match(text, /Аня → Боб: .*50/);
});

test('balanceText en and all settled', () => {
  const text = balanceText('en', { ...base, members: [{ name: 'A', balance: 0 }], settlements: [] });
  assert.match(text, /Total spent/);
  assert.match(text, /All settled up/);
  assert.doesNotMatch(text, /How to settle/);
  assert.match(balanceText('ru', { ...base, members: [], settlements: [] }), /Все в расчёте/);
});

test('balanceText truncates long lists', () => {
  const members = Array.from({ length: 20 }, (_, i) => ({ name: `M${i}`, balance: i % 2 ? 100 + i : -100 - i }));
  const settlements = members.map((m) => ({ from: m.name, to: 'X', amount: 100 }));
  const ru = balanceText('ru', { ...base, members, settlements });
  assert.equal(ru.split('и ещё 5').length - 1, 2);
  assert.match(balanceText('en', { ...base, members, settlements }), /and 5 more/);
});

test('privateBalanceText', () => {
  assert.match(privateBalanceText('ru', []), /нет групп/);
  assert.match(privateBalanceText('en', []), /any groups/);
  const groups = Array.from({ length: 12 }, (_, i) => ({
    name: `G${i}`,
    currency: 'RUB',
    myBalance: i === 0 ? 0 : -100,
  }));
  const text = privateBalanceText('ru', groups);
  assert.match(text, /G0: в расчёте/);
  assert.match(text, /G1: -/);
  assert.doesNotMatch(text, /G10/);
  assert.match(text, /и ещё 2/);
});

test('helpText differs for private and group, both languages', () => {
  for (const lang of ['ru', 'en'] as const) {
    assert.notEqual(helpText(lang, true), helpText(lang, false));
    assert.match(helpText(lang, true), /\/unlink/);
    assert.match(helpText(lang, false), /\/balance/);
  }
});
