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
const sgd = (minor_units: number) => ({ minor_units, currency: 'SGD' as const });
export const PERIOD = { start: '2026-09-01', end: '2026-09-20', spending: sgd(186420), income: sgd(620000), recorded_net_flow: sgd(433580), transaction_count: 64, unresolved_count: 0, indicative_count: 0, status: 'complete' };
export const MONTH_FACTS = {
  as_of: '2026-09-20', timezone: 'Asia/Singapore', undated_count: 0,
  current: PERIOD, comparison_current: PERIOD,
  previous: { ...PERIOD, start: '2026-08-01', end: '2026-08-20', spending: sgd(161880), income: sgd(620000), recorded_net_flow: sgd(458120), transaction_count: 58 },
  change: sgd(24540),
  category_changes: [
    { category: 'Food', change: sgd(18230) },
    { category: 'Shopping', change: sgd(-9120) },
    { category: 'Transport', change: sgd(6410) },
    { category: 'Entertainment', change: sgd(5300) },
    { category: 'Bills', change: sgd(3720) },
  ],
  top_category_driver: {
    category: 'Food', change: sgd(18230),
    merchant_driver: { merchant: 'Omakase Ren', change: sgd(12800) },
    frequency_driver: { classification: 'mixed', current_count: 31, previous_count: 24, current_avg: sgd(2190), previous_avg: sgd(2070) },
    one_off_driver: null, overlap_note: 'note',
  },
  trip_drivers: [],
};
export const WEEKDAY_PATTERN = {
  start: '2026-07-20', end: '2026-09-13', weeks: 8,
  pattern: [6120, 4380, 5210, 4870, 8950, 12640, 9730].map((v, weekday) => ({ weekday, average: sgd(v), transaction_count: 8 + weekday })),
};
export const SUBSCRIPTION_REVIEW = {
  overdue: [{ subscription_id: 3, label: 'ClassPass', days_since_last_charge: 41 }],
  annual_renewals: [{ subscription_id: 4, label: 'iCloud+ 2TB', days_until_renewal: 12 }],
  price_changes: [{ subscription_id: 9, label: 'Netflix', old_amount: sgd(1998), new_amount: sgd(2298), change: sgd(300), annualized_impact: sgd(3600), old_date: '2026-08-05', new_date: '2026-09-05' }],
};
const DAILY = [4210, 12880, 6540, 9320, 18650, 22410, 3120, 7790, 8830, 5460, 11020, 19870, 14330, 2980, 6650, 9910, 7120, 10240, 13570, 9120];
const days = (n: number) => Array.from({ length: n }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
export const EXPLORE_TREND = days(20).map((date, i) => ({ date, categories: {
  Food: sgd(Math.round(DAILY[i] * 0.45)), Transport: sgd(Math.round(DAILY[i] * 0.18) + 400), Entertainment: sgd(i % 5 === 4 ? 4800 : 600), Shopping: sgd(i % 4 === 1 ? 5200 : i % 3 === 0 ? 1400 : 0),
} }));
export const EXPLORE_BREAKDOWN = { start: '2026-09-01', end: '2026-09-20', unresolved_count: 0, indicative_count: 0, status: 'complete', by_category: {
  Food: sgd(67890), Bills: sgd(38200), Transport: sgd(29510), Shopping: sgd(21340), Entertainment: sgd(18700), Other: sgd(10780),
} };
export const EXPLORE_MERCHANTS = [
  ['Omakase Ren', 2, 21600], ['FairPrice Finest', 6, 18430], ['Grab', 22, 15210], ['Singtel', 1, 12800], ['Uniqlo', 2, 11240],
  ['Toast Box', 14, 6720], ['Golden Village', 3, 5400], ['SimplyGo', 38, 5320], ['Kopitiam', 17, 4890], ['Shopee', 4, 4310],
].map(([merchant, visits, total]) => ({ merchant, visits, total: sgd(total as number) }));
export const EXPLORE_SIGNALS = {
  start: '2026-09-01', end: '2026-09-20', multiplier: 2,
  unusual: [
    { transaction_id: 311, merchant: 'Omakase Ren', category: 'Food', date: '2026-09-12', amount: sgd(18800), typical: sgd(4400), ratio: 4.3 },
    { transaction_id: 298, merchant: 'Grab', category: 'Transport', date: '2026-09-06', amount: sgd(6420), typical: sgd(1850), ratio: 3.5 },
  ],
  new_merchants: [
    { merchant: 'Kinokuniya', first_date: '2026-09-14', category: 'Shopping', amount: sgd(5690), transaction_id: 320 },
  ],
};
export const EXPLORE_HEALTH = {
  score: 91, grade: 'Excellent', has_income_data: true, period: '2026-09', start: '2026-09-01', end: '2026-09-20',
  status: 'complete', unresolved_count: 0, income: sgd(620000), spending: sgd(186420),
  components: {
    savings_rate: { score: 40, max: 40, value: 0.699, benchmark: 0.2, label: 'Savings Rate', description: 'Income left after all spending' },
    needs_ratio: { score: 20, max: 20, value: 0.182, benchmark: 0.5, label: 'Needs Ratio', description: 'Essentials: transport, groceries, bills' },
    wants_ratio: { score: 20, max: 20, value: 0.118, benchmark: 0.3, label: 'Wants Ratio', description: 'Extras: dining, entertainment, shopping' },
    budget_adherence: { score: 5, max: 10, value: 0.5, label: 'Budget Adherence', description: 'Budgets within their limit this period' },
    anomaly_frequency: { score: 6, max: 10, value: 2, label: 'Unusual Purchases', description: 'Over twice your usual at that merchant' },
  },
};
export function exploreMonthly(months: number) {
  return Array.from({ length: months }, (_, i) => {
    const offset = months - 1 - i;
    const d = new Date(2026, 8 - offset, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const spend = 210000 + ((offset * 37) % 9) * 14000 - (offset === 0 ? 40000 : 0);
    return { month, start: `${month}-01`, end: `${month}-28`, spending: sgd(spend), income: offset % 7 === 5 ? null : sgd(620000), recorded_net_flow: null, transaction_count: 70, unresolved_count: 0, indicative_count: 0, status: 'complete' };
  });
}

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
  await page.route('**/api/categories', (route) => route.fulfill({ json: ['Food', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'Other'].map((name) => (
    { name, keywords: null, icon: null, color: null, type: name === 'Bills' || name === 'Transport' ? 'needs' : 'wants' }
  )) }));
  await page.route('**/api/v2/spending/month**', (route) => route.fulfill({ json: MONTH_FACTS }));
  await page.route('**/api/v2/spending/weekday-pattern**', (route) => route.fulfill({ json: WEEKDAY_PATTERN }));
  await page.route('**/api/v2/subscriptions/review**', (route) => route.fulfill({ json: SUBSCRIPTION_REVIEW }));
  await page.route('**/api/v2/spending/merchants**', (route) => route.fulfill({ json: EXPLORE_MERCHANTS }));
  await page.route('**/api/v2/spending/breakdown**', (route) => route.fulfill({ json: EXPLORE_BREAKDOWN }));
  await page.route('**/api/v2/spending/trend-by-category**', (route) => {
    const cats = (new URL(route.request().url()).searchParams.get('categories') ?? '').split(',');
    route.fulfill({ json: EXPLORE_TREND.map((p) => ({ date: p.date, categories: Object.fromEntries(Object.entries(p.categories).filter(([c]) => cats.includes(c))) })) });
  });
  await page.route('**/api/v2/transactions/daily-totals**', (route) => route.fulfill({ json: days(20).map((date, i) => ({
    date, spending: sgd(DAILY[i]), income: null, recorded_net_flow: null, transaction_count: 3, unresolved_count: 0, indicative_count: 0, status: 'complete',
  })) }));
  await page.route('**/api/v2/spending/signals**', (route) => route.fulfill({ json: EXPLORE_SIGNALS }));
  await page.route('**/api/v2/analytics/health-score**', (route) => route.fulfill({ json: EXPLORE_HEALTH }));
  await page.route('**/api/v2/spending/monthly**', (route) => route.fulfill({ json: exploreMonthly(Number(new URL(route.request().url()).searchParams.get('months') ?? 6)) }));
  await page.route('**/api/analytics/insight', (route) => route.fulfill({ json: {
    content: { narrative: 'Synthetic preview: food is running $182 ahead of the same days in August, mostly one omakase dinner. Transport crept up on weekend rides; everything else is steady.', nudges: ['Weekend rides add up', 'Groceries on track'] },
    generated_at: new Date(Date.now() - 3 * 3_600_000).toISOString(), is_stale: false,
  } }));
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
