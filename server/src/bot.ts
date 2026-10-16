import { Bot, GrammyError, InlineKeyboard } from 'grammy';
import { createT, type Lang, pickLang } from '../../shared/i18n/index.ts';
import { formatMoney } from '../../shared/money.ts';
import { config } from './config.ts';
import { all, one, run } from './db.ts';
import { buildChangeMessage, changeAudience, type ExpenseSnap } from './notify.ts';
import { type ExpenseRow, type GroupRow, upsertUser } from './repo.ts';

export const bot = config.botToken ? new Bot(config.botToken) : null;
let botUsername = '';

export function appLink(startParam?: string): string | null {
  if (!botUsername || !config.appShortName) return null;
  const base = `https://t.me/${botUsername}/${config.appShortName}`;
  return startParam ? `${base}?startapp=${startParam}` : base;
}

export async function startBot() {
  if (!bot) {
    console.warn('BOT_TOKEN is not set: bot and Telegram auth are disabled');
    return;
  }
  await bot.init();
  botUsername = bot.botInfo.username;
  console.log(`Bot @${botUsername} ready`);

  bot.command('start', async (ctx) => {
    if (ctx.from) upsertUser(ctx.from, { notify: true });
    const t = createT(pickLang(ctx.from?.language_code));
    const keyboard = config.appUrl ? new InlineKeyboard().webApp(t('bot.openApp'), config.appUrl) : undefined;
    await ctx.reply(t('bot.startText'), { reply_markup: keyboard });
  });

  bot.catch((err) => console.error('Bot error', err.error));

  if (config.appUrl) {
    // The menu button text can't be localized per language, so it carries the brand name.
    await bot.api
      .setChatMenuButton({
        menu_button: { type: 'web_app', text: createT('ru')('common.brand'), web_app: { url: config.appUrl } },
      })
      .catch((e) => console.warn('setChatMenuButton failed', e));
  }
  await setBotProfile();

  if (config.botPolling) {
    // Not awaited: bot.start() resolves only when polling stops.
    bot
      .start({ drop_pending_updates: true, onStart: () => console.log('Bot polling started') })
      .catch((e) => console.error('Bot polling stopped', e));
  }
}

/** Bot description and short description in both languages; no code = default for every other language. */
async function setBotProfile() {
  if (!bot) return;
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
  if (!bot) return;
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

/** Tells everyone involved in an expense (except the author) that it was added. Fire-and-forget. */
export function notifyExpense(group: GroupRow, expense: ExpenseRow, authorUserId: number, authorName: string) {
  if (!bot) return;
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
  if (!bot) return;
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
