import './test-env.ts';
import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env.DEV_AUTH = '1';
delete process.env.BOT_TOKEN;

let api: typeof import('./api.ts').api;
let createApp: typeof import('./app.ts').createApp;
let config: typeof import('./config.ts').config;
let db: typeof import('./db.ts');
let chatLink: typeof import('./chatLink.ts');
before(async () => {
  ({ api } = await import('./api.ts'));
  ({ createApp } = await import('./app.ts'));
  ({ config } = await import('./config.ts'));
  db = await import('./db.ts');
  chatLink = await import('./chatLink.ts');
});

let nextUser = 7000;
const newUser = () => nextUser++;
let nextChat = -7000;

// biome-ignore lint/suspicious/noExplicitAny: test helper over untyped JSON
type Json = any;

async function call(user: number, method: string, path: string, body?: unknown, lang?: string) {
  const res = await api.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `dev ${user}`, ...(lang ? { 'X-Lang': lang } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Json };
}

async function createGroup(user: number, memberNames: string[] = []) {
  const res = await call(user, 'POST', '/groups', { name: 'Поездка', currency: 'RUB', memberNames });
  assert.equal(res.status, 201);
  return res.body as Json;
}

const expense = (g: Json, over: Json = {}) => ({
  title: 'Ужин',
  amount: 10000,
  payerId: g.meId,
  splitMode: 'equal',
  spentOn: '2025-01-15',
  shares: g.members.map((m: Json) => ({ memberId: m.id, value: 1 })),
  ...over,
});

const count = (sql: string, ...p: (string | number)[]) => db.one<{ n: number }>(sql, ...p)!.n;
const userRow = (id: number) => db.one<Json>('SELECT * FROM users WHERE id = ?', id);

/** owner + guest in a group with an expense, a recurring template by each, a reminder and a chat token by the guest. */
async function sharedSetup() {
  const owner = newUser();
  const guest = newUser();
  const g = await createGroup(owner, ['Маша']);
  await call(guest, 'POST', `/invite/${g.inviteCode}/join`, {});
  await call(guest, 'PUT', '/me', { notify: true });
  await call(guest, 'PUT', '/me/payment-info', { phone: '+7 900 000-00-00' });
  const full = (await call(owner, 'GET', `/groups/${g.id}`)).body as Json;
  const guestMember = full.members.filter((m: Json) => m.hasTelegram).at(-1);
  assert.equal((await call(owner, 'POST', `/groups/${g.id}/expenses`, expense(full))).status, 201);
  // The guest pays too, so there is an expense authored by the guest.
  const guestFull = (await call(guest, 'GET', `/groups/${g.id}`)).body as Json;
  assert.equal(
    (await call(guest, 'POST', `/groups/${g.id}/expenses`, expense(guestFull, { title: 'Такси', amount: 3000 })))
      .status,
    201,
  );
  const tpl = (
    await call(guest, 'POST', `/groups/${g.id}/recurring`, {
      title: 'Интернет',
      amount: 6000,
      payerId: guestMember.id,
      splitMode: 'equal',
      shares: full.members.map((m: Json) => ({ memberId: m.id, value: 1 })),
      period: 'monthly',
      day: 5,
    })
  ).body as Json;
  const ownerTpl = (
    await call(owner, 'POST', `/groups/${g.id}/recurring`, {
      title: 'Аренда',
      amount: 9000,
      payerId: full.meId,
      splitMode: 'equal',
      shares: full.members.map((m: Json) => ({ memberId: m.id, value: 1 })),
      period: 'weekly',
      day: 1,
    })
  ).body as Json;
  db.run('INSERT INTO reminders (group_id, from_member, to_member) VALUES (?, ?, ?)', g.id, full.meId, guestMember.id);
  db.run('INSERT INTO reminders (group_id, from_member, to_member) VALUES (?, ?, ?)', g.id, guestMember.id, full.meId);
  const token = chatLink.createChatLink(nextChat--, 'Чат', guest);
  return { owner, guest, g, full, guestMember, tpl, ownerTpl, token };
}

test('DELETE /me requires auth', async () => {
  const res = await api.request('/me', { method: 'DELETE' });
  assert.equal(res.status, 401);
});

test('delete: user row with name, username, photo, language, payment details and notify flag is gone', async () => {
  const { guest } = await sharedSetup();
  assert.ok(userRow(guest));
  const res = await call(guest, 'DELETE', '/me');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, groupsDeleted: 0, groupsLeft: 1 });
  assert.equal(userRow(guest), undefined);
});

