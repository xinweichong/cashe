import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { briefingApi, type HomeBriefing, type SpendingPeriod } from '@/api/briefing';
import { HomePage } from '../HomePage';
import { ReviewPage } from '../ReviewPage';

vi.mock('@/api/briefing', async (original) => ({ ...await original<typeof import('@/api/briefing')>(), briefingApi: { home: vi.fn(), captureIssues: vi.fn(), followups: vi.fn(), retryCapture: vi.fn(), retryFollowup: vi.fn() } }));
const period: SpendingPeriod = { start: '2026-09-01', end: '2026-09-06', spending: { minor_units: 1250, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 1, unresolved_count: 0, indicative_count: 0, status: 'complete' };
const home: HomeBriefing = { facts: { as_of: '2026-09-06', timezone: 'Asia/Singapore', undated_count: 0, current: period, comparison_current: period, previous: { ...period, start: '2026-08-01', end: '2026-08-06' }, change: { minor_units: 500, currency: 'SGD' }, category_changes: [{ category: 'Food & Drink', change: { minor_units: 500, currency: 'SGD' } }] }, recent: [], upcoming: [], upcoming_total: { minor_units: 0, currency: 'SGD' }, upcoming_unknown_count: 0, capture_issue_count: 2, followup_issue_count: 1, freshness: { gmail_connected: false, gmail_last_checked: null, gmail_needs_reconnection: false } };
function show(component: React.ReactNode) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{component}</MemoryRouter></QueryClientProvider>); }
beforeEach(() => vi.resetAllMocks());
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

test('capture review queues a deliberate retry and refreshes', async () => {
  vi.mocked(briefingApi.captureIssues).mockResolvedValue([{ id: 1, source: 'wallet_request', status: 'unrecognized', attempts: 1, error_code: 'WalletPayloadError' }]);
  vi.mocked(briefingApi.followups).mockResolvedValue([]);
  vi.mocked(briefingApi.retryCapture).mockResolvedValue({ status: 'queued' });
  show(<ReviewPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(briefingApi.retryCapture).toHaveBeenCalledWith(1));
  expect(await screen.findByText(/Retry queued/)).toBeTruthy();
});
