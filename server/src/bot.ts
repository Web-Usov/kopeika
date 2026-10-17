import { Bot, GrammyError, InlineKeyboard, InputFile } from 'grammy';
import type { InlineQueryResult } from 'grammy/types';
import { createT, type Lang, pickLang } from '../../shared/i18n/index.ts';
import { startParamFor } from '../../shared/invite.ts';
import { formatMoney } from '../../shared/money.ts';
import { checkCommand, checkInline } from './botLimits.ts';
import {
  type ChatMessage,
  type ChatSharedResult,
  createChatLink,
  groupOfChat,
  handleChatShared,
  linkedMessage,
  migrateChat,
  unlinkChat,
  welcomeMessage,
} from './chatLink.ts';
import { balanceText, esc, helpText, privateBalanceText } from './chatText.ts';
import { config } from './config.ts';
import { all, one, run } from './db.ts';
import { buildInlineResults } from './inline.ts';
import { describeTelegramError, logTelegramError } from './logging.ts';
import {
  buildChangeMessage,
  buildChatAddedMessage,
  buildRemindMessage,
  changeAudience,
  type ExpenseSnap,
} from './notify.ts';
import { accessRequestInfo, decideRequest, grantBeta, pendingRequests } from './receipts/access.ts';
import { grantReceipts, revokeReceipts, setBudgetNotifier } from './receipts/limits.ts';
import {
  type ExpenseRow,
  type GroupRow,
  groupBalanceSnapshot,
  groupsForUser,
  inlineGroupsForUser,
  upsertUser,
} from './repo.ts';
import type { SHARE_TARGETS } from './shareCard.ts';
import { buildStatsReport, canSeeStats, collectStats, countEventSafe } from './stats.ts';

export const bot = config.botToken
  ? new Bot(config.botToken, {
      client: {
        timeoutSeconds: config.telegramTimeoutSec,
        ...(config.telegramApiRoot && { apiRoot: config.telegramApiRoot }),
      },
    })
  : null;
let botUsername = '';
/** True only after bot.init() succeeded; until then everything behaves as if the bot isn't configured. */
let botReady = false;

type SharePermissions = typeof SHARE_TARGETS;

export type ChatMemberLookup = (chatId: number, userId: number) => Promise<string>;

export type PrepareShare = (userId: number, result: InlineQueryResult, targets: SharePermissions) => Promise<string>;

/** A private message to a user (access requests and their results). Tests capture these instead of calling Telegram. */
export type SendMessage = (userId: number, text: string, extra?: { reply_markup?: InlineKeyboard }) => Promise<unknown>;

export type PrepareChatButton = (userId: number, requestId: number, lang: Lang) => Promise<string>;

let chatMemberLookup: ChatMemberLookup | null = null;
let prepareShareHook: PrepareShare | null = null;
let prepareChatButtonHook: PrepareChatButton | null = null;
let sendMessageHook: SendMessage | null = null;

/**
 * Tests replace the Bot API calls (user's role in a chat, savePreparedInlineMessage, savePreparedKeyboardButton).
 * Call with no argument to reset.
 */
export function setBotTestHooks(
  hooks: {
    chatMember?: ChatMemberLookup;
    prepareShare?: PrepareShare;
    prepareChatButton?: PrepareChatButton;
    sendMessage?: SendMessage;
  } = {},
) {
  sendMessageHook = hooks.sendMessage ?? null;
  chatMemberLookup = hooks.chatMember ?? null;
  prepareShareHook = hooks.prepareShare ?? null;
  prepareChatButtonHook = hooks.prepareChatButton ?? null;
}

/** True when a chat picker can be offered: the bot is up (or tests replaced the call). */
export function canRequestChat(): boolean {
  return Boolean(prepareChatButtonHook) || Boolean(bot && botReady);
}

// Rights the bot asks for when Telegram adds it to the picked chat: the minimum to be an admin at all, plus invites
// (for the "join the group" link). The user must hold the same rights, which also filters out non-admins early.
const BOT_RIGHTS = {
  is_anonymous: false,
  can_manage_chat: true,
  can_delete_messages: false,
  can_manage_video_chats: false,
  can_restrict_members: false,
  can_promote_members: false,
  can_change_info: false,
  can_invite_users: true,
  can_post_stories: false,
  can_edit_stories: false,
  can_delete_stories: false,
  can_send_welcome_messages: false,
};

/**
 * savePreparedKeyboardButton: a «pick a group chat» button for WebApp.requestChat(id). The pick comes back to the bot
 * as chat_shared with `requestId`. Returns null when the bot isn't available. Throws if Telegram refuses.
 */
