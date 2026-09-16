import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { briefingApi, type HomeBriefing, type SpendingPeriod } from '@/api/briefing';
import { api } from '@/api/client';
import { HomePage } from '../HomePage';
import { ReviewPage } from '../ReviewPage';

vi.mock('@/api/briefing', async (original) => ({ ...await original<typeof import('@/api/briefing')>(), briefingApi: { recurringReview: vi.fn(), resolveRecurring: vi.fn(), home: vi.fn(), spendingReview: vi.fn(), captureIssues: vi.fn(), followups: vi.fn(), retryCapture: vi.fn(), retryFollowup: vi.fn(), refundMatchReview: vi.fn(), resolveRefundMatch: vi.fn(), duplicateReview: vi.fn(), dismissDuplicate: vi.fn(), mergeDuplicates: vi.fn(), undoDuplicateMerge: vi.fn() } }));
vi.mock('@/api/client', async (original) => ({ ...await original<typeof import('@/api/client')>(), api: { getCategoryBreakdownV2: vi.fn(), getDailyTotalsV2: vi.fn() } }));
const period: SpendingPeriod = { start: '2026-09-01', end: '2026-09-06', spending: { minor_units: 1250, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 1, unresolved_count: 0, indicative_count: 0, status: 'complete' };
const home: HomeBriefing = { facts: { as_of: '2026-09-06', timezone: 'Asia/Singapore', undated_count: 0, current: period, comparison_current: period, previous: { ...period, start: '2026-08-01', end: '2026-08-06' }, change: { minor_units: 500, currency: 'SGD' }, category_changes: [{ category: 'Food & Drink', change: { minor_units: 500, currency: 'SGD' } }], top_category_driver: null, trip_drivers: [] }, spending_target: null, recent: [], upcoming: [], upcoming_total: { minor_units: 0, currency: 'SGD' }, upcoming_unknown_count: 0, increased_commitments: [], capture_issue_count: 2, followup_issue_count: 1, review_count: 0, recurring_suggestion_count: 0, freshness: { gmail_connected: false, gmail_last_checked: null, gmail_needs_reconnection: false, last_capture_processed_at: null } };
function show(component: React.ReactNode) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{component}</MemoryRouter></QueryClientProvider>); }
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(briefingApi.recurringReview).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  vi.mocked(briefingApi.spendingReview).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  vi.mocked(briefingApi.refundMatchReview).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  vi.mocked(briefingApi.duplicateReview).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  vi.mocked(api.getCategoryBreakdownV2).mockResolvedValue({ start: period.start, end: period.end, by_category: {}, unresolved_count: 0, indicative_count: 0, status: 'complete' });
  vi.mocked(api.getDailyTotalsV2).mockResolvedValue([]);
});
afterEach(cleanup);

test('Home keeps evidence periods and categories in links and omits missing income', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue(home);
  show(<HomePage />);
  expect(await screen.findByText('Your money briefing')).toBeTruthy();
  const href = screen.getByRole('link', { name: 'Previous period' }).getAttribute('href')!;
  const params = new URL(href, 'http://localhost').searchParams;
  expect(params.get('start')).toBe('2026-08-01');
  expect(params.get('end')).toBe('2026-08-06');
  expect(params.get('category')).toBe('Food & Drink');
  expect(screen.queryByText(/Recorded income/)).toBeNull();
  expect(screen.getByText('3 capture or follow-up items')).toBeTruthy();
  expect(screen.queryByText(/spending records need review/)).toBeNull();
  expect(screen.queryByText(/recurring suggestions/)).toBeNull();
});

test('Home surfaces all-history review and recurring suggestion counts', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, review_count: 4, recurring_suggestion_count: 2 });
  show(<HomePage />);
  expect(await screen.findByText('4 spending records need review')).toBeTruthy();
  expect(screen.getByText('2 recurring suggestions')).toBeTruthy();
});

test('a failed briefing does not render a genuine zero', async () => {
  vi.mocked(briefingApi.home).mockRejectedValue(new Error('offline'));
  show(<HomePage />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Recorded spending this month')).toBeNull();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
});

test('partial and undated amounts remain visible as uncertainty', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, facts: { ...home.facts, current: { ...period, status: 'partial', unresolved_count: 1 }, undated_count: 1, change: null, category_changes: [] } });
  show(<HomePage />);
  expect(await screen.findByText(/Known spending subtotal/)).toBeTruthy();
  expect(screen.getByText(/Review 2 spending records/)).toBeTruthy();
  expect(screen.getByText(/A comparison is unavailable/)).toBeTruthy();
});

