import { Bot, GrammyError, InlineKeyboard, InputFile } from 'grammy';
import { createT, type Lang, pickLang } from '../../shared/i18n/index.ts';
import { formatMoney } from '../../shared/money.ts';
import { config } from './config.ts';
import { all, one, run } from './db.ts';
import { buildChangeMessage, buildRemindMessage, changeAudience, type ExpenseSnap } from './notify.ts';
import { type ExpenseRow, type GroupRow, upsertUser } from './repo.ts';

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
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`Telegram unavailable (${msg}), retrying in ${delay}s (attempt ${attempt})`);
      await new Promise((r) => setTimeout(r, delay * 1000));
    }
  }
  botUsername = b.botInfo.username;
  botReady = true;
  console.log(`Bot @${botUsername} ready`);

  b.command('start', async (ctx) => {
    if (ctx.from) upsertUser(ctx.from, { notify: true });
    const t = createT(pickLang(ctx.from?.language_code));
    const keyboard = config.appUrl ? new InlineKeyboard().webApp(t('bot.openApp'), config.appUrl) : undefined;
    await ctx.reply(t('bot.startText'), { reply_markup: keyboard });
  });

  b.catch((err) => console.error('Bot error', err.error));

  // Menu button and profile don't block polling; failures are only logged.
  void setupBotProfile(b);

  if (config.botPolling) {
    // Not awaited: bot.start() resolves only when polling stops.
    b.start({ drop_pending_updates: true, onStart: () => console.log('Bot polling started') }).catch((e) =>
      console.error('Bot polling stopped', e),
    );
  }
}

async function setupBotProfile(b: Bot) {
  if (config.appUrl) {
    // The menu button text can't be localized per language, so it carries the brand name.
    await b.api
      .setChatMenuButton({
        menu_button: { type: 'web_app', text: createT('ru')('common.brand'), web_app: { url: config.appUrl } },
      })
      .catch((e) => console.warn('setChatMenuButton failed', e instanceof Error ? e.message : e));
  }
  await setBotProfile();
}

/** Bot description and short description in both languages; no code = default for every other language. */
async function setBotProfile() {
  if (!bot || !botReady) return;
  const variants: [lang: Lang, code?: 'ru' | 'en'][] = [['ru', 'ru'], ['en', 'en'], ['en']];
  for (const [lang, language_code] of variants) {
    const t = createT(lang);
    const opts = language_code ? { language_code } : {};
    await bot.api.setMyDescription(t('bot.description'), opts).catch((e) => console.warn('setMyDescription failed', e));
    await bot.api
      .setMyShortDescription(t('bot.shortDescription'), opts)
      .catch((e) => console.warn('setMyShortDescription failed', e));
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function send(userId: number, text: string, group: GroupRow, lang: Lang) {
  if (!bot || !botReady) return;
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
    else console.warn('sendMessage failed', e);
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

/** Tells everyone involved in an expense (except the author) that it was added. Fire-and-forget. */
export function notifyExpense(group: GroupRow, expense: ExpenseRow, authorUserId: number, authorName: string) {
  if (!bot || !botReady) return;
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
  if (!bot || !botReady) return;
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
    console.warn('notifyExpenseChange failed', e);
  }
}

/** Sends a debt reminder to the debtor's DM in their language. Fire-and-forget. */
export function notifyRemind(
  group: GroupRow,
  debtorUserId: number,
  creditorName: string,
  amount: number,
  hasPaymentInfo: boolean,
) {
  if (!bot || !botReady) return;
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
