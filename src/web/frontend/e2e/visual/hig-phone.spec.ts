import { test, expect, type Page } from '@playwright/test';
import { mockAuthenticatedActivity, mockAuthenticatedExplore, mockAuthenticatedHome, mockAuthenticatedPlan } from '../fixtures/mocks';

// HIG alignment (Direction B, 2026-10-01) on a phone: every tab root is a
// naturally scrolling page under a large title; details are pushed pages
// that Back pops; tasks are sheets. Replaces the one-screen lens specs.

const PHONE = { width: 390, height: 844 };

async function noSidewaysScroll(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(inner);
}

const ROOTS: [string, string, (page: Page) => Promise<void>][] = [
  ['/', 'Home', mockAuthenticatedHome],
  ['/activity', 'Activity', mockAuthenticatedActivity],
  ['/plan', 'Plan', mockAuthenticatedPlan],
  ['/explore', 'Explore', mockAuthenticatedExplore],
];

for (const [path, title, mock] of ROOTS) {
  test(`phone ${title} is a scrolling page under a large title, with the tab bar and no shell bar`, async ({ page }) => {
    await mock(page);
    await page.setViewportSize(PHONE);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    // The page brings its own NavBar, so the shell's phone bar (wordmark banner) steps aside.
    await expect(page.locator('main').locator('xpath=preceding-sibling::header')).toHaveCount(0);
    await noSidewaysScroll(page);
  });
}

test('phone Activity pushes a transaction page and Back pops it', async ({ page }) => {
  await mockAuthenticatedActivity(page);
  await page.setViewportSize(PHONE);
  await page.goto('/activity');
  await page.getByText('NUS The Deck').click();
  await expect(page).toHaveURL(/\/activity\/1/);
  await expect(page.getByRole('heading', { level: 1, name: 'Transaction' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activity' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/activity$/);
  // The pushed page leaves on Back; wait until only the list row remains.
  await expect(page.getByText('NUS The Deck')).toHaveCount(1);
  await expect(page.getByText('NUS The Deck')).toBeVisible();
});

test('phone Activity Filters is a sheet that Done closes', async ({ page }) => {
  await mockAuthenticatedActivity(page);
  await page.setViewportSize(PHONE);
  await page.goto('/activity');
  await page.getByRole('button', { name: /^Filters/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Filters' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toBeHidden();
});

test('phone Plan opens a charge as its own page', async ({ page }) => {
  await mockAuthenticatedPlan(page);
  await page.setViewportSize(PHONE);
  await page.goto('/plan');
  await page.getByRole('button', { name: /Broadband/ }).click();
  await expect(page).toHaveURL(/charge=1/);
  await expect(page.getByRole('heading', { level: 1, name: 'Broadband' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit estimate' })).toBeVisible();
});

test('phone Explore opens a section as a pushed page and Back returns to the screen', async ({ page }) => {
  await mockAuthenticatedExplore(page);
  await page.setViewportSize(PHONE);
  await page.goto('/explore');
  await page.getByRole('tab', { name: 'Category' }).click();
  await page.getByRole('button', { name: 'What changed and why' }).click();
  await expect(page).toHaveURL(/section=category/);
  await expect(page.getByRole('heading', { level: 1, name: 'By category' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('link', { name: /Financial health|no score yet/ })).toBeVisible();
});

test('the Larger text size applies, persists, and still fits the page', async ({ page }) => {
  await mockAuthenticatedActivity(page);
  await page.setViewportSize(PHONE);
  await page.goto('/activity');
  await page.getByRole('button', { name: 'Profile menu' }).click();
  await page.getByRole('menuitemradio', { name: 'Larger' }).click();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('20px');
  await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
  await noSidewaysScroll(page);
  await page.reload();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('20px');
});
