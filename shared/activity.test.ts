import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type ActivityEntry, activityText, type ExpenseSnapshot } from './activity.ts';

const nbsp = (s: string) => s.replace(/\s/g, ' ');
const masha = { memberId: 2, name: 'Маша' };
const snap = (over: Partial<ExpenseSnapshot> = {}): ExpenseSnapshot => ({
  kind: 'expense',
  title: 'Ужин',
  amount: 300000,
  payer: { id: 2, name: 'Маша' },
  ...over,
});
const entry = (action: ActivityEntry['action'], payload: ActivityEntry['payload']): ActivityEntry => ({
  id: 1,
  action,
  actor: masha,
  payload,
  createdAt: '2025-01-15T10:00:00Z',
});
const text = (lang: 'ru' | 'en', e: ActivityEntry) => nbsp(activityText(lang, e, 'RUB'));

test('expense changed: amount', () => {
  const e = entry('expense.update', { before: snap(), after: snap({ amount: 350000 }) });
  assert.equal(text('ru', e), 'Маша изменил(а) «Ужин»: 3 000 ₽ → 3 500 ₽');
  assert.equal(text('en', e), 'Маша changed “Ужин”: RUB 3,000 → RUB 3,500');
});

test('expense changed: title and payer, several changes', () => {
  const e = entry('expense.update', {
    before: snap(),
    after: snap({ title: 'Обед', payer: { id: 3, name: 'Петя' } }),
  });
  assert.equal(text('ru', e), 'Маша изменил(а) «Ужин»: название «Ужин» → «Обед»; платил(а) Маша → Петя');
  assert.equal(text('en', e), 'Маша changed “Ужин”: title “Ужин” → “Обед”; paid by Маша → Петя');
});

test('expense changed without visible differences', () => {
  const e = entry('expense.update', { before: snap(), after: snap() });
  assert.equal(text('ru', e), 'Маша изменил(а) «Ужин»');
  assert.equal(text('en', e), 'Маша changed “Ужин”');
});

test('expense created and deleted', () => {
  assert.equal(text('ru', entry('expense.create', { expense: snap() })), 'Маша добавил(а) «Ужин» на 3 000 ₽');
  const taxi = snap({ title: 'Такси', amount: 50000 });
  assert.equal(text('ru', entry('expense.delete', { expense: taxi })), 'Маша удалил(а) «Такси» на 500 ₽');
  assert.equal(text('en', entry('expense.delete', { expense: taxi })), 'Маша deleted “Такси” for RUB 500');
});

test('transfers', () => {
  const tr = snap({ kind: 'transfer', title: 'Перевод', amount: 50000, to: { id: 3, name: 'Петя' } });
  assert.equal(text('ru', entry('expense.create', { expense: tr })), 'Маша записал(а) перевод: Маша → Петя, 500 ₽');
  assert.equal(text('en', entry('expense.create', { expense: tr })), 'Маша recorded a transfer: Маша → Петя, RUB 500');
  assert.equal(text('ru', entry('expense.delete', { expense: tr })), 'Маша удалил(а) перевод на 500 ₽');
  const upd = entry('expense.update', { before: tr, after: { ...tr, amount: 70000 } });
  assert.equal(text('ru', upd), 'Маша изменил(а) перевод: 500 ₽ → 700 ₽');
  assert.equal(text('en', upd), 'Маша changed a transfer: RUB 500 → RUB 700');
});

test('members and group', () => {
  assert.equal(text('ru', entry('member.join', {})), 'Маша присоединился(лась) к группе');
  assert.equal(text('en', entry('member.join', {})), 'Маша joined the group');
  assert.equal(text('ru', entry('member.claim', { name: 'Петя' })), 'Маша присоединился(лась) к группе как «Петя»');
  assert.equal(text('en', entry('member.rename', { from: 'A', to: 'B' })), 'Маша renamed a member: “A” → “B”');
  assert.equal(text('ru', entry('group.rename', { from: 'A', to: 'B' })), 'Маша переименовал(а) группу: «A» → «B»');
  assert.equal(text('en', entry('member.add', { name: 'Коля' })), 'Маша added the member “Коля”');
  assert.equal(text('ru', entry('member.delete', { name: 'Коля' })), 'Маша убрал(а) участника «Коля»');
  assert.equal(text('en', entry('group.create', { name: 'Дача' })), 'Маша created the group “Дача”');
  assert.equal(text('ru', entry('member.payment_info', { name: 'Коля' })), 'Маша обновил(а) реквизиты: Коля');
});

test('debt reminder', () => {
  const e = entry('debt.remind', { memberId: 3, name: 'Петя', amount: 150000 });
  assert.equal(text('ru', e), 'Маша напомнил(а) о долге: Петя, 1 500 ₽');
  assert.match(text('en', e), /^Маша sent a debt reminder: Петя, /);
});

test('chat link / unlink entries', () => {
  const link = entry('group.chat_link', { name: 'Друзья' });
  assert.equal(text('ru', link), 'Маша привязал(а) чат «Друзья»');
  assert.equal(text('en', link), 'Маша linked the chat “Друзья”');
  const unlink = entry('group.chat_unlink', { name: 'Друзья' });
  assert.equal(text('ru', unlink), 'Маша отвязал(а) чат «Друзья»');
  assert.equal(text('en', unlink), 'Маша unlinked the chat “Друзья”');
});
