import assert from 'node:assert/strict';
import { before, test } from 'node:test';

// config.ts and db.ts read env at import time, so set it before the dynamic import.
process.env.DB_PATH = ':memory:';
process.env.DEV_AUTH = '1';
delete process.env.BOT_TOKEN;

let api: typeof import('./api.ts').api;
let rateLimiter: typeof import('./api.ts').rateLimiter;
before(async () => {
  ({ api, rateLimiter } = await import('./api.ts'));
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
  assert.equal(mine.userId, u);
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
  assert.equal(en.body.error, "The amounts don't add up to the total");
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
  const ownerMember = seen.members.find((m: Json) => m.userId === owner);
  assert.deepEqual(ownerMember.paymentInfo, { phone: '+79001234567', bank: 'Т-Банк' });
  const friendMember = seen.members.find((m: Json) => m.userId === friend);
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
  const guestMember = full.members.find((m: Json) => m.userId === guest);
  // The owner paid for both: the guest owes the owner.
  const res = await call(owner, 'POST', `/groups/${g.id}/expenses`, expense(full));
  assert.equal(res.status, 201);
  return { owner, guest, g, ownerMember: full.meId as number, guestMember };
}

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
  const masha = g.members.find((m: Json) => m.userId === null);
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
  const guestMember = full.members.find((m: Json) => m.userId === guest);
  await call(owner, 'POST', `/groups/${g.id}/expenses`, expense(full));
  const before = balances((await call(owner, 'GET', `/groups/${g.id}`)).body);

  assert.equal((await call(guest, 'POST', `/groups/${g.id}/leave`)).status, 200);
  assert.equal((await call(guest, 'GET', `/groups/${g.id}`)).status, 404);
  assert.deepEqual((await call(guest, 'GET', '/groups')).body, []);

  const after = (await call(owner, 'GET', `/groups/${g.id}`)).body;
  const left = after.members.find((m: Json) => m.id === guestMember.id);
  assert.equal(left.userId, null);
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
  const old = full.members.find((m: Json) => m.userId === guest);
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
