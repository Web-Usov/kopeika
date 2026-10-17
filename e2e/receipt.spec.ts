import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';

const photo = fileURLToPath(new URL('./fixtures/receipt.jpg', import.meta.url));

// Intl puts non-breaking spaces into amounts; compare with them normalized.
const text = (s: string | null) => (s ?? '').replace(/[\s {2}]+/g, ' ').trim();

const draft = {
  merchant: 'Хинкальная',
  date: '2026-10-16',
  currency: 'GEL',
  items: [
    { id: 'i1', name: 'Хинкали', quantity: '2', amount: 2400 },
    { id: 'i2', name: 'Лимонад', amount: 500 },
  ],
  adjustments: [{ kind: 'service', label: 'Сервис 10%', amount: 290, percent: '10' }],
  total: 3500, // the lines make 3190: does not add up
  mismatch: true,
  confidence: 'medium',
  warnings: ['qty_mismatch'],
};

/** The server has no recognition key in e2e: pretend the feature is on (the account and the group say so). */
async function enableReceipts(page: Page, { consent = true } = {}) {
  await page.route('**/api/me', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      json: { ...(await res.json()), receiptsEnabled: true, receiptConsent: consent },
    });
  });
  await page.route(/\/api\/groups\/\d+$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const receipts = { enabled: true, unlimited: false, used: 2, limit: 5, resetsAt: null };
    await route.fulfill({ response: res, json: { ...(await res.json()), receipts } });
  });
}

/** No real API: receipts are "enabled" and the parse answer is fixed. */
async function mockReceipts(page: Page, parse: (body: { image: string; mediaType: string }) => void) {
  await enableReceipts(page);
  await page.route('**/api/groups/*/receipts/parse', async (route) => {
    parse(route.request().postDataJSON());
    await route.fulfill({ json: draft });
  });
}

async function openReceipt(page: Page) {
  await page.goto('/?dev=21');
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await page.getByPlaceholder('Поездка в Грузию').fill('Ужин в Тбилиси');
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await expect(page.getByRole('heading', { name: 'Ужин в Тбилиси' })).toBeVisible();
  await page.getByRole('button', { name: 'Добавить трату' }).click();
  await page.getByText('📷 Разобрать чек').click();
}

test('чек: фото → черновик → правка → расхождение', async ({ page }) => {
  let sent: { image: string; mediaType: string } | undefined;
  await mockReceipts(page, (b) => {
    sent = b;
  });
  await openReceipt(page);

  // The photo goes up shrunk, as a JPEG.
  await page.locator('input[type="file"]:not([capture])').setInputFiles(photo);
  await expect(page.getByLabel('Название').first()).toHaveValue('Хинкали');
  expect(sent?.mediaType).toBe('image/jpeg');
  expect(
    Buffer.from(sent?.image ?? '', 'base64')
      .subarray(0, 3)
      .toString('hex'),
  ).toBe('ffd8ff');

  // Draft from the answer: header, items, the extra, hints.
  await expect(page.getByPlaceholder('Заведение')).toHaveValue('Хинкальная');
  await expect(page.getByLabel('Валюта чека')).toHaveValue('GEL');
  await expect(page.getByLabel('Название').nth(1)).toHaveValue('Лимонад');
  await expect(page.getByText('количество на цену')).toBeVisible();

  // 3190 against 3500: a warning, "Next" is locked.
  const next = page.getByRole('button', { name: 'Далее' });
  await expect(page.locator('.receipt-check')).toContainText('Не сходится');
  await expect(next).toBeDisabled();

  // Accept the difference as "Other": it adds up now.
  await page.getByRole('button', { name: 'Добавить «Прочее» на разницу' }).click();
  await expect(page.locator('.receipt-check')).toHaveText('Сходится с чеком');
  await expect(next).toBeEnabled();

  // Edit an amount: mismatch again; accept the sum of the items.
  await page.getByLabel('Сумма').nth(1).fill('6');
  await expect(page.locator('.receipt-check')).toContainText('Не сходится');
  await expect(next).toBeDisabled();
  await page.getByRole('button', { name: 'Принять сумму по позициям' }).click();
  await expect(next).toBeEnabled();
  await expect.poll(async () => text(await page.locator('.receipt-sum').textContent())).toBe('36 GEL');

  // An empty name blocks, a new row works, deleting restores.
  await page.getByRole('button', { name: '+ Добавить позицию' }).click();
  await expect(next).toBeDisabled();
  await page.getByRole('button', { name: 'Удалить позицию' }).last().click();
  await expect(next).toBeEnabled();

  await next.click();
  await expect(page.getByText('Следующий шаг: кто что ел (в работе)')).toBeVisible();
  // Back to the editor keeps the edits.
  await page.getByRole('button', { name: 'Вернуться к позициям' }).click();
  await expect(page.getByLabel('Сумма').nth(1)).toHaveValue('6');
});

