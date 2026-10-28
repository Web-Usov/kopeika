import assert from 'node:assert/strict';
import { before, test } from 'node:test';

// config.ts and db.ts read env at import time, so set it before the dynamic import.
process.env.DB_PATH = ':memory:';
process.env.DEV_AUTH = '1';
delete process.env.BOT_TOKEN;

let api: typeof import('./api.ts').api;
let runRecurring: typeof import('./recurring.ts').runRecurring;
let localDate: typeof import('./recurring.ts').localDate;
let db: typeof import('./db.ts');
before(async () => {
  ({ api } = await import('./api.ts'));
  ({ runRecurring, localDate } = await import('./recurring.ts'));
  db = await import('./db.ts');
});

let nextUser = 5000;
const newUser = () => nextUser++;

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

async function createGroup(user: number, memberNames: string[] = []) {
  const res = await call(user, 'POST', '/groups', { name: 'Квартира', currency: 'RUB', memberNames });
  assert.equal(res.status, 201);
  return res.body as Json;
}

const template = (g: Json, over: Json = {}) => ({
  title: 'Аренда',
  amount: 30000,
  payerId: g.meId,
  splitMode: 'equal',
  shares: g.members.map((m: Json) => ({ memberId: m.id, value: 1 })),
  period: 'monthly',
  day: 5,
  ...over,
});

const expensesOf = async (u: number, g: Json) => (await call(u, 'GET', `/groups/${g.id}`)).body.expenses as Json[];

/** Pretends the template's next occurrence was `date` (as if the server had been down since then). */
const setNext = (id: number, date: string) => db.run('UPDATE recurring SET next_date = ? WHERE id = ?', date, id);

test('creating a template computes next_date and creates nothing yet', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша']);
  const res = await call(u, 'POST', `/groups/${g.id}/recurring`, template(g, { startDate: '2999-03-31', day: 31 }));
  assert.equal(res.status, 201);
  assert.equal(res.body.nextDate, '2999-03-31');
  assert.equal(res.body.active, true);
  assert.equal((await expensesOf(u, g)).length, 0);
  assert.equal((await call(u, 'GET', `/groups/${g.id}/recurring`)).body.length, 1);
});

test('a start date in the past does not back-fill: the first occurrence is not before today', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const res = await call(
    u,
    'POST',
    `/groups/${g.id}/recurring`,
    template(g, { startDate: '2020-01-01', period: 'weekly', day: 1 }),
  );
  assert.equal(res.status, 201);
  assert.ok(res.body.nextDate >= localDate());
});

test('a due template creates the expense once, re-running never duplicates', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша']);
  const tpl = (await call(u, 'POST', `/groups/${g.id}/recurring`, template(g))).body;
  setNext(tpl.id, '2025-01-05');

  assert.equal(runRecurring('2025-01-05'), 1);
  assert.equal(runRecurring('2025-01-05'), 0);
  assert.equal(runRecurring('2025-01-20'), 0);

  const list = await expensesOf(u, g);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Аренда');
  assert.equal(list[0].amount, 30000);
  assert.equal(list[0].spentOn, '2025-01-05');
  assert.deepEqual(
    list[0].shares.map((s: Json) => s.amount),
    [15000, 15000],
  );
  const after = (await call(u, 'GET', `/groups/${g.id}/recurring`)).body[0];
  assert.equal(after.nextDate, '2025-02-05');

  const history = (await call(u, 'GET', `/groups/${g.id}/activity`)).body.items as Json[];
  assert.equal(history.find((h) => h.action === 'expense.create')?.payload.recurring, true);
});

test('downtime: only the last three missed occurrences are created', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const tpl = (await call(u, 'POST', `/groups/${g.id}/recurring`, template(g, { day: 1 }))).body;
  setNext(tpl.id, '2025-01-01');
  runRecurring('2025-06-10');
  assert.deepEqual((await expensesOf(u, g)).map((e) => e.spentOn).sort(), ['2025-04-01', '2025-05-01', '2025-06-01']);
  assert.equal((await call(u, 'GET', `/groups/${g.id}/recurring`)).body[0].nextDate, '2025-07-01');
});

