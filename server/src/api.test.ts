import assert from 'node:assert/strict';
import { before, test } from 'node:test';

// config.ts and db.ts read env at import time, so set it before the dynamic import.
process.env.DB_PATH = ':memory:';
process.env.DEV_AUTH = '1';
delete process.env.BOT_TOKEN;

let api: typeof import('./api.ts').api;
let rateLimiter: typeof import('./api.ts').rateLimiter;
let chatLink: typeof import('./chatLink.ts');
let db: typeof import('./db.ts');
let localDate: typeof import('./recurring.ts').localDate;
let botModule: typeof import('./bot.ts');
before(async () => {
  ({ api, rateLimiter } = await import('./api.ts'));
  botModule = await import('./bot.ts');
  db = await import('./db.ts');
  // Most tests act as a chat admin; the admin check itself is covered separately.
  botModule.setBotTestHooks({ chatMember: async () => 'administrator' });
  chatLink = await import('./chatLink.ts');
  ({ localDate } = await import('./recurring.ts'));
});

// Every test uses its own users so tests do not depend on order.
let nextUser = 1000;
const newUser = () => nextUser++;

// biome-ignore lint/suspicious/noExplicitAny: test helper over untyped JSON
type Json = any;

async function call(user: number | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (user !== null) headers.Authorization = `dev ${user}`;
  const res = await api.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Json };
}

async function createGroup(user: number, memberNames: string[] = []) {
  const res = await call(user, 'POST', '/groups', { name: 'Поездка', currency: 'RUB', memberNames });
  assert.equal(res.status, 201);
  return res.body as Json;
}

const expense = (g: Json, over: Json = {}) => ({
  title: 'Ужин',
  amount: 10000,
  payerId: g.meId,
  splitMode: 'equal',
  spentOn: '2025-01-15',
  shares: g.members.map((m: Json) => ({ memberId: m.id, value: 1 })),
  ...over,
});

const balances = (g: Json) => g.members.map((m: Json) => m.balance);

test('request without Authorization is rejected with 401', async () => {
  assert.equal((await call(null, 'GET', '/groups')).status, 401);
});

test('creating a group makes the creator an owner member', async () => {
  const u = newUser();
  const res = await call(u, 'POST', '/groups', { name: 'Дача', currency: 'RUB', memberNames: ['Маша', 'Петя'] });
  assert.equal(res.status, 201);
  assert.equal(res.body.isOwner, true);
  assert.equal(res.body.members.length, 3);
  const mine = res.body.members.find((m: Json) => m.id === res.body.meId);
  assert.equal(mine.hasTelegram, true);
  assert.deepEqual(res.body.members.map((m: Json) => m.name).slice(1), ['Маша', 'Петя']);
});

test('non-member gets 404 on a group', async () => {
  const g = await createGroup(newUser());
  assert.equal((await call(newUser(), 'GET', `/groups/${g.id}`)).status, 404);
});

test('invite preview and joining as a new member', async () => {
  const g = await createGroup(newUser(), ['Маша']);
  const guest = newUser();
  const preview = await call(guest, 'GET', `/invite/${g.inviteCode}`);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.group.membersCount, 2);
  assert.equal(preview.body.isMember, false);
  assert.equal(preview.body.unclaimed.length, 1);
  assert.deepEqual(
    preview.body.members.map((m: Json) => m.name),
    [g.members[0].name, 'Маша'],
  );
  assert.ok(preview.body.members.every((m: Json) => Object.keys(m).sort().join() === 'id,name'));

  const join = await call(guest, 'POST', `/invite/${g.inviteCode}/join`, {});
  assert.equal(join.status, 200);
  assert.equal(join.body.groupId, g.id);
  const after = await call(guest, 'GET', `/groups/${g.id}`);
  assert.equal(after.status, 200);
  assert.equal(after.body.members.length, 3);
  assert.equal(after.body.isOwner, false);
});

test('claiming a member links it; a second claim gives 409', async () => {
  const g = await createGroup(newUser(), ['Маша']);
  const masha = g.members.find((m: Json) => m.name === 'Маша');
  const first = newUser();
  const claim = await call(first, 'POST', `/invite/${g.inviteCode}/join`, { claimMemberId: masha.id });
  assert.equal(claim.status, 200);
  const detail = await call(first, 'GET', `/groups/${g.id}`);
  assert.equal(detail.body.meId, masha.id);
  assert.equal(detail.body.members.length, 2);

  const second = await call(newUser(), 'POST', `/invite/${g.inviteCode}/join`, { claimMemberId: masha.id });
  assert.equal(second.status, 409);
});

test('equal split of 100.00 between three is 33.34 / 33.33 / 33.33', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша', 'Петя']);
  const res = await call(u, 'POST', `/groups/${g.id}/expenses`, expense(g));
  assert.equal(res.status, 201);
  const amounts = res.body.expenses[0].shares.map((s: Json) => s.amount);
  assert.deepEqual([...amounts].sort(), [3333, 3333, 3334]);
  assert.equal(
    amounts.reduce((a: number, b: number) => a + b, 0),
    10000,
  );
  assert.equal(res.body.totalSpent, 10000);
});

test('exact split that does not add up is rejected with 400', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша']);
  const bad = expense(g, {
    splitMode: 'exact',
    shares: [
      { memberId: g.members[0].id, value: 3000 },
      { memberId: g.members[1].id, value: 3000 },
    ],
  });
  assert.equal((await call(u, 'POST', `/groups/${g.id}/expenses`, bad)).status, 400);
});

test('member of another group in an expense gives 400', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const other = await createGroup(newUser());
  const res = await call(
    u,
    'POST',
    `/groups/${g.id}/expenses`,
    expense(g, { shares: [{ memberId: other.members[0].id, value: 1 }] }),
  );
  assert.equal(res.status, 400);
});

test('a transfer after expenses zeroes balances and empties settlements', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша']);
  const [me, masha] = g.members;
  const added = await call(u, 'POST', `/groups/${g.id}/expenses`, expense(g, { amount: 10000 }));
  assert.equal(added.body.settlements.length, 1);
  assert.deepEqual(balances(added.body), [5000, -5000]);

  const transfer = await call(u, 'POST', `/groups/${g.id}/expenses`, {
    kind: 'transfer',
    amount: 5000,
    payerId: masha.id,
    splitMode: 'exact',
    spentOn: '2025-01-16',
    shares: [{ memberId: me.id, value: 5000 }],
  });
  assert.equal(transfer.status, 201);
  assert.deepEqual(balances(transfer.body), [0, 0]);
  assert.deepEqual(transfer.body.settlements, []);
  assert.equal(transfer.body.totalSpent, 10000);
});

