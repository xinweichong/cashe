import { test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommandPalette } from '../CommandPalette';

// jsdom lacks ResizeObserver and scrollIntoView, both of which cmdk uses internally.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

vi.mock('@/api/client', () => ({
  api: { getMerchants: vi.fn().mockResolvedValue(['Toast Box']) },
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{location.pathname}</div>;
}

function renderPalette() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <CommandPalette />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

test('opens with Cmd+K and navigates on select', async () => {
  renderPalette();
  expect(screen.queryByPlaceholderText('Jump to…')).toBeNull();
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  expect(await screen.findByPlaceholderText('Jump to…')).toBeTruthy();
  fireEvent.click(screen.getByText('Activity'));
  await waitFor(() =>
    expect(screen.getByTestId('loc').textContent).toBe('/activity')
  );
});

test('lists merchants and navigates to the profile', async () => {
  renderPalette();
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  fireEvent.click(await screen.findByText('Toast Box'));
  await waitFor(() =>
    expect(screen.getByTestId('loc').textContent).toBe('/explore/merchants/Toast%20Box')
  );
});
