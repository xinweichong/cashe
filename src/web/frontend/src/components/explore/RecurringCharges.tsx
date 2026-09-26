import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { formatMoney, type Money } from '@/api/briefing';
import { PageCard } from '@/components/ui/cards';
import { formatChange } from '@/components/explore/format';
import { QueryState } from '@/components/ui/QueryState';

// Shared by Explore's patterns and Plan's phone Subs lens (recurring cost
// changes live with subscriptions on the phone).

export function RankedBar({ label, value, max, href, secondaryHref, secondaryLabel, color, display }: {
  label: string; value: number; max: number; href?: string; secondaryHref?: string; secondaryLabel?: string;
  /** Bar fill; defaults to the brand teal. Pass a category colour when the row is a category. */
  color?: string;
  /** Right-hand figure; defaults to the value as SGD money. */
  display?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((Math.abs(value) / max) * 100)) : 0;
  return (
    <div className="py-1">
      <div className="flex justify-between gap-4 text-sm items-center">
        <span className="flex flex-wrap items-center gap-x-3 min-w-0">
          {href ? <Link to={href} className="hover:underline inline-flex items-center min-h-11">{label}</Link> : <span className="inline-flex items-center min-h-11">{label}</span>}
          {secondaryHref && <Link to={secondaryHref} className="text-xs text-teal underline inline-flex items-center min-h-11">{secondaryLabel ?? 'Profile'}</Link>}
        </span>
        <span className="tabular-nums font-mono">{display ?? formatMoney({ minor_units: value, currency: 'SGD' })}</span>
      </div>
      <div className="h-2 rounded bg-foreground/10 mt-1 overflow-hidden">
        <div className={color ? 'h-full' : 'h-full bg-teal'} style={{ width: `${pct}%`, ...(color ? { backgroundColor: color } : {}) }} />
      </div>
    </div>
  );
}

export function QuestionCard({ title, isError, onRetry, isReady, children, action }: { title: string; isError: boolean; onRetry: () => void; isReady: boolean; children: React.ReactNode; action?: React.ReactNode }) {
  // A background refetch failure must not hide already-known-good data behind
  // an error screen — only show LoadFailed when there is nothing to show yet.
  return (
    <PageCard title={title} action={action}>
      <QueryState data={isReady ? true : null} isError={isError} onRetry={onRetry}>{() => children}</QueryState>
    </PageCard>
  );
}

export function RecurringCharges() {
  const { data, isError, refetch } = useQuery({ queryKey: ['explore-subscription-review'], queryFn: () => api.getSubscriptionReviewV2() });
  const max = Math.max(1, ...(data?.price_changes ?? []).map(c => Math.abs(c.change.minor_units)));
  const empty = data && !data.price_changes.length && !data.overdue.length && !data.annual_renewals.length;
  const column = (heading: string, children: React.ReactNode) => (
    <section className="space-y-1 min-w-0">
      <h3 className="text-sm font-semibold pb-1">{heading}</h3>
      {children}
    </section>
  );
  return (
    <QuestionCard title="Recurring charges" isError={isError} onRetry={() => void refetch()} isReady={!!data}
      action={<Link to="/plan" className="text-sm text-teal min-h-11 inline-flex items-center">Upcoming in Plan</Link>}>
      {empty ? <p className="text-muted">No recurring cost changes to review. Price changes, schedules that may have stopped, and annual renewals appear here.</p> : data && (
        <div className="grid gap-6 md:grid-cols-3">
          {column('Price changes', data.price_changes.length
            ? data.price_changes.map(c => <RankedBar key={c.subscription_id} label={c.label} value={c.change.minor_units} max={max} display={formatChange(c.change as Money)} href={`/plan?subscription=${c.subscription_id}`} />)
            : <p className="text-sm text-muted">No price changes.</p>)}
          {column('Possibly stopped', data.overdue.length
            ? data.overdue.map(o => <Link key={o.subscription_id} to={`/plan?subscription=${o.subscription_id}`} className="flex justify-between gap-3 text-sm min-h-11 items-center hover:underline"><span className="truncate">{o.label}</span><span className="text-muted font-mono tabular-nums shrink-0">{o.days_since_last_charge}d ago</span></Link>)
            : <p className="text-sm text-muted">Every schedule charged on time.</p>)}
          {column('Renewing soon', data.annual_renewals.length
            ? data.annual_renewals.map(r => <Link key={r.subscription_id} to={`/plan?subscription=${r.subscription_id}`} className="flex justify-between gap-3 text-sm min-h-11 items-center hover:underline"><span className="truncate">{r.label}</span><span className="text-muted font-mono tabular-nums shrink-0">in {r.days_until_renewal}d</span></Link>)
            : <p className="text-sm text-muted">No annual renewals coming up.</p>)}
        </div>
      )}
    </QuestionCard>
  );
}

