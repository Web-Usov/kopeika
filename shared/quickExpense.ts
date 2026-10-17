// «Быстрая трата»: one line like «1200 такси» or «ужин 50 eur» → amount, currency, title, category.
// Pure and LLM-free; the amount follows the same rules as parseAmount (at most two decimals).
import { type CategoryId, DEFAULT_CATEGORY, suggestCategory } from './categories.ts';
import { createT, type Lang } from './i18n/index.ts';
import { CURRENCIES, parseAmount } from './money.ts';

export interface QuickExpense {
  title: string;
  /** Minor units of `currency`. */
  amount: number;
  currency: string;
  category: CategoryId;
}

// Currency markers (regex sources) in priority order. Words are matched as whole words, with stem letters allowed.
const MARKERS: [string, string][] = [
  ['₽', 'RUB'],
  ['\\$', 'USD'],
  ['€', 'EUR'],
  ['£', 'GBP'],
  ['₾', 'GEL'],
  ['₸', 'KZT'],
  ['֏', 'AMD'],
  ['₺', 'TRY'],
  ['¥', 'CNY'],
  ['฿', 'THB'],
  ['₴', 'UAH'],
  ['бел[а-яё]*\\s+руб[а-яё]*\\.?', 'BYN'],
  ['руб[а-яё]*\\.?', 'RUB'],
  ['р\\.?', 'RUB'],
  ['rubles?', 'RUB'],
  ['евро', 'EUR'],
  ['euros?', 'EUR'],
  ['долл[а-яё]*\\.?', 'USD'],
  ['бакс[а-яё]*', 'USD'],
  ['dollars?', 'USD'],
  ['bucks?', 'USD'],
  ['лари', 'GEL'],
  ['lari', 'GEL'],
  ['тенге', 'KZT'],
  ['тг\\.?', 'KZT'],
  ['tenge', 'KZT'],
  ['лир[а-яё]*', 'TRY'],
  ['tl', 'TRY'],
  ['lira', 'TRY'],
  ['драм[а-яё]*', 'AMD'],
  ['dram', 'AMD'],
  ['гривн[а-яё]*', 'UAH'],
  ['грн\\.?', 'UAH'],
  ['hryvnias?', 'UAH'],
  ['бат', 'THB'],
  ['baht', 'THB'],
  ['дирхам[а-яё]*', 'AED'],
  ['dirhams?', 'AED'],
  ['юан[а-яё]*', 'CNY'],
  ['yuan', 'CNY'],
  ['фунт[а-яё]*', 'GBP'],
  ['pounds?', 'GBP'],
  ...CURRENCIES.map((c): [string, string] => [c.toLowerCase(), c]),
];

const AFTER = MARKERS.map(([re, code]) => ({ re: new RegExp(`^(\\s*)(${re})(?![\\p{L}\\p{N}])`, 'iu'), code }));
const BEFORE = MARKERS.map(([re, code]) => ({ re: new RegExp(`(?:^|[^\\p{L}])(${re})(\\s*)$`, 'iu'), code }));

// A number: digits, optional groups of three after a space («1 200»), optional decimal part. Not glued to a letter.
const NUMBER = /(?<![\p{L}\d])\d+(?:[   ]\d{3})*(?:[.,]\d+)?/gu;
const FILLER = /^(?:за|на|for|on)$/iu;
const EDGE = /^[\s\-–—:;,.]+|[\s\-–—:;,.]+$/g;

function cleanTitle(s: string): string {
  const words = s
    .replace(/[\s ]+/g, ' ')
    .replace(EDGE, '')
    .split(' ')
    .filter(Boolean);
  while (words.length && FILLER.test(words[0])) words.shift();
  while (words.length && FILLER.test(words[words.length - 1])) words.pop();
  return words.join(' ').replace(EDGE, '');
}

/**
 * Parses a free-form line. Returns null when there is no single unambiguous positive amount
 * (none, several numbers, more than two decimals like «1.234», zero).
 */
export function parseQuickExpense(
  text: string,
  { lang, groupCurrency }: { lang: Lang; groupCurrency: string },
): QuickExpense | null {
  const input = text.trim();
  const numbers = [...input.matchAll(NUMBER)];
  if (numbers.length !== 1) return null;
  const m = numbers[0];
  const amount = parseAmount(m[0]);
  if (!amount || amount <= 0) return null;

  let start = m.index;
  let end = m.index + m[0].length;
  let currency = groupCurrency;

  const after = input.slice(end);
  const before = input.slice(0, start);
  const a = AFTER.map((x) => ({ x, r: x.re.exec(after) })).find((o) => o.r);
  if (a?.r) {
    currency = a.x.code;
    end += a.r[0].length;
  } else {
    const b = BEFORE.map((x) => ({ x, r: x.re.exec(before) })).find((o) => o.r);
    if (b?.r) {
      currency = b.x.code;
      start -= b.r[1].length + b.r[2].length;
    }
  }

  const rest = cleanTitle(`${input.slice(0, start)} ${input.slice(end)}`)
    .slice(0, 100)
    .trim();
  const category = suggestCategory(rest, lang) ?? DEFAULT_CATEGORY;
  const title = rest || createT(lang)(`category.${category}`);
  return { title, amount, currency, category };
}
