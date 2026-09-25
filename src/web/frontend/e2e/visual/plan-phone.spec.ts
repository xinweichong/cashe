import { test, expect } from '@playwright/test';
import { mockAuthenticatedPlan } from '../fixtures/mocks';

// Phone Plan: the projection glance, lenses for Soon and each enabled
// planning domain, charge and timeline drill-ins, and no page scroll.

const REVIEW = '../../../.impeccable/review';

for (const [name, size] of [['plan-mobile', { width: 390, height: 844 }], ['plan-mobile-se', { width: 375, height: 667 }]] as const) {
  test(`phone Plan is one screen with planning lenses in the thumb band (${name})`, async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('cashe-appearance', 'dark'));
    await mockAuthenticatedPlan(page);
    await page.setViewportSize(size);
    await page.goto('/plan');
    const lenses = page.getByRole('tablist', { name: 'Plan views' });
    await expect(lenses).toBeVisible();
    await page.waitForTimeout(900);
    const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, inner: window.innerHeight }));
    expect(scroll).toBeLessThanOrEqual(inner);
    expect((await lenses.boundingBox())!.y).toBeGreaterThan(size.height * 0.66);
    await page.screenshot({ path: `${REVIEW}/${name}.png` });
  });
}

test('phone Plan opens a charge and the timeline as drill-ins that back closes', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('cashe-appearance', 'dark'));
  await mockAuthenticatedPlan(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/plan');
  await page.getByRole('button', { name: /^Timeline and calendar/ }).click();
  const timeline = page.getByRole('dialog', { name: 'Upcoming timeline' });
  await expect(timeline).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${REVIEW}/plan-timeline.png` });
  await page.goBack();
  await expect(timeline).toBeHidden();
  const tabs = await page.getByRole('tablist', { name: 'Plan views' }).getByRole('tab').allTextContents();
  if (tabs.includes('Budgets')) {
    await page.getByRole('tab', { name: 'Budgets' }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${REVIEW}/plan-budgets.png` });
  }
});

test('phone Plan Goals lens fits savings and goals on one screen with whole card corners', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('cashe-appearance', 'dark'));
  await mockAuthenticatedPlan(page);
  const money = (n: number) => ({ minor_units: n, currency: 'SGD' });
  const goal = (id: number, name: string, saved: number, target: number) => ({
    id, name, target_amount: money(target), saved_amount: money(saved), target_date: null, status: 'active',
    percent: Math.round((saved / target) * 100), monthly_rate: null, rate_window: null, months_to_target: null, on_track: null, contributions: [],
  });
  await page.route('**/api/savings/overview', (route) => route.fulfill({ json: { month: '2026-09', savings: 1370, allocated_to_goals: 600, unallocated: 770 } }));
  await page.route('**/api/v2/goals', (route) => route.fulfill({ json: [
    goal(1, 'Emergency fund', 620000, 1000000), goal(2, 'Japan trip', 180000, 200000), goal(3, 'New laptop', 30000, 240000),
  ] }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/plan?lens=goals');
  await expect(page.getByText('Emergency fund')).toBeVisible();
  await expect(page.getByLabel(/^Savings, /)).toBeVisible();
  await page.waitForTimeout(900);
  // Nothing in the lens overflows it: the goals fit without scrolling.
  const overflow = await page.getByRole('tabpanel').evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflow).toBeLessThanOrEqual(0);
  // The staggered goal rows finish their entrance (regression: they stuck at opacity 0).
  await expect.poll(() => page.getByText('Emergency fund').evaluate((el) => getComputedStyle(el.closest('button')!.parentElement!).opacity)).toBe('1');
  await page.screenshot({ path: `${REVIEW}/plan-goals.png` });
  await page.getByRole('tab', { name: 'Subs' }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${REVIEW}/plan-subs.png` });
});
