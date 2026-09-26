import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/api/client';
import { ActiveTripCard } from '../ActiveTripCard';

vi.mock('@/api/client', async (original) => ({
  ...await original<typeof import('@/api/client')>(),
  api: { getSettings: vi.fn(), getActiveTrip: vi.fn(), getTripSummary: vi.fn(), deactivateTrip: vi.fn() },
}));

function show() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><ActiveTripCard showEndButton /></MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getSettings).mockResolvedValue({ trips_enabled: true } as Awaited<ReturnType<typeof api.getSettings>>);
  vi.mocked(api.getActiveTrip).mockResolvedValue({ id: 7, name: 'Bali', start_date: '2026-09-01' } as Awaited<ReturnType<typeof api.getActiveTrip>>);
  vi.mocked(api.getTripSummary).mockResolvedValue({ total_sgd: 10, transaction_count: 1, daily_average_sgd: 1, by_category: [] } as unknown as Awaited<ReturnType<typeof api.getTripSummary>>);
  vi.mocked(api.deactivateTrip).mockResolvedValue({} as Awaited<ReturnType<typeof api.deactivateTrip>>);
});
afterEach(cleanup);

test('ending a trip asks for confirmation and cancelling leaves it active', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'End Trip' }));
  expect(await screen.findByRole('dialog', { name: 'End Bali?' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Keep trip active' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.deactivateTrip).not.toHaveBeenCalled();
});

test('confirming ends the trip', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'End Trip' }));
  fireEvent.click(await screen.findByRole('button', { name: 'End trip' }));
  await waitFor(() => expect(api.deactivateTrip).toHaveBeenCalledWith(7));
});
