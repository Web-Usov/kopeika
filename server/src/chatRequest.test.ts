import assert from 'node:assert/strict';
import { before, test } from 'node:test';

// config.ts and db.ts read env at import time, so set it before the dynamic import.
process.env.DB_PATH = ':memory:';
process.env.DEV_AUTH = '1';
delete process.env.BOT_TOKEN;

let api: typeof import('./api.ts').api;
let chatLink: typeof import('./chatLink.ts');
let db: typeof import('./db.ts');
let botModule: typeof import('./bot.ts');
before(async () => {
  ({ api } = await import('./api.ts'));
  botModule = await import('./bot.ts');
  db = await import('./db.ts');
  chatLink = await import('./chatLink.ts');
});

let nextUser = 5000;
const newUser = () => nextUser++;
let nextChat = -100500;
const newChat = () => nextChat--;
const BOT = 424242;

// biome-ignore lint/suspicious/noExplicitAny: test helper over untyped JSON
type Json = any;

async function call(user: number, method: string, path: string, body?: unknown) {
  const res = await api.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `dev ${user}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Json };
}

async function createGroup(user: number) {
  const res = await call(user, 'POST', '/groups', { name: 'Поездка', currency: 'RUB', memberNames: [] });
  assert.equal(res.status, 201);
  return res.body as Json;
}

test('chat request endpoint: prepared button, demo 409, non-member 404, bot unavailable 503', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const seen: number[] = [];
  try {
    botModule.setBotTestHooks({
      prepareChatButton: async (_user, requestId) => {
        seen.push(requestId);
        return 'btn-1';
      },
    });
    const res = await call(u, 'POST', `/groups/${g.id}/chat/request`);
    assert.equal(res.status, 200);
    assert.equal(res.body.id, 'btn-1');
    assert.ok(Number.isInteger(seen[0]) && seen[0] > 0 && seen[0] < 2 ** 31);
    assert.equal(db.one<{ user_id: number }>('SELECT * FROM chat_requests WHERE id = ?', seen[0])?.user_id, u);
    assert.equal((await call(newUser(), 'POST', `/groups/${g.id}/chat/request`)).status, 404);
    const demo = await call(u, 'POST', '/demo');
    assert.equal((await call(u, 'POST', `/groups/${demo.body.id}/chat/request`)).status, 409);
    botModule.setBotTestHooks({
      prepareChatButton: async () => {
        throw new Error('boom');
      },
    });
    assert.equal((await call(u, 'POST', `/groups/${g.id}/chat/request`)).status, 503);
    botModule.setBotTestHooks();
    const none = await call(u, 'POST', `/groups/${g.id}/chat/request`);
    assert.equal(none.status, 503);
    assert.match(none.body.error, /недоступен/);
  } finally {
    botModule.setBotTestHooks();
  }
});

test('chat_shared: valid request links the chat; other user, reuse, expiry, non-admin, bot missing are refused', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const chatId = newChat();
  const roles =
    (user: string, bot = 'administrator') =>
    async (_chat: number, id: number) =>
      id === BOT ? bot : user;
  const shared = (requestId: number, chat = chatId) => ({
    userId: u,
    botId: BOT,
    requestId,
    chatId: chat,
    title: 'Друзья',
  });
  const linked = () =>
    db.one<{ chat_id: number | null; chat_title: string | null }>('SELECT * FROM groups WHERE id = ?', g.id);

  let req = chatLink.createChatRequest(u, g.id);
  // someone else's request and an unknown id look the same
  assert.deepEqual(await chatLink.handleChatShared({ ...shared(req), userId: newUser() }, roles('creator')), {
    ok: false,
    problem: 'invalid',
  });
  assert.deepEqual(await chatLink.handleChatShared(shared(1), roles('creator')), { ok: false, problem: 'invalid' });
  // refusals leave the request usable and the group untouched
  assert.deepEqual(await chatLink.handleChatShared(shared(req), roles('member')), { ok: false, problem: 'notAdmin' });
  assert.deepEqual(await chatLink.handleChatShared(shared(req), roles('creator', 'left')), {
    ok: false,
    problem: 'botMissing',
  });
  assert.deepEqual(
    await chatLink.handleChatShared(shared(req), async () => {
      throw new Error('x');
    }),
    { ok: false, problem: 'unavailable' },
  );
  assert.deepEqual(await chatLink.handleChatShared(shared(req), async () => null), {
    ok: false,
    problem: 'unavailable',
  });
  assert.equal(linked()?.chat_id, null);
  // success
  const ok = await chatLink.handleChatShared(shared(req), roles('administrator'));
  assert.equal(ok.ok, true);
  assert.equal(linked()?.chat_id, chatId);
  assert.equal(linked()?.chat_title, 'Друзья');
  const log = db.one<{ action: string }>(
    "SELECT action FROM activity WHERE group_id = ? AND action = 'group.chat_link'",
    g.id,
  );
  assert.ok(log);
  // one use only
  assert.deepEqual(await chatLink.handleChatShared(shared(req), roles('creator')), { ok: false, problem: 'used' });
  // expired
  req = chatLink.createChatRequest(u, g.id, new Date(Date.now() - 3600_000));
  assert.deepEqual(await chatLink.handleChatShared(shared(req, newChat()), roles('creator')), {
    ok: false,
    problem: 'expired',
  });
  // demo group
  const demo = await call(u, 'POST', '/demo');
  req = chatLink.createChatRequest(u, demo.body.id);
  assert.deepEqual(await chatLink.handleChatShared(shared(req, newChat()), roles('creator')), {
    ok: false,
    problem: 'demo',
  });
  // the user left the group meanwhile
  const g2 = await createGroup(u);
  req = chatLink.createChatRequest(u, g2.id);
  db.run('DELETE FROM members WHERE group_id = ? AND user_id = ?', g2.id, u);
  assert.deepEqual(await chatLink.handleChatShared(shared(req, newChat()), roles('creator')), {
    ok: false,
    problem: 'invalid',
  });
});

test('chat_shared: two concurrent updates for one request link the chat once', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const chatId = newChat();
  const req = chatLink.createChatRequest(u, g.id);
  // The lookup is held until both calls have passed their checks, so both reach the claim step.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const lookup = async (_chat: number, id: number) => {
    await gate;
    return id === BOT ? 'administrator' : 'creator';
  };
  const input = { userId: u, botId: BOT, requestId: req, chatId, title: 'Друзья' };
  const first = chatLink.handleChatShared(input, lookup);
  const second = chatLink.handleChatShared(input, lookup);
  release();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((r) => r.ok).sort(), [false, true]);
  assert.deepEqual(
    results.find((r) => !r.ok),
    { ok: false, problem: 'used' },
  );
  assert.equal(
    db.one<{ n: number }>("SELECT COUNT(*) n FROM activity WHERE group_id = ? AND action = 'group.chat_link'", g.id)?.n,
    1,
  );
});

test('chat_shared replies exist in both languages for every outcome', () => {
  const ok = { ok: true as const, group: { name: 'Дача' } as never };
  assert.equal(
    botModule.chatSharedReply('ru', ok, 'Друзья', 'kopeika_bot'),
    'Готово: чат «Друзья» привязан к группе «Дача»',
  );
  assert.match(botModule.chatSharedReply('en', ok, 'Friends', 'b'), /^Done: the chat “Friends”/);
  for (const problem of ['invalid', 'expired', 'used', 'demo', 'notAdmin', 'botMissing', 'unavailable'] as const) {
    const ru = botModule.chatSharedReply('ru', { ok: false, problem }, 'x', 'kopeika_bot');
    const en = botModule.chatSharedReply('en', { ok: false, problem }, 'x', 'kopeika_bot');
    assert.notEqual(ru, en);
  }
  assert.match(
    botModule.chatSharedReply('en', { ok: false, problem: 'botMissing' }, 'x', 'kopeika_bot'),
    /@kopeika_bot/,
  );
});