test('deleting a member: 409 with expenses, 200 without', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша', 'Петя']);
  const [me, masha, petya] = g.members;
  await call(u, 'POST', `/groups/${g.id}/expenses`, {
    ...expense(g),
    shares: [me, masha].map((m) => ({ memberId: m.id, value: 1 })),
  });
  assert.equal((await call(u, 'DELETE', `/groups/${g.id}/members/${masha.id}`)).status, 409);
  const ok = await call(u, 'DELETE', `/groups/${g.id}/members/${petya.id}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.members.length, 2);
});

test('only the owner can delete a group', async () => {
  const owner = newUser();
  const g = await createGroup(owner);
  const guest = newUser();
  await call(guest, 'POST', `/invite/${g.inviteCode}/join`, {});
  assert.equal((await call(guest, 'DELETE', `/groups/${g.id}`)).status, 403);
  assert.equal((await call(owner, 'DELETE', `/groups/${g.id}`)).status, 200);
  assert.equal((await call(owner, 'GET', `/groups/${g.id}`)).status, 404);
});

test('PUT on an expense recalculates shares and balances', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша']);
  const created = await call(u, 'POST', `/groups/${g.id}/expenses`, expense(g, { amount: 10000 }));
  assert.deepEqual(balances(created.body), [5000, -5000]);
  const id = created.body.expenses[0].id;

  const updated = await call(u, 'PUT', `/groups/${g.id}/expenses/${id}`, expense(g, { amount: 20000 }));
  assert.equal(updated.status, 200);
  assert.deepEqual(
    updated.body.expenses[0].shares.map((s: Json) => s.amount),
    [10000, 10000],
  );
  assert.deepEqual(balances(updated.body), [10000, -10000]);
  assert.equal(updated.body.totalSpent, 20000);
});

test('rate limit: requests over the limit get 429, other users are unaffected', async () => {
  rateLimiter.setLimit(3);
  try {
    const user = newUser();
    for (let i = 0; i < 3; i++) assert.equal((await call(user, 'GET', '/me')).status, 200);
    const blocked = await call(user, 'GET', '/me');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'Слишком много запросов, попробуйте через минуту');
    assert.equal((await call(newUser(), 'GET', '/me')).status, 200);
  } finally {
    rateLimiter.setLimit(120);
  }
});

test('API errors are in the request language: Russian by default, English with X-Lang', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша']);
  const bad = expense(g, {
    splitMode: 'exact',
    shares: [
      { memberId: g.members[0].id, value: 3000 },
      { memberId: g.members[1].id, value: 3000 },
    ],
  });
  const post = async (lang?: string) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `dev ${u}` };
    if (lang) headers['X-Lang'] = lang;
    const res = await api.request(`/groups/${g.id}/expenses`, { method: 'POST', headers, body: JSON.stringify(bad) });
    return { status: res.status, body: (await res.json()) as Json };
  };
  const ru = await post();
  assert.equal(ru.status, 400);
  assert.equal(ru.body.error, 'Сумма долей не совпадает с общей суммой');
  const en = await post('en');
  assert.equal(en.status, 400);
  assert.equal(en.body.error, 'The amounts don’t add up to the total');
  assert.equal((await post('ru')).body.error, ru.body.error);

  // Other errors too: a missing group, invalid body.
  const headers = { Authorization: `dev ${u}`, 'X-Lang': 'en' };
  const missing = await api.request('/groups/999999', { headers });
  assert.equal(((await missing.json()) as Json).error, 'Group not found');
  const invalid = await api.request('/groups', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(((await invalid.json()) as Json).error, 'Invalid data');
});

test('the user language is stored on every request and used by the bot', async () => {
  const { one } = await import('./db.ts');
  const u = newUser();
  await api.request('/me', { headers: { Authorization: `dev ${u}`, 'X-Lang': 'en' } });
  assert.equal(one<{ lang: string }>('SELECT lang FROM users WHERE id = ?', u)?.lang, 'en');
  await api.request('/me', { headers: { Authorization: `dev ${u}`, 'X-Lang': 'ru' } });
  assert.equal(one<{ lang: string }>('SELECT lang FROM users WHERE id = ?', u)?.lang, 'ru');
  // No language info: the stored value stays.
  await api.request('/me', { headers: { Authorization: `dev ${u}` } });
  assert.equal(one<{ lang: string }>('SELECT lang FROM users WHERE id = ?', u)?.lang, 'ru');
});

test('expense category: default, create, update, validation, transfers', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша']);
  const url = `/groups/${g.id}/expenses`;

  let res = await call(u, 'POST', url, expense(g));
  assert.equal(res.status, 201);
  assert.equal(res.body.expenses[0].category, 'other');

  res = await call(u, 'POST', url, expense(g, { title: 'Такси', category: 'transport' }));
  assert.equal(res.status, 201);
  const taxi = res.body.expenses.find((e: Json) => e.title === 'Такси');
  assert.equal(taxi.category, 'transport');

  // Update without a category keeps the stored one; with a category changes it.
  res = await call(u, 'PUT', `${url}/${taxi.id}`, expense(g, { title: 'Такси 2' }));
  assert.equal(res.body.expenses.find((e: Json) => e.id === taxi.id).category, 'transport');
  res = await call(u, 'PUT', `${url}/${taxi.id}`, expense(g, { title: 'Такси 2', category: 'fun' }));
  assert.equal(res.body.expenses.find((e: Json) => e.id === taxi.id).category, 'fun');

  res = await call(u, 'POST', url, expense(g, { category: 'rocket' }));
  assert.equal(res.status, 400);
  res = await call(u, 'PUT', `${url}/${taxi.id}`, expense(g, { category: 'rocket' }));
  assert.equal(res.status, 400);

  const other = g.members.find((m: Json) => m.id !== g.meId);
  res = await call(u, 'POST', url, {
    kind: 'transfer',
    amount: 500,
    payerId: g.meId,
    splitMode: 'exact',
    spentOn: '2025-01-16',
    category: 'food',
    shares: [{ memberId: other.id, value: 500 }],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.expenses.find((e: Json) => e.kind === 'transfer').category, null);
});

// --- Payment details ---
const putInfo = (u: number, body: Json) => call(u, 'PUT', '/me/payment-info', body);

test('own payment details: saved, normalized, read back', async () => {
  const u = newUser();
  assert.deepEqual((await call(u, 'GET', '/me/payment-info')).body, {});
  const res = await putInfo(u, {
    phone: '8 (900) 123-45-67',
    bank: ' Т-Банк ',
    card: '2200 1234 5678 9010',
    link: 'https://example.com/pay',
    note: '',
  });
  assert.equal(res.status, 200);
  const expected = { phone: '+79001234567', bank: 'Т-Банк', card: '2200123456789010', link: 'https://example.com/pay' };
  assert.deepEqual(res.body, expected);
  assert.deepEqual((await call(u, 'GET', '/me/payment-info')).body, expected);
  // Saving an empty object clears the details.
  assert.deepEqual((await putInfo(u, {})).body, {});
  assert.deepEqual((await call(u, 'GET', '/me/payment-info')).body, {});
});

test('phone normalization: +7 forms and international numbers', async () => {
  const u = newUser();
  assert.equal((await putInfo(u, { phone: '+7 900 123-45-67' })).body.phone, '+79001234567');
  assert.equal((await putInfo(u, { phone: '79001234567' })).body.phone, '+79001234567');
  assert.equal((await putInfo(u, { phone: '+1 (555) 123-4567' })).body.phone, '+15551234567');
});

test('payment details validation: 400 with a message', async () => {
  const u = newUser();
  for (const bad of [
    { phone: 'abc' },
    { phone: '123' },
    { card: '1234' },
    { card: '1234 5678 9012 345a' },
    { link: 'http://example.com' },
    { link: 'javascript:alert(1)' },
    { link: 'не ссылка' },
    { bank: 'x'.repeat(65) },
    { note: 'x'.repeat(201) },
    { unknown: 'field' },
  ]) {
    const res = await putInfo(u, bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.ok(res.body.error);
  }
  assert.deepEqual((await call(u, 'GET', '/me/payment-info')).body, {});
});

test('payment details are visible to co-members, not to outsiders or in the invite preview', async () => {
  const owner = newUser();
  const friend = newUser();
  const outsider = newUser();
  await putInfo(owner, { phone: '+79001234567', bank: 'Т-Банк' });
  const g = await createGroup(owner);

  const preview = await call(friend, 'GET', `/invite/${g.inviteCode}`);
  assert.ok(!JSON.stringify(preview.body).includes('79001234567'));
  assert.ok(!JSON.stringify(preview.body).includes('paymentInfo'));

  await call(friend, 'POST', `/invite/${g.inviteCode}/join`, {});
  const seen = (await call(friend, 'GET', `/groups/${g.id}`)).body;
  const ownerMember = seen.members.find((m: Json) => m.hasTelegram);
  assert.deepEqual(ownerMember.paymentInfo, { phone: '+79001234567', bank: 'Т-Банк' });
  const friendMember = seen.members.filter((m: Json) => m.hasTelegram).at(-1);
  assert.deepEqual(friendMember.paymentInfo, {});

  assert.equal((await call(outsider, 'GET', `/groups/${g.id}`)).status, 404);
  assert.ok(!JSON.stringify((await call(outsider, 'GET', '/groups')).body).includes('79001234567'));
});

test('payment details of a member without Telegram: set via PATCH member', async () => {
  const owner = newUser();
  const g = await createGroup(owner, ['Маша']);
  const masha = g.members.find((m: Json) => m.name === 'Маша');
  const path = `/groups/${g.id}/members/${masha.id}`;
  const res = await call(owner, 'PATCH', path, { paymentInfo: { phone: '89001112233', card: '4276 0000 1111 2222' } });
  assert.equal(res.status, 200);
  const updated = res.body.members.find((m: Json) => m.id === masha.id);
  assert.deepEqual(updated.paymentInfo, { phone: '+79001112233', card: '4276000011112222' });
  assert.equal(updated.name, 'Маша');

  // Renaming alone keeps the details.
  const renamed = await call(owner, 'PATCH', path, { name: 'Маша К.' });
  assert.deepEqual(renamed.body.members.find((m: Json) => m.id === masha.id).paymentInfo, updated.paymentInfo);

  // Bad values and an empty body are rejected.
  assert.equal((await call(owner, 'PATCH', path, { paymentInfo: { card: '12' } })).status, 400);
  assert.equal((await call(owner, 'PATCH', path, {})).status, 400);

  // Someone outside the group cannot touch it.
  assert.equal((await call(newUser(), 'PATCH', path, { paymentInfo: { bank: 'X' } })).status, 404);
});

test('payment details cannot be set through the group for a member with Telegram', async () => {
  const owner = newUser();
  const g = await createGroup(owner);
  const res = await call(owner, 'PATCH', `/groups/${g.id}/members/${g.meId}`, { paymentInfo: { bank: 'X' } });
  assert.equal(res.status, 409);
  assert.deepEqual((await call(owner, 'GET', '/me/payment-info')).body, {});
});

// --- History ---
const history = async (user: number, g: Json, query = '') => {
  const res = await call(user, 'GET', `/groups/${g.id}/activity${query}`);
  assert.equal(res.status, 200);
  return res.body as { items: Json[]; nextBefore: number | null };
};

test('history records every kind of change, newest first', async () => {
  const owner = newUser();
  let g = await createGroup(owner, ['Маша']);
  const masha = g.members.find((m: Json) => m.name === 'Маша');
  const base = `/groups/${g.id}`;

  await call(owner, 'PATCH', base, { name: 'Дача' });
  await call(owner, 'POST', `${base}/members`, { name: 'Коля' });
  g = (await call(owner, 'GET', base)).body;
  const kolya = g.members.find((m: Json) => m.name === 'Коля');
  await call(owner, 'PATCH', `${base}/members/${kolya.id}`, { name: 'Николай' });
  await call(owner, 'PATCH', `${base}/members/${masha.id}`, { paymentInfo: { card: '1234567812345678' } });
  await call(owner, 'DELETE', `${base}/members/${kolya.id}`);

  const two = [
    { memberId: g.meId, value: 1 },
    { memberId: masha.id, value: 1 },
  ];
  const created = await call(owner, 'POST', `${base}/expenses`, expense(g, { shares: two }));
  const e = created.body.expenses[0];
  await call(owner, 'PUT', `${base}/expenses/${e.id}`, expense(g, { amount: 12000, shares: two }));
  await call(owner, 'DELETE', `${base}/expenses/${e.id}`);
  const tr = await call(owner, 'POST', `${base}/expenses`, {
    kind: 'transfer',
    amount: 500,
    payerId: masha.id,
    splitMode: 'equal',
    spentOn: '2025-01-15',
    shares: [{ memberId: g.meId, value: 1 }],
  });
  await call(owner, 'DELETE', `${base}/expenses/${tr.body.expenses[0].id}`);

  const claimer = newUser();
  await call(claimer, 'POST', `/invite/${g.inviteCode}/join`, { claimMemberId: masha.id });
  await call(newUser(), 'POST', `/invite/${g.inviteCode}/join`, {});

  const { items, nextBefore } = await history(owner, g);
  assert.equal(nextBefore, null);
  assert.deepEqual(items.map((i) => i.action).reverse(), [
    'group.create',
    'group.rename',
    'member.add',
    'member.rename',
    'member.payment_info',
    'member.delete',
    'expense.create',
    'expense.update',
    'expense.delete',
    'expense.create',
    'expense.delete',
    'member.claim',
    'member.join',
  ]);
  const by = (action: string) => items.filter((i) => i.action === action);
  assert.equal(by('group.rename')[0].payload.from, 'Поездка');
  assert.equal(by('member.rename')[0].payload.to, 'Николай');
  assert.equal(by('expense.update')[0].payload.before.amount, 10000);
  assert.equal(by('expense.update')[0].payload.after.amount, 12000);
  assert.equal(by('expense.update')[0].payload.after.title, 'Ужин');
  const transfer = by('expense.create')[0].payload.expense;
  assert.equal(transfer.kind, 'transfer');
  assert.equal(transfer.to.id, g.meId);
  // Requisites themselves never reach the log.
  assert.ok(!JSON.stringify(items).includes('1234567812345678'));
  // The actor is the member of the person who did it.
  assert.equal(by('group.create')[0].actor.memberId, g.meId);
  assert.equal(by('member.claim')[0].actor.memberId, masha.id);
  assert.match(items[0].createdAt, /^\d{4}-\d\d-\d\dT[\d:]+Z$/);
});

test('a failed change leaves no history entry', async () => {
  const owner = newUser();
  const g = await createGroup(owner);
  const before = (await history(owner, g)).items.length;
  const res = await call(owner, 'DELETE', `/groups/${g.id}/expenses/999999`);
  assert.equal(res.status, 404);
  assert.equal((await history(owner, g)).items.length, before);
});

test('history paginates with before and limit', async () => {
  const owner = newUser();
  const g = await createGroup(owner);
  for (let i = 0; i < 5; i++) await call(owner, 'POST', `/groups/${g.id}/members`, { name: `Гость ${i}` });
  const first = await history(owner, g, '?limit=4');
  assert.equal(first.items.length, 4);
  assert.equal(first.nextBefore, first.items[3].id);
  const second = await history(owner, g, `?limit=4&before=${first.nextBefore}`);
  assert.equal(second.items.length, 2); // 6 entries in total: group.create + 5 members
  assert.equal(second.nextBefore, null);
  assert.ok(second.items[0].id < first.items[3].id);
  assert.equal((await call(owner, 'GET', `/groups/${g.id}/activity?limit=101`)).status, 400);
});

test('history is visible to members only', async () => {
  const owner = newUser();
  const g = await createGroup(owner);
  assert.equal((await call(newUser(), 'GET', `/groups/${g.id}/activity`)).status, 404);
  assert.equal((await call(null, 'GET', `/groups/${g.id}/activity`)).status, 401);
});

// --- Debt reminders ---
async function debtSetup(opts: { notify?: boolean } = {}) {
  const owner = newUser();
  const guest = newUser();
  const g = await createGroup(owner);
  await call(guest, 'POST', `/invite/${g.inviteCode}/join`, {});
  if (opts.notify !== false) await call(guest, 'PUT', '/me', { notify: true });
  const full = (await call(owner, 'GET', `/groups/${g.id}`)).body as Json;
  const guestMember = full.members.filter((m: Json) => m.hasTelegram).at(-1);
  // The owner paid for both: the guest owes the owner.
  const res = await call(owner, 'POST', `/groups/${g.id}/expenses`, expense(full));
  assert.equal(res.status, 201);
  return { owner, guest, g, ownerMember: full.meId as number, guestMember };
}

test('auto-remind: off by default, any member toggles it, history records it, demo and strangers refused', async () => {
  const { owner, guest, g } = await debtSetup();
  assert.equal(((await call(owner, 'GET', `/groups/${g.id}`)).body as Json).autoRemind, false);
  const on = await call(guest, 'PUT', `/groups/${g.id}/auto-remind`, { enabled: true });
  assert.equal(on.status, 200);
  assert.equal(on.body.autoRemind, true);
  // The same value again: no second history entry.
  await call(guest, 'PUT', `/groups/${g.id}/auto-remind`, { enabled: true });
  assert.equal((await call(owner, 'PUT', `/groups/${g.id}/auto-remind`, { enabled: false })).body.autoRemind, false);
  const h = (await call(owner, 'GET', `/groups/${g.id}/activity`)).body as Json;
  const entries = h.items.filter((i: Json) => i.action === 'group.auto_remind');
  assert.deepEqual(
    entries.map((i: Json) => i.payload.enabled),
    [false, true],
  );
  assert.equal((await call(newUser(), 'PUT', `/groups/${g.id}/auto-remind`, { enabled: true })).status, 404);
  assert.equal((await call(owner, 'PUT', `/groups/${g.id}/auto-remind`, { enabled: 'yes' })).status, 400);
  const demo = await call(owner, 'POST', '/demo');
  assert.equal((await call(owner, 'PUT', `/groups/${demo.body.id}/auto-remind`, { enabled: true })).status, 409);
});

test('remind: creditor can remind a debtor, history gets an entry', async () => {
  const { owner, g, guestMember } = await debtSetup();
  const res = await call(owner, 'POST', `/groups/${g.id}/remind`, { memberId: guestMember.id });
  assert.equal(res.status, 200);
  const h = (await call(owner, 'GET', `/groups/${g.id}/activity`)).body as Json;
  assert.equal(h.items[0].action, 'debt.remind');
  assert.equal(h.items[0].payload.amount, 5000);
});

test('remind: a second reminder within 24h gets 429, and works again after', async () => {
  const { owner, g, guestMember } = await debtSetup();
  const url = `/groups/${g.id}/remind`;
  assert.equal((await call(owner, 'POST', url, { memberId: guestMember.id })).status, 200);
  const again = await call(owner, 'POST', url, { memberId: guestMember.id });
  assert.equal(again.status, 429);
  assert.equal(again.body.error, 'Уже напоминали сегодня');
  const en = await api.request(url, {
    method: 'POST',
    headers: { Authorization: `dev ${owner}`, 'Content-Type': 'application/json', 'X-Lang': 'en' },
    body: JSON.stringify({ memberId: guestMember.id }),
  });
  assert.equal(((await en.json()) as Json).error, 'Already reminded today');
  const { run } = await import('./db.ts');
  run("UPDATE reminders SET created_at = datetime('now', '-25 hours') WHERE group_id = ?", g.id);
  assert.equal((await call(owner, 'POST', url, { memberId: guestMember.id })).status, 200);
});

test('remind: only a debtor of the current plan, never the other way round or oneself', async () => {
  const { owner, guest, g, ownerMember, guestMember } = await debtSetup();
  const url = `/groups/${g.id}/remind`;
  assert.equal((await call(guest, 'POST', url, { memberId: ownerMember })).status, 409);
  assert.equal((await call(owner, 'POST', url, { memberId: ownerMember })).status, 409);
  assert.equal((await call(owner, 'POST', url, { memberId: 999999 })).status, 409);
  // Once the debt is repaid there is nothing to remind about.
  const pay = await call(guest, 'POST', `/groups/${g.id}/expenses`, {
    kind: 'transfer',
    amount: 5000,
    payerId: guestMember.id,
    splitMode: 'exact',
    spentOn: '2025-01-16',
    shares: [{ memberId: ownerMember, value: 5000 }],
  });
  assert.equal(pay.status, 201);
  assert.equal((await call(owner, 'POST', url, { memberId: guestMember.id })).status, 409);
});

test('remind: debtor without notifications or without Telegram gets a clear error', async () => {
  const quiet = await debtSetup({ notify: false });
  const res = await call(quiet.owner, 'POST', `/groups/${quiet.g.id}/remind`, { memberId: quiet.guestMember.id });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /уведомления/);
  const full = (await call(quiet.owner, 'GET', `/groups/${quiet.g.id}`)).body as Json;
  assert.equal(full.members.find((m: Json) => m.id === quiet.guestMember.id).canNotify, false);

  const owner = newUser();
  const g = await createGroup(owner, ['Маша']);
  const masha = g.members.find((m: Json) => !m.hasTelegram);
  await call(owner, 'POST', `/groups/${g.id}/expenses`, expense(g));
  assert.equal((await call(owner, 'POST', `/groups/${g.id}/remind`, { memberId: masha.id })).status, 409);
});

test('remind: non-member gets 404, anonymous 401, canNotify follows notify', async () => {
  const { owner, g, guestMember } = await debtSetup();
  assert.equal((await call(newUser(), 'POST', `/groups/${g.id}/remind`, { memberId: guestMember.id })).status, 404);
  assert.equal((await call(null, 'POST', `/groups/${g.id}/remind`, { memberId: guestMember.id })).status, 401);
  const full = (await call(owner, 'GET', `/groups/${g.id}`)).body as Json;
  assert.equal(full.members.find((m: Json) => m.id === guestMember.id).canNotify, true);
});

async function joinGroup(user: number, g: Json, claimMemberId?: number) {
  const res = await call(user, 'POST', `/invite/${g.inviteCode}/join`, { claimMemberId });
  assert.equal(res.status, 200);
}

test('leaving: the member becomes name-only, history is kept, access is gone', async () => {
  const owner = newUser();
  const guest = newUser();
  const g = await createGroup(owner);
  await joinGroup(guest, g);
  const full = (await call(owner, 'GET', `/groups/${g.id}`)).body;
  const guestMember = full.members.filter((m: Json) => m.hasTelegram).at(-1);
  await call(owner, 'POST', `/groups/${g.id}/expenses`, expense(full));
  const before = balances((await call(owner, 'GET', `/groups/${g.id}`)).body);

  assert.equal((await call(guest, 'POST', `/groups/${g.id}/leave`)).status, 200);
  assert.equal((await call(guest, 'GET', `/groups/${g.id}`)).status, 404);
  assert.deepEqual((await call(guest, 'GET', '/groups')).body, []);

  const after = (await call(owner, 'GET', `/groups/${g.id}`)).body;
  const left = after.members.find((m: Json) => m.id === guestMember.id);
  assert.equal(left.hasTelegram, false);
  assert.equal(left.name, guestMember.name);
  assert.equal(after.expenses.length, 1);
  assert.deepEqual(balances(after), before);
  assert.equal(after.isOwner, true);
});

test('leaving: ownership passes to the earliest Telegram member', async () => {
  const owner = newUser();
  const second = newUser();
  const third = newUser();
  const g = await createGroup(owner, ['Без телеги']);
  await joinGroup(second, g);
  await joinGroup(third, g);
  assert.equal((await call(owner, 'POST', `/groups/${g.id}/leave`)).status, 200);
  assert.equal((await call(second, 'GET', `/groups/${g.id}`)).body.isOwner, true);
  assert.equal((await call(third, 'GET', `/groups/${g.id}`)).body.isOwner, false);
  assert.equal((await call(third, 'DELETE', `/groups/${g.id}`)).status, 403);
  assert.equal((await call(second, 'DELETE', `/groups/${g.id}`)).status, 200);
});

test('leaving: the last Telegram member cannot leave', async () => {
  const owner = newUser();
  const g = await createGroup(owner, ['Маша']);
  const res = await call(owner, 'POST', `/groups/${g.id}/leave`);
  assert.equal(res.status, 409);
  assert.equal((await call(owner, 'GET', `/groups/${g.id}`)).status, 200);
  assert.equal((await call(newUser(), 'POST', `/groups/${g.id}/leave`)).status, 404);
});

test('after leaving one can return via the invite and claim the old member', async () => {
  const owner = newUser();
  const guest = newUser();
  const g = await createGroup(owner);
  await joinGroup(guest, g);
  const full = (await call(owner, 'GET', `/groups/${g.id}`)).body;
  const old = full.members.filter((m: Json) => m.hasTelegram).at(-1);
  await call(owner, 'POST', `/groups/${g.id}/expenses`, expense(full, { payerId: old.id }));
  await call(guest, 'POST', `/groups/${g.id}/leave`);

  const preview = (await call(guest, 'GET', `/invite/${g.inviteCode}`)).body;
  assert.equal(preview.isMember, false);
  assert.deepEqual(
    preview.unclaimed.map((m: Json) => m.id),
    [old.id],
  );
  await joinGroup(guest, g, old.id);
  const back = (await call(guest, 'GET', `/groups/${g.id}`)).body;
  assert.equal(back.meId, old.id);
  assert.equal(back.members.length, 2);
  assert.equal(back.expenses.length, 1);
});

test('archive and unarchive: flag in the list and detail, any member, non-members get 404', async () => {
  const owner = newUser();
  const guest = newUser();
  const g = await createGroup(owner);
  await joinGroup(guest, g);
  assert.equal(g.archived, false);

  const res = await call(guest, 'POST', `/groups/${g.id}/archive`);
  assert.equal(res.status, 200);
  assert.equal(res.body.archived, true);
  assert.equal((await call(owner, 'GET', '/groups')).body[0].archived, true);
  assert.equal((await call(newUser(), 'POST', `/groups/${g.id}/archive`)).status, 404);

  const back = await call(owner, 'POST', `/groups/${g.id}/unarchive`);
  assert.equal(back.body.archived, false);
  assert.equal((await call(owner, 'GET', '/groups')).body[0].archived, false);
});

test('a new expense unarchives the group', async () => {
  const owner = newUser();
  const g = await createGroup(owner);
  await call(owner, 'POST', `/groups/${g.id}/archive`);
  const res = await call(owner, 'POST', `/groups/${g.id}/expenses`, expense(g));
  assert.equal(res.status, 201);
  assert.equal(res.body.archived, false);
  assert.equal((await call(owner, 'GET', '/groups')).body[0].archived, false);
});

test('leaving and archiving are written to the group history', async () => {
  const owner = newUser();
  const guest = newUser();
  const g = await createGroup(owner);
  await joinGroup(guest, g);
  await call(owner, 'POST', `/groups/${g.id}/archive`);
  await call(owner, 'POST', `/groups/${g.id}/unarchive`);
  await call(guest, 'POST', `/groups/${g.id}/leave`);
  const res = await call(owner, 'GET', `/groups/${g.id}/activity`);
  const actions = res.body.items.map((i: Json) => i.action);
  assert.deepEqual(actions.slice(0, 3), ['member.leave', 'group.unarchive', 'group.archive']);
  assert.ok(res.body.items[0].actor.name);
});

test('export: a member gets "bot unavailable" when the bot is not configured; outsiders get 404', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const res = await call(u, 'POST', `/groups/${g.id}/export`);
  assert.equal(res.status, 409);
  assert.ok(res.body.error);
  assert.equal((await call(newUser(), 'POST', `/groups/${g.id}/export`)).status, 404);
});

// --- Foreign-currency expenses ---
const foreign = (g: Json, over: Json = {}) => {
  const { amount: _amount, ...rest } = expense(g);
  return { ...rest, originalAmount: 10000, originalCurrency: 'GEL', rate: '34.5', ...over };
};

test('foreign expense: amount is computed on the server, balances follow the group currency', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша']);
  // the client "amount" is ignored when original_* is present
  const res = await call(u, 'POST', `/groups/${g.id}/expenses`, foreign(g, { amount: 1 }));
  assert.equal(res.status, 201);
  const e = res.body.expenses[0];
  assert.equal(e.amount, 345000);
  assert.equal(e.originalAmount, 10000);
  assert.equal(e.originalCurrency, 'GEL');
  assert.equal(e.rate, '34.5');
  assert.deepEqual(
    e.shares.map((s: Json) => s.amount),
    [172500, 172500],
  );
  assert.deepEqual(balances(res.body), [172500, -172500]);
  assert.equal(res.body.totalSpent, 345000);
});

test('foreign expense: comma rate is normalised; plain expense has null original fields', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const r1 = await call(u, 'POST', `/groups/${g.id}/expenses`, foreign(g, { rate: '34,50' }));
  assert.equal(r1.body.expenses[0].rate, '34.5');
  const r2 = await call(u, 'POST', `/groups/${g.id}/expenses`, expense(g));
  const plain = r2.body.expenses.find((e: Json) => e.originalAmount === null);
  assert.ok(plain);
  assert.equal(plain.originalCurrency, null);
  assert.equal(plain.rate, null);
});

test('foreign expense: validation errors', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const post = (over: Json) => call(u, 'POST', `/groups/${g.id}/expenses`, foreign(g, over));
  assert.equal((await post({ originalCurrency: 'RUB' })).status, 400); // same as group
  assert.equal((await post({ originalCurrency: 'XXX' })).status, 400);
  assert.equal((await post({ rate: '0' })).status, 400);
  assert.equal((await post({ rate: '-3' })).status, 400);
  assert.equal((await post({ rate: 'abc' })).status, 400);
  assert.equal((await post({ rate: '99999999999' })).status, 400);
  assert.equal((await post({ originalAmount: 0 })).status, 400);
  assert.equal((await post({ rate: undefined })).status, 400); // partial triple
  assert.equal((await post({ originalAmount: 1, rate: '0.001' })).status, 400); // rounds to zero
  assert.equal((await call(u, 'GET', `/groups/${g.id}`)).body.expenses.length, 0);
  const en = await api.request(`/groups/${g.id}/expenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `dev ${u}`, 'X-Lang': 'en' },
    body: JSON.stringify(foreign(g, { originalCurrency: 'RUB' })),
  });
  assert.match(((await en.json()) as Json).error, /differ/);
});

