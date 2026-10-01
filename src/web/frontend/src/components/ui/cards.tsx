import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── PageCard ──────────────────────────────────────────────────────────────────
interface PageCardProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  headerClassName?: string;
}

export function PageCard({ title, action, children, className, contentClassName, headerClassName }: PageCardProps) {
  // Direction B (P4, 2026-10-01): a titled group. The heading sits above a
  // borderless 18px group surface, matching ListGroup, so a page reads as
  // one system whether a section holds rows or free content. Layout classes
  // apply to the whole section; the surface stretches to fill a grid cell.
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn('flex min-w-0 flex-col', className)}>
      <div className={cn('mb-1.5 flex items-baseline justify-between gap-2 px-1', headerClassName)}>
        <h2 id={headingId} className="min-w-0 font-display text-lg font-bold tracking-[-0.01em] text-foreground">{title}</h2>
        {action && <div className="ml-2 shrink-0 text-sm">{action}</div>}
      </div>
      <div className="@container flex-1 overflow-hidden rounded-group bg-card text-foreground">
        <div className={cn('p-4', contentClassName)}>{children}</div>
      </div>
    </section>
  );
}

// ── ChartCard ─────────────────────────────────────────────────────────────────
// A PageCard whose content runs edge to edge (charts size themselves).
export function ChartCard(props: Omit<PageCardProps, 'contentClassName'>) {
  return <PageCard {...props} contentClassName="p-0" />;
}

// ── CardLink ──────────────────────────────────────────────────────────────────
// Approved shared owner (2026-09-25, Explore dashboard): makes a whole card a
// navigation target — chevron top-right, hover lift, focus ring. Wrap exactly
// one card surface (StatCard via its `href`, PageCard, HighlightCard). The
// wrapped card must not contain other links or controls.
interface CardLinkProps {
  to: string;
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}

export function CardLink({ to, children, className, ...props }: CardLinkProps) {
  return (
    <Link
      to={to}
      aria-label={props['aria-label']}
      className={cn(
        'card-link group relative block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      {children}
      <ChevronRight
        aria-hidden="true"
        className="absolute top-4 right-4 w-4 h-4 text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-foreground"
      />
    </Link>
  );
}
