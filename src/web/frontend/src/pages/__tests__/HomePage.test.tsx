import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { briefingApi, type HomeBriefing, type SpendingPeriod } from '@/api/briefing';
import { api } from '@/api/client';
import { HomePage } from '../HomePage';
import { ReviewPage } from '../ReviewPage';

vi.mock('@/api/briefing', async (original) => ({ ...await original<typeof import('@/api/briefing')>(), briefingApi: { recurringReview: vi.fn(), resolveRecurring: vi.fn(), home: vi.fn(), spendingReview: vi.fn(), captureIssues: vi.fn(), followups: vi.fn(), retryCapture: vi.fn(), retryFollowup: vi.fn(), refundMatchReview: vi.fn(), resolveRefundMatch: vi.fn(), duplicateReview: vi.fn(), dismissDuplicate: vi.fn(), mergeDuplicates: vi.fn(), undoDuplicateMerge: vi.fn() } }));
vi.mock('@/api/client', async (original) => ({ ...await original<typeof import('@/api/client')>(), api: { getCategoryBreakdownV2: vi.fn(), getDailyTotalsV2: vi.fn(), getMerchantRankingFactsV2: vi.fn() } }));
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
  vi.mocked(api.getMerchantRankingFactsV2).mockResolvedValue([]);
});
afterEach(cleanup);

test('Home counts what needs a look in plain words and links to the other tabs', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue(home);
  show(<HomePage />);
  expect(await screen.findByText(/^As of 6 Sep/)).toBeTruthy();
  expect(screen.getByText('3 captures to check')).toBeTruthy();
  expect(screen.getByText('Connect Gmail')).toBeTruthy();
  expect(screen.queryByText(/records?$/)).toBeNull();
  expect(screen.getByRole('link', { name: /Coming up/ }).getAttribute('href')).toBe('/plan');
  expect(screen.getByRole('link', { name: /Recent activity/ }).getAttribute('href')).toBe('/activity');
  expect(screen.getByRole('link', { name: /Where it went/ }).getAttribute('href')).toBe('/explore');
});

test('Home surfaces all-history review and recurring suggestion counts', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, review_count: 4, recurring_suggestion_count: 1 });
  show(<HomePage />);
  expect(await screen.findByText('4 records to review')).toBeTruthy();
  expect(screen.getByText('1 possible subscription')).toBeTruthy();
});

test('with nothing to check, Home says it is caught up instead of listing zeros', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, capture_issue_count: 0, followup_issue_count: 0, freshness: { ...home.freshness, gmail_connected: true } });
  show(<HomePage />);
  expect(await screen.findByText('All caught up')).toBeTruthy();
  expect(screen.queryByText(/0 captures/)).toBeNull();
});

test('a failed briefing does not render a genuine zero', async () => {
  vi.mocked(briefingApi.home).mockRejectedValue(new Error('offline'));
  show(<HomePage />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Spending recorded this month')).toBeNull();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
});

test('partial and undated amounts remain visible as uncertainty', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, facts: { ...home.facts, current: { ...period, status: 'partial', unresolved_count: 1 }, undated_count: 1, change: null, category_changes: [] } });
  show(<HomePage />);
  expect(await screen.findByText(/Known spending so far/)).toBeTruthy();
  expect(screen.getByText('2 records to review')).toBeTruthy();
  expect(screen.getByText(/Can’t compare with last month/)).toBeTruthy();
});

test('early in the month Home holds back the month-on-month comparison', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue(home);
  show(<HomePage />);
  expect(await screen.findByText('Too early in the month to compare with last month.')).toBeTruthy();
  expect(screen.queryByText(/more than by this date/)).toBeNull();
});

test('with a week or more to compare, Home states the change against last month', async () => {
  const week = { ...period, start: '2026-09-01', end: '2026-09-10' };
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, facts: { ...home.facts, as_of: '2026-09-10', current: week, comparison_current: week } });
  show(<HomePage />);
  expect(await screen.findByText('$5.00 more than by this date in August.')).toBeTruthy();
});

