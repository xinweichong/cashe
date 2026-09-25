import { test, expect } from '@playwright/test';
import { mockAuthenticatedExplore } from '../fixtures/mocks';

// Phone Explore: a spend-vs-last-month glance with signal and health links,
// one pattern lens at a time in the thumb band, and no page scroll.

const REVIEW = '../../../.impeccable/review';

for (const [name, size] of [['explore-mobile', { width: 390, height: 844 }], ['explore-mobile-se', { width: 375, height: 667 }]] as const) {
  test(`phone Explore is one screen with pattern lenses in the thumb band (${name})`, async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('cashe-appearance', 'dark'));
    await mockAuthenticatedExplore(page);
    await page.setViewportSize(size);
    await page.goto('/explore');
    const lenses = page.getByRole('tablist', { name: 'Explore views' });
    await expect(lenses).toBeVisible();
    await page.waitForTimeout(1200);
    const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, inner: window.innerHeight }));
    expect(scroll).toBeLessThanOrEqual(inner);
    expect((await lenses.boundingBox())!.y).toBeGreaterThan(size.height * 0.66);
    await page.screenshot({ path: `${REVIEW}/${name}.png` });
  });
}

test('phone Explore maps a desktop mode link to its lens and switches lenses', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('cashe-appearance', 'dark'));
  await mockAuthenticatedExplore(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/explore?mode=by-category');
  await expect(page.getByRole('tab', { name: 'Category' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Merchant' }).click();
  await expect(page).toHaveURL(/lens=merchant/);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${REVIEW}/explore-merchant.png` });
});
