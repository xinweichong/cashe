import { Outlet, useLocation } from 'react-router-dom';
import { useIsPhone } from '@/hooks/useIsPhone';

export function ExplorePage() {
  // On a phone the patterns index is one fixed screen, so its heading stays
  // for assistive tech only; drill-down routes keep the visible header.
  const isPhone = useIsPhone();
  const { pathname } = useLocation();
  const phoneIndex = isPhone && /^\/explore\/?$/.test(pathname);
  return (
    <section className="explore-page">
      <header className={phoneIndex ? 'sr-only' : 'px-4 pt-4 md:px-6 md:pt-6'}>
        <div className="text-xs uppercase tracking-[0.22em] text-muted font-mono font-semibold">Explore</div>
        <h1 className="text-xl font-bold leading-tight tracking-tight text-foreground font-display">Every pattern, caught.</h1>
        <p className="text-muted mt-1">How this month is going, what stands out, and the patterns behind it.</p>
      </header>
      <Outlet />
    </section>
  );
}