test('a paused template creates nothing; resuming starts from today', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const tpl = (await call(u, 'POST', `/groups/${g.id}/recurring`, template(g))).body;
  const paused = await call(u, 'PATCH', `/groups/${g.id}/recurring/${tpl.id}`, { active: false });
  assert.equal(paused.body.active, false);
  setNext(tpl.id, '2025-01-05');
  assert.equal(runRecurring('2025-03-05'), 0);
  const resumed = await call(u, 'PATCH', `/groups/${g.id}/recurring/${tpl.id}`, { active: true });
  assert.equal(resumed.body.active, true);
  assert.ok(resumed.body.nextDate >= localDate());
});

test('an archived group stays archived: due occurrences pass by without expenses', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша']);
  const tpl = (await call(u, 'POST', `/groups/${g.id}/recurring`, template(g))).body;
  await call(u, 'POST', `/groups/${g.id}/archive`);
  setNext(tpl.id, '2025-01-05');

  assert.equal(runRecurring('2025-03-10'), 0);
  assert.equal(runRecurring('2025-04-05'), 0);
  assert.equal((await expensesOf(u, g)).length, 0);
  assert.equal((await call(u, 'GET', `/groups/${g.id}`)).body.archived, true);
  const after = (await call(u, 'GET', `/groups/${g.id}/recurring`)).body[0];
  assert.equal(after.nextDate, '2025-05-05');
  assert.equal(after.active, true);
});

test('unarchiving resumes from the nearest date; missed occurrences are not made up', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша']);
  const tpl = (await call(u, 'POST', `/groups/${g.id}/recurring`, template(g, { period: 'weekly', day: 1 }))).body;
  await call(u, 'POST', `/groups/${g.id}/archive`);
  // The scheduler has not passed yet, so next_date is still in the past at the moment of unarchiving.
  setNext(tpl.id, '2025-01-06');
  assert.equal((await call(u, 'POST', `/groups/${g.id}/unarchive`)).body.archived, false);

  const next = (await call(u, 'GET', `/groups/${g.id}/recurring`)).body[0].nextDate;
  assert.ok(next >= localDate());
  runRecurring(localDate());
  assert.ok((await expensesOf(u, g)).every((e) => e.spentOn >= localDate()));
  runRecurring(next);
  const list = await expensesOf(u, g);
  assert.equal(list.length, 1);
  assert.equal(list[0].spentOn, next);
});

test('a template whose member was deleted is switched off instead of crashing', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша']);
  const masha = g.members.find((m: Json) => m.name === 'Маша');
  const tpl = (await call(u, 'POST', `/groups/${g.id}/recurring`, template(g))).body;
  // The API refuses this now, so remove the member behind its back to exercise the scheduler's own guard.
  assert.equal((await call(u, 'DELETE', `/groups/${g.id}/members/${masha.id}`)).status, 409);
  db.run('DELETE FROM members WHERE id = ?', masha.id);
  setNext(tpl.id, '2025-01-05');
  assert.equal(runRecurring('2025-01-05'), 0);
  assert.equal((await call(u, 'GET', `/groups/${g.id}/recurring`)).body[0].active, false);
  assert.equal((await expensesOf(u, g)).length, 0);
});

