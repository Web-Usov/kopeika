import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.DEV_AUTH = '1';
delete process.env.BOT_TOKEN;

let rates: typeof import('./rates.ts');
let db: typeof import('./db.ts');
let api: typeof import('./api.ts').api;

const table = (date: string, vals: Record<string, [number, number]>) => ({
  Date: `${date}T11:30:00+03:00`,
  Valute: Object.fromEntries(Object.entries(vals).map(([k, [Nominal, Value]]) => [k, { CharCode: k, Nominal, Value }])),
});

// A fake CBR: archive days that are not in `days` answer 404 (like weekends), `daily` serves "today".
function fakeCbr(days: Record<string, ReturnType<typeof table>>, daily?: ReturnType<typeof table>) {
  const calls: string[] = [];
  const fetcher: import('./rates.ts').RatesFetcher = async (url) => {
    calls.push(url);
    const m = url.match(/archive\/(\d{4})\/(\d{2})\/(\d{2})\//);
    const body = m ? days[`${m[1]}-${m[2]}-${m[3]}`] : daily;
    return { status: body ? 200 : 404, json: async () => body };
  };
  return { fetcher, calls };
}

const offline: import('./rates.ts').RatesFetcher = async () => {
  throw new Error('offline');
};

const SAMPLE: Record<string, [number, number]> = { GEL: [1, 34.5], USD: [1, 92], KZT: [100, 18.5], EUR: [1, 100] };

beforeEach(async () => {
  rates ??= await import('./rates.ts');
  db ??= await import('./db.ts');
  ({ api } = await import('./api.ts'));
  db.run('DELETE FROM rates');
  rates.setRatesTestHooks({ today: () => '2025-01-20' });
});

test('RUB group: rate is the source value divided by the nominal', async () => {
  const cbr = fakeCbr({ '2025-01-15': table('2025-01-15', SAMPLE) });
  rates.setRatesTestHooks({ fetcher: cbr.fetcher, today: () => '2025-01-20' });
  assert.deepEqual(await rates.getRate('RUB', 'GEL', '2025-01-15'), {
    rate: '34.5',
    source: 'cbr',
    date: '2025-01-15',
  });
  assert.equal((await rates.getRate('RUB', 'KZT', '2025-01-15')).rate, '0.185');
});

test('cross-rate via the rouble for non-RUB groups', async () => {
  const cbr = fakeCbr({ '2025-01-15': table('2025-01-15', SAMPLE) });
  rates.setRatesTestHooks({ fetcher: cbr.fetcher, today: () => '2025-01-20' });
  // 1 GEL = 34.5 RUB, 1 USD = 92 RUB -> 1 GEL = 0.375 USD; 1 USD = 2.66667 GEL
  assert.equal((await rates.getRate('USD', 'GEL', '2025-01-15')).rate, '0.375');
  assert.equal((await rates.getRate('GEL', 'USD', '2025-01-15')).rate, '2.66667');
  // and into the rouble
  assert.equal((await rates.getRate('GEL', 'RUB', '2025-01-15')).rate, '0.0289855');
});

test('weekend: falls back to earlier days and reports the real source date', async () => {
  // 2025-01-19 is a Sunday: the archive only has Friday the 17th
  const cbr = fakeCbr({ '2025-01-17': table('2025-01-17', SAMPLE) });
  rates.setRatesTestHooks({ fetcher: cbr.fetcher, today: () => '2025-01-25' });
  const r = await rates.getRate('RUB', 'GEL', '2025-01-19');
  assert.equal(r.date, '2025-01-17');
  assert.equal(r.rate, '34.5');
  assert.equal(cbr.calls.length, 3);
});

test('no rates within a week: 404 key; network error or bad answer: 503 key', async () => {
  rates.setRatesTestHooks({ fetcher: fakeCbr({}).fetcher, today: () => '2025-01-25' });
  await assert.rejects(rates.getRate('RUB', 'GEL', '2025-01-15'), { status: 404, key: 'errors.rate.notFound' });
  rates.setRatesTestHooks({ fetcher: offline, today: () => '2025-01-25' });
  await assert.rejects(rates.getRate('RUB', 'GEL', '2025-01-15'), { status: 503, key: 'errors.rate.unavailable' });
  rates.setRatesTestHooks({
    fetcher: async () => ({ status: 500, json: async () => ({}) }),
    today: () => '2025-01-25',
  });
  await assert.rejects(rates.getRate('RUB', 'GEL', '2025-01-15'), { status: 503 });
  rates.setRatesTestHooks({
    fetcher: async () => ({ status: 200, json: async () => ({ nope: 1 }) }),
    today: () => '2025-01-25',
  });
  await assert.rejects(rates.getRate('RUB', 'GEL', '2025-01-15'), { status: 503 });
});

test('a currency missing from the table gives 404', async () => {
  const cbr = fakeCbr({ '2025-01-15': table('2025-01-15', { USD: [1, 92] }) });
  rates.setRatesTestHooks({ fetcher: cbr.fetcher, today: () => '2025-01-20' });
  await assert.rejects(rates.getRate('RUB', 'GEL', '2025-01-15'), { status: 404 });
});

test('past days are cached in the database: no second request, even when the source is gone', async () => {
  const cbr = fakeCbr({ '2025-01-15': table('2025-01-15', SAMPLE) });
  rates.setRatesTestHooks({ fetcher: cbr.fetcher, today: () => '2025-01-20' });
  await rates.getRate('RUB', 'GEL', '2025-01-15');
  assert.equal(cbr.calls.length, 1);
  await rates.getRate('USD', 'EUR', '2025-01-15');
  assert.equal(cbr.calls.length, 1);
  rates.setRatesTestHooks({ fetcher: offline, today: () => '2025-01-20' });
  assert.equal((await rates.getRate('RUB', 'USD', '2025-01-15')).rate, '92');
  const row = db.one<{ rub_per_unit: string }>(
    "SELECT rub_per_unit FROM rates WHERE date = '2025-01-15' AND currency = 'KZT'",
  );
  assert.equal(row?.rub_per_unit, '0.185');
});

test('today uses the daily endpoint and is not stored in the database', async () => {
  const cbr = fakeCbr({}, table('2025-01-20', SAMPLE));
  rates.setRatesTestHooks({ fetcher: cbr.fetcher, today: () => '2025-01-20' });
  assert.equal((await rates.getRate('RUB', 'GEL', '2025-01-20')).rate, '34.5');
  assert.equal(cbr.calls[0], 'https://www.cbr-xml-daily.ru/daily_json.js');
  assert.equal(db.all('SELECT 1 FROM rates').length, 0);
  await rates.getRate('RUB', 'USD', '2025-01-20'); // kept in memory for a while
  assert.equal(cbr.calls.length, 1);
});

test('GET /rates: rate for the group currency, validation and translated errors', async () => {
  const cbr = fakeCbr({ '2025-01-15': table('2025-01-15', SAMPLE) });
  rates.setRatesTestHooks({ fetcher: cbr.fetcher, today: () => '2025-01-20' });
  const get = (q: string, lang?: string) =>
    api.request(`/rates?${q}`, { headers: { Authorization: 'dev 7', ...(lang ? { 'X-Lang': lang } : {}) } });
  const ok = await get('base=RUB&currency=GEL&date=2025-01-15');
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { rate: '34.5', source: 'cbr', date: '2025-01-15' });
  assert.equal((await get('base=RUB&currency=RUB&date=2025-01-15')).status, 400);
  assert.equal((await get('base=RUB&currency=XXX&date=2025-01-15')).status, 400);
  assert.equal((await get('base=RUB&currency=GEL&date=nope')).status, 400);
  assert.equal((await api.request('/rates?base=RUB&currency=GEL&date=2025-01-15')).status, 401);
  rates.setRatesTestHooks({ fetcher: offline, today: () => '2025-01-20' });
  const down = await get('base=RUB&currency=USD&date=2025-01-14', 'en');
  assert.equal(down.status, 503);
  assert.match(((await down.json()) as { error: string }).error, /manually/);
});
