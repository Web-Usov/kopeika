import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

// config.ts reads env at import time: the openrouter provider with its per-provider defaults.
process.env.DB_PATH = ':memory:';
process.env.DEV_AUTH = '1';
process.env.RECEIPTS_PROVIDER = 'openrouter';
process.env.OPENROUTER_API_KEY = 'sk-or-test';
delete process.env.BOT_TOKEN;
delete process.env.ANTHROPIC_API_KEY;
for (const k of [
  'RECEIPTS_MODEL',
  'RECEIPTS_FALLBACK_MODEL',
  'RECEIPTS_REASONING',
  'RECEIPTS_FALLBACK_REASONING',
  'RECEIPTS_PRICE_IN_USD_PER_M',
  'RECEIPTS_PRICE_OUT_USD_PER_M',
]) {
  delete process.env[k];
}

let apiModule: typeof import('./api.ts');
let config: typeof import('./config.ts').config;
let dbModule: typeof import('./db.ts');
let provider: typeof import('./receipts/provider.ts');

before(async () => {
  apiModule = await import('./api.ts');
  ({ config } = await import('./config.ts'));
  dbModule = await import('./db.ts');
  provider = await import('./receipts/provider.ts');
  apiModule.receiptsLimiter.setLimit(10_000);
  config.receiptsGroupTrialMonthly = 10_000;
  config.receiptsBeta = false;
});
after(() => provider.setReceiptProviderForTests());

// biome-ignore lint/suspicious/noExplicitAny: test helper over untyped JSON
type Json = any;
type Raw = import('./receipts/provider.ts').RawReceipt;

let nextUser = 12000;
async function call(user: number, method: string, path: string, body?: unknown) {
  const res = await apiModule.api.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `dev ${user}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Json };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0]).toString('base64');
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
const bad = () => raw({ printedTotal: '999.00' });

function useProvider(fn: (n: number) => Raw) {
  const calls: { model: string; reasoning?: string }[] = [];
  provider.setReceiptProviderForTests({
    async parseReceipt(_image, opts) {
      calls.push({ model: opts.model, reasoning: opts.reasoning });
      return {
        draft: fn(calls.length),
        usage: { model: opts.model, inputTokens: 1_000_000, outputTokens: 100_000 },
      };
    },
  });
  return calls;
}

async function scan() {
  const u = nextUser++;
  const g = (await call(u, 'POST', '/groups', { name: 'Ужин', currency: 'RUB' })).body;
  await call(u, 'POST', '/me/receipt-consent');
  dbModule.run('DELETE FROM receipt_scans');
  return call(u, 'POST', `/groups/${g.id}/receipts/parse`, { image: JPEG, mediaType: 'image/jpeg' });
}

test('openrouter cascade: same model, second attempt with the fallback reasoning; both attempts are billed', async () => {
  const calls = useProvider((n) => (n === 1 ? bad() : raw()));
  const res = await scan();
  assert.equal(res.status, 200);
  assert.equal(res.body.mismatch, false);
  assert.deepEqual(calls, [
    { model: 'qwen/qwen3.5-35b-a3b', reasoning: 'none' },
    { model: 'qwen/qwen3.5-35b-a3b', reasoning: 'low' },
  ]);
  const rows = dbModule.all<{ cost_micro_usd: number; counted: number }>('SELECT * FROM receipt_scans ORDER BY id');
  assert.equal(rows.length, 2);
  // 1M in x 0.15 + 0.1M out x 1.0 = 0.25 USD per attempt with the openrouter default prices
  assert.deepEqual(
    rows.map((r) => r.cost_micro_usd),
    [250_000, 250_000],
  );
  assert.deepEqual(
    rows.map((r) => r.counted),
    [1, 0],
  );
});

test('openrouter: no second attempt when the lines add up', async () => {
  const calls = useProvider(() => raw());
  await scan();
  assert.equal(calls.length, 1);
  assert.equal(dbModule.all('SELECT * FROM receipt_scans').length, 1);
});

test('no cascade when the fallback is off; another model keeps its own step', async () => {
  const saved = config.receiptsFallbackModel;
  try {
    config.receiptsFallbackModel = '';
    let calls = useProvider(() => bad());
    assert.equal((await scan()).body.mismatch, true);
    assert.equal(calls.length, 1);

    config.receiptsFallbackModel = 'qwen/qwen3.6-35b-a3b';
    calls = useProvider(() => bad());
    await scan();
    assert.deepEqual(calls, [
      { model: 'qwen/qwen3.5-35b-a3b', reasoning: 'none' },
      { model: 'qwen/qwen3.6-35b-a3b', reasoning: 'low' },
    ]);
  } finally {
    config.receiptsFallbackModel = saved;
  }
});

test('same model and same reasoning is not retried', async () => {
  const saved = config.receiptsFallbackReasoning;
  try {
    config.receiptsFallbackReasoning = config.receiptsReasoning;
    const calls = useProvider(() => bad());
    await scan();
    assert.equal(calls.length, 1);
  } finally {
    config.receiptsFallbackReasoning = saved;
  }
});

test('explicit env values win over the openrouter defaults; junk reasoning falls back with a warning', async () => {
  const { spawnSync } = await import('node:child_process');
  const out = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '-e',
      `const { config: c } = await import('./server/src/config.ts');
       console.log(JSON.stringify([c.receiptsModel, c.receiptsPriceInUsdPerM, c.receiptsPriceOutUsdPerM, c.receiptsTimeoutSec, c.receiptsReasoning, c.receiptsFallbackReasoning, c.receiptsFallbackModel]));`,
    ],
    {
      env: {
        ...process.env,
        RECEIPTS_MODEL: 'vendor/model',
        RECEIPTS_PRICE_IN_USD_PER_M: '0.3',
        RECEIPTS_PRICE_OUT_USD_PER_M: '2',
        RECEIPTS_TIMEOUT_SEC: '20',
        RECEIPTS_REASONING: 'omit',
        RECEIPTS_FALLBACK_REASONING: 'bogus',
        RECEIPTS_FALLBACK_MODEL: 'NONE',
      },
      encoding: 'utf8',
    },
  );
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout.trim().split('\n').pop() as string), [
    'vendor/model',
    0.3,
    2,
    20,
    'omit',
    'low',
    '',
  ]);
  assert.match(out.stderr, /RECEIPTS_FALLBACK_REASONING/);
});
