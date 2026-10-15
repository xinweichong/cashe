import { test, expect } from '@playwright/test';

// Signed out, `/` is the public landing page; its Sign In opens the login
// screen at /login, and signing in there lands on Home.

test('landing → Sign In → login → Home', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page).toHaveTitle('cashe · cash, caught.');
  await expect(page.getByRole('heading', { level: 1, name: 'cash, caught.' })).toBeVisible();

  // The tour's pills jump the pinned stage to a page of the app. The page is
  // prerendered HTML until the app script (loaded after `load`) takes over.
  await page.waitForLoadState('networkidle');
  const tour = page.getByRole('navigation', { name: 'Tour of cashe' });
  await expect(tour.getByRole('link')).toHaveCount(4);
  await tour.getByRole('link', { name: 'Plan' }).click();
  await expect(tour.getByRole('link', { name: 'Plan' })).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('heading', { level: 2, name: 'See the month before it happens.' })).toBeVisible();

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
