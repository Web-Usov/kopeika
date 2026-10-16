import { Bot, GrammyError, InlineKeyboard } from 'grammy';
import { formatMoney } from '../../shared/money.ts';
import { config } from './config.ts';
import { all, run } from './db.ts';
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
    const keyboard = config.appUrl ? new InlineKeyboard().webApp('Открыть Копейку', config.appUrl) : undefined;
    await ctx.reply(
      'Привет! Копейка помогает делить общие траты с друзьями: в поездке, на даче или в общей квартире.\n\n' +
        'Создайте группу, пригласите друзей ссылкой и записывайте, кто за что платил. ' +
        'Я посчитаю, кто кому сколько должен, и буду присылать сюда уведомления о новых тратах.',
      { reply_markup: keyboard },
    );
  });

  bot.catch((err) => console.error('Bot error', err.error));

  if (config.appUrl) {
    await bot.api
      .setChatMenuButton({ menu_button: { type: 'web_app', text: 'Копейка', web_app: { url: config.appUrl } } })
      .catch((e) => console.warn('setChatMenuButton failed', e));
  }

  if (config.botPolling) {
    // Not awaited: bot.start() resolves only when polling stops.
    bot
      .start({ drop_pending_updates: true, onStart: () => console.log('Bot polling started') })
      .catch((e) => console.error('Bot polling stopped', e));
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function send(userId: number, text: string, group: GroupRow) {
  if (!bot) return;
  const link = appLink(group.invite_code);
  const reply_markup = link ? new InlineKeyboard().url('Открыть группу', link) : undefined;
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
  const recipients = all<{ user_id: number; member_id: number; share: number | null }>(
    `SELECT m.user_id, m.id AS member_id, s.amount AS share
     FROM members m
     JOIN users u ON u.id = m.user_id AND u.notify = 1
     LEFT JOIN expense_shares s ON s.member_id = m.id AND s.expense_id = ?
     WHERE m.group_id = ? AND m.user_id != ? AND (s.member_id IS NOT NULL OR m.id = ?)`,
    expense.id,
    group.id,
    authorUserId,
    expense.payer_id,
  );
  const money = (v: number) => formatMoney(v, group.currency);
  for (const r of recipients) {
    let text: string;
    if (expense.kind === 'transfer') {
      text =
        r.member_id === expense.payer_id
          ? `💸 <b>${esc(group.name)}</b>\n${esc(authorName)} записал(а) ваш перевод на ${money(expense.amount)}`
          : `💸 <b>${esc(group.name)}</b>\n${esc(authorName)} отметил(а) перевод вам: ${money(expense.amount)}`;
    } else {
      text = `🧾 <b>${esc(group.name)}</b>\n${esc(authorName)} добавил(а) «${esc(expense.title)}» на ${money(expense.amount)}`;
      if (r.share) text += `\nВаша доля: ${money(r.share)}`;
    }
    void send(r.user_id, text, group);
  }
}
