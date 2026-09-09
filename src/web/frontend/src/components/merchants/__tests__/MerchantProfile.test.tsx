import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, type MerchantProfile as MerchantProfileData } from '@/api/client';
import { MerchantProfile } from '../MerchantProfile';

vi.mock('@/api/client', async (orig) => ({
  ...await orig<typeof import('@/api/client')>(),
  api: {
    getMerchantProfile: vi.fn(),
    getMerchantTrend: vi.fn(),
    getTransactions: vi.fn(),
    setMerchantTags: vi.fn(),
    setMerchantNotes: vi.fn(),
  },
}));

function profile(overrides: Partial<MerchantProfileData>): MerchantProfileData {
  return {
    merchant: 'Cafe', total_sgd: 100, transaction_count: 5, avg_amount_sgd: 20,
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
  vi.mocked(api.getMerchantProfile).mockResolvedValue(profile({ merchant: 'Cafe', notes: 'Loves their oat milk latte' }));
  show('Cafe');
  const textarea = await waitFor(() => screen.getByDisplayValue('Loves their oat milk latte'));
  expect(textarea).toBeTruthy();
});
