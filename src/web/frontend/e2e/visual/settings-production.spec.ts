import { test, expect } from '@playwright/test';

// Regression for a real layout bug: the Feature Toggles row used
// `flex items-center justify-between` with no `shrink-0` on the switch and
// no `min-w-0`/`flex-1` on the label/description block. jsdom-based unit
// tests can't catch this (no real flexbox layout), so only a real browser
// measurement does — the switch with the longest sibling description ("New
// experience") rendered visibly narrower than every other switch on the
// page instead of all six being a uniform size.

async function mockAuthenticatedSettings(page: import('@playwright/test').Page) {
  await page.route('**/api/ping', (route) => route.fulfill({ json: { status: 'ok' } }));
  await page.route('**/api/users/me', (route) => route.fulfill({ json: {
    username: 'test', gmail_connected: false, telegram_chat_id: null, wants_gmail: false,
    wants_apple_wallet: false, onboarding_complete: true, force_password_change: false,
  } }));
  await page.route('**/api/settings', (route) => route.fulfill({ json: {
    anomaly_multiplier: 2, velocity_alert_threshold: 2, budgets_enabled: false, goals_enabled: true,
    trips_enabled: true, subscriptions_enabled: true, recurring_enabled: false, home_briefing_enabled: true,
  } }));
  await page.route('**/api/categories', (route) => route.fulfill({ json: [] }));
}

test('production Settings feature toggles render at a uniform size', async ({ page }) => {
  await mockAuthenticatedSettings(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/settings');
  const switches = page.getByRole('switch');
  await expect(switches.first()).toBeVisible();
  const count = await switches.count();
  const widths = new Set<number>();
  for (let i = 0; i < count; i++) {
    const box = await switches.nth(i).boundingBox();
    widths.add(Math.round(box!.width));
  }
  expect(widths.size).toBe(1);
});