test('foreign expense: transfers cannot be foreign', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша']);
  const res = await call(u, 'POST', `/groups/${g.id}/expenses`, {
    ...foreign(g),
    kind: 'transfer',
    shares: [{ memberId: g.members[1].id, value: 1 }],
  });
  assert.equal(res.status, 400);
});

test('foreign expense: exact shares are entered in the original currency and add up exactly', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша', 'Петя']);
  const [a, b, c] = g.members.map((m: Json) => m.id);
  const body = foreign(g, {
    splitMode: 'exact',
    originalAmount: 10000,
    rate: '34.567',
    shares: [
      { memberId: a, value: 3333 },
      { memberId: b, value: 3333 },
      { memberId: c, value: 3334 },
    ],
  });
  const res = await call(u, 'POST', `/groups/${g.id}/expenses`, body);
  assert.equal(res.status, 201);
  const e = res.body.expenses[0];
  assert.equal(e.amount, 345670);
  assert.equal(
    e.shares.reduce((x: number, s: Json) => x + s.amount, 0),
    345670,
  );
  assert.deepEqual(e.shares.map((s: Json) => s.input).sort(), [3333, 3333, 3334]); // kept for editing
  const bad = await call(u, 'POST', `/groups/${g.id}/expenses`, {
    ...body,
    shares: [{ memberId: a, value: 3333 }],
  });
  assert.equal(bad.status, 400); // does not add up to 100.00 GEL
});

