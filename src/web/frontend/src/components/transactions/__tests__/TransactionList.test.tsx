import { afterEach, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { TransactionList } from '../TransactionList';
import type { Transaction, DailyTotalV2 } from '@/api/client';

afterEach(cleanup);

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 1, source: 'manual', source_id: '', amount: 10, currency: 'SGD', exchange_rate: null,
    merchant: 'Cafe', description: null, category: 'Food', transaction_date: '2026-09-06T12:00:00',
    ingested_at: '2026-09-06T12:00:00', type: 'expense', ...overrides,
  };
}

it('groups transactions under one header per local day, in list order', () => {
  const transactions = [
    tx({ id: 3, transaction_date: '2026-09-06T18:00:00' }),
    tx({ id: 2, transaction_date: '2026-09-06T09:00:00' }),
    tx({ id: 1, transaction_date: '2026-09-05T09:00:00' }),
  ];
  render(
    <TransactionList
      transactions={transactions}
      onLoadMore={() => {}}
      hasMore={false}
      isLoading={false}
      onTransactionClick={() => {}}
    />
  );
  const headers = screen.getAllByTestId('tx-day-header');
  expect(headers).toHaveLength(2);
  expect(within(headers[0]).getByText(/6 Sep/)).toBeInTheDocument();
  expect(within(headers[1]).getByText(/5 Sep/)).toBeInTheDocument();
});

it('shows the fetched daily total for a day, and a placeholder when one is not loaded yet', () => {
  const transactions = [tx({ id: 1, transaction_date: '2026-09-06T09:00:00' })];
  const dailyTotals = new Map<string, DailyTotalV2>([
    ['2026-09-06', { date: '2026-09-06', spending: { minor_units: 1234, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 1, unresolved_count: 0, indicative_count: 0, status: 'complete' }],
  ]);
  const { rerender } = render(
    <TransactionList
      transactions={transactions}
      onLoadMore={() => {}}
      hasMore={false}
      isLoading={false}
      onTransactionClick={() => {}}
      dailyTotals={dailyTotals}
    />
  );
  expect(screen.getByTestId('tx-day-total')).toHaveTextContent('$12.34');

  rerender(
    <TransactionList
      transactions={transactions}
      onLoadMore={() => {}}
      hasMore={false}
      isLoading={false}
      onTransactionClick={() => {}}
    />
  );
  expect(screen.getByTestId('tx-day-total')).toHaveTextContent('···');
});

it('marks a day total with a note when the underlying status is not complete', () => {
  const transactions = [tx({ id: 1, transaction_date: '2026-09-06T09:00:00' })];
  const dailyTotals = new Map<string, DailyTotalV2>([
    ['2026-09-06', { date: '2026-09-06', spending: { minor_units: 1000, currency: 'SGD' }, income: null, recorded_net_flow: null, transaction_count: 1, unresolved_count: 1, indicative_count: 0, status: 'partial' }],
  ]);
  render(
    <TransactionList
      transactions={transactions}
      onLoadMore={() => {}}
      hasMore={false}
      isLoading={false}
      onTransactionClick={() => {}}
      dailyTotals={dailyTotals}
    />
  );
  expect(screen.getByTestId('tx-day-total')).toHaveTextContent('*');
});
