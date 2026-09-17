import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { briefingApi, type MonthForecast, type UpcomingPlan } from '@/api/briefing';
import { PlanPage } from '../PlanPage';

vi.mock('@/api/briefing', async importOriginal => ({ ...await importOriginal<typeof import('@/api/briefing')>(), briefingApi: { upcoming: vi.fn(), upcomingOnDate: vi.fn(), upcomingCalendar: vi.fn(), updatePlannedCharge: vi.fn(), dismissPlannedCharge: vi.fn(), monthForecast: vi.fn() } }));
const report: UpcomingPlan = {
  start: '2026-09-08', end: '2026-10-07', timezone: 'Asia/Singapore', enabled: true,
  items: [{ id: 1, subscription_id: 3, label: 'Internet', date: '2026-09-09', frequency: 'monthly', schedule_status: 'possibly_cancelled', confirmation_source: 'unknown', amount: null, date_basis: 'schedule', amount_basis: 'unknown', amount_basis_transaction_id: null }],
  total: 1, limit: 50, offset: 0, known_total: { minor_units: 0, currency: 'SGD' }, unknown_count: 1, status: 'partial',
};
const forecast: MonthForecast = {
  as_of: '2026-09-16', timezone: 'Asia/Singapore', period_start: '2026-09-01', period_end: '2026-09-30',
  status: 'unavailable', reasons: ['insufficient_history'],
  recorded_actual: { minor_units: 5000, currency: 'SGD' }, confirmed_commitments: { minor_units: 0, currency: 'SGD' },
  unpriced_commitment_count: 0, remaining_variable_estimate: null, remaining_variable_low: null, remaining_variable_high: null,
  projected_total: null, projected_total_low: null, projected_total_high: null,
  weekday_medians: [], lookback_window: { start: '2026-07-20', end: '2026-09-13' }, assumptions: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(briefingApi.upcoming).mockResolvedValue(report);
  vi.mocked(briefingApi.monthForecast).mockResolvedValue(forecast);
  vi.mocked(briefingApi.upcomingCalendar).mockResolvedValue({ start: '2026-09-01', end: '2026-09-30', timezone: 'Asia/Singapore', days: [] });
  vi.mocked(briefingApi.upcomingOnDate).mockResolvedValue({ ...report, items: [] });
});
afterEach(cleanup);
function show() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><PlanPage /></MemoryRouter></QueryClientProvider>);
}

test('projection card explains unavailability rather than guessing', async () => {
  show();
  expect(await screen.findByText(/Not enough recorded history yet/)).toBeTruthy();
});

test('projection card shows the projected total, its historical range, and the calculation notes', async () => {
  vi.mocked(briefingApi.monthForecast).mockResolvedValue({
    ...forecast, status: 'complete', reasons: [],
    recorded_actual: { minor_units: 10000, currency: 'SGD' },
    projected_total: { minor_units: 30000, currency: 'SGD' },
    projected_total_low: { minor_units: 25000, currency: 'SGD' },
    projected_total_high: { minor_units: 40000, currency: 'SGD' },
    assumptions: ['Test assumption one.'],
  });
  show();
  expect(await screen.findByText('$300.00')).toBeTruthy();
  expect(screen.getByText(/\$250\.00.*\$400\.00/)).toBeTruthy();
  fireEvent.click(screen.getByText('How this is calculated'));
  expect(screen.getByText('Test assumption one.')).toBeTruthy();
});

test('projection card flags an unpriced commitment without hiding the rest of the projection', async () => {
  vi.mocked(briefingApi.monthForecast).mockResolvedValue({
    ...forecast, status: 'partial', reasons: ['unpriced_commitment'], unpriced_commitment_count: 1,
    projected_total: { minor_units: 10000, currency: 'SGD' },
    projected_total_low: { minor_units: 10000, currency: 'SGD' },
    projected_total_high: { minor_units: 10000, currency: 'SGD' },
  });
  show();
  expect(await screen.findByText(/1 upcoming charge has no known amount/)).toBeTruthy();
});

test('shows uncertain charges and links directly to schedule controls', async () => {
  show();
  expect(await screen.findByText('Amount unknown')).toBeTruthy();
  expect(screen.getByText(/Known estimated subtotal/)).toBeTruthy();
  expect(screen.getByText(/previous charge may be overdue/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Review or match schedule for Internet' }).getAttribute('href')).toBe('/plan/manage?subscription=3');
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

test('date-only corrections omit the displayed rounded amount and refresh the timeline', async () => {
  vi.mocked(briefingApi.upcoming).mockResolvedValue({ ...report, items: [{ ...report.items[0], amount: { minor_units: 1201, currency: 'SGD' } }] });
  vi.mocked(briefingApi.updatePlannedCharge).mockResolvedValue({ status: 'ok' });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit estimate' }));
  fireEvent.change(screen.getByLabelText('Expected date'), { target: { value: '2026-09-10' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save estimate' }));
  await waitFor(() => expect(briefingApi.updatePlannedCharge).toHaveBeenCalledWith(1, { expected_date: '2026-09-10' }));
  await waitFor(() => expect(briefingApi.upcoming).toHaveBeenCalledTimes(2));
});

test('clearing an amount explicitly restores unknown and failed edits remain editable', async () => {
  vi.mocked(briefingApi.upcoming).mockResolvedValue({ ...report, items: [{ ...report.items[0], amount: { minor_units: 1200, currency: 'SGD' } }] });
  vi.mocked(briefingApi.updatePlannedCharge).mockRejectedValue(new Error('conflict'));
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit estimate' }));
  fireEvent.change(screen.getByLabelText('Estimated amount (SGD)'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save estimate' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(briefingApi.updatePlannedCharge).toHaveBeenCalledWith(1, { expected_amount: null });
  expect(screen.getByRole('button', { name: 'Save estimate' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Refresh timeline' })).toBeTruthy();
});

test('dismissal requires an explicit second action and does not cancel the provider', async () => {
  vi.mocked(briefingApi.dismissPlannedCharge).mockResolvedValue({ status: 'ok' });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Dismiss prediction' }));
  expect(briefingApi.dismissPlannedCharge).not.toHaveBeenCalled();
  expect(screen.getByText(/does not cancel your subscription with the provider/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(briefingApi.dismissPlannedCharge).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss prediction' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss charge' }));
  await waitFor(() => expect(briefingApi.dismissPlannedCharge).toHaveBeenCalledWith(1));
  await waitFor(() => expect(briefingApi.upcoming).toHaveBeenCalledTimes(2));
});


test.each([
  ['unknown', 'Schedule confirmation not recorded'],
  ['user', 'Schedule confirmed by you'],
  ['recurring_suggestion', 'Recurring pattern confirmed by you'],
] as const)('shows %s provenance separately from estimated charges', async (source, label) => {
  vi.mocked(briefingApi.upcoming).mockResolvedValue({ ...report,
    items: [{ ...report.items[0], confirmation_source: source }],
  });
  show();
  expect(await screen.findByText(label)).toBeTruthy();
  expect(screen.getByText(/Dates and amounts are estimates, not confirmed charges/)).toBeTruthy();
});
