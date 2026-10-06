import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { briefingApi, formatMoney, type Money, type SpendingFacts } from '@/api/briefing';
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
import { PulseBand } from '@/components/explore/PulseBand';
import { useEvidenceLink } from '@/components/explore/useEvidenceLink';
import { DailyReadCard } from '@/components/explore/DailyReadCard';
import { WorthALookSummary } from '@/components/explore/WorthALookCard';
import { HealthSpectrum } from '@/components/explore/HealthScoreCard';
import { ListGroup, ListRow } from '@/components/ui/list';
import { DetailHeader } from '@/components/ui/detail-panel';
import { ListDetail } from '@/components/layout/ListDetail';
import { formatChange, formatRange } from '@/components/explore/format';
import { QuestionCard, RankedBar, RecurringCharges } from '@/components/explore/RecurringCharges';
import { datesInRange, formatShortDate, getCategoryColor } from '@/lib/utils';
import { ChevronRight } from 'lucide-react';
import { useIsPhone } from '@/hooks/useIsPhone';
import { useTrips } from '@/components/plan/planHooks';
import { useCategories } from '@/hooks/useCategories';
import { useUrlParams } from '@/hooks/useUrlParams';
import { QueryState } from '@/components/ui/QueryState';

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

function WhatChanged() {
  const evidenceHref = useEvidenceLink();
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
              <Link className="text-teal underline min-h-11 inline-flex items-center" to={evidenceHref(data.comparison_current, selectedDriver.category)}>This period</Link>
              <Link className="text-teal underline min-h-11 inline-flex items-center" to={evidenceHref(data.previous, selectedDriver.category)}>Previous period</Link>
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
  const evidenceHref = useEvidenceLink();
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
              Biggest mover: <Link className="text-foreground underline" to={merchantProfileLink(top.merchant_driver.merchant)}>{top.merchant_driver.merchant}</Link> ({formatChange(top.merchant_driver.change)}). <Link className="text-teal underline" to={evidenceHref(data.comparison_current, top.category, 'spending', top.merchant_driver.merchant)}>View transactions</Link>
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
  const evidenceHref = useEvidenceLink();
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
        onViewTransactions={(category) => period && navigate(evidenceHref(period, category))}
        showLegend
      />
    </QuestionCard>
  );
}

