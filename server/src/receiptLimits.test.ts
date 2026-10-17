import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.DEV_AUTH = '1';
delete process.env.BOT_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

let apiModule: typeof import('./api.ts');
let config: typeof import('./config.ts').config;
let dbModule: typeof import('./db.ts');
let limits: typeof import('./receipts/limits.ts');
let provider: typeof import('./receipts/provider.ts');
let botModule: typeof import('./bot.ts');
let stats: typeof import('./stats.ts');
let account: typeof import('./account.ts');

before(async () => {
  apiModule = await import('./api.ts');
  ({ config } = await import('./config.ts'));
  dbModule = await import('./db.ts');
  limits = await import('./receipts/limits.ts');
  provider = await import('./receipts/provider.ts');
  botModule = await import('./bot.ts');
  stats = await import('./stats.ts');
  account = await import('./account.ts');
  // These tests are about limits and costs; the closed beta has its own file (receiptBeta.test.ts).
  config.receiptsBeta = false;
});
after(() => provider.setReceiptProviderForTests());

// biome-ignore lint/suspicious/noExplicitAny: test helper over untyped JSON
type Json = any;
type Raw = import('./receipts/provider.ts').RawReceipt;

let nextUser = 9000;
const newUser = () => nextUser++;

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
const photo = () => ({ image: JPEG, mediaType: 'image/jpeg' });

const raw = (over: Partial<Raw> = {}): Raw => ({
  isReceipt: true,
  merchant: 'Кафе',
  date: '2026-10-16',
  currencyHint: 'RUB',
  items: [{ name: 'Чай', qty: '1', unitPrice: null, lineTotal: '100.00' }],
  extras: [],
  printedSubtotal: null,
  printedTotal: '100.00',
  confidence: 'high',
  ...over,
});

/** A fake provider: `usage` tokens per call, optional answer/exception. */
function useProvider(usage = { inputTokens: 1000, outputTokens: 200 }, answer: () => Promise<Raw> | Raw = () => raw()) {
  let calls = 0;
  provider.setReceiptProviderForTests({
    async parseReceipt(_image, opts) {
      calls++;
      return { draft: await answer(), usage: { model: opts.model, ...usage } };
    },
  });
  return () => calls;
}

async function setup(consent = true) {
  const u = newUser();
  const g = (await call(u, 'POST', '/groups', { name: 'Ужин', currency: 'RUB' })).body as Json;
  if (consent) await call(u, 'POST', '/me/receipt-consent');
  return { u, g };
}
const parse = (u: number, groupId: number, lang?: string) =>
  call(u, 'POST', `/groups/${groupId}/receipts/parse`, photo(), lang);

afterEach(() => {
  apiModule.receiptsLimiter.reset();
  apiModule.receiptsLimiter.setLimit(10_000);
  config.receiptsGroupTrialMonthly = 5;
  config.receiptsGlobalMonthlyUsd = 10;
  limits.setBudgetNotifier(() => {});
  provider.setReceiptProviderForTests();
  dbModule.run('DELETE FROM receipt_scans');
  dbModule.run('DELETE FROM receipt_notices');
});

test('cost: integer micro-dollars from tokens and configured prices, rounded up', () => {
  assert.equal(limits.costMicroUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }), 600_000);
  assert.equal(limits.costMicroUsd({ inputTokens: 1500, outputTokens: 400 }), 350); // 150 + 200
  assert.equal(limits.costMicroUsd({ inputTokens: 1, outputTokens: 0 }), 1);
});

test('group trial: 5 free scans, then 429 with a translated message and the group quota in the detail', async () => {
  const { u, g } = await setup();
  useProvider();
  assert.deepEqual((await call(u, 'GET', `/groups/${g.id}`)).body.receipts.limit, 5);
  for (let i = 0; i < 5; i++) assert.equal((await parse(u, g.id)).status, 200);
  const over = await parse(u, g.id);
  assert.equal(over.status, 429);
  assert.match(over.body.error, /Бесплатные разборы/);
  assert.match((await parse(u, g.id, 'en')).body.error, /free receipt scans/);
  const r = (await call(u, 'GET', `/groups/${g.id}`)).body.receipts;
  assert.equal(r.used, 5);
  assert.equal(r.limit, 5);
  assert.equal(r.unlimited, false);
  assert.equal(r.enabled, true);
  assert.ok(Date.parse(r.resetsAt) > Date.now());
});

