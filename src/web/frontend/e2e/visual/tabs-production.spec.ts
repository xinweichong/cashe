import { test, expect, type Page } from '@playwright/test';

// Same-panel mode switches use the shared Tabs owner (U05); route-level
// selectors reuse its recipe via aria-current instead of copying classes.
// Network is mocked; unmocked endpoints fail harmlessly.

async function mockShell(page: Page, homeBriefing: boolean) {
  await page.route('**/api/ping', (route) => route.fulfill({ json: { status: 'ok' } }));
  await page.route('**/api/users/me', (route) => route.fulfill({ json: {
    username: 'test', gmail_connected: false, telegram_chat_id: null, wants_gmail: false,
    wants_apple_wallet: false, onboarding_complete: true, force_password_change: false,
  } }));
  await page.route('**/api/settings', (route) => route.fulfill({ json: {
    anomaly_multiplier: 2, velocity_alert_threshold: 2, budgets_enabled: false, goals_enabled: false,
    trips_enabled: false, subscriptions_enabled: false, recurring_enabled: false, home_briefing_enabled: homeBriefing,
  } }));
  await page.route('**/api/categories', (route) => route.fulfill({ json: [] }));
}

async function tealOf(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.color = 'var(--color-teal)';
    document.body.appendChild(probe);
    const v = getComputedStyle(probe).color;
    probe.remove();
    return v;
  });
}

// Explore's Spending patterns and Insights merged into one dashboard
// (2026-09-25), which removed the route selector and the Insight period
// tabs. Its pattern modes are now the same-panel switch to hold to U05.
test('Explore pattern modes are a labelled tab set that drives ?mode=', async ({ page }) => {
  await mockShell(page, true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/explore');
  const list = page.getByRole('tablist', { name: 'Explore patterns' });
  await expect(list).toBeVisible();
  await expect(list.getByRole('tab', { name: 'Over time' })).toHaveAttribute('aria-selected', 'true');
  await list.getByRole('tab', { name: 'By category' }).click();
  await expect(list.getByRole('tab', { name: 'By category' })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/[?&]mode=by-category/);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  const inactive = list.getByRole('tab', { name: 'Over time' });
  expect(await inactive.evaluate((el) => getComputedStyle(el).color)).not.toBe(await tealOf(page));
  await page.screenshot({ path: 'e2e/screenshots/tabs-explore-patterns.png' });
});
