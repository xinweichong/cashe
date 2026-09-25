import { test, expect } from '@playwright/test';

// Exercises the real authenticated route (App -> AppShell -> TransactionsPage),
// not just the isolated component tests — see home-production.spec.ts for why
// this matters. Network is mocked; no backend/auth used.
//
// Regression for a real mobile-density complaint: on phone, the filter chrome
// (search, trip select, six type chips, category chips, date range, four
// quick-date chips, Export CSV) used to occupy the full first screen with no
// transaction visible at all. Filters now default collapsed on phone behind
// a "Filters" toggle with an active-filter-count badge; tablet/desktop keep
// them always visible since there's room.

import { TRANSACTIONS, mockAuthenticatedActivity } from '../fixtures/mocks';

test('production Activity keeps filters collapsed on phone until opened, with an active-count badge', async ({ page }) => {
  await mockAuthenticatedActivity(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/activity?type=refund');

  const filtersButton = page.getByRole('button', { name: /Filters/ });
  await expect(filtersButton).toBeVisible();
  await expect(filtersButton).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('1', { exact: true })).toBeVisible(); // active-filter badge
  await expect(page.getByRole('button', { name: 'Expense', exact: true })).toBeHidden();
  // The transaction list is reachable without opening filters first.
  await expect(page.getByText('NUS The Deck')).toBeVisible();

  await filtersButton.click();
  await expect(filtersButton).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Expense', exact: true })).toBeVisible();
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
