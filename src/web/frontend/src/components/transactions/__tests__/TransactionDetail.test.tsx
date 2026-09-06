import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TransactionDetail } from '../TransactionDetail';
import type { Transaction } from '@/api/client';

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('@/hooks/useTransactions', () => ({
  useUpdateTransaction: () => ({ mutate, isPending: false }),
  useDeleteTransaction: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useCategories', () => ({ useCategories: () => ({ data: [{ name: 'Food' }] }) }));
vi.mock('@/hooks/useIconMap', () => ({ useIconMap: () => ({}) }));
vi.mock('@/api/client', () => ({ api: { getAppleWalletCards: async () => [], getSettings: async () => ({ trips_enabled: false }) } }));
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