export async function prepareChatButton(userId: number, requestId: number, lang: Lang): Promise<string | null> {
  if (prepareChatButtonHook) return prepareChatButtonHook(userId, requestId, lang);
  if (!bot || !botReady) return null;
  const button = {
    text: createT(lang)('bot.chatRequestButton'),
    request_chat: {
      request_id: requestId,
      chat_is_channel: false,
      user_administrator_rights: BOT_RIGHTS,
      bot_administrator_rights: BOT_RIGHTS,
      request_title: true,
    },
  };
  return (await bot.api.savePreparedKeyboardButton(userId, button)).id;
}

/** The private-chat reply to a chat_shared attempt. */
export function chatSharedReply(lang: Lang, result: ChatSharedResult, chatTitle: string, botName: string): string {
  const t = createT(lang);
  if (result.ok) return t('bot.chatSharedLinked', { chat: chatTitle, name: result.group.name });
  switch (result.problem) {
    case 'notAdmin':
      return t('bot.chatSharedNotAdmin');
    case 'botMissing':
      return t('bot.chatSharedBotMissing', { bot: botName });
    case 'expired':
      return t('bot.chatSharedExpired');
    case 'unavailable':
      return t('bot.chatSharedUnavailable');
    default:
      return t('bot.chatSharedInvalid');
  }
}

/** True when a card can be prepared for sharing: the bot is up (or tests replaced the call). */
export function canPrepareShare(): boolean {
  return Boolean(prepareShareHook) || Boolean(bot && botReady);
}

/**
 * savePreparedInlineMessage: stores a card that the Mini App sends with WebApp.shareMessage(id). Returns the prepared
 * message id, or null when the bot isn't available. Throws if Telegram refuses.
 */
export async function prepareShare(
  userId: number,
  result: InlineQueryResult,
  targets: SharePermissions,
): Promise<string | null> {
  if (prepareShareHook) return prepareShareHook(userId, result, targets);
  if (!bot || !botReady) return null;
  return (await bot.api.savePreparedInlineMessage(userId, result, targets)).id;
}

/**
 * The user's status in the chat ('creator', 'administrator', 'member', ...), or null when the bot isn't available.
 * Throws if Telegram refuses (the bot was removed from the chat, etc.).
 */
export async function chatMemberStatus(chatId: number, userId: number): Promise<string | null> {
  if (chatMemberLookup) return chatMemberLookup(chatId, userId);
  if (!bot || !botReady) return null;
  return (await bot.api.getChatMember(chatId, userId)).status;
}

const RETRY_DELAYS_SEC = [5, 10, 30, 60];

/** Pause before retry number `attempt` (1-based): 5, 10, 30, 60 s, then every 60 s. */
export function retryDelaySec(attempt: number): number {
  return RETRY_DELAYS_SEC[Math.min(Math.max(attempt, 1), RETRY_DELAYS_SEC.length) - 1];
}

export function appLink(startParam?: string): string | null {
  if (!botReady || !botUsername || !config.appShortName) return null;
  const base = `https://t.me/${botUsername}/${config.appShortName}`;
  return startParam ? `${base}?startapp=${startParam}` : base;
}

/** Starts the bot in the background: retries init() until Telegram answers, never throws and never blocks. */
export function startBot() {
  if (!bot) {
    console.warn('BOT_TOKEN is not set: bot and Telegram auth are disabled');
    return;
  }
  registerBudgetNotifier();
  void connectBot(bot);
}

