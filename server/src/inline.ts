import type { InlineQueryResultArticle } from 'grammy/types';
import { createT, type Lang } from '../../shared/i18n/index.ts';
import { formatMoney } from '../../shared/money.ts';
import { balanceText } from './chatText.ts';

/** Telegram allows up to 50; a short list is easier to pick from. */
export const MAX_INLINE_RESULTS = 20;

export interface InlineGroup {
  id: number;
  name: string;
  currency: string;
  inviteCode: string;
  /** Loaded only for groups that made it into the answer. */
  snapshot: () => {
    totalSpent: number;
    myBalance: number;
    members: { id: number; name: string; balance: number }[];
    settlements: { from: number; to: number; amount: number }[];
  };
}

export interface InlineOptions {
  /** Link to open a group (invite for non-members); null when unavailable. */
  groupLink: (inviteCode: string) => string | null;
  /** Link to the bot itself, for the «no groups» card. */
  botLink: string | null;
}

/** Groups matching the query (case-insensitive substring of the name), input order kept, at most 20. */
export function filterGroups<T extends { name: string }>(groups: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return groups.filter((g) => !q || g.name.toLowerCase().includes(q)).slice(0, MAX_INLINE_RESULTS);
}

function urlButton(text: string, url: string | null) {
  return url ? { inline_keyboard: [[{ text, url }]] } : undefined;
}

/** Results for answerInlineQuery: one article per group with the same card as /balance. */
export function buildInlineResults(
  lang: Lang,
  groups: InlineGroup[],
  query: string,
  opts: InlineOptions,
): InlineQueryResultArticle[] {
  const t = createT(lang);
  if (groups.length === 0) {
    return [
      {
        type: 'article',
        id: 'no-groups',
        title: t('bot.inlineEmptyTitle'),
        description: t('bot.inlineEmptyDescription'),
        input_message_content: { message_text: t('bot.balancePrivateEmpty') },
        reply_markup: urlButton(t('bot.inlineOpenBot'), opts.botLink),
      },
    ];
  }
  return filterGroups(groups, query).map((g) => {
    const snap = g.snapshot();
    const names = new Map(snap.members.map((m) => [m.id, m.name]));
    const text = balanceText(lang, {
      groupName: g.name,
      currency: g.currency,
      totalSpent: snap.totalSpent,
      members: snap.members,
      settlements: snap.settlements.map((s) => ({
        from: names.get(s.from) ?? '',
        to: names.get(s.to) ?? '',
        amount: s.amount,
      })),
    });
    const total = formatMoney(snap.totalSpent, g.currency, lang);
    const mine =
      snap.myBalance === 0
        ? t('bot.inlineMineSettled')
        : t('bot.inlineMine', {
            amount: (snap.myBalance > 0 ? '+' : '') + formatMoney(snap.myBalance, g.currency, lang),
          });
    return {
      type: 'article' as const,
      id: String(g.id),
      title: g.name,
      description: t('bot.inlineDescription', { total, mine }),
      input_message_content: {
        message_text: text,
        parse_mode: 'HTML' as const,
        link_preview_options: { is_disabled: true },
      },
      reply_markup: urlButton(t('bot.openGroup'), opts.groupLink(g.inviteCode)),
    };
  });
}
