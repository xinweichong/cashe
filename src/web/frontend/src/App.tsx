import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { LoginScreen } from '@/components/auth/LoginScreen';
import { ExplorePage } from '@/pages/ExplorePage';
import { LegacyRedirect } from '@/components/layout/LegacyRedirect';
import { AppShell } from '@/components/layout/AppShell';
import { SplashScreen } from '@/components/ui/SplashScreen';
import { api } from '@/api/client';
import { setCategoryColors, nearestSpectrum } from '@/lib/utils';
import { ToastProvider } from '@/components/ui/toast';
import { SPECTRUM_PALETTE } from '@/lib/chartTheme';

const HomePage = lazy(() => import('@/pages/HomePage').then(m => ({ default: m.HomePage })));
const EvidencePage = lazy(() => import('@/pages/EvidencePage').then(m => ({ default: m.EvidencePage })));
const ReviewPage = lazy(() => import('@/pages/ReviewPage').then(m => ({ default: m.ReviewPage })));
const OverviewPage = lazy(() => import('@/pages/OverviewPage').then(m => ({ default: m.OverviewPage })));
const TransactionsPage = lazy(() => import('@/pages/TransactionsPage').then(m => ({ default: m.TransactionsPage })));
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const MerchantsPage = lazy(() => import('@/pages/MerchantsPage').then(m => ({ default: m.MerchantsPage })));
const FinancePage = lazy(() => import('@/pages/FinancePage').then(m => ({ default: m.FinancePage })));
const OnboardingPage = lazy(() => import('@/pages/OnboardingPage').then(m => ({ default: m.OnboardingPage })));
const AdminPage = lazy(() => import('@/pages/AdminPage').then(m => ({ default: m.AdminPage })));
const SetPasswordPage = lazy(() => import('@/pages/SetPasswordPage').then(m => ({ default: m.SetPasswordPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: false,
    },
  },
});

async function snapCategoryColorsIfNeeded(
  categories: { name: string; color: string | null }[]
) {
  try {
    const settingsRes = await fetch('/api/settings');
    if (!settingsRes.ok) return;
    const settings = await settingsRes.json();
    if (settings.category_colors_snapped_v2 === 'true') return;

    // Backup current colors before snapping
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_colors_pre_v2: JSON.stringify(
          categories.reduce((acc, c) => ({ ...acc, [c.name]: c.color }), {} as Record<string, string | null>)
        ),
      }),
    });

    // Snap each non-spectrum custom color to its nearest spectrum match
    for (const cat of categories) {
      if (!cat.color) continue;
      if (SPECTRUM_PALETTE.includes(cat.color)) continue;
      const snapped = nearestSpectrum(cat.color);
      await fetch(`/api/categories/${encodeURIComponent(cat.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color: snapped }),
      });
    }

    // Mark as done so this never runs again
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_colors_snapped_v2: 'true' }),
    });
  } catch (err) {
    console.warn('[cashe] color snap migration failed:', err);
  }
}

function CategoryColorLoader() {
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.getCategories(),
  });
  useEffect(() => {
    if (categories) {
      setCategoryColors(categories);
      // Fire-and-forget: non-fatal, only runs once
      void snapCategoryColorsIfNeeded(categories);
    }
  }, [categories]);
  return null;
}

function AppContent() {
  const { isAuthenticated, loading } = useAuth();
  const { data: currentUser, isLoading: userLoading } = useCurrentUser();
  const { data: settings, isLoading: settingsLoading } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings, enabled: isAuthenticated });

  if (loading || (isAuthenticated && (userLoading || settingsLoading))) {
    return <SplashScreen />;
  }

  if (!isAuthenticated) return <LoginScreen />;

  // Forced password change gate (before onboarding)
  if (currentUser?.force_password_change) return <SetPasswordPage />;

  // Redirect to onboarding if not yet complete (and not already there)
  if (currentUser && !currentUser.onboarding_complete) {
    return (
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    );
  }

  return (
    <>
      <CategoryColorLoader />
      <Routes>
        {/* Dashboard routes */}
        <Route element={<AppShell newExperience={!!settings?.home_briefing_enabled} />}>
          <Route index element={settings?.home_briefing_enabled ? <HomePage /> : <OverviewPage />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="activity" element={<TransactionsPage />} />
          <Route path="activity/:transactionId" element={<TransactionsPage />} />
          <Route path="plan" element={<FinancePage />} />
          <Route path="explore" element={<ExplorePage />}>
            <Route index element={<AnalyticsPage />} />
            <Route path="merchants" element={settings?.home_briefing_enabled ? <LegacyRedirect from="/merchants" to="/explore/merchants" /> : <MerchantsPage />} />
            <Route path="merchants/:merchantName" element={settings?.home_briefing_enabled ? <LegacyRedirect from="/merchants" to="/explore/merchants" /> : <MerchantsPage />} />
          </Route>
          <Route path="home" element={<HomePage />} />
          <Route path="evidence" element={<EvidencePage />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="transactions" element={settings?.home_briefing_enabled ? <LegacyRedirect from="/transactions" to="/activity" /> : <TransactionsPage />} />
          <Route path="transactions/:transactionId" element={settings?.home_briefing_enabled ? <LegacyRedirect from="/transactions" to="/activity" /> : <TransactionsPage />} />
          <Route path="analytics" element={settings?.home_briefing_enabled ? <LegacyRedirect from="/analytics" to="/explore" /> : <AnalyticsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="merchants" element={settings?.home_briefing_enabled ? <LegacyRedirect from="/merchants" to="/explore/merchants" /> : <MerchantsPage />} />
          <Route path="merchants/:merchantName" element={settings?.home_briefing_enabled ? <LegacyRedirect from="/merchants" to="/explore/merchants" /> : <MerchantsPage />} />
          <Route path="finance" element={settings?.home_briefing_enabled ? <LegacyRedirect from="/finance" to="/plan" /> : <FinancePage />} />
          <Route path="trips" element={<Navigate to="/finance" replace />} />
        </Route>
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Suspense fallback={<SplashScreen />}>
            <Routes>
              {/* Admin routes bypass the regular user auth flow entirely */}
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/admin/*" element={<AdminPage />} />
              <Route
                path="*"
                element={
                  <AuthProvider>
                    <AppContent />
                  </AuthProvider>
                }
              />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
