import { type SettledKind, settledTransition } from '../../shared/settled.ts';
import { type GroupDetail, getCachedGroup, setGroup } from './api.ts';

/** Праздник, ждущий показа на экране группы (один раз на переход). */
let pending: { groupId: number; kind: SettledKind } | null = null;

/** Кладёт ответ сервера в кэш и, если долги закрылись, запоминает праздник для экрана группы. */
export function applySavedGroup(after: GroupDetail) {
  const kind = settledTransition(getCachedGroup(after.id), after);
  setGroup(after);
  pending = kind ? { groupId: after.id, kind } : null;
}

export function takeCelebration(groupId: number): SettledKind | null {
  if (pending?.groupId !== groupId) return null;
  const { kind } = pending;
  pending = null;
  return kind;
}
