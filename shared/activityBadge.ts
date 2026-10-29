import type { ActivityAction } from './activity.ts';

// Names of the icons in web/src/icons.tsx and tones of `Tile`; the web checks them when it passes a badge to `Avatar`.
export type ActivityBadgeIcon =
  | 'plus'
  | 'pencil'
  | 'trash'
  | 'users'
  | 'userplus'
  | 'check'
  | 'card'
  | 'logout'
  | 'link'
  | 'archive'
  | 'bell'
  | 'chat'
  | 'repeat'
  | 'transfer';
export type ActivityBadgeTone = 'pos' | 'link' | 'brand' | 'gray' | 'neg';

export interface ActivityBadge {
  icon: ActivityBadgeIcon;
  tone: ActivityBadgeTone;
}

const ADD: ActivityBadge = { icon: 'plus', tone: 'pos' };
const EDIT: ActivityBadge = { icon: 'pencil', tone: 'gray' };
const REMOVE: ActivityBadge = { icon: 'trash', tone: 'neg' };

/**
 * Значок действия на аватаре автора в истории (`Avatar badge`). Добавление — `pos`, перевод и создание группы —
 * `link` и `brand`, изменение и настройки — нейтральный `gray`, удаление — `neg`.
 * Перевод отличается от траты содержимым записи, см. `activityBadge`.
 */
export const ACTIVITY_BADGES: Record<ActivityAction, ActivityBadge> = {
  'group.create': { icon: 'users', tone: 'brand' },
  'group.rename': EDIT,
  'member.add': { icon: 'userplus', tone: 'pos' },
  'member.rename': EDIT,
  'member.delete': REMOVE,
  'member.join': { icon: 'userplus', tone: 'pos' },
  'member.claim': { icon: 'check', tone: 'pos' },
  'member.payment_info': { icon: 'card', tone: 'gray' },
  'member.leave': { icon: 'logout', tone: 'gray' },
  'member.remove': REMOVE,
  'group.invite_rotate': { icon: 'link', tone: 'gray' },
  'group.archive': { icon: 'archive', tone: 'gray' },
  'group.unarchive': { icon: 'archive', tone: 'gray' },
  'expense.create': ADD,
  'expense.update': EDIT,
  'expense.delete': REMOVE,
  'debt.remind': { icon: 'bell', tone: 'link' },
  'group.auto_remind': { icon: 'bell', tone: 'gray' },
  'group.chat_link': { icon: 'chat', tone: 'link' },
  'group.chat_unlink': { icon: 'chat', tone: 'gray' },
  'group.chat_feed': { icon: 'chat', tone: 'gray' },
  'recurring.create': { icon: 'repeat', tone: 'pos' },
  'recurring.update': { icon: 'repeat', tone: 'gray' },
  'recurring.delete': { icon: 'repeat', tone: 'neg' },
};

const TRANSFER: ActivityBadge = { icon: 'transfer', tone: 'link' };

/** Значок записи: для перевода (создание и правка) — стрелки, иначе по таблице. */
export function activityBadge(entry: {
  action: ActivityAction;
  payload: { expense?: { kind: string }; after?: { kind: string } };
}): ActivityBadge {
  const kind = entry.payload.expense?.kind ?? entry.payload.after?.kind;
  if (kind === 'transfer' && entry.action !== 'expense.delete') return TRANSFER;
  return ACTIVITY_BADGES[entry.action];
}
