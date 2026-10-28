import { GrammyError, HttpError } from 'grammy';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { categoryTotals, DEFAULT_CATEGORY } from '../../shared/categories.ts';
import { CLIENT_ERROR_LIMITS, routePattern, scrubText, stackHead } from '../../shared/clientError.ts';
import { createT, type Lang, pickLang, type TFn } from '../../shared/i18n/index.ts';
import { startParamFor } from '../../shared/invite.ts';
import { CURRENCIES, SplitError } from '../../shared/money.ts';
import { firstOccurrence } from '../../shared/recurring.ts';
import { groupSummary, summaryShareText } from '../../shared/summary.ts';
import { deleteAccount, eraseGroup, leaveGroup } from './account.ts';
import { expenseSnapshot, listActivity, logActivity } from './activity.ts';
import { alerter, reportServerError } from './alerts.ts';
import { type TelegramUser, validateInitData } from './auth.ts';
import {
  appLink,
  canPrepareShare,
  canRequestChat,
  chatMemberStatus,
  loadExpenseSnap,
  notifyAccessRequest,
  notifyChatLinked,
  notifyExpense,
  notifyExpenseChange,
  notifyMemberRemoved,
  notifyRemind,
  notifyTripFinished,
  prepareChatButton,
  prepareShare,
  sendExportFile,
} from './bot.ts';
import { attachChat, checkChatLink, createChatRequest, groupOfChat, unlinkGroup } from './chatLink.ts';
import { config } from './config.ts';
import { all, one, run, tx } from './db.ts';
import { createDemoGroup } from './demo.ts';
import { ApiError, fail } from './errors.ts';
import { createExpense, expenseBody, saveShares, validateExpense } from './expenses.ts';
import { buildCsv, exportFileName } from './export.ts';
import { logTelegramError } from './logging.ts';
import { deserialize, isEmpty, PaymentInfoError, parsePaymentInfo, serialize } from './paymentInfo.ts';
import { assertCanJoinMoreGroups, assertRoomForMembers, assertRoomForRecurring } from './quota.ts';
import { createRateLimiter } from './rateLimit.ts';
import { getRate, RatesError } from './rates.ts';
import { hasReceiptsAccess, requestAccess } from './receipts/access.ts';
import {
  acquireScan,
  budgetExhausted,
  canScan,
  othersInFlight,
  recordReceiptScan,
  releaseScan,
} from './receipts/limits.ts';
import type { ReceiptUsage } from './receipts/provider.ts';
import { receiptsEnabled } from './receipts/provider.ts';
import { MEDIA_TYPES, matchesSignature, scanReceipt } from './receipts/service.ts';
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
  expensesPage,
  findMembership,
  type GroupRow,
  getExpense,
  groupBalanceSnapshot,
  groupDetail,
  groupsForUser,
  loadLedger,
  type MemberRow,
  newInviteCode,
  type UserRow,
  upsertUser,
} from './repo.ts';
import { balanceShareText, buildShareResult, SHARE_TARGETS } from './shareCard.ts';
import { countEvent, countEventSafe } from './stats.ts';

type Env = { Variables: { user: TelegramUser; lang: Lang } };

export const api = new Hono<Env>();

api.onError((err, c) => {
  const t: TFn = createT(c.get('lang') ?? 'ru');
  if (err instanceof ApiError) return c.json({ error: t(err.key, err.params) }, err.status);
  if (err instanceof RatesError) return c.json({ error: t(err.key) }, err.status);
  if (err instanceof PaymentInfoError) return c.json({ error: t(err.key) }, 400);
  if (err instanceof SplitError) return c.json({ error: t(err.key, err.params) }, 400);
  if (err instanceof z.ZodError) return c.json({ error: t('errors.invalidData'), issues: err.issues }, 400);
  // A Telegram error would drag the request payload (message text) into the log.
  if (err instanceof GrammyError || err instanceof HttpError) logTelegramError('API request failed', err);
  else console.error(err);
  void reportServerError(err);
  return c.json({ error: t('errors.internal') }, 500);
});

