import { expect, test } from '@playwright/test';

test('English interface with ?lang=en', async ({ page }) => {
  await page.goto('/?dev=7&lang=en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Kopeika' })).toBeVisible();
  await expect(page.getByText('How it works')).toBeVisible();

  await page.getByRole('button', { name: 'Create group' }).click();
  await page.getByPlaceholder('Trip to Georgia').fill('Cabin');
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByRole('heading', { name: 'Cabin' })).toBeVisible();
  await expect(page.locator('.my-balance')).toHaveText("You're settled up");
});
