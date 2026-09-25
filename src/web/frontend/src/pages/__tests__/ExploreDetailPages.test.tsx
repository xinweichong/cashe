import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { briefingApi } from '@/api/briefing';
import { ExploreHealthPage, ExploreSignalsPage } from '../ExploreDetailPages';

vi.mock('@/api/briefing', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/briefing')>(),
  briefingApi: { signals: vi.fn(), healthScore: vi.fn() },
}));

function show(page: React.ReactNode, path: string) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}>{page}</MemoryRouter></QueryClientProvider>);
}

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

test('the signals page lists every signal, each opening its transaction with a way back', async () => {
  vi.mocked(briefingApi.signals).mockResolvedValue({
    start: '2026-09-01', end: '2026-09-06', multiplier: 2,
    unusual: [{ transaction_id: 7, merchant: 'Grocer', category: 'Food', date: '2026-09-03', amount: { minor_units: 5000, currency: 'SGD' }, typical: { minor_units: 1100, currency: 'SGD' }, ratio: 4.5 }],
    new_merchants: [1, 2, 3, 4, 5].map(i => ({ merchant: `Place ${i}`, first_date: '2026-09-04', category: 'Shopping', amount: { minor_units: 1000, currency: 'SGD' as const }, transaction_id: 100 + i })),
  });
  show(<ExploreSignalsPage />, '/explore/signals');
  const unusual = await screen.findByRole('link', { name: /Grocer/ });
  expect(unusual.getAttribute('href')).toBe('/activity/7?returnTo=%2Fexplore%2Fsignals');
  expect(screen.getByRole('link', { name: /Place 5/ })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Back to Explore' }).getAttribute('href')).toBe('/explore');
});

test('the health page shows the full breakdown and the left-out records', async () => {
  vi.mocked(briefingApi.healthScore).mockResolvedValue({
    score: 64, grade: 'Good', has_income_data: true, period: '2026-09', start: '2026-09-01', end: '2026-09-06',
    status: 'partial', unresolved_count: 2, income: { minor_units: 300000, currency: 'SGD' }, spending: { minor_units: 1250, currency: 'SGD' },
    components: { savings_rate: { score: 40, max: 40, value: 0.99, benchmark: 0.2, label: 'Savings Rate', description: 'Income left after all spending' } },
  });
  show(<ExploreHealthPage />, '/explore/health');
  expect(await screen.findByText('Savings Rate')).toBeTruthy();
  expect(screen.getByText(/2 records are left out/)).toBeTruthy();
  expect(screen.getByRole('combobox', { name: 'Health score period' })).toBeTruthy();
});