// Body limits run before auth, so there is no user language yet: X-Lang in dev, else Accept-Language (Russian if absent).
const tooLargeText = (c: Context<Env>) =>
  createT(pickLang(config.devAuth ? c.req.header('x-lang') : c.req.header('accept-language')))(
    'errors.payloadTooLarge',
  );

// Request bodies are small JSON; refuse anything bigger before it is read into memory.
// The receipt photo route has a bigger limit of its own (see below), so it skips this one.
const smallBodyLimit = bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: tooLargeText(c) }, 413) });
const RECEIPT_PARSE_PATH = /\/groups\/[^/]+\/receipts\/parse$/;
api.use('*', (c, next) => (RECEIPT_PARSE_PATH.test(c.req.path) ? next() : smallBodyLimit(c, next)));

/** Reads the JSON body; a body that is not JSON is the client's fault (400), not a server error. */
async function jsonBody(c: Context<Env>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch (err) {
    if (err instanceof SyntaxError) throw fail(400, 'errors.invalidData');
    throw err;
  }
}

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
    // X-Dev-Name (dev only, URL-encoded) gives the user a nice name, e.g. for the store screenshots.
    const devName = decodeURIComponent(c.req.header('x-dev-name') ?? '').slice(0, 64);
    if (Number.isInteger(id) && id > 0)
      user = { id, first_name: devName || createT(pickLang(devLang))('dev.userName', { id }), language_code: devLang };
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

// Exchange rates hit an external service, so they get a stricter limit of their own.
export const ratesLimiter = createRateLimiter({ limit: config.ratesLimitPerMin });

// Error reports from the Mini App: a small body, a strict schema, a limit of their own. No personal data is kept:
// anything beyond the listed fields is refused, text is scrubbed (no query strings, no launch params) and cut.
export const clientErrorsLimiter = createRateLimiter({ limit: 10 });
const cut = (max: number) =>
  z
    .string()
    .transform((s) => scrubText(s).slice(0, max))
    .pipe(z.string().min(1));
const clientErrorBody = z
  .object({
    kind: z.enum(['error', 'rejection', 'render']),
    message: cut(CLIENT_ERROR_LIMITS.message),
    stack: z
      .string()
      .optional()
      .transform((s) => stackHead(s)),
    route: z.string().transform((s) => routePattern(s)),
    version: cut(CLIENT_ERROR_LIMITS.short),
    platform: cut(CLIENT_ERROR_LIMITS.short),
    tgVersion: cut(CLIENT_ERROR_LIMITS.short),
  })
  .strict();

api.post(
  '/client-errors',
  bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json({ error: tooLargeText(c) }, 413) }),
  async (c) => {
    if (!clientErrorsLimiter.allow(c.get('user').id)) throw fail(429, 'errors.tooMany');
    const r = clientErrorBody.parse(await jsonBody(c));
    console.warn(`client error ${JSON.stringify(r)}`);
    void alerter.report({
      source: 'client',
      message: r.message,
      at: `${
        r.stack
          .split('\n')
          .find((l) => /^\s*at\s|@/.test(l))
          ?.trim() ?? '-'
      }\n${r.route} · ${r.platform} · tg ${r.tgVersion}`,
      version: r.version,
    });
    return c.body(null, 204);
  },
);

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

const detail = (group: GroupRow, me: MemberRow, all = false) =>
  groupDetail(group, me, appLink(group.invite_code), { all });

const name = z.string().trim().min(1).max(64);

// --- Me ---
// Consent counts only for the provider it was given for: switching RECEIPTS_PROVIDER asks everyone again.
const hasReceiptConsent = (u: Pick<UserRow, 'receipt_consent_at' | 'receipt_consent_provider'>) =>
  u.receipt_consent_at !== null && u.receipt_consent_provider === config.receiptsProvider;

api.get('/me', (c) => {
  const u = one<UserRow>('SELECT * FROM users WHERE id = ?', c.get('user').id)!;
  // No Telegram id: the client identifies itself through `meId` of the group.
  return c.json({
    name: displayName(u),
    notify: u.notify === 1,
    receiptsEnabled: receiptsEnabled(),
    // The privacy page and the consent screen name whoever reads the photos.
    receiptsProvider: config.receiptsProvider,
    receiptConsent: hasReceiptConsent(u),
  });
});

