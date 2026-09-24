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

test('Explore route selector marks the current view with the Tabs active recipe', async ({ page }) => {
  await mockShell(page, true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/explore/insights');
  const nav = page.getByRole('navigation', { name: 'Explore views' });
  const current = nav.getByRole('link', { name: 'Insights' });
  await expect(current).toHaveAttribute('aria-current', 'page');
  expect(await current.evaluate((el) => getComputedStyle(el).color)).toBe(await tealOf(page));
  const other = nav.getByRole('link', { name: 'Spending patterns' });
  expect(await other.evaluate((el) => getComputedStyle(el).color)).not.toBe(await tealOf(page));
});

test('classic Analytics insight period switch is a labelled tab set', async ({ page }) => {
  await mockShell(page, false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/analytics');
  const list = page.getByRole('tablist', { name: 'Insight period' });
  await expect(list).toBeVisible();
  await list.getByRole('tab', { name: 'Weekly' }).click();
  await expect(list.getByRole('tab', { name: 'Weekly' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Weekly' })).toContainText('Archived AI text');
  await expect(page.getByRole('tablist', { name: 'Comparison range' })).toBeVisible();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  const daily = list.getByRole('tab', { name: 'Daily' });
  expect(await daily.evaluate((el) => getComputedStyle(el).color)).not.toBe(await tealOf(page));
  await page.screenshot({ path: 'e2e/screenshots/tabs-analytics-classic.png' });
});

test('classic Overview trend view switch is a labelled tab set', async ({ page }) => {
  await mockShell(page, false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/overview');
  const list = page.getByRole('tablist', { name: 'Trend view' });
  await expect(list).toBeVisible();
  await list.getByRole('tab', { name: 'By category' }).click();
  await expect(list.getByRole('tab', { name: 'By category' })).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: 'e2e/screenshots/tabs-overview-classic.png' });
});
