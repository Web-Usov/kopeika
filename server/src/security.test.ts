import './test-env.ts';
import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env.DEV_AUTH = '1';
delete process.env.BOT_TOKEN;

let api: typeof import('./api.ts').api;
let chatLink: typeof import('./chatLink.ts');
let db: typeof import('./db.ts');
let auth: typeof import('./auth.ts');
let createApp: typeof import('./app.ts').createApp;
before(async () => {
  ({ api } = await import('./api.ts'));
  chatLink = await import('./chatLink.ts');
  auth = await import('./auth.ts');
  db = await import('./db.ts');
  (await import('./bot.ts')).setBotTestHooks({ chatMember: async () => 'administrator' });
  ({ createApp } = await import('./app.ts'));
});

let nextUser = 50_000;
let nextChat = -9_000_000;
// biome-ignore lint/suspicious/noExplicitAny: test helper over untyped JSON
type Json = any;

async function call(user: number | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (user !== null) headers.Authorization = `dev ${user}`;
  const res = await api.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Json };
}

async function group(user: number, memberNames: string[] = []) {
  const res = await call(user, 'POST', '/groups', { name: 'Секрет', currency: 'RUB', memberNames });
  assert.equal(res.status, 201);
  return res.body as Json;
}

const exp = (g: Json, over: Json = {}) => ({
  title: 'Ужин',
  amount: 1000,
  payerId: g.meId,
  splitMode: 'equal',
  spentOn: '2025-01-15',
  shares: g.members.map((m: Json) => ({ memberId: m.id, value: 1 })),
  ...over,
});

test('every group route answers a non-member with 404 and changes nothing', async () => {
  const owner = nextUser++;
  const intruder = nextUser++;
  const g = await group(owner, ['Маша']);
  await call(owner, 'POST', `/groups/${g.id}/expenses`, exp(g));
  const after = (await call(owner, 'GET', `/groups/${g.id}`)).body;
  const eid = after.expenses[0].id;
  const mid = g.members[1].id;
  const routes: [string, string, unknown?][] = [
    ['GET', `/groups/${g.id}`],
    ['PATCH', `/groups/${g.id}`, { name: 'Взлом' }],
    ['DELETE', `/groups/${g.id}`],
    ['POST', `/groups/${g.id}/export`],
    ['POST', `/groups/${g.id}/archive`],
    ['POST', `/groups/${g.id}/unarchive`],
    ['POST', `/groups/${g.id}/leave`],
    ['POST', `/groups/${g.id}/members`, { name: 'Чужой' }],
    ['PATCH', `/groups/${g.id}/members/${mid}`, { name: 'Взлом' }],
    ['DELETE', `/groups/${g.id}/members/${mid}`],
    ['POST', `/groups/${g.id}/invite/rotate`],
    ['POST', `/groups/${g.id}/members/${mid}/remove`],
    ['PUT', `/groups/${g.id}/chat/feed`, { feed: 'off' }],
    ['POST', `/groups/${g.id}/chat/unlink`],
    ['POST', `/groups/${g.id}/expenses`, exp(g)],
    ['PUT', `/groups/${g.id}/expenses/${eid}`, exp(g, { title: 'Взлом' })],
    ['DELETE', `/groups/${g.id}/expenses/${eid}`],
    ['GET', `/groups/${g.id}/recurring`],
    ['POST', `/groups/${g.id}/recurring`, { ...exp(g), period: 'monthly', day: 1 }],
    ['PATCH', `/groups/${g.id}/recurring/1`, { active: false }],
    ['DELETE', `/groups/${g.id}/recurring/1`],
    ['GET', `/groups/${g.id}/activity`],
    ['POST', `/groups/${g.id}/remind`, { memberId: mid }],
  ];
  for (const [method, path, body] of routes) {
    const res = await call(intruder, method, path, body);
    assert.equal(res.status, 404, `${method} ${path} -> ${res.status}`);
  }
  const still = (await call(owner, 'GET', `/groups/${g.id}`)).body;
  assert.equal(still.name, 'Секрет');
  assert.equal(still.expenses.length, 1);
  assert.equal(still.members.length, 2);
});

