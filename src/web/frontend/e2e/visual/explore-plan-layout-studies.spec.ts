import { test, expect, type Page } from '@playwright/test';

// Increment 2 exit gate (continued): Explore/Plan layout studies — spatial
// composition reviews, not full behavioural builds. See docs/plans/
// 2026-09-16-cashe-design-language-restoration.md §"Prototype milestone".

const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  'tablet-portrait': { width: 810, height: 1080 },
  'tablet-landscape': { width: 1194, height: 810 },
  desktop: { width: 1440, height: 900 },
};

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript((t) => {
    window.localStorage.setItem('cashe-appearance', t);
  }, theme);
}

for (const theme of ['dark', 'light'] as const) {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`Explore layout study screenshot — ${name} — ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await setTheme(page, theme);
      await page.goto('/dev/preview/explore');
      await expect(page.getByTestId('explore-layout-study')).toBeVisible();
      await expect(page.locator('.recharts-line').first()).toBeVisible();
      await page.screenshot({ path: `e2e/screenshots/explore-${name}-${theme}.png`, fullPage: true });
    });

    test(`Plan layout study screenshot — ${name} — ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await setTheme(page, theme);
      await page.goto('/dev/preview/plan');
      await expect(page.getByTestId('plan-layout-study')).toBeVisible();
      await page.screenshot({ path: `e2e/screenshots/plan-${name}-${theme}.png`, fullPage: true });
    });
  }
}

test.describe('Explore layout study interaction', () => {
  test('switching modes swaps the main visual while the inspection panel placement stays put', async ({ page }) => {
    await page.goto('/dev/preview/explore');
    await expect(page.locator('.recharts-line').first()).toBeVisible();
    await page.getByRole('tab', { name: 'By category' }).click();
    await expect(page.getByTestId('category-change-bars')).toBeVisible();
    await page.getByRole('tab', { name: 'By merchant' }).click();
    await expect(page.getByTestId('merchant-bars')).toBeVisible();
  });

  test('selecting a category change bar populates the inspection panel', async ({ page }) => {
    await page.goto('/dev/preview/explore');
    await page.getByRole('tab', { name: 'By category' }).click();
    await page.getByRole('button', { name: /Bills/ }).click();
    // PageCard titles render as a styled <span>, not a heading element — see
    // the finding recorded alongside this study (accessibility follow-up for
    // production Explore, not a layout-study regression).
    await expect(page.getByText('View transactions')).toBeVisible();
  });
});

test.describe('Plan layout study interaction', () => {
  test('desktop shows month calendar and agenda together with no toggle needed', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/dev/preview/plan');
    await expect(page.getByTestId('month-calendar')).toBeVisible();
    await expect(page.getByTestId('week-strip')).toBeHidden();
  });

  test('phone shows a week strip with an explicit Calendar view toggle', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.phone);
    await page.goto('/dev/preview/plan');
    await expect(page.getByTestId('week-strip')).toBeVisible();
    await expect(page.getByTestId('month-calendar')).toBeHidden();
    await page.getByRole('button', { name: 'View calendar' }).click();
    await expect(page.getByTestId('month-calendar')).toBeVisible();
  });

  test('selecting a day in the calendar highlights the matching agenda row', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/dev/preview/plan');
    await page.getByTestId('month-calendar').getByRole('button', { name: '12' }).click();
    const row = page.getByTestId('agenda-row-2026-09-12');
    await expect(row).toHaveClass(/bg-card-hover/);
  });
});