api.put('/me', async (c) => {
  const body = z.object({ notify: z.boolean() }).parse(await jsonBody(c));
  run('UPDATE users SET notify = ? WHERE id = ?', body.notify ? 1 : 0, c.get('user').id);
  return c.json({ ok: true });
});

// The user agrees that receipt photos are sent to the recognition provider (see the privacy text). Required before parse.
// Repeating it for the same provider keeps the first stamp.
api.post('/me/receipt-consent', (c) => {
  run(
    `UPDATE users SET receipt_consent_at = ?, receipt_consent_provider = ?
     WHERE id = ? AND (receipt_consent_at IS NULL OR receipt_consent_provider IS NOT ?)`,
    new Date().toISOString(),
    config.receiptsProvider,
    c.get('user').id,
    config.receiptsProvider,
  );
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
  const info = parsePaymentInfo(paymentInfoBody.parse(await jsonBody(c)));
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
    .parse(await jsonBody(c));
  const groupId = tx(() => {
    assertCanJoinMoreGroups(user.id);
    assertRoomForMembers(0, 1 + body.memberNames.length);
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
    countEvent('group.create');
    return id;
  });
  const { group, me } = loadGroupFor(String(groupId), user.id);
  return c.json(detail(group, me), 201);
});

// "Look at an example": creates the demo group of the caller, or returns the one they already have.
api.post('/demo', (c) => {
  const user = c.get('user');
  const { group, created } = createDemoGroup(user, c.get('lang'));
  const me = findMembership(group.id, user.id)!;
  return c.json(detail(group, me), created ? 201 : 200);
});

api.get('/groups/:id', (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  return c.json(detail(group, me));
});

