import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { briefingApi, evidenceLink, formatMoney, type Money, type SpendingFacts } from '@/api/briefing';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/StatusDot';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { SelectableRow } from '@/components/ui/selectable-row';
import { PageCard } from '@/components/ui/cards';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CategoryChangeBars } from '@/components/charts/CategoryChangeBars';
import { CategoryDonut } from '@/components/charts/CategoryDonut';
import { CategoryTrendLine } from '@/components/charts/CategoryTrendLine';
import { IncomeExpenseBar } from '@/components/charts/IncomeExpenseBar';
import { BiggestMoverTile, PulseBand } from '@/components/explore/PulseBand';
import { DailyReadCard } from '@/components/explore/DailyReadCard';
import { WorthALookSummary } from '@/components/explore/WorthALookCard';
import { HealthScoreSummary } from '@/components/explore/HealthScoreCard';
import { formatChange, formatRange } from '@/components/explore/format';
import { datesInRange, formatShortDate, getCategoryColor } from '@/lib/utils';
import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { HeroCard } from '@/components/ui/cards';
import { HeroAmount } from '@/components/ui/HeroAmount';
import { PhoneScreen, type Lens } from '@/components/layout/PhoneScreen';
import { useIsPhone } from '@/hooks/useIsPhone';

const WEEKDAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

type Mode = 'over-time' | 'by-category' | 'by-merchant' | 'recurring';
const MODES: { value: Mode; label: string }[] = [
  { value: 'over-time', label: 'Over time' },
  { value: 'by-category', label: 'By category' },
  { value: 'by-merchant', label: 'By merchant' },
  { value: 'recurring', label: 'Recurring' },
];

// R10: merchant profiles are a drill-down reached from a question's evidence,
// not a primary Explore nav destination — no standalone "Merchants" tab.
function merchantProfileLink(merchant: string): string {
  return `/explore/merchants/${encodeURIComponent(merchant)}`;
}

function useMonthFacts() {
  return useQuery({ queryKey: ['explore-month-facts'], queryFn: () => briefingApi.month() });
}

