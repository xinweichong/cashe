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

test('By category reserves no empty panel and reveals selection detail beneath a stable chart', async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900, name: 'desktop' }, { width: 390, height: 844, name: 'phone' }]) {
    await mockAuthenticatedExplore(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/explore?mode=by-category');
    await expect(page.getByRole('tab', { name: 'By category' })).toHaveAttribute('aria-selected', 'true');
    const mainCard = page.getByText('What changed', { exact: true }).locator('xpath=ancestor::div[contains(@class, "rounded-md")][1]');
    await expect(mainCard).toBeVisible();
    await expect(page.getByText(/Select a bar/)).toHaveCount(0);
    const before = (await mainCard.boundingBox())!;
    const content = (await page.getByRole('tablist').locator('xpath=ancestor::div[contains(@class, "max-w-4xl")][1]').boundingBox())!;
    expect(before.width).toBeGreaterThan(content.width - 80); // full width: no reserved column

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

test('mode tabs scroll within their own bounds on phone instead of overflowing the page', async ({ page }) => {
  // Regression: the four mode tabs (Over time/By category/By merchant/
  // Recurring) used to have no overflow handling at all on a narrow
  // viewport, so the row spilled past the page's content width. It now
  // scrolls horizontally within its own container — every tab stays
  // reachable, and the list's own right edge never exceeds the viewport.
  await mockAuthenticatedExplore(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/explore');
  const tabList = page.getByRole('tablist');
  const listBox = (await tabList.boundingBox())!;
  expect(listBox.x + listBox.width).toBeLessThanOrEqual(390);

  const recurringTab = page.getByRole('tab', { name: 'Recurring' });
  await recurringTab.scrollIntoViewIfNeeded();
  await recurringTab.click();
  await expect(recurringTab).toHaveAttribute('aria-selected', 'true');
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
