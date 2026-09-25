import type { Page } from '@playwright/test';

// Mocked-network fixtures shared by the visual specs and the perf harness.
// No backend or auth is used; see each spec for what it exercises.

// ── home ────────────────────────────────────────────────────────
export const HOME_JSON = {
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

export const BREAKDOWN_JSON = {
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

export async function mockAuthenticatedHome(page: Page) {
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

// ── explore ─────────────────────────────────────────────────────
export const PERIOD = { start: '2026-09-01', end: '2026-09-10', spending: { minor_units: 49826, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 5, unresolved_count: 0, indicative_count: 0, status: 'complete' };
export const MONTH_FACTS = {
  as_of: '2026-09-10', timezone: 'Asia/Singapore', undated_count: 0,
  current: PERIOD, comparison_current: PERIOD, previous: { ...PERIOD, start: '2026-08-01', end: '2026-08-10' },
  change: { minor_units: 2000, currency: 'SGD' },
  category_changes: [
    { category: 'Food', change: { minor_units: 2000, currency: 'SGD' } },
    { category: 'Shopping', change: { minor_units: -800, currency: 'SGD' } },
  ],
  top_category_driver: null, trip_drivers: [],
};
export const WEEKDAY_PATTERN = {
  start: '2026-08-24', end: '2026-09-06', weeks: 2,
  pattern: Array.from({ length: 7 }, (_, weekday) => ({ weekday, average: { minor_units: (weekday + 1) * 500, currency: 'SGD' }, transaction_count: weekday })),
};
export const SUBSCRIPTION_REVIEW = { overdue: [], annual_renewals: [], price_changes: [] };

export async function mockAuthenticatedExplore(page: Page) {
  await page.route('**/api/ping', (route) => route.fulfill({ json: { status: 'ok' } }));
  await page.route('**/api/users/me', (route) => route.fulfill({ json: {
    username: 'test', gmail_connected: false, telegram_chat_id: null, wants_gmail: false,
    wants_apple_wallet: false, onboarding_complete: true, force_password_change: false,
  } }));
  await page.route('**/api/settings', (route) => route.fulfill({ json: {
    anomaly_multiplier: 2, velocity_alert_threshold: 2, budgets_enabled: true, goals_enabled: true,
    trips_enabled: true, subscriptions_enabled: true, recurring_enabled: true, home_briefing_enabled: true,
  } }));
  await page.route('**/api/categories', (route) => route.fulfill({ json: [
    { name: 'Food', keywords: null, icon: null, color: null, type: 'wants' },
    { name: 'Shopping', keywords: null, icon: null, color: null, type: 'wants' },
  ] }));
  await page.route('**/api/v2/spending/month**', (route) => route.fulfill({ json: MONTH_FACTS }));
  await page.route('**/api/v2/spending/weekday-pattern**', (route) => route.fulfill({ json: WEEKDAY_PATTERN }));
  await page.route('**/api/v2/subscriptions/review**', (route) => route.fulfill({ json: SUBSCRIPTION_REVIEW }));
  await page.route('**/api/v2/spending/merchants**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v2/spending/trend-by-category**', (route) => route.fulfill({ json: [
    { date: '2026-09-01', categories: { Food: { minor_units: 1200, currency: 'SGD' } } },
    { date: '2026-09-02', categories: { Food: { minor_units: 800, currency: 'SGD' } } },
  ] }));
  await page.route('**/api/trips**', (route) => route.fulfill({ json: [] }));
}

// ── plan ────────────────────────────────────────────────────────
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

export const today = new Date();
// A charge a few days out, safely inside the same displayed month and the
// default 30-day agenda window — used to prove calendar/agenda selection
// stays synchronised without a full-window fetch.
export const nearChargeDate = toDateStr(addDays(today, 3));
// A charge well outside the default 30-day agenda window — used to prove
// the calendar's per-day summary and the selected-day detail fetch cover
// dates the paginated agenda never loaded.
export const farChargeDate = toDateStr(addDays(today, 45));

export const FORECAST_JSON = {
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

export const AGENDA_ITEM = {
  id: 1, subscription_id: 7, label: 'Broadband', date: nearChargeDate, frequency: 'monthly',
  schedule_status: 'active', confirmation_source: 'user', amount: { minor_units: 4500, currency: 'SGD' },
  date_basis: 'schedule', amount_basis: 'matched_charge', amount_basis_transaction_id: null,
};
export const AGENDA_JSON = {
  start: toDateStr(today), end: toDateStr(addDays(today, 29)), timezone: 'Asia/Singapore', enabled: true,
  items: [AGENDA_ITEM], total: 1, limit: 50, offset: 0,
  known_total: { minor_units: 4500, currency: 'SGD' }, unknown_count: 0, status: 'estimated',
};
export const FAR_DAY_ITEM = {
  id: 2, subscription_id: 9, label: 'Annual domain renewal', date: farChargeDate, frequency: 'annual',
  schedule_status: 'active', confirmation_source: 'unknown', amount: { minor_units: 1800, currency: 'SGD' },
  date_basis: 'schedule', amount_basis: 'unknown', amount_basis_transaction_id: null,
};

export async function mockAuthenticatedPlan(page: Page) {
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

// ── activity ────────────────────────────────────────────────────
export const TRANSACTIONS = [
  { id: 1, revision: 1, source: 'manual', type: 'expense', merchant: 'NUS The Deck', category: 'Food', original: { minor_units: 130, currency: 'SGD' }, reporting: { minor_units: 130, currency: 'SGD' }, conversion: { status: 'native', rate: null, source: null, quoted_at: null }, transaction_date: '2026-09-17T11:22:00', ingested_at: '2026-09-17T11:22:00', description: null, refund_of: null, refunded_by: [], excluded_from_baseline: false },
  { id: 2, revision: 1, source: 'manual', type: 'expense', merchant: 'Japanese Cuisine', category: 'Food', original: { minor_units: 500, currency: 'SGD' }, reporting: { minor_units: 500, currency: 'SGD' }, conversion: { status: 'native', rate: null, source: null, quoted_at: null }, transaction_date: '2026-09-17T09:00:00', ingested_at: '2026-09-17T09:00:00', description: null, refund_of: null, refunded_by: [], excluded_from_baseline: false },
];

export async function mockAuthenticatedActivity(page: Page) {
  await page.route('**/api/ping', (route) => route.fulfill({ json: { status: 'ok' } }));
  await page.route('**/api/users/me', (route) => route.fulfill({ json: {
    username: 'test', gmail_connected: false, telegram_chat_id: null, wants_gmail: false,
    wants_apple_wallet: false, onboarding_complete: true, force_password_change: false,
  } }));
  await page.route('**/api/settings', (route) => route.fulfill({ json: {
    anomaly_multiplier: 2, velocity_alert_threshold: 2, budgets_enabled: false, goals_enabled: true,
    trips_enabled: false, subscriptions_enabled: true, recurring_enabled: false, home_briefing_enabled: true,
  } }));
  await page.route('**/api/categories', (route) => route.fulfill({ json: [
    { name: 'Food', keywords: null, icon: null, color: null, type: 'wants' },
  ] }));
  await page.route('**/api/trips**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v2/home', (route) => route.fulfill({ json: {
    facts: { as_of: '2026-09-17', timezone: 'Asia/Singapore', undated_count: 0, current: { start: '2026-09-01', end: '2026-09-17', spending: { minor_units: 0, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 0, unresolved_count: 0, indicative_count: 0, status: 'complete' }, comparison_current: { start: '2026-08-01', end: '2026-08-17', spending: { minor_units: 0, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 0, unresolved_count: 0, indicative_count: 0, status: 'complete' }, previous: { start: '2026-08-01', end: '2026-08-17', spending: { minor_units: 0, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 0, unresolved_count: 0, indicative_count: 0, status: 'complete' }, change: null, category_changes: [], top_category_driver: null, trip_drivers: [] },
    spending_target: null, recent: [], upcoming: [], upcoming_total: { minor_units: 0, currency: 'SGD' }, upcoming_unknown_count: 0, increased_commitments: [], capture_issue_count: 0, followup_issue_count: 0, review_count: 0, recurring_suggestion_count: 0,
    freshness: { gmail_connected: false, gmail_last_checked: null, gmail_needs_reconnection: false, last_capture_processed_at: null },
  } }));
  await page.route('**/api/v2/transactions**', (route) => route.fulfill({ json: TRANSACTIONS }));
  await page.route('**/api/v2/transactions/daily-totals**', (route) => route.fulfill({ json: [] }));
}
