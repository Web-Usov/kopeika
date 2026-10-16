// Fixed list of expense categories, keyword auto-suggest and per-category totals.
// Shared by the server (validation) and the Mini App (chips, stats). Names live in the i18n dictionaries.
import type { Key, Lang } from './i18n/index.ts';

export const CATEGORIES = [
  { id: 'food', emoji: '🍽' },
  { id: 'groceries', emoji: '🛒' },
  { id: 'housing', emoji: '🏠' },
  { id: 'transport', emoji: '🚕' },
  { id: 'fun', emoji: '🎉' },
  { id: 'shopping', emoji: '🛍' },
  { id: 'other', emoji: '🧾' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]];
export const DEFAULT_CATEGORY: CategoryId = 'other';

export const categoryEmoji = (id: string): string => CATEGORIES.find((c) => c.id === id)?.emoji ?? '🧾';
export const categoryKey = (id: CategoryId): Key => `category.${id}`;

// Words are matched by prefix ("такси" matches "такси в аэропорт"); a trailing "=" means the whole word.
// Order matters: the first category with a match wins, so "groceries" goes before "food".
const KEYWORDS: Record<Lang, [CategoryId, string[]][]> = {
  ru: [
    [
      'groceries',
      ['продукт', 'магазин', 'супермаркет', 'пятёроч', 'пятероч', 'перекрёст', 'перекрест', 'лента=', 'ашан'],
    ],
    [
      'food',
      [
        'ужин',
        'обед',
        'завтрак',
        'кафе',
        'ресторан',
        'пицц',
        'суши',
        'кофе',
        'бургер',
        'столов',
        'шашлык',
        'еда=',
        'перекус',
      ],
    ],
    [
      'transport',
      [
        'такси',
        'метро=',
        'автобус',
        'бензин',
        'заправк',
        'парковк',
        'поезд',
        'электричк',
        'самолёт',
        'самолет',
        'авиабилет',
        'каршеринг',
        'проезд',
      ],
    ],
    [
      'housing',
      ['отель', 'гостиниц', 'хостел', 'квартир', 'жильё', 'жилье', 'аренд', 'ночёвк', 'ночевк', 'кемпинг', 'коммунал'],
    ],
    [
      'fun',
      [
        'кино=',
        'бар=',
        'бары=',
        'клуб',
        'музей',
        'театр',
        'концерт',
        'экскурси',
        'аттракцион',
        'квест',
        'боулинг',
        'развлеч',
        'караоке',
        'вечеринк',
      ],
    ],
    ['shopping', ['сувенир', 'одежд', 'подарок', 'подарки=', 'покупк', 'шопинг', 'обувь=']],
  ],
  en: [
    ['groceries', ['grocer', 'supermarket', 'market', 'walmart', 'tesco', 'lidl', 'aldi']],
    [
      'food',
      [
        'dinner',
        'lunch',
        'breakfast',
        'brunch',
        'cafe',
        'café',
        'restaurant',
        'pizza',
        'sushi',
        'coffee',
        'burger',
        'food=',
        'snack',
        'bbq',
        'meal',
      ],
    ],
    [
      'transport',
      [
        'taxi',
        'uber',
        'lyft',
        'bolt=',
        'metro=',
        'subway',
        'bus=',
        'train',
        'fuel',
        'petrol',
        'parking',
        'flight',
        'plane',
        'toll=',
        'car rental',
      ],
    ],
    [
      'housing',
      ['hotel', 'hostel', 'airbnb', 'apartment', 'flat=', 'rent', 'lodging', 'camping', 'accommodation', 'utilit'],
    ],
    [
      'fun',
      [
        'cinema',
        'movie',
        'bar=',
        'bars=',
        'pub=',
        'club',
        'museum',
        'theatre',
        'theater',
        'concert',
        'excursion',
        'bowling',
        'karaoke',
        'party',
        'festival',
      ],
    ],
    ['shopping', ['souvenir', 'cloth', 'gift', 'shopping', 'shoes=', 'present']],
  ],
};

function matches(words: string[], phrase: string, kws: string[]): boolean {
  return kws.some((kw) => {
    if (kw.endsWith('=')) return words.includes(kw.slice(0, -1));
    return kw.includes(' ') ? phrase.includes(kw) : words.some((w) => w.startsWith(kw));
  });
}

/** Guess a category from an expense title; `null` when nothing matches. The user's language is tried first. */
export function suggestCategory(title: string, lang: Lang): CategoryId | null {
  const phrase = title.toLowerCase().trim();
  if (!phrase) return null;
  const words = phrase.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const order: Lang[] = lang === 'ru' ? ['ru', 'en'] : ['en', 'ru'];
  for (const l of order) {
    for (const [id, kws] of KEYWORDS[l]) if (matches(words, phrase, kws)) return id;
  }
  return null;
}

export interface CategoryTotal {
  category: CategoryId;
  amount: number;
}

interface StatExpense {
  kind: 'expense' | 'transfer';
  category: string | null;
  amount: number;
  shares: { memberId: number; amount: number }[];
}

/**
 * Totals per category (transfers ignored), biggest first: for the whole group and for one member
 * (the sum of their shares). Categories without spending are left out.
 */
export function categoryTotals(
  expenses: StatExpense[],
  memberId: number,
): { group: CategoryTotal[]; mine: CategoryTotal[] } {
  const group = new Map<CategoryId, number>();
  const mine = new Map<CategoryId, number>();
  for (const e of expenses) {
    if (e.kind !== 'expense') continue;
    const id = CATEGORY_IDS.find((c) => c === e.category) ?? DEFAULT_CATEGORY;
    group.set(id, (group.get(id) ?? 0) + e.amount);
    const share = e.shares.find((s) => s.memberId === memberId)?.amount ?? 0;
    if (share > 0) mine.set(id, (mine.get(id) ?? 0) + share);
  }
  const sorted = (m: Map<CategoryId, number>) =>
    [...m]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount || CATEGORY_IDS.indexOf(a.category) - CATEGORY_IDS.indexOf(b.category));
  return { group: sorted(group), mine: sorted(mine) };
}
