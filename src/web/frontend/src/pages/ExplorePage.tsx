import { Outlet } from 'react-router-dom';

export function ExplorePage() {
  return (
    <section className="explore-page">
      <header className="px-4 pt-4 md:px-6 md:pt-6">
        <div className="text-xs uppercase tracking-[0.22em] text-muted font-mono font-semibold">Explore</div>
        <h1 className="text-xl font-bold leading-tight tracking-tight text-foreground font-display">Every pattern, caught.</h1>
        <p className="text-muted mt-1">How this month is going, what stands out, and the patterns behind it.</p>
      </header>
      <Outlet />
    </section>
  );
}
