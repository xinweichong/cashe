import { test, expect } from '@playwright/test';

// Exercises the real authenticated route (App -> AppShell -> ExplorePage ->
// ExplorePatternsPage) with mocked network, not just isolated component
// tests — see e2e/visual/home-production.spec.ts for why this matters
// (AppShell's layout isn't present in unit tests).

import { mockAuthenticatedExplore } from '../fixtures/mocks';

test('production Explore switches modes and preserves selection in the URL', async ({ page }) => {
  await mockAuthenticatedExplore(page);
  await page.goto('/explore');
  await expect(page.getByRole('tab', { name: 'Over time' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(/Average spend per weekday/)).toBeVisible();

  await page.getByRole('tab', { name: 'By category' }).click();
  await expect(page).toHaveURL(/mode=by-category/);
  const foodBar = page.getByRole('button', { name: /^Food \+/ });
  await expect(foodBar).toBeVisible();
  await foodBar.click();
  await expect(page.getByRole('link', { name: 'This period' })).toBeVisible();

  await page.getByRole('tab', { name: 'By merchant' }).click();
  await expect(page).toHaveURL(/mode=by-merchant/);
  await expect(page.getByText('Top merchants')).toBeVisible();
  await expect(page.getByText('Most visited')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('tab', { name: 'By merchant' })).toHaveAttribute('aria-selected', 'true');
});

test('merged Explore dashboard: pulse band, signals and health above the patterns, at every viewport', async ({ page }) => {
  for (const theme of ['dark', 'light'] as const) {
    for (const viewport of [{ width: 1440, height: 900, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }]) {
      await mockAuthenticatedExplore(page);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/explore');
      await expect(page.getByRole('link', { name: 'Insights' })).toHaveCount(0);
      if (viewport.name === 'desktop') {
        await expect(page.getByText('Spent this month')).toBeVisible();
        await expect(page.getByText('Worth a look')).toBeVisible();
        await expect(page.getByText('Financial health')).toBeVisible();
      } else {
        // Phone: the glance carries spend, and signals/health as links.
        await expect(page.getByText(/^Spent · /)).toBeVisible();
        await expect(page.getByRole('link', { name: /Worth a look/ })).toBeVisible();
        await expect(page.getByRole('link', { name: /Health/ })).toBeVisible();
      }
      if (viewport.name === 'desktop') {
        // The first Patterns chart card starts inside a 1440×900 first screen.
        const chart = page.getByText('Spending over time', { exact: true });
        expect((await chart.boundingBox())!.y).toBeLessThan(900);
        await page.screenshot({ path: `e2e/screenshots/explore-first-screen-${theme}.png` });
      }
      await expect(page.locator('.recharts-line').first()).toBeVisible();
      // Phone keeps income vs spending one tap away, in a drill-in.
      if (viewport.name === 'desktop') await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `e2e/screenshots/explore-${viewport.name}-${theme}.png`, fullPage: true });
      if (theme === 'dark' && viewport.name === 'desktop') await page.screenshot({ path: '../../../.impeccable/review/explore-desktop.png', fullPage: true });
    }
  }
});

