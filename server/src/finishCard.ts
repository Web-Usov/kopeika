import { ACHIEVEMENT_EMOJI, type AchievementId, achievementTitleKey, spanBetween } from '../../shared/achievements.ts';
import { createT, type Lang } from '../../shared/i18n/index.ts';
import { formatMoney } from '../../shared/money.ts';
import { groupSummary, shortDay } from '../../shared/summary.ts';
import { esc, MAX_LINES } from './chatText.ts';
import { all, one } from './db.ts';
import { type GroupRow, groupAchievementList, groupBalances, loadLedger } from './repo.ts';

export interface FinishCardInput {
  lang: Lang;
  groupName: string;
  currency: string;
  total: number;
  firstDay: string | null;
  lastDay: string | null;
  /** What each person spent: the sum of their shares of all expenses (not what they paid out of pocket). */
  members: { name: string; spent: number }[];
  biggest: { title: string; amount: number; payer: string } | null;
  achievements: AchievementId[];
  /** All balances are zero; a manual finish with open debts just leaves the footer out. */
  settled: boolean;
}

/** Text of the «trip finished» card for the linked chat (HTML). Only positive: nobody owes anything, all is settled. */
export function buildFinishCard(i: FinishCardInput): string {
  const t = createT(i.lang);
  const money = (v: number) => formatMoney(v, i.currency, i.lang);
  const days = i.firstDay && i.lastDay ? spanBetween(i.firstDay, i.lastDay) : 1;
  const lines = [`🏁 <b>${t('bot.finishHead', { name: esc(i.groupName) })}</b>`, ''];
  lines.push(`💰 ${t('bot.finishTotal', { amount: money(i.total), days: t('bot.finishDays', { count: days }) })}`);
  if (i.firstDay && i.lastDay)
    lines.push(
      `📅 ${i.firstDay === i.lastDay ? shortDay(i.firstDay, i.lang) : `${shortDay(i.firstDay, i.lang)} — ${shortDay(i.lastDay, i.lang)}`}`,
    );
  const people = i.members.filter((m) => m.spent > 0).sort((a, b) => b.spent - a.spent);
  if (people.length) {
    lines.push('', `👥 <b>${t('bot.finishMembers')}</b>`);
    for (const m of people.slice(0, MAX_LINES)) lines.push(`${esc(m.name)} — ${money(m.spent)}`);
    if (people.length > MAX_LINES) lines.push(t('bot.balanceMore', { count: people.length - MAX_LINES }));
  }
  if (i.biggest)
    lines.push(
      '',
      `💎 ${t('bot.finishBiggest', { title: esc(i.biggest.title), amount: money(i.biggest.amount), payer: esc(i.biggest.payer) })}`,
    );
  const unlocked = i.achievements;
  if (unlocked.length)
    lines.push(
      '',
      `🏆 <b>${t('bot.finishAchievements')}</b>`,
      unlocked.map((a) => `${ACHIEVEMENT_EMOJI[a]} ${t(achievementTitleKey(a))}`).join(', '),
    );
  if (i.settled) lines.push('', t('bot.finishFooter'));
  return lines.join('\n');
}

/** Reads the group and builds the card in `lang`. */
export function finishCardFor(group: GroupRow, lang: Lang): string {
  const members = all<{ id: number; name: string }>(
    'SELECT id, name FROM members WHERE group_id = ? ORDER BY id',
    group.id,
  );
  const s = groupSummary({ members, expenses: loadLedger(group.id) }, lang);
  const names = new Map(members.map((m) => [m.id, m.name]));
  const biggestTitle = s.biggest
    ? one<{ title: string }>('SELECT title FROM expenses WHERE id = ?', s.biggest.id)?.title
    : undefined;
  const balances = groupBalances(group.id);
  return buildFinishCard({
    settled: [...balances.values()].every((b) => b === 0),
    lang,
    groupName: group.name,
    currency: group.currency,
    total: s.total,
    firstDay: s.firstDay,
    lastDay: s.lastDay,
    members: s.members.map((m) => ({ name: m.name, spent: m.consumed })),
    biggest:
      s.biggest && biggestTitle !== undefined
        ? { title: biggestTitle, amount: s.biggest.amount, payer: names.get(s.biggest.payerId) ?? '' }
        : null,
    achievements: groupAchievementList(group, members.length, balances)
      .filter((a) => a.unlocked)
      .map((a) => a.id),
  });
}
