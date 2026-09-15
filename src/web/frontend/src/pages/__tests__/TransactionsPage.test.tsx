import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TransactionsPage } from '../TransactionsPage';

// jsdom has no IntersectionObserver — TransactionList's "load more" sentinel
// needs a stub whenever a rendered page can be full (hasNextPage: true).
class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
// jsdom doesn't implement scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

const { getTransactionsV2, getDailyTotalsV2, getCategories, getSettings, getTrips, home, bulkCorrectTransactions, bulkUndoTransactions } = vi.hoisted(() => ({
  getTransactionsV2: vi.fn(), getDailyTotalsV2: vi.fn(), getCategories: vi.fn(),
  getSettings: vi.fn(), getTrips: vi.fn(), home: vi.fn(),
  bulkCorrectTransactions: vi.fn(), bulkUndoTransactions: vi.fn(),
}));
vi.mock('@/api/client', () => ({
  api: { getTransactionsV2, getDailyTotalsV2, getCategories, getSettings, getTrips, bulkCorrectTransactions, bulkUndoTransactions },
}));
vi.mock('@/api/briefing', () => ({ briefingApi: { home } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); sessionStorage.clear(); });

function renderPage() {
  getSettings.mockResolvedValue({ trips_enabled: false });
  getTrips.mockResolvedValue([]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/transactions']}>
        <LocationProbe />
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

it('sends the type filter and reflects it in the URL', async () => {
  getCategories.mockResolvedValue([]);
  home.mockResolvedValue({ review_count: 0 });
  getTransactionsV2.mockResolvedValue([]);
  getDailyTotalsV2.mockResolvedValue([]);

  renderPage();
  await screen.findByText('Nothing captured this period.');

  fireEvent.click(screen.getByRole('button', { name: 'Refund' }));

  await waitFor(() => expect(getTransactionsV2).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'refund' }),
  ));
  await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent('type=refund'));
});

it('sends needs_review=true when the Needs review toggle is active', async () => {
  getCategories.mockResolvedValue([]);
  home.mockResolvedValue({ review_count: 0 });
  getTransactionsV2.mockResolvedValue([]);
  getDailyTotalsV2.mockResolvedValue([]);

  renderPage();
  await screen.findByText('Nothing captured this period.');

  fireEvent.click(screen.getByRole('button', { name: 'Needs review' }));

  await waitFor(() => expect(getTransactionsV2).toHaveBeenCalledWith(
    expect.objectContaining({ needs_review: 'true' }),
  ));
});

it('hydrates filters from the URL on mount and shows a trip picker only when trips are enabled', async () => {
  getCategories.mockResolvedValue([]);
  home.mockResolvedValue({ review_count: 0 });
  getSettings.mockResolvedValue({ trips_enabled: true });
  getTrips.mockResolvedValue([{ id: 7, name: 'Bali', destination: null, start_date: '2026-01-01', end_date: null, primary_currency: 'SGD', status: 'inactive', created_at: '', updated_at: '' }]);
  getTransactionsV2.mockResolvedValue([]);
  getDailyTotalsV2.mockResolvedValue([]);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/transactions?q=coffee&type=refund&trip=7']}>
        <Routes>
          <Route path="/transactions/:transactionId?" element={<TransactionsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await waitFor(() => expect(getTransactionsV2).toHaveBeenCalledWith(
    expect.objectContaining({ merchant_search: 'coffee', type: 'refund', trip_id: '7' }),
  ));
  expect(await screen.findByLabelText('Trip')).toHaveValue('7');
  expect((screen.getByPlaceholderText(/search/i) as HTMLInputElement).value).toBe('coffee');
});

it('auto-loads pages until a remembered scroll anchor is visible, without user scrolling', async () => {
  getCategories.mockResolvedValue([]);
  home.mockResolvedValue({ review_count: 0 });
  getDailyTotalsV2.mockResolvedValue([]);
  sessionStorage.setItem('activity-scroll-anchor', '99');
  const page1 = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1, revision: 1, source: 'manual', type: 'expense', merchant: `M${i + 1}`, category: 'Food',
    description: null, transaction_date: '2026-09-06T09:00:00', ingested_at: '2026-09-06T09:00:00',
    original: { minor_units: 100, currency: 'SGD' }, reporting: { minor_units: 100, currency: 'SGD' },
    conversion: { status: 'native', rate: null, source: null, quoted_at: null }, refund_of: null, refunded_by: [],
  }));
  const page2 = [{
    id: 99, revision: 1, source: 'manual', type: 'expense', merchant: 'Anchor Merchant', category: 'Food',
    description: null, transaction_date: '2026-09-05T09:00:00', ingested_at: '2026-09-05T09:00:00',
    original: { minor_units: 100, currency: 'SGD' }, reporting: { minor_units: 100, currency: 'SGD' },
    conversion: { status: 'native', rate: null, source: null, quoted_at: null }, refund_of: null, refunded_by: [],
  }];
  getTransactionsV2.mockImplementation(async (params?: Record<string, unknown>) =>
    (params?.offset ?? 0) === 0 ? page1 : page2,
  );

  renderPage();

  expect(await screen.findByText('Anchor Merchant')).toBeInTheDocument();
  expect(getTransactionsV2).toHaveBeenCalledWith(expect.objectContaining({ offset: 20 }));
  sessionStorage.removeItem('activity-scroll-anchor');
});