test('the trial belongs to the group: another member shares it, another group has its own', async () => {
  const { u, g } = await setup();
  const friend = newUser();
  await call(friend, 'POST', '/me/receipt-consent');
  await call(friend, 'POST', `/invite/${g.inviteCode}/join`, {});
  useProvider();
  config.receiptsGroupTrialMonthly = 2;
  assert.equal((await parse(u, g.id)).status, 200);
  assert.equal((await parse(friend, g.id)).status, 200);
  assert.equal((await parse(u, g.id)).status, 429);
  const other = (await call(u, 'POST', '/groups', { name: 'Другая', currency: 'RUB' })).body as Json;
  assert.equal((await parse(u, other.id)).status, 200);
});

test('the quota resets on the first of the month (server-local)', async () => {
  const { u, g } = await setup();
  useProvider();
  config.receiptsGroupTrialMonthly = 1;
  assert.equal((await parse(u, g.id)).status, 200);
  assert.equal(limits.canScan(g.id), false);
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 2);
  assert.equal(limits.scanQuota(g.id, nextMonth).used, 0);
  assert.equal(limits.canScan(g.id, nextMonth), true);
  assert.equal(limits.scanQuota(g.id, now).resetsAt, new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString());
});

test('errors and "not a receipt" are free for the group but their cost is recorded', async () => {
  const { u, g } = await setup();
  useProvider(undefined, () => raw({ isReceipt: false }));
  assert.equal((await parse(u, g.id)).status, 400);
  assert.equal(limits.scanQuota(g.id).used, 0);
  const rows = dbModule.all<{ counted: number; cost_micro_usd: number }>('SELECT * FROM receipt_scans');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.counted, 0);
  assert.equal(rows[0]!.cost_micro_usd, 200); // 1000 * 0.1 + 200 * 0.5
  // a provider failure returns no usage: nothing to record, nothing counted
  provider.setReceiptProviderForTests({
    async parseReceipt() {
      throw new provider.ReceiptProviderError('unavailable');
    },
  });
  assert.equal((await parse(u, g.id)).status, 502);
  assert.equal(dbModule.all('SELECT * FROM receipt_scans').length, 1);
  assert.equal(limits.scanQuota(g.id).used, 0);
});

test('the ledger holds numbers only (no receipt content) and a success is counted in stats', async () => {
  const { u, g } = await setup();
  useProvider();
  const before = stats.collectStats().events[1]['receipt.scan'] ?? 0;
  await parse(u, g.id);
  const cols = Object.keys(dbModule.one<Record<string, unknown>>('SELECT * FROM receipt_scans')!);
  assert.deepEqual(cols, [
    'id',
    'user_id',
    'group_id',
    'created_at',
    'model',
    'input_tokens',
    'output_tokens',
    'cost_micro_usd',
    'counted',
  ]);
  assert.equal((stats.collectStats().events[1]['receipt.scan'] ?? 0) - before, 1);
});

test('an active receipts right removes the group limit; an expired one does not; revoke takes it back', async () => {
  const { u, g } = await setup();
  useProvider();
  config.receiptsGroupTrialMonthly = 1;
  assert.equal((await parse(u, g.id)).status, 200);
  assert.equal((await parse(u, g.id)).status, 429);

  assert.ok(limits.grantReceipts(g.inviteCode, null, 1));
  for (let i = 0; i < 3; i++) assert.equal((await parse(u, g.id)).status, 200);
  const r = (await call(u, 'GET', `/groups/${g.id}`)).body.receipts;
  assert.equal(r.unlimited, true);
  assert.equal(r.limit, null);
  assert.equal(r.used, 4);

  // expired
  limits.grantReceipts(g.inviteCode, 1, 1, new Date(Date.now() - 2 * 86_400_000));
  assert.equal(limits.hasReceiptsEntitlement(g.id), false);
  assert.equal((await parse(u, g.id)).status, 429);
  // a short grant is alive until its end
  limits.grantReceipts(g.inviteCode, 7, 1);
  assert.equal(limits.hasReceiptsEntitlement(g.id), true);
  assert.equal(limits.hasReceiptsEntitlement(g.id, new Date(Date.now() + 8 * 86_400_000)), false);

  assert.ok(limits.revokeReceipts(g.inviteCode));
  assert.equal(limits.hasReceiptsEntitlement(g.id), false);
  assert.equal(limits.grantReceipts('nope', null, 1), null);
  assert.equal(limits.revokeReceipts('nope'), null);
});

