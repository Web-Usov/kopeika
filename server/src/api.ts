import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { CURRENCIES, computeShares, SplitError } from '../../shared/money.ts';
import { type TelegramUser, validateInitData } from './auth.ts';
import { appLink, notifyExpense } from './bot.ts';
import { config } from './config.ts';
import { all, one, run, tx } from './db.ts';
import { createRateLimiter } from './rateLimit.ts';
import {
  displayName,
  type ExpenseRow,
  findMembership,
  type GroupRow,
  groupDetail,
  groupsForUser,
  type MemberRow,
  newInviteCode,
  type UserRow,
  upsertUser,
} from './repo.ts';

type Env = { Variables: { user: TelegramUser } };

export const api = new Hono<Env>();

const fail = (status: 400 | 401 | 403 | 404 | 409 | 429, message: string) => new HTTPException(status, { message });

api.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  if (err instanceof SplitError) return c.json({ error: err.message }, 400);
  if (err instanceof z.ZodError) return c.json({ error: 'Некорректные данные', issues: err.issues }, 400);
  console.error(err);
  return c.json({ error: 'Внутренняя ошибка сервера' }, 500);
});

// --- Auth: every /api request carries "Authorization: tma <initData>" ---
api.use('*', async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const [scheme, value = ''] = header.split(' ', 2) as [string, string?];
  let user: TelegramUser | undefined;
  if (scheme === 'tma') {
    user = validateInitData(value, config.botToken, config.initDataMaxAgeSec)?.user;
  } else if (scheme === 'dev' && config.devAuth) {
    const id = Number(value);
    if (Number.isInteger(id) && id > 0) user = { id, first_name: `Тестер ${id}` };
  }
  if (!user) throw fail(401, 'Откройте приложение из Telegram');
  upsertUser(user);
  c.set('user', user);
  await next();
});

// --- Rate limit: per Telegram user, sliding one-minute window ---
export const rateLimiter = createRateLimiter({ limit: config.rateLimitPerMin });
api.use('*', async (c, next) => {
  if (!rateLimiter.allow(c.get('user').id)) throw fail(429, 'Слишком много запросов, попробуйте через минуту');
  await next();
});

const idParam = (v: string | undefined) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw fail(404, 'Не найдено');
  return n;
};

function loadGroupFor(groupIdRaw: string | undefined, userId: number) {
  const groupId = idParam(groupIdRaw);
  const group = one<GroupRow>('SELECT * FROM groups WHERE id = ?', groupId);
  const me = group && findMembership(groupId, userId);
  if (!group || !me) throw fail(404, 'Группа не найдена');
  return { group, me };
}

const detail = (group: GroupRow, me: MemberRow) => groupDetail(group, me, appLink(group.invite_code));

const name = z.string().trim().min(1).max(64);

// --- Me ---
api.get('/me', (c) => {
  const u = one<UserRow>('SELECT * FROM users WHERE id = ?', c.get('user').id)!;
  return c.json({ id: u.id, name: displayName(u), notify: u.notify === 1 });
});

api.put('/me', async (c) => {
  const body = z.object({ notify: z.boolean() }).parse(await c.req.json());
  run('UPDATE users SET notify = ? WHERE id = ?', body.notify ? 1 : 0, c.get('user').id);
  return c.json({ ok: true });
});

// --- Groups ---
api.get('/groups', (c) => c.json(groupsForUser(c.get('user').id)));

api.post('/groups', async (c) => {
  const user = c.get('user');
  const body = z
    .object({
      name,
      currency: z.enum(CURRENCIES as [string, ...string[]]),
      memberNames: z.array(name).max(50).default([]),
    })
    .parse(await c.req.json());
  const groupId = tx(() => {
    const g = run(
      'INSERT INTO groups (name, currency, invite_code, created_by) VALUES (?, ?, ?, ?)',
      body.name,
      body.currency,
      newInviteCode(),
      user.id,
    );
    const id = Number(g.lastInsertRowid);
    run('INSERT INTO members (group_id, user_id, name) VALUES (?, ?, ?)', id, user.id, displayName(user));
    for (const n of body.memberNames) run('INSERT INTO members (group_id, name) VALUES (?, ?)', id, n);
    return id;
  });
  const { group, me } = loadGroupFor(String(groupId), user.id);
  return c.json(detail(group, me), 201);
});

