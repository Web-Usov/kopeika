import assert from 'node:assert/strict';
import { before, test } from 'node:test';

// config.ts and db.ts read env at import time, so set it before the dynamic import.
process.env.DB_PATH = ':memory:';
process.env.DEV_AUTH = '1';
delete process.env.BOT_TOKEN;

let api: typeof import('./api.ts').api;
let repo: typeof import('./repo.ts');
let db: typeof import('./db.ts');
before(async () => {
  ({ api } = await import('./api.ts'));
  repo = await import('./repo.ts');
  db = await import('./db.ts');
});

let nextUser = 5000;
const newUser = () => nextUser++;

// biome-ignore lint/suspicious/noExplicitAny: test helper over untyped JSON
type Json = any;

async function call(user: number, method: string, path: string, body?: unknown, lang?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `dev ${user}` };
  if (lang) headers['X-Lang'] = lang;
  const res = await api.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Json };
}

test('demo group: made-up people, expenses of several kinds, balances add up', async () => {
  const u = newUser();
  const res = await call(u, 'POST', '/demo');
  assert.equal(res.status, 201);
  const g = res.body;
  assert.equal(g.isDemo, true);
  assert.equal(g.isOwner, true);
  assert.equal(g.currency, 'RUB');
  assert.equal(g.inviteLink, null);
  assert.equal(g.members.length, 4);
  assert.equal(g.members.filter((m: Json) => m.userId === null).length, 3);
  const expenses = g.expenses.filter((e: Json) => e.kind === 'expense');
  assert.ok(expenses.length >= 5 && expenses.length <= 6);
  assert.ok(new Set(expenses.map((e: Json) => e.category)).size >= 4);
  assert.equal(new Set(expenses.map((e: Json) => e.splitMode)).size, 3);
  assert.equal(g.expenses.filter((e: Json) => e.kind === 'transfer').length, 1);
  assert.equal(
    g.members.reduce((s: number, m: Json) => s + m.balance, 0),
    0,
  );
  assert.ok(g.settlements.length > 0);
});

test('demo group: EUR and English names for en', async () => {
  const res = await call(newUser(), 'POST', '/demo', undefined, 'en');
  assert.equal(res.body.currency, 'EUR');
  assert.deepEqual(
    res.body.members.slice(1).map((m: Json) => m.name),
    ['Anna', 'Ben', 'Vika'],
  );
});

test('demo group is created once per user, and again after deletion', async () => {
  const u = newUser();
  const first = await call(u, 'POST', '/demo');
  const second = await call(u, 'POST', '/demo');
  assert.equal(second.status, 200);
  assert.equal(second.body.id, first.body.id);
  assert.equal(second.body.expenses.length, first.body.expenses.length);
  assert.equal((await call(u, 'GET', '/groups')).body.length, 1);
  assert.equal((await call(newUser(), 'POST', '/demo')).body.id === first.body.id, false);

  assert.equal((await call(u, 'DELETE', `/groups/${first.body.id}`)).status, 200);
  assert.equal((await call(u, 'GET', '/groups')).body.length, 0);
  assert.equal((await call(u, 'GET', `/groups/${first.body.id}`)).status, 404);
  const again = await call(u, 'POST', '/demo');
  assert.equal(again.status, 201);
  assert.notEqual(again.body.id, first.body.id);
});

test('demo group is listed for its owner with a flag, and is invisible to others', async () => {
  const u = newUser();
  const g = (await call(u, 'POST', '/demo')).body;
  const list = (await call(u, 'GET', '/groups')).body;
  assert.equal(list[0].isDemo, true);
  assert.equal((await call(newUser(), 'GET', `/groups/${g.id}`)).status, 404);
});

test('demo group: invite preview and join are disabled', async () => {
  const u = newUser();
  const g = (await call(u, 'POST', '/demo')).body;
  const code = g.inviteCode;
  assert.equal((await call(newUser(), 'GET', `/invite/${code}`)).status, 404);
  const stranger = newUser();
  assert.equal((await call(stranger, 'POST', `/invite/${code}/join`, {})).status, 404);
  assert.equal((await call(stranger, 'GET', '/groups')).body.length, 0);
});

test('demo group: no chat link, no recurring templates, not in inline or /balance lists', async () => {
  const u = newUser();
  const g = (await call(u, 'POST', '/demo')).body;
  const chatLink = await import('./chatLink.ts');
  const token = chatLink.createChatLink(-100500 - u, 'Chat', u);
  assert.equal((await call(u, 'POST', `/chat-links/${token}/attach`, { groupId: g.id })).status, 409);
  assert.equal((await call(u, 'PUT', `/groups/${g.id}/chat/feed`, { feed: 'daily' })).status, 409);
  const recurring = {
    title: 'Аренда',
    amount: 1000,
    payerId: g.meId,
    splitMode: 'equal',
    shares: g.members.map((m: Json) => ({ memberId: m.id, value: 1 })),
    period: 'monthly',
    day: 1,
  };
  assert.equal((await call(u, 'POST', `/groups/${g.id}/recurring`, recurring)).status, 409);

  assert.equal(repo.inlineGroupsForUser(u).length, 0);
  // The same filter /balance uses in a private chat.
  assert.equal(repo.groupsForUser(u).filter((x) => !x.archived && !x.isDemo).length, 0);

  const real = (await call(u, 'POST', '/groups', { name: 'Дача', currency: 'RUB' })).body;
  assert.deepEqual(
    repo.inlineGroupsForUser(u).map((x) => x.id),
    [real.id],
  );
  assert.equal(
    db.one<{ n: number }>('SELECT COUNT(*) AS n FROM groups WHERE is_demo = 1 AND chat_id IS NOT NULL')?.n,
    0,
  );
});

test('demo group: expenses can be added and edited to play with', async () => {
  const u = newUser();
  const g = (await call(u, 'POST', '/demo')).body;
  const res = await call(u, 'POST', `/groups/${g.id}/expenses`, {
    title: 'Кофе',
    amount: 500,
    payerId: g.meId,
    splitMode: 'equal',
    spentOn: '2025-01-15',
    shares: g.members.map((m: Json) => ({ memberId: m.id, value: 1 })),
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.expenses.length, g.expenses.length + 1);
});