test('Home surfaces a recently increased commitment', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, increased_commitments: [{ subscription_id: 1, label: 'Netflix', old_amount: { minor_units: 1500, currency: 'SGD' }, new_amount: { minor_units: 2000, currency: 'SGD' }, change: { minor_units: 500, currency: 'SGD' }, annualized_impact: { minor_units: 6000, currency: 'SGD' }, old_date: '2026-08-05', new_date: '2026-09-05' }] });
  show(<HomePage />);
  expect(await screen.findByText('Netflix went up')).toBeTruthy();
  expect(screen.getByText(/\$60\.00 a year/)).toBeTruthy();
});

test('Home frames a negative net flow as spending more than earned', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, facts: { ...home.facts, current: { ...period, income: { minor_units: 100, currency: 'SGD' }, recorded_net_flow: { minor_units: -300, currency: 'SGD' } } } });
  show(<HomePage />);
  expect(await screen.findByText('Spent more than earned')).toBeTruthy();
  expect(screen.getByText('$3.00')).toBeTruthy();
});

test('Home shows the last capture time in words', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, freshness: { ...home.freshness, last_capture_processed_at: '2026-09-06T08:00:00' } });
  show(<HomePage />);
  expect(await screen.findByText(/Last capture 6 Sep/)).toBeTruthy();
  expect(screen.queryByText(/2026-09-06T08:00:00/)).toBeNull();
});

test('Home shows remaining spending against an overall budget', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, spending_target: { target: { minor_units: 100000, currency: 'SGD' }, remaining: { minor_units: 30000, currency: 'SGD' } } });
  show(<HomePage />);
  expect(await screen.findByText('Budget left')).toBeTruthy();
  expect(screen.getByText('Of $1,000.00 this month')).toBeTruthy();
});

test('Home frames an over-budget spend as a warning, not a safe-to-spend figure', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, spending_target: { target: { minor_units: 100000, currency: 'SGD' }, remaining: { minor_units: -5000, currency: 'SGD' } } });
  show(<HomePage />);
  expect(await screen.findByText('Over budget')).toBeTruthy();
  expect(screen.getByText('$50.00 over budget')).toBeTruthy();
});

test('without an overall budget, Home offers to set one in Plan', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, spending_target: null });
  show(<HomePage />);
  expect(await screen.findByText('Not set')).toBeTruthy();
  expect(screen.queryByText('Budget left')).toBeNull();
});

test('initial load shows the heading and a labelled skeleton, not a bare message', async () => {
  vi.mocked(briefingApi.home).mockReturnValue(new Promise(() => {}));
  show(<HomePage />);
  expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeTruthy();
  expect(screen.getByRole('status', { name: 'Preparing your briefing' })).toBeTruthy();
  expect(screen.queryByText('Spending recorded this month')).toBeNull();
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

test('Home leads with the month as its one spectrum card, with budget progress', async () => {
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, spending_target: { target: { minor_units: 100000, currency: 'SGD' }, remaining: { minor_units: 98750, currency: 'SGD' } } });
  const { container } = show(<HomePage />);
  await screen.findByText(/^As of 6 Sep/);
  expect(container.querySelectorAll('.spectrum-fill')).toHaveLength(1);
  expect(screen.getByText('Budget $1,000.00')).toBeTruthy();
  expect(screen.getByRole('progressbar', { name: 'Budget used' }).getAttribute('aria-valuenow')).toBe('1');
});

test('Coming up counts only the next 7 days and hands the timeline to Plan', async () => {
  const charge = (id: number, date: string) => ({ id, label: `Charge ${id}`, date, amount: { minor_units: 1000, currency: 'SGD' as const }, subscription_id: id });
  vi.mocked(briefingApi.home).mockResolvedValue({ ...home, upcoming: [charge(1, '2026-09-08'), charge(2, '2026-09-13'), charge(3, '2026-09-14')] });
  show(<HomePage />);
  expect(await screen.findByText('2 charges in the next 7 days')).toBeTruthy();
});
