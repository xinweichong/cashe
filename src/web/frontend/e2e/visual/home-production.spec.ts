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
    await expect(page.getByText('Where the dollars go.')).toBeVisible();

    const sectors = page.locator('.recharts-pie-sector');
    await expect(sectors.first()).toBeVisible();
    await page.waitForTimeout(1000); // let the entrance sweep finish

    const container = page.locator('div.relative.w-full.max-w-\\[220px\\]').first();
    const containerBox = (await container.boundingBox())!;

    // A complete ring's sectors collectively span the chart's outer diameter
    // (outerRadius 85% of container/2, so ~85% of container height here). A
    // donut caught mid-sweep (or genuinely broken into a half-circle) would
    // only cover roughly half that — 0.7 sits safely between the two.
    const sectorCount = await sectors.count();
    let unionTop = Infinity, unionBottom = -Infinity;
    for (let i = 0; i < sectorCount; i++) {
      const box = await sectors.nth(i).boundingBox();
      if (!box) continue;
      unionTop = Math.min(unionTop, box.y);
      unionBottom = Math.max(unionBottom, box.y + box.height);
    }
    const sweptHeight = unionBottom - unionTop;
    expect(sweptHeight).toBeGreaterThan(containerBox.height * 0.7);
  });
}

test('production Home hero glow is static, never an infinite pulse', async ({ page }) => {
  // Regression for a real bug: .hero-glow-*::after used to run an
  // `infinite` opacity keyframe, and the reduced-motion override only
  // shortened the animation-duration rather than stopping the loop — so a
  // reduced-motion user saw the glow flicker several times a second instead
  // of a static halo. Checked in both motion modes since the fix makes the
  // glow unconditionally static, not just reduced-motion-safe.
  await mockAuthenticatedHome(page);
  await page.goto('/');
  // The loading skeleton also renders a HeroCard; measure the loaded one.
  await expect(page.getByText(/^Through 2026-09-10/)).toBeVisible();
  const glow = page.locator('.hero-glow-warm, .hero-glow-teal, .hero-glow-coral').first();
  await expect(glow).toBeVisible();
  const animationName = await glow.evaluate((el) => getComputedStyle(el, '::after').animationName);
  expect(animationName).toBe('none');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.getByText(/^Through 2026-09-10/)).toBeVisible();
  const glowReduced = page.locator('.hero-glow-warm, .hero-glow-teal, .hero-glow-coral').first();
  await expect(glowReduced).toBeVisible();
  const animationNameReduced = await glowReduced.evaluate((el) => getComputedStyle(el, '::after').animationName);
  expect(animationNameReduced).toBe('none');
});

test('initial Home load renders visible shape-matched skeletons in light theme', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('cashe-appearance', 'light'));
  await mockAuthenticatedHome(page);
  await page.route('**/api/v2/home', () => new Promise(() => {}));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const status = page.getByRole('status', { name: 'Preparing your briefing' });
  await expect(status).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Where the dollars go.' })).toBeVisible();
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
  await page.getByRole('link', { name: 'Back to briefing' }).click();
  await expect(page).toHaveURL(/category=Food/);
  await expect(page.getByRole('button', { name: 'Clear selection' })).toBeVisible();
});
