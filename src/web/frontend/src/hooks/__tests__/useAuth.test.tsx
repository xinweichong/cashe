import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { AuthProvider, useAuth } from '../useAuth';

vi.mock('@/api/client', async (orig) => {
  const actual = await orig<typeof import('@/api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      ping: vi.fn(),
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue({ status: 'ok' }),
    },
  };
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function Probe() {
  const { isAuthenticated, login, logout } = useAuth();
  const qc = useQueryClient();
  return (
    <div>
      <span data-testid="auth-state">{isAuthenticated ? 'authenticated' : 'anonymous'}</span>
      <span data-testid="cache-size">{qc.getQueryCache().getAll().length}</span>
      <button onClick={() => void login('u', 'p')}>login</button>
      <button onClick={logout}>logout</button>
    </div>
  );
}

function renderWithClient(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>
  );
}

test('logout clears every cached query, not just currentUser', async () => {
  vi.mocked(api.ping).mockResolvedValue({ status: 'ok' });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['currentUser'], { username: 'a' });
  queryClient.setQueryData(['home-briefing'], { owner: 'user-a-private-data' });
  renderWithClient(queryClient);

  await waitFor(() => expect(screen.getByTestId('auth-state').textContent).toBe('authenticated'));

  act(() => screen.getByText('logout').click());

  expect(queryClient.getQueryData(['home-briefing'])).toBeUndefined();
  expect(queryClient.getQueryData(['currentUser'])).toBeUndefined();
  await waitFor(() => expect(screen.getByTestId('auth-state').textContent).toBe('anonymous'));
});

test('a slow in-flight query started before logout does not repopulate the cache afterward', async () => {
  vi.mocked(api.ping).mockResolvedValue({ status: 'ok' });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithClient(queryClient);
  await waitFor(() => expect(screen.getByTestId('auth-state').textContent).toBe('authenticated'));

  let resolveSlowQuery: (value: { owner: string }) => void;
  const slowPromise = new Promise<{ owner: string }>((resolve) => { resolveSlowQuery = resolve; });
  queryClient.prefetchQuery({ queryKey: ['home-briefing'], queryFn: () => slowPromise });

  act(() => screen.getByText('logout').click());

  resolveSlowQuery!({ owner: 'user-a-private-data' });
  await new Promise((r) => setTimeout(r, 20));

  expect(queryClient.getQueryData(['home-briefing'])).toBeUndefined();
});

test('an auth:unauthorized event clears the entire cache and deauthenticates', async () => {
  vi.mocked(api.ping).mockResolvedValue({ status: 'ok' });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['home-briefing'], { owner: 'user-a-private-data' });
  renderWithClient(queryClient);
  await waitFor(() => expect(screen.getByTestId('auth-state').textContent).toBe('authenticated'));

  act(() => window.dispatchEvent(new CustomEvent('auth:unauthorized')));

  expect(queryClient.getQueryData(['home-briefing'])).toBeUndefined();
  await waitFor(() => expect(screen.getByTestId('auth-state').textContent).toBe('anonymous'));
});

test('logging out in one tab deauthenticates and clears cache in another tab via storage event', async () => {
  vi.mocked(api.ping).mockResolvedValue({ status: 'ok' });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['home-briefing'], { owner: 'user-a-private-data' });
  renderWithClient(queryClient);
  await waitFor(() => expect(screen.getByTestId('auth-state').textContent).toBe('authenticated'));

  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'cashe-auth-generation', newValue: String(Date.now()) }));
  });

  expect(queryClient.getQueryData(['home-briefing'])).toBeUndefined();
  await waitFor(() => expect(screen.getByTestId('auth-state').textContent).toBe('anonymous'));
});
