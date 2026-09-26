import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TransactionForm } from '../TransactionForm';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup() {
  const close = vi.fn();
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <TransactionForm categories={[]} onClose={close} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '12.50' } });
  return { ...view, close };
}

// The form also fetches /api/settings (trips gating) on mount — route that
// separately so the reject/resolve sequence below stays about the actual
// transaction POST, which is what these tests exercise.
function makeFetch(steps: Array<() => Promise<Response>>) {
  let i = 0;
  return vi.fn((url: unknown) => {
    if (typeof url === 'string' && url.startsWith('/api/settings')) {
      return Promise.resolve(new Response(JSON.stringify({ trips_enabled: false }), { status: 200 }));
    }
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    return step();
  });
}

function transactionCalls(fetch: ReturnType<typeof vi.fn>) {
  return fetch.mock.calls.filter(([url]) => typeof url === 'string' && !url.startsWith('/api/settings'));
}

test('lost response retries the same request header and fields, then closes on success', async () => {
  const fetch = makeFetch([
    () => Promise.reject(new TypeError('Network error')),
    () => Promise.resolve(new Response(JSON.stringify({ id: 1 }), { status: 200 })),
  ]);
  vi.stubGlobal('fetch', fetch);
  const { close } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Save was not confirmed');
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const calls = transactionCalls(fetch);
  const first = calls[0][1] as RequestInit;
  const second = calls[1][1] as RequestInit;
  expect((first.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^[a-f0-9-]{36}$/);
  expect(second.headers).toEqual(first.headers);
  expect(second.body).toEqual(first.body);
});

test('edits after uncertain save keep the key and explain conflicts; a new form gets a new key', async () => {
  const fetch = makeFetch([
    () => Promise.reject(new TypeError('Network error')),
    () => Promise.resolve(new Response('{}', { status: 409 })),
  ]);
  vi.stubGlobal('fetch', fetch);
  const view = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('alert');
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Check Activity'));
  expect(view.close).not.toHaveBeenCalled();
  const key = (index: number) => (transactionCalls(fetch)[index][1] as RequestInit & { headers: Record<string, string> }).headers['Idempotency-Key'];
  expect(key(1)).toBe(key(0));
  view.unmount();
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('alert');
  expect(key(2)).not.toBe(key(0));
});
