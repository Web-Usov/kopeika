import assert from 'node:assert/strict';
import { afterEach, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.DEV_AUTH = '1';
delete process.env.BOT_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

let apiModule: typeof import('./api.ts');
let config: typeof import('./config.ts').config;
let dbModule: typeof import('./db.ts');
let limits: typeof import('./receipts/limits.ts');
let access: typeof import('./receipts/access.ts');
let provider: typeof import('./receipts/provider.ts');
let botModule: typeof import('./bot.ts');
let stats: typeof import('./stats.ts');

before(async () => {
  apiModule = await import('./api.ts');
  ({ config } = await import('./config.ts'));
  dbModule = await import('./db.ts');
  limits = await import('./receipts/limits.ts');
  access = await import('./receipts/access.ts');
  provider = await import('./receipts/provider.ts');
  botModule = await import('./bot.ts');
  stats = await import('./stats.ts');
  apiModule.receiptsLimiter.setLimit(10_000);
});

// biome-ignore lint/suspicious/noExplicitAny: test helper over untyped JSON
type Json = any;

const ADMIN = 4242;
let nextUser = 20_000;
const newUser = () => nextUser++;

type Sent = { userId: number; text: string; keys: string[] };
let sent: Sent[] = [];

afterEach(() => {
  config.receiptsBeta = true;
  config.receiptsGroupTrialMonthly = 5;
  config.adminUserIds = new Set([ADMIN]);
  botModule.setBotTestHooks();
  provider.setReceiptProviderForTests();
  dbModule.run('DELETE FROM receipt_scans');
  dbModule.run('DELETE FROM receipt_access_requests');
  dbModule.run('DELETE FROM group_entitlements');
  sent = [];
});

function hookBot() {
  botModule.setBotTestHooks({
    sendMessage: async (userId, text, extra) => {
      const rows = (extra?.reply_markup as { inline_keyboard?: { callback_data?: string }[][] } | undefined)
        ?.inline_keyboard;
      sent.push({ userId, text, keys: (rows ?? []).flat().map((b) => b.callback_data ?? '') });
    },
  });
}

async function call(user: number, method: string, path: string, body?: unknown, lang?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `dev ${user}` };
  if (lang) headers['X-Lang'] = lang;
  const res = await apiModule.api.request(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Json };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0]).toString('base64');
const photo = { image: JPEG, mediaType: 'image/jpeg' };

function useProvider() {
  provider.setReceiptProviderForTests({
    async parseReceipt(_image, opts) {
      return {
        draft: {
          isReceipt: true,
          merchant: 'Кафе',
          date: '2026-10-16',
          currencyHint: 'RUB',
          items: [{ name: 'Чай', qty: '1', unitPrice: null, lineTotal: '100.00' }],
          extras: [],
          printedSubtotal: null,
          printedTotal: '100.00',
          confidence: 'high',
        },
        usage: { model: opts.model, inputTokens: 1000, outputTokens: 200 },
      };
    },
  });
}

async function setup() {
  const u = newUser();
  const g = (await call(u, 'POST', '/groups', { name: 'Ужин', currency: 'RUB' })).body as Json;
  await call(u, 'POST', '/me/receipt-consent');
  useProvider(); // the feature is "on" (a recognition key is configured)
  return { u, g };
}
const parse = (u: number, groupId: number, lang?: string) =>
  call(u, 'POST', `/groups/${groupId}/receipts/parse`, photo, lang);
const requestAccess = (u: number, groupId: number, lang?: string) =>
  call(u, 'POST', `/groups/${groupId}/receipts/access-request`, {}, lang);
const detail = async (u: number, groupId: number) => (await call(u, 'GET', `/groups/${groupId}`)).body.receipts;

/** A fake Telegram: runs the callback handler and records what it answered and edited. */
async function press(data: string, fromId: number) {
  const out = { answers: [] as (string | undefined)[], edits: [] as string[] };
  await botModule.handleAccessCallback(
    data,
    { id: fromId, first_name: 'Алексей', language_code: 'ru' },
    {
      answer: async (text) => void out.answers.push(text),
      edit: async (text) => void out.edits.push(text),
    },
    new Set([ADMIN]),
  );
  return out;
}

