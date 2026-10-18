import { type Lang, pickLang } from '../../shared/i18n/index.ts';
import { type Policy, policy, type ReceiptsProvider } from '../../shared/privacy.ts';
import { terms } from '../../shared/terms.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `?lang=` wins, then the first language of Accept-Language; Russian when neither is usable. */
export function privacyLang(query: string | undefined, acceptLanguage: string | undefined): Lang {
  if (query === 'ru' || query === 'en') return query;
  const first = acceptLanguage?.split(',')[0]?.trim();
  return first ? pickLang(first) : 'ru';
}

/** A plain, self-contained page for the public policy URL (set in @BotFather). Names the receipt provider in use. */
export const renderPrivacyHtml = (lang: Lang, receipts: ReceiptsProvider): string =>
  renderDocHtml(policy(lang, receipts), lang);

/** The same for the public Terms of Service URL. */
export const renderTermsHtml = (lang: Lang): string => renderDocHtml(terms[lang], lang);

function renderDocHtml(p: Policy, lang: Lang): string {
  const other: Lang = lang === 'ru' ? 'en' : 'ru';
  const body = p.sections
    .map(
      (s) =>
        `<h2>${esc(s.heading)}</h2>` +
        (s.paragraphs ?? []).map((x) => `<p>${esc(x)}</p>`).join('') +
        (s.items?.length ? `<ul>${s.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''),
    )
    .join('');
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title>
<style>
:root{color-scheme:light dark}
body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:680px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 8px}
.meta{color:#888;font-size:14px}ul{padding-left:20px}li{margin:6px 0}a{color:#2481cc}
</style>
</head>
<body>
<p class="meta"><a href="?lang=${other}">${other === 'ru' ? 'Русский' : 'English'}</a></p>
<h1>${esc(p.title)}</h1>
<p class="meta">${esc(p.updated)}</p>
<p>${esc(p.intro)}</p>
${body}
</body>
</html>
`;
}
