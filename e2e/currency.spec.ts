import { expect, test } from '@playwright/test';

const text = (s: string | null) => (s ?? '').replace(/[\s {2}]+/g, ' ').trim();

test('трата в лари: курс недоступен, вводим вручную, в списке видна исходная сумма', async ({ page }) => {
  // Источник курсов «недоступен»: тест не должен зависеть от сети.
  await page.route('**/api/rates*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Курсы сейчас недоступны — введите курс вручную' }),
    }),
  );

  await page.goto('/?dev=21');
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await page.getByPlaceholder('Поездка в Грузию').fill('Тбилиси');
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await expect(page.getByRole('heading', { name: 'Тбилиси' })).toBeVisible();

  await page.getByRole('button', { name: 'Добавить трату' }).click();
  await page.getByPlaceholder('За что? Например, ужин').fill('Хинкали');
  await page.getByPlaceholder('0').fill('100');
  await page.getByLabel('Валюта траты').selectOption('GEL');
  await expect(page.getByText('Курсы сейчас недоступны')).toBeVisible();

  await page.getByPlaceholder('Введите курс вручную').fill('34,5');
  await expect(page.getByText('≈ 3 450 ₽ по курсу 34,5', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Добавить трату' }).click();

  // Баланс считается в рублях, исходная сумма — мелким шрифтом.
  const row = page.locator('.row', { hasText: 'Хинкали' });
  await expect(row).toContainText('3 450');
  await expect(row).toContainText('100');
  await expect(row).toContainText('100 GEL');

  // При редактировании валюта и курс восстанавливаются.
  await row.click();
  await expect(page.getByLabel('Валюта траты')).toHaveValue('GEL');
  await expect(page.getByLabel('Курс')).toHaveValue('34,5');
  await expect(page.getByPlaceholder('0').first()).toHaveValue('100');
  expect(text(await page.locator('.amt-note').first().textContent())).toContain('3 450');
});
