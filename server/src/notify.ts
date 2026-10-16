import { createT, type Lang } from '../../shared/i18n/index.ts';
import { formatMoney } from '../../shared/money.ts';

/** Expense state as the notification sees it. */
export interface ExpenseSnap {
  kind: 'expense' | 'transfer';
  title: string;
  amount: number;
  payerId: number;
  spentOn: string;
  shares: { memberId: number; amount: number }[];
}

export interface ChangeInput {
  before: ExpenseSnap;
  /** null = the expense was deleted. */
  after: ExpenseSnap | null;
  recipientMemberId: number;
  lang: Lang;
  currency: string;
  groupName: string;
  authorName: string;
  /** Member names by id, for the payer. */
  memberNames: Map<number, string>;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Everyone involved in an expense: the payer and everyone with a share. */
export function participants(e: ExpenseSnap): number[] {
  return [...new Set([e.payerId, ...e.shares.map((s) => s.memberId)])];
}

/** Members to notify about a change: participants of both versions. */
export function changeAudience(before: ExpenseSnap, after: ExpenseSnap | null): number[] {
  return [...new Set([...participants(before), ...(after ? participants(after) : [])])];
}

const shareOf = (e: ExpenseSnap, memberId: number) => e.shares.find((s) => s.memberId === memberId)?.amount ?? 0;

/** Text of a change/delete notification for one recipient, or null when there is nothing worth saying. */
export function buildChangeMessage(i: ChangeInput): string | null {
  const t = createT(i.lang);
  const money = (v: number) => formatMoney(v, i.currency, i.lang);
  const author = esc(i.authorName);
  const { before: a, after: b } = i;
  const name = (id: number) => esc(i.memberNames.get(id) ?? '');
  const head = (icon: string) => `${icon} <b>${esc(i.groupName)}</b>\n`;

  if (!b) {
    if (a.kind === 'transfer') return head('💸') + t('bot.transferDeleted', { author, amount: money(a.amount) });
    return head('🧾') + t('bot.expenseDeleted', { author, title: esc(a.title), amount: money(a.amount) });
  }

  const amountChanged = a.amount !== b.amount;
  const payerChanged = a.payerId !== b.payerId;
  const amountText = amountChanged
    ? t('bot.changeAmount', { from: money(a.amount), to: money(b.amount) })
    : money(b.amount);

  if (b.kind === 'transfer') {
    const receiver = (e: ExpenseSnap) => e.shares[0]?.memberId;
    if (!amountChanged && !payerChanged && receiver(a) === receiver(b)) return null;
    return head('💸') + t('bot.transferChanged', { author, amount: amountText });
  }

  const titleChanged = a.title !== b.title;
  const oldShare = shareOf(a, i.recipientMemberId);
  const newShare = shareOf(b, i.recipientMemberId);
  const shareChanged = oldShare !== newShare;
  if (!titleChanged && !amountChanged && !payerChanged && !shareChanged) return null; // at most the date

  // Title only: one short line, no share.
  if (!amountChanged && !payerChanged && !shareChanged) {
    return head('🧾') + t('bot.expenseRenamed', { author, from: esc(a.title), to: esc(b.title) });
  }

  const changes: string[] = [];
  if (titleChanged) changes.push(t('bot.changeTitle', { from: esc(a.title), to: esc(b.title) }));
  if (amountChanged) changes.push(amountText);
  if (payerChanged) changes.push(t('bot.changePayer', { from: name(a.payerId), to: name(b.payerId) }));
  let text = head('🧾') + t('bot.expenseChanged', { author, title: esc(b.title), changes: changes.join('; ') });
  if (newShare) text += `\n${t('bot.yourShare', { amount: money(newShare) })}`;
  else if (oldShare) text += `\n${t('bot.shareRemoved')}`;
  return text;
}
