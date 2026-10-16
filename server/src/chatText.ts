import { createT, type Lang } from '../../shared/i18n/index.ts';
import { formatMoney } from '../../shared/money.ts';

/** Longest list shown in a chat message; the rest is collapsed into «и ещё N». */
export const MAX_LINES = 15;
/** Most groups listed in a private /balance. */
export const MAX_GROUPS = 10;

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface BalanceMember {
  name: string;
  balance: number;
}

export interface BalanceSettlement {
  from: string;
  to: string;
  amount: number;
}

export interface BalanceInput {
  groupName: string;
  currency: string;
  totalSpent: number;
  members: BalanceMember[];
  settlements: BalanceSettlement[];
}

function limited(lines: string[], lang: Lang, max = MAX_LINES): string[] {
  if (lines.length <= max) return lines;
  const t = createT(lang);
  return [...lines.slice(0, max), t('bot.balanceMore', { count: lines.length - max })];
}

const signed = (v: number, currency: string, lang: Lang) => (v > 0 ? '+' : '') + formatMoney(v, currency, lang);

/** Group balance for a chat: total, non-zero balances (biggest first), settlement plan. HTML-escaped. */
export function balanceText(lang: Lang, g: BalanceInput): string {
  const t = createT(lang);
  const money = (v: number) => formatMoney(v, g.currency, lang);
  const head = `💰 <b>${esc(g.groupName)}</b>\n${t('bot.balanceTitle', { total: money(g.totalSpent) })}`;
  const nonZero = g.members
    .filter((m) => m.balance !== 0)
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  if (nonZero.length === 0) return `${head}\n\n${t('bot.balanceSettled')}`;
  const balances = limited(
    nonZero.map((m) => `${esc(m.name)}: ${signed(m.balance, g.currency, lang)}`),
    lang,
  );
  const settle = limited(
    g.settlements.map((s) => t('bot.balanceSettleLine', { from: esc(s.from), to: esc(s.to), amount: money(s.amount) })),
    lang,
  );
  return [
    head,
    `<b>${t('bot.balanceMembers')}</b>\n${balances.join('\n')}`,
    `<b>${t('bot.balanceSettle')}</b>\n${settle.join('\n')}`,
  ].join('\n\n');
}

export interface PrivateBalanceGroup {
  name: string;
  currency: string;
  myBalance: number;
}

/** /balance in a private chat: the user's own balance in each group (at most 10). */
export function privateBalanceText(lang: Lang, groups: PrivateBalanceGroup[]): string {
  const t = createT(lang);
  if (groups.length === 0) return t('bot.balancePrivateEmpty');
  const lines = groups.map((g) => {
    const v = g.myBalance === 0 ? t('bot.balancePrivateSettled') : signed(g.myBalance, g.currency, lang);
    return `${esc(g.name)}: ${v}`;
  });
  return `<b>${t('bot.balancePrivateTitle')}</b>\n${limited(lines, lang, MAX_GROUPS).join('\n')}`;
}

export function helpText(lang: Lang, isGroup: boolean): string {
  return createT(lang)(isGroup ? 'bot.helpGroup' : 'bot.helpPrivate');
}
