import { test, expect } from '@playwright/test';

// Exercises the real authenticated route (App -> AppShell -> HomePage) with
// the network mocked. The category donut moved to Explore when Home was
// distilled to "now" (v3.1); its complete-ring guard lives in
// explore-production.spec.ts.

import { mockAuthenticatedHome } from '../fixtures/mocks';

test('production Home spectrum card is static, never an animated pulse', async ({ page }) => {
  // Regression lineage: the old .hero-glow-* pulse used to loop (and flicker
  // under reduced motion). Its replacement, the spectrum card (HIG alignment,
  // 2026-10-01), must never animate, with or without reduced motion.
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await mockAuthenticatedHome(page);
    await page.emulateMedia({ reducedMotion });
    await page.goto('/');
    await expect(page.getByText(/^As of 10 Sep/)).toBeVisible();
    const card = page.locator('.spectrum-fill').first();
    await expect(card).toBeVisible();
    expect(await card.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    expect(await page.locator('.spectrum-fill').count()).toBe(1); // one spectrum card per screen
  }
});

test('initial Home load renders visible shape-matched skeletons in light theme', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('cashe-appearance', 'light'));
  await mockAuthenticatedHome(page);
  await page.route('**/api/v2/home', () => new Promise(() => {}));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const status = page.getByRole('status', { name: 'Preparing your briefing' });
  await expect(status).toBeVisible();
  // Phone Home keeps its page heading for assistive tech only.
  await expect(page.getByRole('heading', { name: 'Home' })).toBeAttached();
  const bg = await status.locator('.skeleton-pulse').first().evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(bg).not.toContain('255, 255, 255');
  await page.screenshot({ path: 'e2e/screenshots/home-initial-skeleton-light.png' });
});

test('Home income opens its records and Back returns to Home', async ({ page }) => {
  await mockAuthenticatedHome(page);
  await page.route('**/api/v2/spending/evidence**', (route) => route.fulfill({ json: {
    items: [{ id: 1, merchant: 'Salary', category: 'Income', type: 'income', date: '2026-09-05', amount: { minor_units: 500000, currency: 'SGD' }, conversion_status: 'native' }],
    total: 1, limit: 50, offset: 0,
  } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('link', { name: /^Income/ }).click();
  await expect(page).toHaveURL(/\/evidence\?.*measure=income/);
  await expect(page.getByText('Salary')).toBeVisible();
  await page.locator('header').getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
});