test('the global ceiling: owner is warned once at 80%, once at 100%, then scanning is off', async () => {
  const { u, g } = await setup();
  const { u: u2, g: g2 } = await setup();
  limits.grantReceipts(g.inviteCode, null, 1);
  limits.grantReceipts(g2.inviteCode, null, 1);
  // 1000 in + 200 out = 200 micro-dollars; cap 0.001 USD = 1000 micro -> 5 scans to the cap, the 4th is 80%
  config.receiptsGlobalMonthlyUsd = 0.001;
  useProvider();
  const notices: string[] = [];
  limits.setBudgetNotifier((kind) => notices.push(kind));
  for (let i = 0; i < 3; i++) await parse(u, g.id);
  assert.deepEqual(notices, []);
  await parse(u, g.id); // 800 = 80%
  assert.deepEqual(notices, ['warn']);
  assert.equal((await call(u, 'GET', `/groups/${g.id}`)).body.receipts.enabled, true);
  await parse(u2, g2.id); // 1000 = 100%
  assert.deepEqual(notices, ['warn', 'stop']);
  const stopped = await parse(u, g.id);
  assert.equal(stopped.status, 503);
  assert.match(stopped.body.error, /временно недоступен/);
  assert.equal((await call(u, 'GET', `/groups/${g.id}`)).body.receipts.enabled, false);
  assert.deepEqual(notices, ['warn', 'stop']); // nothing repeated
  // next month the counter starts over
  assert.equal(limits.budgetExhausted(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 2)), false);
});

test('a single call that jumps over 80% straight to 100% sends only the stop notice', async () => {
  const { u, g } = await setup();
  config.receiptsGlobalMonthlyUsd = 0.0001; // 100 micro-dollars
  useProvider();
  const notices: string[] = [];
  limits.setBudgetNotifier((kind) => notices.push(kind));
  await parse(u, g.id);
  assert.deepEqual(notices, ['stop']);
});

test('rate: 3 requests per minute per user, then 429; another user is not affected', async () => {
  const { u, g } = await setup();
  const { u: other, g: g2 } = await setup();
  apiModule.receiptsLimiter.setLimit(3);
  config.receiptsGroupTrialMonthly = 100;
  useProvider();
  for (let i = 0; i < 3; i++) assert.equal((await parse(u, g.id)).status, 200);
  const res = await parse(u, g.id);
  assert.equal(res.status, 429);
  assert.match(res.body.error, /Слишком часто/);
  assert.equal((await parse(other, g2.id)).status, 200);
});

test('concurrency: a second request of the same user while one is running is refused', async () => {
  const { u, g } = await setup();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  useProvider(undefined, async () => {
    await gate;
    return raw();
  });
  const first = parse(u, g.id);
  await new Promise((r) => setTimeout(r, 20));
  const second = await parse(u, g.id);
  assert.equal(second.status, 429);
  assert.match(second.body.error, /ещё разбирается/);
  release();
  assert.equal((await first).status, 200);
  // the slot is free again
  assert.equal((await parse(u, g.id)).status, 200);
});

test('parallel members cannot slip past the free limit', async () => {
  const { u, g } = await setup();
  const friend = newUser();
  await call(friend, 'POST', '/me/receipt-consent');
  await call(friend, 'POST', `/invite/${g.inviteCode}/join`, {});
  config.receiptsGroupTrialMonthly = 1;
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  useProvider(undefined, async () => {
    await gate;
    return raw();
  });
  const first = parse(u, g.id);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await parse(friend, g.id)).status, 429);
  release();
  assert.equal((await first).status, 200);
});

