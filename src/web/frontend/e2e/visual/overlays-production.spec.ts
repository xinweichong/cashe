import { test, expect, type Page } from '@playwright/test';

// Rendered checks for shared overlay and field owners (dialog, dropdown-menu, .input-field):
// surfaces must resolve through theme tokens rather than currentColor borders
// or the Radix `accent` compat token (which equals foreground, so a focused
// menu item used to render near-white text on a near-white fill).

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript((t) => {
    window.localStorage.setItem('cashe-appearance', t);
  }, theme);
}

async function mockAuthenticatedSettings(page: Page) {
  await page.route('**/api/ping', (route) => route.fulfill({ json: { status: 'ok' } }));
  await page.route('**/api/users/me', (route) => route.fulfill({ json: {
    username: 'test', gmail_connected: false, telegram_chat_id: null, wants_gmail: false,
    wants_apple_wallet: false, onboarding_complete: true, force_password_change: false,
  } }));
  await page.route('**/api/settings', (route) => route.fulfill({ json: {
    anomaly_multiplier: 2, velocity_alert_threshold: 2, budgets_enabled: false, goals_enabled: true,
    trips_enabled: true, subscriptions_enabled: true, recurring_enabled: false, home_briefing_enabled: true,
  } }));
  await page.route('**/api/categories', (route) => route.fulfill({ json: [] }));
}

async function cssVar(page: Page, name: string) {
  return page.evaluate((n) => {
    const probe = document.createElement('div');
    probe.style.color = `var(${n})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);
}

for (const theme of ['dark', 'light'] as const) {
  test(`dialog surface, border and overlay resolve through theme tokens (${theme})`, async ({ page }) => {
    await setTheme(page, theme);
    await mockAuthenticatedSettings(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/settings');
    await page.getByRole('button', { name: /^Add$/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(400); // let the entrance animation settle

    const styles = await dialog.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, border: s.borderTopColor, animation: s.animationName };
    });
    expect(styles.bg).toBe(await cssVar(page, '--color-card-elev'));
    expect(styles.border).toBe(await cssVar(page, '--color-border'));
    expect(styles.animation).toBe('pop-in');

    const close = dialog.getByRole('button', { name: 'Close' });
    const closeBox = (await close.boundingBox())!;
    expect(closeBox.width).toBeGreaterThanOrEqual(40);

    await page.screenshot({ path: `e2e/screenshots/overlay-dialog-${theme}.png` });
  });

  test(`profile menu focus state keeps readable contrast (${theme})`, async ({ page }) => {
    await setTheme(page, theme);
    await mockAuthenticatedSettings(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Profile menu' }).click();
    const item = page.getByRole('menuitem', { name: 'Settings' });
    await expect(item).toBeVisible();
    await item.focus();
    await page.waitForTimeout(300);

    const colors = await item.evaluate((el) => {
      const s = getComputedStyle(el);
      return { fg: s.color, bg: s.backgroundColor };
    });
    expect(colors.fg).toBe(await cssVar(page, '--color-foreground'));
    expect(colors.bg).not.toBe(colors.fg);

    const menu = page.getByRole('menu');
    const border = await menu.evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(border).toBe(await cssVar(page, '--color-border'));

    await page.screenshot({ path: `e2e/screenshots/overlay-profile-menu-${theme}.png` });
  });
}

for (const viewport of [{ width: 390, height: 844, size: '16px' }, { width: 1440, height: 900, size: '14px' }]) {
  test(`Input and native .input-field share one focus/size contract at ${viewport.width}px`, async ({ page }) => {
    await mockAuthenticatedSettings(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/settings');
    const wrapped = page.getByPlaceholder('Current password');
    const native = page.locator('input[type="number"]').first();
    await expect(wrapped).toBeVisible();
    for (const field of [wrapped, native]) {
      await field.scrollIntoViewIfNeeded();
      await field.focus();
      const s = await field.evaluate((el) => {
        const c = getComputedStyle(el);
        return { size: c.fontSize, shadow: c.boxShadow, radius: c.borderRadius };
      });
      expect(s.size).toBe(viewport.size);
      expect(s.radius).toBe('6px');
      expect(s.shadow).not.toBe('none');
    }
  });
}
