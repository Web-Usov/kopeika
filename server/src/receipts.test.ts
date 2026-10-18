import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

// config.ts and db.ts read env at import time, so set it before the dynamic import.
process.env.DB_PATH = ':memory:';
process.env.DEV_AUTH = '1';
delete process.env.BOT_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

let api: typeof import('./api.ts').api;
let api_: typeof import('./api.ts');
let config: typeof import('./config.ts').config;
let providerModule: typeof import('./receipts/provider.ts');
let normalize: typeof import('./receipts/normalize.ts');
let anthropicModule: typeof import('./receipts/anthropic.ts');

before(async () => {
  api_ = await import('./api.ts');
  api = api_.api;
  ({ config } = await import('./config.ts'));
  providerModule = await import('./receipts/provider.ts');
  normalize = await import('./receipts/normalize.ts');
  anthropicModule = await import('./receipts/anthropic.ts');
  // These tests scan a lot with one user and group: the limits have their own file (receiptLimits.test.ts).
  api_.receiptsLimiter.setLimit(10_000);
  config.receiptsGroupTrialMonthly = 10_000;
  config.receiptsBeta = false; // the closed beta has its own file (receiptBeta.test.ts)
});
after(() => providerModule.setReceiptProviderForTests());

// biome-ignore lint/suspicious/noExplicitAny: test helper over untyped JSON
type Json = any;
type Raw = import('./receipts/provider.ts').RawReceipt;

let nextUser = 5000;
const newUser = () => nextUser++;

async function call(user: number | null, method: string, path: string, body?: unknown, lang?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (user !== null) headers.Authorization = `dev ${user}`;
  if (lang) headers['X-Lang'] = lang;
  const res = await api.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Json };
}

async function createGroup(user: number, currency = 'RUB') {
  const res = await call(user, 'POST', '/groups', { name: 'Ужин', currency });
  assert.equal(res.status, 201);
  assert.equal((await call(user, 'POST', '/me/receipt-consent')).status, 200);
  return res.body as Json;
}

// A tiny valid-looking JPEG header is enough: the fake provider never looks at the pixels.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0]).toString('base64');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]).toString('base64');
const photo = (over: Json = {}) => ({ image: JPEG, mediaType: 'image/jpeg', ...over });

const raw = (over: Partial<Raw> = {}): Raw => ({
  isReceipt: true,
  merchant: 'Хинкальная',
  date: '2026-10-16',
  currencyHint: 'GEL',
  items: [
    { name: 'Хинкали', qty: '2', unitPrice: '12.00', lineTotal: '24.00' },
    { name: 'Лимонад', qty: '1', unitPrice: null, lineTotal: '8,50' },
  ],
  extras: [{ kind: 'service', label: 'Сервис 10%', amount: '3.25', percent: '10' }],
  printedSubtotal: '32.50',
  printedTotal: '35.75',
  confidence: 'high',
  ...over,
});

const usage = { model: 'claude-haiku-5-5', inputTokens: 1500, outputTokens: 400 };

function useProvider(fn: (model: string) => Promise<Raw> | Raw) {
  const calls: { model: string; mediaType: string; hintCurrency?: string }[] = [];
  providerModule.setReceiptProviderForTests({
    async parseReceipt(image, opts) {
      calls.push({ model: opts.model, mediaType: image.mediaType, hintCurrency: opts.hintCurrency });
      return { draft: await fn(opts.model), usage: { ...usage, model: opts.model } };
    },
  });
  return calls;
}

test('success: amounts become minor units, items get ids, sum matches the total', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const calls = useProvider(() => raw());
  const res = await call(u, 'POST', `/groups/${g.id}/receipts/parse`, photo());
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    merchant: 'Хинкальная',
    date: '2026-10-16',
    currency: 'GEL',
    items: [
      { id: 'i1', name: 'Хинкали', quantity: '2', amount: 2400 },
      { id: 'i2', name: 'Лимонад', amount: 850 },
    ],
    adjustments: [{ kind: 'service', label: 'Сервис 10%', amount: 325, percent: '10' }],
    total: 3575,
    mismatch: false,
    confidence: 'high',
    warnings: [],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.model, 'claude-haiku-5-5');
  assert.equal(calls[0]!.hintCurrency, 'RUB');
});

test('a sum that does not match the total is flagged', async () => {
  const u = newUser();
  const g = await createGroup(u);
  useProvider(() => raw({ printedTotal: '40.00' }));
  const res = await call(u, 'POST', `/groups/${g.id}/receipts/parse`, photo({ image: PNG, mediaType: 'image/png' }));
  assert.equal(res.status, 200);
  assert.equal(res.body.mismatch, true);
  assert.equal(res.body.total, 4000);
});