test('Home shows category driver breakdown with an overlap note and its own evidence links', async () => {
  const topCategoryDriver = {
    category: 'Food & Drink', change: { minor_units: 500, currency: 'SGD' as const },
    merchant_driver: { merchant: 'Fancy Bistro', change: { minor_units: 400, currency: 'SGD' as const } },
    frequency_driver: { classification: 'size' as const, current_count: 3, previous_count: 3, current_avg: { minor_units: 1000, currency: 'SGD' as const }, previous_avg: { minor_units: 700, currency: 'SGD' as const } },
    one_off_driver: null,
    overlap_note: 'This breaks down the category change above.',
  };
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, facts: { ...home.facts, top_category_driver: topCategoryDriver } });
  show(<HomePage />);
  expect(await screen.findByText('This breaks down the category change above.')).toBeTruthy();
  const href = screen.getByRole('link', { name: 'Fancy Bistro' }).getAttribute('href')!;
  const params = new URL(href, 'http://localhost').searchParams;
  expect(params.get('merchant')).toBe('Fancy Bistro');
  expect(params.get('category')).toBe('Food & Drink');
  expect(screen.getByText(/Driven mostly by bigger purchases/)).toBeTruthy();
});

test('Home flags a one-off purchase driver with a direct transaction link', async () => {
  const topCategoryDriver = {
    category: 'Food & Drink', change: { minor_units: 500, currency: 'SGD' as const },
    merchant_driver: null, frequency_driver: { classification: 'none' as const, current_count: 1, previous_count: 1, current_avg: { minor_units: 500, currency: 'SGD' as const }, previous_avg: { minor_units: 0, currency: 'SGD' as const } },
    one_off_driver: { transaction_id: 42, merchant: 'Rare Splurge', amount: { minor_units: 500, currency: 'SGD' as const }, date: '2026-09-05' },
    overlap_note: 'note',
  };
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, facts: { ...home.facts, top_category_driver: topCategoryDriver } });
  show(<HomePage />);
  const link = await screen.findByRole('link', { name: 'Rare Splurge' });
  expect(link.getAttribute('href')).toBe('/transactions/42');
});

test('Home shows trip-attributed spending as context, not additive to category totals', async () => {
  const tripDriver = { trip_id: 7, name: 'Bali', current_total: { minor_units: 8000, currency: 'SGD' as const }, previous_total: { minor_units: 0, currency: 'SGD' as const }, change: { minor_units: 8000, currency: 'SGD' as const }, overlap_note: 'Trip spending is already included in the category totals above.' };
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, facts: { ...home.facts, trip_drivers: [tripDriver] } });
  show(<HomePage />);
  expect(await screen.findByRole('link', { name: 'Bali' })).toBeTruthy();
  expect(screen.getByText(/Trip spending is already included/)).toBeTruthy();
});

test('Home surfaces a recently increased commitment', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, increased_commitments: [{ subscription_id: 1, label: 'Netflix', old_amount: { minor_units: 1500, currency: 'SGD' }, new_amount: { minor_units: 2000, currency: 'SGD' }, change: { minor_units: 500, currency: 'SGD' }, annualized_impact: { minor_units: 6000, currency: 'SGD' }, old_date: '2026-08-05', new_date: '2026-09-05' }] });
  show(<HomePage />);
  expect(await screen.findByText('Recently increased')).toBeTruthy();
  expect(screen.getByText(/Netflix/)).toBeTruthy();
});

test('Home frames a negative net flow as an outflow warning', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, facts: { ...home.facts, current: { ...period, income: { minor_units: 100, currency: 'SGD' }, recorded_net_flow: { minor_units: -300, currency: 'SGD' } } } });
  show(<HomePage />);
  expect(await screen.findByText(/Recorded net outflow/)).toBeTruthy();
});

test('Home shows the last processed capture time', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, freshness: { ...home.freshness, last_capture_processed_at: '2026-09-06T08:00:00' } });
  show(<HomePage />);
  expect(await screen.findByText(/Last capture processed: 2026-09-06T08:00:00/)).toBeTruthy();
});

test('Home shows remaining spending against an overall target', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, spending_target: { target: { minor_units: 100000, currency: 'SGD' }, remaining: { minor_units: 30000, currency: 'SGD' } } });
  show(<HomePage />);
  expect(await screen.findByText(/\$300\.00 remaining of your \$1,000\.00 monthly target\./)).toBeTruthy();
});

