import { test, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { useUpdateTransaction, useDeleteTransaction } from '../useTransactions';
import { api, type Transaction } from '@/api/client';

vi.mock('@/api/client', () => ({
  api: {
    updateTransaction: vi.fn(),
    deleteTransaction: vi.fn(),
  },
}));

const tx = (id: number, merchant = 'Toast Box') =>
  ({ id, merchant, category: 'Food', amount: 5, currency: 'SGD' }) as Transaction;

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(['transactions', { limit: 5 }], [tx(1), tx(2)]);
  qc.setQueryData(['transactions', '', 'all', '', ''], {
    pages: [[tx(1)], [tx(2)]],
    pageParams: [0, 20],
  });
  // Activity's infinite v2 pages and its detail cache.
  qc.setQueryData(['transactions-v2', '', 'all'], {
    pages: [[{ ...tx(1), revision: 1, original: { minor_units: 500, currency: 'SGD' } }], [tx(2)]],
    pageParams: [0, 50],
  });
  qc.setQueryData(['transaction-v2', 1], tx(1));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return { qc, wrapper };
}

test('update patches every cache shape before the server responds', async () => {
  const { qc, wrapper } = setup();
  vi.mocked(api.updateTransaction).mockReturnValue(new Promise(() => {})); // never resolves
  const { result } = renderHook(() => useUpdateTransaction(), { wrapper });
  act(() => {
    result.current.mutate({ id: 1, data: { category: 'Transport' } });
  });
  await waitFor(() => {
    const arr = qc.getQueryData<Transaction[]>(['transactions', { limit: 5 }])!;
    expect(arr[0].category).toBe('Transport');
  });
  const inf = qc.getQueryData<{ pages: Transaction[][] }>([
    'transactions', '', 'all', '', '',
  ])!;
  expect(inf.pages[0][0].category).toBe('Transport');
  const v2 = qc.getQueryData<{ pages: Record<string, unknown>[][] }>(['transactions-v2', '', 'all'])!;
  expect(v2.pages[0][0].category).toBe('Transport');
  expect(v2.pages[0][0].original).toEqual({ minor_units: 500, currency: 'SGD' });
  expect(qc.getQueryData<Transaction>(['transaction-v2', 1])!.category).toBe('Transport');
});

test('update never adds fields a cached row does not have', async () => {
  const { qc, wrapper } = setup();
  vi.mocked(api.updateTransaction).mockReturnValue(new Promise(() => {}));
  const { result } = renderHook(() => useUpdateTransaction(), { wrapper });
  act(() => {
    result.current.mutate({ id: 1, data: { category: 'Transport', exchange_rate: 1.3 } });
  });
  await waitFor(() => {
    const v2 = qc.getQueryData<{ pages: Record<string, unknown>[][] }>(['transactions-v2', '', 'all'])!;
    expect(v2.pages[0][0].category).toBe('Transport');
    expect('exchange_rate' in v2.pages[0][0]).toBe(false);
  });
});

test('update rolls every cache back on error', async () => {
  const { qc, wrapper } = setup();
  vi.mocked(api.updateTransaction).mockRejectedValue(new Error('500'));
  const { result } = renderHook(() => useUpdateTransaction(), { wrapper });
  act(() => {
    result.current.mutate({ id: 1, data: { category: 'Transport' } });
  });
  await waitFor(() => expect(result.current.isError).toBe(true));
  const arr = qc.getQueryData<Transaction[]>(['transactions', { limit: 5 }])!;
  expect(arr[0].category).toBe('Food');
  expect(qc.getQueryData<Transaction>(['transaction-v2', 1])!.category).toBe('Food');
  const v2 = qc.getQueryData<{ pages: Record<string, unknown>[][] }>(['transactions-v2', '', 'all'])!;
  expect(v2.pages[0][0].category).toBe('Food');
});

test('update invalidates every spending cache, including ones added later, but not settings', async () => {
  // Regression for a real gap: these mutations used to invalidate only a
  // handful of keys (transactions, home-briefing, spending-evidence,
  // spending-review), leaving Explore's and Plan's own shared-facts queries
  // — and even most of Home's own breakdown queries — showing stale,
  // pre-edit numbers on a fast cached return. See "Query invalidation needs
  // journey review" in the baseline audit.
  const { qc, wrapper } = setup();
  const affected = [
    'home-category-breakdown', 'home-daily-totals', 'home-merchants',
    'explore-month-facts', 'explore-category-trend', 'explore-weekday-pattern',
    'month-forecast', 'plan-upcoming', 'plan-upcoming-calendar',
    // Missing from the old hand-kept list:
    'explore-breakdown', 'health-score-v2', 'budget-progress-v2', 'savings-overview',
  ];
  for (const key of [...affected, 'settings']) qc.setQueryData([key], { placeholder: true });
  vi.mocked(api.updateTransaction).mockResolvedValue({} as Awaited<ReturnType<typeof api.updateTransaction>>);
  const { result } = renderHook(() => useUpdateTransaction(), { wrapper });
  act(() => { result.current.mutate({ id: 1, data: { category: 'Transport' } }); });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  for (const key of affected) expect(qc.getQueryState([key])?.isInvalidated).toBe(true);
  expect(qc.getQueryState(['settings'])?.isInvalidated).toBe(false);
});

test('delete removes the row optimistically and restores it on error', async () => {
  const { qc, wrapper } = setup();
  vi.mocked(api.deleteTransaction).mockRejectedValue(new Error('500'));
  const { result } = renderHook(() => useDeleteTransaction(), { wrapper });
  act(() => { result.current.mutate(1); });
  await waitFor(() => expect(result.current.isError).toBe(true));
  const arr = qc.getQueryData<Transaction[]>(['transactions', { limit: 5 }])!;
  expect(arr.map((t) => t.id)).toEqual([1, 2]); // restored
  const v2 = qc.getQueryData<{ pages: { id: number }[][] }>(['transactions-v2', '', 'all'])!;
  expect(v2.pages.flat().map((t) => t.id)).toEqual([1, 2]);
});