api.patch('/groups/:id', async (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const body = z.object({ name }).parse(await jsonBody(c));
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

// One CSV a minute per user: each file is sent to their private chat through the shared bot.
export const exportLimiter = createRateLimiter({ limit: 1 });

// Not a data change, so it is not written to the activity log.
api.post('/groups/:id/export', async (c) => {
  const user = c.get('user');
  const lang = c.get('lang');
  const { group, me } = loadGroupFor(c.req.param('id'), user.id);
  if (!exportLimiter.allow(user.id)) throw fail(429, 'errors.exportTooOften');
  const d = detail(group, me, true);
  const t = createT(lang);
  const sent = await sendExportFile(
    user.id,
    buildCsv(d, lang),
    exportFileName(group.name),
    t('export.caption', { name: group.name, count: d.expenses.length }),
  );
  if (!sent) throw fail(409, 'errors.exportBotUnavailable');
  countEventSafe('export.csv');
  return c.json({ ok: true });
});

// Finishing a trip is archiving: the first archive call (not a repeat) counts the event and posts the summary card.
api.post('/groups/:id/archive', (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const finishing = group.archived_at === null;
  tx(() => {
    if (finishing) {
      logActivity(group.id, c.get('user').id, 'group.archive', {});
      if (!group.is_demo) countEvent('group.finish');
    }
    run("UPDATE groups SET archived_at = COALESCE(archived_at, datetime('now')) WHERE id = ?", group.id);
  });
  if (finishing) notifyTripFinished(group, c.get('lang'));
  return c.json(detail({ ...group, archived_at: group.archived_at ?? 'now' }, me));
});

api.post('/groups/:id/unarchive', (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  tx(() => {
    if (group.archived_at !== null) {
      logActivity(group.id, c.get('user').id, 'group.unarchive', {});
      // Like a resume: occurrences the scheduler has not yet skipped while archived are not made up.
      const today = localDate();
      const stale = all<RecurringRow>(
        'SELECT * FROM recurring WHERE group_id = ? AND active = 1 AND next_date < ?',
        group.id,
        today,
      );
      for (const r of stale) {
        run('UPDATE recurring SET next_date = ? WHERE id = ?', firstOccurrence(r.period, r.day, today), r.id);
      }
    }
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

// Owner only: the old link stops working (preview and join answer 404).
api.post('/groups/:id/invite/rotate', (c) => {
  const user = c.get('user');
  const { group, me } = loadGroupFor(c.req.param('id'), user.id);
  if (group.created_by !== user.id) throw fail(403, 'errors.ownerOnlyManage');
  if (group.is_demo) throw fail(409, 'errors.demoNotAllowed');
  const code = newInviteCode();
  tx(() => {
    run('UPDATE groups SET invite_code = ? WHERE id = ?', code, group.id);
    logActivity(group.id, user.id, 'group.invite_rotate', {});
  });
  return c.json(detail({ ...group, invite_code: code }, me));
});

// --- Members ---
api.post('/groups/:id/members', async (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const body = z.object({ name }).parse(await jsonBody(c));
  tx(() => {
    assertRoomForMembers(group.id);
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
    .parse(await jsonBody(c));
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

// Owner only. Same effect as the person leaving: they become a name-only member, history stays.
api.post('/groups/:id/members/:memberId/remove', (c) => {
  const user = c.get('user');
  const { group, me } = loadGroupFor(c.req.param('id'), user.id);
  if (group.created_by !== user.id) throw fail(403, 'errors.ownerOnlyManage');
  const memberId = idParam(c.req.param('memberId'));
  const member = one<MemberRow>('SELECT * FROM members WHERE id = ? AND group_id = ?', memberId, group.id);
  if (!member) throw fail(404, 'errors.memberNotFound');
  if (member.user_id === null) throw fail(409, 'errors.removeNoTelegram');
  if (member.user_id === user.id) throw fail(409, 'errors.removeSelf');
  const removedUserId = member.user_id;
  tx(() => {
    run('DELETE FROM reminders WHERE from_member = ? OR to_member = ?', member.id, member.id);
    logActivity(group.id, user.id, 'member.remove', { memberId: member.id, name: member.name });
    run('UPDATE members SET user_id = NULL WHERE id = ?', member.id);
  });
  notifyMemberRemoved(group, removedUserId);
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
  // Templates (active or paused) keep the payer and shares without foreign keys; deleting would silently disable them.
  const inRecurring = one(
    `SELECT 1 FROM recurring WHERE group_id = ? AND (
       payer_id = ?
       OR EXISTS (SELECT 1 FROM json_each(recurring.shares) WHERE json_extract(value, '$.memberId') = ?)
     ) LIMIT 1`,
    group.id,
    memberId,
    memberId,
  );
  if (inRecurring) throw fail(409, 'errors.memberHasRecurring');
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
  const body = z.object({ groupId: z.number().int().positive() }).parse(await jsonBody(c));
  const link = loadChatLink(c.req.param('token'));
  const { group, me } = loadGroupFor(String(body.groupId), user.id);
  if (group.is_demo) throw fail(409, 'errors.demoNotAllowed');
  // Only a chat admin may link the chat: the token is visible to every member of the chat.
  let status: string | null;
  try {
    status = await chatMemberStatus(link.chat_id, user.id);
  } catch {
    throw fail(503, 'errors.botUnavailable');
  }
  if (status === null) throw fail(503, 'errors.botUnavailable');
  if (status !== 'creator' && status !== 'administrator') throw fail(403, 'errors.chatLinkNotAdmin');
  attachChat(link, group, user.id);
  const linked = one<GroupRow>('SELECT * FROM groups WHERE id = ?', group.id)!;
  notifyChatLinked(link.chat_id, linked, c.get('lang'));
  return c.json(detail(linked, me));
});

// «Link a Telegram chat» from settings: a prepared request_chat button for WebApp.requestChat(id). The pick arrives
// at the bot as chat_shared and is linked there (see handleChatShared); the Mini App just reloads the group.
api.post('/groups/:id/chat/request', async (c) => {
  const user = c.get('user');
  const { group } = loadGroupFor(c.req.param('id'), user.id);
  if (group.is_demo) throw fail(409, 'errors.demoNotAllowed');
  if (!canRequestChat()) throw fail(503, 'errors.chatRequestUnavailable');
  let id: string | null;
  try {
    id = await prepareChatButton(user.id, createChatRequest(user.id, group.id), c.get('lang'));
  } catch (e) {
    logTelegramError('savePreparedKeyboardButton failed', e);
    throw fail(503, 'errors.chatRequestUnavailable');
  }
  if (!id) throw fail(503, 'errors.chatRequestUnavailable');
  return c.json({ id });
});

api.put('/groups/:id/chat/feed', async (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const { feed } = z.object({ feed: z.enum(CHAT_FEEDS as [ChatFeed, ...ChatFeed[]]) }).parse(await jsonBody(c));
  if (group.is_demo) throw fail(409, 'errors.demoNotAllowed');
  if (group.chat_id === null) throw fail(409, 'errors.chatNotLinked');
  run('UPDATE groups SET chat_feed = ? WHERE id = ?', feed, group.id);
  return c.json(detail({ ...group, chat_feed: feed }, me));
});

api.put('/groups/:id/auto-remind', async (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const { enabled } = z.object({ enabled: z.boolean() }).parse(await jsonBody(c));
  if (group.is_demo) throw fail(409, 'errors.demoNotAllowed');
  if (enabled !== (group.auto_remind === 1)) {
    tx(() => {
      run('UPDATE groups SET auto_remind = ? WHERE id = ?', enabled ? 1 : 0, group.id);
      logActivity(group.id, c.get('user').id, 'group.auto_remind', { enabled });
    });
  }
  return c.json(detail({ ...group, auto_remind: enabled ? 1 : 0 }, me));
});

api.post('/groups/:id/chat/unlink', (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  unlinkGroup(group, c.get('user').id);
  return c.json(detail({ ...group, chat_id: null, chat_title: null }, me));
});

// --- Invites ---
api.get('/invite/:code', (c) => {
  const group = one<GroupRow>('SELECT * FROM groups WHERE invite_code = ? AND is_demo = 0', c.req.param('code'));
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
  const body = z
    .object({ claimMemberId: z.number().int().positive().optional(), source: z.enum(['link', 'card']).optional() })
    .parse(await jsonBody(c));
  const group = one<GroupRow>('SELECT * FROM groups WHERE invite_code = ? AND is_demo = 0', c.req.param('code'));
  if (!group) throw fail(404, 'errors.inviteInvalid');
  // Old clients send no source: that is a plain invite link.
  const joinEvent = body.source === 'card' ? 'join.card' : 'join.link';
  if (!findMembership(group.id, user.id)) {
    tx(() => {
      assertCanJoinMoreGroups(user.id);
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
        countEvent('member.claim');
        countEvent(joinEvent);
      } else {
        assertRoomForMembers(group.id);
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
        countEvent('member.join');
        countEvent(joinEvent);
      }
    });
  }
  return c.json({ groupId: group.id });
});

// --- Exchange rates: suggested rate for a foreign-currency expense (the user can still edit it) ---
api.get('/rates', async (c) => {
  if (!ratesLimiter.allow(c.get('user').id)) throw fail(429, 'errors.rate.tooMany');
  const q = z
    .object({
      base: z.enum(CURRENCIES as [string, ...string[]]),
      currency: z.enum(CURRENCIES as [string, ...string[]]),
      date: isoDate,
    })
    .parse(c.req.query());
  if (q.base === q.currency) throw fail(400, 'errors.rate.sameCurrency');
  const parsed = Date.parse(`${q.date}T00:00:00Z`);
  // Not further than a couple of days ahead: every distinct future date would be a new upstream call and cache entry.
  if (parsed > Date.now() + 2 * 86_400_000) throw fail(400, 'errors.invalidData');
  return c.json(await getRate(q.base, q.currency, q.date));
});

// --- Receipts: photo -> draft with items (the photo lives in memory for this request only) ---
// base64 of a photo shrunk by the client: ~3 MB of JSON is about 2.2 MB of image.
const RECEIPT_BODY_LIMIT = 3 * 1024 * 1024;
const receiptBody = z.object({
  image: z.string().min(1).max(RECEIPT_BODY_LIMIT),
  mediaType: z.enum(MEDIA_TYPES as [string, ...string[]]),
});

// Receipt photos cost money: a stricter limit of their own (plus one scan at a time per user, see limits.ts).
export const receiptsLimiter = createRateLimiter({ limit: config.receiptsPerMin });

api.post(
  '/groups/:id/receipts/parse',
  bodyLimit({
    maxSize: RECEIPT_BODY_LIMIT,
    onError: (c) => c.json({ error: createT(c.get('lang') ?? 'ru')('errors.receipt.tooLarge') }, 413),
  }),
  async (c) => {
    const user = c.get('user');
    const { group } = loadGroupFor(c.req.param('id'), user.id);
    // The demo group is a sandbox open to everyone: scanning there would only burn the shared budget.
    if (group.is_demo) throw fail(409, 'errors.demoNotAllowed');
    if (!receiptsEnabled()) throw fail(503, 'errors.receipt.disabled');
    // Closed beta: enforced here, whatever the client shows. Checked before consent and limits.
    if (!hasReceiptsAccess(group.id)) throw fail(403, 'errors.receipt.betaNoAccess');
    const consent = one<Pick<UserRow, 'receipt_consent_at' | 'receipt_consent_provider'>>(
      'SELECT receipt_consent_at, receipt_consent_provider FROM users WHERE id = ?',
      user.id,
    );
    if (!consent || !hasReceiptConsent(consent)) throw fail(409, 'errors.receipt.consentRequired');
    if (budgetExhausted()) throw fail(503, 'errors.receipt.budget');
    if (!receiptsLimiter.allow(user.id)) throw fail(429, 'errors.receipt.tooFast');
    if (!acquireScan(user.id, group.id)) throw fail(429, 'errors.receipt.busy');
    const usages: ReceiptUsage[] = [];
    let success = false;
    try {
      if (!canScan(group.id, new Date(), othersInFlight(group.id))) throw fail(429, 'errors.receipt.groupLimit');
      const body = receiptBody.parse(await jsonBody(c));
      const mediaType = body.mediaType as (typeof MEDIA_TYPES)[number];
      const bytes = Buffer.from(body.image, 'base64');
      if (bytes.length === 0 || !matchesSignature(bytes, mediaType)) throw fail(400, 'errors.invalidData');
      const draft = await scanReceipt({ mediaType, base64: body.image }, group.currency, (usage) => usages.push(usage));
      success = true;
      c.header('Cache-Control', 'no-store');
      return c.json(draft);
    } finally {
      // Every call that returned tokens costs money (also "not a receipt"); only a returned draft uses the free quota.
      recordReceiptScan(user.id, group.id, usages, success);
      releaseScan(user.id, group.id);
    }
  },
);

// The group asks the owner to open receipt scanning (closed beta). Members only; repeated while pending = no new request.
api.post('/groups/:id/receipts/access-request', (c) => {
  const user = c.get('user');
  const { group, me } = loadGroupFor(c.req.param('id'), user.id);
  if (group.is_demo) throw fail(409, 'errors.demoNotAllowed');
  if (!receiptsEnabled()) throw fail(503, 'errors.receipt.disabled');
  const { created, requestId } = requestAccess(group.id, user.id);
  if (created && requestId !== null) notifyAccessRequest(requestId);
  return c.json(detail(group, me), created ? 201 : 200);
});

// --- Expenses ---
api.post('/groups/:id/expenses', async (c) => {
  const user = c.get('user');
  const { group, me } = loadGroupFor(c.req.param('id'), user.id);
  const body = expenseBody.parse(await jsonBody(c));
  const expense = tx(() => createExpense(group, user.id, body, c.get('lang')));
  notifyExpense(group, expense, user.id, me.name);
  return c.json(detail({ ...group, archived_at: null }, me), 201);
});

// Older expenses, newest first: `before` is the id of the last one the client has.
api.get('/groups/:id/expenses', (c) => {
  const { group } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const q = z
    .object({
      before: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    })
    .parse(c.req.query());
  const limit = q.limit ?? config.expensesPage;
  const page = expensesPage(group.id, { before: q.before, limit });
  if (!page) throw fail(404, 'errors.expenseNotFound');
  return c.json({ items: page.items, hasMore: page.hasMore, nextBefore: page.hasMore ? page.items.at(-1)!.id : null });
});

// Aggregates over ALL expenses of the group (the group payload only carries the newest page).
api.get('/groups/:id/summary', (c) => {
  const { group } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const members = all<{ id: number; name: string }>(
    'SELECT id, name FROM members WHERE group_id = ? ORDER BY id',
    group.id,
  );
  return c.json(groupSummary({ members, expenses: loadLedger(group.id) }, c.get('lang')));
});

// Card for «share to any chat»: saved via the Bot API, the Mini App sends it with WebApp.shareMessage(id).
api.post('/groups/:id/share', async (c) => {
  const user = c.get('user');
  const lang = c.get('lang');
  const { group } = loadGroupFor(c.req.param('id'), user.id);
  if (group.is_demo) throw fail(409, 'errors.demoNotAllowed');
  const { kind } = z.object({ kind: z.enum(['balance', 'summary']) }).parse(await jsonBody(c));
  if (!canPrepareShare()) throw fail(503, 'errors.shareUnavailable');
  let text: string;
  if (kind === 'balance') {
    text = balanceShareText(lang, { groupName: group.name, currency: group.currency, ...groupBalanceSnapshot(group) });
  } else {
    const members = all<{ id: number; name: string }>(
      'SELECT id, name FROM members WHERE group_id = ? ORDER BY id',
      group.id,
    );
    const summary = groupSummary({ members, expenses: loadLedger(group.id) }, lang);
    text = summaryShareText(group.name, group.currency, summary, lang);
  }
  let id: string | null;
  try {
    const result = buildShareResult(lang, kind, group.name, text, appLink(startParamFor(group.invite_code, 'card')));
    id = await prepareShare(user.id, result, SHARE_TARGETS);
  } catch (e) {
    logTelegramError('savePreparedInlineMessage failed', e);
    throw fail(503, 'errors.shareUnavailable');
  }
  if (!id) throw fail(503, 'errors.shareUnavailable');
  return c.json({ id });
});

api.get('/groups/:id/stats', (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  return c.json(categoryTotals(loadLedger(group.id), me.id));
});

api.get('/groups/:id/expenses/:expenseId', (c) => {
  const { group } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const e = getExpense(group.id, idParam(c.req.param('expenseId')));
  if (!e) throw fail(404, 'errors.expenseNotFound');
  return c.json(e);
});

api.put('/groups/:id/expenses/:expenseId', async (c) => {
  const { group, me } = loadGroupFor(c.req.param('id'), c.get('user').id);
  const expenseId = idParam(c.req.param('expenseId'));
  const existing = one<ExpenseRow>('SELECT * FROM expenses WHERE id = ? AND group_id = ?', expenseId, group.id);
  if (!existing) throw fail(404, 'errors.expenseNotFound');
  const body = expenseBody.parse(await jsonBody(c));
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
  if (group.is_demo) throw fail(409, 'errors.demoNotAllowed');
  assertRoomForRecurring(group.id);
  const body = recurringCreate.parse(await jsonBody(c));
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
  const body = recurringPatch.parse(await jsonBody(c));
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
  const { memberId } = z.object({ memberId: z.number().int().positive() }).parse(await jsonBody(c));
  const d = detail(group, me);
  const debt = d.settlements.find((s) => s.from === memberId && s.to === me.id);
  if (!debt) throw fail(409, 'errors.remindNotAllowed');
  const debtor = d.members.find((m) => m.id === memberId)!;
  // The Telegram id is not part of the response model, so it is read here on the server only.
  const debtorUserId =
    one<{ user_id: number | null }>('SELECT user_id FROM members WHERE id = ?', memberId)?.user_id ?? null;
  if (!debtor.canNotify || debtorUserId === null) throw fail(409, 'errors.remindNoNotify');
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
    if (!group.is_demo) countEvent('debt.remind');
  });
  notifyRemind(group, debtorUserId, creditor.name, debt.amount, !isEmpty(creditor.paymentInfo));
  return c.json({ ok: true });
});
