import './test-env.ts';
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, test } from 'node:test';
import { createT } from '../../shared/i18n/index.ts';

process.env.DEV_AUTH = '1';
delete process.env.BOT_TOKEN;

let alerts: typeof import('./alerts.ts');
let api: typeof import('./api.ts').api;
let clientErrorsLimiter: typeof import('./api.ts').clientErrorsLimiter;
let config: typeof import('./config.ts').config;
let setBotTestHooks: typeof import('./bot.ts').setBotTestHooks;
before(async () => {
  alerts = await import('./alerts.ts');
  ({ api, clientErrorsLimiter } = await import('./api.ts'));
  ({ config } = await import('./config.ts'));
  ({ setBotTestHooks } = await import('./bot.ts'));
});

const ev = (message: string, at = 'at f (a.js:1:1)') => ({
  source: 'server' as const,
  message,
  at,
  version: 'v1',
});

function fakeAlerter() {
  let time = 1_000_000;
  const sent: { count: number; first: boolean; message: string }[] = [];
  const a = alerts.createAlerter({
    now: () => time,
    send: async (m) => {
      sent.push({ count: m.count, first: m.first, message: m.message });
    },
  });
  return { a, sent, advance: (ms: number) => (time += ms) };
}

test('the first occurrence is sent at once, repeats within an hour are folded', async () => {
  const { a, sent, advance } = fakeAlerter();
  await a.report(ev('boom'));
  assert.equal(sent.length, 1);
  assert.deepEqual([sent[0]!.first, sent[0]!.count], [true, 1]);
  for (let i = 0; i < 5; i++) {
    advance(60_000);
    await a.report(ev('boom'));
  }
  assert.equal(sent.length, 1);
  advance(alerts.HOUR_MS);
  await a.report(ev('boom'));
  assert.equal(sent.length, 2);
  assert.deepEqual([sent[1]!.first, sent[1]!.count], [false, 6]);
});

test('different messages or first stack lines are different groups', async () => {
  const { a, sent } = fakeAlerter();
  await a.report(ev('a'));
  await a.report(ev('b'));
  await a.report(ev('a', 'at g (b.js:2:2)'));
  await a.report(ev('a'));
  assert.equal(sent.length, 3);
});

test('at most 20 alerts an hour, then the rest wait for the window', async () => {
  const { a, sent, advance } = fakeAlerter();
  for (let i = 0; i < 30; i++) await a.report(ev(`err ${i}`));
  assert.equal(sent.length, alerts.MAX_ALERTS_PER_HOUR);
  advance(alerts.HOUR_MS + 1);
  await a.report(ev('err 25'));
  assert.equal(sent.length, alerts.MAX_ALERTS_PER_HOUR + 1);
});

test('disabled or unable to send: nothing is sent', async () => {
  let on = false;
  const sent: unknown[] = [];
  const a = alerts.createAlerter({ enabled: () => on, send: async (m) => void sent.push(m) });
  await a.report(ev('x'));
  assert.equal(sent.length, 0);
  on = true;
  await a.report(ev('x'));
  assert.equal(sent.length, 1);
});

test('alert text is in the admin language', () => {
  const m = { ...ev('Error: boom'), count: 3, first: false };
  assert.match(alerts.alertText(createT('ru'), m), /Ошибка \(сервер\)[\s\S]*Версия: v1[\s\S]*3/);
  assert.match(alerts.alertText(createT('en'), m), /Error \(server\)[\s\S]*Version: v1/);
});

// --- through the API, with the bot replaced by a recorder ---

const messages: { id: number; text: string }[] = [];
let warns: string[] = [];
const origWarn = console.warn;
const origError = console.error;
const origAdmins = new Set<number>();
const clientLines = () => warns.filter((l) => l.startsWith('client error'));

beforeEach(() => {
  messages.length = 0;
  warns = [];
  console.warn = (...a: unknown[]) => void warns.push(a.join(' '));
  console.error = () => {};
  origAdmins.clear();
  for (const id of config.adminUserIds) origAdmins.add(id);
  config.adminUserIds.clear();
  config.adminUserIds.add(777);
  config.errorAlerts = true;
  setBotTestHooks({ sendMessage: async (id, text) => void messages.push({ id, text }) });
  alerts.alerter.reset();
  clientErrorsLimiter.reset();
});
afterEach(() => {
  console.warn = origWarn;
  console.error = origError;
  config.adminUserIds.clear();
  for (const id of origAdmins) config.adminUserIds.add(id);
  setBotTestHooks();
});

const report = {
  kind: 'error',
  message: 'TypeError: x is undefined',
  stack: 'TypeError: x is undefined\n    at f (https://app.example/assets/a.js:1:2)',
  route: '/g/12/expense/345',
  version: 'v1.2.3',
  platform: 'android',
  tgVersion: '9.1',
};

