import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { briefingApi, type EvidenceItem } from '@/api/briefing';
import { EvidencePage } from '../EvidencePage';

vi.mock('@/api/briefing', async (original) => ({ ...await original<typeof import('@/api/briefing')>(), briefingApi: { evidence: vi.fn() } }));

const items: EvidenceItem[] = [
  { id: 1, merchant: 'FairPrice', category: 'Food & Drink', type: 'expense', date: '2026-09-05', amount: { minor_units: 1250, currency: 'SGD' }, conversion_status: 'native' },
  { id: 2, merchant: null, category: 'Transport', type: 'expense', date: null, amount: null, conversion_status: 'indicative' },
];

function show(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <EvidencePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(briefingApi.evidence).mockResolvedValue({ items, total: 2, limit: 50, offset: 0 });
});
afterEach(cleanup);

test('Evidence renders supporting records through the shared activity row shell', async () => {
  show('/evidence?start=2026-09-01&end=2026-09-06&category=Food');
  expect(await screen.findByText('FairPrice')).toBeTruthy();
  expect(screen.getByText('Unnamed transaction')).toBeTruthy();
  expect(screen.getByText('$12.50')).toBeTruthy();
  expect(screen.getByText('Amount unresolved')).toBeTruthy();
  expect(screen.getByText('Indicative conversion')).toBeTruthy();
});

test('Evidence rows link to the transaction with a returnTo back to this exact evidence query', async () => {
  show('/evidence?start=2026-09-01&end=2026-09-06&category=Food');
  const link = await screen.findByRole('link', { name: /FairPrice/ });
  const href = link.getAttribute('href')!;
  expect(href.startsWith('/transactions/1?returnTo=')).toBe(true);
  const returnTo = decodeURIComponent(href.split('returnTo=')[1]);
  expect(returnTo).toContain('/evidence?');
  expect(returnTo).toContain('start=2026-09-01');
  expect(returnTo).toContain('category=Food');
});

test('Back returns to a safe internal returnTo and is not sent to the evidence API', async () => {
  show('/evidence?start=2026-09-01&end=2026-09-06&category=Food&returnTo=%2Fhome%3Fcategory%3DFood');
  await screen.findByText('FairPrice');
  expect(screen.getByRole('link', { name: 'Back to briefing' }).getAttribute('href')).toBe('/home?category=Food');
  const sent = vi.mocked(briefingApi.evidence).mock.calls[0][0] as URLSearchParams;
  expect(sent.has('returnTo')).toBe(false);
});

test('an off-site returnTo falls back to the briefing', async () => {
  show('/evidence?start=2026-09-01&end=2026-09-06&returnTo=%2F%2Fevil.example');
  await screen.findByText('FairPrice');
  expect(screen.getByRole('link', { name: 'Back to briefing' }).getAttribute('href')).toBe('/home');
});
