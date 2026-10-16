// Group history: entry shape shared by server and client, and a pure function that turns an entry into text
// in the viewer's language. Payloads hold snapshots (names, titles, amounts at that moment), not references.
import { type Lang, t } from './i18n/index.ts';
import { formatMoney } from './money.ts';

export type ActivityAction =
  | 'group.create'
  | 'group.rename'
  | 'member.add'
  | 'member.rename'
  | 'member.delete'
  | 'member.join'
  | 'member.claim'
  | 'member.payment_info'
  | 'member.leave'
  | 'group.archive'
  | 'group.unarchive'
  | 'expense.create'
  | 'expense.update'
  | 'expense.delete'
  | 'debt.remind'
  | 'group.chat_link'
  | 'group.chat_unlink';

export interface PersonRef {
  id: number;
  name: string;
}

/** Snapshot of an expense or transfer (`to` is set for transfers). */
export interface ExpenseSnapshot {
  kind: 'expense' | 'transfer';
  title: string;
  amount: number;
  payer: PersonRef;
  to?: PersonRef;
}

export interface ActivityPayload {
  expenseId?: number;
  memberId?: number;
  name?: string;
  amount?: number;
  from?: string;
  to?: string;
  before?: ExpenseSnapshot;
  after?: ExpenseSnapshot;
  expense?: ExpenseSnapshot;
}

export interface ActivityEntry {
  id: number;
  action: ActivityAction;
  actor: { memberId: number | null; name: string };
  payload: ActivityPayload;
  createdAt: string; // ISO, UTC
}

/** The text of one history line. Amounts are formatted in the group's currency. */
export function activityText(lang: Lang, entry: ActivityEntry, currency: string): string {
  const actor = entry.actor.name;
  const p = entry.payload;
  const money = (n: number) => formatMoney(n, currency, lang);
  switch (entry.action) {
    case 'group.create':
      return t(lang, 'activity.groupCreate', { actor, name: p.name ?? '' });
    case 'group.rename':
      return t(lang, 'activity.groupRename', { actor, from: p.from ?? '', to: p.to ?? '' });
    case 'group.chat_link':
      return t(lang, 'activity.chatLink', { actor, name: p.name ?? '' });
    case 'group.chat_unlink':
      return t(lang, 'activity.chatUnlink', { actor, name: p.name ?? '' });
    case 'member.add':
      return t(lang, 'activity.memberAdd', { actor, name: p.name ?? '' });
    case 'member.rename':
      return t(lang, 'activity.memberRename', { actor, from: p.from ?? '', to: p.to ?? '' });
    case 'member.delete':
      return t(lang, 'activity.memberDelete', { actor, name: p.name ?? '' });
    case 'member.join':
      return t(lang, 'activity.memberJoin', { actor });
    case 'member.leave':
      return t(lang, 'activity.memberLeave', { actor });
    case 'group.archive':
      return t(lang, 'activity.groupArchive', { actor });
    case 'group.unarchive':
      return t(lang, 'activity.groupUnarchive', { actor });
    case 'member.claim':
      return t(lang, 'activity.memberClaim', { actor, name: p.name ?? '' });
    case 'member.payment_info':
      return t(lang, 'activity.paymentInfo', { actor, name: p.name ?? '' });
    case 'debt.remind':
      return t(lang, 'activity.remind', { actor, name: p.name ?? '', amount: money(p.amount ?? 0) });
    case 'expense.create': {
      const e = p.expense;
      if (!e) return actor;
      if (e.kind === 'transfer')
        return t(lang, 'activity.transferCreate', {
          actor,
          from: e.payer.name,
          to: e.to?.name ?? '?',
          amount: money(e.amount),
        });
      return t(lang, 'activity.expenseCreate', { actor, title: e.title, amount: money(e.amount) });
    }
    case 'expense.delete': {
      const e = p.expense;
      if (!e) return actor;
      if (e.kind === 'transfer') return t(lang, 'activity.transferDelete', { actor, amount: money(e.amount) });
      return t(lang, 'activity.expenseDelete', { actor, title: e.title, amount: money(e.amount) });
    }
    case 'expense.update': {
      const { before, after } = p;
      if (!before || !after) return actor;
      const changes: string[] = [];
      if (before.amount !== after.amount)
        changes.push(t(lang, 'activity.changeAmount', { from: money(before.amount), to: money(after.amount) }));
      if (before.kind === 'expense' && before.title !== after.title)
        changes.push(t(lang, 'activity.changeTitle', { from: before.title, to: after.title }));
      if (before.payer.id !== after.payer.id)
        changes.push(t(lang, 'activity.changePayer', { from: before.payer.name, to: after.payer.name }));
      if (before.to && after.to && before.to.id !== after.to.id)
        changes.push(t(lang, 'activity.changeRecipient', { from: before.to.name, to: after.to.name }));
      if (after.kind === 'transfer') {
        return changes.length
          ? t(lang, 'activity.transferUpdate', { actor, changes: changes.join('; ') })
          : t(lang, 'activity.transferTouched', { actor });
      }
      return changes.length
        ? t(lang, 'activity.expenseUpdate', { actor, title: before.title, changes: changes.join('; ') })
        : t(lang, 'activity.expenseTouched', { actor, title: before.title });
    }
  }
}