async function connectBot(b: Bot) {
  for (let attempt = 1; ; attempt++) {
    try {
      // Not b.init(): grammY retries that silently and forever. One getMe per attempt, so failures are logged here.
      b.botInfo = await b.api.getMe();
      break;
    } catch (e) {
      if (e instanceof GrammyError && (e.error_code === 401 || e.error_code === 404)) {
        // Telegram answered and rejected the token: retrying won't help.
        console.error(`Invalid BOT_TOKEN: Telegram says ${e.error_code} ${e.description}. Bot is disabled`);
        return;
      }
      const delay = retryDelaySec(attempt);
      console.warn(`Telegram unavailable (${describeTelegramError(e)}), retrying in ${delay}s (attempt ${attempt})`);
      await new Promise((r) => setTimeout(r, delay * 1000));
    }
  }
  botUsername = b.botInfo.username;
  botReady = true;
  console.log(`Bot @${botUsername} ready`);

  b.command('start', async (ctx) => {
    if (ctx.from) upsertUser(ctx.from, { notify: true });
    countEventSafe('bot.start');
    const t = createT(pickLang(ctx.from?.language_code));
    const keyboard = config.appUrl ? new InlineKeyboard().webApp(t('bot.openApp'), config.appUrl) : undefined;
    await ctx.reply(t('bot.startText'), { reply_markup: keyboard });
  });

  // Flood protection per user: commands and inline queries only; service updates (my_chat_member etc.) pass.
  b.use(async (ctx, next) => {
    const from = ctx.from;
    if (!from) return next();
    if (ctx.inlineQuery) {
      if (checkInline(from.id)) return next();
      await ctx.answerInlineQuery([], { cache_time: 5, is_personal: true }).catch(() => {});
      return;
    }
    const isCommand = ctx.message?.entities?.some((e) => e.type === 'bot_command' && e.offset === 0);
    if (!isCommand) return next();
    const verdict = checkCommand(from.id);
    if (verdict === 'ok') return next();
    if (verdict === 'notice') await ctx.reply(createT(pickLang(from.language_code))('bot.tooMany')).catch(() => {});
  });

  registerChatHandlers(b);

  b.catch((err) => logTelegramError('Bot error', err.error));

  // Menu button and profile don't block polling; failures are only logged.
  void setupBotProfile(b);

  if (config.botPolling) {
    // Not awaited: bot.start() resolves only when polling stops.
    // No allowed_updates: Telegram's default set includes my_chat_member, which chat linking relies on.
    b.start({ drop_pending_updates: true, onStart: () => console.log('Bot polling started') }).catch((e) =>
      logTelegramError('Bot polling stopped', e),
    );
  }
}

const isGroupChat = (type: string) => type === 'group' || type === 'supergroup';

function chatKeyboard(m: ChatMessage) {
  return m.button ? new InlineKeyboard().url(m.button.text, m.button.url) : undefined;
}