test('foreign expense: PUT can change the rate, switch to the group currency and back', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const created = await call(u, 'POST', `/groups/${g.id}/expenses`, foreign(g));
  const id = created.body.expenses[0].id;
  const r1 = await call(u, 'PUT', `/groups/${g.id}/expenses/${id}`, foreign(g, { rate: '30' }));
  assert.equal(r1.status, 200);
  assert.equal(r1.body.expenses[0].amount, 300000);
  const r2 = await call(u, 'PUT', `/groups/${g.id}/expenses/${id}`, expense(g));
  assert.equal(r2.body.expenses[0].amount, 10000);
  assert.equal(r2.body.expenses[0].originalAmount, null);
  assert.equal(r2.body.expenses[0].rate, null);
  const r3 = await call(
    u,
    'PUT',
    `/groups/${g.id}/expenses/${id}`,
    foreign(g, { originalCurrency: 'USD', rate: '90' }),
  );
  assert.equal(r3.body.expenses[0].originalCurrency, 'USD');
  assert.equal(r3.body.expenses[0].amount, 900000);
});

// --- Chat links ---

let nextChat = -1001000;
const newChat = () => nextChat--;
const entries = async (user: number, g: Json) => (await history(user, g)).items;

test('attach: only chat creator/administrator may link; others get 403', async () => {
  const u = newUser();
  const g = await createGroup(u);
  for (const status of ['member', 'restricted', 'left']) {
    botModule.setBotTestHooks({ chatMember: async () => status });
    const token = chatLink.createChatLink(newChat(), 'Чат', u);
    const res = await call(u, 'POST', `/chat-links/${token}/attach`, { groupId: g.id });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'Привязать чат может только администратор чата');
    assert.equal(chatLink.checkChatLink(token).problem, undefined);
  }
  botModule.setBotTestHooks({ chatMember: async () => 'creator' });
  const token = chatLink.createChatLink(newChat(), 'Чат', u);
  assert.equal((await call(u, 'POST', `/chat-links/${token}/attach`, { groupId: g.id })).status, 200);
  botModule.setBotTestHooks({ chatMember: async () => 'administrator' });
});

