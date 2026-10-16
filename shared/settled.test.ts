import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settledTransition } from './settled.ts';

const g = (...b: number[]) => ({ meId: 1, members: b.map((balance, i) => ({ id: i + 1, balance })) });

test('вся группа в расчёте', () => {
  assert.equal(settledTransition(g(5000, -5000), g(0, 0)), 'group');
});

test('в расчёте только я', () => {
  assert.equal(settledTransition(g(5000, -2000, -3000), g(0, -2000, 2000)), 'me');
});

test('уже нулевая группа и повторный ноль — без праздника', () => {
  assert.equal(settledTransition(g(0, 0), g(0, 0)), null);
  assert.equal(settledTransition(g(0, 500, -500), g(0, 300, -300)), null);
});

test('долги остались — без праздника', () => {
  assert.equal(settledTransition(g(5000, -5000), g(2000, -2000)), null);
  assert.equal(settledTransition(undefined, g(0, 0)), null);
});

test('баланс стал ненулевым — без праздника', () => {
  assert.equal(settledTransition(g(0, 0), g(100, -100)), null);
});