api.get('/groups/:id', (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  return c.json(detail(group, me));
});

api.patch('/groups/:id', async (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const body = z.object({ name }).parse(await c.req.json());
  run('UPDATE groups SET name = ? WHERE id = ?', body.name, group.id);
  return c.json(detail({ ...group, name: body.name }, me));
});

api.delete('/groups/:id', (c) => {
  const user = c.get('user');
  const { group } = loadGroupFor(c.req.param('id'), user.id);
  if (group.created_by !== user.id) throw fail(403, 'Удалить группу может только её создатель');
  tx(() => {
    run('DELETE FROM expense_shares WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = ?)', group.id);
    run('DELETE FROM expenses WHERE group_id = ?', group.id);
    run('DELETE FROM members WHERE group_id = ?', group.id);
    run('DELETE FROM groups WHERE id = ?', group.id);
  });
  return c.json({ ok: true });
});

// --- Members ---
api.post('/groups/:id/members', async (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const body = z.object({ name }).parse(await c.req.json());
  run('INSERT INTO members (group_id, name) VALUES (?, ?)', group.id, body.name);
  return c.json(detail(group, me), 201);
});

api.patch('/groups/:id/members/:memberId', async (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const body = z.object({ name }).parse(await c.req.json());
  const res = run(
    'UPDATE members SET name = ? WHERE id = ? AND group_id = ?',
    body.name,
    idParam(c.req.param('memberId')),
    group.id,
  );
  if (res.changes === 0) throw fail(404, 'Участник не найден');
  return c.json(detail(group, me));
});

api.delete('/groups/:id/members/:memberId', (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const memberId = idParam(c.req.param('memberId'));
  const member = one<MemberRow>('SELECT * FROM members WHERE id = ? AND group_id = ?', memberId, group.id);
  if (!member) throw fail(404, 'Участник не найден');
  if (member.user_id !== null) throw fail(409, 'Нельзя удалить участника, который вошёл через Telegram');
  const used = one(
    'SELECT 1 FROM expenses WHERE payer_id = ? UNION SELECT 1 FROM expense_shares WHERE member_id = ? LIMIT 1',
    memberId,
    memberId,
  );
  if (used) throw fail(409, 'У участника есть траты: сначала удалите или измените их');
  run('DELETE FROM members WHERE id = ?', memberId);
  return c.json(detail(group, me));
});

// --- Invites ---
api.get('/invite/:code', (c) => {
  const group = one<GroupRow>('SELECT * FROM groups WHERE invite_code = ?', c.req.param('code'));
  if (!group) throw fail(404, 'Приглашение недействительно');
  const me = findMembership(group.id, c.get('user').id);
  const members = all<MemberRow>('SELECT * FROM members WHERE group_id = ? ORDER BY id', group.id);
  return c.json({
    group: { id: group.id, name: group.name, currency: group.currency, membersCount: members.length },
    isMember: Boolean(me),
    unclaimed: members.filter((m) => m.user_id === null).map((m) => ({ id: m.id, name: m.name })),
  });
});

api.post('/invite/:code/join', async (c) => {
  const user = c.get('user');
  const body = z.object({ claimMemberId: z.number().int().positive().optional() }).parse(await c.req.json());
  const group = one<GroupRow>('SELECT * FROM groups WHERE invite_code = ?', c.req.param('code'));
  if (!group) throw fail(404, 'Приглашение недействительно');
  if (!findMembership(group.id, user.id)) {
    if (body.claimMemberId) {
      // "I am this person": link a name-only member to the Telegram account, keeping their history.
      const res = run(
        'UPDATE members SET user_id = ? WHERE id = ? AND group_id = ? AND user_id IS NULL',
        user.id,
        body.claimMemberId,
        group.id,
      );
      if (res.changes === 0) throw fail(409, 'Этого участника уже заняли');
    } else {
      run('INSERT INTO members (group_id, user_id, name) VALUES (?, ?, ?)', group.id, user.id, displayName(user));
    }
  }
  return c.json({ groupId: group.id });
});

