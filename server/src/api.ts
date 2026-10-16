import { Hono } from 'hono';
import { z } from 'zod';
import { CATEGORY_IDS, DEFAULT_CATEGORY } from '../../shared/categories.ts';
import { createT, type Key, type Lang, type Params, pickLang, type TFn } from '../../shared/i18n/index.ts';
import { CURRENCIES, computeShares, SplitError } from '../../shared/money.ts';
import { expenseSnapshot, listActivity, logActivity } from './activity.ts';
import { type TelegramUser, validateInitData } from './auth.ts';
import { appLink, loadExpenseSnap, notifyExpense, notifyExpenseChange, sendExportFile } from './bot.ts';
import { config } from './config.ts';
import { all, one, run, tx } from './db.ts';
import { buildCsv, exportFileName } from './export.ts';
import { deserialize, PaymentInfoError, parsePaymentInfo, serialize } from './paymentInfo.ts';
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

type Env = { Variables: { user: TelegramUser; lang: Lang } };

export const api = new Hono<Env>();

/** An API error: carries a dictionary key, translated into the request user's language in `onError`. */
class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429,
    readonly key: Key,
    readonly params?: Params,
  ) {
    super(key);
  }
}

const fail = (status: ApiError['status'], key: Key, params?: Params) => new ApiError(status, key, params);

api.onError((err, c) => {
  const t: TFn = createT(c.get('lang') ?? 'ru');
  if (err instanceof ApiError) return c.json({ error: t(err.key, err.params) }, err.status);
  if (err instanceof PaymentInfoError) return c.json({ error: t(err.key) }, 400);
  if (err instanceof SplitError) return c.json({ error: t(err.key, err.params) }, 400);
  if (err instanceof z.ZodError) return c.json({ error: t('errors.invalidData'), issues: err.issues }, 400);
  console.error(err);
  return c.json({ error: t('errors.internal') }, 500);
});

// --- Auth: every /api request carries "Authorization: tma <initData>" ---
api.use('*', async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const [scheme, value = ''] = header.split(' ', 2) as [string, string?];
  let user: TelegramUser | undefined;
  // Dev only: the web client says which language to use (there is no Telegram language_code).
  const devLang = config.devAuth ? c.req.header('x-lang') : undefined;
  c.set('lang', pickLang(devLang));
  if (scheme === 'tma') {
    user = validateInitData(value, config.botToken, config.initDataMaxAgeSec)?.user;
  } else if (scheme === 'dev' && config.devAuth) {
    const id = Number(value);
    if (Number.isInteger(id) && id > 0)
      user = { id, first_name: createT(pickLang(devLang))('dev.userName', { id }), language_code: devLang };
  }
  if (!user) throw fail(401, 'errors.unauthorized');
  upsertUser(user);
  c.set('user', user);
  c.set('lang', pickLang(user.language_code));
  await next();
});

// --- Rate limit: per Telegram user, sliding one-minute window ---
export const rateLimiter = createRateLimiter({ limit: config.rateLimitPerMin });
api.use('*', async (c, next) => {
  if (!rateLimiter.allow(c.get('user').id)) throw fail(429, 'errors.tooMany');
  await next();
});

const idParam = (v: string | undefined) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw fail(404, 'errors.notFound');
  return n;
};