test('чек: ручной ввод без фото, английский', async ({ page }) => {
  await mockReceipts(page, () => {});
  await page.goto('/?dev=22&lang=en');
  await page.getByRole('button', { name: 'Create group' }).click();
  await page.getByPlaceholder('Trip to Georgia').fill('Cabin');
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByRole('heading', { name: 'Cabin' })).toBeVisible();
  await page.getByRole('button', { name: 'Add expense' }).click();
  await page.getByText('📷 Scan a receipt').click();
  await page.getByRole('button', { name: 'Enter manually' }).click();

  const next = page.getByRole('button', { name: 'Next' });
  await expect(next).toBeDisabled();
  await page.getByPlaceholder('Name').fill('Pizza');
  await page.getByLabel('Amount').fill('12,5');
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.getByText('Next step: who ate what (in progress)')).toBeVisible();
});

test('чек: нужно согласие, потом повтор', async ({ page }) => {
  let calls = 0;
  let consented = false;
  await enableReceipts(page, { consent: false });
  await page.route('**/api/me/receipt-consent', async (route) => {
    consented = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/groups/*/receipts/parse', async (route) => {
    calls++;
    expect(consented).toBe(true); // nothing is uploaded before the user agrees
    await route.fulfill({ json: { ...draft, mismatch: false, total: null, warnings: [] } });
  });
  await openReceipt(page);
  await page.locator('input[type="file"]:not([capture])').setInputFiles(photo);

  await expect(page.getByRole('heading', { name: 'Отправить фото на распознавание?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Политика конфиденциальности' })).toBeVisible();
  await page.getByRole('button', { name: 'Согласен, отправить' }).click();
  await expect(page.getByPlaceholder('Заведение')).toHaveValue('Хинкальная');
  expect(calls).toBe(1);
});

test('чек: сервер просит согласие уже при отправке (409), потом повтор', async ({ page }) => {
  let calls = 0;
  await enableReceipts(page); // /me says "agreed", the server disagrees
  await page.route('**/api/me/receipt-consent', (route) => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/groups/*/receipts/parse', async (route) => {
    calls++;
    if (calls === 1) await route.fulfill({ status: 409, json: { error: 'Нужно согласие' } });
    else await route.fulfill({ json: draft });
  });
  await openReceipt(page);
  await page.locator('input[type="file"]:not([capture])').setInputFiles(photo);
  await page.getByRole('button', { name: 'Согласен, отправить' }).click();
  await expect(page.getByPlaceholder('Заведение')).toHaveValue('Хинкальная');
  expect(calls).toBe(2);
});

test('чек: ошибка «не чек» показывает текст и ручной ввод', async ({ page }) => {
  await enableReceipts(page);
  await page.route('**/api/groups/*/receipts/parse', (route) =>
    route.fulfill({ status: 400, json: { error: 'Не похоже на чек.' } }),
  );
  await openReceipt(page);
  await page.locator('input[type="file"]:not([capture])').setInputFiles(photo);
  await expect(page.getByText('Не похоже на чек.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Попробовать ещё раз' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ввести вручную' }).click();
  await expect(page.getByRole('button', { name: 'Далее' })).toBeDisabled();
});
