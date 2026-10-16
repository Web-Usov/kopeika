import { Hono } from 'hono';
import { z } from 'zod';
import { DEFAULT_CATEGORY } from '../../shared/categories.ts';
import { createT, type Lang, pickLang, type TFn } from '../../shared/i18n/index.ts';
import { CURRENCIES, SplitError } from '../../shared/money.ts';
import { firstOccurrence } from '../../shared/recurring.ts';
import { deleteAccount, eraseGroup, leaveGroup } from './account.ts';
import { expenseSnapshot, listActivity, logActivity } from './activity.ts';
import { type TelegramUser, validateInitData } from './auth.ts';
import {
  appLink,
  loadExpenseSnap,
  notifyChatLinked,
  notifyExpense,
  notifyExpenseChange,
  notifyRemind,
  sendExportFile,
} from './bot.ts';
import { attachChat, checkChatLink, groupOfChat, unlinkGroup } from './chatLink.ts';
import { config } from './config.ts';
import { all, one, run, tx } from './db.ts';
import { ApiError, fail } from './errors.ts';
import { createExpense, expenseBody, saveShares, validateExpense } from './expenses.ts';
import { buildCsv, exportFileName } from './export.ts';
import { deserialize, isEmpty, PaymentInfoError, parsePaymentInfo, serialize } from './paymentInfo.ts';
import { createRateLimiter } from './rateLimit.ts';
import { getRate, RatesError } from './rates.ts';
import {
  expenseFor,
  isoDate,
  localDate,
  type RecurringRow,
  recurringDto,
  recurringShape,
  scheduleOk,
} from './recurring.ts';
import {
  CHAT_FEEDS,
  type ChatFeed,
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

api.onError((err, c) => {
  const t: TFn = createT(c.get('lang') ?? 'ru');
  if (err instanceof ApiError) return c.json({ error: t(err.key, err.params) }, err.status);
  if (err instanceof RatesError) return c.json({ error: t(err.key) }, err.status);
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

// Erases the caller's data (see account.ts). The same Telegram user may start over later: the next request creates a fresh account.
api.delete('/me', (c) => c.json(deleteAccount(c.get('user').id)));

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
  tx(() => eraseGroup(group.id));
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
  tx(() => leaveGroup(group, me, user.id));
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

// --- Chat links ---
function loadChatLink(token: string) {
  const { link, problem } = checkChatLink(token);
  if (problem === 'invalid') throw fail(404, 'errors.chatLinkInvalid');
  if (problem === 'expired') throw fail(404, 'errors.chatLinkExpired');
  if (problem === 'used') throw fail(409, 'errors.chatLinkUsed');
  return link!;
}

api.get('/chat-links/:token', (c) => {
  const link = loadChatLink(c.req.param('token'));
  // Name of the group the chat is linked to now: only if the caller is a member of it.
  const prev = groupOfChat(link.chat_id);
  const replaces = prev && findMembership(prev.id, c.get('user').id) ? { name: prev.name } : null;
  return c.json({ chatTitle: link.chat_title, replaces });
});

api.post('/chat-links/:token/attach', async (c) => {
  const user = c.get('user');
  const body = z.object({ groupId: z.number().int().positive() }).parse(await c.req.json());
  const link = loadChatLink(c.req.param('token'));
  const { group, me } = loadGroupFor(String(body.groupId), user.id);
  attachChat(link, group, user.id);
  const linked = one<GroupRow>('SELECT * FROM groups WHERE id = ?', group.id)!;
  notifyChatLinked(link.chat_id, linked, c.get('lang'));
  return c.json(detail(linked, me));
});

api.put('/groups/:id/chat/feed', async (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const { feed } = z.object({ feed: z.enum(CHAT_FEEDS as [ChatFeed, ...ChatFeed[]]) }).parse(await c.req.json());
  if (group.chat_id === null) throw fail(409, 'errors.chatNotLinked');
  run('UPDATE groups SET chat_feed = ? WHERE id = ?', feed, group.id);
  return c.json(detail({ ...group, chat_feed: feed }, me));
});

api.post('/groups/:id/chat/unlink', (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  unlinkGroup(group, c.get('user').id);
  return c.json(detail({ ...group, chat_id: null, chat_title: null }, me));
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

// --- Exchange rates: suggested rate for a foreign-currency expense (the user can still edit it) ---
api.get('/rates', async (c) => {
  const q = z
    .object({
      base: z.enum(CURRENCIES as [string, ...string[]]),
      currency: z.enum(CURRENCIES as [string, ...string[]]),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .parse(c.req.query());
  if (q.base === q.currency) throw fail(400, 'errors.rate.sameCurrency');
  if (Number.isNaN(Date.parse(`${q.date}T00:00:00Z`))) throw fail(400, 'errors.invalidData');
  return c.json(await getRate(q.base, q.currency, q.date));
});

// --- Expenses ---
api.post('/groups/:id/expenses', async (c) => {
  const user = c.get('user');
  const { group, me } = loadGroupFor(c.req.param('id'), user.id);
  const body = expenseBody.parse(await c.req.json());
  const expense = tx(() => createExpense(group, user.id, body, c.get('lang')));
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
  const { computed, rate } = validateExpense(group, body, c.get('lang'));
  const before = loadExpenseSnap(expenseId);
  tx(() => {
    const snapBefore = expenseSnapshot(expenseId)!;
    run(
      `UPDATE expenses SET title = ?, amount = ?, payer_id = ?, split_mode = ?, spent_on = ?, category = ?,
         original_amount = ?, original_currency = ?, rate = ?, updated_at = datetime('now')
       WHERE id = ?`,
      body.title,
      body.amount,
      body.payerId,
      body.splitMode,
      body.spentOn,
      body.kind === 'transfer' ? DEFAULT_CATEGORY : (body.category ?? existing.category),
      rate ? (body.originalAmount as number) : null,
      rate ? (body.originalCurrency as string) : null,
      rate,
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

// --- Recurring expenses ---
const recurringCreate = z
  .object({ ...recurringShape, startDate: isoDate.optional() })
  .refine(scheduleOk, { message: 'day' });
const recurringPatch = z
  .object({ ...recurringShape, active: z.boolean() })
  .partial()
  .refine((b) => Object.keys(b).length > 0);

/** A template must pass the same checks as the expense it will produce (members, shares, sums). */
function validateTemplate(group: GroupRow, r: RecurringRow, lang: Lang) {
  validateExpense(group, expenseFor(r, r.next_date), lang);
}

function loadRecurring(group: GroupRow, ridRaw: string | undefined) {
  const r = one<RecurringRow>('SELECT * FROM recurring WHERE id = ? AND group_id = ?', idParam(ridRaw), group.id);
  if (!r) throw fail(404, 'errors.recurringNotFound');
  return r;
}

api.get('/groups/:id/recurring', (c) => {
  const { group } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const rows = all<RecurringRow>('SELECT * FROM recurring WHERE group_id = ? ORDER BY id', group.id);
  return c.json(rows.map(recurringDto));
});

api.post('/groups/:id/recurring', async (c) => {
  const user = c.get('user');
  const { group } = loadGroupFor(c.req.param('id'), user.id);
  const body = recurringCreate.parse(await c.req.json());
  const today = localDate();
  // Never earlier than today: a template does not back-fill the past.
  const start = body.startDate && body.startDate > today ? body.startDate : today;
  const row: RecurringRow = {
    id: 0,
    group_id: group.id,
    created_by: user.id,
    title: body.title,
    category: body.category ?? DEFAULT_CATEGORY,
    amount: body.amount,
    payer_id: body.payerId,
    split_mode: body.splitMode,
    shares: JSON.stringify(body.shares),
    period: body.period,
    day: body.day,
    start_date: start,
    next_date: firstOccurrence(body.period, body.day, start),
    active: 1,
    created_at: '',
  };
  validateTemplate(group, row, c.get('lang'));
  const res = run(
    `INSERT INTO recurring (group_id, created_by, title, category, amount, payer_id, split_mode, shares, period, day,
                            start_date, next_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.group_id,
    row.created_by,
    row.title,
    row.category,
    row.amount,
    row.payer_id,
    row.split_mode,
    row.shares,
    row.period,
    row.day,
    row.start_date,
    row.next_date,
  );
  const created = one<RecurringRow>('SELECT * FROM recurring WHERE id = ?', Number(res.lastInsertRowid))!;
  return c.json(recurringDto(created), 201);
});

api.patch('/groups/:id/recurring/:rid', async (c) => {
  const { group } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const existing = loadRecurring(group, c.req.param('rid'));
  const body = recurringPatch.parse(await c.req.json());
  const next: RecurringRow = {
    ...existing,
    title: body.title ?? existing.title,
    category: body.category ?? existing.category,
    amount: body.amount ?? existing.amount,
    payer_id: body.payerId ?? existing.payer_id,
    split_mode: body.splitMode ?? existing.split_mode,
    shares: body.shares ? JSON.stringify(body.shares) : existing.shares,
    period: body.period ?? existing.period,
    day: body.day ?? existing.day,
    active: body.active === undefined ? existing.active : body.active ? 1 : 0,
  };
  if (!scheduleOk(next)) throw fail(400, 'errors.invalidData');
  // A changed schedule or a resume starts from today: paused time is not made up.
  const rescheduled =
    next.period !== existing.period || next.day !== existing.day || (next.active === 1 && existing.active === 0);
  if (rescheduled) next.next_date = firstOccurrence(next.period, next.day, localDate());
  validateTemplate(group, next, c.get('lang'));
  run(
    `UPDATE recurring SET title = ?, category = ?, amount = ?, payer_id = ?, split_mode = ?, shares = ?, period = ?,
       day = ?, active = ?, next_date = ? WHERE id = ?`,
    next.title,
    next.category,
    next.amount,
    next.payer_id,
    next.split_mode,
    next.shares,
    next.period,
    next.day,
    next.active,
    next.next_date,
    existing.id,
  );
  return c.json(recurringDto(next));
});

api.delete('/groups/:id/recurring/:rid', (c) => {
  const { group } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const r = loadRecurring(group, c.req.param('rid'));
  run('DELETE FROM recurring WHERE id = ?', r.id);
  return c.json({ ok: true });
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
  return c.json(listActivity(group.id, q.before, q.limit, createT(c.get('lang'))('activity.deletedUser')));
});

// --- Debt reminder: the creditor asks the bot to nudge a debtor from the current settlement plan ---
const REMIND_WINDOW_SQL = "datetime('now', '-1 day')";

api.post('/groups/:id/remind', async (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const { memberId } = z.object({ memberId: z.number().int().positive() }).parse(await c.req.json());
  const d = detail(group, me);
  const debt = d.settlements.find((s) => s.from === memberId && s.to === me.id);
  if (!debt) throw fail(409, 'errors.remindNotAllowed');
  const debtor = d.members.find((m) => m.id === memberId)!;
  if (!debtor.canNotify || debtor.userId === null) throw fail(409, 'errors.remindNoNotify');
  const creditor = d.members.find((m) => m.id === me.id)!;

  tx(() => {
    const recent = one(
      `SELECT id FROM reminders WHERE group_id = ? AND from_member = ? AND to_member = ? AND created_at > ${REMIND_WINDOW_SQL}`,
      group.id,
      me.id,
      memberId,
    );
    if (recent) throw fail(429, 'errors.remindToday');
    run('INSERT INTO reminders (group_id, from_member, to_member) VALUES (?, ?, ?)', group.id, me.id, memberId);
    logActivity(group.id, c.get('user').id, 'debt.remind', {
      memberId,
      name: debtor.name,
      amount: debt.amount,
    });
  });
  notifyRemind(group, debtor.userId, creditor.name, debt.amount, !isEmpty(creditor.paymentInfo));
  return c.json({ ok: true });
});
