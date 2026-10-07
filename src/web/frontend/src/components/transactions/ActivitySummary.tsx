import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { briefingApi, formatMoney } from '@/api/briefing';
import { StatTiles } from '@/components/ui/detail-panel';
import { PageCard } from '@/components/ui/cards';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { MiniBarChart } from '@/components/charts/MiniBarChart';
import { RankedBar } from '@/components/explore/RecurringCharges';
import { datesInRange, getCategoryColor } from '@/lib/utils';

// Activity's detail pane before a purchase is chosen (desktop pass,
// 2026-10-07): this month so far from the shared spending facts, instead of
// an empty "choose a transaction" pane. It always covers the whole month, so
// it says so when the list is narrowed by a view, search or filter.
export function ActivitySummary({ filtered }: { filtered: boolean }) {
  const facts = useQuery({ queryKey: ['explore-month-facts'], queryFn: () => briefingApi.month() });
  const period = facts.data?.current;
  const enabled = !!period;
  const daily = useQuery({ queryKey: ['home-daily-totals', period?.start, period?.end], queryFn: () => api.getDailyTotalsV2(period!.start, period!.end), enabled });
  const categories = useQuery({ queryKey: ['home-category-breakdown', period?.start, period?.end], queryFn: () => api.getCategoryBreakdownV2(period!.start, period!.end), enabled });
  const merchants = useQuery({ queryKey: ['explore-merchants-by-category', '', period?.start, period?.end], queryFn: () => api.getMerchantRankingFactsV2(period!.start, period!.end, undefined, 10), enabled });

  if (facts.isError && !facts.data) return <div className="p-6"><LoadFailed onRetry={() => void facts.refetch()} /></div>;
  if (!facts.data || !period) {
    return <div role="status" className="space-y-4 p-6"><span className="sr-only">Loading this month…</span><Skeleton className="h-8 w-48" /><Skeleton className="h-20 w-full rounded-group" /><Skeleton className="h-48 w-full rounded-group" /></div>;
  }

  const month = new Date(`${period.start}T00:00:00Z`).toLocaleDateString('en-SG', { month: 'long', timeZone: 'UTC' });
  // The API lists days newest first and omits empty days; the chart needs every day so far, in order.
  const days = datesInRange(period.start, facts.data.as_of).map((date) => {
    const found = daily.data?.find((d) => d.date === date);
    return { day: String(Number(date.slice(8))), date, amount: found ? found.spending.minor_units / 100 : 0 };
  });
  const biggest = days.reduce((top, d) => (d.amount > top.amount ? d : top), days[0]);
  const perDay = days.length ? period.spending.minor_units / days.length : 0;
  const categoryRows = Object.entries(categories.data?.by_category ?? {}).sort((a, b) => b[1].minor_units - a[1].minor_units).slice(0, 5);
  const categoryMax = categoryRows[0]?.[1].minor_units ?? 0;
  const merchantRows = (merchants.data ?? []).slice(0, 5);
  const merchantMax = merchantRows[0]?.total.minor_units ?? 0;

  return (
    <div className="space-y-5 p-6">
      <div className="space-y-1">
        <h2 className="font-display text-xl font-bold tracking-[-0.01em]">{month} so far</h2>
        <p className="text-sm text-muted">
          {period.transaction_count} {period.transaction_count === 1 ? 'purchase' : 'purchases'}
          {filtered && ` · covers all of ${month}; the list is narrowed`}
        </p>
      </div>
      <StatTiles columns={3} items={[
        { label: 'Spent', value: formatMoney(period.spending), color: 'var(--color-tangerine)' },
        { label: 'Average a day', value: formatMoney({ ...period.spending, minor_units: Math.round(perDay) }) },
        { label: biggest && biggest.amount > 0 ? `Biggest day · ${biggest.day} ${month.slice(0, 3)}` : 'Biggest day', value: biggest ? formatMoney({ minor_units: Math.round(biggest.amount * 100), currency: 'SGD' }) : '—' },
      ]} />
      <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
        <MiniBarChart title="By day" data={days} xKey="day" valueKey="amount" valueLabel="Spent" />
        <div className="space-y-5">
          <PageCard title="By category">
            {categoryRows.length
              ? categoryRows.map(([name, amount]) => <RankedBar key={name} label={name} value={amount.minor_units} max={categoryMax} color={getCategoryColor(name)} />)
              : <p className="text-sm text-muted">No spending yet this month.</p>}
          </PageCard>
          {!!merchantRows.length && (
            <PageCard title="Top merchants">
              {merchantRows.map((m) => <RankedBar key={m.merchant} label={m.merchant} value={m.total.minor_units} max={merchantMax} />)}
            </PageCard>
          )}
        </div>
      </div>
      <p className="text-center text-xs text-muted">Choose a purchase to see its details. ↑ and ↓ move through the list; Esc comes back here.</p>
    </div>
  );
}
