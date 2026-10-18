import { expect, test } from '@playwright/test';

// Каталог компонентов #/kit: служебный экран дизайн-кода (design/v1/README.md). Доступен только с ?dev=…

const BLOCKS = [
  'colors',
  'typography',
  'spacing',
  'radii',
  'sizes',
  'icons',
  'shell',
  'rows',
  'tiles',
  'people',
  'buttons',
  'choice',
  'fields',
  'patterns',
  'states',
];

for (const scheme of ['light', 'dark'] as const) {
  test(`каталог открывается в ${scheme === 'light' ? 'светлой' : 'тёмной'} теме`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/?dev=1#/kit');
    await expect(page.getByRole('heading', { name: 'Каталог компонентов' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-scheme', scheme);

    for (const id of BLOCKS) await expect(page.locator(`[data-kit=${id}]`)).toBeVisible();
    await expect(page.locator('[data-icon]')).toHaveCount(45);
    // Ключевые компоненты на месте.
    await expect(page.locator('.btn.pri').first()).toBeVisible();
    await expect(page.locator('.tile').first()).toBeVisible();
    await expect(page.locator('.avatar').first()).toBeVisible();
    await expect(page.locator('.segmented').first()).toBeVisible();
    await expect(page.locator('.switch').first()).toBeVisible();
    await expect(page.locator('.emb').first()).toBeVisible();
    await expect(page.locator('.mbtn').first()).toBeVisible();
    await expect(page.locator('.ok').first()).toBeVisible();
    // Токен тёмной пары действительно применился: фон экрана чёрный только в тёмной теме.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe(scheme === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(239, 239, 244)');
  });
}

test('переключатель темы и языка', async ({ page }) => {
  await page.goto('/?dev=1#/kit');
  await page.getByRole('button', { name: 'Тёмная' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-scheme', 'dark');
  await page.getByRole('button', { name: 'Светлая' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-scheme', 'light');

  await page.getByRole('button', { name: 'en', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Component catalog' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('без ?dev каталога нет', async ({ page }) => {
  await page.goto('/#/kit');
  await expect(page.getByText('Страница не найдена')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Каталог компонентов' })).toHaveCount(0);
});
