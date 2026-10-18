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

/** Всё, что нужно правилам. Считается по всем тратам группы: на сервере в SQL, в тестах — из списка трат. */
export interface AchievementFacts {
  membersCount: number;
  allSettled: boolean;
  /** Обычные траты (без переводов). */
  expenseCount: number;
  daysCount: number;
  /** Дней от самой ранней траты до самой поздней включительно. */
  spanDays: number;
  categoriesCount: number;
  currenciesCount: number;
}

export function achievementFacts(detail: AchievementInput): AchievementFacts {
  const spent = detail.expenses.filter((e) => e.kind === 'expense');
  const days = new Set(spent.map((e) => e.spentOn));
  const dayNums = [...days].map(dayNumber);
  return {
    membersCount: detail.members.length,
    allSettled: detail.members.every((m) => m.balance === 0),
    expenseCount: spent.length,
    daysCount: days.size,
    spanDays: dayNums.length ? Math.max(...dayNums) - Math.min(...dayNums) + 1 : 0,
    categoriesCount: new Set(spent.map((e) => e.category).filter((c): c is string => Boolean(c))).size,
    currenciesCount: new Set(spent.map((e) => e.originalCurrency ?? detail.currency)).size,
  };
}

/** Число дней между датами YYYY-MM-DD включительно (для сервера, где известны только min и max). */
export const spanBetween = (min: string, max: string) => dayNumber(max) - dayNumber(min) + 1;

export function achievementsFromFacts(f: AchievementFacts): Achievement[] {
  const count = f.expenseCount;
  const counter = (id: AchievementId, current: number, target: number): Achievement =>
    current >= target ? { id, unlocked: true } : { id, unlocked: false, progress: { current, target } };

  return [
    counter('first', count, 1),
    counter('crew', f.membersCount, MIN_CREW),
    counter('ten', count, TARGET_TEN),
    counter('hundred', count, TARGET_HUNDRED),
    counter('travelers', f.currenciesCount, MIN_CURRENCIES),
    counter('allCategories', f.categoriesCount, MIN_CATEGORIES),
    // «Ни копейки долга»: минимум MIN_CLEAN_EXPENSES трат, и сейчас все в расчёте.
    count >= MIN_CLEAN_EXPENSES && f.allSettled
      ? { id: 'clean', unlocked: true }
      : {
          id: 'clean',
          unlocked: false,
          progress: { current: Math.min(count, MIN_CLEAN_EXPENSES - 1), target: MIN_CLEAN_EXPENSES },
        },
    counter('week', f.daysCount, WEEK_DAYS),
    counter('month', f.spanDays, MONTH_SPAN_DAYS),
  ];
}

export const groupAchievements = (detail: AchievementInput): Achievement[] =>
  achievementsFromFacts(achievementFacts(detail));

export const achievementTitleKey = (id: AchievementId) => `achievements.items.${id}.title` as Key;
export const achievementTextKey = (id: AchievementId) => `achievements.items.${id}.text` as Key;

/** Какие достижения получены в `after` и не были получены в `before`. */
export function newlyUnlockedIn(before: Achievement[], after: Achievement[]): AchievementId[] {
  const had = new Set(before.filter((a) => a.unlocked).map((a) => a.id));
  return after.filter((a) => a.unlocked && !had.has(a.id)).map((a) => a.id);
}

/** То же по данным группы. */
export function newlyUnlocked(before: AchievementInput, after: AchievementInput): AchievementId[] {
  return newlyUnlockedIn(groupAchievements(before), groupAchievements(after));
}
