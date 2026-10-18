import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SplitError } from './money.ts';
import { computeReceiptShares, convertReceiptShares, type ReceiptAdjustment, type ReceiptItem } from './receipt.ts';

const sum = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);
const obj = (m: Map<number, number>) => Object.fromEntries(m);

test('item is split equally between several members', () => {
  const s = computeReceiptShares([{ id: 1, amount: 3000, memberIds: [1, 2, 3] }]);
  assert.deepEqual(obj(s), { 1: 1000, 2: 1000, 3: 1000 });
});

test('leftover rotates with the item index and is repeatable', () => {
  const items: ReceiptItem[] = [
    { id: 'a', amount: 100, memberIds: [1, 2, 3] },
    { id: 'b', amount: 100, memberIds: [1, 2, 3] },
    { id: 'c', amount: 100, memberIds: [1, 2, 3] },
  ];
  const s = computeReceiptShares(items);
  assert.deepEqual(obj(s), { 1: 100, 2: 100, 3: 100 });
  assert.deepEqual(obj(computeReceiptShares(items)), obj(s));
});

test('several items per member are summed', () => {
  const s = computeReceiptShares([
    { id: 1, amount: 1000, memberIds: [1] },
    { id: 2, amount: 500, memberIds: [1, 2] },
    { id: 3, amount: 700, memberIds: [2] },
  ]);
  assert.deepEqual(obj(s), { 1: 1250, 2: 950 });
});

test('service and tip are proportional to subtotals', () => {
  const s = computeReceiptShares(
    [
      { id: 1, amount: 3000, memberIds: [1] },
      { id: 2, amount: 1000, memberIds: [2] },
    ],
    [
      { kind: 'service', amount: 400 },
      { kind: 'tip', amount: 40 },
    ],
  );
  assert.deepEqual(obj(s), { 1: 3330, 2: 1110 });
  assert.equal(sum(s), 4440);
});

test('discount is subtracted proportionally', () => {
  const s = computeReceiptShares(
    [
      { id: 1, amount: 3000, memberIds: [1] },
      { id: 2, amount: 1000, memberIds: [2] },
    ],
    [{ kind: 'discount', amount: 800 }],
  );
  assert.deepEqual(obj(s), { 1: 2400, 2: 800 });
});

test('discount bigger than the items total fails', () => {
  assert.throws(
    () => computeReceiptShares([{ id: 1, amount: 100, memberIds: [1] }], [{ kind: 'discount', amount: 101 }]),
    (e) => e instanceof SplitError && e.key === 'errors.receipt.discountTooBig',
  );
});

test('equal-mode adjustment is split evenly regardless of subtotals', () => {
  const s = computeReceiptShares(
    [
      { id: 1, amount: 3000, memberIds: [1] },
      { id: 2, amount: 1000, memberIds: [2] },
    ],
    [{ kind: 'other', amount: 500, mode: 'equal' }],
  );
  assert.deepEqual(obj(s), { 1: 3250, 2: 1250 });
});

test('equal-mode discount that makes a share negative fails', () => {
  assert.throws(
    () =>
      computeReceiptShares(
        [
          { id: 1, amount: 3000, memberIds: [1] },
          { id: 2, amount: 100, memberIds: [2] },
        ],
        [{ kind: 'discount', amount: 400, mode: 'equal' }],
      ),
    (e) => e instanceof SplitError && e.key === 'errors.receipt.discountTooBig',
  );
});

test('unassigned items are listed in the error', () => {
  assert.throws(
    () =>
      computeReceiptShares([
        { id: 'a', amount: 100, memberIds: [1] },
        { id: 'b', amount: 100, memberIds: [] },
        { id: 'c', amount: 100, memberIds: [] },
      ]),
    (e) => e instanceof SplitError && e.key === 'errors.receipt.unassigned' && e.params?.ids === 'b, c',
  );
});

test('zero-amount items are allowed', () => {
  const s = computeReceiptShares(
    [
      { id: 1, amount: 0, memberIds: [1, 2] },
      { id: 2, amount: 500, memberIds: [2] },
    ],
    [{ kind: 'tip', amount: 50 }],
  );
  assert.deepEqual(obj(s), { 1: 0, 2: 550 });
});

test('all-zero subtotals fall back to an equal adjustment', () => {
  const s = computeReceiptShares([{ id: 1, amount: 0, memberIds: [1, 2] }], [{ kind: 'service', amount: 101 }]);
  assert.equal(sum(s), 101);
});

test('receipt total mismatch is rejected', () => {
  const items = [{ id: 1, amount: 1000, memberIds: [1] }];
  assert.equal(sum(computeReceiptShares(items, [{ kind: 'tip', amount: 100 }], 1100)), 1100);
  assert.throws(() => computeReceiptShares(items, [], 999), SplitError);
});

test('property: shares sum to the total and are never negative', () => {
  let seed = 123456789;
  const rnd = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let run = 0; run < 500; run++) {
    const people = 1 + rnd(6);
    const items: ReceiptItem[] = [];
    const nItems = 1 + rnd(12);
    for (let i = 0; i < nItems; i++) {
      const memberIds = Array.from({ length: people }, (_, k) => k + 1).filter(() => rnd(2) === 0);
      if (memberIds.length === 0) memberIds.push(1 + rnd(people));
      items.push({ id: i, amount: rnd(4) === 0 ? 0 : rnd(10_000_000_000_000), memberIds });
    }
    const itemsTotal = items.reduce((a, i) => a + i.amount, 0);
    const adjustments: ReceiptAdjustment[] = [];
    for (let k = rnd(4); k > 0; k--) {
      adjustments.push({
        kind: rnd(2) ? 'service' : 'tip',
        amount: 1 + rnd(1_000_000_000_000),
        mode: rnd(3) === 0 ? 'equal' : 'proportional',
      });
    }
    if (rnd(2) && itemsTotal > 0)
      adjustments.push({ kind: 'discount', amount: 1 + rnd(itemsTotal), mode: 'proportional' });
    const expected = itemsTotal + adjustments.reduce((a, x) => a + (x.kind === 'discount' ? -x.amount : x.amount), 0);
    const s = computeReceiptShares(items, adjustments, expected);
    assert.equal(sum(s), expected);
    for (const v of s.values()) assert.ok(Number.isInteger(v) && v >= 0);
  }
});

test('foreign currency receipt converts to the group currency exactly', () => {
  const shares = computeReceiptShares(
    [
      { id: 1, amount: 1999, memberIds: [1, 2] },
      { id: 2, amount: 3333, memberIds: [3] },
    ],
    [{ kind: 'tip', amount: 501 }],
  );
  const conv = convertReceiptShares(shares, '91.37', 'USD', 'RUB');
  assert.equal(sum(conv), Math.round(sum(shares) * 91.37));
  assert.deepEqual([...conv.keys()], [...shares.keys()]);
});
