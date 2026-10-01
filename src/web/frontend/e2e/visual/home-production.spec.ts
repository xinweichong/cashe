import { test, expect } from '@playwright/test';

// Exercises the real authenticated route (App -> AppShell -> HomePage),
// not the isolated /dev/preview/home fixture harness — AppShell's
// Sidebar/BottomTabs/route-transition wrapper aren't present there, so a
// layout issue specific to the real shell wouldn't be caught by the
// prototype's screenshots alone. Network is mocked; no backend/auth used.
//
// Also guards a real timing bug found via this test: Recharts' Pie sweeps
// its entrance animation in on its own JS timer, so a screenshot taken
// right when the first sector mounts (rather than after the sweep
// finishes) can catch the donut half-drawn — indistinguishable from a
// genuine rendering bug unless you know to wait. See CategoryDonut's
// isAnimationActive={!reduceMotion} wiring, which also fixed a related
// gap: that timer wasn't gated by prefers-reduced-motion at all before.

import { mockAuthenticatedHome } from '../fixtures/mocks';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`production Home CategoryDonut renders a complete ring at ${viewport.width}px`, async ({ page }) => {
    await mockAuthenticatedHome(page);
    await page.setViewportSize(viewport);
    await page.goto('/');
    const phone = viewport.width < 768;
    // Phone Home leads with the compact 112px ring beside its legend.
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();

    const sectors = page.locator('.recharts-pie-sector');
    await expect(sectors.first()).toBeVisible();
    const container = page.locator(phone ? 'div.relative.w-\\[112px\\]' : 'div.relative.w-full.max-w-\\[220px\\]').first();
    const containerBox = (await container.boundingBox())!;

    // A complete ring's sectors collectively span the chart's outer diameter
    // (outerRadius 85% of container/2, so ~85% of container height here). A
    // donut caught mid-sweep (or genuinely broken into a half-circle) would
    // only cover roughly half that — 0.7 sits safely between the two. Poll
    // rather than sleep: the entrance sweep runs on Recharts' own timer and
    // takes longer when the suite loads the machine.
    const sweptHeight = async () => {
      let top = Infinity, bottom = -Infinity;
      for (const box of await Promise.all((await sectors.all()).map((s) => s.boundingBox()))) {
        if (!box) continue;
        top = Math.min(top, box.y);
        bottom = Math.max(bottom, box.y + box.height);
      }
      return bottom - top;
    };
    await expect.poll(sweptHeight, { timeout: 5000 }).toBeGreaterThan(containerBox.height * 0.7);
  });
}

test('production Home spectrum card is static, never an animated pulse', async ({ page }) => {
  // Regression lineage: the old .hero-glow-* pulse used to loop (and flicker
  // under reduced motion). Its replacement, the spectrum card (HIG alignment,
  // 2026-10-01), must never animate, with or without reduced motion.
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await mockAuthenticatedHome(page);
    await page.emulateMedia({ reducedMotion });
    await page.goto('/');
    await expect(page.getByText(/^Through 2026-09-10/)).toBeVisible();
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

test('Home category selection survives the evidence round trip', async ({ page }) => {
  await mockAuthenticatedHome(page);
  await page.route('**/api/v2/spending/evidence**', (route) => route.fulfill({ json: {
    items: [{ id: 1, merchant: 'FairPrice', category: 'Food', type: 'expense', date: '2026-09-05', amount: { minor_units: 1580, currency: 'SGD' }, conversion_status: 'native' }],
    total: 1, limit: 50, offset: 0,
  } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('category-donut-legend').getByRole('button', { name: /^Food/ }).click();
  await expect(page).toHaveURL(/category=Food/);
  await page.getByRole('link', { name: /View transactions/ }).click();
  await expect(page).toHaveURL(/\/evidence\?/);
  await expect(page.getByText('FairPrice')).toBeVisible();
  await page.locator('header').getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page).toHaveURL(/category=Food/);
  await expect(page.getByRole('button', { name: 'Clear selection' })).toBeVisible();
});