function txV2(id: number, merchant: string, revision: number) {
  return {
    id, revision, source: 'manual', type: 'expense', merchant, category: 'Food',
    description: null, transaction_date: '2026-09-06T09:00:00', ingested_at: '2026-09-06T09:00:00',
    original: { minor_units: 1000, currency: 'SGD' }, reporting: { minor_units: 1000, currency: 'SGD' },
    conversion: { status: 'native', rate: null, source: null, quoted_at: null }, refund_of: null, refunded_by: [],
  };
}

it('bulk-categorizes selected rows using their loaded revisions, then offers undo', async () => {
  getCategories.mockResolvedValue([{ name: 'Transport' }]);
  home.mockResolvedValue({ review_count: 0 });
  getDailyTotalsV2.mockResolvedValue([]);
  getTransactionsV2.mockImplementation(async (params?: Record<string, unknown>) =>
    (params?.offset ?? 0) === 0 ? [txV2(1, 'Cafe', 3), txV2(2, 'Shop', 5)] : [],
  );
  bulkCorrectTransactions.mockResolvedValue([
    { id: 1, status: 'ok', revision: 4 },
    { id: 2, status: 'ok', revision: 6 },
  ]);

  renderPage();
  await screen.findByText('Cafe');

  fireEvent.click(screen.getByRole('button', { name: 'Select' }));
  fireEvent.click(screen.getByText('Cafe'));
  fireEvent.click(screen.getByText('Shop'));
  fireEvent.change(screen.getByLabelText('Set category for selected'), { target: { value: 'Transport' } });

  await waitFor(() => expect(bulkCorrectTransactions).toHaveBeenCalled());
  expect(bulkCorrectTransactions.mock.calls[0][0]).toEqual({
    transaction_ids: [1, 2], category: 'Transport', expected_revisions: { 1: 3, 2: 5 },
  });
  const undoBanner = await screen.findByText(/Updated 2\./);
  expect(undoBanner).toBeInTheDocument();
  // Selection mode ends and the picker resets after a bulk action.
  expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument();

  bulkUndoTransactions.mockResolvedValue([{ id: 1, status: 'ok', revision: 5 }, { id: 2, status: 'ok', revision: 7 }]);
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

  await waitFor(() => expect(bulkUndoTransactions).toHaveBeenCalled());
  expect(bulkUndoTransactions.mock.calls[0][0]).toEqual({
    transaction_ids: [1, 2], expected_revisions: { 1: 4, 2: 6 },
  });
  await waitFor(() => expect(screen.queryByText(/Updated 2\./)).not.toBeInTheDocument());
});

it('reports a per-row conflict from a bulk action without losing the rows that succeeded', async () => {
  getCategories.mockResolvedValue([{ name: 'Transport' }]);
  home.mockResolvedValue({ review_count: 0 });
  getDailyTotalsV2.mockResolvedValue([]);
  getTransactionsV2.mockImplementation(async (params?: Record<string, unknown>) =>
    (params?.offset ?? 0) === 0 ? [txV2(1, 'Cafe', 3), txV2(2, 'Shop', 5)] : [],
  );
  bulkCorrectTransactions.mockResolvedValue([
    { id: 1, status: 'ok', revision: 4 },
    { id: 2, status: 'conflict', current_revision: 6 },
  ]);

  renderPage();
  await screen.findByText('Cafe');
  fireEvent.click(screen.getByRole('button', { name: 'Select' }));
  fireEvent.click(screen.getByText('Cafe'));
  fireEvent.click(screen.getByText('Shop'));
  fireEvent.change(screen.getByLabelText('Set category for selected'), { target: { value: 'Transport' } });

  await waitFor(() => expect(bulkCorrectTransactions).toHaveBeenCalled());
  // Only the row that actually succeeded is offered for undo.
  expect(await screen.findByText(/Updated 1\./)).toBeInTheDocument();
});
