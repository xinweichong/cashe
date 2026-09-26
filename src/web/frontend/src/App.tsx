import { MotionConfig } from 'framer-motion';
import { ThemeProvider } from '@/hooks/ThemeProvider';
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { AuthProvider } from '@/hooks/useAuth';
import { useAuth } from '@/hooks/useAuthContext';
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

// A lazy route that can start downloading before it renders. If its chunk
// has already arrived when a route mounts, it renders directly instead of
// suspending — avoiding React's 300ms minimum fallback before revealing
// content that suspended. Each mount keeps the component it started with,
// so a page never remounts when the chunk resolves.
function lazyRoute(load: () => Promise<ComponentType>) {
  let resolved: ComponentType | null = null;
  let pending: Promise<void> | null = null;
  const preload = () => (pending ??= load().then(
    (component) => { resolved = component; },
    (error) => { pending = null; throw error; },
  ));
  const Lazy = lazy(() => preload().then(() => ({ default: resolved! })));
  function Route() {
    const [Component] = useState(() => resolved ?? Lazy);
    return <Component />;
  }
  return Object.assign(Route, { preload });
}

const PlanPage = lazyRoute(() => import('@/pages/PlanPage').then(m => m.PlanPage));
const HomePage = lazyRoute(() => import('@/pages/HomePage').then(m => m.HomePage));
const EvidencePage = lazyRoute(() => import('@/pages/EvidencePage').then(m => m.EvidencePage));
const ReviewPage = lazyRoute(() => import('@/pages/ReviewPage').then(m => m.ReviewPage));
const TransactionsPage = lazyRoute(() => import('@/pages/TransactionsPage').then(m => m.TransactionsPage));
const ExplorePatternsPage = lazyRoute(() => import('@/pages/ExplorePatternsPage').then(m => m.ExplorePatternsPage));
const ExploreSignalsPage = lazyRoute(() => import('@/pages/ExploreDetailPages').then(m => m.ExploreSignalsPage));
const ExploreHealthPage = lazyRoute(() => import('@/pages/ExploreDetailPages').then(m => m.ExploreHealthPage));
const SettingsPage = lazyRoute(() => import('@/pages/SettingsPage').then(m => m.SettingsPage));
const MerchantsPage = lazyRoute(() => import('@/pages/MerchantsPage').then(m => m.MerchantsPage));
const OnboardingPage = lazy(() => import('@/pages/OnboardingPage').then(m => ({ default: m.OnboardingPage })));
const AdminPage = lazy(() => import('@/pages/AdminPage').then(m => ({ default: m.AdminPage })));
const SetPasswordPage = lazy(() => import('@/pages/SetPasswordPage').then(m => ({ default: m.SetPasswordPage })));
const DevPreviewPage = import.meta.env.DEV
  ? lazy(() => import('@/dev/DevPreviewPage').then(m => ({ default: m.DevPreviewPage })))
  : null;
const HomePrototype = import.meta.env.DEV
  ? lazy(() => import('@/dev/HomePrototype').then(m => ({ default: m.HomePrototype })))
  : null;
const ExploreLayoutStudy = import.meta.env.DEV
  ? lazy(() => import('@/dev/ExploreLayoutStudy').then(m => ({ default: m.ExploreLayoutStudy })))
  : null;
const PlanLayoutStudy = import.meta.env.DEV
  ? lazy(() => import('@/dev/PlanLayoutStudy').then(m => ({ default: m.PlanLayoutStudy })))
  : null;

// Start the current URL's route chunk alongside the auth requests rather
// than after them.
const ROUTE_PRELOADS: [RegExp, Array<{ preload: () => Promise<void> }>][] = [
  [/^\/$/, [HomePage]],
  [/^\/home\/?$/, [HomePage]],
  [/^\/(activity|transactions)(\/|$)/, [TransactionsPage]],
  [/^\/plan(\/|$)/, [PlanPage]],
  [/^\/explore\/merchants(\/|$)/, [MerchantsPage]],
  [/^\/explore\/?$/, [ExplorePatternsPage]],
  [/^\/explore\/signals\/?$/, [ExploreSignalsPage]],
  [/^\/explore\/health\/?$/, [ExploreHealthPage]],
  [/^\/evidence(\/|$)/, [EvidencePage]],
  [/^\/review(\/|$)/, [ReviewPage]],
  [/^\/settings(\/|$)/, [SettingsPage]],
  [/^\/analytics(\/|$)/, [ExplorePatternsPage]],
  [/^\/merchants(\/|$)/, [MerchantsPage]],
  [/^\/finance(\/|$)/, [PlanPage]],
];
if (typeof window !== 'undefined') {
  const match = ROUTE_PRELOADS.find(([pattern]) => pattern.test(window.location.pathname));
  // A failed preload is retried by the route itself when it renders.
  match?.[1].forEach((route) => route.preload().catch(() => {}));
}

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
  const { isLoading: settingsLoading } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings, enabled: isAuthenticated });

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
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="overview" element={<LegacyRedirect from="/overview" to="/" />} />
          <Route path="activity" element={<TransactionsPage />} />
          <Route path="activity/:transactionId" element={<TransactionsPage />} />
          <Route path="plan" element={<PlanPage />} />
          <Route path="plan/manage" element={<LegacyRedirect from="/plan/manage" to="/plan" />} />
          <Route path="explore" element={<ExplorePage />}>
            <Route index element={<ExplorePatternsPage />} />
            <Route path="insights" element={<LegacyRedirect from="/explore/insights" to="/explore" />} />
            <Route path="signals" element={<ExploreSignalsPage />} />
            <Route path="health" element={<ExploreHealthPage />} />
            <Route path="merchants" element={<MerchantsPage />} />
            <Route path="merchants/:merchantName" element={<MerchantsPage />} />
          </Route>
          <Route path="home" element={<HomePage />} />
          <Route path="evidence" element={<EvidencePage />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="transactions" element={<LegacyRedirect from="/transactions" to="/activity" />} />
          <Route path="transactions/:transactionId" element={<LegacyRedirect from="/transactions" to="/activity" />} />
          <Route path="analytics" element={<LegacyRedirect from="/analytics" to="/explore" />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="merchants" element={<LegacyRedirect from="/merchants" to="/explore/merchants" />} />
          <Route path="merchants/:merchantName" element={<LegacyRedirect from="/merchants" to="/explore/merchants" />} />
          <Route path="finance" element={<LegacyRedirect from="/finance" to="/plan" />} />
          <Route path="trips" element={<Navigate to="/plan" replace />} />
        </Route>
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
    <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Suspense fallback={<SplashScreen />}>
            <Routes>
              {/* Admin routes bypass the regular user auth flow entirely */}
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/admin/*" element={<AdminPage />} />
              {/* Dev-only, auth-free visual harness for shared primitives — never registered in a production build */}
              {DevPreviewPage && <Route path="/dev/preview" element={<DevPreviewPage />} />}
              {HomePrototype && <Route path="/dev/preview/home" element={<HomePrototype />} />}
              {ExploreLayoutStudy && <Route path="/dev/preview/explore" element={<ExploreLayoutStudy />} />}
              {PlanLayoutStudy && <Route path="/dev/preview/plan" element={<PlanLayoutStudy />} />}
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
    </ThemeProvider>
    </MotionConfig>
  );
}