function loadGroupFor(groupIdRaw: string | undefined, userId: number) {
  const groupId = idParam(groupIdRaw);
  const group = one<GroupRow>('SELECT * FROM groups WHERE id = ?', groupId);
  const me = group && findMembership(groupId, userId);
  if (!group || !me) throw fail(404, 'errors.groupNotFound');
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

const paymentInfoBody = z
  .object({
    phone: z.string().max(40).optional(),
    bank: z.string().max(500).optional(),
    card: z.string().max(40).optional(),
    link: z.string().max(1000).optional(),
    note: z.string().max(1000).optional(),
  })
  .strict();

api.get('/me/payment-info', (c) => {
  const u = one<UserRow>('SELECT * FROM users WHERE id = ?', c.get('user').id)!;
  return c.json(deserialize(u.payment_info));
});

api.put('/me/payment-info', async (c) => {
  const info = parsePaymentInfo(paymentInfoBody.parse(await c.req.json()));
  run('UPDATE users SET payment_info = ? WHERE id = ?', serialize(info), c.get('user').id);
  return c.json(info);
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
    logActivity(id, user.id, 'group.create', { name: body.name });
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
  tx(() => {
    run('UPDATE groups SET name = ? WHERE id = ?', body.name, group.id);
    if (body.name !== group.name)
      logActivity(group.id, c.get('user').id, 'group.rename', { from: group.name, to: body.name });
  });
  return c.json(detail({ ...group, name: body.name }, me));
});

api.delete('/groups/:id', (c) => {
  const user = c.get('user');
  const { group } = loadGroupFor(c.req.param('id'), user.id);
  if (group.created_by !== user.id) throw fail(403, 'errors.ownerOnlyDelete');
  tx(() => {
    run('DELETE FROM expense_shares WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = ?)', group.id);
    run('DELETE FROM expenses WHERE group_id = ?', group.id);
    run('DELETE FROM members WHERE group_id = ?', group.id);
    run('DELETE FROM groups WHERE id = ?', group.id);
  });
  return c.json({ ok: true });
});

// Not a data change, so it is not written to the activity log.
api.post('/groups/:id/export', async (c) => {
  const user = c.get('user');
  const lang = c.get('lang');
  const { group, me } = loadGroupFor(c.req.param('id'), user.id);
  const d = detail(group, me);
  const t = createT(lang);
  const sent = await sendExportFile(
    user.id,
    buildCsv(d, lang),
    exportFileName(group.name),
    t('export.caption', { name: group.name, count: d.expenses.length }),
  );
  if (!sent) throw fail(409, 'errors.exportBotUnavailable');
  return c.json({ ok: true });
});

api.post('/groups/:id/archive', (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  tx(() => {
    if (group.archived_at === null) logActivity(group.id, c.get('user').id, 'group.archive', {});
    run("UPDATE groups SET archived_at = COALESCE(archived_at, datetime('now')) WHERE id = ?", group.id);
  });
  return c.json(detail({ ...group, archived_at: group.archived_at ?? 'now' }, me));
});

api.post('/groups/:id/unarchive', (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  tx(() => {
    if (group.archived_at !== null) logActivity(group.id, c.get('user').id, 'group.unarchive', {});
    run('UPDATE groups SET archived_at = NULL WHERE id = ?', group.id);
  });
  return c.json(detail({ ...group, archived_at: null }, me));
});

// Leaving keeps the person in the group as a name-only member, so history and balances stay intact.
api.post('/groups/:id/leave', (c) => {
  const user = c.get('user');
  const { group, me } = loadGroupFor(c.req.param('id'), user.id);
  tx(() => {
    if (group.created_by === user.id) {
      const heir = one<{ user_id: number }>(
        'SELECT user_id FROM members WHERE group_id = ? AND user_id IS NOT NULL AND user_id != ? ORDER BY id LIMIT 1',
        group.id,
        user.id,
      );
      // The last person with Telegram can only delete the group: otherwise nobody could ever manage it.
      if (!heir) throw fail(409, 'errors.lastMemberLeave');
      run('UPDATE groups SET created_by = ? WHERE id = ?', heir.user_id, group.id);
    }
    logActivity(group.id, user.id, 'member.leave', { memberId: me.id, name: me.name });
    run('UPDATE members SET user_id = NULL WHERE id = ?', me.id);
  });
  return c.json({ ok: true });
});

// --- Members ---
api.post('/groups/:id/members', async (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const body = z.object({ name }).parse(await c.req.json());
  tx(() => {
    const res = run('INSERT INTO members (group_id, name) VALUES (?, ?)', group.id, body.name);
    logActivity(group.id, c.get('user').id, 'member.add', { memberId: Number(res.lastInsertRowid), name: body.name });
  });
  return c.json(detail(group, me), 201);
});

api.patch('/groups/:id/members/:memberId', async (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const body = z
    .object({ name: name.optional(), paymentInfo: paymentInfoBody.optional() })
    .refine((b) => b.name !== undefined || b.paymentInfo !== undefined)
    .parse(await c.req.json());
  const memberId = idParam(c.req.param('memberId'));
  const member = one<MemberRow>('SELECT * FROM members WHERE id = ? AND group_id = ?', memberId, group.id);
  if (!member) throw fail(404, 'errors.memberNotFound');
  // People with Telegram edit their own payment details on the home screen, not through the group.
  if (body.paymentInfo && member.user_id !== null) throw fail(409, 'errors.paymentInfoTelegram');
  const info = body.paymentInfo && parsePaymentInfo(body.paymentInfo);
  tx(() => {
    const actor = c.get('user').id;
    if (body.name !== undefined) {
      run('UPDATE members SET name = ? WHERE id = ?', body.name, memberId);
      if (body.name !== member.name)
        logActivity(group.id, actor, 'member.rename', { memberId, from: member.name, to: body.name });
    }
    if (info) {
      run('UPDATE members SET payment_info = ? WHERE id = ?', serialize(info), memberId);
      // Only the fact is logged, never the requisites themselves.
      logActivity(group.id, actor, 'member.payment_info', { memberId, name: body.name ?? member.name });
    }
  });
  return c.json(detail(group, me));
});

api.delete('/groups/:id/members/:memberId', (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const memberId = idParam(c.req.param('memberId'));
  const member = one<MemberRow>('SELECT * FROM members WHERE id = ? AND group_id = ?', memberId, group.id);
  if (!member) throw fail(404, 'errors.memberNotFound');
  if (member.user_id !== null) throw fail(409, 'errors.memberHasTelegram');
  const used = one(
    'SELECT 1 FROM expenses WHERE payer_id = ? UNION SELECT 1 FROM expense_shares WHERE member_id = ? LIMIT 1',
    memberId,
    memberId,
  );
  if (used) throw fail(409, 'errors.memberHasExpenses');
  tx(() => {
    run('DELETE FROM members WHERE id = ?', memberId);
    logActivity(group.id, c.get('user').id, 'member.delete', { memberId, name: member.name });
  });
  return c.json(detail(group, me));
});

// --- Invites ---
api.get('/invite/:code', (c) => {
  const group = one<GroupRow>('SELECT * FROM groups WHERE invite_code = ?', c.req.param('code'));
  if (!group) throw fail(404, 'errors.inviteInvalid');
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
  if (!group) throw fail(404, 'errors.inviteInvalid');
  if (!findMembership(group.id, user.id)) {
    tx(() => {
      if (body.claimMemberId) {
        // "I am this person": link a name-only member to the Telegram account, keeping their history.
        const res = run(
          'UPDATE members SET user_id = ? WHERE id = ? AND group_id = ? AND user_id IS NULL',
          user.id,
          body.claimMemberId,
          group.id,
        );
        if (res.changes === 0) throw fail(409, 'errors.memberTaken');
        const claimed = one<MemberRow>('SELECT * FROM members WHERE id = ?', body.claimMemberId)!;
        logActivity(group.id, user.id, 'member.claim', { memberId: claimed.id, name: claimed.name });
      } else {
        const res = run(
          'INSERT INTO members (group_id, user_id, name) VALUES (?, ?, ?)',
          group.id,
          user.id,
          displayName(user),
        );
        logActivity(group.id, user.id, 'member.join', {
          memberId: Number(res.lastInsertRowid),
          name: displayName(user),
        });
      }
    });
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
  category: z.enum(CATEGORY_IDS).optional(),
  shares: z
    .array(z.object({ memberId: z.number().int().positive(), value: z.number().int().min(0) }))
    .min(1)
    .max(100),
});
type ExpenseBody = z.infer<typeof expenseBody>;

function validateExpense(groupId: number, body: ExpenseBody, lang: Lang) {
  const memberIds = new Set(all<{ id: number }>('SELECT id FROM members WHERE group_id = ?', groupId).map((m) => m.id));
  if (!memberIds.has(body.payerId) || body.shares.some((s) => !memberIds.has(s.memberId))) {
    throw fail(400, 'errors.foreignMember');
  }
  if (body.kind === 'transfer') {
    if (body.shares.length !== 1 || body.shares[0].memberId === body.payerId) throw fail(400, 'errors.badTransfer');
    body.splitMode = 'exact';
    body.shares[0].value = body.amount;
    body.title ||= createT(lang)('transfer.defaultTitle');
    body.category = DEFAULT_CATEGORY;
  } else if (!body.title) {
    throw fail(400, 'errors.titleRequired');
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
  const computed = validateExpense(group.id, body, c.get('lang'));
  const expense = tx(() => {
    const res = run(
      `INSERT INTO expenses (group_id, kind, title, amount, payer_id, split_mode, spent_on, category, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      group.id,
      body.kind,
      body.title,
      body.amount,
      body.payerId,
      body.splitMode,
      body.spentOn,
      body.category ?? DEFAULT_CATEGORY,
      user.id,
    );
    const id = Number(res.lastInsertRowid);
    saveShares(id, body, computed);
    logActivity(group.id, user.id, 'expense.create', { expenseId: id, expense: expenseSnapshot(id)! });
    run('UPDATE groups SET archived_at = NULL WHERE id = ?', group.id);
    return one<ExpenseRow>('SELECT * FROM expenses WHERE id = ?', id)!;
  });
  notifyExpense(group, expense, user.id, me.name);
  return c.json(detail({ ...group, archived_at: null }, me), 201);
});

api.put('/groups/:id/expenses/:expenseId', async (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const expenseId = idParam(c.req.param('expenseId'));
  const existing = one<ExpenseRow>('SELECT * FROM expenses WHERE id = ? AND group_id = ?', expenseId, group.id);
  if (!existing) throw fail(404, 'errors.expenseNotFound');
  const body = expenseBody.parse(await c.req.json());
  body.kind = existing.kind;
  const computed = validateExpense(group.id, body, c.get('lang'));
  const before = loadExpenseSnap(expenseId);
  tx(() => {
    const snapBefore = expenseSnapshot(expenseId)!;
    run(
      `UPDATE expenses SET title = ?, amount = ?, payer_id = ?, split_mode = ?, spent_on = ?, category = ?, updated_at = datetime('now')
       WHERE id = ?`,
      body.title,
      body.amount,
      body.payerId,
      body.splitMode,
      body.spentOn,
      body.kind === 'transfer' ? DEFAULT_CATEGORY : (body.category ?? existing.category),
      expenseId,
    );
    saveShares(expenseId, body, computed);
    logActivity(group.id, c.get('user').id, 'expense.update', {
      expenseId,
      before: snapBefore,
      after: expenseSnapshot(expenseId)!,
    });
  });
  const after = loadExpenseSnap(expenseId);
  if (before && after) notifyExpenseChange(group, before, after, c.get('user').id, me.name);
  return c.json(detail(group, me));
});

api.delete('/groups/:id/expenses/:expenseId', (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const expenseId = idParam(c.req.param('expenseId'));
  const before = one<{ id: number }>('SELECT id FROM expenses WHERE id = ? AND group_id = ?', expenseId, group.id)
    ? loadExpenseSnap(expenseId)
    : null;
  tx(() => {
    const snap = expenseSnapshot(expenseId);
    const res = run('DELETE FROM expenses WHERE id = ? AND group_id = ?', expenseId, group.id);
    if (res.changes === 0 || !snap) throw fail(404, 'errors.expenseNotFound');
    logActivity(group.id, c.get('user').id, 'expense.delete', { expenseId, expense: snap });
  });
  if (before) notifyExpenseChange(group, before, null, c.get('user').id, me.name);
  return c.json(detail(group, me));
});

// --- History ---
api.get('/groups/:id/activity', (c) => {
  const { group } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const q = z
    .object({
      before: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    })
    .parse(c.req.query());
  return c.json(listActivity(group.id, q.before, q.limit));
});
