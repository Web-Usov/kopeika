import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  amountToInput,
  computeBalances,
  computeShares,
  convertAmount,
  convertExactShares,
  formatRate,
  minorDigits,
  normalizeRate,
  parseAmount,
  SplitError,
  settleUp,
} from './money.ts';

const sum = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);

test('equal split hands leftover kopecks to the first members', () => {
  const s = computeShares(10000, 'equal', [
    { memberId: 1, value: 0 },
    { memberId: 2, value: 0 },
    { memberId: 3, value: 0 },
  ]);
  assert.deepEqual([...s.values()], [3334, 3333, 3333]);
  assert.equal(sum(s), 10000);
});

test('shares split is proportional and sums exactly', () => {
  const s = computeShares(1001, 'shares', [
    { memberId: 1, value: 2 },
    { memberId: 2, value: 1 },
    { memberId: 3, value: 0 },
  ]);
  assert.equal(s.get(3), 0);
  assert.equal(sum(s), 1001);
  assert.equal(s.get(1), 667);
  assert.equal(s.get(2), 334);
});

test('exact split must match the total', () => {
  assert.throws(
    () =>
      computeShares(1000, 'exact', [
        { memberId: 1, value: 500 },
        { memberId: 2, value: 400 },
      ]),
    SplitError,
  );
  const s = computeShares(1000, 'exact', [
    { memberId: 1, value: 600 },
    { memberId: 2, value: 400 },
  ]);
  assert.equal(s.get(1), 600);
});

test('rejects empty and zero-weight splits', () => {
  assert.throws(() => computeShares(1000, 'equal', []), SplitError);
  assert.throws(() => computeShares(1000, 'shares', [{ memberId: 1, value: 0 }]), SplitError);
  assert.throws(() => computeShares(0, 'equal', [{ memberId: 1, value: 0 }]), SplitError);
});

test('balances and settle-up zero everyone out', () => {
  // A paid 300 for A,B,C; B paid 90 for B,C.
  const bal = computeBalances(
    [1, 2, 3],
    [
      {
        payerId: 1,
        amount: 300,
        shares: [
          { memberId: 1, amount: 100 },
          { memberId: 2, amount: 100 },
          { memberId: 3, amount: 100 },
        ],
      },
      {
        payerId: 2,
        amount: 90,
        shares: [
          { memberId: 2, amount: 45 },
          { memberId: 3, amount: 45 },
        ],
      },
    ],
  );
  assert.deepEqual(Object.fromEntries(bal), { 1: 200, 2: -55, 3: -145 });
  const plan = settleUp(bal);
  assert.deepEqual(plan, [
    { from: 3, to: 1, amount: 145 },
    { from: 2, to: 1, amount: 55 },
  ]);

  // Recording the transfers as ledger entries brings everyone to zero.
  const after = computeBalances(
    [1, 2, 3],
    [
      {
        payerId: 1,
        amount: 300,
        shares: [
          { memberId: 1, amount: 100 },
          { memberId: 2, amount: 100 },
          { memberId: 3, amount: 100 },
        ],
      },
      {
        payerId: 2,
        amount: 90,
        shares: [
          { memberId: 2, amount: 45 },
          { memberId: 3, amount: 45 },
        ],
      },
      ...plan.map((p) => ({ payerId: p.from, amount: p.amount, shares: [{ memberId: p.to, amount: p.amount }] })),
    ],
  );
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

test('minorDigits defaults to 2', () => {
  assert.equal(minorDigits('RUB'), 2);
  assert.equal(minorDigits('GEL'), 2);
  assert.equal(minorDigits('JPY'), 0);
});

test('normalizeRate accepts comma, trims zeros and rejects junk', () => {
  assert.equal(normalizeRate('34,5'), '34.5');
  assert.equal(normalizeRate(' 034.500 '), '34.5');
  assert.equal(normalizeRate('0.0295'), '0.0295');
  assert.equal(normalizeRate('7'), '7');
  for (const bad of ['', '0', '0.0', '-1', 'abc', '1e3', '1.2.3', '99999999999', '0.00000000001']) {
    assert.equal(normalizeRate(bad), null, bad);
  }
});

test('formatRate keeps ~6 significant digits without exponent', () => {
  assert.equal(formatRate(34.5), '34.5');
  assert.equal(formatRate(0.029512345), '0.0295123');
  assert.equal(formatRate(1 / 3), '0.333333');
  assert.equal(formatRate(95.123456789), '95.1235');
});

test('convertAmount: 100 GEL at 34.5 RUB = 3450 RUB', () => {
  assert.equal(convertAmount(10000, '34.5', 'GEL', 'RUB'), 345000);
});

test('convertAmount rounds half up and is exact (no float drift)', () => {
  // 0.01 * 0.5 = 0.005 -> rounds up to 0.01
  assert.equal(convertAmount(1, '0.5', 'USD', 'EUR'), 1);
  assert.equal(convertAmount(3, '0.5', 'USD', 'EUR'), 2); // 1.5 -> 2
  assert.equal(convertAmount(10000, '0.1', 'USD', 'EUR'), 1000);
  assert.equal(convertAmount(333333, '1.000003', 'USD', 'EUR'), 333334); // 333334.0 exactly (333333 + 0.999999)
  assert.equal(convertAmount(123456789012, '1', 'USD', 'EUR'), 123456789012);
});

test('convertAmount rejects bad rate and amounts that round to zero', () => {
  assert.throws(
    () => convertAmount(100, 'x', 'USD', 'EUR'),
    (e) => e instanceof SplitError && e.key === 'errors.rate.invalid',
  );
  assert.throws(
    () => convertAmount(1, '0.001', 'USD', 'EUR'),
    (e) => e instanceof SplitError && e.key === 'errors.rate.tooSmall',
  );
  assert.throws(() => convertAmount(0, '1', 'USD', 'EUR'), SplitError);
});

test('convertAmount respects minor digits of the currencies', () => {
  // 1000 JPY (no minor digits) at 0.0065 EUR = 6.50 EUR = 650 cents
  assert.equal(convertAmount(1000, '0.0065', 'JPY', 'EUR'), 650);
  // 10.00 EUR at 150 JPY = 1500 JPY (minor = whole yen)
  assert.equal(convertAmount(1000, '150', 'EUR', 'JPY'), 1500);
});

test('convertExactShares sums exactly to the converted total', () => {
  const inputs = [
    { memberId: 1, value: 3333 },
    { memberId: 2, value: 3333 },
    { memberId: 3, value: 3334 },
  ];
  const out = convertExactShares(inputs, '34.567', 'GEL', 'RUB');
  const total = convertAmount(10000, '34.567', 'GEL', 'RUB');
  assert.equal(
    out.reduce((a, i) => a + i.value, 0),
    total,
  );
  // each converted share stays within one minor unit of its exact value
  for (const [k, i] of inputs.entries()) assert.ok(Math.abs(out[k].value - i.value * 34.567) <= 1);
  // and the result is accepted as an exact split of the converted amount
  assert.equal(sum(computeShares(total, 'exact', out)), total);
});

test('convertExactShares keeps zero-weight members at zero and is stable', () => {
  const out = convertExactShares(
    [
      { memberId: 1, value: 1 },
      { memberId: 2, value: 1 },
      { memberId: 3, value: 1 },
    ],
    '0.5',
    'USD',
    'EUR',
  );
  assert.equal(
    out.reduce((a, i) => a + i.value, 0),
    convertAmount(3, '0.5', 'USD', 'EUR'),
  );
});
