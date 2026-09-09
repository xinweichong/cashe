import { test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastProvider } from '../toast';
import { useToast } from '@/hooks/useToastContext';

function Trigger({ message }: { message: string }) {
  const toast = useToast();
  return <button onClick={() => toast(message)}>{`show ${message}`}</button>;
}

test('shows a toast with status role', () => {
  render(
    <ToastProvider>
      <Trigger message="Captured." />
    </ToastProvider>
  );
  fireEvent.click(screen.getByText('show Captured.'));
  expect(screen.getByRole('status').textContent).toBe('Captured.');
});

test('a new toast replaces the current one — never stacks', () => {
  render(
    <ToastProvider>
      <Trigger message="Saved." />
      <Trigger message="Deleted." />
    </ToastProvider>
  );
  fireEvent.click(screen.getByText('show Saved.'));
  fireEvent.click(screen.getByText('show Deleted.'));
  const statuses = screen.getAllByRole('status');
  expect(statuses).toHaveLength(1);
  expect(statuses[0].textContent).toBe('Deleted.');
});
