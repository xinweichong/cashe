import { test, expect } from '@playwright/test';

// Exercises the real authenticated route (App -> AppShell -> TransactionsPage),
// not just the isolated component tests — see home-production.spec.ts for why
// this matters. Network is mocked; no backend/auth used.
//
// Regression for a real mobile-density complaint: on phone, the filter chrome
// (search, trip select, six type chips, category chips, date range, four
// quick-date chips, Export CSV) used to occupy the full first screen with no
// transaction visible at all. On phone the filters now open in a sheet from
// the thumb-band dock, with an active-filter-count badge; tablet/desktop keep
// them always visible since there's room.

import { TRANSACTIONS, mockAuthenticatedActivity } from '../fixtures/mocks';

test('production Activity puts filters one tap away on phone, with an active-count badge', async ({ page }) => {
  await mockAuthenticatedActivity(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/activity?category=Food');

  // The filter controls live in a sheet, not above the list.
  const filtersButton = page.getByRole('button', { name: 'Filters, 1 active' });
  await expect(filtersButton).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expense', exact: true })).toBeHidden();
  // The transaction list is reachable without opening filters first.
  await expect(page.getByText('NUS The Deck')).toBeVisible();

  await filtersButton.click();
  await expect(page.getByRole('dialog', { name: 'Filters' }).getByRole('button', { name: 'Expense', exact: true })).toBeVisible();
});

test('production Activity shows filters expanded by default on desktop, with no Filters toggle', async ({ page }) => {
  await mockAuthenticatedActivity(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/activity');
  await expect(page.getByRole('button', { name: 'Expense', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Filters/ })).toBeHidden();
});

test('closing a transaction detail returns focus to the row that opened it, keeping filters', async ({ page }) => {
  await mockAuthenticatedActivity(page);
  // Registered after the catch-all, so these win for the detail's own reads.
  await page.route('**/api/v2/transactions/2', (route) => route.fulfill({ json: TRANSACTIONS[1] }));
  await page.route('**/api/v2/transactions/2/provenance', (route) => route.fulfill({ json: { transaction_id: 2, sources: [] } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/activity?category=Food');
  const row = page.locator('#tx-row-2');
  await expect(row).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(/\/activity\/2\?category=Food/);
  await page.getByRole('button', { name: 'Close transaction' }).click();
  await expect(page).toHaveURL(/\/activity\?category=Food$/);
  await expect(row).toBeFocused();
});

for (const theme of ['light', 'dark'] as const) {
  test(`Activity filter chips use the shared ChoiceChip owner (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => window.localStorage.setItem('cashe-appearance', t), theme);
    await mockAuthenticatedActivity(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/activity?category=Food');
    const food = page.getByRole('button', { name: 'Food', pressed: true });
    await expect(food).toBeVisible();
    await expect(page.getByRole('button', { name: 'All', exact: true, pressed: false })).toBeVisible();
    await page.locator('#transaction-filter-controls').screenshot({ path: `e2e/screenshots/activity-chips-${theme}.png` });
  });
}

test('an in-progress edit survives resizing to phone and switching theme', async ({ page }) => {
  await mockAuthenticatedActivity(page);
  await page.route('**/api/v2/transactions/2', (route) => route.fulfill({ json: TRANSACTIONS[1] }));
  await page.route('**/api/v2/transactions/2/provenance', (route) => route.fulfill({ json: { transaction_id: 2, sources: [] } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/activity/2');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const merchant = page.getByLabel('Merchant');
  await merchant.fill('Draft merchant name');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Merchant')).toHaveValue('Draft merchant name');
  await expect(page.getByLabel('Merchant')).toHaveCount(1); // no duplicate responsive form

  await page.setViewportSize({ width: 1440, height: 900 });
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.getByRole('button', { name: 'Profile menu' }).click();
  await page.getByRole('menuitemradio', { name: before === 'dark' ? 'Light' : 'Dark' }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(before);
  await expect(page.getByLabel('Merchant')).toHaveValue('Draft merchant name');
});
