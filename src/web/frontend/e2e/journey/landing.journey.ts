import { test, expect } from '@playwright/test';

// Signed out, `/` is the public landing page; its Sign In opens the login
// screen at /login, and signing in there lands on Home.

test('landing → Sign In → login → Home', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /written down for you/ })).toBeVisible();
  await expect(page.locator('[data-step]')).toHaveCount(4);

  await page.getByRole('banner').getByRole('link', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await page.getByLabel(/username/i).fill('journey');
  await page.getByLabel(/password/i).fill('journey-password');
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
});

test('a signed-out deep link shows the login screen in place', async ({ page }) => {
  await page.goto('/activity');
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await expect(page).toHaveURL(/\/activity$/);
});