test('attach: bot unavailable gives 503', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const token = chatLink.createChatLink(newChat(), 'Чат', u);
  botModule.setBotTestHooks(); // no hook, no bot token: bot is not ready
  assert.equal((await call(u, 'POST', `/chat-links/${token}/attach`, { groupId: g.id })).status, 503);
  botModule.setBotTestHooks({
    chatMember: async () => {
      throw new Error('chat not found');
    },
  });
  assert.equal((await call(u, 'POST', `/chat-links/${token}/attach`, { groupId: g.id })).status, 503);
  botModule.setBotTestHooks({ chatMember: async () => 'administrator' });
  assert.equal((await call(u, 'POST', `/chat-links/${token}/attach`, { groupId: g.id })).status, 200);
});

test('createChatLink reuses the valid unused token of the chat', () => {
  const u = newUser();
  const chatId = newChat();
  const a = chatLink.createChatLink(chatId, 'Чат', u);
  assert.equal(chatLink.createChatLink(chatId, 'Чат', u), a);
  assert.notEqual(chatLink.createChatLink(newChat(), 'Другой', u), a);
  // An expired token is not reused.
  const old = chatLink.createChatLink(newChat(), 'Старый', u, new Date(Date.now() - 25 * 3600_000));
  assert.notEqual(chatLink.createChatLink(chatLinkChatOf(old), 'Старый', u), old);
});

