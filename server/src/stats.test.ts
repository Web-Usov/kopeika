import './test-env.ts';
import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env.DEV_AUTH = '1';
delete process.env.BOT_TOKEN;

let stats: typeof import('./stats.ts');
let api: typeof import('./api.ts').api;
let db: typeof import('./db.ts');
let parseAdminIds: typeof import('./config.ts').parseAdminIds;
before(async () => {
  stats = await import('./stats.ts');
  ({ api } = await import('./api.ts'));
  db = await import('./db.ts');
  ({ parseAdminIds } = await import('./config.ts'));
});

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
const total = (event: string) =>
  db.one<{ n: number | null }>('SELECT SUM(count) AS n FROM stats_daily WHERE event = ?', event)?.n ?? 0;

test('countEvent: one row per day and event, increments', () => {
  const day = new Date(2030, 0, 15, 12);
  stats.countEvent('bot.start', day);
  stats.countEvent('bot.start', day);
  stats.countEvent('bot.start', new Date(2030, 0, 16, 12));
  const rows = db.all<{ date: string; count: number }>(
    "SELECT date, count FROM stats_daily WHERE event = 'bot.start' AND date >= '2030-01-15' ORDER BY date",
  );
  assert.deepEqual(
    rows.map((r) => ({ ...r })),
    [
      { date: '2030-01-15', count: 2 },
      { date: '2030-01-16', count: 1 },
    ],
  );
});

test('a rolled-back action is not counted', () => {
  const before = total('chat.link');
  assert.throws(() =>
    db.tx(() => {
      stats.countEvent('chat.link');
      throw new Error('boom');
    }),
  );
  assert.equal(total('chat.link'), before);
});

test('API actions count: group, expense, transfer, join (once)', async () => {
  const [g0, e0, t0, j0] = [
    total('group.create'),
    total('expense.create'),
    total('transfer.create'),
    total('member.join'),
  ];
  const owner = 9101;
  const created = await call(owner, 'POST', '/groups', { name: 'Стат', currency: 'RUB', memberNames: ['Маша'] });
  assert.equal(created.status, 201);
  const g = created.body;
  const shares = g.members.map((m: Json) => ({ memberId: m.id, value: 1 }));
  const base = { title: 'Хлеб', amount: 1000, payerId: g.meId, splitMode: 'equal', shares, spentOn: '2030-01-01' };
  assert.equal((await call(owner, 'POST', `/groups/${g.id}/expenses`, { ...base, kind: 'expense' })).status, 201);
  // a rejected expense (bad payer) is not counted
  const bad = await call(owner, 'POST', `/groups/${g.id}/expenses`, { ...base, kind: 'expense', payerId: 999999 });
  assert.ok(bad.status >= 400);
  const maria = g.members.find((m: Json) => m.name === 'Маша').id;
  const tr = await call(owner, 'POST', `/groups/${g.id}/expenses`, {
    kind: 'transfer',
    title: '',
    amount: 500,
    payerId: maria,
    splitMode: 'equal',
    shares: [{ memberId: g.meId, value: 1 }],
    spentOn: '2030-01-01',
  });
  assert.equal(tr.status, 201);
  const code = db.one<{ invite_code: string }>('SELECT invite_code FROM groups WHERE id = ?', g.id)?.invite_code;
  assert.equal((await call(9102, 'POST', `/invite/${code}/join`, {})).status, 200);
  assert.equal((await call(9102, 'POST', `/invite/${code}/join`, {})).status, 200);
  assert.equal(total('group.create') - g0, 1);
  assert.equal(total('expense.create') - e0, 1);
  assert.equal(total('transfer.create') - t0, 1);
  assert.equal(total('member.join') - j0, 1);
});

test('stats_daily holds only date, event and count: no ids', () => {
  const cols = db.all<{ name: string }>('PRAGMA table_info(stats_daily)').map((c) => c.name);
  assert.deepEqual(cols, ['date', 'event', 'count']);
  const events = db.all<{ event: string }>('SELECT DISTINCT event FROM stats_daily').map((r) => r.event);
  for (const e of events) assert.ok((stats.STAT_EVENTS as readonly string[]).includes(e), e);
});

test('collectStats: windows and active users', () => {
  const now = new Date(2031, 5, 30, 12);
  for (const [offset, n] of [
    [0, 1],
    [3, 2],
    [20, 4],
    [40, 8],
  ] as const) {
    for (let i = 0; i < n; i++) stats.countEvent('export.csv', new Date(2031, 5, 30 - offset, 12));
  }
  const s = stats.collectStats(now);
  assert.equal(s.events[1]['export.csv'], 1);
  assert.equal(s.events[7]['export.csv'], 3);
  assert.equal(s.events[30]['export.csv'], 7);
  assert.ok(s.users >= 1 && s.groups >= 1);
  assert.ok(s.active[30] >= s.active[7] && s.active[7] >= s.active[1]);
});

test('buildStatsReport: every event, both languages', () => {
  const snap = {
    events: { 1: { 'expense.create': 3 }, 7: { 'expense.create': 20 }, 30: { 'expense.create': 80 } },
    active: { 1: 2, 7: 5, 30: 9 },
    users: 12,
    groups: 4,
  } as import('./stats.ts').StatsSnapshot;
  const ru = stats.buildStatsReport('ru', snap);
  assert.match(ru, /Трат добавлено: 3 · 20 · 80/);
  assert.match(ru, /Активных пользователей: 2 · 5 · 9/);
  assert.match(ru, /пользователей 12, групп 4/);
  assert.match(ru, /Групп создано: 0 · 0 · 0/);
  const en = stats.buildStatsReport('en', snap);
  assert.match(en, /Expenses added: 3 · 20 · 80/);
  assert.match(en, /12 users, 4 groups/);
  assert.equal(en.split('\n').length, ru.split('\n').length);
});

test('canSeeStats: only an admin in a private chat', () => {
  const admins = parseAdminIds(' 42, x, 7 ,-1,');
  assert.deepEqual([...admins], [42, 7]);
  assert.equal(stats.canSeeStats(42, 'private', admins), true);
  assert.equal(stats.canSeeStats(43, 'private', admins), false);
  assert.equal(stats.canSeeStats(42, 'supergroup', admins), false);
  assert.equal(stats.canSeeStats(undefined, 'private', admins), false);
  assert.equal(stats.canSeeStats(42, 'private', new Set()), false);
});

test('deleting an account counts user.delete; the placeholder user is not a user', async () => {
  const before = total('user.delete');
  await call(9201, 'POST', '/groups', { name: 'Удаляемый', currency: 'RUB' });
  const { deleteAccount } = await import('./account.ts');
  const usersBefore = stats.collectStats().users;
  deleteAccount(9201);
  assert.equal(total('user.delete') - before, 1);
  assert.equal(stats.collectStats().users, usersBefore - 1);
  const active = stats.collectStats().active[30];
  db.run("UPDATE users SET updated_at = datetime('now') WHERE id = 0");
  assert.equal(stats.collectStats().active[30], active, 'placeholder row must not count as active');
});
