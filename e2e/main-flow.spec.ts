import { expect, test } from '@playwright/test';

// Intl puts non-breaking spaces into amounts; compare with them normalized.
const text = (s: string | null) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();

test('создать группу, добавить трату, присоединиться по приглашению, рассчитаться', async ({
  page,
  browser,
  request,
}) => {
  // 1. Пользователь 1 создаёт группу.
  await page.goto('/?dev=1');
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await page.getByPlaceholder('Поездка в Грузию').fill('Поездка');
  for (const name of ['Маша', 'Петя']) {
    await page.getByRole('button', { name: 'Добавить участника' }).click();
    await page.getByPlaceholder('Имя участника').last().fill(name);
  }
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await expect(page.getByRole('heading', { name: 'Поездка' })).toBeVisible();

  // 2. Трата 1000 поровну.
  await page.getByRole('button', { name: 'Добавить трату' }).click();
  await page.getByPlaceholder('За что? Например, ужин').fill('Ужин');
  await page.getByPlaceholder('0').fill('1000');
  await page.getByRole('button', { name: 'Добавить трату' }).click();
  const balance = page.locator('.bal-main');
  await expect.poll(async () => text(await balance.innerText())).toBe('Вам должны 666,66 ₽');

  // В «Истории» видно, что трата добавлена.
  await page.getByRole('button', { name: 'История' }).click();
  await expect(page.locator('.row.activity').first()).toContainText('добавил(а) «Ужин»');
  await page.getByRole('button', { name: 'Траты' }).click();

  // Код приглашения — из API.
  const groupId = Number(new URL(page.url()).hash.match(/\/g\/(\d+)/)?.[1]);
  expect(groupId).toBeGreaterThan(0);
  const res = await request.get(`/api/groups/${groupId}`, { headers: { Authorization: 'dev 1' } });
  expect(res.ok()).toBeTruthy();
  const { inviteCode } = await res.json();
  expect(inviteCode).toBeTruthy();

  // Пользователь 1 указал реквизиты — должник их увидит.
  const put = await request.put('/api/me/payment-info', {
    headers: { Authorization: 'dev 1' },
    data: { phone: '8 900 123-45-67', bank: 'Т-Банк' },
  });
  expect(put.ok()).toBeTruthy();

  // 3. Пользователь 2 открывает приглашение и выбирает «Маша».
  const ctx2 = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page2 = await ctx2.newPage();
  await page2.goto(`/?dev=2&startapp=${inviteCode}`);
  await page2.getByText('Маша', { exact: true }).click();
  await page2.getByRole('button', { name: 'Присоединиться' }).click();
  await expect.poll(async () => text(await page2.locator('.bal-main').innerText())).toBe('Вы должны 333,33 ₽');

  // 4. Вкладка «Балансы»: «Отметить перевод» у своего долга.
  await page2.getByRole('button', { name: 'Балансы' }).click();
  await expect(page2.getByText('+79001234567 · Т-Банк')).toBeVisible();
  await expect(page2.getByRole('button', { name: 'Скопировать номер' })).toBeVisible();
  await page2.getByRole('button', { name: 'Отметить перевод' }).click();
  await page2.getByRole('button', { name: 'Сохранить перевод' }).click();
  await expect.poll(async () => text(await page2.locator('.bal-main').innerText())).toBe('Баланс Вы в расчёте');
  // Долги закрылись — праздничный оверлей; закрывается тапом и не возвращается.
  const celebration = page2.getByRole('dialog');
  await expect(celebration).toContainText('в расчёте');
  await celebration.getByRole('button', { name: 'Отлично' }).click();
  await expect(celebration).toBeHidden();
  await ctx2.close();
});
