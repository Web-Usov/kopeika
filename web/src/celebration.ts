import type { AchievementId } from '../../shared/achievements.ts';
import { newlyUnlockedIn } from '../../shared/achievements.ts';
import { type SettledKind, settledTransition } from '../../shared/settled.ts';
import { type GroupDetail, getCachedGroup, setGroup } from './api.ts';

export interface Pending {
  kind: SettledKind | null;
  achievements: AchievementId[];
}

/** Праздник, ждущий показа на экране группы (один раз на переход). */
let pending: ({ groupId: number } & Pending) | null = null;

/**
 * Кладёт ответ сервера в кэш и, если долги закрылись или группа получила новое достижение,
 * запоминает праздник для экрана группы.
 */
export function applySavedGroup(after: GroupDetail) {
  const before = getCachedGroup(after.id);
  const kind = settledTransition(before, after);
  const achievements = before ? newlyUnlockedIn(before.achievements, after.achievements) : [];
  setGroup(after);
  pending = kind || achievements.length ? { groupId: after.id, kind, achievements } : null;
}

export function takeCelebration(groupId: number): Pending | null {
  if (pending?.groupId !== groupId) return null;
  const { kind, achievements } = pending;
  pending = null;
  return { kind, achievements };
}