test('beta: parse is 403 for a group without access (translated), before consent and limits', async () => {
  useProvider();
  const u = newUser();
  const g = (await call(u, 'POST', '/groups', { name: 'Ужин', currency: 'RUB' })).body as Json;
  // No consent given: the access check still comes first.
  const ru = await parse(u, g.id);
  assert.equal(ru.status, 403);
  assert.match(ru.body.error, /бета-тесте/);
  assert.match((await parse(u, g.id, 'en')).body.error, /in beta/);
  const r = await detail(u, g.id);
  assert.deepEqual([r.beta, r.access, r.enabled], [true, 'none', false]);
});

test('beta: a stranger cannot request or scan; the demo group is closed', async () => {
  const { g } = await setup();
  const stranger = newUser();
  assert.equal((await requestAccess(stranger, g.id)).status, 404);
  assert.equal((await parse(stranger, g.id)).status, 404);
});

test('request: stored once while pending, owner gets one message with two buttons, event is counted', async () => {
  hookBot();
  provider.setReceiptProviderForTests({ parseReceipt: async () => assert.fail() });
  const { u, g } = await setup();
  const first = await requestAccess(u, g.id);
  assert.equal(first.status, 201);
  assert.equal(first.body.receipts.access, 'pending');
  const again = await requestAccess(u, g.id);
  assert.equal(again.status, 200);
  assert.equal(
    dbModule.one<{ n: number }>('SELECT COUNT(*) AS n FROM receipt_access_requests WHERE group_id = ?', g.id)?.n,
    1,
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0].userId, ADMIN);
  assert.match(sent[0].text, /«Ужин»/);
  assert.match(sent[0].text, new RegExp(g.inviteCode));
  const id = dbModule.one<{ id: number }>('SELECT id FROM receipt_access_requests WHERE group_id = ?', g.id)!.id;
  assert.deepEqual(sent[0].keys, [`rb:a:${id}`, `rb:r:${id}`]);
  assert.ok(sent[0].keys.every((k) => Buffer.byteLength(k) <= 64));
  assert.equal(stats.collectStats().events[1]['receipt.access'], 1);
  assert.equal((await parse(u, g.id)).status, 403);
});

test('request: demo group is 409; no admins configured still saves it', async () => {
  useProvider();
  const u = newUser();
  const demo = (await call(u, 'POST', '/demo')).body as Json;
  assert.equal((await requestAccess(u, demo.id)).status, 409);

  config.adminUserIds = new Set();
  hookBot();
  const { u: u2, g } = await setup();
  assert.equal((await requestAccess(u2, g.id)).status, 201);
  assert.equal(sent.length, 0);
  assert.equal((await detail(u2, g.id)).access, 'pending');
});

test('approve: group gets 5 free scans (not unlimited), requester is told in their language, message edited', async () => {
  hookBot();
  useProvider();
  const { u, g } = await setup();
  dbModule.run('UPDATE users SET lang = ? WHERE id = ?', 'en', u);
  await requestAccess(u, g.id);
  const id = dbModule.one<{ id: number }>('SELECT id FROM receipt_access_requests WHERE group_id = ?', g.id)!.id;
  sent = [];

  const out = await press(`rb:a:${id}`, ADMIN);
  assert.equal(out.edits.length, 1);
  assert.match(out.edits[0], /Доступ открыт · Алексей/);
  assert.deepEqual(out.answers, [undefined]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].userId, u);
  assert.match(sent[0].text, /Receipt scanning is open for “Ужин”/);

  const r = await detail(u, g.id);
  assert.deepEqual([r.access, r.enabled, r.unlimited, r.limit], ['approved', true, false, 5]);
  for (let i = 0; i < 5; i++) assert.equal((await parse(u, g.id)).status, 200);
  assert.equal((await parse(u, g.id)).status, 429);

  // A second press (or a second admin) changes nothing and tells so.
  const late = await press(`rb:r:${id}`, ADMIN);
  assert.match(late.answers[0] ?? '', /Уже решено/);
  assert.equal(late.edits.length, 0);
  assert.equal((await detail(u, g.id)).access, 'approved');
});

test('reject: nothing opens, requester is told, 24h cooldown, then a new request is possible', async () => {
  hookBot();
  const { u, g } = await setup();
  await requestAccess(u, g.id);
  const id = dbModule.one<{ id: number }>('SELECT id FROM receipt_access_requests WHERE group_id = ?', g.id)!.id;
  sent = [];
  const out = await press(`rb:r:${id}`, ADMIN);
  assert.match(out.edits[0], /Отклонено · Алексей/);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /через сутки/);
  assert.equal((await detail(u, g.id)).access, 'rejected');
  assert.equal((await parse(u, g.id)).status, 403);

  const soon = await requestAccess(u, g.id);
  assert.equal(soon.status, 429);
  assert.match(soon.body.error, /через сутки/);
  assert.equal(dbModule.one<{ n: number }>('SELECT COUNT(*) AS n FROM receipt_access_requests')?.n, 1);

  const later = new Date(Date.now() + 25 * 3600_000);
  assert.deepEqual(access.requestAccess(g.id, u, later).created, true);
  assert.equal(access.accessState(g.id, later), 'pending');
});