/** Group chat events: bot added/removed, chat migrated to a supergroup, /unlink. Registered once, after init. */
function registerChatHandlers(b: Bot) {
  b.on('my_chat_member', async (ctx) => {
    const { chat, new_chat_member: member, from } = ctx.myChatMember;
    if (!isGroupChat(chat.type)) return;
    upsertUser(from);
    if (member.status === 'member' || member.status === 'administrator') {
      // Promotion member -> administrator is not an "add": only react to a fresh arrival.
      const was = ctx.myChatMember.old_chat_member.status;
      if (was === 'member' || was === 'administrator' || was === 'creator') return;
      const token = createChatLink(chat.id, chat.title ?? String(chat.id), from.id);
      const url = appLink(`link_${token}`);
      if (!url) console.warn('APP_SHORT_NAME is not set: the chat link button is not available');
      const msg = welcomeMessage(pickLang(from.language_code), url);
      await ctx.api
        .sendMessage(chat.id, msg.text, { reply_markup: chatKeyboard(msg) })
        .catch((e) => logTelegramError('chat welcome failed', e));
    } else if (member.status === 'left' || member.status === 'kicked') {
      unlinkChat(chat.id, from.id);
    }
  });

  // The user picked a chat in the Mini App picker (WebApp.requestChat): the bot gets it in the private chat.
  b.on('message:chat_shared', async (ctx) => {
    if (ctx.chat.type !== 'private' || !ctx.from) return;
    upsertUser(ctx.from);
    const shared = ctx.message.chat_shared;
    const lang = pickLang(ctx.from.language_code);
    const title = shared.title?.trim() || String(shared.chat_id);
    const result = await handleChatShared(
      { userId: ctx.from.id, botId: b.botInfo.id, requestId: shared.request_id, chatId: shared.chat_id, title },
      chatMemberStatus,
    );
    await ctx
      .reply(chatSharedReply(lang, result, title, botUsername), { reply_markup: { remove_keyboard: true } })
      .catch((e) => logTelegramError('chat_shared reply failed', e));
    if (result.ok) notifyChatLinked(shared.chat_id, result.group, lang);
  });

  b.on('message:migrate_to_chat_id', (ctx) => {
    migrateChat(ctx.chat.id, ctx.message.migrate_to_chat_id);
  });

  b.command('help', async (ctx) => {
    const lang = pickLang(ctx.from?.language_code);
    await ctx.reply(helpText(lang, isGroupChat(ctx.chat.type), botUsername));
  });

  b.command('balance', async (ctx) => {
    if (!ctx.from) return;
    upsertUser(ctx.from);
    const lang = pickLang(ctx.from.language_code);
    const t = createT(lang);
    const html = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };
    if (ctx.chat.type === 'private') {
      const groups = groupsForUser(ctx.from.id).filter((g) => !g.archived && !g.isDemo);
      const keyboard = config.appUrl ? new InlineKeyboard().webApp(t('bot.openApp'), config.appUrl) : undefined;
      await ctx.reply(privateBalanceText(lang, groups), { ...html, reply_markup: keyboard });
      return;
    }
    if (!isGroupChat(ctx.chat.type)) return;
    const chat: { id: number; title?: string } = ctx.chat;
    const group = groupOfChat(chat.id);
    if (!group) {
      const token = createChatLink(chat.id, chat.title ?? String(chat.id), ctx.from.id);
      const url = appLink(`link_${token}`);
      const text = t(url ? 'bot.balanceUnlinked' : 'bot.balanceUnlinkedNoButton');
      await ctx.reply(text, { reply_markup: url ? new InlineKeyboard().url(t('bot.chatLinkButton'), url) : undefined });
      return;
    }
    const snap = groupBalanceSnapshot(group);
    const names = new Map(snap.members.map((m) => [m.id, m.name]));
    const text = balanceText(lang, {
      groupName: group.name,
      currency: group.currency,
      totalSpent: snap.totalSpent,
      members: snap.members,
      settlements: snap.settlements.map((s) => ({
        from: names.get(s.from) ?? '',
        to: names.get(s.to) ?? '',
        amount: s.amount,
      })),
    });
    const url = appLink(group.invite_code);
    await ctx.reply(text, {
      ...html,
      reply_markup: url ? new InlineKeyboard().url(t('bot.openGroup'), url) : undefined,
    });
  });

  b.on('inline_query', async (ctx) => {
    const from = ctx.inlineQuery.from;
    upsertUser(from);
    countEventSafe('inline.query');
    const results = buildInlineResults(
      pickLang(from.language_code),
      inlineGroupsForUser(from.id),
      ctx.inlineQuery.query,
      {
        groupLink: (code) => appLink(startParamFor(code, 'card')),
        botLink: botUsername ? `https://t.me/${botUsername}` : null,
      },
    );
    await ctx.answerInlineQuery(results, { cache_time: 10, is_personal: true });
  });

  // Owner only, private chat only. Everyone else gets no reply at all, so the command stays invisible.
  b.command('stats', async (ctx) => {
    if (!canSeeStats(ctx.from?.id, ctx.chat.type)) return;
    await ctx.reply(buildStatsReport(pickLang(ctx.from?.language_code), collectStats()));
  });

  // Owner only, private chat only, silent for everyone else (like /stats): give or take back receipt rights.
  for (const command of ['grant', 'revoke', 'beta'] as const) {
    b.command(command, async (ctx) => {
      const reply = ownerCommandReply(
        command,
        ctx.match,
        ctx.from?.id,
        ctx.chat.type,
        pickLang(ctx.from?.language_code),
      );
      if (reply !== null) await ctx.reply(reply);
    });
  }

  b.command('requests', async (ctx) => {
    const reply = requestsReply(ctx.from?.id, ctx.chat.type, pickLang(ctx.from?.language_code));
    if (reply !== null) await ctx.reply(reply);
  });

  // The owner's buttons under an access request: ✅ / ❌.
  b.callbackQuery(/^rb:[ar]:\d+$/, async (ctx) => {
    await handleAccessCallback(ctx.callbackQuery.data, ctx.from, {
      answer: (text) => ctx.answerCallbackQuery(text ? { text, show_alert: true } : undefined),
      edit: (text) => ctx.editMessageText(text),
    });
  });

  b.command('unlink', async (ctx) => {
    if (!ctx.from || !isGroupChat(ctx.chat.type)) return;
    const t = createT(pickLang(ctx.from.language_code));
    const who = await ctx.getChatMember(ctx.from.id).catch(() => null);
    if (!who || (who.status !== 'creator' && who.status !== 'administrator')) {
      await ctx.reply(t('bot.chatAdminOnly'));
      return;
    }
    upsertUser(ctx.from);
    const group = unlinkChat(ctx.chat.id, ctx.from.id);
    await ctx.reply(t(group ? 'bot.chatUnlinked' : 'bot.chatNotLinked'));
  });
}

/**
 * /grant <inviteCode> [days] and /revoke <inviteCode>. Returns the reply text, or null when the sender is not the owner
 * in a private chat (the command stays invisible to everyone else).
 */
