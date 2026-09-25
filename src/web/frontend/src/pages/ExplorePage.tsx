import { NavLink, Outlet } from 'react-router-dom';
import { routeTabClassName } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export function ExplorePage() {
  return (
    <section className="explore-page">
      <header className="px-4 pt-4 md:px-6 md:pt-6">
        <div className="text-xs uppercase tracking-[0.22em] text-muted font-mono font-semibold">Explore</div>
        <h1 className="text-xl font-bold leading-tight tracking-tight text-foreground font-display">Every pattern, caught.</h1>
        <p className="text-muted mt-1">Understand spending patterns and the merchants behind them.</p>
        <nav aria-label="Explore views" className="flex gap-2 mt-3 overflow-x-auto scroll-strip">
          {[['/explore', 'Spending patterns'], ['/explore/insights', 'Insights']].map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/explore'}
              className={cn(routeTabClassName, 'min-h-11')}
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </section>
  );
}
