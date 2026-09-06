import { NavLink, Outlet } from 'react-router-dom';

export function ExplorePage() {
  return (
    <section className="explore-page">
      <header className="px-4 pt-4 md:px-6 md:pt-6">
        <h1 className="text-2xl font-semibold">Explore</h1>
        <p className="text-muted mt-1">Understand spending patterns and the merchants behind them.</p>
        <nav aria-label="Explore views" className="flex gap-2 mt-3">
          {[['/explore', 'Spending patterns'], ['/explore/merchants', 'Merchants']].map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/explore'} className={({ isActive }) => `min-h-11 inline-flex items-center px-3 rounded-lg focus-visible:outline-2 focus-visible:outline-ring ${isActive ? 'bg-foreground/10 font-medium' : 'text-muted hover:text-foreground'}`}>{label}</NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </section>
  );
}
