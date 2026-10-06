import { Outlet, useLocation } from 'react-router-dom';
import { NavBar } from '@/components/ui/nav-bar';
import { useIsPhone } from '@/hooks/useIsPhone';

// Each Explore route's nav bar (P3, 2026-10-01): the index is a tab root with
// a large title; signals and health are pushed pages back to Explore.
// Merchants is a list with details and carries its own bar.
const PUSHED: Record<string, string> = { '/explore/signals': 'Worth a look', '/explore/health': 'Financial health' };

export function ExplorePage() {
  const isPhone = useIsPhone();
  const path = useLocation().pathname.replace(/\/$/, '');
  const pushed = PUSHED[path];
  return (
    <section>
      {/* On a phone the index is one screen and carries its own title (PhoneScreen). */}
      {path === '/explore' && !isPhone && <NavBar large title="Explore" />}
      {pushed && <NavBar title={pushed} back={{ label: 'Explore', to: '/explore' }} />}
      <Outlet />
    </section>
  );
}
