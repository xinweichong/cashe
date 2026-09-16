import { test, expect, type Page } from '@playwright/test';

// Increment 2 exit gate: demonstrate the Home -> select category -> inspect
// transactions -> edit -> return journey with fixture data, at phone,
// portrait/landscape tablet and desktop widths, in both themes. See
// docs/plans/2026-09-16-cashe-design-language-restoration.md §"Prototype
// milestone". Screenshots are gitignored review artifacts, not a pixel-diff
// baseline.

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
    test(`Home prototype screenshot — ${name} — ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await setTheme(page, theme);
      await page.goto('/dev/preview/home');
      await expect(page.getByTestId('home-prototype')).toBeVisible();
      // Recharts' ResponsiveContainer measures on a post-mount tick; wait for
      // an actual pie slice rather than racing the initial paint.
      await expect(page.locator('.recharts-pie-sector').first()).toBeVisible();
      await page.screenshot({ path: `e2e/screenshots/home-${name}-${theme}.png`, fullPage: true });
    });
  }
}

test.describe('Home prototype journey', () => {
  test('select category -> view transactions -> edit -> return updates the chart', async ({ page }) => {
    await page.goto('/dev/preview/home');

    // Glance: hero total before any edit.
    const heroBefore = await page.locator('text=/^\\$[0-9,]+\\.[0-9]{2}$/').first().textContent();
    expect(heroBefore).toBeTruthy();

    // Understand: select a category via the legend.
    await page.getByRole('button', { name: /^Food/ }).click();
    await expect(page.getByText('Select a category', { exact: false })).toHaveCount(0);

    // Act: open evidence for the selected category.
    await page.getByRole('button', { name: 'View transactions' }).first().click();
    const sheet = page.getByTestId('evidence-sheet');
    await expect(sheet).toBeVisible();

    // Open one record and edit its amount.
    await sheet.getByText('FairPrice').click();
    const amountField = page.getByLabel('Amount');
    await amountField.fill('99.00');
    await page.getByRole('button', { name: 'Save' }).click();

    // Return: sheet closes, chart reflects the new total.
    await expect(sheet).not.toBeVisible();
    const heroAfter = await page.locator('text=/^\\$[0-9,]+\\.[0-9]{2}$/').first().textContent();
    expect(heroAfter).not.toBe(heroBefore);
  });

  test('category selection is keyboard-operable', async ({ page }) => {
    await page.goto('/dev/preview/home');
    const foodButton = page.getByRole('button', { name: /^Food/ });
    await foodButton.focus();
    await page.keyboard.press('Enter');
    await expect(foodButton).toHaveAttribute('aria-pressed', 'true');
  });

  test('reduced motion: journey completes with no animation dependency', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/dev/preview/home');
    await page.getByRole('button', { name: /^Food/ }).click();
    await page.getByRole('button', { name: 'View transactions' }).first().click();
    await expect(page.getByTestId('evidence-sheet')).toBeVisible();
  });
});