test('delete: in a shared group the user becomes a name-only member, others keep expenses and balances', async () => {
  const { owner, guest, g } = await sharedSetup();
  const before = (await call(owner, 'GET', `/groups/${g.id}`)).body as Json;
  const guestBefore = before.members.filter((m: Json) => m.hasTelegram).at(-1);
  await call(guest, 'DELETE', '/me');

  const after = (await call(owner, 'GET', `/groups/${g.id}`)).body as Json;
  const guestAfter = after.members.find((m: Json) => m.id === guestBefore.id);
  assert.equal(guestAfter.hasTelegram, false);
  assert.equal(guestAfter.name, guestBefore.name);
  assert.deepEqual(guestAfter.paymentInfo, {});
  assert.equal(guestAfter.canNotify, false);
  assert.equal(after.expenses.length, before.expenses.length);
  assert.deepEqual(
    after.members.map((m: Json) => m.balance),
    before.members.map((m: Json) => m.balance),
  );

  // The old group is no longer visible to the user; a fresh account has nothing.
  assert.equal((await call(guest, 'GET', `/groups/${g.id}`)).status, 404);
  assert.deepEqual((await call(guest, 'GET', '/groups')).body, []);
  assert.deepEqual((await call(guest, 'GET', '/me/payment-info')).body, {});
  assert.equal((await call(guest, 'GET', '/me')).body.notify, false);
});

test('delete: an owner passes the group to the next member with Telegram', async () => {
  const { owner, guest, g } = await sharedSetup();
  await call(owner, 'DELETE', '/me');
  const after = (await call(guest, 'GET', `/groups/${g.id}`)).body as Json;
  assert.equal(after.isOwner, true);
  assert.equal(db.one<Json>('SELECT created_by FROM groups WHERE id = ?', g.id).created_by, guest);
});

test('delete: a group where the user is the only one with Telegram is deleted whole', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Петя']);
  const full = (await call(u, 'GET', `/groups/${g.id}`)).body as Json;
  await call(u, 'POST', `/groups/${g.id}/expenses`, expense(full));
  await call(u, 'POST', `/groups/${g.id}/recurring`, {
    title: 'Подписка',
    amount: 1000,
    payerId: full.meId,
    splitMode: 'equal',
    shares: full.members.map((m: Json) => ({ memberId: m.id, value: 1 })),
    period: 'monthly',
    day: 1,
  });
  db.run(
    'INSERT INTO reminders (group_id, from_member, to_member) VALUES (?, ?, ?)',
    g.id,
    full.meId,
    full.members[1].id,
  );
  const chatId = nextChat--;
  chatLink.attachChat(
    db.one<Json>('SELECT * FROM chat_links WHERE token = ?', chatLink.createChatLink(chatId, 'Чат', u))!,
    db.one<Json>('SELECT * FROM groups WHERE id = ?', g.id)!,
    u,
  );

  const res = await call(u, 'DELETE', '/me');
  assert.deepEqual(res.body, { ok: true, groupsDeleted: 1, groupsLeft: 0 });
  for (const table of [
    'groups WHERE id',
    'members WHERE group_id',
    'expenses WHERE group_id',
    'activity WHERE group_id',
    'reminders WHERE group_id',
    'recurring WHERE group_id',
  ]) {
    assert.equal(count(`SELECT COUNT(*) n FROM ${table} = ?`, g.id), 0, table);
  }
  assert.equal(
    count('SELECT COUNT(*) n FROM expense_shares s LEFT JOIN expenses e ON e.id = s.expense_id WHERE e.id IS NULL'),
    0,
  );
  assert.equal(chatLink.groupOfChat(chatId), undefined);
  assert.equal(userRow(u), undefined);
});

test('delete: mixed — shared group is kept, solo group is erased', async () => {
  const { guest, g } = await sharedSetup();
  const solo = await createGroup(guest);
  const res = await call(guest, 'DELETE', '/me');
  assert.deepEqual(res.body, { ok: true, groupsDeleted: 1, groupsLeft: 1 });
  assert.equal(count('SELECT COUNT(*) n FROM groups WHERE id = ?', solo.id), 0);
  assert.equal(count('SELECT COUNT(*) n FROM groups WHERE id = ?', g.id), 1);
});

test('delete: reminders and chat-link tokens of the user are removed, recurring templates are paused', async () => {
  const { guest, g, token, tpl, ownerTpl } = await sharedSetup();
  assert.equal(count('SELECT COUNT(*) n FROM reminders WHERE group_id = ?', g.id), 2);
  await call(guest, 'DELETE', '/me');
  assert.equal(count('SELECT COUNT(*) n FROM reminders WHERE group_id = ?', g.id), 0);
  assert.equal(count('SELECT COUNT(*) n FROM chat_links WHERE token = ?', token), 0);
  const mine = db.one<Json>('SELECT * FROM recurring WHERE id = ?', tpl.id)!;
  assert.equal(mine.active, 0);
  assert.equal(mine.created_by, 0);
  // Someone else's template is untouched.
  const theirs = db.one<Json>('SELECT * FROM recurring WHERE id = ?', ownerTpl.id)!;
  assert.equal(theirs.active, 1);
  assert.notEqual(theirs.created_by, 0);
});

