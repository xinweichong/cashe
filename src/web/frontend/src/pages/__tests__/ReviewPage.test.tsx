import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { briefingApi } from '@/api/briefing';
import { ReviewPage } from '../ReviewPage';

vi.mock('@/api/briefing', async (original) => ({ ...await original<typeof import('@/api/briefing')>(), briefingApi: { recurringReview: vi.fn(), resolveRecurring: vi.fn(), spendingReview: vi.fn(), captureIssues: vi.fn(), followups: vi.fn(), resolveCapture: vi.fn(), refundMatchReview: vi.fn(), resolveRefundMatch: vi.fn(), duplicateReview: vi.fn(), dismissDuplicate: vi.fn(), mergeDuplicates: vi.fn(), undoDuplicateMerge: vi.fn() } }));
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(briefingApi.recurringReview).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  vi.mocked(briefingApi.spendingReview).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  vi.mocked(briefingApi.captureIssues).mockResolvedValue([]);
  vi.mocked(briefingApi.followups).mockResolvedValue([]);
  vi.mocked(briefingApi.refundMatchReview).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  vi.mocked(briefingApi.duplicateReview).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
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


test('handled entries can be hidden, inspected, and returned to Review', async () => {
  vi.mocked(briefingApi.spendingReview).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  let handled = false;
  vi.mocked(briefingApi.captureIssues).mockImplementation(async (_offset, includeHandled) =>
    handled && !includeHandled ? [] : [{ id: 20, source: 'telegram_nl', status: 'failed', attempts: 1, error_code: null, handled }]);
  vi.mocked(briefingApi.resolveCapture).mockImplementation(async (_id, value) => { handled = value; });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Mark handled' }));
  await screen.findByText('No capture issues on this page.');
  expect(briefingApi.resolveCapture).toHaveBeenCalledWith(20, true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Show handled Telegram entries' }));
  expect(await screen.findByText('Telegram entry · failed · Handled')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Return to Review' }));
  expect(await screen.findByRole('button', { name: 'Mark handled' })).toBeTruthy();
  expect(briefingApi.resolveCapture).toHaveBeenCalledWith(20, false);
});

test('resolution failures retain the entry and show an error', async () => {
  vi.mocked(briefingApi.spendingReview).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  vi.mocked(briefingApi.captureIssues).mockResolvedValue([{ id: 20, source: 'telegram_nl', status: 'failed', attempts: 1, error_code: null }]);
  vi.mocked(briefingApi.resolveCapture).mockRejectedValue(new Error('offline'));
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Mark handled' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t update this entry.');
  expect(screen.getByRole('button', { name: 'Mark handled' })).toBeTruthy();
});


const duplicatePair = { items: [{
  transaction_a: { id: 3, merchant: 'Cafe', date: '2026-06-01T12:00:00', source: 'manual', amount: { minor_units: 1000, currency: 'SGD' as const }, conversion_status: 'native' as const },
  transaction_b: { id: 5, merchant: 'Cafe', date: '2026-06-01T12:00:30', source: 'gmail', amount: { minor_units: 1000, currency: 'SGD' as const }, conversion_status: 'native' as const },
  reason: 'same_merchant_amount_time_cross_source' as const,
}], total: 1, limit: 50, offset: 0 };

test('keeps one side of a duplicate pair and offers to undo the merge', async () => {
  vi.mocked(briefingApi.duplicateReview).mockResolvedValueOnce(duplicatePair).mockResolvedValue({ ...duplicatePair, items: [], total: 0 });
  vi.mocked(briefingApi.mergeDuplicates).mockResolvedValue({ status: 'ok', merge_id: 42 });
  vi.mocked(briefingApi.undoDuplicateMerge).mockResolvedValue({ status: 'ok' });
  show();
  expect(await screen.findByText('1 possible duplicates need review')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Keep this one' })[0]);
  await waitFor(() => expect(briefingApi.mergeDuplicates).toHaveBeenCalledWith(3, 5));
  expect(await screen.findByText('No possible duplicates to review.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(briefingApi.undoDuplicateMerge).toHaveBeenCalledWith(42));
  expect(await screen.findByText('Merge undone.')).toBeTruthy();
});

test('keeps a duplicate pair separate without merging either side', async () => {
  vi.mocked(briefingApi.duplicateReview).mockResolvedValueOnce(duplicatePair).mockResolvedValue({ ...duplicatePair, items: [], total: 0 });
  vi.mocked(briefingApi.dismissDuplicate).mockResolvedValue({ status: 'ok' });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Keep separate' }));
  await waitFor(() => expect(briefingApi.dismissDuplicate).toHaveBeenCalledWith(3, 5));
  expect(await screen.findByText('No possible duplicates to review.')).toBeTruthy();
  expect(briefingApi.mergeDuplicates).not.toHaveBeenCalled();
});

const refundMatch = { items: [{
  refund_transaction_id: 5,
  refund: { merchant: 'Cafe', date: '2026-06-10', amount: { minor_units: 2000, currency: 'SGD' as const } },
  candidate_purchase: { transaction_id: 3, merchant: 'Cafe', date: '2026-06-01', amount: { minor_units: 2000, currency: 'SGD' as const } },
  reason: 'same_merchant_amount_window' as const,
}], total: 1, limit: 50, offset: 0 };

test('confirms a proposed refund match and refreshes the pending list', async () => {
  vi.mocked(briefingApi.refundMatchReview).mockResolvedValueOnce(refundMatch).mockResolvedValue({ ...refundMatch, items: [], total: 0 });
  vi.mocked(briefingApi.resolveRefundMatch).mockResolvedValue({ status: 'ok' });
  show();
  expect(await screen.findByText('Likely refunds')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm match' }));
  expect(await screen.findByText('No refund matches to review.')).toBeTruthy();
  expect(briefingApi.resolveRefundMatch).toHaveBeenCalledWith(5, 'accept');
});

test('dismisses a proposed refund match without linking it', async () => {
  vi.mocked(briefingApi.refundMatchReview).mockResolvedValueOnce(refundMatch).mockResolvedValue({ ...refundMatch, items: [], total: 0 });
  vi.mocked(briefingApi.resolveRefundMatch).mockResolvedValue({ status: 'ok' });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
  expect(await screen.findByText('No refund matches to review.')).toBeTruthy();
  expect(briefingApi.resolveRefundMatch).toHaveBeenCalledWith(5, 'dismiss');
});

const recurring = { items: [{ id: 'opaque', merchant: 'Full merchant', frequency: 'monthly' }], total: 1, limit: 50, offset: 0 };

test('accepts an inferred recurring schedule and opens its billing controls', async () => {
  vi.mocked(briefingApi.recurringReview).mockResolvedValueOnce(recurring).mockResolvedValue({ ...recurring, items: [], total: 0 });
  vi.mocked(briefingApi.resolveRecurring).mockResolvedValue({ status: 'ok', subscription_id: 12 });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Accept schedule' }));
  expect(await screen.findByText('No pending recurring suggestions.')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Review billing details' }).getAttribute('href')).toBe('/plan?subscription=12');
  expect(briefingApi.resolveRecurring).toHaveBeenCalledWith('opaque', 'accept');
  expect(screen.getByText(/Provider billing is unchanged/)).toBeTruthy();
});

test('dismisses only the selected suggestion and refreshes the pending list', async () => {
  vi.mocked(briefingApi.recurringReview).mockResolvedValueOnce(recurring).mockResolvedValue({ ...recurring, items: [], total: 0 });
  vi.mocked(briefingApi.resolveRecurring).mockResolvedValue({ status: 'ok', subscription_id: null });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Dismiss suggestion' }));
  expect(await screen.findByText('Suggestion dismissed.')).toBeTruthy();
  expect(briefingApi.resolveRecurring).toHaveBeenCalledWith('opaque', 'dismiss');
  expect(await screen.findByText('No pending recurring suggestions.')).toBeTruthy();
});

test('a conflicting action retains the suggestion and offers a refresh', async () => {
  vi.mocked(briefingApi.recurringReview).mockResolvedValue(recurring);
  vi.mocked(briefingApi.resolveRecurring).mockRejectedValue(new Error('Already handled in Telegram'));
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Accept schedule' }));
  expect(await screen.findByText('Already handled in Telegram')).toBeTruthy();
  expect(screen.getByText('Full merchant')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Accept schedule' }).hasAttribute('disabled')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh suggestions' }));
  await waitFor(() => expect(briefingApi.recurringReview).toHaveBeenCalledTimes(2));
});

test('recurring review can retry a failed load and navigate empty later pages', async () => {
  vi.mocked(briefingApi.recurringReview).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ...recurring, total: 51 });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Full merchant')).toBeTruthy();
  expect(screen.getByText('Monthly · Inferred pattern')).toBeTruthy();
  vi.mocked(briefingApi.recurringReview).mockResolvedValue({ ...recurring, items: [], total: 1, offset: 50 });
  fireEvent.click(screen.getByRole('button', { name: 'Next suggestions' }));
  expect(await screen.findByText('No suggestions on this page. Return to an earlier page.')).toBeTruthy();
  expect(briefingApi.recurringReview).toHaveBeenCalledWith(50);
  fireEvent.click(screen.getByRole('button', { name: 'Previous suggestions' }));
  await waitFor(() => expect(briefingApi.recurringReview).toHaveBeenLastCalledWith(0));
});
