import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useParams, useLocation } from 'react-router-dom';

vi.mock('@/pages/PlanPage', () => ({ PlanPage: () => <div>plan-page</div> }));
vi.mock('@/pages/HomePage', () => ({ HomePage: () => <div>home-page</div> }));
vi.mock('@/pages/EvidencePage', () => ({ EvidencePage: () => <div>evidence-page</div> }));
vi.mock('@/pages/ReviewPage', () => ({ ReviewPage: () => <div>review-page</div> }));
vi.mock('@/pages/OverviewPage', () => ({ OverviewPage: () => <div>overview-page</div> }));
vi.mock('@/pages/TransactionsPage', () => ({ TransactionsPage: () => <div>transactions-page</div> }));
vi.mock('@/pages/AnalyticsPage', () => ({ AnalyticsPage: () => <div>analytics-page</div> }));
vi.mock('@/pages/SettingsPage', () => ({ SettingsPage: () => <div>settings-page</div> }));
vi.mock('@/pages/FinancePage', () => ({ FinancePage: () => <div>finance-page</div> }));
vi.mock('@/pages/OnboardingPage', () => ({ OnboardingPage: () => <div>onboarding-page</div> }));
vi.mock('@/pages/AdminPage', () => ({ AdminPage: () => <div>admin-page</div> }));
vi.mock('@/pages/SetPasswordPage', () => ({ SetPasswordPage: () => <div>set-password-page</div> }));
vi.mock('@/pages/MerchantsPage', () => ({
  MerchantsPage: () => {
    const { merchantName } = useParams();
    const location = useLocation();
    return <div>merchants-page:{merchantName ?? 'list'}:{location.search}</div>;
  },
}));
vi.mock('@/components/layout/AppShell', async () => {
  const { Outlet } = await import('react-router-dom');
  return { AppShell: () => <div><Outlet /></div> };
});

const mockUser = {
  username: 'tester',
  gmail_connected: false,
  telegram_chat_id: null,
  wants_gmail: false,
  wants_apple_wallet: false,
  onboarding_complete: true,
  force_password_change: false,
};

const mockSettings = {
  anomaly_multiplier: 2,
  velocity_alert_threshold: 2,
  budgets_enabled: true,
  goals_enabled: true,
  trips_enabled: true,
  subscriptions_enabled: true,
  recurring_enabled: true,
  home_briefing_enabled: true,
};

vi.mock('@/api/client', async (orig) => {
  const actual = await orig<typeof import('@/api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      ping: vi.fn().mockResolvedValue({ status: 'ok' }),
      getCurrentUser: vi.fn().mockResolvedValue(mockUser),
      getSettings: vi.fn().mockResolvedValue(mockSettings),
      getCategories: vi.fn().mockResolvedValue([]),
      logout: vi.fn().mockResolvedValue({ status: 'ok' }),
    },
  };
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

async function renderAppAt(path: string) {
  window.history.pushState({}, '', path);
  const { default: App } = await import('@/App');
  return render(<App />);
}

test('new /explore/merchants route renders the merchants page directly, without redirect mangling', async () => {
  await renderAppAt('/explore/merchants?start=2026-09-01');
  expect(await screen.findByText('merchants-page:list:?start=2026-09-01')).toBeTruthy();
});

test('new /explore/merchants/:merchantName route renders the merchant detail directly', async () => {
  await renderAppAt('/explore/merchants/Cafe');
  expect(await screen.findByText('merchants-page:Cafe:')).toBeTruthy();
});

test('old /merchants route redirects to /explore/merchants preserving suffix and query', async () => {
  await renderAppAt('/merchants/Toast%20Box?start=2026-09-01');
  expect(await screen.findByText('merchants-page:Toast Box:?start=2026-09-01')).toBeTruthy();
});