test('consent: required before parse, can be given, is reported in /me, and is idempotent', async () => {
  const { u, g } = await setup(false);
  const calls = useProvider();
  assert.equal((await call(u, 'GET', '/me')).body.receiptConsent, false);
  const refused = await parse(u, g.id);
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /согласие/);
  assert.equal(calls(), 0);
  assert.equal((await call(u, 'POST', '/me/receipt-consent')).status, 200);
  const stamp = dbModule.one<{ receipt_consent_at: string }>('SELECT receipt_consent_at FROM users WHERE id = ?', u)!;
  assert.ok(stamp.receipt_consent_at);
  await call(u, 'POST', '/me/receipt-consent');
  assert.equal(
    dbModule.one<{ receipt_consent_at: string }>('SELECT receipt_consent_at FROM users WHERE id = ?', u)!
      .receipt_consent_at,
    stamp.receipt_consent_at,
  );
  assert.equal((await call(u, 'GET', '/me')).body.receiptConsent, true);
  assert.equal((await parse(u, g.id)).status, 200);
});

test('the demo group does not scan (it would burn the shared budget)', async () => {
  const u = newUser();
  await call(u, 'POST', '/me/receipt-consent');
  const demo = (await call(u, 'POST', '/demo')).body as Json;
  const calls = useProvider();
  const res = await parse(u, demo.id);
  assert.equal(res.status, 409);
  assert.equal(calls(), 0);
  assert.equal((await call(u, 'GET', `/groups/${demo.id}`)).body.receipts.enabled, false);
});

test('deleting the account removes the consent and detaches the ledger from the person (the spend stays)', async () => {
  const { u, g } = await setup();
  useProvider();
  await parse(u, g.id);
  const friend = newUser();
  await call(friend, 'POST', `/invite/${g.inviteCode}/join`, {});
  assert.equal(dbModule.all('SELECT * FROM receipt_scans WHERE user_id = ?', u).length, 1);
  account.deleteAccount(u);
  assert.equal(dbModule.all('SELECT * FROM receipt_scans WHERE user_id = ?', u).length, 0);
  assert.equal(dbModule.one('SELECT * FROM users WHERE id = ?', u), undefined);
  const row = dbModule.one<{ user_id: number; cost_micro_usd: number }>('SELECT * FROM receipt_scans')!;
  assert.equal(row.user_id, 0);
  assert.equal(row.cost_micro_usd, 200);
  // a returning user has no consent and must agree again
  assert.equal((await call(u, 'GET', '/me')).body.receiptConsent, false);
});

test('deleting a group removes its right', async () => {
  const { u, g } = await setup();
  limits.grantReceipts(g.inviteCode, null, 1);
  account.eraseGroup(g.id);
  assert.equal(dbModule.all('SELECT * FROM group_entitlements WHERE group_id = ?', g.id).length, 0);
  assert.ok(u);
});

test('/grant and /revoke: only an admin, only in a private chat, silent for everyone else', async () => {
  const { g } = await setup();
  const admins = new Set([42]);
  const run = (cmd: 'grant' | 'revoke', args: string, id: number | undefined, chat = 'private') =>
    botModule.ownerCommandReply(cmd, args, id, chat, 'ru', admins);

  assert.equal(run('grant', g.inviteCode, 43), null);
  assert.equal(run('grant', g.inviteCode, undefined), null);
  assert.equal(run('grant', g.inviteCode, 42, 'group'), null);
  assert.equal(run('revoke', g.inviteCode, 43), null);
  assert.equal(limits.hasReceiptsEntitlement(g.id), false);

  assert.match(run('grant', g.inviteCode, 42)!, /без лимита бессрочно/);
  assert.equal(limits.hasReceiptsEntitlement(g.id), true);
  assert.match(run('grant', `${g.inviteCode} 30`, 42)!, /до \d{4}-\d{2}-\d{2}/);
  const row = dbModule.one<{ source: string; granted_by: number; expires_at: string }>(
    'SELECT * FROM group_entitlements WHERE group_id = ?',
    g.id,
  )!;
  assert.equal(row.source, 'admin');
  assert.equal(row.granted_by, 42);
  assert.ok(row.expires_at);

  assert.match(run('grant', '', 42)!, /Формат/);
  assert.match(run('grant', `${g.inviteCode} abc`, 42)!, /Формат/);
  assert.match(run('grant', `${g.inviteCode} 0`, 42)!, /Формат/);
  assert.match(run('grant', 'nope', 42)!, /не найдена/);
  assert.match(run('revoke', g.inviteCode, 42)!, /закрыт/);
  assert.equal(limits.hasReceiptsEntitlement(g.id), false);
  assert.match(run('revoke', 'nope', 42)!, /не найдена/);
});
