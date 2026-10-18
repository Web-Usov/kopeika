import { expect, test } from '@playwright/test';

test('быстрая трата: «1200 такси» добавляется сразу, «ужин 50 eur» открывает форму', async ({ page }) => {
  await page.route('**/api/rates*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rate: '100', source: 'test', date: '2026-01-01' }),
    }),
  );
  await page.goto('/?dev=31');
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await page.getByPlaceholder('Поездка в Грузию').fill('Быстрые');
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await expect(page.getByRole('heading', { name: 'Быстрые' })).toBeVisible();

  const quick = page.getByLabel('Быстрая трата');
  await quick.fill('1200 такси');
  const chip = page.locator('.qp');
  await expect(chip).toContainText('Такси');
  await expect(chip).toContainText('1 200');
  await expect(chip).toContainText('поровну на всех · платили вы');
  await quick.press('Enter');

  const row = page.locator('.row', { hasText: 'Такси' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('1 200');
  await expect(row.locator('.tile')).toBeVisible();
  await expect(quick).toHaveValue('');

  // Не распознали сумму — подсказка, кнопок нет.
  await quick.fill('просто так');
  await expect(page.getByText('Не вижу сумму')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить', exact: true })).toHaveCount(0);

  // «Изменить» открывает форму с подставленными значениями.
  await quick.fill('кофе 350');
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
  await expect(page.getByPlaceholder('За что? Например, ужин')).toHaveValue('Кофе');
  await expect(page.getByPlaceholder('0').first()).toHaveValue('350');
  await page.goBack();

  // Другая валюта: сразу не создаём, открываем форму с суммой, валютой и курсом.
  await quick.fill('ужин 50 eur');
  await expect(page.getByRole('button', { name: 'Добавить', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Указать курс' }).click();
  await expect(page.getByPlaceholder('За что? Например, ужин')).toHaveValue('Ужин');
  await expect(page.getByPlaceholder('0').first()).toHaveValue('50');
  await expect(page.getByLabel('Валюта траты')).toHaveValue('EUR');
  await expect(page.locator('input.rate')).toHaveValue('100');
});