export function ownerCommandReply(
  command: 'grant' | 'revoke' | 'beta',
  args: string,
  userId: number | undefined,
  chatType: string,
  lang: Lang,
  admins: Set<number> = config.adminUserIds,
): string | null {
  if (!canSeeStats(userId, chatType, admins) || userId === undefined) return null;
  const t = createT(lang);
  const [code, daysRaw, ...rest] = args.trim().split(/\s+/);
  if (command === 'beta') {
    if (!code || daysRaw !== undefined) return t('bot.betaUsage');
    const g = grantBeta(code, userId);
    return g ? t('bot.betaDone', { name: g.name }) : t('bot.grantNotFound');
  }
  if (command === 'revoke') {
    if (!code || daysRaw !== undefined) return t('bot.revokeUsage');
    const g = revokeReceipts(code);
    return g ? t('bot.revokeDone', { name: g.name }) : t('bot.grantNotFound');
  }
  const days = daysRaw === undefined ? null : Number(daysRaw);
  if (!code || rest.length > 0 || (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 3650))) {
    return t('bot.grantUsage');
  }
  const g = grantReceipts(code, days, userId);
  if (!g) return t('bot.grantNotFound');
  const until = g.expiresAt === null ? t('bot.grantForever') : t('bot.grantUntil', { date: g.expiresAt.slice(0, 10) });
  return t('bot.grantDone', { name: g.name, until });
}

/** /requests: pending access requests for the owner; null (silence) for everyone else. */
export function requestsReply(
  userId: number | undefined,
  chatType: string,
  lang: Lang,
  admins: Set<number> = config.adminUserIds,
): string | null {
  if (!canSeeStats(userId, chatType, admins)) return null;
  const t = createT(lang);
  const list = pendingRequests();
  if (list.length === 0) return t('bot.requestsEmpty');
  const lines = list.map((r) =>
    t('bot.requestsLine', {
      group: r.groupName,
      who: requesterLabel(r.requesterName, r.requestedBy),
      members: r.members,
      expenses: r.expenses,
      code: r.inviteCode,
    }),
  );
  return `${t('bot.requestsTitle')}\n\n${lines.join('\n\n')}`;
}

/** True when a private message can go out now: the bot is up (or tests replaced the call). */
export function canDm(): boolean {
  return Boolean(sendMessageHook) || Boolean(bot && botReady);
}

const requesterLabel = (name: string, id: number) => name || `id ${id}`;

/** A private message that never throws: the person may have blocked the bot. */
export async function dm(userId: number, text: string, extra?: { reply_markup?: InlineKeyboard }) {
  try {
    if (sendMessageHook) await sendMessageHook(userId, text, extra);
    else if (bot && botReady) await bot.api.sendMessage(userId, text, extra);
  } catch (e) {
    logTelegramError('direct message failed', e);
  }
}

const userLang = (userId: number) =>
  pickLang(one<{ lang: string | null }>('SELECT lang FROM users WHERE id = ?', userId)?.lang);

/** Text of the owner's message about a request (without the outcome line). */
function accessRequestText(t: ReturnType<typeof createT>, r: NonNullable<ReturnType<typeof accessRequestInfo>>) {
  return t('bot.accessRequest', {
    group: r.groupName,
    who: requesterLabel(r.requesterName, r.requestedBy),
    members: r.members,
    expenses: r.expenses,
    code: r.inviteCode,
  });
}

/** A group asked for receipt scanning: tell every owner, with ✅ / ❌ buttons. Fire-and-forget. */
export function notifyAccessRequest(requestId: number) {
  if (config.adminUserIds.size === 0) {
    console.warn(`Receipt access request #${requestId} saved, but ADMIN_USER_IDS is empty: nobody was told`);
    return;
  }
  if (!sendMessageHook && !(bot && botReady)) return;
  const r = accessRequestInfo(requestId);
  if (!r) return;
  for (const id of config.adminUserIds) {
    const t = createT(userLang(id));
    // Short callback data (Telegram allows 64 bytes): rb:a:<id> approves, rb:r:<id> rejects.
    const keyboard = new InlineKeyboard()
      .text(t('bot.accessApprove'), `rb:a:${r.id}`)
      .text(t('bot.accessReject'), `rb:r:${r.id}`);
    void dm(id, accessRequestText(t, r), { reply_markup: keyboard });
  }
}

export interface AccessCallbackIo {
  /** answerCallbackQuery; with text it is shown as an alert. */
  answer: (text?: string) => Promise<unknown>;
  /** Replaces the text of the owner's message (and drops the buttons). */
  edit: (text: string) => Promise<unknown>;
}

/**
 * The owner pressed ✅ / ❌ (callback data `rb:a:<id>` / `rb:r:<id>`). Anyone else gets an error and nothing changes.
 * After the decision the owner's message shows the outcome and the person who asked is told in their language.
 */
