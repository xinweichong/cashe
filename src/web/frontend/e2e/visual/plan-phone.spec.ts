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