function RankedBar({ label, value, max, href, secondaryHref, secondaryLabel, color, display }: {
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

function QuestionCard({ title, isError, onRetry, isReady, children, action }: { title: string; isError: boolean; onRetry: () => void; isReady: boolean; children: React.ReactNode; action?: React.ReactNode }) {
  // A background refetch failure must not hide already-known-good data behind
  // an error screen — only show LoadFailed when there is nothing to show yet.
  return (
    <PageCard title={title} action={action}>
      {isError && !isReady ? <div role="alert"><LoadFailed onRetry={onRetry} /></div> : !isReady ? <div role="status"><span className="sr-only">Loading…</span><Skeleton className="h-20 w-full" /></div> : children}
    </PageCard>
  );
}

function WhatChanged() {
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isError, refetch } = useMonthFacts();
  const drivers = data?.category_changes ?? [];
  const selectedDriver = drivers.find(d => d.category === selected);
  return (
    <>
      <QuestionCard title="What changed" isError={isError} onRetry={() => void refetch()} isReady={!!data}>
        <p className="text-sm text-muted mb-3">Change by category against the same days last month. Select a bar for its transactions.</p>
        {!drivers.length && <p className="text-muted">{data?.change ? 'No category spending changes this period.' : 'Resolve records needing attention to compare categories.'}</p>}
        {data && !!drivers.length && <CategoryChangeBars data={drivers.slice(0, 6)} selected={selected} onSelect={(c) => setSelected(selected === c ? null : c)} />}
        {data?.trip_drivers.map(t => <p key={t.trip_id} className="text-sm text-muted mt-2">Trip <Link className="underline" to={`/transactions?trip=${t.trip_id}`}>{t.name}</Link>: {formatChange(t.change)} vs. last period. {t.overlap_note}</p>)}
      </QuestionCard>
      {data && selectedDriver && (
        <PageCard
          title={selectedDriver.category}
          action={<Button type="button" variant="ghost" size="sm" onClick={() => setSelected(null)}>Clear selection</Button>}
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <StatusDot color={getCategoryColor(selectedDriver.category)} />
              <span className="text-sm font-medium">{formatChange(selectedDriver.change)} change</span>
            </div>
            <div className="flex gap-6">
              <Link className="text-teal underline min-h-11 inline-flex items-center" to={evidenceLink(data.comparison_current, selectedDriver.category)}>This period</Link>
              <Link className="text-teal underline min-h-11 inline-flex items-center" to={evidenceLink(data.previous, selectedDriver.category)}>Previous period</Link>
            </div>
          </div>
        </PageCard>
      )}
    </>
  );
}

const FREQUENCY_SENTENCE: Record<string, string> = {
  frequency: 'You bought more often; the typical purchase stayed about the same.',
  size: 'Purchases were bigger; you bought about as often.',
  mixed: 'You bought more often and the typical purchase changed too.',
  none: 'Visits and typical purchase size were steady.',
};

function WhatDroveIt() {
  const { data, isError, refetch } = useMonthFacts();
  const top = data?.top_category_driver;
  const freq = top?.frequency_driver;
  return (
    <QuestionCard title={top ? `What drove ${top.category}` : 'What drove the change'} isError={isError} onRetry={() => void refetch()} isReady={!!data}>
      {!top ? (
        <p className="text-sm text-muted">Nothing moved enough to explain yet. Once a category changes against last month, its main cause appears here.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-baseline gap-2">
            <StatusDot color={getCategoryColor(top.category)} />
            <span className="text-2xl font-bold font-display tabular-nums">{formatChange(top.change)}</span>
            <span className="text-sm text-muted">vs. last month</span>
          </div>
          {freq && (
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs text-muted">Purchases</dt>
                <dd className="font-mono tabular-nums text-sm mt-1">{freq.current_count} <span className="text-muted">vs. {freq.previous_count}</span></dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Typical purchase</dt>
                <dd className="font-mono tabular-nums text-sm mt-1">{formatMoney(freq.current_avg)} <span className="text-muted">vs. {formatMoney(freq.previous_avg)}</span></dd>
              </div>
            </dl>
          )}
          {freq && <p className="text-sm">{FREQUENCY_SENTENCE[freq.classification]}</p>}
          {top.merchant_driver && data && (
            <p className="text-sm text-muted">
              Biggest mover: <Link className="text-foreground underline" to={merchantProfileLink(top.merchant_driver.merchant)}>{top.merchant_driver.merchant}</Link> ({formatChange(top.merchant_driver.change)}). <Link className="text-teal underline" to={evidenceLink(data.comparison_current, top.category, 'spending', top.merchant_driver.merchant)}>View transactions</Link>
            </p>
          )}
          {top.one_off_driver && (
            <p className="text-sm text-muted">Largely one purchase: <Link className="text-foreground underline" to={`/transactions/${top.one_off_driver.transaction_id}`}>{top.one_off_driver.merchant || 'Unnamed transaction'}</Link>, {formatMoney(top.one_off_driver.amount)} on {formatShortDate(top.one_off_driver.date)}.</p>
          )}
        </div>
      )}
    </QuestionCard>
  );
}

function WhereItWent({ facts }: { facts: SpendingFacts | undefined }) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  const period = facts?.current;
  const { data, isError, refetch } = useQuery({
    queryKey: ['explore-breakdown', period?.start, period?.end],
    queryFn: () => api.getCategoryBreakdownV2(period!.start, period!.end),
    enabled: !!period,
  });
  const totals = data ? Object.entries(data.by_category).map(([category, amount]) => ({ category, total: amount.minor_units / 100 })) : [];
  return (
    <QuestionCard title="Where it went" isError={isError} onRetry={() => void refetch()} isReady={!!data}>
      <CategoryDonut
        data={totals}
        selected={selected}
        onSelect={setSelected}
        onViewTransactions={(category) => period && navigate(evidenceLink(period, category))}
        showLegend
      />
    </QuestionCard>
  );
}

