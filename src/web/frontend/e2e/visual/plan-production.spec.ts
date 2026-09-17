import { test, expect } from '@playwright/test';

// Exercises the real authenticated route (App -> AppShell -> PlanPage), not
// an isolated fixture — see e2e/visual/home-production.spec.ts and
// explore-production.spec.ts for why this matters (AppShell's layout isn't
// present in unit tests). Network is mocked; no backend/auth used.
//
// Dates are derived from the real system clock rather than hardcoded,
// because PlanPage's calendar/week-strip default to the current date
// client-side (there is no server "as of" for calendar navigation).

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

const today = new Date();
// A charge a few days out, safely inside the same displayed month and the
// default 30-day agenda window — used to prove calendar/agenda selection
// stays synchronised without a full-window fetch.
const nearChargeDate = toDateStr(addDays(today, 3));
// A charge well outside the default 30-day agenda window — used to prove
// the calendar's per-day summary and the selected-day detail fetch cover
// dates the paginated agenda never loaded.
const farChargeDate = toDateStr(addDays(today, 45));

const FORECAST_JSON = {
  as_of: toDateStr(today), timezone: 'Asia/Singapore',
  period_start: `${toDateStr(today).slice(0, 8)}01`, period_end: toDateStr(today),
  status: 'complete', reasons: [],
  recorded_actual: { minor_units: 300000, currency: 'SGD' },
  confirmed_commitments: { minor_units: 50000, currency: 'SGD' },
  unpriced_commitment_count: 0,
  remaining_variable_estimate: { minor_units: 80000, currency: 'SGD' },
  remaining_variable_low: { minor_units: 50000, currency: 'SGD' },
  remaining_variable_high: { minor_units: 120000, currency: 'SGD' },
  projected_total: { minor_units: 430000, currency: 'SGD' },
  projected_total_low: { minor_units: 400000, currency: 'SGD' },
  projected_total_high: { minor_units: 470000, currency: 'SGD' },
  weekday_medians: [], lookback_window: { start: '2026-07-01', end: '2026-08-31' },
  assumptions: ['Test assumption for the projection breakdown.'],
};

const AGENDA_ITEM = {
  id: 1, subscription_id: 7, label: 'Broadband', date: nearChargeDate, frequency: 'monthly',
  schedule_status: 'active', confirmation_source: 'user', amount: { minor_units: 4500, currency: 'SGD' },
  date_basis: 'schedule', amount_basis: 'matched_charge', amount_basis_transaction_id: null,
};
const AGENDA_JSON = {
  start: toDateStr(today), end: toDateStr(addDays(today, 29)), timezone: 'Asia/Singapore', enabled: true,
  items: [AGENDA_ITEM], total: 1, limit: 50, offset: 0,
  known_total: { minor_units: 4500, currency: 'SGD' }, unknown_count: 0, status: 'estimated',
};
const FAR_DAY_ITEM = {
  id: 2, subscription_id: 9, label: 'Annual domain renewal', date: farChargeDate, frequency: 'annual',
  schedule_status: 'active', confirmation_source: 'unknown', amount: { minor_units: 1800, currency: 'SGD' },
  date_basis: 'schedule', amount_basis: 'unknown', amount_basis_transaction_id: null,
};

async function mockAuthenticatedPlan(page: import('@playwright/test').Page) {
  await page.route('**/api/ping', (route) => route.fulfill({ json: { status: 'ok' } }));
  await page.route('**/api/users/me', (route) => route.fulfill({ json: {
    username: 'test', gmail_connected: false, telegram_chat_id: null, wants_gmail: false,
    wants_apple_wallet: false, onboarding_complete: true, force_password_change: false,
  } }));
  await page.route('**/api/settings', (route) => route.fulfill({ json: {
    anomaly_multiplier: 2, velocity_alert_threshold: 2, budgets_enabled: true, goals_enabled: true,
    trips_enabled: true, subscriptions_enabled: true, recurring_enabled: true, home_briefing_enabled: true,
  } }));
  await page.route('**/api/v2/forecast/month**', (route) => route.fulfill({ json: FORECAST_JSON }));
  await page.route('**/api/v2/plan/upcoming/calendar**', (route) => {
    const url = new URL(route.request().url());
    route.fulfill({ json: {
      start: url.searchParams.get('start'), end: url.searchParams.get('end'), timezone: 'Asia/Singapore',
      days: [{ date: nearChargeDate, known_total: { minor_units: 4500, currency: 'SGD' }, unknown_count: 0, recorded_charge_count: 1 }],
    } });
  });
  await page.route('**/api/v2/plan/upcoming?**', (route) => {
    const url = new URL(route.request().url());
    const onDate = url.searchParams.get('date');
    if (onDate === farChargeDate) {
      route.fulfill({ json: {
        start: farChargeDate, end: farChargeDate, timezone: 'Asia/Singapore', enabled: true,
        items: [FAR_DAY_ITEM], total: 1, limit: 50, offset: 0,
        known_total: { minor_units: 1800, currency: 'SGD' }, unknown_count: 0, status: 'estimated',
      } });
    } else if (onDate) {
      route.fulfill({ json: { start: onDate, end: onDate, timezone: 'Asia/Singapore', enabled: true, items: [], total: 0, limit: 50, offset: 0, known_total: { minor_units: 0, currency: 'SGD' }, unknown_count: 0, status: 'estimated' } });
    } else {
      route.fulfill({ json: AGENDA_JSON });
    }
  });
}

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

test('production Plan uses a week strip with an explicit calendar toggle on phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAuthenticatedPlan(page);
  await page.goto('/plan');
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
