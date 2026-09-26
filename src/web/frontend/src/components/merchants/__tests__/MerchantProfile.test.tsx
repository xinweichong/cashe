import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    setMerchantAlias: vi.fn(),
    getMerchantRuleImpact: vi.fn(),
    applyMerchantRule: vi.fn(),
  },
}));

function profile(overrides: Partial<MerchantSummaryV2>): MerchantSummaryV2 {
  return {
    merchant: 'Cafe',
    display_name: 'Cafe',
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
  vi.mocked(api.getMerchantRuleImpact).mockRejectedValue(new Error('404'));
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

test('shows the recorded merchant string alongside a set display name, and saves an edit', async () => {
  vi.mocked(api.getMerchantProfileV2).mockResolvedValue(profile({ merchant: 'Cafe', display_name: 'The Corner Cafe' }));
  vi.mocked(api.setMerchantAlias).mockResolvedValue({ merchant: 'Cafe', display_name: 'New Name' });
  show('Cafe');
  expect(await screen.findByText('The Corner Cafe')).toBeTruthy();
  expect(screen.getByText('Recorded as “Cafe”')).toBeTruthy();
  const input = screen.getByDisplayValue('The Corner Cafe');
  fireEvent.change(input, { target: { value: 'New Name' } });
  fireEvent.blur(input);
  await waitFor(() => expect(api.setMerchantAlias).toHaveBeenCalledWith('Cafe', 'New Name'));
  expect(await screen.findByText('Saved')).toBeTruthy();
});

test('no category-rule section renders for a merchant with no rule', async () => {
  vi.mocked(api.getMerchantProfileV2).mockResolvedValue(profile({ merchant: 'Cafe' }));
  show('Cafe');
  await screen.findByText('Cafe', { selector: 'h2' });
  expect(screen.queryByText('Category rule')).toBeNull();
});

test('previews rule impact and applies it to existing transactions', async () => {
  vi.mocked(api.getMerchantProfileV2).mockResolvedValue(profile({ merchant: 'Grab', display_name: 'Grab' }));
  vi.mocked(api.getMerchantRuleImpact).mockResolvedValue({ merchant: 'Grab', category: 'Transport', differing_count: 3 });
  vi.mocked(api.applyMerchantRule).mockResolvedValue({ status: 'ok', updated_count: 3 });
  show('Grab');
  expect(await screen.findByText(/categorized/)).toBeTruthy();
  expect(screen.getByText('3 past transactions still have a different category.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Apply to 3 existing transactions' }));
  await waitFor(() => expect(api.applyMerchantRule).toHaveBeenCalledWith('Grab'));
});

test('reports all existing transactions already matching the rule', async () => {
  vi.mocked(api.getMerchantProfileV2).mockResolvedValue(profile({ merchant: 'Grab', display_name: 'Grab' }));
  vi.mocked(api.getMerchantRuleImpact).mockResolvedValue({ merchant: 'Grab', category: 'Transport', differing_count: 0 });
  show('Grab');
  expect(await screen.findByText('All existing transactions already match this rule.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Apply to/ })).toBeNull();
});
