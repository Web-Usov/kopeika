import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACHIEVEMENT_EMOJI,
  ACHIEVEMENT_IDS,
  type AchievementId,
  type AchievementInput,
  achievementTextKey,
  achievementTitleKey,
  groupAchievements,
  newlyUnlocked,
} from './achievements.ts';
import { t } from './i18n/index.ts';

type E = AchievementInput['expenses'][number];
const ex = (over: Partial<E> = {}): E => ({
  kind: 'expense',
  spentOn: '2026-06-10',
  category: 'food',
  originalCurrency: null,
  ...over,
});
const members = (n: number, balance = 0) => Array.from({ length: n }, (_, i) => ({ id: i + 1, balance }));
const group = (expenses: E[], m = members(2)): AchievementInput => ({ currency: 'RUB', members: m, expenses });
const get = (g: AchievementInput, id: AchievementId) => groupAchievements(g).find((a) => a.id === id)!;

test('empty group: nothing unlocked, progress shown', () => {
  const all = groupAchievements(group([]));
  assert.equal(all.length, ACHIEVEMENT_IDS.length);
  assert.ok(all.every((a) => !a.unlocked));
  assert.deepEqual(get(group([]), 'ten').progress, { current: 0, target: 10 });
});

test('first: one expense, transfers do not count', () => {
  assert.equal(get(group([ex({ kind: 'transfer', category: null })]), 'first').unlocked, false);
  assert.equal(get(group([ex()]), 'first').unlocked, true);
});

test('crew: 4+ members', () => {
  assert.equal(get(group([], members(3)), 'crew').unlocked, false);
  assert.deepEqual(get(group([], members(3)), 'crew').progress, { current: 3, target: 4 });
  assert.equal(get(group([], members(4)), 'crew').unlocked, true);
});

test('ten and hundred', () => {
  const n = (k: number) => group(Array.from({ length: k }, () => ex()));
  assert.equal(get(n(9), 'ten').unlocked, false);
  assert.deepEqual(get(n(7), 'ten').progress, { current: 7, target: 10 });
  assert.equal(get(n(10), 'ten').unlocked, true);
  assert.equal(get(n(99), 'hundred').unlocked, false);
  assert.equal(get(n(100), 'hundred').unlocked, true);
});

test('travelers: two currencies, group currency counts', () => {
  assert.equal(get(group([ex(), ex()]), 'travelers').unlocked, false);
  assert.equal(get(group([ex({ originalCurrency: 'EUR' })]), 'travelers').unlocked, false);
  assert.equal(get(group([ex(), ex({ originalCurrency: 'EUR' })]), 'travelers').unlocked, true);
  assert.equal(
    get(group([ex({ originalCurrency: 'EUR' }), ex({ originalCurrency: 'USD' })]), 'travelers').unlocked,
    true,
  );
});

test('allCategories: 5 distinct categories', () => {
  const cats = ['food', 'transport', 'housing', 'fun', 'shopping'];
  assert.equal(get(group(cats.slice(0, 4).map((category) => ex({ category }))), 'allCategories').unlocked, false);
  assert.equal(get(group(cats.map((category) => ex({ category }))), 'allCategories').unlocked, true);
});

test('clean: settled with 5+ expenses', () => {
  const five = Array.from({ length: 5 }, () => ex());
  assert.equal(get(group(five.slice(0, 4)), 'clean').unlocked, false);
  assert.equal(get(group(five, members(2, 100)), 'clean').unlocked, false);
  assert.equal(get(group(five), 'clean').unlocked, true);
  assert.deepEqual(get(group(five, members(2, 100)), 'clean').progress, { current: 4, target: 5 });
});

test('week: 7 distinct days', () => {
  const days = (k: number) => group(Array.from({ length: k }, (_, i) => ex({ spentOn: `2026-06-${10 + i}` })));
  assert.equal(get(days(6), 'week').unlocked, false);
  assert.equal(get(days(7), 'week').unlocked, true);
  assert.equal(get(group([ex(), ex(), ex()]), 'week').progress?.current, 1);
});

test('month: expenses span 30+ days', () => {
  assert.equal(get(group([ex({ spentOn: '2026-06-01' }), ex({ spentOn: '2026-06-29' })]), 'month').unlocked, false);
  assert.equal(get(group([ex({ spentOn: '2026-06-01' }), ex({ spentOn: '2026-06-30' })]), 'month').unlocked, true);
  assert.equal(get(group([ex({ spentOn: '2026-06-20' }), ex({ spentOn: '2026-07-19' })]), 'month').unlocked, true);
});

test('newlyUnlocked: only what the save added', () => {
  assert.deepEqual(newlyUnlocked(group([]), group([ex()])), ['first']);
  assert.deepEqual(newlyUnlocked(group([ex()]), group([ex(), ex()])), []);
  assert.deepEqual(newlyUnlocked(group([ex()]), group([])), []);
});

test('every achievement has an emoji and texts in both languages', () => {
  for (const id of ACHIEVEMENT_IDS) {
    assert.ok(ACHIEVEMENT_EMOJI[id], id);
    for (const lang of ['ru', 'en'] as const) {
      assert.ok(t(lang, achievementTitleKey(id)).length > 0, `${lang} ${id} title`);
      assert.ok(t(lang, achievementTextKey(id)).length > 0, `${lang} ${id} text`);
    }
  }
});