test('a member cannot reach another group through ids in the URL or in the body', async () => {
  const a = nextUser++;
  const b = nextUser++;
  const ga = await group(a);
  const gb = await group(b);
  await call(b, 'POST', `/groups/${gb.id}/expenses`, exp(gb));
  const eb = (await call(b, 'GET', `/groups/${gb.id}`)).body.expenses[0];
  assert.equal((await call(a, 'PUT', `/groups/${ga.id}/expenses/${eb.id}`, exp(ga))).status, 404);
  assert.equal((await call(a, 'DELETE', `/groups/${ga.id}/expenses/${eb.id}`)).status, 404);
  assert.equal((await call(a, 'PATCH', `/groups/${ga.id}/members/${gb.meId}`, { name: 'X' })).status, 404);
  assert.equal((await call(a, 'DELETE', `/groups/${ga.id}/members/${gb.meId}`)).status, 404);
  assert.equal((await call(a, 'POST', `/groups/${ga.id}/remind`, { memberId: gb.meId })).status, 409);
  assert.equal((await call(a, 'POST', `/groups/${ga.id}/expenses`, exp(ga, { payerId: gb.meId }))).status, 400);
  const shares = [{ memberId: gb.meId, value: 1 }];
  assert.equal((await call(a, 'POST', `/groups/${ga.id}/expenses`, exp(ga, { shares }))).status, 400);
  const rec = { ...exp(ga, { shares }), period: 'monthly', day: 1 };
  assert.equal((await call(a, 'POST', `/groups/${ga.id}/recurring`, rec)).status, 400);
  const token = chatLink.createChatLink(nextChat--, 'Чат', a);
  assert.equal((await call(a, 'POST', `/chat-links/${token}/attach`, { groupId: gb.id })).status, 404);
  const final = (await call(b, 'GET', `/groups/${gb.id}`)).body;
  assert.equal(final.expenses.length, 1);
  assert.equal(final.chat, null);
});

test('a recurring template of another group cannot be changed or deleted by id guessing', async () => {
  const a = nextUser++;
  const b = nextUser++;
  const ga = await group(a);
  const gb = await group(b);
  const created = await call(b, 'POST', `/groups/${gb.id}/recurring`, { ...exp(gb), period: 'monthly', day: 5 });
  assert.equal(created.status, 201);
  const rid = created.body.id;
  assert.equal((await call(a, 'PATCH', `/groups/${ga.id}/recurring/${rid}`, { active: false })).status, 404);
  assert.equal((await call(a, 'DELETE', `/groups/${ga.id}/recurring/${rid}`)).status, 404);
  assert.equal((await call(a, 'GET', `/groups/${ga.id}/recurring`)).body.length, 0);
  assert.equal((await call(b, 'GET', `/groups/${gb.id}/recurring`)).body.length, 1);
});

test('invite and chat-link previews leak no Telegram ids, chat ids or payment details', async () => {
  const owner = nextUser++;
  const stranger = nextUser++;
  const g = await group(owner, ['Маша']);
  await call(owner, 'PUT', '/me/payment-info', { card: '4111111111111111' });
  const preview = await call(stranger, 'GET', `/invite/${g.inviteCode}`);
  const text = JSON.stringify(preview.body);
  assert.equal(text.includes('4111'), false);
  assert.equal(text.includes(String(owner)), false);
  assert.deepEqual(Object.keys(preview.body.group).sort(), ['currency', 'id', 'membersCount', 'name']);
  const chatId = nextChat--;
  const token = chatLink.createChatLink(chatId, 'Чат', owner);
  const cl = await call(stranger, 'GET', `/chat-links/${token}`);
  assert.equal(JSON.stringify(cl.body).includes(String(chatId)), false);
  assert.equal(cl.body.replaces, null);
  await call(owner, 'POST', `/chat-links/${token}/attach`, { groupId: g.id });
  assert.equal(JSON.stringify((await call(owner, 'GET', `/groups/${g.id}`)).body).includes(String(chatId)), false);
});

test('an invite code opens only its own group', async () => {
  const ga = await group(nextUser++);
  const gb = await group(nextUser++);
  const guest = nextUser++;
  await call(guest, 'POST', `/invite/${ga.inviteCode}/join`, {});
  assert.equal((await call(guest, 'GET', `/groups/${ga.id}`)).status, 200);
  assert.equal((await call(guest, 'GET', `/groups/${gb.id}`)).status, 404);
  assert.equal((await call(guest, 'GET', '/invite/nope')).status, 404);
});

