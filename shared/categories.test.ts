import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATEGORIES, categoryTotals, suggestCategory } from './categories.ts';
import { dictionaries } from './i18n/index.ts';

test('suggestCategory: Russian titles', () => {
  assert.equal(suggestCategory('Такси до аэропорта', 'ru'), 'transport');
  assert.equal(suggestCategory('Ужин в кафе', 'ru'), 'food');
  assert.equal(suggestCategory('Продукты', 'ru'), 'groceries');
  assert.equal(suggestCategory('Отель', 'ru'), 'housing');
  assert.equal(suggestCategory('Квартира на неделю', 'ru'), 'housing');
  assert.equal(suggestCategory('Кино', 'ru'), 'fun');
  assert.equal(suggestCategory('Сувениры', 'ru'), 'shopping');
});

test('suggestCategory: English titles', () => {
  assert.equal(suggestCategory('Uber to airport', 'en'), 'transport');
  assert.equal(suggestCategory('Dinner', 'en'), 'food');
  assert.equal(suggestCategory('Groceries', 'en'), 'groceries');
  assert.equal(suggestCategory('Airbnb', 'en'), 'housing');
  assert.equal(suggestCategory('Museum', 'en'), 'fun');
});

test('suggestCategory: no match, empty, whole-word keywords, other language fallback', () => {
  assert.equal(suggestCategory('', 'ru'), null);
  assert.equal(suggestCategory('Что-то непонятное', 'ru'), null);
  assert.equal(suggestCategory('Барсук', 'ru'), null);
  assert.equal(suggestCategory('Бар', 'ru'), 'fun');
  assert.equal(suggestCategory('Taxi', 'ru'), 'transport');
  assert.equal(suggestCategory('Такси', 'en'), 'transport');
});

test('every category has a name in both dictionaries', () => {
  for (const c of CATEGORIES) {
    assert.ok(dictionaries.ru.category[c.id]);
    assert.ok(dictionaries.en.category[c.id]);
  }
});

test('categoryTotals: group and personal totals, transfers ignored, sorted', () => {
  const sh = (...pairs: [number, number][]) => pairs.map(([memberId, amount]) => ({ memberId, amount }));
  const expenses = [
    { kind: 'expense' as const, category: 'food', amount: 1000, shares: sh([1, 334], [2, 333], [3, 333]) },
    { kind: 'expense' as const, category: 'transport', amount: 3000, shares: sh([2, 3000]) },
    { kind: 'expense' as const, category: 'food', amount: 500, shares: sh([1, 250], [2, 250]) },
    { kind: 'transfer' as const, category: 'other', amount: 9999, shares: sh([1, 9999]) },
    { kind: 'expense' as const, category: 'bogus', amount: 100, shares: sh([1, 100]) },
  ];
  assert.deepEqual(categoryTotals(expenses, 1), {
    group: [
      { category: 'transport', amount: 3000 },
      { category: 'food', amount: 1500 },
      { category: 'other', amount: 100 },
    ],
    mine: [
      { category: 'food', amount: 584 },
      { category: 'other', amount: 100 },
    ],
  });
  assert.deepEqual(categoryTotals([], 1), { group: [], mine: [] });
});
