import assert from 'node:assert/strict';
import { afterEach, before, test } from 'node:test';

// config.ts reads env at import time.
process.env.RECEIPTS_PROVIDER = 'openrouter';
process.env.OPENROUTER_API_KEY = 'sk-or-test';
process.env.OPENROUTER_BASE_URL = 'http://llm.test/v1/';
process.env.OPENROUTER_PROVIDERS = 'deepinfra, novita';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.RECEIPTS_MODEL;

let provider: typeof import('./receipts/provider.ts');
let openrouter: typeof import('./receipts/openrouter.ts');
let config: typeof import('./config.ts').config;

before(async () => {
  provider = await import('./receipts/provider.ts');
  openrouter = await import('./receipts/openrouter.ts');
  ({ config } = await import('./config.ts'));
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const image = { mediaType: 'image/jpeg' as const, base64: 'AAAA' };
const opts = { model: 'google/gemma-4-26b-a4b-it', timeoutMs: 1000, hintCurrency: 'RUB' };

const answer = {
  is_receipt: true,
  merchant: 'Кафе',
  date: '2026-10-16',
  currency_hint: 'RUB',
  items: [{ name: 'Кофе', qty: '2', unit_price: '150.00', line_total: '300.00' }],
  extras: [],
  printed_subtotal: null,
  printed_total: '300.00',
  confidence: 'high',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const completion = (content: string | null, finish = 'stop', extra: object = {}) =>
  json({
    model: 'google/gemma-4-26b-a4b-it',
    choices: [{ finish_reason: finish, message: { role: 'assistant', content, ...extra } }],
    usage: { prompt_tokens: 1234, completion_tokens: 56 },
  });

const reason = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof provider.ReceiptProviderError);
    return e.reason;
  }
  assert.fail('expected ReceiptProviderError');
};

test('config: provider selection, default model and key check', () => {
  assert.equal(config.receiptsProvider, 'openrouter');
  assert.equal(config.receiptsModel, 'google/gemma-4-26b-a4b-it');
  assert.equal(config.openrouterBaseUrl, 'http://llm.test/v1');
  assert.deepEqual(config.openrouterProviders, ['deepinfra', 'novita']);
  assert.equal(provider.receiptsEnabled(), true);
  assert.equal(provider.getReceiptProvider(), openrouter.openrouterProvider);
  config.openrouterApiKey = '';
  assert.equal(provider.receiptsEnabled(), false);
  config.openrouterApiKey = 'sk-or-test';
});

test('success: request shape and parsed answer with usage', async () => {
  let url = '';
  let init: RequestInit = {};
  globalThis.fetch = (async (u: string, i: RequestInit) => {
    url = u;
    init = i;
    return completion(JSON.stringify(answer));
  }) as typeof fetch;
  const { draft, usage } = await openrouter.openrouterProvider.parseReceipt(image, opts);
  assert.equal(url, 'http://llm.test/v1/chat/completions');
  assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer sk-or-test');
  const sent = JSON.parse(init.body as string);
  assert.equal(sent.model, opts.model);
  assert.equal(sent.messages[0].role, 'system');
  const content = sent.messages[1].content;
  assert.equal(content[0].type, 'image_url');
  assert.equal(content[0].image_url.url, 'data:image/jpeg;base64,AAAA');
  assert.equal(content[1].type, 'text');
  assert.match(content[1].text, /RUB/);
  assert.equal(sent.response_format.type, 'json_schema');
  assert.equal(sent.response_format.json_schema.strict, true);
  assert.deepEqual(sent.provider, { require_parameters: true, data_collection: 'deny', only: ['deepinfra', 'novita'] });
  assert.deepEqual(sent.reasoning, { effort: 'low' });
  assert.equal(draft.merchant, 'Кафе');
  assert.equal(draft.items[0]?.lineTotal, '300.00');
  assert.deepEqual(usage, { model: 'google/gemma-4-26b-a4b-it', inputTokens: 1234, outputTokens: 56 });
});

test('finish_reason length -> truncated', async () => {
  globalThis.fetch = (async () => completion('{"is_receipt":', 'length')) as typeof fetch;
  assert.equal(await reason(openrouter.openrouterProvider.parseReceipt(image, opts)), 'truncated');
});

test('invalid JSON or wrong shape -> malformed', async () => {
  globalThis.fetch = (async () => completion('not json')) as typeof fetch;
  assert.equal(await reason(openrouter.openrouterProvider.parseReceipt(image, opts)), 'malformed');
  globalThis.fetch = (async () => completion('{"is_receipt":true}')) as typeof fetch;
  assert.equal(await reason(openrouter.openrouterProvider.parseReceipt(image, opts)), 'malformed');
  globalThis.fetch = (async () => completion(null)) as typeof fetch;
  assert.equal(await reason(openrouter.openrouterProvider.parseReceipt(image, opts)), 'malformed');
  globalThis.fetch = (async () => json({ choices: [] })) as typeof fetch;
  assert.equal(await reason(openrouter.openrouterProvider.parseReceipt(image, opts)), 'malformed');
});

test('refusal and content filter -> refusal', async () => {
  globalThis.fetch = (async () => completion(null, 'stop', { refusal: 'no' })) as typeof fetch;
  assert.equal(await reason(openrouter.openrouterProvider.parseReceipt(image, opts)), 'refusal');
  globalThis.fetch = (async () => completion('', 'content_filter')) as typeof fetch;
  assert.equal(await reason(openrouter.openrouterProvider.parseReceipt(image, opts)), 'refusal');
});

test('HTTP errors (region 403, 402, 5xx) -> unavailable, without echoing the body', async () => {
  for (const status of [403, 402, 429, 502]) {
    globalThis.fetch = (async () => json({ error: { message: 'secret echo of the request' } }, status)) as typeof fetch;
    try {
      await openrouter.openrouterProvider.parseReceipt(image, opts);
      assert.fail('expected an error');
    } catch (e) {
      assert.ok(e instanceof provider.ReceiptProviderError);
      assert.equal(e.reason, 'unavailable');
      assert.equal(e.message, `unavailable: HTTP ${status}`);
    }
  }
});

test('network failure -> unavailable; timeout -> timeout', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  assert.equal(await reason(openrouter.openrouterProvider.parseReceipt(image, opts)), 'unavailable');
  // A server that never answers: the abort signal of the request fires.
  globalThis.fetch = ((_u: string, i: RequestInit) =>
    new Promise((_res, rej) => {
      // AbortSignal.timeout() timers are unref'd; a real socket would keep the loop alive, so we do it here.
      const keepAlive = setTimeout(() => {}, 5000);
      i.signal?.addEventListener('abort', () => {
        clearTimeout(keepAlive);
        rej(i.signal?.reason);
      });
    })) as typeof fetch;
  assert.equal(await reason(openrouter.openrouterProvider.parseReceipt(image, { ...opts, timeoutMs: 20 })), 'timeout');
});
