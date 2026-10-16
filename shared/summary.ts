// «Итоги» группы: чистые функции без побочных эффектов. Только позитив — никаких должников и антирейтингов.
// Переводы (kind = 'transfer') в итоги не входят; суммы — в валюте группы (для трат в другой валюте это уже пересчитанное значение).
import { CATEGORY_IDS, type CategoryId, categoryEmoji, categoryKey, DEFAULT_CATEGORY } from './categories.ts';
import { createT, type Key, type Lang, locale } from './i18n/index.ts';
import { formatMoney } from './money.ts';

export interface SummaryExpense {
  id: number;
  kind: 'expense' | 'transfer';
  amount: number;
  payerId: number;
  spentOn: string; // YYYY-MM-DD
  category: string | null;
  shares: { memberId: number; amount: number }[];
}

export interface SummaryInput {
  members: { id: number; name: string }[];
  expenses: SummaryExpense[];
}

export type TitleId = 'sponsor' | 'generous' | 'food' | 'groceries' | 'transport' | 'housing' | 'fun' | 'shopping';

export interface MemberTitle {
  id: TitleId;
  emoji: string;
  /** Подпись на языке `lang`. */
  label: string;
}

export interface MemberSummary {
  id: number;
  name: string;
  paid: number;
  consumed: number;
  title: MemberTitle | null;
}

export interface GroupSummary {
  total: number;
  count: number;
  firstDay: string | null;
  lastDay: string | null;
  topCategory: { category: CategoryId; amount: number } | null;
  topDay: { day: string; amount: number } | null;
  biggest: { id: number; amount: number; payerId: number } | null;
  /** По убыванию «заплатил», при равенстве — по id. */
  members: MemberSummary[];
}

/** Пороги: титулы выдаются, только если в группе хотя бы столько участников и трат. */
export const MIN_MEMBERS_FOR_TITLES = 2;
export const MIN_EXPENSES_FOR_TITLES = 3;
/** Категорийный титул — от стольких трат участника в этой категории. */
export const MIN_CATEGORY_EXPENSES = 2;
/** «Самый щедрый на одну трату»: самая крупная трата не меньше стольких средних трат. */
export const GENEROUS_MIN_TIMES_AVG = 2;
/** «Спонсор»: заплатил минимум столько трат. */
export const MIN_SPONSOR_EXPENSES = 2;

const TITLE_EMOJI: Record<TitleId, string> = {
  sponsor: '👑',
  generous: '💎',
  food: '🍽',
  groceries: '🛒',
  transport: '🚕',
  housing: '🏠',
  fun: '🎉',
  shopping: '🛍',
};
const CATEGORY_TITLES = ['food', 'groceries', 'transport', 'housing', 'fun', 'shopping'] as const;
const titleKey = (id: TitleId): Key => `summary.titles.${id}`;

const categoryOf = (e: SummaryExpense): CategoryId => CATEGORY_IDS.find((c) => c === e.category) ?? DEFAULT_CATEGORY;

