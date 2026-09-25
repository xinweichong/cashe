import { test, expect } from '@playwright/test';

// Exercises the real authenticated route (App -> AppShell -> PlanPage), not
// an isolated fixture — see e2e/visual/home-production.spec.ts and
// explore-production.spec.ts for why this matters (AppShell's layout isn't
// present in unit tests). Network is mocked; no backend/auth used.
//
// Dates are derived from the real system clock rather than hardcoded,
// because PlanPage's calendar/week-strip default to the current date
// client-side (there is no server "as of" for calendar navigation).

import { nearChargeDate, farChargeDate, mockAuthenticatedPlan } from '../fixtures/mocks';

test('production Plan shows the recorded/scheduled/remaining projection breakdown', async ({ page }) => {
  await mockAuthenticatedPlan(page);
  await page.goto('/plan');
  await expect(page.getByText('$4,300.00')).toBeVisible();
  await expect(page.getByRole('img', { name: /Recorded.*Scheduled \$500\.00.*estimated remaining/i })).toBeVisible();
  await expect(page.getByText(/\$4,000\.00.*\$4,700\.00/)).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/plan-production.png', fullPage: true });
});

test('production Plan pairs the month calendar with the agenda on desktop and keeps selection synchronised', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedPlan(page);
  await page.goto('/plan');
  const calendar = page.getByTestId('month-calendar');
  await expect(calendar).toBeVisible();
  await expect(page.getByText('Broadband', { exact: true })).toBeVisible();

  const dayButton = calendar.getByRole('button', { name: String(new Date(nearChargeDate).getDate()), exact: true });
  await dayButton.click();
  await expect(page).toHaveURL(new RegExp(`date=${nearChargeDate}`));
  await expect(dayButton).toHaveAttribute('aria-pressed', 'true');
  // The charge is inside the loaded agenda window, so no separate
  // out-of-window detail fetch/card should appear.
  await expect(page.getByText(/^Charges on/)).toHaveCount(0);
});

test('production Plan keeps a week strip with an explicit calendar toggle in the phone timeline', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAuthenticatedPlan(page);
  await page.goto('/plan');
  // On phone the calendar lives in the Timeline drill-in, not the glance.
  await page.getByRole('button', { name: /^Timeline and calendar/ }).click();
  await expect(page.getByTestId('week-strip')).toBeVisible();
  await expect(page.getByTestId('month-calendar')).toHaveCount(0);
  await page.getByRole('button', { name: 'View calendar' }).click();
  await expect(page.getByTestId('month-calendar')).toBeVisible();
  await page.getByRole('button', { name: 'Hide calendar' }).click();
  await expect(page.getByTestId('month-calendar')).toHaveCount(0);
});

test('selecting a day outside the loaded agenda window fetches its own bounded detail', async ({ page }) => {
  await mockAuthenticatedPlan(page);
  await page.goto(`/plan?date=${farChargeDate}`);
  await expect(page.getByText(/^Charges on/)).toBeVisible();
  await expect(page.getByText('Annual domain renewal')).toBeVisible();
  await expect(page.getByText('$18.00')).toBeVisible();
});
