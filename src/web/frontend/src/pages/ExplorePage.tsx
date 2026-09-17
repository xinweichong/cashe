import { NavLink, Outlet } from 'react-router-dom';

export function ExplorePage() {
  return (
    <section className="explore-page">
      <header className="px-4 pt-4 md:px-6 md:pt-6">
        <div className="text-xs uppercase tracking-[0.22em] text-muted font-mono font-semibold">Explore</div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground font-display">Every pattern, caught.</h1>
        <p className="text-muted mt-1">Understand spending patterns and the merchants behind them.</p>
        <nav aria-label="Explore views" className="flex gap-2 mt-3">
          {[['/explore', 'Spending patterns'], ['/explore/insights', 'Insights']].map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/explore'} className={({ isActive }) => `min-h-11 inline-flex items-center px-3 rounded-sm focus-visible:outline-2 focus-visible:outline-ring ${isActive ? 'bg-teal/13 text-teal font-semibold' : 'text-muted hover:text-foreground'}`}>{label}</NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </section>
  );
}
