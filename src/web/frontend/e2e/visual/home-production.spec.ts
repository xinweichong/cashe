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

const HOME_JSON = {
  facts: {
    as_of: '2026-09-10', timezone: 'Asia/Singapore', undated_count: 0,
    current: { start: '2026-09-01', end: '2026-09-10', spending: { minor_units: 49826, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 5, unresolved_count: 0, indicative_count: 0, status: 'complete' },
    comparison_current: { start: '2026-08-01', end: '2026-08-10', spending: { minor_units: 45000, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 4, unresolved_count: 0, indicative_count: 0, status: 'complete' },
    previous: { start: '2026-08-01', end: '2026-08-10', spending: { minor_units: 45000, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 4, unresolved_count: 0, indicative_count: 0, status: 'complete' },
    change: { minor_units: 4826, currency: 'SGD' },
    category_changes: [{ category: 'Food', change: { minor_units: 2000, currency: 'SGD' } }],
    top_category_driver: null, trip_drivers: [],
  },
  spending_target: null, recent: [], upcoming: [], upcoming_total: { minor_units: 0, currency: 'SGD' },
  upcoming_unknown_count: 0, increased_commitments: [], capture_issue_count: 0, followup_issue_count: 0,
  review_count: 0, recurring_suggestion_count: 0,
  freshness: { gmail_connected: false, gmail_last_checked: null, gmail_needs_reconnection: false, last_capture_processed_at: null },
};

const BREAKDOWN_JSON = {
  start: '2026-09-01', end: '2026-09-10',
  by_category: {
    Bills: { minor_units: 18200, currency: 'SGD' },
    Food: { minor_units: 15810, currency: 'SGD' },
    Shopping: { minor_units: 9690, currency: 'SGD' },
    Entertainment: { minor_units: 2886, currency: 'SGD' },
    Transport: { minor_units: 2640, currency: 'SGD' },
    Other: { minor_units: 600, currency: 'SGD' },
  },
  unresolved_count: 0, indicative_count: 0, status: 'complete',
};

async function mockAuthenticatedHome(page: import('@playwright/test').Page) {
  await page.route('**/api/ping', (route) => route.fulfill({ json: { status: 'ok' } }));
  await page.route('**/api/users/me', (route) => route.fulfill({ json: {
    username: 'test', gmail_connected: false, telegram_chat_id: null, wants_gmail: false,
    wants_apple_wallet: false, onboarding_complete: true, force_password_change: false,
  } }));
  await page.route('**/api/settings', (route) => route.fulfill({ json: {
    anomaly_multiplier: 2, velocity_alert_threshold: 2, budgets_enabled: true, goals_enabled: true,
    trips_enabled: true, subscriptions_enabled: true, recurring_enabled: true, home_briefing_enabled: true,
  } }));
  await page.route('**/api/categories', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v2/home', (route) => route.fulfill({ json: HOME_JSON }));
  await page.route('**/api/v2/spending/breakdown**', (route) => route.fulfill({ json: BREAKDOWN_JSON }));
  await page.route('**/api/v2/transactions/daily-totals**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v2/spending/merchants**', (route) => route.fulfill({ json: [] }));
}

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
  const glow = page.locator('.hero-glow-warm, .hero-glow-teal, .hero-glow-coral').first();
  await expect(glow).toBeVisible();
  const animationName = await glow.evaluate((el) => getComputedStyle(el, '::after').animationName);
  expect(animationName).toBe('none');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  const glowReduced = page.locator('.hero-glow-warm, .hero-glow-teal, .hero-glow-coral').first();
  await expect(glowReduced).toBeVisible();
  const animationNameReduced = await glowReduced.evaluate((el) => getComputedStyle(el, '::after').animationName);
  expect(animationNameReduced).toBe('none');
});