export async function handleAccessCallback(
  data: string,
  from: { id: number; first_name?: string; username?: string; language_code?: string },
  io: AccessCallbackIo,
  admins: Set<number> = config.adminUserIds,
) {
  const swallow = (e: unknown) => logTelegramError('access callback failed', e);
  const t = createT(pickLang(from.language_code));
  const m = /^rb:([ar]):(\d+)$/.exec(data);
  if (!m) return void (await io.answer().catch(swallow));
  if (!admins.has(from.id)) return void (await io.answer(t('bot.accessNotAdmin')).catch(swallow));
  const approve = m[1] === 'a';
  const decision = decideRequest(Number(m[2]), approve, from.id);
  const status = (s: string) => t(s === 'approved' ? 'bot.accessStatusApproved' : 'bot.accessStatusRejected');
  if (!decision.ok) {
    if (decision.reason === 'notFound') return void (await io.answer(t('bot.accessGone')).catch(swallow));
    await io.answer(t('bot.accessAlready', { result: status(decision.status ?? '') })).catch(swallow);
    return;
  }
  const info = decision.info;
  const admin = from.first_name || (from.username ? `@${from.username}` : `id ${from.id}`);
  const result = t('bot.accessDecidedBy', { result: `${approve ? '✅' : '❌'} ${status(info.status)}`, admin });
  await io.edit(`${accessRequestText(t, info)}\n\n${result}`).catch(swallow);
  await io.answer().catch(swallow);
  const rt = createT(userLang(info.requestedBy));
  await dm(
    info.requestedBy,
    rt(approve ? 'bot.accessUserApproved' : 'bot.accessUserRejected', { group: info.groupName }),
  );
}

/** After a successful link: confirmation in the chat in the linking user's language. Fire-and-forget. */
export function notifyChatLinked(chatId: number, group: GroupRow, lang: Lang) {
  if (!bot || !botReady || group.is_demo) return;
  const msg = linkedMessage(lang, group.name, appLink(group.invite_code));
  bot.api
    .sendMessage(chatId, msg.text, { reply_markup: chatKeyboard(msg) })
    .catch((e) => logTelegramError('chat link confirmation failed', e));
}

async function setupBotProfile(b: Bot) {
  if (config.appUrl) {
    // The menu button text can't be localized per language, so it carries the brand name.
    await b.api
      .setChatMenuButton({
        menu_button: { type: 'web_app', text: createT('ru')('common.brand'), web_app: { url: config.appUrl } },
      })
      .catch((e) => logTelegramError('setChatMenuButton failed', e));
  }
  await setBotProfile();
  await setBotCommands(b);
}

/** Command menu per scope and language; no code = default for every other language. Best-effort. */
async function setBotCommands(b: Bot) {
  const variants: [lang: Lang, code?: 'ru' | 'en'][] = [['ru', 'ru'], ['en', 'en'], ['en']];
  for (const [lang, language_code] of variants) {
    const t = createT(lang);
    const lists = [
      {
        type: 'all_private_chats' as const,
        commands: [
          { command: 'start', description: t('bot.commandStart') },
          { command: 'help', description: t('bot.commandHelp') },
          { command: 'balance', description: t('bot.commandBalance') },
        ],
      },
      {
        type: 'all_group_chats' as const,
        commands: [
          { command: 'balance', description: t('bot.commandBalance') },
          { command: 'help', description: t('bot.commandHelp') },
          { command: 'unlink', description: t('bot.commandUnlink') },
        ],
      },
    ];
    for (const { type, commands } of lists) {
      await b.api
        .setMyCommands(commands, { scope: { type }, ...(language_code && { language_code }) })
        .catch((e) => logTelegramError('setMyCommands failed', e));
    }
  }
}

/** Bot description and short description in both languages; no code = default for every other language. */
async function setBotProfile() {
  if (!bot || !botReady) return;
  const variants: [lang: Lang, code?: 'ru' | 'en'][] = [['ru', 'ru'], ['en', 'en'], ['en']];
  for (const [lang, language_code] of variants) {
    const t = createT(lang);
    const opts = language_code ? { language_code } : {};
    await bot.api
      .setMyDescription(t('bot.description'), opts)
      .catch((e) => logTelegramError('setMyDescription failed', e));
    await bot.api
      .setMyShortDescription(t('bot.shortDescription'), opts)
      .catch((e) => logTelegramError('setMyShortDescription failed', e));
  }
}

async function send(userId: number, text: string, group: GroupRow, lang: Lang) {
  if (!bot || !botReady || group.is_demo) return;
  const link = appLink(group.invite_code);
  const reply_markup = link ? new InlineKeyboard().url(createT(lang)('bot.openGroup'), link) : undefined;
  try {
    await bot.api.sendMessage(userId, text, {
      parse_mode: 'HTML',
      reply_markup,
      link_preview_options: { is_disabled: true },
    });
  } catch (e) {
    // 403: user blocked the bot or never started it. Stop trying until they allow it again.
    if (e instanceof GrammyError && e.error_code === 403) run('UPDATE users SET notify = 0 WHERE id = ?', userId);
    else logTelegramError('sendMessage failed', e);
  }
}