test('claimMemberId of another group cannot be taken through this invite', async () => {
  const ga = await group(nextUser++);
  const owner = nextUser++;
  const gb = await group(owner, ['Маша']);
  const victim = gb.members.find((m: Json) => m.name === 'Маша');
  const res = await call(nextUser++, 'POST', `/invite/${ga.inviteCode}/join`, { claimMemberId: victim.id });
  assert.equal(res.status, 409);
  const after = (await call(owner, 'GET', `/groups/${gb.id}`)).body;
  assert.equal(after.members.find((m: Json) => m.id === victim.id).userId, null);
});

test('spare tokens of a chat die when one of them is used', async () => {
  const u = nextUser++;
  const attacker = nextUser++;
  const chatId = nextChat--;
  const t1 = chatLink.createChatLink(chatId, 'Чат', u);
  // Repeated requests reuse the token; a second one is only possible once the first expires (here: made by hand).
  assert.equal(chatLink.createChatLink(chatId, 'Чат', u), t1);
  const t2 = 'spare-token-of-the-same-chat';
  db.run(
    "INSERT INTO chat_links (token, chat_id, chat_title, created_by_user, expires_at) VALUES (?, ?, 'Чат', ?, datetime('now', '+1 hour'))",
    t2,
    chatId,
    u,
  );
  const mine = await group(u);
  assert.equal((await call(u, 'POST', `/chat-links/${t1}/attach`, { groupId: mine.id })).status, 200);
  const theirs = await group(attacker);
  assert.equal((await call(attacker, 'POST', `/chat-links/${t2}/attach`, { groupId: theirs.id })).status, 409);
  assert.equal((await call(u, 'GET', `/groups/${mine.id}`)).body.chat.title, 'Чат');
});

test('an oversized JSON body is refused with 413', async () => {
  const u = nextUser++;
  const body = JSON.stringify({ name: 'x'.repeat(400_000), currency: 'RUB' });
  const res = await api.request('/groups', {
    method: 'POST',
    headers: { Authorization: `dev ${u}`, 'Content-Type': 'application/json' },
    body,
  });
  assert.equal(res.status, 413);
});

test('input limits: long names, too many members, bad amounts', async () => {
  const u = nextUser++;
  assert.equal((await call(u, 'POST', '/groups', { name: 'x'.repeat(65), currency: 'RUB' })).status, 400);
  const many = Array.from({ length: 51 }, (_, i) => `m${i}`);
  assert.equal((await call(u, 'POST', '/groups', { name: 'ok', currency: 'RUB', memberNames: many })).status, 400);
  const g = await group(u);
  assert.equal((await call(u, 'POST', `/groups/${g.id}/expenses`, exp(g, { amount: 1e13 }))).status, 400);
  assert.equal((await call(u, 'POST', `/groups/${g.id}/expenses`, exp(g, { title: 'x'.repeat(101) }))).status, 400);
  assert.equal((await call(u, 'POST', `/groups/${g.id}/expenses`, exp(g, { amount: 1.5 }))).status, 400);
});

test('SQL metacharacters in ids and names are inert', async () => {
  const u = nextUser++;
  const g = await group(u);
  assert.equal((await call(u, 'GET', '/groups/1%20OR%201=1')).status, 404);
  assert.equal((await call(u, 'GET', "/invite/' OR '1'='1")).status, 404);
  const r = await call(u, 'PATCH', `/groups/${g.id}`, { name: "x'); DROP TABLE groups;--" });
  assert.equal(r.status, 200);
  assert.equal((await call(u, 'GET', '/groups')).status, 200);
});

test('rates: far-future dates are refused', async () => {
  const res = await call(nextUser++, 'GET', '/rates?base=RUB&currency=USD&date=2099-01-01');
  assert.equal(res.status, 400);
});

test('initData: a non-hex or multi-byte hash gives null, not an exception', () => {
  const token = '123456:TEST';
  const raw = auth.signInitData(
    { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 1, first_name: 'A' }) },
    token,
  );
  assert.ok(auth.validateInitData(raw, token, 60));
  const p = new URLSearchParams(raw);
  p.set('hash', 'é'.repeat(64));
  assert.equal(auth.validateInitData(p.toString(), token, 60), null);
  p.set('hash', 'Z'.repeat(64));
  assert.equal(auth.validateInitData(p.toString(), token, 60), null);
});

