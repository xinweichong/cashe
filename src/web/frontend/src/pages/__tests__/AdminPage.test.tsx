import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminPage } from '../AdminPage';

const users = [
  { username: 'alex', gmail_connected: true, telegram_linked: false, onboarding_complete: true, created_at: '2026-09-01T00:00:00' },
  { username: 'sam', gmail_connected: false, telegram_linked: false, onboarding_complete: false, created_at: '2026-09-20T00:00:00' },
];

const json = (body: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 400, json: () => Promise.resolve(body) } as Response);
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn((url: string, opts?: RequestInit) => {
    const method = opts?.method ?? 'GET';
    if (url.endsWith('/login')) return json({ status: 'ok', token: 't' });
    if (url.endsWith('/users') && method === 'GET') return json(users);
    if (url.endsWith('/users') && method === 'POST') return json({ status: 'ok', username: 'new', password: 'Temp-Pass-1', reminder: 'Shown once.' });
    if (url.includes('/reset-password')) return json({ status: 'ok' });
    if (method === 'DELETE') return json({ status: 'ok' });
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function signIn() {
  render(<MemoryRouter><AdminPage /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Admin password'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { level: 1, name: 'Admin' });
}

test('signs in and lists users as rows with their status', async () => {
  await signIn();
  const list = await screen.findByRole('region', { name: '2 users' });
  expect(within(list).getByText('alex')).toBeTruthy();
  expect(within(list).getByText('Gmail · No Telegram · Onboarded')).toBeTruthy();
});

test('a selected user shows status and account actions; reset needs 8+ characters', async () => {
  await signIn();
  fireEvent.click(await screen.findByRole('button', { name: /^sam/ }));
  expect(await screen.findByRole('heading', { name: 'sam' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
  const reset = await screen.findByRole('button', { name: 'Reset' }) as HTMLButtonElement;
  expect(reset.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  expect(reset.disabled).toBe(false);
  fireEvent.click(reset);
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/users/sam/reset-password'))).toBe(true));
});

test('adding an account shows the temporary password once', async () => {
  await signIn();
  fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'New' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  expect(await screen.findByText('Temp-Pass-1')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Account created');
});

test('deleting an account asks first', async () => {
  await signIn();
  fireEvent.click(await screen.findByRole('button', { name: /^alex/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete account' }));
  expect(fetchMock.mock.calls.some(([, o]) => (o as RequestInit | undefined)?.method === 'DELETE')).toBe(false);
  const dialog = await screen.findByRole('dialog', { name: 'Delete alex?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete account' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([, o]) => (o as RequestInit | undefined)?.method === 'DELETE')).toBe(true));
});
