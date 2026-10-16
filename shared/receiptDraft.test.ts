import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adjustForKind,
  base64Length,
  draftTotals,
  fitSize,
  isLineValid,
  parseSignedAmount,
  photoFits,
  signedToInput,
} from './receiptDraft.ts';

test('signed amounts: parse and print', () => {
  assert.equal(parseSignedAmount('12,5'), 1250);
  assert.equal(parseSignedAmount('-3'), -300);
  assert.equal(parseSignedAmount('−0,50'), -50);
  assert.equal(parseSignedAmount('abc'), null);
  assert.equal(parseSignedAmount('-'), null);
  assert.equal(signedToInput(-50), '-0,5');
  assert.equal(signedToInput(1250), '12,5');
  assert.equal(signedToInput(300), '3');
  for (const v of [-12345, -1, 0, 7, 999999]) assert.equal(parseSignedAmount(signedToInput(v)), v);
});

test('totals: sum of lines and adjustments against the printed total', () => {
  assert.deepEqual(draftTotals([1000, 2000], [300, -100], 3200), { items: 3000, adjustments: 200, sum: 3200, diff: 0 });
  assert.equal(draftTotals([1000], [], 1500).diff, -500);
  assert.equal(draftTotals([1000], [], null).diff, null);
  assert.equal(draftTotals([], [], null).sum, 0);
});

test('a line needs a name and a non-zero amount', () => {
  assert.equal(isLineValid('Хинкали', '12'), true);
  assert.equal(isLineValid('  ', '12'), false);
  assert.equal(isLineValid('Хинкали', ''), false);
  assert.equal(isLineValid('Хинкали', '0'), false);
  assert.equal(isLineValid('Скидка', '-5'), true);
});

test('adjustment sign follows its kind', () => {
  assert.equal(adjustForKind('discount', 500), -500);
  assert.equal(adjustForKind('discount', -500), -500);
  assert.equal(adjustForKind('tip', -500), 500);
  assert.equal(adjustForKind('rounding', -5), -5);
});

test('photo is scaled down to the longest side, never up', () => {
  assert.deepEqual(fitSize(4000, 3000), { width: 2000, height: 1500 });
  assert.deepEqual(fitSize(3000, 4000), { width: 1500, height: 2000 });
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitSize(10000, 1), { width: 2000, height: 1 });
});

test('photo size guard counts base64 inflation', () => {
  assert.equal(base64Length(3), 4);
  assert.equal(base64Length(4), 8);
  assert.equal(photoFits(2_000_000), true);
  assert.equal(photoFits(2_400_000), false);
});
