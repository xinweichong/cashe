import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TransactionDetail } from '../TransactionDetail';
import type { Transaction } from '@/api/client';

const { mutate, provenance } = vi.hoisted(() => ({ mutate: vi.fn(), provenance: vi.fn() }));
vi.mock('@/hooks/useTransactions', () => ({
  useUpdateTransaction: () => ({ mutate, isPending: false }),
  useDeleteTransaction: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useCategories', () => ({ useCategories: () => ({ data: [{ name: 'Food' }] }) }));
vi.mock('@/hooks/useIconMap', () => ({ useIconMap: () => ({}) }));
vi.mock('@/api/client', () => ({ api: { getTransactionProvenance: provenance, getAppleWalletCards: async () => [], getSettings: async () => ({ trips_enabled: false }) } }));
beforeEach(() => provenance.mockReset().mockResolvedValue({ transaction_id: 1, sources: [{ channel: 'manual', evidence_recorded: false }] }));
afterEach(() => { cleanup(); mutate.mockReset(); });

it('defaults to one transaction and submits an explicit future-rule choice', () => {
  const transaction = { id: 1, merchant: 'Cafe', category: 'Food', amount: 12, currency: 'SGD', type: 'expense', source: 'manual', transaction_date: '2026-09-06T12:00:00' } as Transaction;
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><TransactionDetail transaction={transaction} onClose={() => {}} /></MemoryRouter></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect((screen.getByRole('radio', { name: 'This transaction only' }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mutate.mock.calls[0][0].data.remember_category).toBe(false);
  fireEvent.click(screen.getByRole('radio', { name: 'Remember for future matching transactions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mutate.mock.calls[1][0].data.remember_category).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect((screen.getByRole('radio', { name: 'This transaction only' }) as HTMLInputElement).checked).toBe(true);
});

const transaction = { id: 1, merchant: 'Cafe', category: 'Food', amount: 12, currency: 'SGD', type: 'expense', source: 'manual', source_id: 'private-id', transaction_date: '2026-09-06T12:00:00' } as Transaction;

it('submits explicit date and classification corrections and resets them on cancel', () => {
  render(detail({ ...transaction, transaction_date: '', type: 'unknown' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Transaction date'), { target: { value: '2026-09-05' } });
  fireEvent.change(screen.getByLabelText('Transaction type'), { target: { value: 'income' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mutate.mock.calls[0][0].data).toMatchObject({ transaction_date: '2026-09-05', type: 'income', remember_category: false });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(screen.getByLabelText('Transaction date')).toHaveValue('');
  expect(screen.getByLabelText('Transaction type')).toHaveValue('unknown');
});

it('category-only edits do not rewrite timestamps or legacy classifications', () => {
  render(detail({ ...transaction, transaction_date: '2026-09-06T12:30:45+08:00', type: null } as unknown as Transaction));
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(screen.getByLabelText('Transaction date')).toHaveValue('2026-09-06T12:30:45+08:00');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mutate.mock.calls[0][0].data).not.toHaveProperty('transaction_date');
  expect(mutate.mock.calls[0][0].data).not.toHaveProperty('type');
});

it('keeps a failed correction editable and prevents clearing an existing date', () => {
  render(detail());
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Transaction date'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mutate).not.toHaveBeenCalled();
  expect(screen.getByText('Choose a transaction date.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Transaction date'), { target: { value: 'bad-date' } });
  mutate.mockImplementation((_vars, callbacks) => callbacks.onError());
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByLabelText('Transaction date')).toHaveValue('bad-date');
  expect(screen.getByText(/Check the date and transaction fields/)).toBeInTheDocument();
});

function detail(tx = transaction, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return <QueryClientProvider client={client}><MemoryRouter><TransactionDetail transaction={tx} onClose={() => {}} /></MemoryRouter></QueryClientProvider>;
}

it('shows linked Wallet and Gmail evidence without internal source IDs', async () => {
  provenance.mockResolvedValue({ transaction_id: 1, sources: [{ channel: 'apple_wallet', evidence_recorded: true }, { channel: 'gmail', evidence_recorded: true }] });
  render(detail());
  const section = within(screen.getByRole('region', { name: 'Capture sources' }));
  expect(await section.findByText('Apple Wallet')).toBeInTheDocument();
  expect(section.getByText('Gmail')).toBeInTheDocument();
  expect(section.getByText(/linked to one transaction and counted once/)).toBeInTheDocument();
  expect(screen.queryByText('private-id')).not.toBeInTheDocument();
});

it('distinguishes a recorded source from retained evidence', async () => {
  render(detail());
  expect(await screen.findByText('Recorded source only; no capture evidence retained')).toBeInTheDocument();
  expect(screen.queryByText(/counted once/)).not.toBeInTheDocument();
});

it('shows loading and supports retry after unavailable provenance', async () => {
  provenance.mockRejectedValueOnce(new Error('offline'));
  render(detail());
  expect(screen.getByText('Loading capture sources…')).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry sources' }));
  expect(await screen.findByText('Recorded source only; no capture evidence retained')).toBeInTheDocument();
});

it('does not show the previous transaction’s evidence when selection changes', async () => {
  provenance.mockResolvedValueOnce({ transaction_id: 1, sources: [{ channel: 'gmail', evidence_recorded: true }] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { rerender } = render(detail(transaction, client));
  expect(await screen.findByText('Gmail')).toBeInTheDocument();
  rerender(detail({ ...transaction, id: 2 }, client));
  expect(await screen.findByText('Recorded source only; no capture evidence retained')).toBeInTheDocument();
  expect(screen.queryByText('Gmail')).not.toBeInTheDocument();
  expect(provenance).toHaveBeenLastCalledWith(2);
});