test('a discount is negative, a "total" line among the items is dropped, qty mismatch is a warning', async () => {
  const u = newUser();
  const g = await createGroup(u);
  useProvider(() =>
    raw({
      items: [
        { name: 'A', qty: '3', unitPrice: '10.00', lineTotal: '25.00' },
        { name: 'B', qty: '1', unitPrice: null, lineTotal: '5.00' },
        { name: 'ИТОГО', qty: '1', unitPrice: null, lineTotal: '27.00' },
      ],
      extras: [{ kind: 'Discount', label: 'Скидка', amount: '3.00', percent: null }],
      printedTotal: '27.00',
    }),
  );
  const res = await call(u, 'POST', `/groups/${g.id}/receipts/parse`, photo());
  assert.equal(res.status, 200);
  assert.equal(res.body.items.length, 2);
  assert.deepEqual(res.body.adjustments, [{ kind: 'discount', label: 'Скидка', amount: -300, percent: null }]);
  assert.equal(res.body.mismatch, false);
  assert.deepEqual([...res.body.warnings].sort(), ['dropped_total_line', 'qty_mismatch']);
});

test('not a receipt: 400 with a translated message, in both languages', async () => {
  const u = newUser();
  const g = await createGroup(u);
  useProvider(() => raw({ isReceipt: false, items: [], extras: [], printedTotal: null }));
  const ru = await call(u, 'POST', `/groups/${g.id}/receipts/parse`, photo());
  assert.equal(ru.status, 400);
  assert.match(ru.body.error, /Не похоже на чек/);
  const en = await call(u, 'POST', `/groups/${g.id}/receipts/parse`, photo(), 'en');
  assert.equal(en.status, 400);
  assert.match(en.body.error, /doesn't look like a receipt/);
});

test('a receipt with nothing readable is "unreadable"', async () => {
  const u = newUser();
  const g = await createGroup(u);
  useProvider(() => raw({ items: [{ name: 'x', qty: '1', unitPrice: null, lineTotal: 'abc' }] }));
  const res = await call(u, 'POST', `/groups/${g.id}/receipts/parse`, photo());
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Не удалось прочитать/);
});

test('provider timeout or failure: 502 with a translated message, no details leaked', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const log = console.error;
  console.error = () => {};
  try {
    for (const reason of ['timeout', 'unavailable', 'refusal', 'truncated', 'malformed'] as const) {
      useProvider(() => {
        throw new providerModule.ReceiptProviderError(reason, 'secret detail');
      });
      const res = await call(u, 'POST', `/groups/${g.id}/receipts/parse`, photo(), 'en');
      assert.equal(res.status, 502, reason);
      assert.equal(res.body.error, "Couldn't process the receipt. Try again or enter it manually.");
    }
  } finally {
    console.error = log;
  }
});

test('without a key the feature is off: 503 and receiptsEnabled=false in /me', async () => {
  const u = newUser();
  const g = await createGroup(u);
  providerModule.setReceiptProviderForTests();
  assert.equal(config.anthropicApiKey, '');
  assert.equal((await call(u, 'GET', '/me')).body.receiptsEnabled, false);
  const res = await call(u, 'POST', `/groups/${g.id}/receipts/parse`, photo());
  assert.equal(res.status, 503);
  assert.match(res.body.error, /Распознавание чеков сейчас недоступно/);
  useProvider(() => raw());
  assert.equal((await call(u, 'GET', '/me')).body.receiptsEnabled, true);
});

test('/me tells which provider reads the photos (for the consent screen and the policy)', async (t) => {
  const u = newUser();
  const saved = config.receiptsProvider;
  t.after(() => {
    config.receiptsProvider = saved;
  });
  assert.equal((await call(u, 'GET', '/me')).body.receiptsProvider, 'anthropic');
  config.receiptsProvider = 'openrouter';
  assert.equal((await call(u, 'GET', '/me')).body.receiptsProvider, 'openrouter');
});

test('only members can scan: others get 404 and the provider is not called', async () => {
  const g = await createGroup(newUser());
  const calls = useProvider(() => raw());
  const res = await call(newUser(), 'POST', `/groups/${g.id}/receipts/parse`, photo());
  assert.equal(res.status, 404);
  assert.equal(calls.length, 0);
  assert.equal((await call(null, 'POST', `/groups/${g.id}/receipts/parse`, photo())).status, 401);
});

