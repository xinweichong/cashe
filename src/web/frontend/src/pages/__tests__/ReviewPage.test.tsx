import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { briefingApi } from '@/api/briefing';
import { ReviewPage } from '../ReviewPage';

vi.mock('@/api/briefing', () => ({ briefingApi: { spendingReview: vi.fn(), captureIssues: vi.fn(), followups: vi.fn() } }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(briefingApi.captureIssues).mockResolvedValue([]);
  vi.mocked(briefingApi.followups).mockResolvedValue([]);
});
afterEach(cleanup);
function show(path = '/review') {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><ReviewPage /></MemoryRouter></QueryClientProvider>);
}

test('explains independent reasons and preserves the review page in transaction links', async () => {
  vi.mocked(briefingApi.spendingReview).mockResolvedValue({ items: [{ id: 9, merchant: 'Cafe', category: 'Food', date: null, reasons: ['missing_date', 'unresolved_money', 'unknown_type'] }], total: 51, limit: 50, offset: 50 });
  show('/review?spending_offset=50');
  const link = await screen.findByRole('link', { name: 'Open transaction' });
  expect(new URL(link.getAttribute('href')!, 'http://local').searchParams.get('returnTo')).toBe('/review?spending_offset=50');
  expect(screen.getByText(/The date is missing/)).toBeTruthy();
  expect(screen.getByText(/amount or currency conversion cannot be resolved/)).toBeTruthy();
  expect(screen.getByText(/type is not recognized/)).toBeTruthy();
  expect(briefingApi.spendingReview).toHaveBeenCalledWith(50);
  fireEvent.click(screen.getByRole('button', { name: 'Previous spending records' }));
  await waitFor(() => expect(briefingApi.spendingReview).toHaveBeenCalledWith(0));
});

test('spending failures leave capture review usable and can be retried', async () => {
  vi.mocked(briefingApi.spendingReview).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  show();
  expect(screen.getByText('Loading spending review…')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('No unresolved spending records.')).toBeTruthy();
  expect(screen.getByText('No capture issues on this page.')).toBeTruthy();
});

test('empty later pages retain a way back after corrections', async () => {
  vi.mocked(briefingApi.spendingReview).mockResolvedValue({ items: [], total: 1, limit: 50, offset: 50 });
  show('/review?spending_offset=50');
  expect(await screen.findByText(/Return to an earlier page/)).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Previous spending records' }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole('button', { name: 'Next spending records' }) as HTMLButtonElement).disabled).toBe(true);
});

test('Telegram input failures explain manual recovery without offering automatic replay', async () => {
  vi.mocked(briefingApi.spendingReview).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  vi.mocked(briefingApi.captureIssues).mockResolvedValue([{ id: 20, source: 'telegram_nl', status: 'failed', attempts: 1, error_code: 'nl_processing_failed' }]);
  show();
  expect(await screen.findByText('Telegram entry · failed')).toBeTruthy();
  expect(screen.getByText(/Use \/add or send a new entry in Telegram/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});