export function groupSummary(detail: SummaryInput, lang: Lang = 'ru'): GroupSummary {
  const t = createT(lang);
  const expenses = detail.expenses.filter((e) => e.kind === 'expense');
  const paid = new Map<number, number>();
  const paidCount = new Map<number, number>();
  const consumed = new Map<number, number>();
  const byCategory = new Map<CategoryId, number>();
  const byDay = new Map<string, number>();
  // платежи участника в категории: сумма и количество
  const catPaid = new Map<CategoryId, Map<number, { amount: number; count: number }>>();
  let total = 0;
  let biggest: GroupSummary['biggest'] = null;

  for (const e of expenses) {
    total += e.amount;
    paid.set(e.payerId, (paid.get(e.payerId) ?? 0) + e.amount);
    paidCount.set(e.payerId, (paidCount.get(e.payerId) ?? 0) + 1);
    for (const s of e.shares) consumed.set(s.memberId, (consumed.get(s.memberId) ?? 0) + s.amount);
    const cat = categoryOf(e);
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + e.amount);
    byDay.set(e.spentOn, (byDay.get(e.spentOn) ?? 0) + e.amount);
    const m = catPaid.get(cat) ?? new Map<number, { amount: number; count: number }>();
    const cur = m.get(e.payerId) ?? { amount: 0, count: 0 };
    m.set(e.payerId, { amount: cur.amount + e.amount, count: cur.count + 1 });
    catPaid.set(cat, m);
    if (!biggest || e.amount > biggest.amount || (e.amount === biggest.amount && e.id < biggest.id))
      biggest = { id: e.id, amount: e.amount, payerId: e.payerId };
  }

  const days = [...byDay.keys()].sort();
  const topCategory = [...byCategory]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount || CATEGORY_IDS.indexOf(a.category) - CATEGORY_IDS.indexOf(b.category))[0];
  const topDay = [...byDay]
    .map(([day, amount]) => ({ day, amount }))
    .sort((a, b) => b.amount - a.amount || a.day.localeCompare(b.day))[0];

  // Титулы по порядку важности; каждый уходит лучшему из тех, у кого титула ещё нет и порог пройден.
  const titles = new Map<number, TitleId>();
  const award = (id: TitleId, candidates: { memberId: number; score: number }[]) => {
    const best = candidates
      .filter((c) => c.score > 0 && !titles.has(c.memberId))
      .sort((a, b) => b.score - a.score || a.memberId - b.memberId)[0];
    if (best) titles.set(best.memberId, id);
  };
  const known = new Set(detail.members.map((m) => m.id));
  if (detail.members.length >= MIN_MEMBERS_FOR_TITLES && expenses.length >= MIN_EXPENSES_FOR_TITLES) {
    award(
      'sponsor',
      [...paid]
        .filter(([id]) => known.has(id) && (paidCount.get(id) ?? 0) >= MIN_SPONSOR_EXPENSES)
        .map(([memberId, score]) => ({ memberId, score })),
    );
    if (biggest && known.has(biggest.payerId) && biggest.amount * expenses.length >= total * GENEROUS_MIN_TIMES_AVG)
      award('generous', [{ memberId: biggest.payerId, score: biggest.amount }]);
    for (const id of CATEGORY_TITLES) {
      const cat: CategoryId = id;
      const m = catPaid.get(cat);
      if (!m) continue;
      award(
        id,
        [...m]
          .filter(([memberId, v]) => known.has(memberId) && v.count >= MIN_CATEGORY_EXPENSES)
          .map(([memberId, v]) => ({ memberId, score: v.amount })),
      );
    }
  }

  const members = detail.members
    .map((m): MemberSummary => {
      const id = titles.get(m.id);
      return {
        id: m.id,
        name: m.name,
        paid: paid.get(m.id) ?? 0,
        consumed: consumed.get(m.id) ?? 0,
        title: id ? { id, emoji: TITLE_EMOJI[id], label: t(titleKey(id)) } : null,
      };
    })
    .sort((a, b) => b.paid - a.paid || a.id - b.id);

  return {
    total,
    count: expenses.length,
    firstDay: days[0] ?? null,
    lastDay: days[days.length - 1] ?? null,
    topCategory: topCategory ?? null,
    topDay: topDay ?? null,
    biggest,
    members,
  };
}

/** «12 июн» / "Jun 12" из YYYY-MM-DD, без привязки к часовому поясу. */
export function shortDay(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** Период «12 июн — 18 июн» (или один день). */
export function periodText(s: GroupSummary, lang: Lang): string {
  if (!s.firstDay || !s.lastDay) return '';
  return s.firstDay === s.lastDay
    ? shortDay(s.firstDay, lang)
    : `${shortDay(s.firstDay, lang)} — ${shortDay(s.lastDay, lang)}`;
}

/** Текст для пересылки в чат: несколько строк с эмодзи. Ссылку на группу добавляет шаринг. */
export function summaryShareText(groupName: string, currency: string, summary: GroupSummary, lang: Lang): string {
  const t = createT(lang);
  const money = (n: number) => formatMoney(n, currency, lang);
  const lines = [t('summary.shareHead', { name: groupName }), ''];
  lines.push(
    `💰 ${t('summary.shareTotal', { amount: money(summary.total) })} · ${t('summary.expensesCount', { count: summary.count })}`,
  );
  const period = periodText(summary, lang);
  if (period) lines.push(`📅 ${period}`);
  if (summary.topCategory)
    lines.push(
      `${categoryEmoji(summary.topCategory.category)} ${t('summary.shareTopCategory', {
        name: t(categoryKey(summary.topCategory.category)),
        amount: money(summary.topCategory.amount),
      })}`,
    );
  if (summary.topDay)
    lines.push(
      `🔥 ${t('summary.shareTopDay', { day: shortDay(summary.topDay.day, lang), amount: money(summary.topDay.amount) })}`,
    );
  const titled = summary.members.filter((m) => m.title);
  if (titled.length) {
    lines.push('');
    for (const m of titled) lines.push(`${m.title?.emoji} ${m.name} — ${m.title?.label}`);
  }
  return lines.join('\n');
}
