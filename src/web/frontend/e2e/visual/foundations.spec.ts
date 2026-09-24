import { test, expect, type Page } from '@playwright/test';

// Verification for the design-language-restoration baseline fixes
// (docs/plans/2026-09-16-cashe-design-restoration-baseline-audit.md):
// type scale, Card geometry, Badge tones, shell wash. Screenshots land in
// e2e/screenshots/ for manual review; this is not a pixel-diff regression
// suite (no committed baseline images).

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript((t) => {
    window.localStorage.setItem('cashe-appearance', t);
  }, theme);
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`DevPreviewPage — ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await setTheme(page, theme);
      await page.goto('/dev/preview');
      await expect(page.getByTestId('section-badge')).toBeVisible();
    });

    test(`type scale computed sizes match docs/design-language.md §3.2 (${theme})`, async ({ page }) => {
      const expected: Record<string, number> = {
        'text-2xs': 11, 'text-xs': 12, 'text-sm': 14, 'text-base': 16,
        'text-lg': 20, 'text-xl': 25, 'text-2xl': 31, 'text-3xl': 39,
        'text-4xl': 49, 'text-5xl': 61, 'text-6xl': 77,
      };
      for (const [label, px] of Object.entries(expected)) {
        const el = page.getByTestId(`type-${label}`).locator('span').nth(1);
        const fontSize = await el.evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
        expect(fontSize, `${label} should compute to ${px}px`).toBeCloseTo(px, 0);
      }
    });

    test(`ordinary Card uses 8px radius and border-only elevation (${theme})`, async ({ page }) => {
      const card = page.getByTestId('ordinary-card');
      const radius = await card.evaluate((n) => getComputedStyle(n).borderRadius);
      expect(radius).toBe('8px');
      const shadow = await card.evaluate((n) => getComputedStyle(n).boxShadow);
      expect(shadow).toBe('none');
    });

    test(`badge tones render distinct, theme-resolved colours (${theme})`, async ({ page }) => {
      const tones = ['saved', 'calm', 'active', 'notable', 'warm'];
      const colors = new Set<string>();
      for (const tone of tones) {
        const badge = page.getByTestId('badge-tones').getByText(tone, { exact: true });
        const color = await badge.evaluate((n) => getComputedStyle(n).color);
        colors.add(color);
      }
      expect(colors.size).toBe(tones.length);
    });

    test(`screenshot: full preview page (${theme})`, async ({ page }) => {
      await page.screenshot({ path: `e2e/screenshots/preview-${theme}.png`, fullPage: true });
    });
  });
}