// --- Expenses ---
const expenseBody = z.object({
  kind: z.enum(['expense', 'transfer']).default('expense'),
  title: z.string().trim().max(100).default(''),
  amount: z.number().int().positive().max(1e12),
  payerId: z.number().int().positive(),
  splitMode: z.enum(['equal', 'shares', 'exact']),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shares: z
    .array(z.object({ memberId: z.number().int().positive(), value: z.number().int().min(0) }))
    .min(1)
    .max(100),
});
type ExpenseBody = z.infer<typeof expenseBody>;

function validateExpense(groupId: number, body: ExpenseBody) {
  const memberIds = new Set(all<{ id: number }>('SELECT id FROM members WHERE group_id = ?', groupId).map((m) => m.id));
  if (!memberIds.has(body.payerId) || body.shares.some((s) => !memberIds.has(s.memberId))) {
    throw fail(400, 'Участник не из этой группы');
  }
  if (body.kind === 'transfer') {
    if (body.shares.length !== 1 || body.shares[0].memberId === body.payerId) throw fail(400, 'Некорректный перевод');
    body.splitMode = 'exact';
    body.shares[0].value = body.amount;
    body.title ||= 'Перевод';
  } else if (!body.title) {
    throw fail(400, 'Введите название траты');
  }
  return computeShares(body.amount, body.splitMode, body.shares);
}

function saveShares(expenseId: number, body: ExpenseBody, computed: Map<number, number>) {
  run('DELETE FROM expense_shares WHERE expense_id = ?', expenseId);
  for (const s of body.shares) {
    run(
      'INSERT INTO expense_shares (expense_id, member_id, input, amount) VALUES (?, ?, ?, ?)',
      expenseId,
      s.memberId,
      body.splitMode === 'equal' ? 1 : s.value,
      computed.get(s.memberId)!,
    );
  }
}

api.post('/groups/:id/expenses', async (c) => {
  const user = c.get('user');
  const { group, me } = loadGroupFor(c.req.param('id'), user.id);
  const body = expenseBody.parse(await c.req.json());
  const computed = validateExpense(group.id, body);
  const expense = tx(() => {
    const res = run(
      `INSERT INTO expenses (group_id, kind, title, amount, payer_id, split_mode, spent_on, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      group.id,
      body.kind,
      body.title,
      body.amount,
      body.payerId,
      body.splitMode,
      body.spentOn,
      user.id,
    );
    const id = Number(res.lastInsertRowid);
    saveShares(id, body, computed);
    return one<ExpenseRow>('SELECT * FROM expenses WHERE id = ?', id)!;
  });
  notifyExpense(group, expense, user.id, me.name);
  return c.json(detail(group, me), 201);
});

api.put('/groups/:id/expenses/:expenseId', async (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const expenseId = idParam(c.req.param('expenseId'));
  const existing = one<ExpenseRow>('SELECT * FROM expenses WHERE id = ? AND group_id = ?', expenseId, group.id);
  if (!existing) throw fail(404, 'Трата не найдена');
  const body = expenseBody.parse(await c.req.json());
  body.kind = existing.kind;
  const computed = validateExpense(group.id, body);
  tx(() => {
    run(
      `UPDATE expenses SET title = ?, amount = ?, payer_id = ?, split_mode = ?, spent_on = ?, updated_at = datetime('now')
       WHERE id = ?`,
      body.title,
      body.amount,
      body.payerId,
      body.splitMode,
      body.spentOn,
      expenseId,
    );
    saveShares(expenseId, body, computed);
  });
  return c.json(detail(group, me));
});

api.delete('/groups/:id/expenses/:expenseId', (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const res = run('DELETE FROM expenses WHERE id = ? AND group_id = ?', idParam(c.req.param('expenseId')), group.id);
  if (res.changes === 0) throw fail(404, 'Трата не найдена');
  return c.json(detail(group, me));
});