test('a body over the limit is refused with 413 before it is parsed', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const calls = useProvider(() => raw());
  const res = await call(
    u,
    'POST',
    `/groups/${g.id}/receipts/parse`,
    photo({ image: 'A'.repeat(3 * 1024 * 1024 + 10) }),
  );
  assert.equal(res.status, 413);
  assert.match(res.body.error, /слишком большое/);
  assert.equal(calls.length, 0);
});

test('a photo a bit under the limit is accepted (the route has its own bigger limit)', async () => {
  const u = newUser();
  const g = await createGroup(u);
  useProvider(() => raw());
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1_500_000)]).toString('base64');
  const res = await call(u, 'POST', `/groups/${g.id}/receipts/parse`, photo({ image: big }));
  assert.equal(res.status, 200);
});

test('invalid media type, wrong signature, empty or missing image: 400', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const calls = useProvider(() => raw());
  const path = `/groups/${g.id}/receipts/parse`;
  assert.equal((await call(u, 'POST', path, photo({ mediaType: 'image/gif' }))).status, 400);
  assert.equal((await call(u, 'POST', path, photo({ mediaType: 'application/pdf' }))).status, 400);
  assert.equal((await call(u, 'POST', path, photo({ mediaType: 'image/png' }))).status, 400); // JPEG bytes
  assert.equal((await call(u, 'POST', path, photo({ image: '' }))).status, 400);
  assert.equal((await call(u, 'POST', path, photo({ image: '!!!' }))).status, 400);
  assert.equal((await call(u, 'POST', path, { mediaType: 'image/jpeg' })).status, 400);
  assert.equal(calls.length, 0);
});

test('other routes keep the small body limit', async () => {
  const u = newUser();
  const res = await call(u, 'POST', '/groups', { name: 'x'.repeat(400_000), currency: 'RUB' });
  assert.equal(res.status, 413);
});

test('cascade: with a fallback model a mismatch is retried once and the closer attempt wins', async () => {
  const u = newUser();
  const g = await createGroup(u);
  config.receiptsFallbackModel = 'claude-sonnet-5-5';
  try {
    const calls = useProvider((model) => (model === 'claude-sonnet-5-5' ? raw() : raw({ printedTotal: '99.00' })));
    const res = await call(u, 'POST', `/groups/${g.id}/receipts/parse`, photo());
    assert.equal(res.status, 200);
    assert.deepEqual(
      calls.map((c) => c.model),
      ['claude-haiku-5-5', 'claude-sonnet-5-5'],
    );
    assert.equal(res.body.total, 3575);
    assert.equal(res.body.mismatch, false);

    // No retry when the first attempt already adds up; a failing retry keeps the first answer.
    const c2 = useProvider(() => raw());
    await call(u, 'POST', `/groups/${g.id}/receipts/parse`, photo());
    assert.equal(c2.length, 1);
    const log = console.error;
    console.error = () => {};
    try {
      useProvider((model) => {
        if (model === 'claude-sonnet-5-5') throw new providerModule.ReceiptProviderError('timeout');
        return raw({ printedTotal: '99.00' });
      });
      const res3 = await call(u, 'POST', `/groups/${g.id}/receipts/parse`, photo());
      assert.equal(res3.status, 200);
      assert.equal(res3.body.mismatch, true);
    } finally {
      console.error = log;
    }
  } finally {
    config.receiptsFallbackModel = '';
  }
});

test('no cascade by default', async () => {
  const u = newUser();
  const g = await createGroup(u);
  assert.equal(config.receiptsFallbackModel, '');
  const calls = useProvider(() => raw({ printedTotal: '99.00' }));
  const res = await call(u, 'POST', `/groups/${g.id}/receipts/parse`, photo());
  assert.equal(res.body.mismatch, true);
  assert.equal(calls.length, 1);
});