function post(body: unknown, user = 91_001, extraHeaders: Record<string, string> = {}) {
  return api.request('/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `dev ${user}`, ...extraHeaders },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('POST /client-errors needs auth', async () => {
  const res = await api.request('/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
  assert.equal(res.status, 401);
});

test('a valid report: 204, one log line, one alert to the admin', async () => {
  const res = await post(report);
  assert.equal(res.status, 204);
  assert.equal(clientLines().length, 1);
  assert.ok(!clientLines()[0]!.includes('\n'));
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.id, 777);
  assert.match(messages[0]!.text, /TypeError: x is undefined/);
  assert.match(messages[0]!.text, /v1\.2\.3/);
  assert.match(messages[0]!.text, /\/g\/:id\/expense\/:eid/);
  // the same error from another user: logged, but no second message
  await post(report, 91_002);
  assert.equal(clientLines().length, 2);
  assert.equal(messages.length, 1);
});

test('extra fields are refused, nothing is logged or sent', async () => {
  for (const extra of [{ initData: 'query_id=AAA&hash=secret' }, { userName: 'Иван' }, { amount: 100 }]) {
    const res = await post({ ...report, ...extra });
    assert.equal(res.status, 400);
  }
  assert.equal(clientLines().length, 0);
  assert.equal(messages.length, 0);
});

test('long fields are cut, query strings and launch params are scrubbed, ids leave the route', async () => {
  const res = await post({
    ...report,
    message: `Boom tgWebAppData=user%3Dsecret&hash=deadbeef ${'x'.repeat(5000)}`,
    stack: 'at a (https://x.ru/a.js?token=SECRET:1:1)\n'.repeat(50),
    route: '/join/INVITECODE?startapp=SECRET',
  });
  assert.equal(res.status, 204);
  const line = clientLines()[0]!;
  const logged = JSON.parse(line.slice('client error '.length));
  assert.ok(logged.message.length <= 300);
  assert.ok(logged.stack.split('\n').length <= 5);
  assert.equal(logged.route, '/join/:code');
  for (const secret of ['deadbeef', 'SECRET', 'INVITECODE', 'user%3D']) assert.ok(!line.includes(secret), secret);
});

test('request headers (initData, dev name) never reach the log or the alert', async () => {
  const bad = await post(report, 91_001, { Authorization: 'tma query_id=AAHsecretquery&hash=abcdef0123456789' });
  assert.equal(bad.status, 401);
  const ok = await post(report, 91_003, { 'X-Dev-Name': encodeURIComponent('Иван Секретов') });
  assert.equal(ok.status, 204);
  const everything = [...warns, ...messages.map((m) => m.text)].join('\n');
  for (const secret of ['secretquery', 'abcdef0123456789', 'Секретов']) assert.ok(!everything.includes(secret));
});

test('empty message, unknown kind, missing field are 400; big bodies are 413', async () => {
  assert.equal((await post({ ...report, message: '   ' })).status, 400);
  assert.equal((await post({ ...report, kind: 'other' })).status, 400);
  assert.equal((await post({ ...report, version: undefined })).status, 400);
  assert.equal((await post({ ...report, stack: 'x'.repeat(9 * 1024) })).status, 413);
});

test('per-user rate limit', async () => {
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await post({ ...report, message: `m${i}` }, 91_010)).status;
  assert.equal(last, 429);
  assert.equal((await post(report, 91_011)).status, 204);
});

test('ERROR_ALERTS=0: logged, not sent', async () => {
  config.errorAlerts = false;
  assert.equal((await post(report)).status, 204);
  assert.equal(clientLines().length, 1);
  assert.equal(messages.length, 0);
});

test('no admins: nothing is sent and nothing breaks', async () => {
  config.adminUserIds.clear();
  assert.equal((await post(report)).status, 204);
  assert.equal(messages.length, 0);
});

test('describeServerError does not quote request data of a JSON error', () => {
  let err: unknown;
  try {
    JSON.parse('{"secret": Иван}');
  } catch (e) {
    err = e;
  }
  assert.ok(!alerts.describeServerError(err).message.includes('Иван'));
  const d = alerts.describeServerError(new RangeError('bad range'));
  assert.equal(d.message, 'RangeError: bad range');
  assert.match(d.at, /^at /);
});

test('server errors alert the admin once; fatal handlers alert and exit with 1', async () => {
  const locked = new Error('db is locked');
  await alerts.reportServerError(locked);
  await alerts.reportServerError(locked);
  assert.equal(messages.length, 1);
  assert.match(messages[0]!.text, /db is locked/);

  const handlers = new Map<string, (e: unknown) => Promise<void>>();
  const fakeProc = { on: (n: string, h: (e: unknown) => Promise<void>) => void handlers.set(n, h) };
  const codes: number[] = [];
  alerts.installProcessHandlers(fakeProc as unknown as NodeJS.Process, (c) => void codes.push(c));
  await handlers.get('unhandledRejection')!(new Error('rejected for real'));
  await handlers.get('uncaughtException')!(new Error('second one'));
  assert.deepEqual(codes, [1]);
  assert.ok(messages.some((m) => m.text.includes('rejected for real')));
});
