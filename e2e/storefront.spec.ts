// Store preview screenshots (BotFather > Main Mini App > previews, tApps Center, FindMini).
// Not part of the normal e2e run: playwright.config.ts ignores this file, `npm run storefront:shots` runs it.
// It seeds the demo group (POST /api/demo) for a fresh dev user and captures five screens in ru and en,
// light and dark, into docs/storefront/. Telegram does not publish preview dimensions, so we use
// 1170x2532: a 390x844 CSS-pixel phone at 3x, the usual modern iPhone portrait screenshot.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const OUT = join(import.meta.dirname, '..', 'docs', 'storefront');

const LANGS = {
  ru: { userBase: 9100, dinner: 'Ужин', name: 'Алексей' },
  en: { userBase: 9200, dinner: 'Dinner', name: 'Alex' },
} as const;
const THEMES = ['light', 'dark'] as const;

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, reducedMotion: 'reduce' });

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  // The demo banner and the dev-only back link are not for a store listing.
  await page.addStyleTag({ content: '.banner, .dev-back, .app-version { display: none !important; }' });
  await page.waitForTimeout(300);
}

for (const lang of ['ru', 'en'] as const) {
  test.describe(lang, () => {
    test.use({ locale: lang });
    for (const theme of THEMES) {
      test(`storefront ${lang} ${theme}`, async ({ page, request }) => {
        mkdirSync(OUT, { recursive: true });
        const { userBase, dinner, name } = LANGS[lang];
        const userId = userBase + (theme === 'dark' ? 1 : 0);
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        // Dev auth only: a human name instead of "Tester 9100".
        await page.route('**/api/**', (route) =>
          route.continue({ headers: { ...route.request().headers(), 'x-dev-name': encodeURIComponent(name) } }),
        );

        const res = await request.post('/api/demo', {
          headers: { Authorization: `dev ${userId}`, 'X-Lang': lang, 'X-Dev-Name': encodeURIComponent(name) },
        });
        expect(res.ok()).toBeTruthy();
        const groupId = (await res.json()).id as number;

        const shoot = async (n: number, name: string, hash: string) => {
          await page.goto(`/?dev=${userId}&lang=${lang}#${hash}`);
          await page.reload();
          await settle(page);
          await page.screenshot({
            path: join(OUT, `${lang}-${theme}-${n}-${name}.jpg`),
            type: 'jpeg',
            quality: 85,
          });
        };

        await shoot(1, 'home', '/');
        await shoot(2, 'expenses', `/g/${groupId}`);
        await shoot(3, 'balances', `/g/${groupId}?tab=balances`);
        await shoot(4, 'summary', `/g/${groupId}/summary`);

        await page.goto(`/?dev=${userId}&lang=${lang}#/g/${groupId}/expense/new`);
        await page.reload();
        await page.getByPlaceholder('0').first().waitFor();
        await page.getByPlaceholder(lang === 'ru' ? 'За что? Например, ужин' : /^What was it for/).fill(dinner);
        await page
          .getByPlaceholder('0')
          .first()
          .fill(lang === 'ru' ? '3200' : '64');
        await settle(page);
        await page.screenshot({ path: join(OUT, `${lang}-${theme}-5-expense-form.jpg`), type: 'jpeg', quality: 85 });
      });
    }
  });
}
