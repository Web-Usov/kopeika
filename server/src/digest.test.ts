import './test-env.ts';
import assert from 'node:assert/strict';
import { before, test } from 'node:test';

delete process.env.BOT_TOKEN;

let d: typeof import('./digest.ts');
let dbm: typeof import('./db.ts');
before(async () => {
  d = await import('./digest.ts');
  dbm = await import('./db.ts');
});

const nbsp = (s: string) => s.replace(/[  ]/g, ' ');

const input = {
  groupName: 'Дача <3',
  currency: 'RUB',
  newCount: 4,
  newTotal: 1230000,
  balances: [
    { name: 'Маша', balance: 50000 },
    { name: 'Петя', balance: -50000 },
    { name: 'Вася', balance: 0 },
  ],
  settlements: [{ from: 'Петя', to: 'Маша', amount: 50000 }],
};

test('digest text (ru): summary, balances without zeros, settlement plan', () => {
  const text = nbsp(d.buildDigest({ ...input, lang: 'ru' }));
  assert.equal(
    text,
    [
      '📊 <b>Итоги дня в «Дача &lt;3»</b>: 4 траты на 12 300 ₽',
      '',
      '<b>Балансы</b>',
      'Маша: +500 ₽',
      'Петя: -500 ₽',
      '',
      '<b>Как рассчитаться</b>',
      'Петя → Маша: 500 ₽',
    ].join('\n'),
  );
});

test('digest text (en): plurals and wording', () => {
  const one = nbsp(d.buildDigest({ ...input, lang: 'en', newCount: 1, newTotal: 10000 }));
  assert.ok(one.startsWith('📊 <b>Daily digest for “Дача &lt;3”</b>: 1 expense for'), one);
  assert.ok(one.includes('<b>How to settle up</b>'));
  assert.ok(nbsp(d.buildDigest({ ...input, lang: 'en' })).includes('4 expenses for'));
});

test('digest: only edits, and everyone settled', () => {
  const ru = d.buildDigest({ ...input, lang: 'ru', newCount: 0, balances: [], settlements: [] });
  assert.ok(ru.includes(': траты менялись'));
  assert.ok(ru.includes('Все в расчёте 🎉'));
  assert.ok(!ru.includes('Балансы'));
});

test('digest: lists are cut at 15 lines (shared with /balance) with "and N more"', () => {
  const balances = Array.from({ length: 25 }, (_, i) => ({ name: `P${i}`, balance: (i % 2 ? -1 : 1) * 100 * (i + 1) }));
  const settlements = Array.from({ length: 20 }, (_, i) => ({ from: `A${i}`, to: `B${i}`, amount: 100 }));
  const lines = d.buildDigest({ ...input, lang: 'ru', balances, settlements }).split('\n');
  assert.ok(lines.includes('и ещё 10'));
  assert.ok(lines.includes('и ещё 5'));
  assert.equal(lines.filter((l) => l.startsWith('A')).length, 15);
  assert.ok(d.buildDigest({ ...input, lang: 'en', balances, settlements }).includes('and 10 more'));
});

test('isDigestDue: from the configured hour, once per local day', () => {
  const at = (h: number, day = 10) => new Date(2026, 4, day, h, 30);
  assert.equal(d.isDigestDue(at(19), 20, null), false);
  assert.equal(d.isDigestDue(at(20), 20, null), true);
  assert.equal(d.isDigestDue(at(23), 20, '2026-05-09'), true);
  assert.equal(d.isDigestDue(at(21), 20, '2026-05-10'), false);
  assert.equal(d.isDigestDue(at(20, 11), 20, '2026-05-10'), true);
  assert.equal(d.isDigestDue(at(0), 0, null), true);
  assert.equal(d.localDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('digestSince: last digest, else the previous 24 hours', () => {
  const now = new Date('2026-05-10T17:00:00Z');
  assert.equal(d.digestSince(now, '2026-05-09 17:00:05'), '2026-05-09 17:00:05');
  assert.equal(d.digestSince(now, null), '2026-05-09 17:00:00');
});

test('runDigests: only daily groups with activity, once a day, retried when sending fails', async () => {
  const { run, one } = dbm;
  run("INSERT INTO users (id, first_name, lang) VALUES (1, 'Маша', 'ru')");
  const mk = (name: string, feed: string, chat: number | null) =>
    Number(
      run(
        'INSERT INTO groups (name, currency, invite_code, created_by, chat_id, chat_title, chat_feed) VALUES (?, ?, ?, 1, ?, ?, ?)',
        name,
        'RUB',
        `inv-${name}`,
        chat,
        chat === null ? null : 'Чат',
        feed,
      ).lastInsertRowid,
    );
  const daily = mk('daily', 'daily', -1);
  const quiet = mk('quiet', 'daily', -2);
  const each = mk('each', 'each', -3);
  const unlinked = mk('unlinked', 'daily', null);
  for (const g of [daily, each, unlinked]) {
    const m = Number(run('INSERT INTO members (group_id, user_id, name) VALUES (?, 1, ?)', g, 'Маша').lastInsertRowid);
    const e = Number(
      run(
        "INSERT INTO expenses (group_id, kind, title, amount, payer_id, split_mode, spent_on, created_by) VALUES (?, 'expense', 'Ужин', 10000, ?, 'equal', '2026-05-10', 1)",
        g,
        m,
      ).lastInsertRowid,
    );
    run('INSERT INTO expense_shares (expense_id, member_id, input, amount) VALUES (?, ?, 1, 10000)', e, m);
    run("INSERT INTO activity (group_id, user_id, action, payload) VALUES (?, 1, 'expense.create', '{}')", g);
  }
  run("INSERT INTO activity (group_id, user_id, action, payload) VALUES (?, 1, 'group.rename', '{}')", quiet);

  const sent: { chat: number | null; text: string; button?: { text: string; url: string } }[] = [];
  let ok = true;
  const send = async (g: { chat_id: number | null }, text: string, button?: { text: string; url: string }) => {
    sent.push({ chat: g.chat_id, text, button });
    return ok;
  };
  const link = (code: string) => `https://t.me/b/a?startapp=${code}`;
  const now = new Date(); // hour 0: due at any time of day
  const lastDate = () =>
    one<{ last_digest_date: string | null }>('SELECT * FROM groups WHERE id = ?', daily)?.last_digest_date;

  // Failing send: the marks are restored, so the next check tries again.
  ok = false;
  assert.deepEqual(await d.runDigests(now, 0, send, link), [daily]);
  assert.equal(lastDate(), null);

  ok = true;
  assert.deepEqual(await d.runDigests(now, 0, send, link), [daily]);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].chat, -1);
  assert.match(sent[1].text, /Итоги дня в «daily»/);
  assert.deepEqual(sent[1].button, { text: 'Открыть группу', url: 'https://t.me/b/a?startapp=inv-daily' });
  assert.equal(lastDate(), d.localDate(now));

  // Same day again: nothing.
  assert.deepEqual(await d.runDigests(now, 0, send, link), []);
  assert.equal(sent.length, 2);

  // Next day without new activity: nothing is sent.
  const tomorrow = new Date(now.getTime() + 24 * 3600_000);
  assert.deepEqual(await d.runDigests(tomorrow, 0, send, link), []);
});