test('Home frames an over-target spend as a warning, not a safe-to-spend figure', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, spending_target: { target: { minor_units: 100000, currency: 'SGD' }, remaining: { minor_units: -5000, currency: 'SGD' } } });
  show(<HomePage />);
  expect(await screen.findByText(/\$50\.00 over your \$1,000\.00 monthly target\./)).toBeTruthy();
});

test('Home omits the target line entirely when no overall budget is set', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, spending_target: null });
  show(<HomePage />);
  await screen.findByText('Your money briefing');
  expect(screen.queryByText(/monthly target/)).toBeNull();
});

test('Home shows the category mix once the breakdown loads, ranked by amount', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue(home);
  vi.mocked(api.getCategoryBreakdownV2).mockResolvedValue({
    start: period.start, end: period.end,
    by_category: { Food: { minor_units: 3000, currency: 'SGD' }, Transport: { minor_units: 1000, currency: 'SGD' } },
    unresolved_count: 0, indicative_count: 0, status: 'complete',
  });
  show(<HomePage />);
  expect(await screen.findByText('Food')).toBeTruthy();
  expect(screen.getByText('Transport')).toBeTruthy();
  expect(api.getCategoryBreakdownV2).toHaveBeenCalledWith(period.start, period.end);
});

test('a failed category breakdown shows a retry without losing the rest of the briefing', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue(home);
  vi.mocked(api.getCategoryBreakdownV2).mockRejectedValue(new Error('offline'));
  show(<HomePage />);
  expect(await screen.findByText(/Couldn't load the category mix/)).toBeTruthy();
  expect(screen.getByText('Your money briefing')).toBeTruthy();
});

test('selecting a category and viewing transactions navigates to its evidence', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue(home);
  vi.mocked(api.getCategoryBreakdownV2).mockResolvedValue({
    start: period.start, end: period.end,
    by_category: { Food: { minor_units: 3000, currency: 'SGD' } },
    unresolved_count: 0, indicative_count: 0, status: 'complete',
  });
  function Destination() { const location = useLocation(); return <output>{location.pathname}{location.search}</output>; }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/home']}>
        <Routes><Route path="/home" element={<HomePage />} /><Route path="/evidence" element={<Destination />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  fireEvent.click(await screen.findByRole('button', { name: /^Food/ }));
  fireEvent.click(screen.getByRole('button', { name: 'View transactions' }));
  const destination = await screen.findByText((_, el) => el?.tagName === 'OUTPUT');
  expect(destination.textContent).toContain('/evidence');
  const params = new URLSearchParams(destination.textContent!.replace('/evidence', ''));
  expect(params.get('category')).toBe('Food');
  expect(params.get('start')).toBe(period.start);
});

test('the daily trend reflects real data and links to a selected day\'s evidence', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue(home);
  vi.mocked(api.getDailyTotalsV2).mockResolvedValue([
    { date: '2026-09-04', spending: { minor_units: 200, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 1, unresolved_count: 0, indicative_count: 0, status: 'complete' },
    { date: '2026-09-05', spending: { minor_units: 500, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 1, unresolved_count: 0, indicative_count: 0, status: 'complete' },
  ]);
  show(<HomePage />);
  await screen.findByText('Your money briefing');
  expect(screen.queryByRole('link', { name: /View this day/ })).toBeNull();
  fireEvent.click(await screen.findByLabelText('Previous day'));
  const link = await screen.findByRole('link', { name: "View this day's records" });
  const params = new URL(link.getAttribute('href')!, 'http://localhost').searchParams;
  expect(params.get('start')).toBe('2026-09-04');
  expect(params.get('end')).toBe('2026-09-04');
});

test('capture review queues a deliberate retry and refreshes', async () => {
  vi.mocked(briefingApi.captureIssues).mockResolvedValue([{ id: 1, source: 'wallet_request', status: 'unrecognized', attempts: 1, error_code: 'WalletPayloadError' }]);
  vi.mocked(briefingApi.followups).mockResolvedValue([]);
  vi.mocked(briefingApi.retryCapture).mockResolvedValue({ status: 'queued' });
  show(<ReviewPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(briefingApi.retryCapture).toHaveBeenCalledWith(1));
  expect(await screen.findByText(/Retry queued/)).toBeTruthy();
});