function chatLinkChatOf(token: string): number {
  return chatLink.checkChatLink(token, new Date(Date.now() - 25 * 3600_000)).link!.chat_id;
}

test('cleanupChatLinks removes only used/expired tokens older than 7 days', () => {
  const u = newUser();
  const day = 24 * 3600_000;
  const row = (token: string) => db.one('SELECT token FROM chat_links WHERE token = ?', token);
  const oldExpired = chatLink.createChatLink(newChat(), 'a', u, new Date(Date.now() - 9 * day));
  const recentExpired = chatLink.createChatLink(newChat(), 'b', u, new Date(Date.now() - 3 * day));
  const fresh = chatLink.createChatLink(newChat(), 'c', u);
  const oldUsed = chatLink.createChatLink(newChat(), 'd', u, new Date(Date.now() - 20 * day));
  db.run("UPDATE chat_links SET used_at = datetime('now', '-10 days') WHERE token = ?", oldUsed);
  const recentUsed = chatLink.createChatLink(newChat(), 'e', u);
  db.run("UPDATE chat_links SET used_at = datetime('now', '-1 days') WHERE token = ?", recentUsed);
  chatLink.cleanupChatLinks();
  assert.equal(row(oldExpired), undefined);
  assert.equal(row(oldUsed), undefined);
  assert.ok(row(recentExpired));
  assert.ok(row(fresh));
  assert.ok(row(recentUsed));
  assert.equal(chatLink.cleanupChatLinks(), 0);
});

test('chat link token: 24 URL-safe characters', () => {
  assert.match(chatLink.newChatToken(), /^[A-Za-z0-9_-]{24}$/);
});

