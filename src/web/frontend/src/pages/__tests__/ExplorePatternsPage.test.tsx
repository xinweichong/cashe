import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { api, type Trip } from '@/api/client';
import { briefingApi, type SpendingFacts, type SpendingPeriod } from '@/api/briefing';
import { ExplorePatternsPage } from '../ExplorePatternsPage';

vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  api: {
    getSubscriptionReviewV2: vi.fn(),
    getCategories: vi.fn(),
    getMerchantRankingFactsV2: vi.fn(),
    getCategoryDailyTrendV2: vi.fn(),
    getCategoryBreakdownV2: vi.fn(),
    getTrips: vi.fn(),
    getTripSummaryV2: vi.fn(),
    getDailyTotalsV2: vi.fn(),
    getAnalyticsInsight: vi.fn(),
  },
}));
vi.mock('@/api/briefing', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/briefing')>(),
  briefingApi: { month: vi.fn(), weekdayPattern: vi.fn(), signals: vi.fn(), healthScore: vi.fn(), monthly: vi.fn() },
}));

async function selectMode(name: string) {
  // Radix's TabsTrigger selects on mousedown (not click) — see
  // @radix-ui/react-tabs' Trigger implementation.
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab, { button: 0 });
  await waitFor(() => expect(tab.getAttribute('aria-selected')).toBe('true'));
}

const period: SpendingPeriod = { start: '2026-09-01', end: '2026-09-06', spending: { minor_units: 1250, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 1, unresolved_count: 0, indicative_count: 0, status: 'complete' };
const monthFacts: SpendingFacts = { as_of: '2026-09-06', timezone: 'Asia/Singapore', undated_count: 0, current: period, comparison_current: period, previous: { ...period, start: '2026-08-01', end: '2026-08-06' }, change: { minor_units: 500, currency: 'SGD' }, category_changes: [{ category: 'Food & Drink', change: { minor_units: 500, currency: 'SGD' } }], top_category_driver: null, trip_drivers: [] };
const emptyReview = { overdue: [], price_changes: [], annual_renewals: [] };
const emptyPattern = { start: '2026-08-24', end: '2026-09-06', weeks: 2, pattern: Array.from({ length: 7 }, (_, weekday) => ({ weekday, average: { minor_units: 0, currency: 'SGD' as const }, transaction_count: 0 })) };

function show() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ExplorePatternsPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(briefingApi.month).mockResolvedValue(monthFacts);
  vi.mocked(briefingApi.weekdayPattern).mockResolvedValue(emptyPattern);
  vi.mocked(api.getSubscriptionReviewV2).mockResolvedValue(emptyReview);
  vi.mocked(api.getCategories).mockResolvedValue([]);
  vi.mocked(api.getMerchantRankingFactsV2).mockResolvedValue([]);
  vi.mocked(api.getCategoryDailyTrendV2).mockResolvedValue([]);
  vi.mocked(api.getTrips).mockResolvedValue([]);
  vi.mocked(api.getDailyTotalsV2).mockResolvedValue([]);
  vi.mocked(api.getAnalyticsInsight).mockResolvedValue({ content: null, generated_at: null, is_stale: true });
  vi.mocked(briefingApi.signals).mockResolvedValue({ start: '2026-09-01', end: '2026-09-06', multiplier: 2, unusual: [], new_merchants: [] });
  vi.mocked(briefingApi.healthScore).mockResolvedValue({ score: null, grade: null, has_income_data: false, period: '2026-09', start: '2026-09-01', end: '2026-09-06', status: 'complete', unresolved_count: 0, income: null, spending: { minor_units: 1250, currency: 'SGD' }, components: {} });
  vi.mocked(briefingApi.monthly).mockResolvedValue([]);
});
afterEach(cleanup);

test('shows the ranked category change, selectable to its evidence links in the inspection panel', async () => {
  show();
  await selectMode('By category');
  const bar = await screen.findByRole('button', { name: /Food & Drink/ });
  expect(screen.queryByRole('link', { name: 'This period' })).toBeNull();
  fireEvent.click(bar);
  const link = await screen.findByRole('link', { name: 'This period' });
  const params = new URL(link.getAttribute('href')!, 'http://localhost').searchParams;
  expect(params.get('category')).toBe('Food & Drink');
  expect(params.get('start')).toBe(period.start);
  fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
  expect(screen.queryByRole('link', { name: 'This period' })).toBeNull();
});

