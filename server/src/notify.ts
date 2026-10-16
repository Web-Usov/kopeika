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
  /** Text for the group chat: no group header and no personal wording ("your share"). */
  forChat?: boolean;
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
  const head = (icon: string) => (i.forChat ? `${icon} ` : `${icon} <b>${esc(i.groupName)}</b>\n`);

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
  const sharesKey = (e: ExpenseSnap) =>
    JSON.stringify(e.shares.map((s) => [s.memberId, s.amount]).sort((x, y) => x[0] - y[0]));
  // In the chat nobody is "you": any change of the split counts.
  const shareChanged = i.forChat ? sharesKey(a) !== sharesKey(b) : oldShare !== newShare;
  if (!titleChanged && !amountChanged && !payerChanged && !shareChanged) return null; // at most the date

  // Title only: one short line, no share.
  if (!amountChanged && !payerChanged && !shareChanged) {
    return head('🧾') + t('bot.expenseRenamed', { author, from: esc(a.title), to: esc(b.title) });
  }

  const changes: string[] = [];
  if (titleChanged) changes.push(t('bot.changeTitle', { from: esc(a.title), to: esc(b.title) }));
  if (amountChanged) changes.push(amountText);
  if (payerChanged) changes.push(t('bot.changePayer', { from: name(a.payerId), to: name(b.payerId) }));
  if (i.forChat && !titleChanged && !amountChanged && !payerChanged) changes.push(t('bot.changeShares'));
  let text = head('🧾') + t('bot.expenseChanged', { author, title: esc(b.title), changes: changes.join('; ') });
  if (i.forChat) return text;
  if (newShare) text += `\n${t('bot.yourShare', { amount: money(newShare) })}`;
  else if (oldShare) text += `\n${t('bot.shareRemoved')}`;
  return text;
}

export interface RemindInput {
  lang: Lang;
  currency: string;
  groupName: string;
  /** Name of the creditor, who pressed "Remind". */
  authorName: string;
  amount: number;
  /** The creditor has payment details to show in the app. */
  hasPaymentInfo: boolean;
}

/** Text of a debt reminder for the debtor, in their language. */
export function buildRemindMessage(i: RemindInput): string {
  const t = createT(i.lang);
  const amount = formatMoney(i.amount, i.currency, i.lang);
  let text = `💰 <b>${esc(i.groupName)}</b>\n${t('bot.remind', { author: esc(i.authorName), amount })}`;
  if (i.hasPaymentInfo) text += `\n${t('bot.remindPayment')}`;
  return text;
}

export interface ChatAddedInput {
  lang: Lang;
  currency: string;
  authorName: string;
  expense: ExpenseSnap;
  memberNames: Map<number, string>;
}

/** Text for the linked chat about a new expense or transfer. Same wording as the personal notification, minus "your share". */
export function buildChatAddedMessage(i: ChatAddedInput): string {
  const t = createT(i.lang);
  const e = i.expense;
  const money = formatMoney(e.amount, i.currency, i.lang);
  const author = esc(i.authorName);
  const name = (id: number | undefined) => esc((id !== undefined && i.memberNames.get(id)) || '');
  if (e.kind === 'transfer') {
    return `💸 ${t('bot.chatTransfer', { author, from: name(e.payerId), to: name(e.shares[0]?.memberId), amount: money })}`;
  }
  let text = `🧾 ${t('bot.expenseAdded', { author, title: esc(e.title), amount: money })}`;
  if (e.shares.length > 1) text += ` (${t('bot.chatSplit', { count: e.shares.length })})`;
  return text;
}