test('callback: only an admin decides; anyone else gets an error and nothing changes', async () => {
  hookBot();
  const { u, g } = await setup();
  await requestAccess(u, g.id);
  const id = dbModule.one<{ id: number }>('SELECT id FROM receipt_access_requests WHERE group_id = ?', g.id)!.id;
  sent = [];
  const out = await press(`rb:a:${id}`, u);
  assert.match(out.answers[0] ?? '', /только владелец/);
  assert.equal(out.edits.length, 0);
  assert.equal(sent.length, 0);
  assert.equal((await detail(u, g.id)).access, 'pending');
  assert.match((await press('rb:a:999999', ADMIN)).answers[0] ?? '', /не найден/);
  assert.deepEqual((await press('garbage', ADMIN)).answers, [undefined]);
});

test('/grant: unlimited, implies access in the beta; /revoke takes both rights back', async () => {
  useProvider();
  const { u, g } = await setup();
  config.receiptsGroupTrialMonthly = 1;
  limits.grantReceipts(g.inviteCode, null, ADMIN);
  assert.equal((await detail(u, g.id)).access, 'approved');
  for (let i = 0; i < 3; i++) assert.equal((await parse(u, g.id)).status, 200);

  const run = (cmd: 'grant' | 'revoke' | 'beta', args: string, id: number | undefined, chat = 'private') =>
    botModule.ownerCommandReply(cmd, args, id, chat, 'ru', new Set([ADMIN]));
  assert.match(run('beta', g.inviteCode, ADMIN)!, /получила доступ/);
  assert.match(run('revoke', g.inviteCode, ADMIN)!, /закрыт/);
  assert.equal(
    dbModule.one<{ n: number }>('SELECT COUNT(*) AS n FROM group_entitlements WHERE group_id = ?', g.id)?.n,
    0,
  );
  assert.equal((await parse(u, g.id)).status, 403);
});

test('/beta: opens access without a request, closes a pending one; silent for others; /requests lists pending', async () => {
  hookBot();
  useProvider();
  const { u, g } = await setup();
  const run = (args: string, id: number | undefined, chat = 'private') =>
    botModule.ownerCommandReply('beta', args, id, chat, 'ru', new Set([ADMIN]));
  assert.equal(run(g.inviteCode, u), null);
  assert.equal(run(g.inviteCode, ADMIN, 'group'), null);
  assert.equal(access.hasReceiptsAccess(g.id), false);
  assert.match(run('', ADMIN)!, /Формат/);
  assert.match(run('nope', ADMIN)!, /не найдена/);

  const req = (id: number | undefined, chat = 'private') => botModule.requestsReply(id, chat, 'ru', new Set([ADMIN]));
  assert.equal(req(u), null);
  assert.equal(req(ADMIN, 'group'), null);
  assert.match(req(ADMIN)!, /нет/);
  await requestAccess(u, g.id);
  const list = req(ADMIN)!;
  assert.match(list, /«Ужин»/);
  assert.match(list, new RegExp(`/beta ${g.inviteCode}`));

  assert.match(run(g.inviteCode, ADMIN)!, /«Ужин»/);
  assert.equal(req(ADMIN), 'Запросов на доступ нет');
  const r = await detail(u, g.id);
  assert.deepEqual([r.access, r.unlimited, r.limit], ['approved', false, 5]);
  assert.equal((await parse(u, g.id)).status, 200);
});

test('RECEIPTS_BETA=0 keeps the old behaviour: no approval needed, trial limit applies', async () => {
  config.receiptsBeta = false;
  useProvider();
  const { u, g } = await setup();
  const r = await detail(u, g.id);
  assert.deepEqual([r.beta, r.access, r.enabled], [false, 'approved', true]);
  assert.equal((await parse(u, g.id)).status, 200);
});

test('without a recognition key the feature is not offered and a request is refused', async () => {
  const { u, g } = await setup();
  provider.setReceiptProviderForTests();
  const r = await detail(u, g.id);
  assert.deepEqual([r.offered, r.enabled], [false, false]);
  assert.equal((await requestAccess(u, g.id)).status, 503);
});
