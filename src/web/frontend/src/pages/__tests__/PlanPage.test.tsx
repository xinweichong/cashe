import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { briefingApi, type UpcomingPlan } from '@/api/briefing';
import { PlanPage } from '../PlanPage';

vi.mock('@/api/briefing', async importOriginal => ({ ...await importOriginal<typeof import('@/api/briefing')>(), briefingApi: { upcoming: vi.fn() } }));
const report: UpcomingPlan = {
  start: '2026-09-08', end: '2026-10-07', timezone: 'Asia/Singapore', enabled: true,
  items: [{ id: 1, subscription_id: 3, label: 'Internet', date: '2026-09-09', frequency: 'monthly', schedule_status: 'possibly_cancelled', amount: null }],
  total: 1, limit: 50, offset: 0, known_total: { minor_units: 0, currency: 'SGD' }, unknown_count: 1, status: 'partial',
};
beforeEach(() => { vi.resetAllMocks(); vi.mocked(briefingApi.upcoming).mockResolvedValue(report); });
afterEach(cleanup);
function show() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><PlanPage /></MemoryRouter></QueryClientProvider>);
}

test('shows uncertain charges and links directly to schedule controls', async () => {
  show();
  expect(await screen.findByText('Amount unknown')).toBeTruthy();
  expect(screen.getByText(/Known estimated subtotal/)).toBeTruthy();
  expect(screen.getByText(/previous charge may be overdue/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Review schedule for Internet' }).getAttribute('href')).toBe('/plan/manage?subscription=3');
  expect(screen.getByText(/not a complete forecast/)).toBeTruthy();
});

test('failed data is distinct from an empty timeline and can retry', async () => {
  vi.mocked(briefingApi.upcoming).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ...report, items: [], total: 0, unknown_count: 0, status: 'estimated' });
  show();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText(/No pending charges/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(/No pending charges recorded/)).toBeTruthy();
});

test('changing horizon resets pagination', async () => {
  vi.mocked(briefingApi.upcoming).mockResolvedValue({ ...report, total: 51 });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Next charges' }));
  await waitFor(() => expect(briefingApi.upcoming).toHaveBeenCalledWith(30, 50));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '90' } });
  await waitFor(() => expect(briefingApi.upcoming).toHaveBeenCalledWith(90, 0));
});

test('disabled subscriptions explain how to enable the timeline', async () => {
  vi.mocked(briefingApi.upcoming).mockResolvedValue({ ...report, enabled: false });
  show();
  expect(await screen.findByRole('link', { name: 'Open Settings' })).toBeTruthy();
  expect(screen.queryByText('Internet')).toBeNull();
  expect(screen.getByRole('link', { name: /Manage subscriptions/ })).toBeTruthy();
});


test('older Plan management links retain their query and hash', async () => {
  function Destination() { const location = useLocation(); return <output>{location.pathname}{location.search}{location.hash}</output>; }
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/plan?tab=goals#details']}><Routes><Route path="/plan" element={<PlanPage />} /><Route path="/plan/manage" element={<Destination />} /></Routes></MemoryRouter></QueryClientProvider>);
  expect((await screen.findByRole('status')).textContent).toBe('/plan/manage?tab=goals#details');
});
