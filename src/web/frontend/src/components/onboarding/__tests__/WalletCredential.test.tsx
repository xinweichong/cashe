import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '@/api/client';
import { WalletCredential } from '../WalletCredential';

vi.mock('@/api/client', () => ({
  api: {
    getWalletConnection: vi.fn(),
    createWalletCredential: vi.fn(),
    revokeWalletCredential: vi.fn(),
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getWalletConnection).mockResolvedValue({ configured: false, required: false });
});

test('generates only on request, shows the header, and clears it on revocation', async () => {
  vi.mocked(api.createWalletCredential).mockResolvedValue({ token: 'synthetic-token' });
  vi.mocked(api.revokeWalletCredential).mockResolvedValue({ status: 'ok' });
  render(<WalletCredential />);
  const generate = await screen.findByRole('button', { name: 'Generate credential' });
  await waitFor(() => expect(generate.hasAttribute('disabled')).toBe(false));
  expect(api.createWalletCredential).not.toHaveBeenCalled();
  vi.mocked(api.getWalletConnection).mockResolvedValue({ configured: true, required: false });
  fireEvent.click(generate);
  expect(await screen.findByDisplayValue('Bearer synthetic-token')).toBeTruthy();
  vi.mocked(api.getWalletConnection).mockResolvedValue({ configured: false, required: true });
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke and pause capture' }));
  await waitFor(() => expect(screen.queryByDisplayValue('Bearer synthetic-token')).toBeNull());
  expect(await screen.findByText(/Wallet capture is paused/)).toBeTruthy();
});

test('failed status does not appear as an unprotected connection', async () => {
  vi.mocked(api.getWalletConnection).mockRejectedValue(new Error('offline'));
  render(<WalletCredential />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Generate credential' }).hasAttribute('disabled')).toBe(true);
  expect(screen.queryByText(/Your existing Shortcut keeps working/)).toBeNull();
});
