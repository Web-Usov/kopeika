import { expect, test } from '@playwright/test';

test('первый запуск: шаги, пример с тратами, удаление примера', async ({ page }) => {
  await page.goto('/?dev=4101');
  await expect(page.getByText('Создайте группу', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Пригласите друзей')).toBeVisible();
  await expect(page.getByText('Записывайте траты')).toBeVisible();

  await page.getByRole('button', { name: 'Посмотреть на примере' }).click();
  await expect(page.getByRole('heading', { name: 'Дача на выходные' })).toBeVisible();
  await expect(page.getByText('Это пример')).toBeVisible();
  await expect(page.getByText('Аренда дома')).toBeVisible();
  await expect(page.locator('.row-title').filter({ hasText: 'Шашлык и напитки' })).toBeVisible();

  // На главной пример помечен значком.
  await page.goto('/?dev=4101');
  await expect(page.locator('.badge')).toHaveText('пример');

  // Удаление примера возвращает шаги.
  await page.getByText('Дача на выходные').click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Удалить пример' }).click();
  await expect(page.getByRole('button', { name: 'Посмотреть на примере' })).toBeVisible();
});

test('в своей группе пустое состояние зовёт пригласить', async ({ page }) => {
  await page.goto('/?dev=4102');
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await page.getByPlaceholder('Поездка в Грузию').fill('Одна');
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await expect(page.getByRole('heading', { name: 'Одна' })).toBeVisible();
  await expect(page.getByText('Трат пока нет')).toBeVisible();
  await expect(page.getByText('Пока вы здесь один')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Пригласить друзей' })).toBeVisible();
});
