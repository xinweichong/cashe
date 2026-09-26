import { test, expect } from '@playwright/test';

// Real API, real mutation, synthetic data: select a category on Home, open
// its evidence, correct a transaction's category, and return — the
// selection must survive and every view must reflect the correction.

test('Home selection → evidence → category correction → back keeps selection and updated data', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const login = await page.request.post('/api/login', { data: { username: 'journey', password: 'journey-password' } });
  expect(login.ok()).toBe(true);
  await page.goto('/');
  await expect(page.getByText(/^Through /)).toBeVisible();

  const legend = page.getByTestId('category-donut-legend');
  await legend.getByRole('button', { name: /^Food/ }).click();
  await expect(page).toHaveURL(/category=Food/);
  const merchantRows = page.locator('li', { hasText: 'Synthetic Grocer' }); // selected category's merchant readout
  await expect(merchantRows).toHaveCount(1);

  await page.getByRole('link', { name: /View transactions/ }).click();
  await expect(page.getByRole('heading', { name: 'Food evidence' })).toBeVisible();
  await page.locator('a[href*="returnTo=%2Fevidence"]', { hasText: 'Synthetic Grocer' }).click();
  await expect(page.getByRole('button', { name: 'Close transaction' })).toBeVisible();

  // One-tap category correction in the detail view (real PUT).
  const detail = page.getByRole('button', { name: 'Close transaction' }).locator('xpath=ancestor::div[contains(@class, "fixed")][1]');
  const correction = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/v2\/transactions\/\d+$/.test(r.url()));
  await detail.getByRole('button', { name: 'Shopping', exact: true }).click();
  expect((await correction).ok()).toBe(true);
  await page.getByRole('button', { name: 'Close transaction' }).click();

  // Back on evidence (returnTo), which must no longer list the moved purchase.
  await expect(page.getByRole('heading', { name: 'Food evidence' })).toBeVisible();
  const evidenceRows = page.locator('a[href*="returnTo=%2Fevidence"]');
  await expect(evidenceRows.filter({ hasText: 'Synthetic Noodle House' })).toHaveCount(1);
  await expect(evidenceRows.filter({ hasText: 'Synthetic Grocer' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Back to briefing' }).click();
  await expect(page).toHaveURL(/category=Food/);
  await expect(page.getByRole('button', { name: 'Clear selection' })).toBeVisible();
  await expect(page.locator('li', { hasText: 'Synthetic Noodle House' })).toHaveCount(1);
  await expect(merchantRows).toHaveCount(0);
  await page.waitForTimeout(800); // let the route entrance finish before capturing
  await page.screenshot({ path: 'e2e/screenshots/journey-after-correction.png', fullPage: true });

  // Opening a recent purchase from Home and closing it returns to Home.
  await page.locator('a[href*="returnTo=%2F%3Fcategory%3DFood"]', { hasText: 'Synthetic Cafe' }).first().click();
  await page.getByRole('button', { name: 'Close transaction' }).click();
  await expect(page).toHaveURL(/\/\?category=Food$/);
  await expect(page.getByRole('button', { name: 'Clear selection' })).toBeVisible();
});
