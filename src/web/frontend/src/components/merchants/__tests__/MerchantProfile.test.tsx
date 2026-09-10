import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, type MerchantSummaryV2 } from '@/api/client';
import { MerchantProfile } from '../MerchantProfile';

vi.mock('@/api/client', async (orig) => ({
  ...await orig<typeof import('@/api/client')>(),
  api: {
    getMerchantProfileV2: vi.fn(),
    getMerchantTrend: vi.fn(),
    getTransactions: vi.fn(),
    setMerchantTags: vi.fn(),
    setMerchantNotes: vi.fn(),
  },
}));

function profile(overrides: Partial<MerchantSummaryV2>): MerchantSummaryV2 {
  return {
    merchant: 'Cafe',
    total: { minor_units: 10000, currency: 'SGD' },
    transaction_count: 5,
    avg_amount: { minor_units: 2000, currency: 'SGD' },
    category: 'Food', first_seen: '2026-01-01', last_seen: '2026-06-01', tags: [], notes: '',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(api.getMerchantTrend).mockResolvedValue({ merchant: 'Cafe', months: [], current_month: 0, previous_month: 0, trend: 'stable' });
  vi.mocked(api.getTransactions).mockResolvedValue([]);
});
afterEach(cleanup);

function show(merchant: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MerchantProfile merchant={merchant} onClose={() => {}} />
    </QueryClientProvider>
  );
}

test('loads the notes draft once the async profile arrives, not just on merchant change', async () => {
  vi.mocked(api.getMerchantProfileV2).mockResolvedValue(profile({ merchant: 'Cafe', notes: 'Loves their oat milk latte' }));
  show('Cafe');
  const textarea = await waitFor(() => screen.getByDisplayValue('Loves their oat milk latte'));
  expect(textarea).toBeTruthy();
});
