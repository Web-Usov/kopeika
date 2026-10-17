import type { InlineQueryResultArticle } from 'grammy/types';
import { createT, type Lang } from '../../shared/i18n/index.ts';
import { balanceText } from './chatText.ts';

export type ShareKind = 'balance' | 'summary';

export interface ShareBalanceData {
  groupName: string;
  currency: string;
  totalSpent: number;
  members: { id: number; name: string; balance: number }[];
  settlements: { from: number; to: number; amount: number }[];
}

/** Where a prepared card may be sent: personal and group chats, not bots and channels. */
export const SHARE_TARGETS = {
  allow_user_chats: true,
  allow_bot_chats: false,
  allow_group_chats: true,
  allow_channel_chats: false,
} as const;

/** Balance card: exactly the text of /balance and inline mode (HTML). */
export function balanceShareText(lang: Lang, d: ShareBalanceData): string {
  const names = new Map(d.members.map((m) => [m.id, m.name]));
  return balanceText(lang, {
    groupName: d.groupName,
    currency: d.currency,
    totalSpent: d.totalSpent,
    members: d.members,
    settlements: d.settlements.map((s) => ({
      from: names.get(s.from) ?? '',
      to: names.get(s.to) ?? '',
      amount: s.amount,
    })),
  });
}

/** Article for savePreparedInlineMessage. `url` is the «Open group» button target (omitted when null). */
export function buildShareResult(
  lang: Lang,
  kind: ShareKind,
  groupName: string,
  text: string,
  url: string | null,
): InlineQueryResultArticle {
  const t = createT(lang);
  return {
    type: 'article',
    id: kind,
    title: groupName,
    input_message_content: {
      message_text: text,
      // The balance card is HTML-escaped; the summary text is plain.
      ...(kind === 'balance' && { parse_mode: 'HTML' as const }),
      link_preview_options: { is_disabled: true },
    },
    reply_markup: url ? { inline_keyboard: [[{ text: t('bot.openGroup'), url }]] } : undefined,
  };
}
