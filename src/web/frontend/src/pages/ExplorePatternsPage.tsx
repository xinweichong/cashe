import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { briefingApi, evidenceLink, formatMoney, type Money } from '@/api/briefing';
import { PageCard } from '@/components/ui/cards';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CategoryChangeBars } from '@/components/charts/CategoryChangeBars';
import { CategoryTrendLine } from '@/components/charts/CategoryTrendLine';
import { getCategoryColor, cn } from '@/lib/utils';

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

function RankedBar({ label, value, max, href, secondaryHref, secondaryLabel }: {
  label: string; value: number; max: number; href?: string; secondaryHref?: string; secondaryLabel?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((Math.abs(value) / max) * 100)) : 0;
  return (
    <div className="py-1">
      <div className="flex justify-between gap-4 text-sm items-center">
        <span className="flex flex-wrap items-center gap-x-3">
          {href ? <Link to={href} className="hover:underline inline-flex items-center min-h-11">{label}</Link> : <span className="inline-flex items-center min-h-11">{label}</span>}
          {secondaryHref && <Link to={secondaryHref} className="text-xs text-teal underline inline-flex items-center min-h-11">{secondaryLabel ?? 'Profile'}</Link>}
        </span>
        <span className="tabular-nums">{formatMoney({ minor_units: value, currency: 'SGD' })}</span>
      </div>
      <div className="h-2 rounded bg-foreground/10 mt-1 overflow-hidden"><div className="h-full bg-teal" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function QuestionCard({ title, isError, onRetry, isReady, children }: { title: string; isError: boolean; onRetry: () => void; isReady: boolean; children: React.ReactNode }) {
  // A background refetch failure must not hide already-known-good data behind
  // an error screen — only show LoadFailed when there is nothing to show yet.
  return (
    <PageCard title={title}>
      {isError && !isReady ? <div role="alert"><LoadFailed onRetry={onRetry} /></div> : !isReady ? <p role="status" className="text-muted">Loading…</p> : children}
    </PageCard>
  );
}

function WhereDidTheIncreaseComeFrom() {
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isError, refetch } = useQuery({ queryKey: ['explore-month-facts'], queryFn: () => briefingApi.month() });
  const drivers = data?.category_changes ?? [];
  const top = data?.top_category_driver;
  const selectedDriver = drivers.find(d => d.category === selected);
  return (
    <>
      <QuestionCard title="What changed" isError={isError} onRetry={() => void refetch()} isReady={!!data}>
        <p className="text-sm text-muted mb-3">Signed change vs. the comparable period, centred on zero.</p>
        {!drivers.length && <p className="text-muted">{data?.change ? 'No category spending changes this period.' : 'Resolve records needing attention to compare categories.'}</p>}
        {data && !!drivers.length && <CategoryChangeBars data={drivers.slice(0, 5)} selected={selected} onSelect={(c) => setSelected(selected === c ? null : c)} />}
        {top?.merchant_driver && data && <p className="text-sm text-muted mt-2">Biggest mover in {top.category}: <Link className="underline" to={merchantProfileLink(top.merchant_driver.merchant)}>{top.merchant_driver.merchant}</Link> ({formatMoney(top.merchant_driver.change)}) — <Link className="underline" to={evidenceLink(data.comparison_current, top.category, 'spending', top.merchant_driver.merchant)}>view transactions</Link></p>}
        {top?.one_off_driver && <p className="text-sm text-muted">Largely one purchase: <Link className="underline" to={`/transactions/${top.one_off_driver.transaction_id}`}>{top.one_off_driver.merchant || 'Unnamed transaction'}</Link></p>}
        {data?.trip_drivers.map(t => <p key={t.trip_id} className="text-sm text-muted">Trip <Link className="underline" to={`/transactions?trip=${t.trip_id}`}>{t.name}</Link>: {formatMoney(t.change)} vs. last period — {t.overlap_note}</p>)}
      </QuestionCard>
      <PageCard title={selectedDriver ? selectedDriver.category : 'Selected category'}>
        {!data ? <p role="status" className="text-muted text-sm">Loading…</p> : !selectedDriver ? (
          <p className="text-muted text-sm">Select a bar in "What changed" to see its evidence links.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: getCategoryColor(selectedDriver.category) }} aria-hidden />
              <span className="text-sm font-medium">{formatMoney(selectedDriver.change)} change</span>
            </div>
            <div className="flex gap-6">
              <Link className="text-teal underline min-h-11 inline-flex items-center" to={evidenceLink(data.comparison_current, selectedDriver.category)}>This period</Link>
              <Link className="text-teal underline min-h-11 inline-flex items-center" to={evidenceLink(data.previous, selectedDriver.category)}>Previous period</Link>
            </div>
          </div>
        )}
      </PageCard>
    </>
  );
}

