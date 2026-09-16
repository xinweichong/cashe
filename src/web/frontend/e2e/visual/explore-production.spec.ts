import { test, expect } from '@playwright/test';

// Exercises the real authenticated route (App -> AppShell -> ExplorePage ->
// ExplorePatternsPage) with mocked network, not just isolated component
// tests — see e2e/visual/home-production.spec.ts for why this matters
// (AppShell's layout isn't present in unit tests).

const PERIOD = { start: '2026-09-01', end: '2026-09-10', spending: { minor_units: 49826, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 5, unresolved_count: 0, indicative_count: 0, status: 'complete' };
const MONTH_FACTS = {
  as_of: '2026-09-10', timezone: 'Asia/Singapore', undated_count: 0,
  current: PERIOD, comparison_current: PERIOD, previous: { ...PERIOD, start: '2026-08-01', end: '2026-08-10' },
  change: { minor_units: 2000, currency: 'SGD' },
  category_changes: [
    { category: 'Food', change: { minor_units: 2000, currency: 'SGD' } },
    { category: 'Shopping', change: { minor_units: -800, currency: 'SGD' } },
  ],
  top_category_driver: null, trip_drivers: [],
};
const WEEKDAY_PATTERN = {
  start: '2026-08-24', end: '2026-09-06', weeks: 2,
  pattern: Array.from({ length: 7 }, (_, weekday) => ({ weekday, average: { minor_units: (weekday + 1) * 500, currency: 'SGD' }, transaction_count: weekday })),
};
const SUBSCRIPTION_REVIEW = { overdue: [], annual_renewals: [], price_changes: [] };

async function mockAuthenticatedExplore(page: import('@playwright/test').Page) {
  await page.route('**/api/ping', (route) => route.fulfill({ json: { status: 'ok' } }));
  await page.route('**/api/users/me', (route) => route.fulfill({ json: {
    username: 'test', gmail_connected: false, telegram_chat_id: null, wants_gmail: false,
    wants_apple_wallet: false, onboarding_complete: true, force_password_change: false,
  } }));
  await page.route('**/api/settings', (route) => route.fulfill({ json: {
    anomaly_multiplier: 2, velocity_alert_threshold: 2, budgets_enabled: true, goals_enabled: true,
    trips_enabled: true, subscriptions_enabled: true, recurring_enabled: true, home_briefing_enabled: true,
  } }));
  await page.route('**/api/categories', (route) => route.fulfill({ json: [
    { name: 'Food', keywords: null, icon: null, color: null, type: 'wants' },
    { name: 'Shopping', keywords: null, icon: null, color: null, type: 'wants' },
  ] }));
  await page.route('**/api/v2/spending/month**', (route) => route.fulfill({ json: MONTH_FACTS }));
  await page.route('**/api/v2/spending/weekday-pattern**', (route) => route.fulfill({ json: WEEKDAY_PATTERN }));
  await page.route('**/api/v2/subscriptions/review**', (route) => route.fulfill({ json: SUBSCRIPTION_REVIEW }));
  await page.route('**/api/v2/spending/merchants**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v2/spending/trend-by-category**', (route) => route.fulfill({ json: [
    { date: '2026-09-01', categories: { Food: { minor_units: 1200, currency: 'SGD' } } },
    { date: '2026-09-02', categories: { Food: { minor_units: 800, currency: 'SGD' } } },
  ] }));
  await page.route('**/api/trips**', (route) => route.fulfill({ json: [] }));
}

test('production Explore switches modes and preserves selection in the URL', async ({ page }) => {
  await mockAuthenticatedExplore(page);
  await page.goto('/explore');
  await expect(page.getByRole('tab', { name: 'Over time' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(/Average per weekday/)).toBeVisible();

  await page.getByRole('tab', { name: 'By category' }).click();
  await expect(page).toHaveURL(/mode=by-category/);
  const foodBar = page.getByRole('button', { name: /^Food/ });
  await expect(foodBar).toBeVisible();
  await foodBar.click();
  await expect(page.getByRole('link', { name: 'This period' })).toBeVisible();

  await page.getByRole('tab', { name: 'By merchant' }).click();
  await expect(page).toHaveURL(/mode=by-merchant/);
  await expect(page.getByText('No spending in this category yet.')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('tab', { name: 'By merchant' })).toHaveAttribute('aria-selected', 'true');
});

test('production Explore top-level nav shows the teal active accent', async ({ page }) => {
  await mockAuthenticatedExplore(page);
  await page.goto('/explore');
  const spendingPatternsLink = page.getByRole('link', { name: 'Spending patterns' });
  await expect(spendingPatternsLink).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: 'e2e/screenshots/explore-production.png', fullPage: true });
});

test('Over time mode charts the default top-mover categories', async ({ page }) => {
  await mockAuthenticatedExplore(page);
  await page.goto('/explore');
  const foodChip = page.getByRole('button', { name: 'Food' });
  await expect(foodChip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.recharts-line').first()).toBeVisible();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'e2e/screenshots/explore-over-time-production.png', fullPage: true });
});

test('By category shows main visual and inspection panel side by side on desktop, stacked on phone', async ({ page }) => {
  await mockAuthenticatedExplore(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/explore');
  await page.getByRole('tab', { name: 'By category' }).click();
  await expect(page.getByRole('tab', { name: 'By category' })).toHaveAttribute('aria-selected', 'true');
  const mainCard = page.getByText('What changed', { exact: true }).locator('xpath=ancestor::div[contains(@class, "rounded-md")][1]');
  const inspectionCard = page.getByText('Select a bar in "What changed"').locator('xpath=ancestor::div[contains(@class, "rounded-md")][1]');
  await expect(inspectionCard).toBeVisible();
  const mainBox = (await mainCard.boundingBox())!;
  const inspectionBox = (await inspectionCard.boundingBox())!;
  expect(inspectionBox.x).toBeGreaterThan(mainBox.x + mainBox.width - 10); // side by side, not stacked
  await page.screenshot({ path: 'e2e/screenshots/explore-by-category-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('tab', { name: 'By category' }).click();
  await expect(page.getByText('Select a bar in "What changed"')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/explore-by-category-phone.png', fullPage: true });
});
