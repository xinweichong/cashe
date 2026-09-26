import { test, expect, type Page } from '@playwright/test';
import { TRANSACTIONS, mockAuthenticatedActivity } from '../fixtures/mocks';

// Phone Activity: a week glance, the purchase list as the one lens panel
// (it scrolls inside its card; the page never does), type lenses and the
// search dock in the thumb band, and filters/add as DrillSheets.

const REVIEW = '../../../.impeccable/review';
const MERCHANTS = ['Noodle House', 'Grocer', 'MRT', 'Bookshop', 'Cafe', 'Hawker Centre', 'Grab', 'Uniqlo', 'Shopee', 'Singtel', 'SP Services', 'Netflix'];

async function mockRichActivity(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('cashe-appearance', 'dark'));
  await mockAuthenticatedActivity(page);
  const txs = MERCHANTS.map((merchant, i) => ({
    ...TRANSACTIONS[0], id: 100 + i, merchant, category: i % 3 ? 'Food' : 'Shopping',
    original: { minor_units: 480 + i * 731, currency: 'SGD' }, reporting: { minor_units: 480 + i * 731, currency: 'SGD' },
    transaction_date: `2026-09-${String(25 - Math.floor(i / 3)).padStart(2, '0')}T1${i % 10}:05:00`,
  }));
  await page.route('**/api/v2/transactions**', (route) => route.fulfill({ json: txs }));
  await page.route('**/api/v2/transactions/daily-totals**', (route) => route.fulfill({ json: [
    { date: '2026-09-22', spending: { minor_units: 6380, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 3, indicative_count: 0, status: 'complete' },
    { date: '2026-09-25', spending: { minor_units: 15160, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 4, indicative_count: 0, status: 'complete' },
  ] }));
}

for (const [name, size] of [['activity-mobile', { width: 390, height: 844 }], ['activity-mobile-se', { width: 375, height: 667 }]] as const) {
  test(`phone Activity is one screen with lenses and search in the thumb band (${name})`, async ({ page }) => {
    await mockRichActivity(page);
    await page.setViewportSize(size);
    await page.goto('/activity');
    await expect(page.getByRole('tablist', { name: 'Activity views' })).toBeVisible();
    await expect(page.getByText('Noodle House')).toBeVisible();
    await page.waitForTimeout(800);
    const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, inner: window.innerHeight }));
    expect(scroll).toBeLessThanOrEqual(inner);
    const search = (await page.getByRole('searchbox', { name: 'Search transactions' }).boundingBox())!;
    expect(search.y).toBeGreaterThan(size.height * 0.7);
    await page.screenshot({ path: `${REVIEW}/${name}.png` });
  });
}

test('phone Activity lenses set type filters and Filters opens as a sheet', async ({ page }) => {
  await mockRichActivity(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/activity');
  await page.getByRole('tab', { name: 'Refunds' }).click();
  await expect(page).toHaveURL(/type=refund/);
  await page.getByRole('tab', { name: /^Review/ }).click();
  await expect(page).toHaveURL(/review=1/);
  await expect(page).not.toHaveURL(/type=refund/);
  await page.getByRole('button', { name: /^Filters/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Filters' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Last month' })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${REVIEW}/activity-filters.png` });
});

test('phone Activity day headers scroll away with their rows', async ({ page }) => {
  await mockRichActivity(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/activity');
  const header = page.getByTestId('tx-day-header').first();
  await expect(header).toBeVisible();
  const before = (await header.boundingBox())!.y;
  // The lens panel's scroll area is the tabpanel's first child.
  await page.getByRole('tabpanel').locator('> div').first().evaluate((el) => el.scrollBy(0, 160));
  await page.waitForTimeout(200);
  expect((await header.boundingBox())!.y).toBeLessThan(before - 100);
});

test('the text size setting scales content but not the wordmark', async ({ page }) => {
  await mockRichActivity(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/activity');
  const wordmark = page.getByRole('banner').getByText(/ca.*he/).first();
  const logoBefore = (await wordmark.boundingBox())!.height;
  await page.getByRole('button', { name: 'Profile menu' }).click();
  await page.getByRole('menuitemradio', { name: 'Larger' }).click();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('20px');
  expect((await wordmark.boundingBox())!.height).toBeCloseTo(logoBefore, 0);
  // At Larger the screen turns page-scrolling so the panel keeps real room.
  const panelHeight = (await page.getByRole('tabpanel').boundingBox())!.height;
  expect(panelHeight).toBeGreaterThan(844 * 0.6);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${REVIEW}/activity-text-larger.png` });
  await page.reload();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('20px');
});
