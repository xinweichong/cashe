import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { briefingApi, formatMoney } from '@/api/briefing';
import { CardLink, PageCard } from '@/components/ui/cards';
import { ActivityRowShell } from '@/components/ui/ActivityRowShell';
import { Badge } from '@/components/ui/badge';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatShortDate } from '@/lib/utils';

/**
 * The full list at /explore/signals: month-to-date charges well above what
 * the merchant usually costs, and merchants recorded for the first time,
 * each opening its transaction.
 */
export function WorthALookCard() {
  const location = useLocation();
  const { data, isError, refetch } = useQuery({ queryKey: ['explore-signals'], queryFn: () => briefingApi.signals() });
  const transactionLink = (id: number) => `/activity/${id}?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
  const count = data ? data.unusual.length + data.new_merchants.length : 0;

  return (
    <PageCard
      title="Worth a look"
      contentClassName="p-0"
      action={count > 0 && <Badge tone="notable">{count}</Badge>}
    >
      {isError && !data ? (
        <div role="alert" className="p-4 pt-0"><LoadFailed onRetry={() => void refetch()} /></div>
      ) : !data ? (
        <div role="status" className="p-4 pt-0"><span className="sr-only">Loading…</span><Skeleton className="h-24 w-full" /></div>
      ) : !count ? (
        <p className="text-sm text-muted px-4 pb-4">
          Nothing stands out so far this month. Charges well above a merchant's usual amount, and places you have not paid before, will show up here.
        </p>
      ) : (
        <div>
          {!!data.unusual.length && (
            <section aria-labelledby="worth-unusual">
              <h3 id="worth-unusual" className="px-4 pb-2 text-sm font-semibold">Larger than usual</h3>
              {data.unusual.map((item) => (
                <ActivityRowShell
                  key={item.transaction_id}
                  category={item.category}
                  href={transactionLink(item.transaction_id)}
                  title={item.merchant}
                  metaPrimary={`${formatShortDate(item.date)} · usually ${formatMoney(item.typical)}`}
                  amount={formatMoney(item.amount)}
                  amountSub={<span className="text-coral">{item.ratio}× usual</span>}
                />
              ))}
            </section>
          )}
          {!!data.new_merchants.length && (
            <section aria-labelledby="worth-new" className={data.unusual.length ? 'pt-3' : undefined}>
              <h3 id="worth-new" className="px-4 pb-2 text-sm font-semibold">First time here</h3>
              {data.new_merchants.map((item) => (
                <ActivityRowShell
                  key={item.merchant}
                  category={item.category}
                  href={transactionLink(item.transaction_id)}
                  title={item.merchant}
                  metaPrimary={`First paid ${formatShortDate(item.first_date)}`}
                  amount={item.amount ? formatMoney(item.amount) : 'Amount unresolved'}
                />
              ))}
            </section>
          )}
          <p className="px-4 py-3 text-xs text-muted border-t border-border/50">
            "Larger than usual" means over {data.multiplier}× your average at that merchant before this month. Change the threshold in <Link to="/settings" className="text-teal underline-offset-2 hover:underline">Settings</Link>.
          </p>
        </div>
      )}
    </PageCard>
  );
}

const SUMMARY_ROWS = 3;

/**
 * Dashboard summary: the first three signals as plain rows, the whole card
 * opening the full list at /explore/signals.
 */
export function WorthALookSummary({ className }: { className?: string }) {
  const { data, isError, refetch } = useQuery({ queryKey: ['explore-signals'], queryFn: () => briefingApi.signals() });
  if (isError && !data) {
    return <PageCard title="Worth a look" className={className}><div role="alert"><LoadFailed onRetry={() => void refetch()} /></div></PageCard>;
  }
  if (!data) {
    return <PageCard title="Worth a look" className={className}><div role="status"><span className="sr-only">Loading…</span><Skeleton className="h-24 w-full" /></div></PageCard>;
  }
  const rows = [
    ...data.unusual.map((item) => ({
      key: `u${item.transaction_id}`, category: item.category, title: item.merchant,
      meta: `${formatShortDate(item.date)} · usually ${formatMoney(item.typical)}`,
      amount: formatMoney(item.amount), sub: <span className="text-coral">{item.ratio}× usual</span>,
    })),
    ...data.new_merchants.map((item) => ({
      key: `n${item.transaction_id}`, category: item.category, title: item.merchant,
      meta: `First time here · ${formatShortDate(item.first_date)}`,
      amount: item.amount ? formatMoney(item.amount) : 'Amount unresolved', sub: undefined,
    })),
  ];
  if (!rows.length) {
    return (
      <PageCard title="Worth a look" className={className}>
        <p className="text-sm text-muted">Nothing stands out so far this month. Charges well above a merchant's usual amount, and places you have not paid before, will show up here.</p>
      </PageCard>
    );
  }
  return (
    <CardLink to="/explore/signals" className={cn('rounded-md', className)} aria-label={`Worth a look: ${rows.length} ${rows.length === 1 ? 'item' : 'items'} this month. Open the full list.`}>
      <PageCard
        title="Worth a look"
        className="h-full"
        headerClassName="pr-10"
        contentClassName="p-0"
        action={<Badge tone="notable">{rows.length}</Badge>}
      >
        {rows.slice(0, SUMMARY_ROWS).map((row) => (
          <ActivityRowShell key={row.key} category={row.category} title={row.title} metaPrimary={row.meta} amount={row.amount} amountSub={row.sub} />
        ))}
        {rows.length > SUMMARY_ROWS && (
          <p className="px-4 py-2.5 text-xs text-muted">{rows.length - SUMMARY_ROWS} more this month</p>
        )}
      </PageCard>
    </CardLink>
  );
}
