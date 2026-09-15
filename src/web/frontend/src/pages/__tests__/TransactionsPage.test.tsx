import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TransactionsPage } from '../TransactionsPage';

const { getTransactionsV2, getDailyTotalsV2, getCategories, home } = vi.hoisted(() => ({
  getTransactionsV2: vi.fn(), getDailyTotalsV2: vi.fn(), getCategories: vi.fn(), home: vi.fn(),
}));
vi.mock('@/api/client', () => ({ api: { getTransactionsV2, getDailyTotalsV2, getCategories } }));
vi.mock('@/api/briefing', () => ({ briefingApi: { home } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/transactions']}>
        <Routes>
          <Route path="/transactions/:transactionId?" element={<TransactionsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('groups the v2 list by local day and shows the shared-fact daily total', async () => {
  getCategories.mockResolvedValue([]);
  home.mockResolvedValue({ review_count: 0 });
  getTransactionsV2.mockImplementation(async (params?: Record<string, unknown>) =>
    (params?.offset ?? 0) === 0
      ? [{
          id: 1, revision: 1, source: 'manual', type: 'expense', merchant: 'Cafe', category: 'Food',
          description: null, transaction_date: '2026-09-06T09:00:00', ingested_at: '2026-09-06T09:00:00',
          original: { minor_units: 1500, currency: 'SGD' }, reporting: { minor_units: 1500, currency: 'SGD' },
          conversion: { status: 'native', rate: null, source: null, quoted_at: null },
          refund_of: null, refunded_by: [],
        }]
      : [],
  );
  getDailyTotalsV2.mockResolvedValue([
    { date: '2026-09-06', spending: { minor_units: 1500, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 1, unresolved_count: 0, indicative_count: 0, status: 'complete' },
  ]);

  renderPage();

  expect(await screen.findByText('Cafe')).toBeInTheDocument();
  await waitFor(() => expect(getDailyTotalsV2).toHaveBeenCalledWith('2026-09-06', '2026-09-06'));
  expect(await screen.findByTestId('tx-day-total')).toHaveTextContent('$15.00');
});

it('does not request or show a daily total while a search filter narrows the rows', async () => {
  getCategories.mockResolvedValue([]);
  home.mockResolvedValue({ review_count: 0 });
  getTransactionsV2.mockResolvedValue([]);
  getDailyTotalsV2.mockResolvedValue([]);

  renderPage();
  await screen.findByText('Nothing captured this period.');

  const search = screen.getByPlaceholderText(/search/i);
  fireEvent.change(search, { target: { value: 'coffee' } });

  await waitFor(() => expect(getTransactionsV2).toHaveBeenCalledWith(
    expect.objectContaining({ merchant_search: 'coffee' }),
  ), { timeout: 1000 });
  expect(getDailyTotalsV2).not.toHaveBeenCalled();
});
