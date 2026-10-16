// Достижения группы: чистая функция от данных группы, ничего не хранится.
// Правила: достижения принадлежат группе целиком, никого не ранжируют и не стыдят, ничего не говорят о размере долгов.
import type { Key } from './i18n/index.ts';

export const ACHIEVEMENT_IDS = [
  'first',
  'crew',
  'ten',
  'hundred',
  'travelers',
  'allCategories',
  'clean',
  'week',
  'month',
] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

export const ACHIEVEMENT_EMOJI: Record<AchievementId, string> = {
  first: '🌱',
  crew: '👯',
  ten: '🔟',
  hundred: '💯',
  travelers: '🧳',
  allCategories: '🌈',
  clean: '🕊️',
  week: '📅',
  month: '🗓️',
};

export const MIN_CREW = 4;
export const TARGET_TEN = 10;
export const TARGET_HUNDRED = 100;
export const MIN_CURRENCIES = 2;
export const MIN_CATEGORIES = 5;
export const MIN_CLEAN_EXPENSES = 5;
export const WEEK_DAYS = 7;
export const MONTH_SPAN_DAYS = 30;

export interface AchievementInput {
  currency: string;
  members: { id: number; balance: number }[];
  expenses: {
    kind: 'expense' | 'transfer';
    spentOn: string; // YYYY-MM-DD
    category: string | null;
    originalCurrency: string | null;
  }[];
}

export interface Achievement {
  id: AchievementId;
  unlocked: boolean;
  /** Для ещё не полученных: сколько уже есть и сколько нужно. */
  progress?: { current: number; target: number };
}

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

export function groupAchievements(detail: AchievementInput): Achievement[] {
  const spent = detail.expenses.filter((e) => e.kind === 'expense');
  const count = spent.length;
  const days = new Set(spent.map((e) => e.spentOn));
  const categories = new Set(spent.map((e) => e.category).filter((c): c is string => Boolean(c)));
  const currencies = new Set(spent.map((e) => e.originalCurrency ?? detail.currency));
  const dayNums = [...days].map(dayNumber);
  const span = dayNums.length ? Math.max(...dayNums) - Math.min(...dayNums) + 1 : 0;
  const allZero = detail.members.every((m) => m.balance === 0);

  const counter = (id: AchievementId, current: number, target: number): Achievement =>
    current >= target ? { id, unlocked: true } : { id, unlocked: false, progress: { current, target } };

  return [
    counter('first', count, 1),
    counter('crew', detail.members.length, MIN_CREW),
    counter('ten', count, TARGET_TEN),
    counter('hundred', count, TARGET_HUNDRED),
    counter('travelers', currencies.size, MIN_CURRENCIES),
    counter('allCategories', categories.size, MIN_CATEGORIES),
    // «Ни копейки долга»: минимум MIN_CLEAN_EXPENSES трат, и сейчас все в расчёте.
    count >= MIN_CLEAN_EXPENSES && allZero
      ? { id: 'clean', unlocked: true }
      : {
          id: 'clean',
          unlocked: false,
          progress: { current: Math.min(count, MIN_CLEAN_EXPENSES - 1), target: MIN_CLEAN_EXPENSES },
        },
    counter('week', days.size, WEEK_DAYS),
    counter('month', span, MONTH_SPAN_DAYS),
  ];
}

export const achievementTitleKey = (id: AchievementId) => `achievements.items.${id}.title` as Key;
export const achievementTextKey = (id: AchievementId) => `achievements.items.${id}.text` as Key;

/** Какие достижения получены после сохранения и не были получены до. */
export function newlyUnlocked(before: AchievementInput, after: AchievementInput): AchievementId[] {
  const had = new Set(
    groupAchievements(before)
      .filter((a) => a.unlocked)
      .map((a) => a.id),
  );
  return groupAchievements(after)
    .filter((a) => a.unlocked && !had.has(a.id))
    .map((a) => a.id);
}
