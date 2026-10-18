import { expect, test } from '@playwright/test';

test('все в расчёте: плашка, «Не сейчас» до следующей траты', async ({ page }) => {
  await page.goto('/?dev=31');
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await page.getByPlaceholder('Поездка в Грузию').fill('Финиш');
  await page.getByRole('button', { name: '+ Добавить участника' }).click();
  await page.getByPlaceholder('Имя участника').last().fill('Маша');
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await expect(page.getByRole('heading', { name: 'Финиш' })).toBeVisible();

  // Пока трат нет, предлагать нечего.
  const banner = page.locator('.finish-banner');
  await expect(banner).toHaveCount(0);

  // Платит и делится сам с собой по долям: балансы нулевые, но трата есть.
  await page.getByRole('button', { name: 'Добавить трату' }).click();
  await page.getByPlaceholder('За что? Например, ужин').fill('Билеты');
  await page.getByPlaceholder('0').fill('1000');
  await page.getByRole('button', { name: 'Добавить трату' }).click();
  await expect(page.locator('.bal-main')).toContainText('Вам должны');
  await expect(banner).toHaveCount(0);

  // Маша вернула долг: все в расчёте.
  const groupId = Number(new URL(page.url()).hash.match(/\/g\/(\d+)/)?.[1]);
  const headers = { Authorization: 'dev 31' };
  const detail = await (await page.request.get(`/api/groups/${groupId}`, { headers })).json();
  const masha = detail.members.find((m: { name: string }) => m.name === 'Маша');
  const today = new Date().toISOString().slice(0, 10);
  const payBack = async (amount: number) => {
    const res = await page.request.post(`/api/groups/${groupId}/expenses`, {
      headers,
      data: {
        kind: 'transfer',
        amount,
        payerId: masha.id,
        splitMode: 'exact',
        spentOn: today,
        shares: [{ memberId: detail.meId, value: amount }],
      },
    });
    expect(res.ok()).toBeTruthy();
  };
  await payBack(50000);
  await page.reload();
  await expect(banner).toContainText('Все в расчёте');

  // «Не сейчас» прячет плашку, в том числе после перезагрузки.
  await banner.getByRole('button', { name: 'Не сейчас' }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Финиш' })).toBeVisible();
  await expect(banner).toHaveCount(0);

  // Новая трата и новый расчёт — и предложение возвращается.
  const more = await page.request.post(`/api/groups/${groupId}/expenses`, {
    headers,
    data: {
      title: 'Кофе',
      amount: 20000,
      payerId: detail.meId,
      splitMode: 'equal',
      spentOn: today,
      shares: detail.members.map((m: { id: number }) => ({ memberId: m.id, value: 1 })),
    },
  });
  expect(more.ok()).toBeTruthy();
  await payBack(10000);
  await page.reload();
  await expect(banner).toContainText('Все в расчёте');
});

test('завершить поездку из плашки: архив и экран итогов', async ({ page }) => {
  await page.goto('/?dev=32');
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await page.getByPlaceholder('Поездка в Грузию').fill('Финиш 2');
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await expect(page.getByRole('heading', { name: 'Финиш 2' })).toBeVisible();

  // Один участник: после траты баланс нулевой сразу.
  await page.getByRole('button', { name: 'Добавить трату' }).click();
  await page.getByPlaceholder('За что? Например, ужин').fill('Билеты');
  await page.getByPlaceholder('0').fill('1000');
  await page.getByRole('button', { name: 'Добавить трату' }).click();
  const banner = page.locator('.finish-banner');
  await expect(banner).toContainText('Завершить поездку?');
  await banner.getByRole('button', { name: 'Завершить' }).click();
  await expect(page).toHaveURL(/#\/g\/\d+\/summary/);

  // Группа в архиве, плашки больше нет.
  const groupId = Number(new URL(page.url()).hash.match(/\/g\/(\d+)/)?.[1]);
  const res = await page.request.get(`/api/groups/${groupId}`, { headers: { Authorization: 'dev 32' } });
  expect((await res.json()).archived).toBe(true);
  await page.goto(`/?dev=32#/g/${groupId}`);
  await expect(page.getByRole('heading', { name: 'Финиш 2' })).toBeVisible();
  await expect(banner).toHaveCount(0);
});

test('настройки: «Завершить поездку» предупреждает о долгах, но даёт завершить', async ({ page }) => {
  await page.goto('/?dev=33');
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await page.getByPlaceholder('Поездка в Грузию').fill('Долги');
  await page.getByRole('button', { name: '+ Добавить участника' }).click();
  await page.getByPlaceholder('Имя участника').last().fill('Петя');
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await page.getByRole('button', { name: 'Добавить трату' }).click();
  await page.getByPlaceholder('За что? Например, ужин').fill('Ужин');
  await page.getByPlaceholder('0').fill('1000');
  await page.getByRole('button', { name: 'Добавить трату' }).click();
  await expect(page.locator('.finish-banner')).toHaveCount(0);

  page.once('dialog', (d) => {
    expect(d.message()).toContain('Не все рассчитались');
    void d.accept();
  });
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByText('Завершить поездку', { exact: true }).click();
  await expect(page).toHaveURL(/#\/g\/\d+\/summary/);
});
