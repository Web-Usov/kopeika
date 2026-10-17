import './test-env.ts';
import assert from 'node:assert/strict';
import { before, test } from 'node:test';

delete process.env.BOT_TOKEN;

let stats: typeof import('./stats.ts');
let weekly: typeof import('./statsWeekly.ts');
let db: typeof import('./db.ts');
before(async () => {
  stats = await import('./stats.ts');
  weekly = await import('./statsWeekly.ts');
  db = await import('./db.ts');
  for (const id of [1, 2, 3]) db.run('INSERT INTO users (id, first_name) VALUES (?, ?)', id, `U${id}`);
});

// "now" is far in the future, so groups other code might create (created today) never fall into the windows.
const NOW = new Date(Date.UTC(2040, 5, 30, 12, 0, 0));
const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const daysAgo = (n: number) => sqlTime(NOW.getTime() - n * 86400_000);

let seq = 0;
interface Opts {
  createdDaysAgo: number;
  /** Members with a Telegram account. */
  tg: number;
  /** Name-only members. */
  noTg?: number;
  demo?: boolean;
  /** Rows created `afterDays` days after the group. */
  expenses?: { afterDays: number; kind?: string }[];
}
function makeGroup(opts: Opts) {
  const createdAt = daysAgo(opts.createdDaysAgo);
  const g = db.run(
    'INSERT INTO groups (name, currency, invite_code, created_by, created_at, is_demo) VALUES (?, ?, ?, 1, ?, ?)',
    `g${seq}`,
    'RUB',
    `code${seq++}`,
    createdAt,
    opts.demo ? 1 : 0,
  );
  const gid = Number(g.lastInsertRowid);
  const members: number[] = [];
  for (let i = 0; i < opts.tg; i++)
    members.push(
      Number(
        db.run('INSERT INTO members (group_id, user_id, name) VALUES (?, ?, ?)', gid, i + 1, `m${i}`).lastInsertRowid,
      ),
    );
  for (let i = 0; i < (opts.noTg ?? 0); i++)
    members.push(Number(db.run('INSERT INTO members (group_id, name) VALUES (?, ?)', gid, `n${i}`).lastInsertRowid));
  for (const e of opts.expenses ?? []) {
    const at = sqlTime(Date.parse(`${createdAt.replace(' ', 'T')}Z`) + e.afterDays * 86400_000 + 3600_000);
    db.run(
      "INSERT INTO expenses (group_id, kind, title, amount, payer_id, split_mode, spent_on, created_by, created_at) VALUES (?, ?, 't', 100, ?, 'equal', '2040-01-01', 1, ?)",
      gid,
      e.kind ?? 'expense',
      members[0],
      at,
    );
  }
  return gid;
}
const three = [{ afterDays: 0 }, { afterDays: 0 }, { afterDays: 1 }];

test('funnel: alive needs 2 Telegram members and 3 expenses; transfers and demo do not count', () => {
  const before = stats.collectFunnel(NOW)[7];
  makeGroup({ createdDaysAgo: 2, tg: 2, expenses: three }); // alive
  makeGroup({ createdDaysAgo: 2, tg: 1, noTg: 2, expenses: three }); // one Telegram member only
  makeGroup({ createdDaysAgo: 2, tg: 2, expenses: [{ afterDays: 0 }, { afterDays: 0 }] }); // two expenses
  makeGroup({
    createdDaysAgo: 2,
    tg: 2,
    expenses: [{ afterDays: 0 }, { afterDays: 0 }, { afterDays: 0, kind: 'transfer' }],
  }); // a transfer is not an expense
  makeGroup({ createdDaysAgo: 2, tg: 2, expenses: three, demo: true }); // demo
  const f = stats.collectFunnel(NOW)[7];
  assert.equal(f.created - before.created, 4);
  assert.equal(f.alive - before.alive, 1);
});

test('funnel: periods are by creation date', () => {
  const b = stats.collectFunnel(NOW);
  makeGroup({ createdDaysAgo: 20, tg: 2, expenses: three });
  const a = stats.collectFunnel(NOW);
  assert.equal(a[7].created, b[7].created);
  assert.equal(a[30].created - b[30].created, 1);
  assert.equal(a[30].alive - b[30].alive, 1);
});

