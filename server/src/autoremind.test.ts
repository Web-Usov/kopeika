import './test-env.ts';
import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

delete process.env.BOT_TOKEN;

let ar: typeof import('./autoremind.ts');
let dbm: typeof import('./db.ts');
let bot: typeof import('./bot.ts');
before(async () => {
  ar = await import('./autoremind.ts');
  dbm = await import('./db.ts');
  bot = await import('./bot.ts');
});

const DAY = 24 * 3600_000;
const now = new Date(2026, 5, 20, 12, 0, 0);
const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString().slice(0, 19).replace('T', ' ');

let seq = 0;
let sent: { to: number; text: string }[] = [];
const capture = async (to: number, text: string) => void sent.push({ to, text });

beforeEach(() => {
  sent = [];
  dbm.run('DELETE FROM groups');
  bot.setBotTestHooks({ sendMessage: capture });
});

/** A group where Маша (user 1) paid 100 for two, so Петя (user 2) owes her 50. The expense is `age` days old. */
function mkGroup(opts: { age?: number; auto?: number; demo?: number; archived?: boolean; notify?: number } = {}) {
  const { run } = dbm;
  const n = ++seq;
  run("INSERT OR IGNORE INTO users (id, first_name, lang) VALUES (1, 'Маша', 'ru')");
  run("INSERT OR IGNORE INTO users (id, first_name, lang) VALUES (2, 'Петя', 'en')");
  run('UPDATE users SET notify = ? WHERE id = 2', opts.notify ?? 1);
  const g = Number(
    run(
      `INSERT INTO groups (name, currency, invite_code, created_by, auto_remind, is_demo, archived_at)
       VALUES (?, 'RUB', ?, 1, ?, ?, ?)`,
      `Дача ${n}`,
      `inv-${n}`,
      opts.auto ?? 1,
      opts.demo ?? 0,
      opts.archived ? ago(1) : null,
    ).lastInsertRowid,
  );
  const masha = Number(run("INSERT INTO members (group_id, user_id, name) VALUES (?, 1, 'Маша')", g).lastInsertRowid);
  const petya = Number(run("INSERT INTO members (group_id, user_id, name) VALUES (?, 2, 'Петя')", g).lastInsertRowid);
  const e = Number(
    run(
      `INSERT INTO expenses (group_id, kind, title, amount, payer_id, split_mode, spent_on, created_by, created_at)
       VALUES (?, 'expense', 'Ужин', 10000, ?, 'equal', '2026-06-01', 1, ?)`,
      g,
      masha,
      ago(opts.age ?? 8),
    ).lastInsertRowid,
  );
  run('INSERT INTO expense_shares (expense_id, member_id, input, amount) VALUES (?, ?, 1, 5000)', e, masha);
  run('INSERT INTO expense_shares (expense_id, member_id, input, amount) VALUES (?, ?, 1, 5000)', e, petya);
  return { g, masha, petya };
}

const reminders = (g: number) =>
  dbm.all<{ auto: number }>('SELECT auto FROM reminders WHERE group_id = ? ORDER BY id', g).map((r) => ({
    auto: r.auto,
  }));
const manual = (g: number, from: number, to: number, createdAt: string) =>
  dbm.run(
    'INSERT INTO reminders (group_id, from_member, to_member, created_at) VALUES (?, ?, ?, ?)',
    g,
    from,
    to,
    createdAt,
  );
const counted = () =>
  dbm.one<{ n: number }>("SELECT COALESCE(SUM(count), 0) AS n FROM stats_daily WHERE event = 'debt.autoremind'")?.n ??
  0;

test('a debt older than 7 days is reminded once, in the debtor language, with the creditor name', async () => {
  const { g } = mkGroup();
  assert.equal(await ar.runAutoReminds(now), 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 2);
  assert.match(sent[0].text, /Маша/);
  assert.match(sent[0].text, /Дача/);
  assert.deepEqual(reminders(g), [{ auto: 1 }]);
});

test('a younger debt is not reminded', async () => {
  const { g } = mkGroup({ age: 6 });
  assert.equal(await ar.runAutoReminds(now), 0);
  assert.equal(sent.length, 0);
  assert.equal(reminders(g).length, 0);
});

test('not more often than every 7 days; again after that', async () => {
  const { g } = mkGroup();
  assert.equal(await ar.runAutoReminds(now), 1);
  assert.equal(await ar.runAutoReminds(new Date(now.getTime() + 1 * DAY)), 0);
  assert.equal(await ar.runAutoReminds(new Date(now.getTime() + 6 * DAY)), 0);
  assert.equal(await ar.runAutoReminds(new Date(now.getTime() + 8 * DAY)), 1);
  assert.equal(reminders(g).length, 2);
});

test('a manual reminder resets the count, and an old one does not', async () => {
  const a = mkGroup();
  manual(a.g, a.masha, a.petya, ago(3));
  assert.equal(await ar.runAutoReminds(now), 0);
  const b = mkGroup();
  manual(b.g, b.masha, b.petya, ago(10));
  assert.equal(await ar.runAutoReminds(now), 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(reminders(b.g), [{ auto: 0 }, { auto: 1 }]);
});

test('off, demo, archived groups and early hours are skipped', async () => {
  const off = mkGroup({ auto: 0 });
  const demo = mkGroup({ demo: 1 });
  const archived = mkGroup({ archived: true });
  assert.equal(await ar.runAutoReminds(now), 0);
  for (const x of [off, demo, archived]) assert.equal(reminders(x.g).length, 0);
  const on = mkGroup();
  assert.equal(await ar.runAutoReminds(new Date(2026, 5, 20, 8, 0)), 0);
  assert.equal(reminders(on.g).length, 0);
});

test('a debtor the bot cannot write to is skipped', async () => {
  const { g } = mkGroup({ notify: 0 });
  assert.equal(await ar.runAutoReminds(now), 0);
  assert.equal(reminders(g).length, 0);
});

test('a failed send (bot not ready or error) leaves no record, so it is tried again', async () => {
  const { g } = mkGroup();
  bot.setBotTestHooks();
  assert.equal(await ar.runAutoReminds(now), 0);
  assert.equal(reminders(g).length, 0);
  bot.setBotTestHooks({
    sendMessage: async () => {
      throw new Error('boom');
    },
  });
  assert.equal(await ar.runAutoReminds(now), 0);
  assert.equal(reminders(g).length, 0);
  bot.setBotTestHooks({ sendMessage: capture });
  assert.equal(await ar.runAutoReminds(now), 1);
});

test('sent reminders are counted as debt.autoremind', async () => {
  mkGroup();
  const before = counted();
  await ar.runAutoReminds(now);
  assert.equal(counted(), before + 1);
});
