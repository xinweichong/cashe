import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TransactionForm } from '../TransactionForm';

const { mutate, getSettings, getTrips, getActiveTrip, enlistTransaction } = vi.hoisted(() => ({
  mutate: vi.fn(), getSettings: vi.fn(), getTrips: vi.fn(), getActiveTrip: vi.fn(), enlistTransaction: vi.fn(),
}));
vi.mock('@/hooks/useTransactions', () => ({
  useCreateTransaction: () => ({ mutate, isPending: false, isError: false }),
}));
vi.mock('@/api/client', () => ({ api: { getSettings, getTrips, getActiveTrip, enlistTransaction } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function renderForm() {
  const close = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <TransactionForm categories={[{ name: 'Food', keywords: null, icon: null, color: null, type: 'neutral' }]} onClose={close} />
    </QueryClientProvider>,
  );
  return { ...view, close };
}

it('shows only amount and merchant until "More details" is opened', async () => {
  getSettings.mockResolvedValue({ trips_enabled: false });
  renderForm();

  expect(screen.getByPlaceholderText('0.00')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('e.g. Coffee Shop')).toBeInTheDocument();
  expect(screen.queryByText('Category')).not.toBeInTheDocument();
  expect(screen.queryByText('Date & Time')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Currency, date, category, notes/ }));

  expect(await screen.findByText('Category')).toBeInTheDocument();
  expect(screen.getByText('Date & Time')).toBeInTheDocument();
});

it('pre-selects the active trip and enlists the new transaction on save', async () => {
  getSettings.mockResolvedValue({ trips_enabled: true });
  getTrips.mockResolvedValue([{ id: 5, name: 'Bali', destination: null, start_date: '2026-01-01', end_date: null, primary_currency: 'SGD', status: 'active', created_at: '', updated_at: '' }]);
  getActiveTrip.mockResolvedValue({ id: 5, name: 'Bali', destination: null, start_date: '2026-01-01', end_date: null, primary_currency: 'SGD', status: 'active', created_at: '', updated_at: '' });
  mutate.mockImplementation((_vars, { onSuccess }) => onSuccess({ id: 42 }));
  enlistTransaction.mockResolvedValue({ status: 'ok' });

  renderForm();
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '10' } });
  fireEvent.click(screen.getByRole('button', { name: /Currency, date, category, notes/ }));
  // Wait for the trip *trigger* to actually display "Bali", not just for
  // the item to exist somewhere in the DOM (Radix mirrors every Select's
  // options into a visually-hidden native <select> for form/autofill
  // compatibility, which matches a plain findByText well before the
  // visible trigger — driven by a separate, later-resolving query — has
  // caught up).
  await waitFor(() => {
    const comboboxes = screen.getAllByRole('combobox').map((el) => el.textContent);
    expect(comboboxes).toContain('Bali');
  });

  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(enlistTransaction).toHaveBeenCalledWith(5, 42));
});
