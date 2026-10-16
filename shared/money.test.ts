import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeShares, computeBalances, settleUp, parseAmount, amountToInput, SplitError } from './money.ts';

const sum = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);

test('equal split hands leftover kopecks to the first members', () => {
  const s = computeShares(10000, 'equal', [{ memberId: 1, value: 0 }, { memberId: 2, value: 0 }, { memberId: 3, value: 0 }]);
  assert.deepEqual([...s.values()], [3334, 3333, 3333]);
  assert.equal(sum(s), 10000);
});

test('shares split is proportional and sums exactly', () => {
  const s = computeShares(1001, 'shares', [{ memberId: 1, value: 2 }, { memberId: 2, value: 1 }, { memberId: 3, value: 0 }]);
  assert.equal(s.get(3), 0);
  assert.equal(sum(s), 1001);
  assert.equal(s.get(1), 667);
  assert.equal(s.get(2), 334);
});

test('exact split must match the total', () => {
  assert.throws(() => computeShares(1000, 'exact', [{ memberId: 1, value: 500 }, { memberId: 2, value: 400 }]), SplitError);
  const s = computeShares(1000, 'exact', [{ memberId: 1, value: 600 }, { memberId: 2, value: 400 }]);
  assert.equal(s.get(1), 600);
});

test('rejects empty and zero-weight splits', () => {
  assert.throws(() => computeShares(1000, 'equal', []), SplitError);
  assert.throws(() => computeShares(1000, 'shares', [{ memberId: 1, value: 0 }]), SplitError);
  assert.throws(() => computeShares(0, 'equal', [{ memberId: 1, value: 0 }]), SplitError);
});

test('balances and settle-up zero everyone out', () => {
  // A paid 300 for A,B,C; B paid 90 for B,C.
  const bal = computeBalances([1, 2, 3], [
    { payerId: 1, amount: 300, shares: [{ memberId: 1, amount: 100 }, { memberId: 2, amount: 100 }, { memberId: 3, amount: 100 }] },
    { payerId: 2, amount: 90, shares: [{ memberId: 2, amount: 45 }, { memberId: 3, amount: 45 }] },
  ]);
  assert.deepEqual(Object.fromEntries(bal), { 1: 200, 2: -55, 3: -145 });
  const plan = settleUp(bal);
  assert.deepEqual(plan, [{ from: 3, to: 1, amount: 145 }, { from: 2, to: 1, amount: 55 }]);

  // Recording the transfers as ledger entries brings everyone to zero.
  const after = computeBalances([1, 2, 3], [
    { payerId: 1, amount: 300, shares: [{ memberId: 1, amount: 100 }, { memberId: 2, amount: 100 }, { memberId: 3, amount: 100 }] },
    { payerId: 2, amount: 90, shares: [{ memberId: 2, amount: 45 }, { memberId: 3, amount: 45 }] },
    ...plan.map((p) => ({ payerId: p.from, amount: p.amount, shares: [{ memberId: p.to, amount: p.amount }] })),
  ]);
  assert.ok([...after.values()].every((v) => v === 0));
});

test('parseAmount / amountToInput', () => {
  assert.equal(parseAmount('1 234,5'), 123450);
  assert.equal(parseAmount('99.90'), 9990);
  assert.equal(parseAmount('12'), 1200);
  assert.equal(parseAmount('1,234'), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(amountToInput(123450), '1234,5');
  assert.equal(amountToInput(9905), '99,05');
  assert.equal(amountToInput(1200), '12');
});