test('initData: expired data and data without a user are refused', () => {
  const token = '123456:TEST';
  const now = Date.now();
  const old = auth.signInitData({ auth_date: String(now / 1000 - 90_000), user: '{"id":1,"first_name":"A"}' }, token);
  assert.equal(auth.validateInitData(old, token, 86_400, now), null);
  const noUser = auth.signInitData({ auth_date: String(now / 1000) }, token);
  assert.equal(auth.validateInitData(noUser, token, 86_400, now), null);
});

test('with DEV_AUTH off, "Authorization: dev N" is not accepted', async () => {
  const { config } = await import('./config.ts');
  config.devAuth = false;
  try {
    assert.equal((await call(123, 'GET', '/groups')).status, 401);
  } finally {
    config.devAuth = true;
  }
});

test('responses carry nosniff and no-referrer headers', async () => {
  const res = await createApp('/nonexistent').request('/healthz');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
});

test('owner rotates the invite code: old link dies, new one works, non-owner gets 403', async () => {
  const owner = nextUser++;
  const guest = nextUser++;
  const g = await group(owner);
  const old = g.inviteCode;
  assert.equal((await call(guest, 'POST', `/groups/${g.id}/invite/rotate`)).status, 404);
  await call(guest, 'POST', `/invite/${old}/join`, {});
  assert.equal((await call(guest, 'POST', `/groups/${g.id}/invite/rotate`)).status, 403);
  assert.equal((await call(owner, 'GET', `/groups/${g.id}`)).body.inviteCode, old);

  const res = await call(owner, 'POST', `/groups/${g.id}/invite/rotate`);
  assert.equal(res.status, 200);
  assert.notEqual(res.body.inviteCode, old);
  assert.equal((await call(guest, 'GET', `/invite/${old}`)).status, 404);
  assert.equal((await call(nextUser++, 'POST', `/invite/${old}/join`, {})).status, 404);
  const fresh = await call(nextUser++, 'POST', `/invite/${res.body.inviteCode}/join`, {});
  assert.equal(fresh.status, 200);

  const log = (await call(owner, 'GET', `/groups/${g.id}/activity`)).body;
  assert.ok(log.items.some((i: Json) => i.action === 'group.invite_rotate'));
});

test('owner removes a Telegram member: they lose access, history stays, only the owner may', async () => {
  const owner = nextUser++;
  const guest = nextUser++;
  const g = await group(owner, ['Маша']);
  await call(guest, 'POST', `/invite/${g.inviteCode}/join`, {});
  const full = (await call(owner, 'GET', `/groups/${g.id}`)).body;
  const guestMember = full.members.find((m: Json) => m.userId === guest);
  const ownerMember = full.members.find((m: Json) => m.userId === owner);
  const masha = full.members.find((m: Json) => m.name === 'Маша');
  await call(guest, 'POST', `/groups/${g.id}/expenses`, exp(full, { payerId: guestMember.id }));
  const url = (id: number) => `/groups/${g.id}/members/${id}/remove`;

  assert.equal((await call(guest, 'POST', url(guestMember.id))).status, 403);
  assert.equal((await call(guest, 'POST', url(ownerMember.id))).status, 403);
  assert.equal((await call(owner, 'POST', url(ownerMember.id))).status, 409);
  assert.equal((await call(owner, 'POST', url(masha.id))).status, 409);
  assert.equal((await call(owner, 'POST', url(999_999))).status, 404);

  const ok = await call(owner, 'POST', url(guestMember.id));
  assert.equal(ok.status, 200);
  const after = ok.body.members.find((m: Json) => m.id === guestMember.id);
  assert.equal(after.userId, null);
  assert.equal(ok.body.expenses.length, 1);
  assert.equal((await call(guest, 'GET', `/groups/${g.id}`)).status, 404);

  const log = (await call(owner, 'GET', `/groups/${g.id}/activity`)).body;
  assert.equal(log.items[0].action, 'member.remove');
  assert.equal(log.items[0].payload.name, guestMember.name);
});