/** Sends a CSV file to the user's private chat. Returns false when the bot can't write to them (not configured, blocked, never started). */
export async function sendExportFile(userId: number, csv: string, fileName: string, caption: string) {
  if (!bot || !botReady) return false;
  try {
    await bot.api.sendDocument(userId, new InputFile(Buffer.from(csv, 'utf8'), fileName), { caption });
    return true;
  } catch (e) {
    if (e instanceof GrammyError && e.error_code === 403) {
      run('UPDATE users SET notify = 0 WHERE id = ?', userId);
      return false;
    }
    throw e;
  }
}

/** Telegram says the bot can no longer write to this chat (removed, kicked, lost the right to send). */
export function isChatGone(e: unknown): boolean {
  if (!(e instanceof GrammyError)) return false;
  if (e.error_code === 403) return true;
  return (
    e.error_code === 400 &&
    /chat not found|bot was kicked|not enough rights|have no rights|CHAT_WRITE_FORBIDDEN/i.test(e.description)
  );
}

/**
 * Posts a message to the group's linked chat. Resolves true when it went out. If the chat is gone the group is
 * unlinked; if it became a supergroup the link moves to the new id. Never throws.
 */
export async function sendToChat(group: GroupRow, text: string, button?: ChatMessage['button']): Promise<boolean> {
  if (!bot || !botReady || group.chat_id === null) return false;
  try {
    await bot.api.sendMessage(group.chat_id, text, {
      parse_mode: 'HTML',
      reply_markup: button ? new InlineKeyboard().url(button.text, button.url) : undefined,
      link_preview_options: { is_disabled: true },
    });
    return true;
  } catch (e) {
    const moved = e instanceof GrammyError ? e.parameters?.migrate_to_chat_id : undefined;
    if (moved) migrateChat(group.chat_id, moved);
    else if (isChatGone(e)) unlinkChat(group.chat_id, group.created_by);
    else logTelegramError('chat post failed', e);
    return false;
  }
}

/** Posts to the linked chat in "each" mode, in the author's language. Fire-and-forget. */
function postEach(
  group: GroupRow,
  authorUserId: number,
  build: (lang: Lang, names: Map<number, string>) => string | null,
) {
  if (group.is_demo || group.chat_id === null || group.chat_feed !== 'each') return;
  try {
    const lang = pickLang(one<{ lang: string | null }>('SELECT lang FROM users WHERE id = ?', authorUserId)?.lang);
    const names = new Map(
      all<{ id: number; name: string }>('SELECT id, name FROM members WHERE group_id = ?', group.id).map((m) => [
        m.id,
        m.name,
      ]),
    );
    const text = build(lang, names);
    if (!text) return;
    const url = appLink(group.invite_code);
    void sendToChat(group, text, url ? { text: createT(lang)('bot.openGroup'), url } : undefined);
  } catch (e) {
    logTelegramError('chat feed failed', e);
  }
}

/** Tells everyone involved in an expense (except the author) that it was added. Fire-and-forget. */
export function notifyExpense(group: GroupRow, expense: ExpenseRow, authorUserId: number, authorName: string) {
  if (!bot || !botReady || group.is_demo) return;
  const snap = loadExpenseSnap(expense.id);
  if (snap) {
    postEach(group, authorUserId, (lang, memberNames) =>
      buildChatAddedMessage({ lang, currency: group.currency, authorName, expense: snap, memberNames }),
    );
  }
  const recipients = all<{ user_id: number; member_id: number; share: number | null; lang: string | null }>(
    `SELECT m.user_id, m.id AS member_id, s.amount AS share, u.lang
     FROM members m
     JOIN users u ON u.id = m.user_id AND u.notify = 1
     LEFT JOIN expense_shares s ON s.member_id = m.id AND s.expense_id = ?
     WHERE m.group_id = ? AND m.user_id != ? AND (s.member_id IS NOT NULL OR m.id = ?)`,
    expense.id,
    group.id,
    authorUserId,
    expense.payer_id,
  );
  for (const r of recipients) {
    // Rendered in the recipient's language, not the author's. Values are HTML-escaped; tags stay out of the dictionary.
    const lang = pickLang(r.lang);
    const t = createT(lang);
    const money = (v: number) => formatMoney(v, group.currency, lang);
    const author = esc(authorName);
    let text: string;
    if (expense.kind === 'transfer') {
      const key = r.member_id === expense.payer_id ? 'bot.transferFromYou' : 'bot.transferToYou';
      text = `💸 <b>${esc(group.name)}</b>\n${t(key, { author, amount: money(expense.amount) })}`;
    } else {
      const title = esc(expense.title);
      text = `🧾 <b>${esc(group.name)}</b>\n${t('bot.expenseAdded', { author, title, amount: money(expense.amount) })}`;
      if (r.share) text += `\n${t('bot.yourShare', { amount: money(r.share) })}`;
    }
    void send(r.user_id, text, group, lang);
  }
}