test('the top category merchant driver links to the merchant profile as a drill-down, with exact evidence as a secondary link', async () => {
  vi.mocked(briefingApi.month).mockResolvedValue({
    ...monthFacts,
    top_category_driver: {
      category: 'Food & Drink', change: { minor_units: 500, currency: 'SGD' },
      merchant_driver: { merchant: 'Fancy Bistro', change: { minor_units: 400, currency: 'SGD' } },
      frequency_driver: null, one_off_driver: null, overlap_note: 'note',
    },
  });
  show();
  await selectMode('By category');
  const profileLink = await screen.findByRole('link', { name: 'Fancy Bistro' });
  expect(profileLink.getAttribute('href')).toBe('/explore/merchants/Fancy%20Bistro');
  const evidenceLinkEl = screen.getByRole('link', { name: 'View transactions' });
  const params = new URL(evidenceLinkEl.getAttribute('href')!, 'http://localhost').searchParams;
  expect(params.get('merchant')).toBe('Fancy Bistro');
  expect(params.get('category')).toBe('Food & Drink');
});

test('shows recurring cost changes with a link to the subscription', async () => {
  vi.mocked(api.getSubscriptionReviewV2).mockResolvedValue({
    overdue: [], annual_renewals: [],
    price_changes: [{ subscription_id: 9, label: 'Netflix', old_amount: { minor_units: 1500, currency: 'SGD' }, new_amount: { minor_units: 2000, currency: 'SGD' }, change: { minor_units: 500, currency: 'SGD' }, annualized_impact: { minor_units: 6000, currency: 'SGD' }, old_date: '2026-08-05', new_date: '2026-09-05' }],
  });
  show();
  await selectMode('Recurring');
  const link = await screen.findByRole('link', { name: /Netflix/ });
  expect(link.getAttribute('href')).toBe('/plan?subscription=9');
});