test('Worth a look and Financial health open their full views, with a way back', async ({ page }) => {
  await mockAuthenticatedExplore(page);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/explore');
  await page.getByRole('link', { name: /Worth a look: 3 items/ }).click();
  await expect(page).toHaveURL(/\/explore\/signals$/);
  await expect(page.getByRole('link', { name: /Kinokuniya/ })).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/explore-signals-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Back to Explore' }).click();
  await page.getByRole('link', { name: /Financial health 91 out of 100/ }).click();
  await expect(page).toHaveURL(/\/explore\/health$/);
  await expect(page.getByText('Savings Rate')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/explore-health-desktop.png', fullPage: true });
});

test('/explore/insights redirects to the merged dashboard', async ({ page }) => {
  await mockAuthenticatedExplore(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/explore/insights');
  await expect(page).toHaveURL(/\/explore$/);
  await expect(page.getByText('Spent this month')).toBeVisible();
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

test('By category keeps the chart stable and reveals selection detail beneath it', async ({ page }) => {
  // Phone shows By category as a lens; see explore-phone.spec.ts.
  for (const viewport of [{ width: 1440, height: 900, name: 'desktop' }]) {
    await mockAuthenticatedExplore(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/explore?mode=by-category');
    await expect(page.getByRole('tab', { name: 'By category' })).toHaveAttribute('aria-selected', 'true');
    const mainCard = page.getByText('What changed', { exact: true }).locator('xpath=ancestor::div[contains(@class, "rounded-md")][1]');
    await expect(mainCard).toBeVisible();
    await expect(page.getByText('Where it went')).toBeVisible();
    const before = (await mainCard.boundingBox())!;

    await mainCard.getByRole('button').first().click();
    const detail = page.getByRole('button', { name: 'Clear selection' }).locator('xpath=ancestor::div[contains(@class, "rounded-md")][1]');
    await expect(detail).toBeVisible();
    const after = (await mainCard.boundingBox())!;
    const detailBox = (await detail.boundingBox())!;
    expect(Math.abs(after.width - before.width)).toBeLessThan(1); // chart does not resize
    expect(detailBox.y).toBeGreaterThan(after.y + after.height - 1); // beneath, not beside
    await page.screenshot({ path: `e2e/screenshots/explore-by-category-${viewport.name}.png`, fullPage: true });
  }
});

test('phone pattern lenses stay inside the viewport and every lens is reachable', async ({ page }) => {
  // Regression: the four desktop mode tabs used to spill past a narrow
  // viewport. On phone they are now the thumb-band lens bar, which divides
  // the full width, so every lens is reachable without horizontal scroll.
  await mockAuthenticatedExplore(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/explore');
  const tabList = page.getByRole('tablist', { name: 'Explore views' });
  const listBox = (await tabList.boundingBox())!;
  expect(listBox.x + listBox.width).toBeLessThanOrEqual(390);

  // Recurring costs live in Plan's Subs lens on the phone.
  await expect(page.getByRole('tab', { name: 'Recurring' })).toHaveCount(0);
  const weekTab = page.getByRole('tab', { name: 'Week' });
  await weekTab.click();
  await expect(weekTab).toHaveAttribute('aria-selected', 'true');
});

test('Over time: step to a day, break it down by category, then merchants with day-scoped evidence', async ({ page }) => {
  await mockAuthenticatedExplore(page);
  await page.route('**/api/v2/spending/breakdown**', (route) => route.fulfill({ json: {
    start: '2026-09-02', end: '2026-09-02', unresolved_count: 0, indicative_count: 0, status: 'complete',
    by_category: { Food: { minor_units: 800, currency: 'SGD' }, Shopping: { minor_units: 300, currency: 'SGD' } },
  } }));
  await page.route('**/api/v2/spending/merchants**', (route) => route.fulfill({ json: [
    { merchant: 'Hawker Stall', visits: 1, total: { minor_units: 800, currency: 'SGD' } },
  ] }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/explore?day=2026-09-02');
  const day = page.getByRole('region', { name: /All spending on/ });
  await expect(day).toBeVisible();
  await expect(page.getByTestId('category-trend-day-readout')).toContainText('charted');
  await day.getByRole('button', { name: /^Food/ }).click();
  await expect(page).toHaveURL(/dayCategory=Food/);
  const merchant = day.getByRole('link', { name: 'Hawker Stall' });
  await expect(merchant).toHaveAttribute('href', /start=2026-09-02&end=2026-09-02/);
  await page.screenshot({ path: 'e2e/screenshots/explore-day-investigation.png', fullPage: true });
  await page.getByRole('button', { name: 'Clear day' }).click();
  await expect(day).toHaveCount(0);
});