function SpendingOverTime({ compactChips = false }: { compactChips?: boolean }) {
  const evidenceHref = useEvidenceLink();
  const [allChips, setAllChips] = useState(false);
  const { data: categories } = useCategories();
  const { data: monthFacts } = useQuery({ queryKey: ['explore-month-facts'], queryFn: () => briefingApi.month() });
  const [selected, setSelected] = useState<string[]>([]);
  const initialized = useRef(false);
  // Early in a month there are no movers yet; fall back to the month's
  // biggest categories so the chart isn't empty until a chip is picked.
  const { data: breakdown } = useQuery({
    queryKey: ['explore-breakdown', monthFacts?.current.start, monthFacts?.current.end],
    queryFn: () => api.getCategoryBreakdownV2(monthFacts!.current.start, monthFacts!.current.end),
    enabled: !!monthFacts && !monthFacts.category_changes.length,
  });
  useEffect(() => {
    if (!initialized.current && monthFacts && !monthFacts.category_changes.length && breakdown) {
      const top = Object.entries(breakdown.by_category).sort((a, b) => b[1].minor_units - a[1].minor_units).slice(0, 3).map(([c]) => c);
      if (top.length) {
        initialized.current = true;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelected(top);
      }
    }
  }, [monthFacts, breakdown]);
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
  const [search, updateParams] = useUrlParams();
  const dayParam = search.get('day');
  const selectedDay = dayParam && period && dayParam >= period.start && dayParam <= period.end ? dayParam : null;
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
          {/* Phone: the charted categories first, three chips, the rest behind More. */}
          {(compactChips && !allChips
            ? [...categories].sort((a, b) => Number(selected.includes(b.name)) - Number(selected.includes(a.name))).slice(0, 3)
            : categories
          ).map((c) => (
            <ChoiceChip
              key={c.name}
              selected={selected.includes(c.name)}
              categoryColor={getCategoryColor(c.name)}
              onClick={() => toggle(c.name)}
            >
              {c.name}
            </ChoiceChip>
          ))}
          {compactChips && categories.length > 3 && (
            <ChoiceChip selected={false} aria-expanded={allChips} onClick={() => setAllChips((v) => !v)}>
              {allChips ? 'Fewer' : `${categories.length - 3} more`}
            </ChoiceChip>
          )}
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
          <QueryState data={dayBreakdown.data} isError={dayBreakdown.isError} onRetry={() => void dayBreakdown.refetch()}>{() => !dayRows.length ? (
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
                  <QueryState data={dayMerchants.data} isError={dayMerchants.isError} onRetry={() => void dayMerchants.refetch()} skeleton={<Skeleton className="h-12 w-full" />}>{(dayMerchantsData) => dayMerchantsData.map((m) => (
                    <RankedBar
                      key={m.merchant}
                      label={m.merchant}
                      value={m.total.minor_units}
                      max={Math.max(1, ...dayMerchantsData.map((x) => x.total.minor_units))}
                      href={evidenceHref(dayPeriod, category, 'spending', m.merchant)}
                      secondaryHref={merchantProfileLink(m.merchant)}
                    />
                  ))}</QueryState>
                  <Link className="text-sm text-teal min-h-11 inline-flex items-center" to={evidenceHref(dayPeriod, category)}>All {category} on this day</Link>
                </div>
              )}
            </div>
          ))}</QueryState>
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
  const evidenceHref = useEvidenceLink();
  const [category, setCategory] = useState('');
  const { data: categories } = useCategories();
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
      <QueryState data={data} isError={isError} onRetry={() => void refetch()}>{(data) => !data.length ? <p className="text-muted">{category ? `No ${category} spending this month yet.` : 'No spending this month yet.'}</p> :
        data.map(m => <RankedBar key={m.merchant} label={m.merchant} value={m.total.minor_units} max={max}
          color={category ? getCategoryColor(category) : undefined}
          href={period ? evidenceHref(period, category || undefined, 'spending', m.merchant) : undefined}
          secondaryHref={merchantProfileLink(m.merchant)} />)}</QueryState>
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

// Explore is patterns (HIG alignment, 2026-10-01). On a phone the index is a
// summary list in the Health app's style: the health score is the screen's
// one spectrum card, and each section is a row with a small preview that
// opens as its own pushed page (?section=). With room, the full dashboard
// shows everything at once.
type ExploreSection = 'read' | 'time' | 'category' | 'merchant' | 'recurring' | 'trip';
const EXPLORE_SECTIONS: readonly ExploreSection[] = ['read', 'time', 'category', 'merchant', 'recurring', 'trip'];
const SECTION_TITLES: Record<ExploreSection, string> = {
  read: "Today's read", time: 'Over time', category: 'By category', merchant: 'By merchant', recurring: 'Recurring', trip: 'Trip impact',
};

