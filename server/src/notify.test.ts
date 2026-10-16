import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildChangeMessage, changeAudience, type ExpenseSnap } from './notify.ts';

const names = new Map([
  [1, 'Маша'],
  [2, 'Петя'],
  [3, 'Вася'],
]);
const dinner: ExpenseSnap = {
  kind: 'expense',
  title: 'Ужин',
  amount: 300000,
  payerId: 1,
  spentOn: '2026-05-01',
  shares: [
    { memberId: 1, amount: 100000 },
    { memberId: 2, amount: 100000 },
    { memberId: 3, amount: 100000 },
  ],
};
const base = { recipientMemberId: 2, currency: 'RUB', groupName: 'Дача', authorName: 'Маша', memberNames: names };
const nbsp = (s: string | null) => s?.replace(/[  ]/g, ' ') ?? null;

test('amount change shows old -> new and the recipient share (ru)', () => {
  const after = {
    ...dinner,
    amount: 350000,
    shares: dinner.shares.map((s) => ({ ...s, amount: Math.floor(350000 / 3) })),
  };
  const text = nbsp(buildChangeMessage({ ...base, lang: 'ru', before: dinner, after }));
  assert.ok(text?.includes('Маша изменил(а) «Ужин»: 3 000 ₽ → 3 500 ₽'), text ?? '');
  assert.ok(text?.includes('Ваша доля: 1 166,66 ₽'), text ?? '');
});

test('amount change (en)', () => {
  const after = { ...dinner, amount: 350000 };
  const text = buildChangeMessage({ ...base, lang: 'en', authorName: 'Masha', before: dinner, after });
  assert.ok(text?.includes('Masha changed “Ужин”'));
  assert.ok(text?.includes('→'));
  assert.ok(text?.includes('Your share'));
});

test('title-only change is one short line without share', () => {
  const after = { ...dinner, title: 'Обед' };
  const ru = buildChangeMessage({ ...base, lang: 'ru', before: dinner, after });
  assert.ok(ru?.includes('переименовал(а) «Ужин» в «Обед»'));
  assert.ok(!ru?.includes('доля'));
  const en = buildChangeMessage({ ...base, lang: 'en', before: dinner, after });
  assert.ok(en?.includes('renamed “Ужин” to “Обед”'));
});

test('date-only or no-op change sends nothing', () => {
  assert.equal(buildChangeMessage({ ...base, lang: 'ru', before: dinner, after: { ...dinner } }), null);
  assert.equal(
    buildChangeMessage({ ...base, lang: 'en', before: dinner, after: { ...dinner, spentOn: '2026-05-02' } }),
    null,
  );
});

test('payer change is reported and values are HTML-escaped', () => {
  const after = { ...dinner, title: '<b>Ужин</b>', payerId: 3 };
  const text = buildChangeMessage({ ...base, lang: 'ru', before: dinner, after });
  assert.ok(text?.includes('платил(а) Маша → Вася'));
  assert.ok(text?.includes('&lt;b&gt;Ужин&lt;/b&gt;'));
});

test('recipient removed from the split is told so', () => {
  const after = { ...dinner, shares: dinner.shares.filter((s) => s.memberId !== 2), payerId: 1 };
  const text = buildChangeMessage({ ...base, lang: 'ru', before: dinner, after });
  assert.ok(text?.includes('Вас убрали'));
  assert.deepEqual(changeAudience(dinner, after).sort(), [1, 2, 3]);
});

test('delete (ru, en)', () => {
  const ru = nbsp(buildChangeMessage({ ...base, lang: 'ru', before: dinner, after: null }));
  assert.ok(ru?.includes('Маша удалил(а) «Ужин» на 3 000 ₽'), ru ?? '');
  const en = buildChangeMessage({ ...base, lang: 'en', before: dinner, after: null });
  assert.ok(en?.includes('deleted “Ужин” for'));
});

test('transfers', () => {
  const tr: ExpenseSnap = {
    kind: 'transfer',
    title: 'Перевод',
    amount: 50000,
    payerId: 2,
    spentOn: '2026-05-01',
    shares: [{ memberId: 1, amount: 50000 }],
  };
  const changed = buildChangeMessage({ ...base, lang: 'ru', before: tr, after: { ...tr, amount: 70000 } });
  assert.ok(changed?.includes('изменил(а) перевод'));
  assert.equal(buildChangeMessage({ ...base, lang: 'ru', before: tr, after: { ...tr } }), null);
  assert.ok(buildChangeMessage({ ...base, lang: 'ru', before: tr, after: null })?.includes('удалил(а) перевод'));
  assert.ok(buildChangeMessage({ ...base, lang: 'en', before: tr, after: null })?.includes('deleted a transfer'));
});
