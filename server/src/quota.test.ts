import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.DEV_AUTH = '1';
delete process.env.BOT_TOKEN;

let api: typeof import('./api.ts').api;
let exportLimiter: typeof import('./api.ts').exportLimiter;
let rateLimiter: typeof import('./api.ts').rateLimiter;
let config: typeof import('./config.ts').config;
let limits: typeof import('./botLimits.ts');
before(async () => {
  ({ api, exportLimiter, rateLimiter } = await import('./api.ts'));
  ({ config } = await import('./config.ts'));
  limits = await import('./botLimits.ts');
  rateLimiter.setLimit(1_000_000);
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
  const res = await call(user, 'POST', '/groups', { name: 'Поездка', currency: 'RUB', memberNames });
  assert.equal(res.status, 201);
  return res.body as Json;
}

const expenseBody = (g: Json, over: Json = {}) => ({
  title: 'Ужин',
  amount: 10000,
  payerId: g.meId,
  splitMode: 'equal',
  spentOn: '2025-01-15',
  shares: g.members.map((m: Json) => ({ memberId: m.id, value: 1 })),
  ...over,
});

async function addExpense(user: number, g: Json, over: Json = {}) {
  return call(user, 'POST', `/groups/${g.id}/expenses`, expenseBody(g, over));
}

// Runs fn with config values overridden, then restores them.
async function withConfig(over: Partial<typeof config>, fn: () => Promise<void>) {
  const saved = { ...config };
  Object.assign(config, over);
  try {
    await fn();
  } finally {
    Object.assign(config, saved);
  }
}

// --- Quotas ---

test('quota: groups per user (create and join)', async () => {
  const owner = newUser();
  const g = await createGroup(owner);
  const u = newUser();
  await withConfig({ maxGroupsPerUser: 2 }, async () => {
    await createGroup(u);
    await createGroup(u);
    const over = await call(u, 'POST', '/groups', { name: 'Ещё', currency: 'RUB' });
    assert.equal(over.status, 409);
    assert.match(over.body.error, /2/);
    const join = await call(u, 'POST', `/invite/${g.inviteCode}/join`, {});
    assert.equal(join.status, 409);
    // The same user who is already in the group is not blocked on re-join.
    const again = await call(owner, 'POST', `/invite/${g.inviteCode}/join`, {});
    assert.equal(again.status, 200);
  });
});

test('quota: members per group (add, create with names, join)', async () => {
  const u = newUser();
  await withConfig({ maxMembersPerGroup: 3 }, async () => {
    const tooMany = await call(u, 'POST', '/groups', { name: 'Г', currency: 'RUB', memberNames: ['a', 'b', 'c'] });
    assert.equal(tooMany.status, 409);
    const g = await createGroup(u, ['a', 'b']);
    const add = await call(u, 'POST', `/groups/${g.id}/members`, { name: 'c' });
    assert.equal(add.status, 409);
    const join = await call(newUser(), 'POST', `/invite/${g.inviteCode}/join`, {});
    assert.equal(join.status, 409);
    // Claiming a name-only member adds nobody, so it still works.
    const claim = await call(newUser(), 'POST', `/invite/${g.inviteCode}/join`, { claimMemberId: g.members[1].id });
    assert.equal(claim.status, 200);
  });
});

test('quota: expenses per group', async () => {
  const u = newUser();
  const g = await createGroup(u);
  await withConfig({ maxExpensesPerGroup: 2 }, async () => {
    assert.equal((await addExpense(u, g)).status, 201);
    assert.equal((await addExpense(u, g)).status, 201);
    const over = await addExpense(u, g);
    assert.equal(over.status, 409);
    assert.match(over.body.error, /2/);
  });
});

test('quota: recurring templates per group', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const tpl = {
    title: 'Аренда',
    amount: 5000,
    payerId: g.meId,
    splitMode: 'equal',
    shares: [{ memberId: g.meId, value: 1 }],
    period: 'monthly',
    day: 5,
  };
  await withConfig({ maxRecurringPerGroup: 1 }, async () => {
    assert.equal((await call(u, 'POST', `/groups/${g.id}/recurring`, tpl)).status, 201);
    assert.equal((await call(u, 'POST', `/groups/${g.id}/recurring`, tpl)).status, 409);
  });
});

// --- Pagination ---

async function seed(u: number, g: Json, n: number) {
  // Dates spread over several days; many share a day to exercise the (date, id) cursor.
  for (let i = 0; i < n; i++) {
    const day = String(1 + (i % 5)).padStart(2, '0');
    const r = await addExpense(u, g, { title: `T${i}`, amount: 100 + i, spentOn: `2025-02-${day}` });
    assert.equal(r.status, 201);
  }
}

test('groupDetail carries the newest page; totals and balances cover everything', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша']);
  await seed(u, g, 12);
  await withConfig({ expensesPage: 5 }, async () => {
    const d = (await call(u, 'GET', `/groups/${g.id}`)).body;
    assert.equal(d.expenses.length, 5);
    assert.equal(d.expensesTotal, 12);
    assert.equal(d.hasMoreExpenses, true);
    const sum = Array.from({ length: 12 }, (_, i) => 100 + i).reduce((a, b) => a + b, 0);
    assert.equal(d.totalSpent, sum);
    assert.equal(d.members[0].balance + d.members[1].balance, 0);
    assert.ok(d.members[0].balance > 0);
    // Newest first by date then id.
    const keys = d.expenses.map((e: Json) => `${e.spentOn}#${String(e.id).padStart(6, '0')}`);
    assert.deepEqual(keys, [...keys].sort().reverse());
  });
});