function WhichRecurringCostsChanged() {
  const { data, isError, refetch } = useQuery({ queryKey: ['explore-subscription-review'], queryFn: () => api.getSubscriptionReviewV2() });
  const max = Math.max(1, ...(data?.price_changes ?? []).map(c => Math.abs(c.change.minor_units)));
  const empty = data && !data.price_changes.length && !data.overdue.length && !data.annual_renewals.length;
  return (
    <QuestionCard title="Recurring charges" isError={isError} onRetry={() => void refetch()} isReady={!!data}>
      {empty && <p className="text-muted">No recurring cost changes to review.</p>}
      {data?.price_changes.map(c => <RankedBar key={c.subscription_id} label={c.label} value={c.change.minor_units} max={max} href={`/plan/manage?subscription=${c.subscription_id}`} />)}
      {!!data?.overdue.length && <div className="mt-3 space-y-1">
        <p className="text-sm font-medium">Possibly stopped</p>
        {data.overdue.map(o => <Link key={o.subscription_id} to={`/plan/manage?subscription=${o.subscription_id}`} className="block text-sm text-teal underline min-h-11">{o.label}: {o.days_since_last_charge} days since last charge</Link>)}
      </div>}
      {!!data?.annual_renewals.length && <div className="mt-3 space-y-1">
        <p className="text-sm font-medium">Renewing soon</p>
        {data.annual_renewals.map(r => <Link key={r.subscription_id} to={`/plan/manage?subscription=${r.subscription_id}`} className="block text-sm text-teal underline min-h-11">{r.label}: in {r.days_until_renewal} days</Link>)}
      </div>}
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

  const chartData = trend?.map((point) => ({
    date: point.date,
    ...Object.fromEntries(selected.map((cat) => [cat, point.categories[cat] ? point.categories[cat]!.minor_units / 100 : 0])),
  })) ?? [];

  return (
    <PageCard title="Spending over time">
      {!!categories?.length && (
        <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Categories to chart">
          {categories.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => toggle(c.name)}
              aria-pressed={selected.includes(c.name)}
              className={cn(
                'inline-flex items-center gap-1.5 min-h-9 px-2.5 rounded-pill text-sm border',
                selected.includes(c.name) ? 'border-transparent text-foreground' : 'border-border text-muted hover:text-foreground'
              )}
              style={selected.includes(c.name) ? { background: `color-mix(in srgb, ${getCategoryColor(c.name)} 16%, transparent)` } : undefined}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: getCategoryColor(c.name) }} aria-hidden />
              {c.name}
            </button>
          ))}
        </div>
      )}
      {!selected.length ? (
        <p className="text-muted text-sm">Select a category above to see its daily trend.</p>
      ) : isError && !trend ? (
        <div role="alert"><LoadFailed onRetry={() => void refetch()} /></div>
      ) : isLoading || !trend ? (
        <p role="status" className="text-muted text-sm">Loading…</p>
      ) : (
        <div className="h-[240px]"><CategoryTrendLine data={chartData} /></div>
      )}
    </PageCard>
  );
}

function WhatDoesANormalWeekLookLike() {
  const { data, isError, refetch } = useQuery({ queryKey: ['explore-weekday-pattern'], queryFn: () => briefingApi.weekdayPattern(8) });
  const max = Math.max(1, ...(data?.pattern ?? []).map(p => p.average.minor_units));
  return (
    <QuestionCard title="Your usual week" isError={isError} onRetry={() => void refetch()} isReady={!!data}>
      {data && <>
        <p className="text-sm text-muted mb-2">Average per weekday over the last {data.weeks} complete weeks ({data.start}–{data.end}).</p>
        {data.pattern.map(p => <RankedBar key={p.weekday} label={WEEKDAY_LABELS[p.weekday]} value={p.average.minor_units} max={max}
          href={`/evidence?${new URLSearchParams({ start: data.start, end: data.end, weekday: String(p.weekday) })}`} />)}
      </>}
    </QuestionCard>
  );
}