test('delete: history entries stay, the actor shows as a deleted user in both languages', async () => {
  const { owner, guest, g } = await sharedSetup();
  const names = async (lang: string) =>
    ((await call(owner, 'GET', `/groups/${g.id}/activity`, undefined, lang)).body.items as Json[]).map((i) => ({
      action: i.action,
      actor: i.actor.name,
      payload: i.payload,
    }));
  const before = await names('ru');
  await call(guest, 'DELETE', '/me');
  const ru = await names('ru');
  const en = await names('en');
  assert.equal(ru.length, before.length + 1); // + «member.leave»
  assert.ok(ru.some((i) => i.action === 'expense.create' && i.actor === 'удалённый пользователь'));
  assert.ok(en.some((i) => i.action === 'expense.create' && i.actor === 'deleted user'));
  assert.ok(ru.some((i) => i.action === 'member.leave' && i.actor === 'удалённый пользователь'));
  // Snapshots in payloads are kept.
  assert.ok(ru.some((i) => i.action === 'expense.create' && i.payload.expense?.title === 'Такси'));
  // Entries of the other members are unchanged.
  assert.ok(ru.some((i) => i.action === 'group.create' && i.actor !== 'удалённый пользователь'));
  // Expenses authored by the user point to the placeholder.
  assert.equal(count('SELECT COUNT(*) n FROM expenses WHERE group_id = ? AND created_by = 0', g.id), 1);
});

test('delete: the same Telegram user can come back with a fresh account, and deleting twice is harmless', async () => {
  const u = newUser();
  await createGroup(u);
  assert.equal((await call(u, 'DELETE', '/me')).status, 200);
  assert.equal((await call(u, 'GET', '/groups')).body.length, 0);
  assert.ok(userRow(u));
  assert.deepEqual((await call(u, 'DELETE', '/me')).body, { ok: true, groupsDeleted: 0, groupsLeft: 0 });
  // A new group works as usual.
  await createGroup(u);
});

test('GET /terms: public HTML in both languages, not cached', async () => {
  const app = createApp('/nonexistent-static-dir');
  const ru = await app.request('/terms');
  assert.equal(ru.status, 200);
  assert.match(ru.headers.get('content-type') ?? '', /text\/html/);
  assert.equal(ru.headers.get('cache-control'), 'no-cache');
  const ruText = await ru.text();
  assert.match(ruText, /<html lang="ru">/);
  assert.match(ruText, /Условия использования/);
  assert.match(ruText, /@kopeika_usov_bot/);
  const en = await (await app.request('/terms?lang=en')).text();
  assert.match(en, /<html lang="en">/);
  assert.match(en, /Terms of Service/);
  const byHeader = await (await app.request('/terms', { headers: { 'Accept-Language': 'en-US,en;q=0.9' } })).text();
  assert.match(byHeader, /<html lang="en">/);
});

test('GET /privacy: public HTML in both languages, not cached', async () => {
  const app = createApp('/nonexistent-static-dir');
  const ru = await app.request('/privacy');
  assert.equal(ru.status, 200);
  assert.match(ru.headers.get('content-type') ?? '', /text\/html/);
  assert.equal(ru.headers.get('cache-control'), 'no-cache');
  const ruText = await ru.text();
  assert.match(ruText, /<html lang="ru">/);
  assert.match(ruText, /Политика конфиденциальности/);
  assert.match(ruText, /Удалить мои данные/);
  assert.match(ruText, /@kopeika_usov_bot/);

  const en = await (await app.request('/privacy?lang=en')).text();
  assert.match(en, /<html lang="en">/);
  assert.match(en, /Privacy Policy/);

  const byHeader = await (await app.request('/privacy', { headers: { 'Accept-Language': 'en-US,en;q=0.9' } })).text();
  assert.match(byHeader, /<html lang="en">/);
  // ?lang beats the header
  const forced = await (await app.request('/privacy?lang=ru', { headers: { 'Accept-Language': 'en' } })).text();
  assert.match(forced, /<html lang="ru">/);
});

test('GET /privacy names the receipt provider from RECEIPTS_PROVIDER and only that one', async (t) => {
  const app = createApp('/nonexistent-static-dir');
  const saved = config.receiptsProvider;
  t.after(() => {
    config.receiptsProvider = saved;
  });
  for (const lang of ['ru', 'en']) {
    config.receiptsProvider = 'anthropic';
    const anthropic = await (await app.request(`/privacy?lang=${lang}`)).text();
    assert.match(anthropic, /Anthropic/, lang);
    assert.doesNotMatch(anthropic, /OpenRouter/, lang);

    config.receiptsProvider = 'openrouter';
    const openrouter = await (await app.request(`/privacy?lang=${lang}`)).text();
    assert.match(openrouter, /OpenRouter/, lang);
    assert.doesNotMatch(openrouter, /Anthropic/, lang);
  }
});
