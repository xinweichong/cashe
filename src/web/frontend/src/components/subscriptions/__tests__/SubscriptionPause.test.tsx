import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, type Subscription } from '@/api/client';
import { SubscriptionDetail } from '../SubscriptionDetail';

vi.mock('@/api/client', () => ({ api: {
  getSubscriptions: vi.fn(), getSubscriptionHistory: vi.fn(), getSubscriptionUpcoming: vi.fn(),
  getTransactions: vi.fn(), updateSubscription: vi.fn(), confirmSubscription: vi.fn(),
} }));
const base: Subscription = {
  id: 1, merchant: 'Cafe', label: null, frequency: 'monthly', billing_day: 9,
  status: 'active', confirmation_source: 'unknown', notes: null, last_amount: null, next_expected_date: '2026-09-09',
  next_upcoming_id: 2, created_at: '', updated_at: '',
};
let sub: Subscription;
beforeEach(() => {
  vi.resetAllMocks();
  sub = { ...base };
  vi.mocked(api.getSubscriptions).mockImplementation(async () => ({ subscriptions: [sub], summary: {
    total_monthly_sgd: 0, active_count: sub.status === 'active' ? 1 : 0, possibly_cancelled_count: 0,
  } }));
  vi.mocked(api.getSubscriptionHistory).mockResolvedValue([]);
  vi.mocked(api.getSubscriptionUpcoming).mockResolvedValue([{ id: 2, subscription_id: 1,
    expected_date: '2026-09-09', expected_amount: 12, status: 'pending', matched_transaction_id: null }]);
  vi.mocked(api.getTransactions).mockResolvedValue([]);
  vi.mocked(api.updateSubscription).mockImplementation(async (_id, fields) => {
    sub = { ...sub, ...fields }; return sub;
  });
});
afterEach(cleanup);
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}><SubscriptionDetail subId={1} onClose={() => {}} /></QueryClientProvider>);
  return invalidate;
}

test('pause and resume explain provider limits and refresh predictions', async () => {
  const invalidate = show();
  fireEvent.click(await screen.findByRole('button', { name: 'Pause in Cashe' }));
  expect(await screen.findByRole('button', { name: 'Resume in Cashe' })).toBeTruthy();
  expect(screen.getByText(/does not pause billing with your provider/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Match' })).toBeNull();
  expect(api.updateSubscription).toHaveBeenCalledWith(1, { status: 'paused' });
  for (const key of ['subscriptions', 'subscription-upcoming', 'plan-upcoming', 'home-briefing']) {
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Resume in Cashe' }));
  expect(await screen.findByRole('button', { name: 'Pause in Cashe' })).toBeTruthy();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Match' })).toBeTruthy());
  expect(api.updateSubscription).toHaveBeenCalledWith(1, { status: 'active' });
});

test('failed pause retains schedule and allows retry', async () => {
  vi.mocked(api.updateSubscription).mockRejectedValueOnce(new Error('Could not save'));
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Pause in Cashe' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Could not save');
  fireEvent.click(screen.getByRole('button', { name: 'Pause in Cashe' }));
  expect(await screen.findByRole('button', { name: 'Resume in Cashe' })).toBeTruthy();
});


test('explicit confirmation preserves paused status and labels estimates', async () => {
  sub.status = 'paused';
  vi.mocked(api.confirmSubscription).mockImplementation(async () => {
    sub = { ...sub, confirmation_source: 'user' }; return { status: 'ok' };
  });
  const invalidate = show();
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm this schedule' }));
  expect(await screen.findByText(/Schedule confirmed by you/)).toBeTruthy();
  expect(screen.getByText(/Future dates and amounts remain estimates/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Resume in Cashe' })).toBeTruthy();
  expect(api.confirmSubscription).toHaveBeenCalledWith(1);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['plan-upcoming'] });
  expect(screen.queryByRole('button', { name: 'Confirm this schedule' })).toBeNull();
});


test('failed confirmation stays unknown and can be retried', async () => {
  vi.mocked(api.confirmSubscription).mockRejectedValueOnce(new Error('Could not confirm'));
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm this schedule' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Could not confirm');
  expect(screen.getByText(/Schedule confirmation not recorded/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Confirm this schedule' }).hasAttribute('disabled')).toBe(false);
});
