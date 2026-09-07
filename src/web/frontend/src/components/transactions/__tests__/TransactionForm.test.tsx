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

test('lost response retries the same request header and fields, then closes on success', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Network error'))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 1 }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const { close } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Save was not confirmed');
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const first = fetch.mock.calls[0][1] as RequestInit;
  const second = fetch.mock.calls[1][1] as RequestInit;
  expect((first.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^[a-f0-9-]{36}$/);
  expect(second.headers).toEqual(first.headers);
  expect(second.body).toEqual(first.body);
});

test('edits after uncertain save keep the key and explain conflicts; a new form gets a new key', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Network error'))
    .mockImplementation(() => Promise.resolve(new Response('{}', { status: 409 })));
  vi.stubGlobal('fetch', fetch);
  const view = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('alert');
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Check Activity'));
  expect(view.close).not.toHaveBeenCalled();
  const key = (index: number) => fetch.mock.calls[index][1].headers['Idempotency-Key'];
  expect(key(1)).toBe(key(0));
  view.unmount();
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('alert');
  expect(key(2)).not.toBe(key(0));
});
