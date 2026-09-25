import { test, expect, type Page } from '@playwright/test';
import { HOME_JSON, mockAuthenticatedHome } from '../fixtures/mocks';

// Phone Home is one screen: a glance, one lens panel, and lens triggers in
// the thumb band. The page never scrolls; detail slides in as a DrillSheet
// and the browser's back returns to the glance. md+ keeps the dashboard.

const REVIEW = '../../../.impeccable/review';
const sgd = (minor_units: number) => ({ minor_units, currency: 'SGD' });

async function mockRichHome(page: Page) {
  await mockAuthenticatedHome(page);
  await page.route('**/api/v2/home', (route) => route.fulfill({ json: {
    ...HOME_JSON,
    facts: { ...HOME_JSON.facts, category_changes: [
      { category: 'Bills', change: sgd(6200) }, { category: 'Food', change: sgd(2000) }, { category: 'Shopping', change: sgd(-1400) },
    ] },
    recent: [
      { id: 1, merchant: 'Noodle House', category: 'Food', type: 'expense', date: '2026-09-10', amount: sgd(1240), conversion_status: null },
      { id: 2, merchant: 'Grocer', category: 'Food', type: 'expense', date: '2026-09-09', amount: sgd(5810), conversion_status: null },
      { id: 3, merchant: 'Transit', category: 'Transport', type: 'expense', date: '2026-09-08', amount: sgd(320), conversion_status: null },
      { id: 4, merchant: 'Bookshop', category: 'Shopping', type: 'expense', date: '2026-09-07', amount: sgd(3490), conversion_status: null },
      { id: 5, merchant: 'Cafe', category: 'Food', type: 'expense', date: '2026-09-06', amount: sgd(680), conversion_status: null },
    ],
    upcoming: [
      { id: 'a', label: 'Netflix', date: '2026-09-12', amount: sgd(1798) },
      { id: 'b', label: 'Gym membership', date: '2026-09-14', amount: sgd(8900) },
      { id: 'c', label: 'Spotify', date: '2026-09-18', amount: sgd(1088) },
      { id: 'd', label: 'Insurance premium', date: '2026-09-21', amount: null },
    ],
    upcoming_total: sgd(11786), upcoming_unknown_count: 1, review_count: 2,
  } }));
  await page.route('**/api/v2/transactions/daily-totals**', (route) => route.fulfill({ json: [
    { date: '2026-09-03', spending: sgd(4200) }, { date: '2026-09-05', spending: sgd(18200) },
    { date: '2026-09-07', spending: sgd(3490) }, { date: '2026-09-09', spending: sgd(5810) }, { date: '2026-09-10', spending: sgd(1240) },
  ] }));
  await page.route('**/api/v2/spending/merchants**', (route) => route.fulfill({ json: [
    { merchant: 'SP Services', total: sgd(12400) }, { merchant: 'Singtel', total: sgd(5800) },
  ] }));
}

for (const [name, size] of [['mobile', { width: 390, height: 844 }], ['mobile-se', { width: 375, height: 667 }]] as const) {
  test(`phone Home fits one screen with lenses in the thumb band (${name})`, async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('cashe-appearance', 'dark'));
    await mockRichHome(page);
    await page.setViewportSize(size);
    await page.goto('/');
    const lenses = page.getByRole('tablist', { name: 'Home views' });
    await expect(lenses).toBeVisible();
    await expect(page.getByText('Where it went')).toBeVisible();
    await page.waitForTimeout(1800);
    const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, inner: window.innerHeight }));
    expect(scroll).toBeLessThanOrEqual(inner);
    // The lens bar sits in the lower third, above the tab bar.
    const box = (await lenses.boundingBox())!;
    expect(box.y).toBeGreaterThan(size.height * 0.66);
    await page.screenshot({ path: `${REVIEW}/${name}.png` });
  });
}

test('phone Home lenses swap in place and drill-ins slide back', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('cashe-appearance', 'dark'));
  await mockRichHome(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForTimeout(1800);
  await page.getByRole('tab', { name: 'Soon' }).click();
  await expect(page).toHaveURL(/lens=soon/);
  await expect(page.getByText('Gym membership')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${REVIEW}/mobile-lens-soon.png` });

  await page.getByTestId('category-donut-legend').getByRole('button', { name: /Bills/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('SP Services')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${REVIEW}/mobile-drill.png` });
  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/lens=soon/);
});

test('tablet and desktop keep the dashboard, with no lens bar', async ({ page }) => {
  await mockRichHome(page);
  for (const width of [768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Where the dollars go.' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Home views' })).toHaveCount(0);
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${REVIEW}/desktop.png`, fullPage: true });
});