test('GET /expenses?before pages through every expense exactly once', async () => {
  const u = newUser();
  const g = await createGroup(u);
  await seed(u, g, 23);
  await withConfig({ expensesPage: 7 }, async () => {
    const first = (await call(u, 'GET', `/groups/${g.id}`)).body;
    const seen: number[] = first.expenses.map((e: Json) => e.id);
    let last = seen.at(-1);
    for (let guard = 0; guard < 10; guard++) {
      const page = await call(u, 'GET', `/groups/${g.id}/expenses?before=${last}&limit=7`);
      assert.equal(page.status, 200);
      seen.push(...page.body.items.map((e: Json) => e.id));
      if (!page.body.hasMore) {
        assert.equal(page.body.nextBefore, null);
        break;
      }
      last = page.body.nextBefore;
    }
    assert.equal(seen.length, 23);
    assert.equal(new Set(seen).size, 23);
    const all = (await call(u, 'GET', `/groups/${g.id}/expenses?limit=500`)).body;
    assert.deepEqual(
      seen,
      all.items.map((e: Json) => e.id),
    );
  });
});

test('GET /expenses is members-only; bad cursor is 404; single expense lookup works', async () => {
  const u = newUser();
  const g = await createGroup(u);
  await seed(u, g, 3);
  assert.equal((await call(newUser(), 'GET', `/groups/${g.id}/expenses`)).status, 404);
  assert.equal((await call(newUser(), 'GET', `/groups/${g.id}/expenses/1`)).status, 404);
  assert.equal((await call(u, 'GET', `/groups/${g.id}/expenses?before=999999`)).status, 404);
  assert.equal((await call(u, 'GET', `/groups/${g.id}/expenses?limit=0`)).status, 400);
  const list = (await call(u, 'GET', `/groups/${g.id}/expenses`)).body.items;
  const one = await call(u, 'GET', `/groups/${g.id}/expenses/${list[2].id}`);
  assert.equal(one.status, 200);
  assert.deepEqual(one.body, list[2]);
  // An expense of another group is not reachable through this group.
  const other = await createGroup(newUser());
  assert.equal((await call(u, 'GET', `/groups/${g.id}/expenses/${other.id}`)).status, 404);
});

test('summary, stats and achievements cover all expenses, not only the first page', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша']);
  const cats = ['food', 'transport', 'housing', 'fun', 'shopping'];
  // The oldest expenses are the only ones with these categories and the earliest dates.
  for (let i = 0; i < 5; i++) {
    const r = await addExpense(u, g, {
      title: `old${i}`,
      amount: 1000,
      category: cats[i],
      spentOn: `2024-01-0${i + 1}`,
    });
    assert.equal(r.status, 201);
  }
  for (let i = 0; i < 6; i++) {
    const r = await addExpense(u, g, { title: `new${i}`, amount: 500, category: 'other', spentOn: '2025-03-01' });
    assert.equal(r.status, 201);
  }
  await withConfig({ expensesPage: 3 }, async () => {
    const d = (await call(u, 'GET', `/groups/${g.id}`)).body;
    assert.equal(d.expenses.length, 3);
    const byId = new Map(d.achievements.map((a: Json) => [a.id, a]));
    assert.equal((byId.get('ten') as Json).unlocked, true);
    assert.equal((byId.get('allCategories') as Json).unlocked, true);
    assert.equal((byId.get('month') as Json).unlocked, true);
    assert.equal((byId.get('week') as Json).unlocked, false);
    assert.equal((byId.get('week') as Json).progress.current, 6);

    const s = (await call(u, 'GET', `/groups/${g.id}/summary`)).body;
    assert.equal(s.count, 11);
    assert.equal(s.total, 5 * 1000 + 6 * 500);
    assert.equal(s.firstDay, '2024-01-01');
    const st = (await call(u, 'GET', `/groups/${g.id}/stats`)).body;
    assert.equal(
      st.group.reduce((a: number, c: Json) => a + c.amount, 0),
      8000,
    );
    assert.equal(
      st.mine.reduce((a: number, c: Json) => a + c.amount, 0),
      4000,
    );
  });
  assert.equal((await call(newUser(), 'GET', `/groups/${g.id}/summary`)).status, 404);
  assert.equal((await call(newUser(), 'GET', `/groups/${g.id}/stats`)).status, 404);
});

// --- Bot and export limits ---

test('CSV export: once a minute per user', async () => {
  exportLimiter.reset();
  const u = newUser();
  const g = await createGroup(u);
  const first = await call(u, 'POST', `/groups/${g.id}/export`);
  assert.notEqual(first.status, 429); // 409 without a bot, but it counted
  const second = await call(u, 'POST', `/groups/${g.id}/export`);
  assert.equal(second.status, 429);
  assert.ok(second.body.error.length > 0);
  // Another user is not affected.
  const v = newUser();
  const h = await createGroup(v);
  assert.notEqual((await call(v, 'POST', `/groups/${h.id}/export`)).status, 429);
});

test('bot limits: command throttle replies once, inline is throttled separately', () => {
  limits.resetBotLimits();
  const saved = limits.commandLimiter;
  saved.setLimit(3);
  limits.inlineLimiter.setLimit(2);
  try {
    const verdicts = Array.from({ length: 6 }, () => limits.checkCommand(42));
    assert.deepEqual(verdicts, ['ok', 'ok', 'ok', 'notice', 'silent', 'silent']);
    assert.equal(limits.checkCommand(43), 'ok');
    assert.deepEqual([limits.checkInline(42), limits.checkInline(42), limits.checkInline(42)], [true, true, false]);
  } finally {
    saved.setLimit(config.botCommandsPerMin);
    limits.inlineLimiter.setLimit(config.botInlinePerMin);
    limits.resetBotLimits();
  }
});