/** Reads an expense with its shares for change notifications. */
export function loadExpenseSnap(expenseId: number): ExpenseSnap | null {
  const e = one<ExpenseRow>('SELECT * FROM expenses WHERE id = ?', expenseId);
  if (!e) return null;
  const shares = all<{ member_id: number; amount: number }>(
    'SELECT member_id, amount FROM expense_shares WHERE expense_id = ?',
    expenseId,
  );
  return {
    kind: e.kind,
    title: e.title,
    amount: e.amount,
    payerId: e.payer_id,
    spentOn: e.spent_on,
    shares: shares.map((s) => ({ memberId: s.member_id, amount: s.amount })),
  };
}

/** Tells participants of the old and new version (except the author) about an edit or deletion. Fire-and-forget. */
export function notifyExpenseChange(
  group: GroupRow,
  before: ExpenseSnap,
  after: ExpenseSnap | null,
  authorUserId: number,
  authorName: string,
) {
  if (!bot || !botReady || group.is_demo) return;
  postEach(group, authorUserId, (lang, memberNames) =>
    buildChangeMessage({
      before,
      after,
      recipientMemberId: -1,
      lang,
      currency: group.currency,
      groupName: group.name,
      authorName,
      memberNames,
      forChat: true,
    }),
  );
  try {
    const memberNames = new Map(
      all<{ id: number; name: string }>('SELECT id, name FROM members WHERE group_id = ?', group.id).map((m) => [
        m.id,
        m.name,
      ]),
    );
    const audience = new Set(changeAudience(before, after));
    const recipients = all<{ user_id: number; member_id: number; lang: string | null }>(
      `SELECT m.user_id, m.id AS member_id, u.lang
       FROM members m JOIN users u ON u.id = m.user_id AND u.notify = 1
       WHERE m.group_id = ? AND m.user_id != ?`,
      group.id,
      authorUserId,
    ).filter((r) => audience.has(r.member_id));
    for (const r of recipients) {
      const lang = pickLang(r.lang);
      const text = buildChangeMessage({
        before,
        after,
        recipientMemberId: r.member_id,
        lang,
        currency: group.currency,
        groupName: group.name,
        authorName,
        memberNames,
      });
      if (text) void send(r.user_id, text, group, lang);
    }
  } catch (e) {
    logTelegramError('notifyExpenseChange failed', e);
  }
}

/** Tells a removed member, in their language. No "open group" button: they have no access any more. Fire-and-forget. */
export function notifyMemberRemoved(group: GroupRow, userId: number) {
  if (!bot || !botReady) return;
  const lang = pickLang(one<{ lang: string | null }>('SELECT lang FROM users WHERE id = ?', userId)?.lang);
  const text = createT(lang)('bot.removed', { group: group.name.replace(/&/g, '&amp;').replace(/</g, '&lt;') });
  void bot.api
    .sendMessage(userId, text, { parse_mode: 'HTML' })
    .catch((e) => logTelegramError('notifyMemberRemoved failed', e));
}

/** Sends a debt reminder to the debtor's DM in their language. Fire-and-forget. */
export function notifyRemind(
  group: GroupRow,
  debtorUserId: number,
  creditorName: string,
  amount: number,
  hasPaymentInfo: boolean,
) {
  if (!bot || !botReady || group.is_demo) return;
  const lang = pickLang(one<{ lang: string | null }>('SELECT lang FROM users WHERE id = ?', debtorUserId)?.lang);
  const text = buildRemindMessage({
    lang,
    currency: group.currency,
    groupName: group.name,
    authorName: creditorName,
    amount,
    hasPaymentInfo,
  });
  void send(debtorUserId, text, group, lang);
}

/** Budget thresholds of receipt scanning: tell every owner (ADMIN_USER_IDS), each in their language. */
function registerBudgetNotifier() {
  setBudgetNotifier((kind, spentMicro, capMicro) => {
    if (!bot || !botReady) return;
    const usd = (micro: number) => (micro / 1_000_000).toFixed(2);
    for (const id of config.adminUserIds) {
      const lang = pickLang(one<{ lang: string | null }>('SELECT lang FROM users WHERE id = ?', id)?.lang);
      const t = createT(lang);
      const text = t(kind === 'warn' ? 'bot.budgetWarn' : 'bot.budgetStop', {
        spent: usd(spentMicro),
        cap: usd(capMicro),
      });
      bot.api.sendMessage(id, text).catch((e) => logTelegramError('receipt budget notice failed', e));
    }
  });
}