function WhichMerchantsAccountForMostOfThisCategory() {
  const [category, setCategory] = useState('');
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: () => api.getCategories() });
  const { data: monthFacts } = useQuery({ queryKey: ['explore-month-facts'], queryFn: () => briefingApi.month() });
  const effectiveCategory = category || monthFacts?.category_changes[0]?.category || '';
  const { data, isError, refetch } = useQuery({
    // Shared-facts merchant_ranking (spending_facts.py), not the legacy
    // getMerchantRankingV2 SQL aggregate — see the increment-3 finding in
    // docs/plans/2026-09-16-cashe-design-language-restoration.md.
    queryKey: ['explore-merchants-by-category', effectiveCategory, monthFacts?.current.start, monthFacts?.current.end],
    queryFn: () => api.getMerchantRankingFactsV2(monthFacts!.current.start, monthFacts!.current.end, effectiveCategory || undefined, 10),
    enabled: !!monthFacts,
  });
  const max = Math.max(1, ...(data ?? []).map(m => m.total.minor_units));
  const categorySelect = <select value={effectiveCategory} onChange={e => setCategory(e.target.value)} className="select-field text-xs" aria-label="Category">
    {(categories ?? []).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
  </select>;
  return (
    <PageCard title="Merchant ranking" action={!!categories?.length && categorySelect}>
      {effectiveCategory && (
        <p className="text-sm text-muted mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: getCategoryColor(effectiveCategory) }} aria-hidden />
          Ranked by total this period in {effectiveCategory}.
        </p>
      )}
      {isError && !data ? <div role="alert"><LoadFailed onRetry={() => void refetch()} /></div> : !data ? <p role="status" className="text-muted">Loading…</p> : !data.length ? <p className="text-muted">No spending in this category yet.</p> :
        data.map(m => <RankedBar key={m.merchant} label={m.merchant} value={m.total.minor_units} max={max}
          href={monthFacts ? evidenceLink(monthFacts.current, effectiveCategory, 'spending', m.merchant) : undefined}
          secondaryHref={merchantProfileLink(m.merchant)} />)}
    </PageCard>
  );
}

function HowDidThisTripAffectTheMonth() {
  const [tripId, setTripId] = useState<number | null>(null);
  const { data: trips, isError: tripsError, refetch: refetchTrips } = useQuery({ queryKey: ['trips'], queryFn: () => api.getTrips() });
  const effectiveTripId = tripId ?? trips?.[0]?.id ?? null;
  const selectedTrip = trips?.find(t => t.id === effectiveTripId);
  const { data: summary, isError, refetch } = useQuery({
    queryKey: ['explore-trip-summary', effectiveTripId],
    queryFn: () => api.getTripSummaryV2(effectiveTripId!),
    enabled: effectiveTripId != null,
  });
  const { data: monthFacts } = useQuery({
    queryKey: ['explore-trip-month-facts', selectedTrip?.start_date, selectedTrip?.end_date],
    queryFn: () => briefingApi.month(selectedTrip!.end_date || selectedTrip!.start_date),
    enabled: !!selectedTrip,
  });
  const monthTotal = monthFacts?.current.spending.minor_units ?? 0;
  const tripShare = summary && monthTotal ? Math.round((summary.total.minor_units / monthTotal) * 100) : null;
  const tripSelect = !!trips?.length && (
    <select value={effectiveTripId ?? ''} onChange={e => setTripId(Number(e.target.value))} className="select-field text-xs" aria-label="Trip">
      {trips.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
  return (
    <PageCard title="How did this trip affect the month?" action={tripSelect}>
      {tripsError && !trips ? <div role="alert"><LoadFailed onRetry={() => void refetchTrips()} /></div> : !trips ? <p role="status" className="text-muted">Loading…</p> : !trips.length && <p className="text-muted">No trips recorded yet.</p>}
      {isError && !summary && <div role="alert"><LoadFailed onRetry={() => void refetch()} /></div>}
      {summary && selectedTrip && <>
        <p>{formatMoney(summary.total as Money)} over {summary.days} days ({formatMoney(summary.daily_average as Money)}/day).</p>
        {tripShare != null && <p className="text-sm text-muted">About {tripShare}% of {selectedTrip.name}'s month so far.</p>}
        <Link to={`/transactions?trip=${effectiveTripId}`} className="text-teal underline min-h-11 inline-flex items-center">See trip transactions</Link>
      </>}
    </PageCard>
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

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="flex justify-center">
        <TabsList>
          {MODES.map((m) => (
            <TabsTrigger key={m.value} value={m.value}>{m.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Main visual + contextual inspection: side by side on wide layouts,
          stacked on phone/portrait tablet. Modes without a natural
          selection→detail split (By merchant, Recurring) just leave the
          second column empty at lg+. */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
        {mode === 'over-time' && <><SpendingOverTime /><WhatDoesANormalWeekLookLike /></>}
        {mode === 'by-category' && <WhereDidTheIncreaseComeFrom />}
        {mode === 'by-merchant' && <WhichMerchantsAccountForMostOfThisCategory />}
        {mode === 'recurring' && <WhichRecurringCostsChanged />}
      </div>

      <HowDidThisTripAffectTheMonth />
    </div>
  );
}