test('defaults the category trend chart to the top movers and fetches via the shared-facts endpoint (default mode)', async () => {
  vi.mocked(api.getCategories).mockResolvedValue([
    { name: 'Food & Drink', keywords: null, icon: null, color: null, type: 'wants' },
    { name: 'Transport', keywords: null, icon: null, color: null, type: 'needs' },
  ]);
  show();
  const chip = await screen.findByRole('button', { name: 'Food & Drink' });
  expect(chip.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Transport' }).getAttribute('aria-pressed')).toBe('false');
  await waitFor(() => expect(api.getCategoryDailyTrendV2).toHaveBeenCalledWith(period.start, period.end, ['Food & Drink']));
});

test('toggling a category chip adds it to the trend chart request', async () => {
  vi.mocked(api.getCategories).mockResolvedValue([
    { name: 'Food & Drink', keywords: null, icon: null, color: null, type: 'wants' },
    { name: 'Transport', keywords: null, icon: null, color: null, type: 'needs' },
  ]);
  show();
  await screen.findByRole('button', { name: 'Food & Drink' });
  fireEvent.click(screen.getByRole('button', { name: 'Transport' }));
  await waitFor(() => expect(api.getCategoryDailyTrendV2).toHaveBeenCalledWith(period.start, period.end, ['Food & Drink', 'Transport']));
});

test('shows a weekday pattern bar with weekday-scoped evidence (default mode)', async () => {
  vi.mocked(briefingApi.weekdayPattern).mockResolvedValue({
    ...emptyPattern,
    pattern: emptyPattern.pattern.map(p => p.weekday === 1 ? { ...p, average: { minor_units: 2000, currency: 'SGD' as const }, transaction_count: 3 } : p),
  });
  show();
  const link = await screen.findByRole('link', { name: /Tuesday/ });
  const params = new URL(link.getAttribute('href')!, 'http://localhost').searchParams;
  expect(params.get('weekday')).toBe('1');
});

test('ranks merchants across all categories by default, then within a chosen category, via the shared-facts endpoint', async () => {
  vi.mocked(api.getCategories).mockResolvedValue([{ name: 'Food & Drink', keywords: null, icon: null, color: null, type: 'wants' }]);
  vi.mocked(api.getMerchantRankingFactsV2).mockResolvedValue([{ merchant: 'Fancy Bistro', visits: 2, total: { minor_units: 4000, currency: 'SGD' } }]);
  show();
  await selectMode('By merchant');
  expect((await screen.findAllByText('Fancy Bistro')).length).toBeGreaterThan(0);
  expect(api.getMerchantRankingFactsV2).toHaveBeenCalledWith(period.start, period.end, undefined, 10);
  const profileLink = screen.getByRole('link', { name: 'Profile' });
  expect(profileLink.getAttribute('href')).toBe('/explore/merchants/Fancy%20Bistro');
  fireEvent.change(await screen.findByRole('combobox', { name: 'Category' }), { target: { value: 'Food & Drink' } });
  await waitFor(() => expect(api.getMerchantRankingFactsV2).toHaveBeenCalledWith(period.start, period.end, 'Food & Drink', 10));
});

test('most visited ranks merchants by visit count', async () => {
  vi.mocked(api.getMerchantRankingFactsV2).mockResolvedValue([
    { merchant: 'Big Once', visits: 1, total: { minor_units: 9000, currency: 'SGD' } },
    { merchant: 'Daily Kopi', visits: 9, total: { minor_units: 1800, currency: 'SGD' } },
  ]);
  show();
  await selectMode('By merchant');
  expect(await screen.findByText('9 visits · $18.00')).toBeTruthy();
  const card = screen.getByText('Most visited').closest('.rounded-md')! as HTMLElement;
  const names = within(card).getAllByRole('link').map(link => link.textContent);
  expect(names.slice(0, 2)).toEqual(['Daily Kopi', 'Big Once']);
});

test('shows how a selected trip affected the month, with a link to its transactions', async () => {
  vi.mocked(api.getTrips).mockResolvedValue([{ id: 5, name: 'Bali', destination: null, start_date: '2026-09-01', end_date: '2026-09-05', primary_currency: 'SGD', status: 'inactive', created_at: '', updated_at: '' }]);
  vi.mocked(api.getTripSummaryV2).mockResolvedValue({
    trip: { id: 5, name: 'Bali', destination: null, start_date: '2026-09-01', end_date: '2026-09-05', primary_currency: 'SGD', status: 'inactive', created_at: '', updated_at: '' },
    total: { minor_units: 40000, currency: 'SGD' }, daily_average: { minor_units: 8000, currency: 'SGD' },
    days: 5, transaction_count: 4, currencies_used: ['SGD'], by_category: [], by_day: [],
  });
  show();
  expect(await screen.findByText(/Bali · 5 days/)).toBeTruthy();
  expect(screen.getByText('$400.00')).toBeTruthy();
  const link = screen.getByRole('link', { name: 'See trip transactions' });
  expect(link.getAttribute('href')).toBe('/transactions?trip=5');
});

const baliTrip: Trip = { id: 5, name: 'Bali', destination: null, start_date: '2026-08-30', end_date: '2026-09-05', primary_currency: 'SGD', status: 'inactive', created_at: '', updated_at: '' };
function tripSummary(trip: Trip = baliTrip) {
  return {
    trip, total: { minor_units: 40000, currency: 'SGD' as const }, daily_average: { minor_units: 5714, currency: 'SGD' as const },
    days: 7, transaction_count: 2, currencies_used: ['SGD'], by_category: [],
    by_day: [
      { date: '2026-08-30', amount: { minor_units: 10000, currency: 'SGD' as const } },
      { date: '2026-09-02', amount: { minor_units: 30000, currency: 'SGD' as const } },
    ],
  };
}
const septemberToTripEnd: SpendingPeriod = { ...period, start: '2026-09-01', end: '2026-09-05', spending: { minor_units: 100000, currency: 'SGD' } };

test('a cross-month trip is compared with the month only for spending dated inside that month', async () => {
  vi.mocked(api.getTrips).mockResolvedValue([baliTrip]);
  vi.mocked(api.getTripSummaryV2).mockResolvedValue(tripSummary());
  vi.mocked(briefingApi.month).mockResolvedValue({ ...monthFacts, current: septemberToTripEnd });
  show();
  expect(await screen.findByText(/Bali · 7 days/)).toBeTruthy();
  const share = await screen.findByText(/of it is dated/);
  expect(share.textContent).toContain('$300.00');
  expect(share.textContent).toContain('about 30%');
  expect(share.textContent).toContain('outside those dates is not part of this share');
  expect(briefingApi.month).toHaveBeenCalledWith('2026-09-05');
});

test('an ongoing trip is compared with month-to-date today, not as of its start date', async () => {
  const ongoing: Trip = { ...baliTrip, start_date: '2026-09-01', end_date: null, status: 'active' };
  vi.mocked(api.getTrips).mockResolvedValue([ongoing]);
  vi.mocked(api.getTripSummaryV2).mockResolvedValue(tripSummary(ongoing));
  vi.mocked(briefingApi.month).mockResolvedValue({ ...monthFacts, current: septemberToTripEnd });
  show();
  await screen.findByText(/of it is dated/);
  expect(briefingApi.month).toHaveBeenCalledWith(undefined);
});

test('no share is claimed while the month has records needing review', async () => {
  vi.mocked(api.getTrips).mockResolvedValue([baliTrip]);
  vi.mocked(api.getTripSummaryV2).mockResolvedValue(tripSummary());
  vi.mocked(briefingApi.month).mockResolvedValue({ ...monthFacts, current: { ...septemberToTripEnd, status: 'partial', unresolved_count: 2 } });
  show();
  expect(await screen.findByText(/spending is unavailable while some records/)).toBeTruthy();
  expect(screen.queryByText(/about \d+%/)).toBeNull();
});

test('hides the trip card entirely when there are no trips', async () => {
  show();
  await screen.findByText('Spending over time');
  await waitFor(() => expect(api.getTrips).toHaveBeenCalled());
  expect(screen.queryByText('How did this trip affect the month?')).toBeNull();
});

test('a failed card announces itself as an alert for screen readers', async () => {
  vi.mocked(api.getSubscriptionReviewV2).mockRejectedValue(new Error('offline'));
  show();
  await selectMode('Recurring');
  expect(await screen.findByRole('alert')).toBeTruthy();
});

test('a background refetch failure does not hide already-loaded data behind an error screen', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(briefingApi.weekdayPattern).mockResolvedValueOnce({
    ...emptyPattern,
    pattern: emptyPattern.pattern.map(p => p.weekday === 1 ? { ...p, average: { minor_units: 2000, currency: 'SGD' as const } } : p),
  });
  render(<QueryClientProvider client={client}><MemoryRouter><ExplorePatternsPage /></MemoryRouter></QueryClientProvider>);
  const link = await screen.findByRole('link', { name: /Tuesday/ });
  expect(link).toBeTruthy();
  vi.mocked(briefingApi.weekdayPattern).mockRejectedValueOnce(new Error('offline'));
  await client.refetchQueries({ queryKey: ['explore-weekday-pattern'] });
  expect(screen.getByRole('link', { name: /Tuesday/ })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('the trip card appears once trips load, never as a premature empty state', async () => {
  let resolveTrips!: (trips: Trip[]) => void;
  vi.mocked(api.getTrips).mockReturnValue(new Promise(resolve => { resolveTrips = resolve; }));
  vi.mocked(api.getTripSummaryV2).mockResolvedValue(tripSummary());
  show();
  await screen.findByText('Spending over time');
  expect(screen.queryByText('How did this trip affect the month?')).toBeNull();
  resolveTrips([baliTrip]);
  expect(await screen.findByText('How did this trip affect the month?')).toBeTruthy();
});

test('the dashboard opens with the month pulse, worth-a-look signals and financial health', async () => {
  vi.mocked(briefingApi.signals).mockResolvedValue({
    start: '2026-09-01', end: '2026-09-06', multiplier: 2,
    unusual: [{ transaction_id: 7, merchant: 'Grocer', category: 'Food & Drink', date: '2026-09-03', amount: { minor_units: 5000, currency: 'SGD' }, typical: { minor_units: 1100, currency: 'SGD' }, ratio: 4.5 }],
    new_merchants: [{ merchant: 'Bookshop', first_date: '2026-09-04', category: 'Shopping', amount: { minor_units: 2500, currency: 'SGD' }, transaction_id: 8 }],
  });
  vi.mocked(briefingApi.healthScore).mockResolvedValue({
    score: 64, grade: 'Good', has_income_data: true, period: '2026-09', start: '2026-09-01', end: '2026-09-06',
    status: 'partial', unresolved_count: 2, income: { minor_units: 300000, currency: 'SGD' }, spending: { minor_units: 1250, currency: 'SGD' },
    components: { savings_rate: { score: 40, max: 40, value: 0.99, benchmark: 0.2, label: 'Savings Rate', description: 'Share of income left after all spending' } },
  });
  show();
  expect(await screen.findByText('Spent this month')).toBeTruthy();
  expect(screen.getAllByText('$12.50').length).toBeGreaterThan(0);
  expect(await screen.findByText('+$5.00')).toBeTruthy();
  // Worth a look is a summary card: rows are not separate links; the card opens the full list.
  const signals = await screen.findByRole('link', { name: /Worth a look: 2 items/ });
  expect(signals.getAttribute('href')).toBe('/explore/signals');
  expect(within(signals).getByText('Grocer')).toBeTruthy();
  expect(within(signals).getByText('4.5× usual')).toBeTruthy();
  expect(within(signals).queryAllByRole('link')).toHaveLength(0);
  // Health shows only the score; the card opens the full breakdown.
  const health = await screen.findByRole('link', { name: /Financial health 64 out of 100, Good/ });
  expect(health.getAttribute('href')).toBe('/explore/health');
  expect(screen.queryByText('Savings Rate')).toBeNull();
  expect(briefingApi.healthScore).toHaveBeenCalledWith(1);
  // Headline tiles open their evidence.
  const spent = screen.getByText('Spent this month').closest('a')!;
  expect(spent.getAttribute('href')).toMatch(/^\/evidence\?start=2026-09-01&end=2026-09-06&measure=spending/);
  const mover = screen.getByText('Biggest mover').closest('a')!;
  expect(new URL(mover.getAttribute('href')!, 'http://x').searchParams.get('category')).toBe('Food & Drink');
});

test('the AI read appears only when the model layer has written one', async () => {
  vi.mocked(api.getAnalyticsInsight).mockResolvedValue({ content: { narrative: 'Food is running ahead of August.', nudges: ['Cook twice this week'] }, generated_at: new Date().toISOString(), is_stale: false });
  show();
  expect(await screen.findByText('Food is running ahead of August.')).toBeTruthy();
  expect(screen.getByText("Today's read")).toBeTruthy();
});

test('worth a look caps the dashboard summary at three rows', async () => {
  const merchant = (i: number) => ({ merchant: `Place ${i}`, first_date: '2026-09-04', category: 'Shopping', amount: { minor_units: 1000, currency: 'SGD' as const }, transaction_id: 100 + i });
  vi.mocked(briefingApi.signals).mockResolvedValue({ start: '2026-09-01', end: '2026-09-06', multiplier: 2, unusual: [], new_merchants: [1, 2, 3, 4, 5].map(merchant) });
  show();
  const card = await screen.findByRole('link', { name: /Worth a look: 5 items/ });
  expect(within(card).getByText('Place 3')).toBeTruthy();
  expect(within(card).queryByText('Place 4')).toBeNull();
  expect(within(card).getByText('2 more this month')).toBeTruthy();
});

test('nothing stands out: worth a look explains what it watches for', async () => {
  show();
  expect(await screen.findByText(/Nothing stands out so far this month/)).toBeTruthy();
  expect(screen.queryByText("Today's read")).toBeNull();
});

test('Over time investigates a day by category and merchant, with evidence scoped to that day', async () => {
  vi.mocked(api.getCategories).mockResolvedValue([{ name: 'Food & Drink', keywords: null, icon: null, color: null, type: 'wants' }] as Awaited<ReturnType<typeof api.getCategories>>);
  vi.mocked(api.getCategoryDailyTrendV2).mockResolvedValue([{ date: '2026-09-03', categories: { 'Food & Drink': { minor_units: 1200, currency: 'SGD' } } }]);
  vi.mocked(api.getCategoryBreakdownV2).mockResolvedValue({ start: '2026-09-03', end: '2026-09-03', by_category: { 'Food & Drink': { minor_units: 1200, currency: 'SGD' }, Transport: { minor_units: 300, currency: 'SGD' } }, unresolved_count: 0, indicative_count: 0, status: 'complete' });
  vi.mocked(api.getMerchantRankingFactsV2).mockResolvedValue([{ merchant: 'Hawker Stall', visits: 1, total: { minor_units: 1200, currency: 'SGD' } }]);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/explore?day=2026-09-03']}><ExplorePatternsPage /></MemoryRouter></QueryClientProvider>);
  const day = await screen.findByRole('region', { name: /All spending on/ });
  await waitFor(() => expect(api.getCategoryBreakdownV2).toHaveBeenCalledWith('2026-09-03', '2026-09-03'));
  fireEvent.click(within(day).getByRole('button', { name: /Food & Drink/ }));
  const merchant = await within(day).findByRole('link', { name: 'Hawker Stall' });
  expect(api.getMerchantRankingFactsV2).toHaveBeenCalledWith('2026-09-03', '2026-09-03', 'Food & Drink', 5);
  const params = new URL(merchant.getAttribute('href')!, 'http://localhost').searchParams;
  expect(params.get('start')).toBe('2026-09-03');
  expect(params.get('end')).toBe('2026-09-03');
  expect(params.get('category')).toBe('Food & Drink');
  expect(params.get('merchant')).toBe('Hawker Stall');
  fireEvent.click(screen.getByRole('button', { name: 'Clear day' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: /All spending on/ })).toBeNull());
});

test('a day outside the period is not presented as selected', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/explore?day=2025-01-01']}><ExplorePatternsPage /></MemoryRouter></QueryClientProvider>);
  await screen.findByText('Spending over time');
  expect(screen.queryByRole('region', { name: /All spending on/ })).toBeNull();
  expect(api.getCategoryBreakdownV2).not.toHaveBeenCalled();
});
