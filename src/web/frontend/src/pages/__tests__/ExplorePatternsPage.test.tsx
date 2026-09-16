import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/api/client';
import { briefingApi, type SpendingFacts, type SpendingPeriod } from '@/api/briefing';
import { ExplorePatternsPage } from '../ExplorePatternsPage';

vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  api: {
    getSubscriptionReviewV2: vi.fn(),
    getCategories: vi.fn(),
    getMerchantRankingFactsV2: vi.fn(),
    getTrips: vi.fn(),
    getTripSummaryV2: vi.fn(),
  },
}));
vi.mock('@/api/briefing', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/briefing')>(),
  briefingApi: { month: vi.fn(), weekdayPattern: vi.fn() },
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
  vi.mocked(api.getTrips).mockResolvedValue([]);
});
afterEach(cleanup);

test('shows the ranked category change, selectable to its evidence links', async () => {
  show();
  await selectMode('By category');
  const bar = await screen.findByRole('button', { name: /Food & Drink/ });
  fireEvent.click(bar);
  const link = await screen.findByRole('link', { name: 'This period' });
  const params = new URL(link.getAttribute('href')!, 'http://localhost').searchParams;
  expect(params.get('category')).toBe('Food & Drink');
  expect(params.get('start')).toBe(period.start);
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
  const evidenceLinkEl = screen.getByRole('link', { name: 'view transactions' });
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
  expect(link.getAttribute('href')).toBe('/plan/manage?subscription=9');
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

test('shows merchants ranked within the selected category, via the shared-facts endpoint', async () => {
  vi.mocked(api.getCategories).mockResolvedValue([{ name: 'Food & Drink', keywords: null, icon: null, color: null, type: 'wants' }]);
  vi.mocked(api.getMerchantRankingFactsV2).mockResolvedValue([{ merchant: 'Fancy Bistro', visits: 2, total: { minor_units: 4000, currency: 'SGD' } }]);
  show();
  await selectMode('By merchant');
  expect(await screen.findByText('Fancy Bistro')).toBeTruthy();
  expect(api.getMerchantRankingFactsV2).toHaveBeenCalledWith(period.start, period.end, 'Food & Drink', 10);
  const profileLink = screen.getByRole('link', { name: 'Profile' });
  expect(profileLink.getAttribute('href')).toBe('/explore/merchants/Fancy%20Bistro');
});

test('shows how a selected trip affected the month, with a link to its transactions', async () => {
  vi.mocked(api.getTrips).mockResolvedValue([{ id: 5, name: 'Bali', destination: null, start_date: '2026-09-01', end_date: '2026-09-05', primary_currency: 'SGD', status: 'inactive', created_at: '', updated_at: '' }]);
  vi.mocked(api.getTripSummaryV2).mockResolvedValue({
    trip: { id: 5, name: 'Bali', destination: null, start_date: '2026-09-01', end_date: '2026-09-05', primary_currency: 'SGD', status: 'inactive', created_at: '', updated_at: '' },
    total: { minor_units: 40000, currency: 'SGD' }, daily_average: { minor_units: 8000, currency: 'SGD' },
    days: 5, transaction_count: 4, currencies_used: ['SGD'], by_category: [], by_day: [],
  });
  show();
  expect(await screen.findByText(/\$400\.00 over 5 days/)).toBeTruthy();
  const link = screen.getByRole('link', { name: 'See trip transactions' });
  expect(link.getAttribute('href')).toBe('/transactions?trip=5');
});

test('shows an empty state when there are no trips', async () => {
  show();
  expect(await screen.findByText('No trips recorded yet.')).toBeTruthy();
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

test('the trip card shows loading, not a premature empty state, while trips are still fetching', async () => {
  let resolveTrips!: (trips: []) => void;
  vi.mocked(api.getTrips).mockReturnValue(new Promise(resolve => { resolveTrips = resolve; }));
  show();
  expect(await screen.findByText('How did this trip affect the month?')).toBeTruthy();
  expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  expect(screen.queryByText('No trips recorded yet.')).toBeNull();
  resolveTrips([]);
  expect(await screen.findByText('No trips recorded yet.')).toBeTruthy();
});