test('parseDecimal reads common notations into minor units', () => {
  const p = normalize.parseDecimal;
  assert.equal(p('12.5', 2), 1250);
  assert.equal(p('12,50', 2), 1250);
  assert.equal(p('1 234,50', 2), 123450);
  assert.equal(p('1.234,50', 2), 123450);
  assert.equal(p('1,234.50', 2), 123450);
  assert.equal(p('1,234', 2), 123400);
  assert.equal(p('1.234.567', 2), 123456700);
  assert.equal(p('-3,00', 2), -300);
  assert.equal(p('(3.00)', 2), -300);
  assert.equal(p('7', 2), 700);
  assert.equal(p('1,234', 0), 1234);
  assert.equal(p('1.5055', 2), null); // does not fit two decimals
  assert.equal(p('1.500', 2), 150000); // grouping
  assert.equal(p('abc', 2), null);
  assert.equal(p('1a2', 2), null);
  assert.equal(p('1e5', 2), null);
  assert.equal(p('.50', 2), null);
  assert.equal(p('5.00-', 2), null);
  assert.equal(p('$', 2), null);
  assert.equal(p('', 2), null);
  assert.equal(p('99999999999999999', 2), null);
});

test('parseDecimal strips currency signs, codes and stray characters', () => {
  const p = normalize.parseDecimal;
  assert.equal(p('$82.93', 2), 8293);
  assert.equal(p('฿1,815.00', 2), 181500);
  assert.equal(p('*4.174,50', 2), 417450);
  assert.equal(p('1 815,00 ₽', 2), 181500);
  assert.equal(p('82.93 USD', 2), 8293);
  assert.equal(p('руб. 120', 2), 12000);
  assert.equal(p('120 р.', 2), 12000);
  assert.equal(p('12 руб.', 2), 1200);
  assert.equal(p('€ 12,50', 2), 1250);
  assert.equal(p('-$5.00', 2), -500);
  assert.equal(p('−$5.00', 2), -500);
  assert.equal(p('$-5.00', 2), -500);
  assert.equal(p('($5.00)', 2), -500);
  assert.equal(p('₾12.00', 2), 1200);
  assert.equal(p('₺ 99,90', 2), 9990);
  assert.equal(p('£1,000.00', 2), 100000);
  assert.equal(p('¥500', 0), 500);
  assert.equal(p('GEL 8.50', 2), 850);
});

test('detectCurrency: ISO codes and symbols, anything else is unknown', () => {
  assert.equal(normalize.detectCurrency('gel'), 'GEL');
  assert.equal(normalize.detectCurrency('₽'), 'RUB');
  assert.equal(normalize.detectCurrency('€'), 'EUR');
  assert.equal(normalize.detectCurrency('XYZ'), null);
  assert.equal(normalize.detectCurrency(null), null);
});

test('names are cleaned and capped, items capped at 100', () => {
  const items = Array.from({ length: 120 }, (_, i) => ({
    name: i === 0 ? `  A\u0007‮${'x'.repeat(200)}\n` : `Item ${i}`,
    qty: '1',
    unitPrice: null,
    lineTotal: `${i + 1}.00`,
  }));
  const d = normalize.normalizeReceipt(raw({ items, extras: [], printedTotal: null }), { groupCurrency: 'RUB' });
  assert.equal(d.items.length, 100);
  assert.ok(d.warnings.includes('truncated'));
  assert.ok(d.items[0]!.name.length <= 100);
  assert.doesNotMatch(d.items[0]!.name, /[\p{Cc}\p{Cf}]/u);
  assert.equal(d.mismatch, false); // no printed total: nothing to compare with
});

test('the answer of the model is validated and the prompt stays country-neutral', () => {
  const good = {
    is_receipt: true,
    merchant: null,
    date: null,
    currency_hint: null,
    items: [{ name: 'A', qty: '1', unit_price: null, line_total: '1.00' }],
    extras: [],
    printed_subtotal: null,
    printed_total: '1.00',
    confidence: 'HIGH',
  };
  const parsed = anthropicModule.parseAnswer(JSON.stringify(good));
  assert.equal(parsed.confidence, 'high');
  assert.equal(parsed.items[0]!.lineTotal, '1.00');
  assert.throws(() => anthropicModule.parseAnswer('not json'), providerModule.ReceiptProviderError);
  assert.throws(() => anthropicModule.parseAnswer('{"is_receipt":true}'), providerModule.ReceiptProviderError);
  assert.doesNotMatch(anthropicModule.SYSTEM_PROMPT, /ФНС|ИНН|рубл|Russia/i);
  assert.equal(anthropicModule.RECEIPT_SCHEMA.additionalProperties, false);
});

test('config defaults: Haiku 5.5, no fallback', () => {
  assert.equal(config.receiptsModel, 'claude-haiku-5-5');
  assert.equal(config.receiptsFallbackModel, '');
  assert.equal(config.receiptsTimeoutSec, 30);
  assert.equal(config.receiptsPriceInUsdPerM, 0.1);
  assert.equal(config.receiptsPriceOutUsdPerM, 0.5);
});