test('chat link preview shows the chat title; garbage token is 404', async () => {
  const u = newUser();
  const token = chatLink.createChatLink(newChat(), 'Друзья', u);
  const res = await call(u, 'GET', `/chat-links/${token}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { chatTitle: 'Друзья', replaces: null });
  assert.equal((await call(u, 'GET', '/chat-links/nope')).status, 404);
  assert.equal((await call(null, 'GET', `/chat-links/${token}`)).status, 401);
});

test('attaching a chat: group gets the chat (title only in the API), activity entry, token becomes used', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const chatId = newChat();
  const token = chatLink.createChatLink(chatId, 'Друзья', u);
  const res = await call(u, 'POST', `/chat-links/${token}/attach`, { groupId: g.id });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.chat, { title: 'Друзья', feed: 'each' });
  assert.equal(JSON.stringify(res.body).includes(String(chatId)), false);
  assert.equal((await call(u, 'GET', `/groups/${g.id}`)).body.chat.title, 'Друзья');
  const h = await entries(u, g);
  assert.equal(h[0].action, 'group.chat_link');
  assert.equal(h[0].payload.name, 'Друзья');
  // the token works once
  const again = await call(u, 'POST', `/chat-links/${token}/attach`, { groupId: g.id });
  assert.equal(again.status, 409);
  assert.equal((await call(u, 'GET', `/chat-links/${token}`)).status, 409);
});

test('expired token is rejected', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const token = chatLink.createChatLink(newChat(), 'Старый', u, new Date(Date.now() - 25 * 3600_000));
  assert.equal((await call(u, 'GET', `/chat-links/${token}`)).status, 404);
  assert.equal((await call(u, 'POST', `/chat-links/${token}/attach`, { groupId: g.id })).status, 404);
  assert.equal((await call(u, 'GET', `/groups/${g.id}`)).body.chat, null);
});

test('cannot attach a chat to a group you are not in', async () => {
  const owner = newUser();
  const stranger = newUser();
  const g = await createGroup(owner);
  const token = chatLink.createChatLink(newChat(), 'Чат', stranger);
  assert.equal((await call(stranger, 'POST', `/chat-links/${token}/attach`, { groupId: g.id })).status, 404);
  assert.equal((await call(owner, 'GET', `/groups/${g.id}`)).body.chat, null);
  // the failed attempt did not burn the token
  const mine = await createGroup(stranger);
  assert.equal((await call(stranger, 'POST', `/chat-links/${token}/attach`, { groupId: mine.id })).status, 200);
});

test('relinking a chat to another group takes it away from the first', async () => {
  const u = newUser();
  const a = await createGroup(u);
  const b = await createGroup(u);
  const chatId = newChat();
  await call(u, 'POST', `/chat-links/${chatLink.createChatLink(chatId, 'Чат', u)}/attach`, { groupId: a.id });
  const second = chatLink.createChatLink(chatId, 'Чат', u);
  const preview = await call(u, 'GET', `/chat-links/${second}`);
  assert.deepEqual(preview.body.replaces, { name: 'Поездка' });
  assert.equal((await call(u, 'POST', `/chat-links/${second}/attach`, { groupId: b.id })).status, 200);
  assert.equal((await call(u, 'GET', `/groups/${a.id}`)).body.chat, null);
  assert.equal((await call(u, 'GET', `/groups/${b.id}`)).body.chat.title, 'Чат');
  assert.equal((await entries(u, a))[0].action, 'group.chat_unlink');
});

test('relinking a group to another chat replaces the old chat', async () => {
  const u = newUser();
  const g = await createGroup(u);
  await call(u, 'POST', `/chat-links/${chatLink.createChatLink(newChat(), 'Первый', u)}/attach`, { groupId: g.id });
  const t2 = chatLink.createChatLink(newChat(), 'Второй', u);
  const res = await call(u, 'POST', `/chat-links/${t2}/attach`, { groupId: g.id });
  assert.equal(res.body.chat.title, 'Второй');
});

test('any member can unlink; non-member gets 404; activity is logged', async () => {
  const owner = newUser();
  const friend = newUser();
  const g = await createGroup(owner);
  await call(friend, 'POST', `/invite/${g.inviteCode}/join`, {});
  await call(owner, 'POST', `/chat-links/${chatLink.createChatLink(newChat(), 'Друзья', owner)}/attach`, {
    groupId: g.id,
  });
  assert.equal((await call(newUser(), 'POST', `/groups/${g.id}/chat/unlink`)).status, 404);
  const res = await call(friend, 'POST', `/groups/${g.id}/chat/unlink`);
  assert.equal(res.status, 200);
  assert.equal(res.body.chat, null);
  const h = await entries(owner, g);
  assert.equal(h[0].action, 'group.chat_unlink');
  assert.equal(h[0].payload.name, 'Друзья');
  // unlinking again is harmless and writes nothing
  assert.equal((await call(friend, 'POST', `/groups/${g.id}/chat/unlink`)).status, 200);
  assert.equal((await entries(owner, g)).length, h.length);
});

test('bot removed from the chat / chat migrated to a supergroup', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const chatId = newChat();
  await call(u, 'POST', `/chat-links/${chatLink.createChatLink(chatId, 'Друзья', u)}/attach`, { groupId: g.id });
  const superId = -1002000000 - chatId;
  chatLink.migrateChat(chatId, superId);
  assert.equal(chatLink.groupOfChat(superId)?.id, g.id);
  assert.equal(chatLink.groupOfChat(chatId), undefined);
  assert.equal(chatLink.unlinkChat(superId, u)?.id, g.id);
  assert.equal((await call(u, 'GET', `/groups/${g.id}`)).body.chat, null);
  assert.equal(chatLink.unlinkChat(superId, u), undefined);
});

test('chat feed setting: members only, needs a linked chat, rejects garbage, reset to "each" on relink', async () => {
  const u = newUser();
  const g = await createGroup(u);
  assert.equal((await call(u, 'PUT', `/groups/${g.id}/chat/feed`, { feed: 'off' })).status, 409);
  await call(u, 'POST', `/chat-links/${chatLink.createChatLink(newChat(), 'Друзья', u)}/attach`, { groupId: g.id });
  assert.equal((await call(newUser(), 'PUT', `/groups/${g.id}/chat/feed`, { feed: 'off' })).status, 404);
  assert.equal((await call(null, 'PUT', `/groups/${g.id}/chat/feed`, { feed: 'off' })).status, 401);
  assert.equal((await call(u, 'PUT', `/groups/${g.id}/chat/feed`, { feed: 'hourly' })).status, 400);
  assert.equal((await call(u, 'PUT', `/groups/${g.id}/chat/feed`, {})).status, 400);
  const res = await call(u, 'PUT', `/groups/${g.id}/chat/feed`, { feed: 'daily' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.chat, { title: 'Друзья', feed: 'daily' });
  assert.equal((await call(u, 'GET', `/groups/${g.id}`)).body.chat.feed, 'daily');
  const feedLog = async () =>
    ((await call(u, 'GET', `/groups/${g.id}/activity`)).body.items as { action: string; payload: unknown }[]).filter(
      (h) => h.action === 'group.chat_feed',
    );
  // one entry for the change; the same value again writes nothing
  assert.deepEqual(
    (await feedLog()).map((h) => h.payload),
    [{ to: 'daily' }],
  );
  assert.equal((await call(u, 'PUT', `/groups/${g.id}/chat/feed`, { feed: 'daily' })).status, 200);
  assert.equal((await feedLog()).length, 1);
  await call(u, 'POST', `/chat-links/${chatLink.createChatLink(newChat(), 'Другой', u)}/attach`, { groupId: g.id });
  assert.equal((await call(u, 'GET', `/groups/${g.id}`)).body.chat.feed, 'each');
});

test('data minimization: no Telegram or chat ids in any response, members carry hasTelegram instead of userId', async () => {
  const owner = 4242001;
  const friend = 4242002;
  const g = await createGroup(owner, ['Маша']);
  await call(friend, 'POST', `/invite/${g.inviteCode}/join`, {});
  const chatId = -1004242003;
  const token = chatLink.createChatLink(chatId, 'Друзья', owner);

  const responses: [string, Json][] = [];
  const grab = async (who: number, method: string, path: string, body?: unknown) => {
    const res = await call(who, method, path, body);
    assert.ok(res.status < 300, `${method} ${path} -> ${res.status}`);
    responses.push([`${method} ${path}`, res.body]);
    return res.body;
  };
  const full = await grab(friend, 'GET', `/groups/${g.id}`);
  await grab(friend, 'GET', '/me');
  await grab(friend, 'GET', '/groups');
  await grab(friend, 'GET', `/invite/${g.inviteCode}`);
  await grab(owner, 'GET', `/chat-links/${token}`);
  await grab(owner, 'POST', `/chat-links/${token}/attach`, { groupId: g.id });
  await grab(owner, 'POST', `/groups/${g.id}/expenses`, expense(full, { payerId: full.members[0].id }));
  await grab(friend, 'GET', `/groups/${g.id}`);
  await grab(friend, 'GET', `/groups/${g.id}/activity`);

  for (const m of full.members) {
    assert.equal('userId' in m, false);
    assert.equal(typeof m.hasTelegram, 'boolean');
  }
  assert.deepEqual(
    full.members.map((m: Json) => m.hasTelegram),
    [true, false, true],
  );
  const devNames = full.members.filter((m: Json) => m.hasTelegram).map((m: Json) => m.name as string);
  for (const [label, body] of responses) {
    // DEV_AUTH display names embed the id ("User 4242001"); real Telegram names don't, so ignore them.
    let text = JSON.stringify(body);
    for (const name of devNames) text = text.replaceAll(name, '');
    for (const id of [owner, friend, chatId, Math.abs(chatId)]) {
      assert.ok(!new RegExp(`(?<!\\d)${id}(?!\\d)`).test(text), `${label} leaks ${id}`);
    }
    assert.ok(!/"userId"|"user_id"|"chatId"|"chat_id"/.test(text), `${label} has an id field`);
  }
});

// --- share to any chat (savePreparedInlineMessage) ---

test('share: members get a prepared id; payload is the balance / summary card', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша']);
  assert.equal((await call(u, 'POST', `/groups/${g.id}/expenses`, expense(g))).status, 201);
  const calls: { userId: number; result: Json; targets: Json }[] = [];
  botModule.setBotTestHooks({
    prepareShare: async (userId, result, targets) => {
      calls.push({ userId, result, targets });
      return `prep-${calls.length}`;
    },
  });
  try {
    const bal = await call(u, 'POST', `/groups/${g.id}/share`, { kind: 'balance' });
    assert.equal(bal.status, 200);
    assert.deepEqual(bal.body, { id: 'prep-1' });
    const sum = await call(u, 'POST', `/groups/${g.id}/share`, { kind: 'summary' });
    assert.deepEqual(sum.body, { id: 'prep-2' });

    assert.equal(calls[0].userId, u);
    assert.deepEqual(calls[0].targets, {
      allow_user_chats: true,
      allow_bot_chats: false,
      allow_group_chats: true,
      allow_channel_chats: false,
    });
    const content = calls[0].result.input_message_content;
    assert.equal(calls[0].result.type, 'article');
    assert.equal(content.parse_mode, 'HTML');
    assert.match(content.message_text, /Поездка/);
    assert.match(content.message_text, /Маша/);
    assert.equal(calls[1].result.input_message_content.parse_mode, undefined);
    assert.match(calls[1].result.input_message_content.message_text, /Итоги «Поездка»/);
  } finally {
    botModule.setBotTestHooks({ chatMember: async () => 'administrator' });
  }
});

test('share: non-member 404, demo group 409, bad kind 400, bot unavailable 503, Bot API error 503', async () => {
  const u = newUser();
  const g = await createGroup(u);
  botModule.setBotTestHooks({ prepareShare: async () => 'x' });
  try {
    assert.equal((await call(newUser(), 'POST', `/groups/${g.id}/share`, { kind: 'balance' })).status, 404);
    const demo = await call(u, 'POST', '/demo');
    assert.equal((await call(u, 'POST', `/groups/${demo.body.id}/share`, { kind: 'balance' })).status, 409);
    assert.equal((await call(u, 'POST', `/groups/${g.id}/share`, { kind: 'nope' })).status, 400);
    botModule.setBotTestHooks({
      prepareShare: async () => {
        throw new Error('boom');
      },
    });
    assert.equal((await call(u, 'POST', `/groups/${g.id}/share`, { kind: 'balance' })).status, 503);
    botModule.setBotTestHooks(); // no hook, no bot token
    const res = await call(u, 'POST', `/groups/${g.id}/share`, { kind: 'balance' });
    assert.equal(res.status, 503);
    assert.match(res.body.error, /Бот/);
  } finally {
    botModule.setBotTestHooks({ chatMember: async () => 'administrator' });
  }
});

test('a body that is not valid JSON is a 400 in the request language and sends no server alert', async () => {
  const alerts = await import('./alerts.ts');
  const reported: unknown[] = [];
  const original = alerts.alerter.report;
  alerts.alerter.report = async (ev) => {
    reported.push(ev);
  };
  try {
    const u = newUser();
    const put = async (lang?: string) => {
      const headers: Record<string, string> = { Authorization: `dev ${u}`, 'Content-Type': 'application/json' };
      if (lang) headers['X-Lang'] = lang;
      const res = await api.request('/me', { method: 'PUT', headers, body: '{oops' });
      return { status: res.status, body: (await res.json()) as Json };
    };
    const ru = await put();
    assert.equal(ru.status, 400);
    assert.equal(ru.body.error, 'Некорректные данные');
    const en = await put('en');
    assert.equal(en.status, 400);
    assert.equal(en.body.error, 'Invalid data');
    assert.deepEqual(reported, []);
  } finally {
    alerts.alerter.report = original;
  }
});

test('a body over the size limit is a 413 with a translated message', async () => {
  const u = newUser();
  const big = JSON.stringify({ name: 'x'.repeat(256 * 1024 + 1) });
  const post = async (headers: Record<string, string>) => {
    const res = await api.request('/groups', {
      method: 'POST',
      headers: { Authorization: `dev ${u}`, 'Content-Type': 'application/json', ...headers },
      body: big,
    });
    return { status: res.status, body: (await res.json()) as Json };
  };
  const ru = await post({});
  assert.equal(ru.status, 413);
  assert.equal(ru.body.error, 'Слишком большой запрос');
  const en = await post({ 'X-Lang': 'en' });
  assert.equal(en.status, 413);
  assert.equal(en.body.error, 'The request is too large');
  const small = await api.request('/client-errors', {
    method: 'POST',
    headers: { Authorization: `dev ${u}`, 'Content-Type': 'application/json', 'X-Lang': 'en' },
    body: JSON.stringify({ message: 'x'.repeat(9 * 1024) }),
  });
  assert.equal(small.status, 413);
  assert.equal(((await small.json()) as Json).error, 'The request is too large');
});

const shiftDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDate(d);
};

test('expense date: only real dates from 2000-01-01 up to tomorrow', async () => {
  const u = newUser();
  const g = await createGroup(u, ['Маша']);
  const post = (spentOn: string) => call(u, 'POST', `/groups/${g.id}/expenses`, expense(g, { spentOn }));
  for (const bad of ['2026-02-29', '2026-13-01', '2026-04-31', '1999-12-31', shiftDays(2)]) {
    assert.equal((await post(bad)).status, 400, bad);
  }
  for (const ok of ['2024-02-29', localDate(), shiftDays(1)]) {
    assert.equal((await post(ok)).status, 201, ok);
  }
});

test('template start date and /rates date must be real dates', async () => {
  const u = newUser();
  const g = await createGroup(u);
  const tpl = {
    title: 'Аренда',
    amount: 30000,
    payerId: g.meId,
    splitMode: 'equal',
    shares: g.members.map((m: Json) => ({ memberId: m.id, value: 1 })),
    period: 'monthly',
    day: 5,
    startDate: '2026-02-30',
  };
  assert.equal((await call(u, 'POST', `/groups/${g.id}/recurring`, tpl)).status, 400);
  assert.equal((await call(u, 'GET', '/rates?base=RUB&currency=USD&date=2026-02-30')).status, 400);
});
