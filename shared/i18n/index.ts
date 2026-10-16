// Tiny typed i18n shared by the Mini App and the server. No library: dictionaries are plain objects.
import { en } from './en.ts';
import { ru } from './ru.ts';

export type Lang = 'ru' | 'en';
export const DEFAULT_LANG: Lang = 'ru';

/** Plural forms by Intl.PluralRules category; the number comes from the `count` param. */
export type Plural = { one: string; few?: string; many?: string; other?: string };

type Widen<T> = {
  [K in keyof T]: T[K] extends { readonly one: string } ? Plural : T[K] extends string ? string : Widen<T[K]>;
};

/** Shape every dictionary must have, derived from `ru`: a missing or extra key in `en` is a compile error. */
export type Dict = Widen<typeof ru>;

type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string | { readonly one: string } ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Dotted key of any dictionary entry, e.g. 'home.myGroups'. */
export type Key = Paths<typeof ru>;
export type Params = Record<string, string | number>;

export const dictionaries: Record<Lang, Dict> = { ru, en };

/** Telegram `language_code` → UI language: `ru…` → Russian, anything else → English, unknown → Russian. */
export function pickLang(code?: string | null): Lang {
  if (!code) return DEFAULT_LANG;
  return code.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export const locale = (lang: Lang) => (lang === 'ru' ? 'ru-RU' : 'en-US');

const rules: Partial<Record<Lang, Intl.PluralRules>> = {};
function pluralForm(lang: Lang, n: number): Intl.LDMLPluralRule {
  let r = rules[lang];
  if (!r) {
    r = new Intl.PluralRules(locale(lang));
    rules[lang] = r;
  }
  return r.select(n);
}

function lookup(lang: Lang, key: Key): string | Plural {
  let node: unknown = dictionaries[lang];
  for (const part of key.split('.')) node = (node as Record<string, unknown>)[part];
  return node as string | Plural;
}

/** Raw template for a key (plural form already chosen by `params.count`), placeholders untouched. */
export function template(lang: Lang, key: Key, params?: Params): string {
  const v = lookup(lang, key);
  if (typeof v === 'string') return v;
  const form = pluralForm(lang, Number(params?.count ?? 0));
  const forms: Partial<Record<string, string>> = v;
  return forms[form] ?? v.other ?? v.many ?? v.one;
}

export function fill(tpl: string, params?: Params): string {
  if (!params) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

export function t(lang: Lang, key: Key, params?: Params): string {
  return fill(template(lang, key, params), params);
}

export type TFn = (key: Key, params?: Params) => string;
export const createT =
  (lang: Lang): TFn =>
  (key, params) =>
    t(lang, key, params);

/** Flat list of all keys of a dictionary (used by the key-parity test). */
export function flatKeys(dict: unknown, prefix = ''): string[] {
  return Object.entries(dict as Record<string, unknown>).flatMap(([k, v]) => {
    const isLeaf = typeof v === 'string' || typeof (v as Plural | null)?.one === 'string';
    return isLeaf ? [prefix + k] : flatKeys(v, `${prefix}${k}.`);
  });
}
