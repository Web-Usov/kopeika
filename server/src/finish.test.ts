import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.DEV_AUTH = '1';
delete process.env.BOT_TOKEN;

let api: typeof import('./api.ts').api;
let db: typeof import('./db.ts');
let botModule: typeof import('./bot.ts');
let finishCard: typeof import('./finishCard.ts');

interface Post {
  chatId: number | null;
  text: string;
  button: { text: string; url: string } | undefined;
}
let posts: Post[] = [];

before(async () => {
  ({ api } = await import('./api.ts'));
  botModule = await import('./bot.ts');
  db = await import('./db.ts');
  finishCard = await import('./finishCard.ts');
});

const capture = () => {
  posts = [];
  botModule.setBotTestHooks({
    appLink: (param) => `https://t.me/kopeika_bot/app?startapp=${param}`,
    chatPost: async (group, text, button) => {
      posts.push({ chatId: group.chat_id, text, button });
      return true;
    },
  });
};

let nextUser = 5000;
const newUser = (lang = 'ru') => ({ id: nextUser++, lang });

// biome-ignore lint/suspicious/noExplicitAny: test helper over untyped JSON
type Json = any;

async function call(user: { id: number; lang: string }, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `dev ${user.id}`,
    'X-Lang': user.lang,
  };
  const res = await api.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Json };
}

/** A group with a linked chat and two expenses, so the card has something to say. */
async function tripGroup(u: { id: number; lang: string }, opts: { chat?: boolean } = {}) {
  const created = await call(u, 'POST', '/groups', { name: 'Грузия <3', currency: 'RUB', memberNames: ['Маша'] });
  const g = created.body as Json;
  const equal = (title: string, amount: number, spentOn: string, payerId: number) => ({
    title,
    amount,
    payerId,
    splitMode: 'equal',
    spentOn,
    shares: g.members.map((m: Json) => ({ memberId: m.id, value: 1 })),
  });
  const masha = g.members.find((m: Json) => m.name === 'Маша').id;
  await call(u, 'POST', `/groups/${g.id}/expenses`, equal('Хачапури', 100000, '2025-06-01', g.meId));
  await call(u, 'POST', `/groups/${g.id}/expenses`, equal('Такси', 30000, '2025-06-03', masha));
  if (opts.chat !== false)
    db.run('UPDATE groups SET chat_id = ?, chat_title = ? WHERE id = ?', -1000 - g.id, 'Чат', g.id);
  return g;
}

const finishCount = () =>
  db.one<{ n: number | null }>("SELECT SUM(count) AS n FROM stats_daily WHERE event = 'group.finish'")?.n ?? 0;

test('archiving posts the card to the linked chat once, with a summary button', async () => {
  capture();
  const u = newUser();
  const g = await tripGroup(u);
  const res = await call(u, 'POST', `/groups/${g.id}/archive`);
  assert.equal(res.body.archived, true);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].chatId, -1000 - g.id);
  assert.match(posts[0].text, /Грузия &lt;3/);
  assert.match(posts[0].text, /Потрачено всего/);
  assert.equal(posts[0].button?.text, 'Открыть итоги');
  assert.match(posts[0].button?.url ?? '', /startapp=sum_/);
});

test('a repeated archive call does not post again; unarchive and archive again does', async () => {
  capture();
  const u = newUser();
  const g = await tripGroup(u);
  const before = finishCount();
  await call(u, 'POST', `/groups/${g.id}/archive`);
  await call(u, 'POST', `/groups/${g.id}/archive`);
  assert.equal(posts.length, 1);
  assert.equal(finishCount(), before + 1);
  await call(u, 'POST', `/groups/${g.id}/unarchive`);
  await call(u, 'POST', `/groups/${g.id}/archive`);
  assert.equal(posts.length, 2);
  assert.equal(finishCount(), before + 2);
});

test('no linked chat: nothing is posted, the finish is still counted', async () => {
  capture();
  const u = newUser();
  const g = await tripGroup(u, { chat: false });
  const before = finishCount();
  assert.equal((await call(u, 'POST', `/groups/${g.id}/archive`)).status, 200);
  assert.equal(posts.length, 0);
  assert.equal(finishCount(), before + 1);
});

test('demo group: no card and no finish count', async () => {
  capture();
  const u = newUser();
  const demo = (await call(u, 'POST', '/demo')).body as Json;
  db.run('UPDATE groups SET chat_id = ?, chat_title = ? WHERE id = ?', -999, 'Чат', demo.id);
  const before = finishCount();
  assert.equal((await call(u, 'POST', `/groups/${demo.id}/archive`)).status, 200);
  assert.equal(posts.length, 0);
  assert.equal(finishCount(), before);
});

test('the card speaks the language of the person who finished', async () => {
  capture();
  const owner = newUser('ru');
  const g = await tripGroup(owner);
  const guestUser = newUser('en');
  const code = g.inviteCode;
  const joined = await call(guestUser, 'POST', `/invite/${code}/join`, {
    claimMemberId: g.members.find((m: Json) => m.name === 'Маша').id,
  });
  assert.equal(joined.status, 200);
  await call(guestUser, 'POST', `/groups/${g.id}/archive`);
  assert.equal(posts.length, 1);
  assert.match(posts[0].text, /Total spent/);
  assert.equal(posts[0].button?.text, 'Open the summary');
});

test('no card without the bot (no hook, no token)', async () => {
  botModule.setBotTestHooks();
  posts = [];
  const u = newUser();
  const g = await tripGroup(u);
  assert.equal((await call(u, 'POST', `/groups/${g.id}/archive`)).status, 200);
  assert.equal(posts.length, 0);
});

test('card content: totals, days, per-person shares, biggest expense, achievements (ru and en)', () => {
  const base = {
    groupName: 'Грузия',
    currency: 'RUB',
    total: 130000,
    firstDay: '2025-06-01',
    lastDay: '2025-06-03',
    members: [
      { name: 'Маша', spent: 65000 },
      { name: 'Алекс', spent: 65000 },
    ],
    biggest: { title: 'Хачапури', amount: 100000, payer: 'Алекс' },
    achievements: ['first' as const],
    settled: true,
  };
  const ru = finishCard.buildFinishCard({ ...base, lang: 'ru' });
  const en = finishCard.buildFinishCard({ ...base, lang: 'en' });
  assert.match(ru, /3 дня/);
  assert.match(ru, /Маша — 650/);
  assert.match(ru, /Самая крупная трата: «Хачапури»/);
  assert.match(en, /3 days/);
  assert.match(en, /Biggest expense: “Хачапури”/);
  assert.ok(!finishCard.buildFinishCard({ ...base, lang: 'ru', settled: false }).includes('Все в расчёте'));
});
