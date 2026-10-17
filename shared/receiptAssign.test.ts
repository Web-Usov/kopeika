import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertExactShares, SplitError } from './money.ts';
import { type AssignItem, assignShares, splitIntoUnits, toReceiptAdjustments, wholeQuantity } from './receiptAssign.ts';
import type { DraftAdjustmentKind } from './receiptDraft.ts';

const sum = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);
const item = (id: string, amount: number, memberIds: number[]): AssignItem => ({ id, name: id, amount, memberIds });
const adj = (id: string, kind: DraftAdjustmentKind, amount: number) => ({ id, kind, label: '', amount });

test('signed adjustments map to kinds', () => {
  assert.deepEqual(
    toReceiptAdjustments([
      adj('a', 'service', 100),
      adj('b', 'tax', 50),
      adj('c', 'rounding', -3),
      adj('d', 'rounding', 2),
      adj('e', 'discount', -200),
      adj('f', 'tip', 0),
      adj('g', 'other', -10),
    ]),
    [
      { kind: 'service', amount: 100, mode: 'proportional' },
      { kind: 'other', amount: 50, mode: 'proportional' },
      { kind: 'discount', amount: 3, mode: 'proportional' },
      { kind: 'other', amount: 2, mode: 'proportional' },
      { kind: 'discount', amount: 200, mode: 'proportional' },
      { kind: 'discount', amount: 10, mode: 'proportional' },
    ],
  );
});

test('mode per adjustment is respected', () => {
  assert.equal(toReceiptAdjustments([adj('a', 'tip', 10)], { a: 'equal' })[0].mode, 'equal');
});

test('shares add up to items + signed adjustments (tax, rounding, discount)', () => {
  const items = [item('x', 1000, [1, 2]), item('y', 501, [2])];
  const adjustments = [adj('a', 'tax', 151), adj('b', 'rounding', -2), adj('c', 'discount', -100)];
  assert.equal(sum(assignShares(items, adjustments)), 1000 + 501 + 151 - 2 - 100);
});

test('equal-mode tip splits evenly regardless of items', () => {
  const s = assignShares([item('x', 1000, [1]), item('y', 100, [2])], [adj('a', 'tip', 100)], { a: 'equal' });
  assert.deepEqual(Object.fromEntries(s), { 1: 1050, 2: 150 });
});

test('unassigned item and oversized discount throw', () => {
  assert.throws(() => assignShares([item('x', 100, [])], []), SplitError);
  assert.throws(() => assignShares([item('x', 100, [1])], [adj('d', 'discount', -500)]), SplitError);
});

test('quantity helper', () => {
  assert.equal(wholeQuantity('3'), 3);
  assert.equal(wholeQuantity('2.0'), 2);
  assert.equal(wholeQuantity('1'), null);
  assert.equal(wholeQuantity('1.5'), null);
  assert.equal(wholeQuantity(undefined), null);
});

test('splitIntoUnits keeps the sum and unassigns', () => {
  const parts = splitIntoUnits(item('i1', 1000, [1]), 3);
  assert.deepEqual(
    parts.map((p) => p.amount),
    [334, 333, 333],
  );
  assert.equal(
    parts.reduce((a, p) => a + p.amount, 0),
    1000,
  );
  assert.ok(parts.every((p) => p.memberIds.length === 0));
  assert.equal(new Set(parts.map((p) => p.id)).size, 3);
});

test('foreign currency: exact shares convert to exactly the converted total', () => {
  const shares = assignShares([item('x', 3333, [1, 2, 3]), item('y', 1001, [1])], [adj('t', 'tip', 433)]);
  const inputs = [...shares].map(([memberId, value]) => ({ memberId, value }));
  const total = sum(shares);
  const converted = convertExactShares(inputs, '0.37', 'GEL', 'USD');
  const convertedTotal = converted.reduce((a, i) => a + i.value, 0);
  // the server converts the total the same way: round(total * rate)
  assert.equal(convertedTotal, Math.round(total * 0.37));
});