test('only members can see and change templates; a foreign member is rejected', async () => {
  const u = newUser();
  const other = newUser();
  const g = await createGroup(u);
  const g2 = await createGroup(other);
  assert.equal((await call(other, 'GET', `/groups/${g.id}/recurring`)).status, 404);
  assert.equal((await call(other, 'POST', `/groups/${g.id}/recurring`, template(g))).status, 404);
  const bad = await call(
    u,
    'POST',
    `/groups/${g.id}/recurring`,
    template(g, { payerId: g2.meId, shares: [{ memberId: g2.meId, value: 1 }] }),
  );
  assert.equal(bad.status, 400);
  const tpl = (await call(u, 'POST', `/groups/${g.id}/recurring`, template(g))).body;
  assert.equal((await call(other, 'PATCH', `/groups/${g.id}/recurring/${tpl.id}`, { active: false })).status, 404);
  assert.equal((await call(other, 'DELETE', `/groups/${g.id}/recurring/${tpl.id}`)).status, 404);
  assert.equal((await call(other, 'DELETE', `/groups/${g2.id}/recurring/${tpl.id}`)).status, 404);
});

test('validation: day range depends on the period; deleting a template stops it', async () => {
  const u = newUser();
  const g = await createGroup(u);
  assert.equal(
    (await call(u, 'POST', `/groups/${g.id}/recurring`, template(g, { period: 'weekly', day: 8 }))).status,
    400,
  );
  assert.equal(
    (await call(u, 'POST', `/groups/${g.id}/recurring`, template(g, { period: 'monthly', day: 32 }))).status,
    400,
  );
  const tpl = (await call(u, 'POST', `/groups/${g.id}/recurring`, template(g))).body;
  const edited = await call(u, 'PATCH', `/groups/${g.id}/recurring/${tpl.id}`, {
    amount: 45000,
    period: 'weekly',
    day: 3,
  });
  assert.equal(edited.body.amount, 45000);
  assert.equal(edited.body.period, 'weekly');
  assert.equal((await call(u, 'DELETE', `/groups/${g.id}/recurring/${tpl.id}`)).status, 200);
  assert.equal((await call(u, 'GET', `/groups/${g.id}/recurring`)).body.length, 0);
});

test('a member in recurring templates cannot be deleted until they are removed from them', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша', 'Коля', 'Петя']);
  const id = (name: string) => g.members.find((m: Json) => m.name === name).id as number;
  const del = (memberId: number) => call(u, 'DELETE', `/groups/${g.id}/members/${memberId}`);

  // Payer of an active template.
  const asPayer = (await call(u, 'POST', `/groups/${g.id}/recurring`, template(g, { payerId: id('Маша') }))).body;
  const res = await del(id('Маша'));
  assert.equal(res.status, 409);
  assert.match(res.body.error, /регулярных/);

  // In the shares of an active template (not the payer).
  const onlyKolya = template(g, { shares: [{ memberId: id('Коля'), value: 1 }] });
  const asShare = (await call(u, 'POST', `/groups/${g.id}/recurring`, onlyKolya)).body;
  assert.equal((await del(id('Коля'))).status, 409);

  // In the shares of a paused template.
  const paused = (
    await call(u, 'POST', `/groups/${g.id}/recurring`, template(g, { shares: [{ memberId: id('Петя'), value: 1 }] }))
  ).body;
  assert.equal((await call(u, 'PATCH', `/groups/${g.id}/recurring/${paused.id}`, { active: false })).status, 200);
  assert.equal((await del(id('Петя'))).status, 409);

  // Once the templates are gone, the members can be deleted.
  for (const tpl of [asPayer, asShare, paused])
    assert.equal((await call(u, 'DELETE', `/groups/${g.id}/recurring/${tpl.id}`)).status, 200);
  for (const name of ['Маша', 'Коля', 'Петя']) assert.equal((await del(id(name))).status, 200);
});

test('a member without expenses and templates is deleted as before', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша']);
  await call(u, 'POST', `/groups/${g.id}/recurring`, template(g, { shares: [{ memberId: g.meId, value: 1 }] }));
  const masha = g.members.find((m: Json) => m.name === 'Маша');
  assert.equal((await call(u, 'DELETE', `/groups/${g.id}/members/${masha.id}`)).status, 200);
});
