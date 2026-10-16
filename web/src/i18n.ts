// Language of the Mini App. It never changes at runtime, so it lives at module level.
// Inside Telegram: the user's language_code. In a plain browser (development): ?lang=en, default Russian.
import { createElement, Fragment, type ReactNode } from 'react';
import { createT, type Key, type Lang, locale, type Params, pickLang, template } from '../../shared/i18n/index.ts';
import { SplitError } from '../../shared/money.ts';

const webApp = window.Telegram?.WebApp;
const inTg = Boolean(webApp?.initData);

export const lang: Lang = inTg
  ? pickLang(webApp?.initDataUnsafe.user?.language_code)
  : pickLang(new URLSearchParams(location.search).get('lang'));

export const t = createT(lang);

document.documentElement.lang = lang;
document.title = t('common.brand');

export const dateLocale = locale(lang);

/** Like `t`, but params may be React nodes (e.g. a <Money/> inside a sentence). */
export function rich(key: Key, params: Record<string, ReactNode>): ReactNode {
  const plain: Params = {};
  for (const [k, v] of Object.entries(params)) if (typeof v === 'string' || typeof v === 'number') plain[k] = v;
  const parts = template(lang, key, plain).split(/\{(\w+)\}/);
  return createElement(
    Fragment,
    null,
    ...parts.map((part, i) =>
      i % 2 === 0 ? part : createElement(Fragment, { key: i }, part in params ? params[part] : `{${part}}`),
    ),
  );
}

/** Text of an error thrown by shared code (SplitError carries a key, not a text). */
export function errorText(e: unknown): string {
  return e instanceof SplitError ? t(e.key, e.params) : (e as Error).message;
}