function SpendingOverTime() {
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: () => api.getCategories() });
  const { data: monthFacts } = useQuery({ queryKey: ['explore-month-facts'], queryFn: () => briefingApi.month() });
  const [selected, setSelected] = useState<string[]>([]);
  const initialized = useRef(false);
  useEffect(() => {
    // Default to at most three selectable categories (the top movers this
    // period), once — later toggles are the user's own choice, not reset
    // by a subsequent refetch.
    if (!initialized.current && monthFacts?.category_changes.length) {
      initialized.current = true;
      setSelected(monthFacts.category_changes.slice(0, 3).map((c) => c.category));
    }
  }, [monthFacts]);

  const { data: trend, isError, refetch, isLoading } = useQuery({
    // Shared-facts category_daily_trend (spending_facts.py), not the legacy
    // getTrendByCategoryV2 SQL — see the increment-3/4 findings in
    // docs/plans/2026-09-16-cashe-design-language-restoration.md.
    queryKey: ['explore-category-trend', monthFacts?.current.start, monthFacts?.current.end, selected.join(',')],
    queryFn: () => api.getCategoryDailyTrendV2(monthFacts!.current.start, monthFacts!.current.end, selected),
    enabled: !!monthFacts && selected.length > 0,
  });

  function toggle(category: string) {
    setSelected((prev) => (prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]));
  }

  // The API omits days without records; chart every day of the period, in
  // order, with those days as recorded $0 so spacing stays true.
  const period = monthFacts?.current;
  const chartData = trend && period ? datesInRange(period.start, period.end).map((date) => {
    const point = trend.find((p) => p.date === date);
    return { date, ...Object.fromEntries(selected.map((cat) => [cat, point?.categories[cat] ? point.categories[cat]!.minor_units / 100 : 0])) };
  }) : [];

  // Day → category → merchant investigation, held in the URL (replace).
  const [search, setSearch] = useSearchParams();
  const dayParam = search.get('day');
  const selectedDay = dayParam && period && dayParam >= period.start && dayParam <= period.end ? dayParam : null;
  function updateParams(changes: Record<string, string | null>) {
    const params = new URLSearchParams(search);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) params.delete(key); else params.set(key, value);
    }
    setSearch(params, { replace: true });
  }
  const dayBreakdown = useQuery({
    queryKey: ['explore-day-breakdown', selectedDay],
    queryFn: () => api.getCategoryBreakdownV2(selectedDay!, selectedDay!),
    enabled: !!selectedDay,
  });
  const dayCategoryParam = search.get('dayCategory');
  const dayCategory = dayCategoryParam && dayBreakdown.data && dayCategoryParam in dayBreakdown.data.by_category ? dayCategoryParam : null;
  const dayMerchants = useQuery({
    queryKey: ['explore-day-merchants', selectedDay, dayCategory],
    queryFn: () => api.getMerchantRankingFactsV2(selectedDay!, selectedDay!, dayCategory!, 5),
    enabled: !!selectedDay && !!dayCategory,
  });
  const dayPeriod = period && selectedDay ? { ...period, start: selectedDay, end: selectedDay } : null;
  const dayRows = dayBreakdown.data
    ? Object.entries(dayBreakdown.data.by_category).sort((a, b) => b[1].minor_units - a[1].minor_units)
    : [];

  return (
    <PageCard title="Spending over time">
      {!!categories?.length && (
        <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Categories to chart">
          {categories.map((c) => (
            <ChoiceChip
              key={c.name}
              selected={selected.includes(c.name)}
              categoryColor={getCategoryColor(c.name)}
              onClick={() => toggle(c.name)}
            >
              {c.name}
            </ChoiceChip>
          ))}
        </div>
      )}
      {!selected.length ? (
        <p className="text-muted text-sm">Select a category above to see its daily trend.</p>
      ) : isError && !trend ? (
        <div role="alert"><LoadFailed onRetry={() => void refetch()} /></div>
      ) : isLoading || !trend ? (
        <div role="status"><span className="sr-only">Loading…</span><Skeleton className="h-20 w-full" /></div>
      ) : (
        <div className="h-[220px] md:h-[296px]">
          <CategoryTrendLine
            data={chartData}
            selectedDate={selectedDay}
            onSelectDate={(day) => updateParams({ day: day === selectedDay ? null : day, dayCategory: null })}
          />
        </div>
      )}
      {selectedDay && dayPeriod && (
        <section aria-label={`All spending on ${formatShortDate(selectedDay)}`} className="mt-4 pt-4 border-t border-border space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">All spending on {formatShortDate(selectedDay)}</h3>
            <Button type="button" variant="ghost" size="sm" onClick={() => updateParams({ day: null, dayCategory: null })}>Clear day</Button>
          </div>
          {dayBreakdown.isError && !dayBreakdown.data ? (
            <div role="alert"><LoadFailed onRetry={() => void dayBreakdown.refetch()} /></div>
          ) : !dayBreakdown.data ? (
            <div role="status"><span className="sr-only">Loading…</span><Skeleton className="h-20 w-full" /></div>
          ) : !dayRows.length ? (
            <p className="text-sm text-muted">No recorded spending on this day.</p>
          ) : dayRows.map(([category, amount]) => (
            <div key={category}>
              <SelectableRow
                selected={dayCategory === category}
                onClick={() => updateParams({ dayCategory: dayCategory === category ? null : category })}
              >
                <StatusDot color={getCategoryColor(category)} />
                <span className="flex-1 min-w-0 truncate">{category}</span>
                <span className="font-mono tabular-nums text-muted">{formatMoney(amount)}</span>
              </SelectableRow>
              {dayCategory === category && (
                <div className="pl-5 py-2">
                  {dayMerchants.isError && !dayMerchants.data ? (
                    <div role="alert"><LoadFailed onRetry={() => void dayMerchants.refetch()} /></div>
                  ) : !dayMerchants.data ? (
                    <div role="status"><span className="sr-only">Loading…</span><Skeleton className="h-12 w-full" /></div>
                  ) : dayMerchants.data.map((m) => (
                    <RankedBar
                      key={m.merchant}
                      label={m.merchant}
                      value={m.total.minor_units}
                      max={Math.max(1, ...dayMerchants.data!.map((x) => x.total.minor_units))}
                      href={evidenceLink(dayPeriod, category, 'spending', m.merchant)}
                      secondaryHref={merchantProfileLink(m.merchant)}
                    />
                  ))}
                  <Link className="text-sm text-teal min-h-11 inline-flex items-center" to={evidenceLink(dayPeriod, category)}>All {category} on this day</Link>
                </div>
              )}
            </div>
          ))}
        </section>
      )}
    </PageCard>
  );
}