test('funnel: returned = expense or transfer 7-14 days after creation, only for groups older than 14 days', () => {
  const b = stats.collectFunnel(NOW)[7];
  // The 7-day cohort for "returned" is groups created 14..21 days ago.
  makeGroup({ createdDaysAgo: 16, tg: 2, expenses: [{ afterDays: 0 }, { afterDays: 9 }] }); // returned (expense)
  makeGroup({ createdDaysAgo: 16, tg: 2, expenses: [{ afterDays: 0 }, { afterDays: 8, kind: 'transfer' }] }); // returned (transfer)
  makeGroup({ createdDaysAgo: 16, tg: 2, expenses: [{ afterDays: 0 }, { afterDays: 3 }] }); // too early
  makeGroup({ createdDaysAgo: 16, tg: 2, expenses: [{ afterDays: 0 }, { afterDays: 15 }] }); // too late
  makeGroup({ createdDaysAgo: 16, tg: 2, expenses: [{ afterDays: 9 }], demo: true }); // demo
  makeGroup({ createdDaysAgo: 10, tg: 2, expenses: [{ afterDays: 8 }] }); // younger than 14 days: not judged yet
  const a = stats.collectFunnel(NOW)[7];
  assert.equal(a.returnedOf - b.returnedOf, 4);
  assert.equal(a.returned - b.returned, 2);
});

test('report shows the funnel block in both languages', () => {
  const snap = stats.collectStats(NOW);
  const ru = stats.buildStatsReport('ru', snap);
  const en = stats.buildStatsReport('en', snap);
  assert.match(ru, /Воронка групп/);
  assert.match(en, /Group funnel/);
  assert.equal(ru.split('\n').length, en.split('\n').length);
  console.log(`--- ru ---\n${ru}\n--- en ---\n${en}`);
});

// 2040-07-02 is a Monday.
const MONDAY_10 = new Date(2040, 6, 2, 10, 0);
test('weekly: due on Monday morning only', () => {
  assert.equal(MONDAY_10.getDay(), 1);
  assert.equal(weekly.isWeeklyDue(MONDAY_10, null), true);
  assert.equal(weekly.isWeeklyDue(new Date(2040, 6, 2, 8, 0), null), false);
  assert.equal(weekly.isWeeklyDue(new Date(2040, 6, 3, 10, 0), null), false);
  assert.equal(weekly.isWeeklyDue(MONDAY_10, '2040-07-02'), false);
  assert.equal(weekly.isWeeklyDue(MONDAY_10, '2040-06-25'), true);
});

test('weekly: once per Monday to every admin in their language; a restart does not resend', async () => {
  db.run("UPDATE users SET lang = 'en' WHERE id = 3");
  const sent: { id: number; text: string }[] = [];
  const opts = {
    admins: new Set([2, 3]),
    ready: true,
    enabled: true,
    send: async (id: number, text: string) => void sent.push({ id, text }),
  };
  assert.equal(await weekly.runWeeklyStats(MONDAY_10, opts), 2);
  assert.equal(sent.length, 2);
  assert.match(sent[0].text, /Итоги недели[\s\S]*Воронка групп/);
  assert.match(sent[1].text, /Weekly summary[\s\S]*Group funnel/);
  // the same Monday, later (as after a restart): nothing new
  assert.equal(await weekly.runWeeklyStats(new Date(2040, 6, 2, 15, 0), opts), 0);
  assert.equal(sent.length, 2);
  // next Monday goes out again
  assert.equal(await weekly.runWeeklyStats(new Date(2040, 6, 9, 9, 30), opts), 2);
});

test('weekly: skipped silently when disabled, no admins, or the bot is not ready (retried later)', async () => {
  const day = new Date(2040, 6, 16, 10, 0);
  const sent: number[] = [];
  const send = async (id: number) => void sent.push(id);
  const base = { admins: new Set([2]), ready: true, enabled: true, send };
  assert.equal(await weekly.runWeeklyStats(day, { ...base, enabled: false }), 0);
  assert.equal(await weekly.runWeeklyStats(day, { ...base, admins: new Set<number>() }), 0);
  assert.equal(await weekly.runWeeklyStats(day, { ...base, ready: false }), 0);
  assert.equal(sent.length, 0);
  assert.equal(await weekly.runWeeklyStats(day, base), 1);
});