// The last six months of spending as a line, for the Over time row.
function MonthsSparkline() {
  const { data } = useQuery({ queryKey: ['explore-monthly-preview'], queryFn: () => briefingApi.monthly(6), staleTime: 5 * 60_000 });
  const values = (data ?? []).map((m) => m.spending?.minor_units ?? 0);
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 64},${20 - (v / max) * 18}`).join(' ');
  return (
    <svg aria-hidden viewBox="0 0 64 22" className="h-[22px] w-16 shrink-0">
      <polyline points={points} fill="none" stroke="var(--color-teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// This month's category mix as one thin bar, for the By category row.
function CategoryMixBar({ facts }: { facts: SpendingFacts | undefined }) {
  const { data } = useQuery({
    queryKey: ['home-category-breakdown', facts?.current.start, facts?.current.end],
    queryFn: () => api.getCategoryBreakdownV2(facts!.current.start, facts!.current.end),
    enabled: !!facts,
  });
  const entries = Object.entries(data?.by_category ?? {}).sort((a, b) => b[1].minor_units - a[1].minor_units).slice(0, 5);
  if (!entries.length) return null;
  return (
    <span aria-hidden className="flex h-1.5 w-16 shrink-0 gap-px overflow-hidden rounded-pill">
      {entries.map(([name, amount]) => <span key={name} style={{ flex: amount.minor_units, background: getCategoryColor(name) }} />)}
    </span>
  );
}

function ExploreSummary({ facts, onOpen, hasTrips }: { facts: SpendingFacts | undefined; onOpen: (s: ExploreSection) => void; hasTrips: boolean }) {
  const dailyRead = useQuery({ queryKey: ['analytics-insight', 'daily'], queryFn: () => api.getAnalyticsInsight(), staleTime: 60 * 60 * 1000 });
  const signals = useQuery({ queryKey: ['explore-signals'], queryFn: () => briefingApi.signals() });
  const unusual = signals.data?.unusual.length ?? 0;
  const newMerchants = signals.data?.new_merchants.length ?? 0;
  const mover = facts?.category_changes[0];
  return (
    <div className="space-y-6">
      <HealthSpectrum />
      {dailyRead.data?.content && (
        <ListGroup>
          <ListRow onClick={() => onOpen('read')} title="Daily read" subtitle={dailyRead.data.content.narrative} value="AI" trailing="chevron" />
        </ListGroup>
      )}
      <ListGroup title="Worth a look">
        <ListRow to="/explore/signals" title={signals.data ? `${unusual} unusual ${unusual === 1 ? 'purchase' : 'purchases'}` : 'Unusual purchases'}
          subtitle={signals.data ? `${newMerchants} new ${newMerchants === 1 ? 'merchant' : 'merchants'} this month` : undefined} trailing="chevron" />
        <ListRow onClick={() => onOpen('category')} title="Biggest mover"
          subtitle={mover ? `${mover.category}, ${formatChange(mover.change)} vs the same days last month` : 'No category changed against last month'} trailing="chevron" />
      </ListGroup>
      <ListGroup title="Patterns">
        <ListRow onClick={() => onOpen('time')} title="Over time" subtitle="Daily, weekly and monthly spending" trailing={<><MonthsSparkline /><ChevronRight aria-hidden className="h-4 w-4 text-muted opacity-60" /></>} />
        <ListRow onClick={() => onOpen('category')} title="By category" subtitle="Where it went and what changed" trailing={<><CategoryMixBar facts={facts} /><ChevronRight aria-hidden className="h-4 w-4 text-muted opacity-60" /></>} />
        <ListRow onClick={() => onOpen('merchant')} title="By merchant" subtitle="Top merchants and most visited" trailing="chevron" />
        <ListRow onClick={() => onOpen('recurring')} title="Recurring" subtitle="Repeat charges and price changes" trailing="chevron" />
        {hasTrips && <ListRow onClick={() => onOpen('trip')} title="Trip impact" subtitle="How a trip affected the month" trailing="chevron" />}
      </ListGroup>
    </div>
  );
}

export function ExplorePatternsPage() {
  const [search, updateParams] = useUrlParams();
  const [, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const modeParam = search.get('mode');
  const mode: Mode = MODES.some(m => m.value === modeParam) ? (modeParam as Mode) : 'over-time';
  const setMode = (next: Mode) => updateParams({ mode: next === 'over-time' ? null : next });
  const { data: facts } = useMonthFacts();
  const { data: trips } = useTrips();
  const isPhone = useIsPhone();
  const location = useLocation();
  const patternsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // "vs. last month" opens By category and lands on the patterns.
    if (location.hash === '#explore-patterns') patternsRef.current?.scrollIntoView({ block: 'start' });
  }, [location.hash, location.search]);

  if (isPhone) {
    const sectionParam = search.get('section') as ExploreSection | null;
    const section = sectionParam && EXPLORE_SECTIONS.includes(sectionParam) ? sectionParam : null;
    // Opening pushes history so the back gesture closes it; closing a
    // section opened here pops that entry instead of pushing another.
    const open = (next: ExploreSection) => {
      const params = new URLSearchParams(search);
      params.set('section', next);
      setSearch(params, { state: { section: true } });
    };
    const close = () => {
      if ((location.state as { section?: boolean } | null)?.section) { navigate(-1); return; }
      updateParams({ section: null });
    };
    const detail = section && (
      <div className="flex h-full flex-col">
        <DetailHeader title={SECTION_TITLES[section]} onClose={close} />
        <div className="space-y-6 p-4">
          {section === 'read' && <DailyReadCard />}
          {section === 'time' && <><SpendingOverTime compactChips /><IncomeExpenseBar /><WhatDoesANormalWeekLookLike /></>}
          {section === 'category' && <><WhereItWent facts={facts} /><WhatChanged /><WhatDroveIt /></>}
          {section === 'merchant' && <>
            <MerchantRanking facts={facts} />
            <MostVisited facts={facts} />
            <ListGroup><ListRow to="/explore/merchants" title="All merchants" trailing="chevron" /></ListGroup>
          </>}
          {section === 'recurring' && <RecurringCharges />}
          {section === 'trip' && !!trips?.length && <TripImpact trips={trips} />}
        </div>
      </div>
    );
    return (
      <ListDetail
        listLabel="Explore"
        backLabel="Explore"
        list={<div className="px-4 pb-8"><ExploreSummary facts={facts} onOpen={open} hasTrips={!!trips?.length} /></div>}
        detail={detail}
        onClose={close}
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-8 px-4 pb-8 md:px-6">
      {/* The health score is the one spectrum card; the month's pulse sits beside it. */}
      <div className="grid gap-4 md:gap-5 lg:grid-cols-12 lg:items-start">
        <HealthSpectrum className="lg:col-span-5" />
        <div className="lg:col-span-7"><PulseBand facts={facts} /></div>
      </div>

      {/* Flex, not a fixed grid: with no daily read (no AI, or nothing yet), Worth a look takes the row. */}
      <div className="flex flex-col gap-4 md:gap-5 lg:flex-row lg:items-stretch lg:*:min-w-0 lg:*:flex-1">
        <DailyReadCard />
        <WorthALookSummary />
      </div>

      <section id="explore-patterns" ref={patternsRef} aria-labelledby="explore-patterns-heading" className="scroll-mt-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <h2 id="explore-patterns-heading" className="font-display text-xl font-bold tracking-[-0.01em]">Patterns</h2>
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="max-w-full">
            <TabsList aria-label="Explore patterns">
              {MODES.map((m) => (
                <TabsTrigger key={m.value} value={m.value}>{m.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {mode === 'over-time' && (
          <div className="grid items-start gap-4 md:gap-6 lg:grid-cols-12">
            <div className="space-y-4 md:space-y-6 lg:col-span-8"><SpendingOverTime /><IncomeExpenseBar /></div>
            <div className="lg:col-span-4"><WhatDoesANormalWeekLookLike /></div>
          </div>
        )}
        {mode === 'by-category' && (
          // The selection detail opens beneath the chart, inside its column,
          // so the chart never resizes when a bar is selected.
          <div className="grid items-start gap-4 md:gap-6 lg:grid-cols-12">
            <div className="space-y-4 md:space-y-6 lg:col-span-7"><WhatChanged /><WhatDroveIt /></div>
            <div className="lg:col-span-5"><WhereItWent facts={facts} /></div>
          </div>
        )}
        {mode === 'by-merchant' && (
          <div className="grid items-start gap-4 md:gap-6 lg:grid-cols-12">
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
