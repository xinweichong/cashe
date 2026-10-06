import { test, expect } from '@playwright/test';

// Real API, real mutation, synthetic data: pick a category in Explore's
// "Where it went", open its evidence, correct a purchase's category in the
// detail, and come back. Each view must reflect the correction, and each
// back step must return to the view it came from.

test('Explore category → evidence → category correction → back to Explore with updated totals', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const login = await page.request.post('/api/login', { data: { username: 'journey', password: 'journey-password' } });
  expect(login.ok()).toBe(true);
  await page.goto('/explore?mode=by-category');

  const legend = page.getByTestId('category-donut-legend');
  await expect(legend.getByRole('button', { name: /^Food/ })).toContainText('$77.30');
  await legend.getByRole('button', { name: /^Food/ }).click();
  await page.getByRole('button', { name: 'View transactions' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Food evidence' })).toBeVisible();
  const evidenceRows = page.locator('a[href*="returnTo=%2Fevidence"]');
  await expect(evidenceRows).toHaveCount(3);
  await evidenceRows.filter({ hasText: 'Synthetic Grocer' }).click();
  await expect(page).toHaveURL(/\/activity\/\d+\?returnTo=/);

  // One-tap category correction in the detail (real PUT).
  const correction = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/v2\/transactions\/\d+$/.test(r.url()));
  await page.getByRole('button', { name: 'Shopping', exact: true }).click();
  expect((await correction).ok()).toBe(true);
  await page.keyboard.press('Escape');

  // Back on evidence (returnTo), which must no longer list the moved purchase.
  await expect(page.getByRole('heading', { level: 1, name: 'Food evidence' })).toBeVisible();
  await expect(evidenceRows.filter({ hasText: 'Synthetic Noodle House' })).toHaveCount(1);
  await expect(evidenceRows.filter({ hasText: 'Synthetic Grocer' })).toHaveCount(0);

  // Evidence names Explore as its parent and returns to the same view.
  await page.getByRole('main').getByRole('link', { name: 'Explore', exact: true }).click();
  await expect(page).toHaveURL(/\/explore\?mode=by-category$/);
  await expect(legend.getByRole('button', { name: /^Food/ })).toContainText('$19.20');
  await expect(legend.getByRole('button', { name: /^Shopping/ })).toContainText('$93.00');
  await page.screenshot({ path: 'e2e/screenshots/journey-after-correction.png', fullPage: true });
});
