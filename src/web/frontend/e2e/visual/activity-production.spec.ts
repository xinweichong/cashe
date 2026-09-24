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

const TRANSACTIONS = [
  { id: 1, revision: 1, source: 'manual', type: 'expense', merchant: 'NUS The Deck', category: 'Food', original: { minor_units: 130, currency: 'SGD' }, reporting: { minor_units: 130, currency: 'SGD' }, conversion: { status: 'native', rate: null, source: null, quoted_at: null }, transaction_date: '2026-09-17T11:22:00', ingested_at: '2026-09-17T11:22:00', description: null, refund_of: null, refunded_by: [], excluded_from_baseline: false },
  { id: 2, revision: 1, source: 'manual', type: 'expense', merchant: 'Japanese Cuisine', category: 'Food', original: { minor_units: 500, currency: 'SGD' }, reporting: { minor_units: 500, currency: 'SGD' }, conversion: { status: 'native', rate: null, source: null, quoted_at: null }, transaction_date: '2026-09-17T09:00:00', ingested_at: '2026-09-17T09:00:00', description: null, refund_of: null, refunded_by: [], excluded_from_baseline: false },
];

async function mockAuthenticatedActivity(page: import('@playwright/test').Page) {
  await page.route('**/api/ping', (route) => route.fulfill({ json: { status: 'ok' } }));
  await page.route('**/api/users/me', (route) => route.fulfill({ json: {
    username: 'test', gmail_connected: false, telegram_chat_id: null, wants_gmail: false,
    wants_apple_wallet: false, onboarding_complete: true, force_password_change: false,
  } }));
  await page.route('**/api/settings', (route) => route.fulfill({ json: {
    anomaly_multiplier: 2, velocity_alert_threshold: 2, budgets_enabled: false, goals_enabled: true,
    trips_enabled: false, subscriptions_enabled: true, recurring_enabled: false, home_briefing_enabled: true,
  } }));
  await page.route('**/api/categories', (route) => route.fulfill({ json: [
    { name: 'Food', keywords: null, icon: null, color: null, type: 'wants' },
  ] }));
  await page.route('**/api/trips**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v2/home', (route) => route.fulfill({ json: {
    facts: { as_of: '2026-09-17', timezone: 'Asia/Singapore', undated_count: 0, current: { start: '2026-09-01', end: '2026-09-17', spending: { minor_units: 0, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 0, unresolved_count: 0, indicative_count: 0, status: 'complete' }, comparison_current: { start: '2026-08-01', end: '2026-08-17', spending: { minor_units: 0, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 0, unresolved_count: 0, indicative_count: 0, status: 'complete' }, previous: { start: '2026-08-01', end: '2026-08-17', spending: { minor_units: 0, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 0, unresolved_count: 0, indicative_count: 0, status: 'complete' }, change: null, category_changes: [], top_category_driver: null, trip_drivers: [] },
    spending_target: null, recent: [], upcoming: [], upcoming_total: { minor_units: 0, currency: 'SGD' }, upcoming_unknown_count: 0, increased_commitments: [], capture_issue_count: 0, followup_issue_count: 0, review_count: 0, recurring_suggestion_count: 0,
    freshness: { gmail_connected: false, gmail_last_checked: null, gmail_needs_reconnection: false, last_capture_processed_at: null },
  } }));
  await page.route('**/api/v2/transactions**', (route) => route.fulfill({ json: TRANSACTIONS }));
  await page.route('**/api/v2/transactions/daily-totals**', (route) => route.fulfill({ json: [] }));
}

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