function WhatDoesANormalWeekLookLike() {
  const { data, isError, refetch } = useQuery({ queryKey: ['explore-weekday-pattern'], queryFn: () => briefingApi.weekdayPattern(8) });
  const max = Math.max(1, ...(data?.pattern ?? []).map(p => p.average.minor_units));
  const busiest = data?.pattern.reduce((top, p) => (p.average.minor_units > top.average.minor_units ? p : top), data.pattern[0]);
  return (
    <QuestionCard title="Your usual week" isError={isError} onRetry={() => void refetch()} isReady={!!data}>
      {data && <>
        <p className="text-sm text-muted">Average spend per weekday over the last {data.weeks} complete weeks, {formatRange(data.start, data.end)}.</p>
        {busiest && busiest.average.minor_units > 0 && (
          <p className="text-sm mt-1">Busiest: <span className="font-semibold">{WEEKDAY_LABELS[busiest.weekday]}</span>, {formatMoney(busiest.average)} on average.</p>
        )}
        <div className="mt-3">
          {data.pattern.map(p => <RankedBar key={p.weekday} label={WEEKDAY_LABELS[p.weekday]} value={p.average.minor_units} max={max}
            color={p.weekday === busiest?.weekday && p.average.minor_units > 0 ? 'var(--color-tangerine)' : undefined}
            href={`/evidence?${new URLSearchParams({ start: data.start, end: data.end, weekday: String(p.weekday) })}`} />)}
        </div>
      </>}
    </QuestionCard>
  );
}

function MerchantRanking({ facts }: { facts: SpendingFacts | undefined }) {
  const [category, setCategory] = useState('');
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: () => api.getCategories() });
  const period = facts?.current;
  const { data, isError, refetch } = useQuery({
    // Shared-facts merchant_ranking (spending_facts.py), not the legacy
    // getMerchantRankingV2 SQL aggregate — see the increment-3 finding in
    // docs/plans/2026-09-16-cashe-design-language-restoration.md.
    queryKey: ['explore-merchants-by-category', category, period?.start, period?.end],
    queryFn: () => api.getMerchantRankingFactsV2(period!.start, period!.end, category || undefined, 10),
    enabled: !!period,
  });
  const max = Math.max(1, ...(data ?? []).map(m => m.total.minor_units));
  const categorySelect = (
    <select value={category} onChange={e => setCategory(e.target.value)} className="select-field text-xs" aria-label="Category">
      <option value="">All categories</option>
      {(categories ?? []).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
    </select>
  );
  return (
    <PageCard title="Top merchants" action={categorySelect}>
      <p className="text-sm text-muted mb-3 flex items-center gap-2">
        {category && <StatusDot color={getCategoryColor(category)} />}
        Ranked by spending this month{category ? ` in ${category}` : ''}.
      </p>
      {isError && !data ? <div role="alert"><LoadFailed onRetry={() => void refetch()} /></div> : !data ? <div role="status"><span className="sr-only">Loading…</span><Skeleton className="h-20 w-full" /></div> : !data.length ? <p className="text-muted">{category ? `No ${category} spending this month yet.` : 'No spending this month yet.'}</p> :
        data.map(m => <RankedBar key={m.merchant} label={m.merchant} value={m.total.minor_units} max={max}
          color={category ? getCategoryColor(category) : undefined}
          href={period ? evidenceLink(period, category || undefined, 'spending', m.merchant) : undefined}
          secondaryHref={merchantProfileLink(m.merchant)} />)}
    </PageCard>
  );
}

function MostVisited({ facts }: { facts: SpendingFacts | undefined }) {
  const period = facts?.current;
  const { data, isError, refetch } = useQuery({
    queryKey: ['explore-merchants-visits', period?.start, period?.end],
    queryFn: () => api.getMerchantRankingFactsV2(period!.start, period!.end, undefined, 50),
    enabled: !!period,
  });
  const ranked = (data ?? []).filter(m => m.visits > 0).sort((a, b) => b.visits - a.visits || b.total.minor_units - a.total.minor_units).slice(0, 6);
  const max = Math.max(1, ...ranked.map(m => m.visits));
  return (
    <QuestionCard title="Most visited" isError={isError} onRetry={() => void refetch()} isReady={!!data}>
      <p className="text-sm text-muted mb-3">Where you pay most often this month, among your top 50 merchants by spend.</p>
      {!ranked.length ? <p className="text-muted">No purchases this month yet.</p> : ranked.map(m => (
        <RankedBar key={m.merchant} label={m.merchant} value={m.visits} max={max}
          display={`${m.visits} ${m.visits === 1 ? 'visit' : 'visits'} · ${formatMoney(m.total)}`}
          href={merchantProfileLink(m.merchant)} />
      ))}
    </QuestionCard>
  );
}

function RecurringCharges() {
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

function TripImpact({ trips }: { trips: { id: number; name: string; end_date: string | null }[] }) {
  const [tripId, setTripId] = useState<number | null>(null);
  const effectiveTripId = tripId ?? trips[0]?.id ?? null;
  const selectedTrip = trips.find(t => t.id === effectiveTripId);
  const { data: summary, isError, refetch } = useQuery({
    queryKey: ['explore-trip-summary', effectiveTripId],
    queryFn: () => api.getTripSummaryV2(effectiveTripId!),
    enabled: effectiveTripId != null,
  });
  // Month-to-date as of the trip's end, or today for an ongoing trip. Only
  // trip spending dated inside that same period is compared with it; the
  // whole-trip total can span other months and is reported separately.
  const { data: monthFacts } = useQuery({
    queryKey: ['explore-trip-month-facts', selectedTrip?.end_date ?? 'today'],
    queryFn: () => briefingApi.month(selectedTrip!.end_date ?? undefined),
    enabled: !!selectedTrip,
  });
  const monthPeriod = monthFacts?.current;
  const inPeriod = summary && monthPeriod
    ? summary.by_day.filter(d => d.date >= monthPeriod.start && d.date <= monthPeriod.end)
    : null;
  const tripInPeriod = inPeriod ? inPeriod.reduce((sum, d) => sum + d.amount.minor_units, 0) : null;
  const tripOutsidePeriod = !!summary && !!inPeriod && inPeriod.length < summary.by_day.length;
  const shareAvailable = !!monthPeriod && monthPeriod.status !== 'partial' && monthPeriod.spending.minor_units > 0;
  const tripShare = shareAvailable && tripInPeriod != null
    ? Math.round((tripInPeriod / monthPeriod.spending.minor_units) * 100)
    : null;
  const tripSelect = trips.length > 1 && (
    <select value={effectiveTripId ?? ''} onChange={e => setTripId(Number(e.target.value))} className="select-field text-xs" aria-label="Trip">
      {trips.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
  return (
    <PageCard title="How did this trip affect the month?" action={tripSelect}>
      {isError && !summary && <div role="alert"><LoadFailed onRetry={() => void refetch()} /></div>}
      {!summary && !isError && <div role="status"><span className="sr-only">Loading…</span><Skeleton className="h-16 w-full" /></div>}
      {summary && selectedTrip && (
        <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-center">
          <div>
            <p className="text-2xl font-bold font-display tabular-nums">{formatMoney(summary.total as Money)}</p>
            <p className="text-sm text-muted">{selectedTrip.name} · {summary.days} days · {formatMoney(summary.daily_average as Money)}/day</p>
          </div>
          <div className="space-y-1">
            {monthPeriod && tripInPeriod != null && (tripShare != null ? (
              <>
                <div className="h-2 rounded bg-foreground/10 overflow-hidden" aria-hidden="true"><div className="h-full bg-honey" style={{ width: `${Math.min(100, tripShare)}%` }} /></div>
                <p className="text-sm text-muted">
                  {formatMoney({ minor_units: tripInPeriod, currency: 'SGD' })} of it is dated {formatShortDate(monthPeriod.start)} – {formatShortDate(monthPeriod.end)}: about {tripShare}% of all recorded spending in that period
                  {monthPeriod.status === 'indicative' ? ' (includes indicative conversions)' : ''}.
                  {tripOutsidePeriod && ' Trip spending outside those dates is not part of this share.'}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">A share of {formatShortDate(monthPeriod.start)} – {formatShortDate(monthPeriod.end)} spending is unavailable while some records in that period need review.</p>
            ))}
            <Link to={`/transactions?trip=${effectiveTripId}`} className="text-teal underline min-h-11 inline-flex items-center">See trip transactions</Link>
          </div>
        </div>
      )}
    </PageCard>
  );
}

type ExploreLens = 'time' | 'category' | 'merchant' | 'recurring' | 'week';
const EXPLORE_LENSES: readonly ExploreLens[] = ['time', 'category', 'merchant', 'recurring', 'week'];
const LENS_FOR_MODE: Record<Mode, ExploreLens> = { 'over-time': 'time', 'by-category': 'category', 'by-merchant': 'merchant', recurring: 'recurring' };

// The phone glance: month-to-date spend against last month, with the two
// summaries the desktop band shows (signals, health) as one-tap links.
function ExploreGlance({ facts }: { facts: SpendingFacts | undefined }) {
  const health = useQuery({ queryKey: ['health-score-v2', 1], queryFn: () => briefingApi.healthScore(1), staleTime: 60_000 });
  const signals = useQuery({ queryKey: ['explore-signals'], queryFn: () => briefingApi.signals() });
  const signalCount = signals.data ? signals.data.unusual.length + signals.data.new_merchants.length : undefined;
  const change = facts?.change;
  const month = facts ? new Date(`${facts.current.start}T00:00:00`).toLocaleDateString('en-SG', { month: 'short' }) : '';
  const link = 'flex min-h-12 flex-1 items-center gap-2 px-1 text-sm active:bg-foreground/5 rounded-md transition-colors';
  return (
    <HeroCard title={facts ? `Spent · ${month}` : 'Spent'} className="p-4">
      {!facts ? <Skeleton className="h-10 w-40" /> : <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <HeroAmount value={facts.current.spending} className="text-4xl" />
        {change && <Badge tone={change.minor_units >= 0 ? 'warm' : 'calm'} className="font-mono gap-1">
          {change.minor_units >= 0 ? <ArrowUp size={12} aria-label="up" /> : <ArrowDown size={12} aria-label="down" />}{formatMoney({ ...change, minor_units: Math.abs(change.minor_units) })} vs last month
        </Badge>}
      </div>}
      <div className="mt-3 flex divide-x divide-border border-t border-border pt-1">
        <Link to="/explore/signals" className={link}>
          <StatusDot tone={signalCount ? 'notable' : 'calm'} />
          <span className="flex-1">Worth a look</span>
          <span className="font-mono tabular-nums">{signalCount ?? '–'}</span>
          <ChevronRight size={16} className="text-muted" aria-hidden />
        </Link>
        <Link to="/explore/health" className={`${link} pl-3`}>
          <span className="flex-1">Health</span>
          <span className="font-display font-bold tabular-nums">{health.data ? (health.data.has_income_data ? health.data.score : '—') : '–'}</span>
          <ChevronRight size={16} className="text-muted" aria-hidden />
        </Link>
      </div>
    </HeroCard>
  );
}

export function ExplorePatternsPage() {
  const [search, setSearch] = useSearchParams();
  const modeParam = search.get('mode');
  const mode: Mode = MODES.some(m => m.value === modeParam) ? (modeParam as Mode) : 'over-time';
  function setMode(next: Mode) {
    const params = new URLSearchParams(search);
    if (next === 'over-time') params.delete('mode'); else params.set('mode', next);
    setSearch(params, { replace: true });
  }
  const { data: facts } = useMonthFacts();
  const { data: trips } = useQuery({ queryKey: ['trips'], queryFn: () => api.getTrips() });
  const isPhone = useIsPhone();
  const location = useLocation();
  const patternsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // "vs. last month" opens By category and lands on the patterns.
    if (location.hash === '#explore-patterns') patternsRef.current?.scrollIntoView({ block: 'start' });
  }, [location.hash, location.search]);

  if (isPhone) {
    // A desktop mode link (e.g. "vs. last month" → by-category) lands on the
    // matching lens; the phone's own choice is held separately in ?lens=.
    const lensParam = search.get('lens') as ExploreLens | null;
    const lens: ExploreLens = lensParam && EXPLORE_LENSES.includes(lensParam) ? lensParam : modeParam ? LENS_FOR_MODE[mode] : 'time';
    const setLens = (next: ExploreLens) => {
      const params = new URLSearchParams(search);
      params.delete('mode');
      if (next === 'time') params.delete('lens'); else params.set('lens', next);
      setSearch(params, { replace: true });
    };
    const lenses: Lens<ExploreLens>[] = [
      { value: 'time', label: 'Time', bare: true, panel: <><SpendingOverTime /><DailyReadCard /><IncomeExpenseBar /></> },
      { value: 'category', label: 'Category', bare: true, panel: <><WhereItWent facts={facts} /><WhatChanged /><WhatDroveIt /></> },
      { value: 'merchant', label: 'Merchant', bare: true, panel: <><MerchantRanking facts={facts} /><MostVisited facts={facts} /></> },
      { value: 'recurring', label: 'Recurring', bare: true, panel: <RecurringCharges /> },
      { value: 'week', label: 'Week', bare: true, panel: <><WhatDoesANormalWeekLookLike />{!!trips?.length && <TripImpact trips={trips} />}</> },
    ];
    return <PhoneScreen glance={<ExploreGlance facts={facts} />} lenses={lenses} lens={lens} onLensChange={setLens} label="Explore views" />;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5 max-w-[1600px]">
      <PulseBand facts={facts} />

      {/* Both columns stretch to the taller one, so the pair reads as one band. */}
      <div className="grid gap-4 md:gap-5 lg:grid-cols-12 lg:items-stretch">
        <div className="lg:col-span-7 flex flex-col gap-4 md:gap-5">
          <DailyReadCard />
          <WorthALookSummary className="flex-1" />
        </div>
        <div className="lg:col-span-5 flex flex-col gap-4 md:gap-5">
          <BiggestMoverTile facts={facts} />
          <HealthScoreSummary className="flex-1" />
        </div>
      </div>

      <section id="explore-patterns" ref={patternsRef} aria-labelledby="explore-patterns-heading" className="space-y-4 pt-2 scroll-mt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="explore-patterns-heading" className="text-lg font-semibold font-display">Patterns</h2>
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="max-w-full">
            <TabsList aria-label="Explore patterns">
              {MODES.map((m) => (
                <TabsTrigger key={m.value} value={m.value}>{m.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {mode === 'over-time' && (
          <div className="grid gap-4 md:gap-6 lg:grid-cols-12 items-start">
            <div className="lg:col-span-8 space-y-4 md:space-y-6"><SpendingOverTime /><IncomeExpenseBar /></div>
            <div className="lg:col-span-4"><WhatDoesANormalWeekLookLike /></div>
          </div>
        )}
        {mode === 'by-category' && (
          // The selection detail opens beneath the chart, inside its column,
          // so the chart never resizes when a bar is selected.
          <div className="grid gap-4 md:gap-6 lg:grid-cols-12 items-start">
            <div className="lg:col-span-7 space-y-4 md:space-y-6"><WhatChanged /><WhatDroveIt /></div>
            <div className="lg:col-span-5"><WhereItWent facts={facts} /></div>
          </div>
        )}
        {mode === 'by-merchant' && (
          <div className="grid gap-4 md:gap-6 lg:grid-cols-12 items-start">
            <div className="lg:col-span-7"><MerchantRanking facts={facts} /></div>
            <div className="lg:col-span-5"><MostVisited facts={facts} /></div>
          </div>
        )}
        {mode === 'recurring' && <RecurringCharges />}
      </section>

      {!!trips?.length && <TripImpact trips={trips} />}
    </div>
  );
}
