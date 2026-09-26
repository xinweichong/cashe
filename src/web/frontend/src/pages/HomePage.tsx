import { useId, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowRight, ArrowUp, ChevronRight, Plus } from 'lucide-react';
import { evidenceLink, formatMoney, formatMoneyAbs } from '@/api/briefing';
import { api } from '@/api/client';
import { datesInRange, formatShortDate, getCategoryColor } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusDot } from '@/components/ui/StatusDot';
import { HeroCard, PageCard } from '@/components/ui/cards';
import { HeroAmount } from '@/components/ui/HeroAmount';
import { StatCard } from '@/components/ui/StatCard';
import { ActivityRowShell } from '@/components/ui/ActivityRowShell';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendLine } from '@/components/charts/TrendLine';
import { CategoryDonut } from '@/components/charts/CategoryDonut';
import { CategoryChangeBarRow } from '@/components/charts/CategoryChangeBars';
import { PHONE_SCREEN_HEIGHT, PhoneScreen, type Lens, LensAction } from '@/components/layout/PhoneScreen';
import { DrillSheet } from '@/components/layout/DrillSheet';
import { useIsPhone } from '@/hooks/useIsPhone';
import { cn } from '@/lib/utils';
import { useHomeBriefing } from '@/hooks/useBriefing';
import { useUrlParams } from '@/hooks/useUrlParams';
import { useDrill } from '@/hooks/useDrill';
import { SignedChange } from '@/components/ui/SignedChange';

const PAGE = 'p-4 md:p-6 space-y-4 md:space-y-5 max-w-[1600px] text-base';
const BAND = 'grid gap-4 md:gap-5 lg:grid-cols-12';

// Home is "now": the month so far, its trend and what changed. What's
// coming belongs to Plan and the full record to Activity; the Month lens
// links into both with one-line summaries instead of duplicating them.
type HomeLens = 'month' | 'trend' | 'changed';
type HomeDrill = 'category' | 'changed' | 'attention';
const HOME_LENSES: readonly HomeLens[] = ['month', 'trend', 'changed'];
const HOME_DRILLS: readonly HomeDrill[] = ['category', 'changed', 'attention'];
// The phone glance's own height: donut ring plus the amount row and chrome.
const PHONE_SCREEN = cn(PHONE_SCREEN_HEIGHT, 'flex flex-col gap-2 px-3 pt-3 pb-2 overflow-hidden');

// One figure in the phone's Month lens: a label and value that open their
// evidence, sized as a full-width 56px row for the thumb.
function MetricRow({ label, value, sub, tone, href }: { label: string; value: React.ReactNode; sub: React.ReactNode; tone?: 'teal' | 'coral'; href?: string }) {
  const body = <>
    <div className="min-w-0 flex-1">
      <p className="text-2xs uppercase tracking-[0.22em] text-muted font-mono font-semibold">{label}</p>
      <p className="text-xs text-muted truncate">{sub}</p>
    </div>
    <span className={cn('font-display text-lg font-bold tabular-nums', tone === 'teal' && 'text-teal', tone === 'coral' && 'text-coral')}>{value}</span>
    {href && <ChevronRight size={16} className="text-muted shrink-0" aria-hidden />}
  </>;
  // flex-1: on a tall phone the Month rows share the panel's height evenly
  // instead of leaving a dead band beneath the last one.
  const row = 'flex flex-1 min-h-12 items-center gap-3 px-4 py-1.5';
  return href
    ? <Link to={href} className={cn(row, 'active:bg-foreground/5 transition-colors')}>{body}</Link>
    : <div className={row}>{body}</div>;
}

export function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  // Category and day selections live in the URL (replace-history) so the
  // evidence → correction → Back journey returns to the same selection.
  const [search, updateParams] = useUrlParams();
  const setSelectedCategory = (value: string | null) => updateParams({ category: value || null });
  const setSelectedDate = (value: string | null) => updateParams({ day: value || null });
  const withReturn = (href: string) => `${href}&returnTo=${encodeURIComponent(location.pathname + location.search)}`;
  const transactionLink = (id: number) => `/transactions/${id}?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
  const [selectedChangeCategory, setSelectedChangeCategory] = useState<string | null>(null);
  const [showMoreChange, setShowMoreChange] = useState(false);
  const moreChangeId = useId();
  const isPhone = useIsPhone();
  const lensParam = search.get('lens') as HomeLens | null;
  const lens: HomeLens = lensParam && HOME_LENSES.includes(lensParam) ? lensParam : 'month';
  const setLens = (value: HomeLens) => updateParams({ lens: value === 'month' ? null : value });
  const drills = useDrill(HOME_DRILLS);
  const drill = isPhone ? drills.drill : null;
  const openDrill = (kind: HomeDrill, category?: string) => drills.openDrill(kind, category ? { category } : {});
  const closeDrill = () => drills.closeDrill(['category']);
  const query = useHomeBriefing();
  const currentStart = query.data?.facts.current.start;
  const currentEnd = query.data?.facts.current.end;
  // Both charts read start/end scoped to facts.current — the exact period the
  // hero amount above them covers — and are built on the same spending_facts
  // rules as that hero (see src/spending_facts.py's category_breakdown/
  // daily_totals), never the legacy /api/v2/overview/* SQL aggregates, so
  // chart and hero totals always reconcile for an identical period.
  const breakdownQuery = useQuery({
    queryKey: ['home-category-breakdown', currentStart, currentEnd],
    queryFn: () => api.getCategoryBreakdownV2(currentStart!, currentEnd!),
    enabled: !!currentStart && !!currentEnd,
  });
  const trendQuery = useQuery({
    queryKey: ['home-daily-totals', currentStart, currentEnd],
    queryFn: () => api.getDailyTotalsV2(currentStart!, currentEnd!),
    enabled: !!currentStart && !!currentEnd,
  });
  const categoryParam = search.get('category');
  const selectedCategory = categoryParam && breakdownQuery.data && categoryParam in breakdownQuery.data.by_category ? categoryParam : null;
  const dayParam = search.get('day');
  const selectedDate = dayParam && trendQuery.data && currentStart && currentEnd && dayParam >= currentStart && dayParam <= currentEnd ? dayParam : null;
  const merchantsQuery = useQuery({
    queryKey: ['home-merchants', currentStart, currentEnd, selectedCategory],
    queryFn: () => api.getMerchantRankingFactsV2(currentStart!, currentEnd!, selectedCategory ?? undefined, 5),
    enabled: !!currentStart && !!currentEnd && !!selectedCategory,
  });
  // Stable across re-renders (a lens switch, a drill-in) so the donut's
  // sweep animation plays once instead of replaying on every state change.
  const categoryTotals = useMemo(() => breakdownQuery.data
    ? Object.entries(breakdownQuery.data.by_category).map(([category, amount]) => ({ category, total: amount.minor_units / 100 }))
    : [], [breakdownQuery.data]);
  const header = (asOf: React.ReactNode) => (
    <header className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        <div className="text-xs uppercase tracking-[0.22em] text-muted font-mono font-semibold">Home</div>
        <h1 className="text-xl font-bold leading-tight tracking-tight text-foreground font-display">Where the dollars go.</h1>
        {asOf}
      </div>
      <Button asChild size="sm" variant="outline">
        <Link to="/transactions?add=1"><Plus aria-hidden="true" size={16} />Add</Link>
      </Button>
    </header>
  );
  if (!query.data && query.isError) return (
    <div className={cn(PAGE, isPhone && 'p-3')}>
      {header(null)}
      <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div>
    </div>
  );
  if (!query.data && isPhone) return (
    <div role="status" aria-label="Preparing your briefing" className={PHONE_SCREEN}>
      <h1 className="sr-only">Home</h1>
      <HeroCard title="Where it went" className="p-4">
        <Skeleton className="h-10 w-40" />
        <div className="mt-3 flex items-center gap-3">
          <Skeleton className="h-[112px] w-[112px] shrink-0 rounded-full" />
          <Skeleton className="h-24 flex-1" />
        </div>
      </HeroCard>
      <Skeleton className="flex-1 rounded-lg" />
      <Skeleton className="h-[46px] rounded-sm" />
    </div>
  );
  if (!query.data) return (
    <div className={PAGE}>
      {header(<Skeleton className="h-5 w-48" />)}
      <div role="status" aria-label="Preparing your briefing" className="space-y-4 md:space-y-5">
        <div className={BAND}>
          <HeroCard title="Where it went" className="lg:col-span-8">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="mt-3 h-4 w-64 max-w-full" />
            <div className="mt-6 flex items-center gap-6">
              <Skeleton className="h-[180px] w-[180px] shrink-0 rounded-full" />
              <Skeleton className="h-32 flex-1" />
            </div>
          </HeroCard>
          <div className="lg:col-span-4 grid gap-4 md:gap-5">
            <Skeleton className="h-[108px] rounded-lg" />
            <Skeleton className="h-[108px] rounded-lg" />
            <Skeleton className="h-[108px] rounded-lg" />
          </div>
        </div>
        <div className={BAND}>
          <PageCard title="Daily trend" className="lg:col-span-8"><Skeleton className="h-[160px] w-full" /></PageCard>
          <PageCard title="What changed" className="lg:col-span-4"><Skeleton className="h-24 w-full" /></PageCard>
        </div>
      </div>
    </div>
  );
  const { facts, spending_target, freshness, recent, upcoming, upcoming_total, upcoming_unknown_count, increased_commitments, capture_issue_count, followup_issue_count, review_count, recurring_suggestion_count } = query.data;
  const overTarget = !!spending_target && spending_target.remaining.minor_units < 0;
  const unresolved = facts.current.unresolved_count + facts.undated_count;
  const netFlowNegative = !!facts.current.recorded_net_flow && facts.current.recorded_net_flow.minor_units < 0;
  const driver = facts.top_category_driver;
  // Home's queries refetch together after a correction but settle
  // separately; say so rather than silently mixing old and new snapshots.
  const refreshing = [query, breakdownQuery, trendQuery, merchantsQuery].some((q) => q.isFetching && q.data !== undefined);
  // The API lists days newest-first and omits days with no records; the
  // chart needs every day of the period in order, with those as recorded $0.
  const trendPoints = trendQuery.data && currentStart && currentEnd ? datesInRange(currentStart, currentEnd).map((date) => {
    const day = trendQuery.data!.find((d) => d.date === date);
    return { date, amount: day ? day.spending.minor_units / 100 : 0 };
  }) : [];
  const changeBadges = <>
    {facts.change && <Badge tone={facts.change.minor_units >= 0 ? 'warm' : 'calm'} className="font-mono gap-1">
      <SignedChange change={facts.change} />
    </Badge>}
    {spending_target && <Badge tone={overTarget ? 'warm' : 'saved'} className="font-mono">
      {overTarget ? 'over target' : 'under target'}
    </Badge>}
  </>;
  const merchantList = selectedCategory && <>
    {merchantsQuery.data ? (
      <>
        {merchantsQuery.isError && <p className="text-xs text-warning">Couldn't refresh merchants for {selectedCategory} — showing the last loaded data. <Button type="button" variant="link" size="sm" className="h-auto min-h-11 p-0 align-baseline" onClick={() => void merchantsQuery.refetch()}>Retry</Button></p>}
        {merchantsQuery.data.length ? (
          <ul className="space-y-2">
            {merchantsQuery.data.map((m) => (
              <li key={m.merchant} className="flex justify-between text-sm">
                <span>{m.merchant}</span>
                <span className="font-mono tabular-nums text-muted">{formatMoney(m.total)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No merchant records for {selectedCategory} in this period.</p>
        )}
      </>
    ) : merchantsQuery.isLoading ? (
      <Skeleton className="h-[100px] w-full" />
    ) : (
      <p className="text-sm text-muted">Couldn't load merchants for {selectedCategory}. <Button type="button" variant="link" size="sm" className="h-auto min-h-11 p-0 align-baseline" onClick={() => void merchantsQuery.refetch()}>Retry</Button></p>
    )}
  </>;
  // Lead with the strongest change and its evidence; the rest of the
  // explanation sits behind "More context" (always open in the phone's
  // drill-in). Bars share one scale so nothing rescales when it expands.
  const renderChanged = (expanded: boolean) => {
    const changes = facts.category_changes.slice(0, 3);
    const maxChange = Math.max(...changes.map((c) => Math.abs(c.change.minor_units)), 1);
    const changeRow = (item: typeof changes[number]) => <div key={item.category} className="py-1 border-b border-border last:border-0">
      <CategoryChangeBarRow
        datum={item}
        max={maxChange}
        selected={selectedChangeCategory === item.category}
        onSelect={setSelectedChangeCategory}
      />
      <div className="flex gap-6 pl-2 pb-2"><Link className="text-teal min-h-11 inline-flex items-center" to={withReturn(evidenceLink(facts.comparison_current, item.category))}>This period</Link><Link className="text-teal min-h-11 inline-flex items-center" to={withReturn(evidenceLink(facts.previous, item.category))}>Previous period</Link></div>
    </div>;
    const hasMore = changes.length > 1 || !!driver || !!facts.trip_drivers.length;
    const open = expanded || showMoreChange;
    return <>
      {changes.length
        ? <div data-testid="category-change-bars">{changeRow(changes[0])}</div>
        : <p className="text-muted">{facts.change ? 'No category spending changes in these periods.' : 'Resolve the records needing attention to compare categories.'}</p>}
      {hasMore && !expanded && <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-2"
        aria-expanded={showMoreChange}
        aria-controls={moreChangeId}
        onClick={() => setShowMoreChange((open) => !open)}
      >
        {showMoreChange ? 'Less context' : 'More context'}
      </Button>}
      {open && <div id={moreChangeId}>
        {changes.length > 1 && <div className="mt-2">{changes.slice(1).map(changeRow)}</div>}
        {driver && <div className="mt-4 pt-4 border-t border-border space-y-3">
          <p className="text-sm text-muted">{driver.overlap_note}</p>
          {driver.merchant_driver && <p>Biggest contributor in {driver.category}: <Link className="text-teal underline" to={withReturn(evidenceLink(facts.comparison_current, driver.category, 'spending', driver.merchant_driver.merchant))}>{driver.merchant_driver.merchant}</Link> (<strong>{formatMoney(driver.merchant_driver.change)}</strong> change)</p>}
          {driver.frequency_driver && driver.frequency_driver.classification !== 'none' && <p>
            {driver.frequency_driver.classification === 'frequency' && `Driven mostly by more purchases: ${driver.frequency_driver.current_count} this period vs ${driver.frequency_driver.previous_count} previously, at a similar average.`}
            {driver.frequency_driver.classification === 'size' && `Driven mostly by bigger purchases: average ${formatMoney(driver.frequency_driver.current_avg)} this period vs ${formatMoney(driver.frequency_driver.previous_avg)} previously, at a similar count.`}
            {driver.frequency_driver.classification === 'mixed' && `Both purchase count (${driver.frequency_driver.previous_count} → ${driver.frequency_driver.current_count}) and average size (${formatMoney(driver.frequency_driver.previous_avg)} → ${formatMoney(driver.frequency_driver.current_avg)}) changed.`}
          </p>}
          {driver.one_off_driver && <p>Largely one purchase: <Link className="text-teal underline" to={transactionLink(driver.one_off_driver.transaction_id)}>{driver.one_off_driver.merchant || 'Unnamed transaction'}</Link> for <strong>{formatMoney(driver.one_off_driver.amount)}</strong> on {driver.one_off_driver.date}.</p>}
        </div>}
        {!!facts.trip_drivers.length && <div className="mt-4 pt-4 border-t border-border space-y-3">
          {facts.trip_drivers.map(trip => <p key={trip.trip_id}>Trip <Link className="text-teal underline" to={`/transactions?trip=${trip.trip_id}&start=${facts.current.start}&end=${facts.comparison_current.end}`}>{trip.name}</Link>: {formatMoney(trip.current_total)} this period ({formatMoney(trip.previous_total)} previously). <span className="text-sm text-muted">{trip.overlap_note}</span></p>)}
        </div>}
      </div>}
    </>;
  };
  const upcomingBody = <>
    <p>{formatMoney(upcoming_total)} in estimated charges over the next 14 days.</p>
    {!!upcoming_unknown_count && <p className="text-warning">{upcoming_unknown_count} expected charges have no amount yet.</p>}
    {upcoming.map(item => <div key={item.id} className="flex justify-between gap-4 py-3 border-b border-border last:border-0"><div>{item.label}<p className="text-sm text-muted">{item.date}</p></div><span>{item.amount ? formatMoney(item.amount) : 'Amount unknown'}</span></div>)}
    {!upcoming.length && <p className="text-muted mt-3">No pending charges are recorded for these dates. Add subscriptions in Plan to track them.</p>}
    {!!increased_commitments.length && <div className="mt-4 pt-4 border-t border-border space-y-2">
      <p className="font-medium">Recently increased</p>
      {increased_commitments.map(change => <p key={change.subscription_id}>{change.label}: {formatMoney(change.old_amount)} → {formatMoney(change.new_amount)} (<strong>+{formatMoney(change.change)}</strong>, {formatMoney(change.annualized_impact)}/year)</p>)}
    </div>}
  </>;
  const attentionBody = <>
    <Link to="/review" className="flex items-center gap-2 min-h-11 py-2 rounded-md px-2 -mx-2 hover:bg-card-hover transition-colors text-teal"><StatusDot tone="notable" />{capture_issue_count + followup_issue_count} capture or follow-up items</Link>
    {!!unresolved && <Link to={withReturn(evidenceLink(facts.current, undefined, 'unresolved'))} className="flex items-center gap-2 min-h-11 py-2 rounded-md px-2 -mx-2 hover:bg-card-hover transition-colors text-warning"><StatusDot tone="warm" />Review {unresolved} spending records with unresolved amounts or dates</Link>}
    {!!review_count && <Link to="/review" className="flex items-center gap-2 min-h-11 py-2 rounded-md px-2 -mx-2 hover:bg-card-hover transition-colors text-teal"><StatusDot tone="notable" />{review_count} spending records need review</Link>}
    {!!recurring_suggestion_count && <Link to="/review" className="flex items-center gap-2 min-h-11 py-2 rounded-md px-2 -mx-2 hover:bg-card-hover transition-colors text-teal"><StatusDot tone="calm" />{recurring_suggestion_count} recurring suggestions</Link>}
    <div className="mt-4 pt-4 border-t border-border space-y-1">
      <p className="text-muted text-sm">{freshness.gmail_needs_reconnection ? 'Gmail needs reconnection.' : freshness.gmail_connected ? `Gmail last checked: ${freshness.gmail_last_checked ?? 'not checked in this session'}.` : 'Gmail is not connected in this session.'}</p>
      <p className="text-xs text-muted">{freshness.last_capture_processed_at ? `Last capture processed: ${freshness.last_capture_processed_at}.` : 'No capture has been processed yet.'}</p>
      <p className="text-xs text-muted">Recent checks do not prove every purchase was captured.</p>
    </div>
    <Button asChild variant="outline" size="sm" className="mt-4"><Link to="/settings">Manage connections</Link></Button>
  </>;
  if (isPhone) {
    const attentionCount = capture_issue_count + followup_issue_count + unresolved + review_count + recurring_suggestion_count;
    const sourcesNeedCare = freshness.gmail_needs_reconnection || !freshness.gmail_connected;
    const targetAbs = spending_target && formatMoneyAbs(spending_target.remaining);
    const lensAction = (label: string, onClick: () => void) => <LensAction label={label} onClick={onClick} />;
    const changeAbs = facts.change && formatMoneyAbs(facts.change);
    const changes = facts.category_changes.slice(0, 4);
    const maxChange = Math.max(...changes.map((c) => Math.abs(c.change.minor_units)), 1);
    const lenses: Lens<HomeLens>[] = [
      { value: 'month', label: 'Month', panel: <div className="flex h-full flex-col">
        <div className="flex flex-1 flex-col divide-y divide-border">
          <MetricRow label="Income" value={facts.current.income ? formatMoney(facts.current.income) : 'None yet'} tone={facts.current.income ? 'teal' : undefined} sub={facts.current.income ? 'Recorded this month' : 'Captured income appears here'} href={withReturn(evidenceLink(facts.current, undefined, 'income'))} />
          <MetricRow label="Net flow" value={facts.current.recorded_net_flow ? formatMoney(facts.current.recorded_net_flow) : 'Unavailable'} tone={!facts.current.recorded_net_flow ? undefined : netFlowNegative ? 'coral' : 'teal'} sub={facts.current.recorded_net_flow ? `Recorded net ${netFlowNegative ? 'outflow' : 'flow'}` : facts.current.income ? 'Hidden while records need review' : 'No income recorded this month'} />
          {spending_target
            ? <MetricRow label={overTarget ? 'Over target' : 'Target left'} value={targetAbs} tone={overTarget ? 'coral' : 'teal'} sub={`of your ${formatMoney(spending_target.target)} monthly target`} href="/plan" />
            : <MetricRow label="Target" value="Not set" sub="Set one in Plan to track pace" href="/plan" />}
          <MetricRow label="Coming up" value={formatMoney(upcoming_total)} sub={`Next 14 days · ${upcoming.length} ${upcoming.length === 1 ? 'charge' : 'charges'}${upcoming_unknown_count ? `, ${upcoming_unknown_count} unpriced` : ''}`} href="/plan?days=14" />
          {recent[0] && <MetricRow label="Latest" value={recent[0].amount ? formatMoney(recent[0].amount) : 'Unresolved'} sub={`${recent[0].merchant || 'Unnamed transaction'}${recent[0].date ? ` · ${formatShortDate(recent[0].date)}` : ''}`} href="/activity" />}
        </div>
        {refreshing && <p role="status" className="px-4 py-2 text-xs text-muted">Updating…</p>}
      </div> },
      { value: 'trend', label: 'Trend', panel: <div className="flex h-full flex-col p-3">
        {trendQuery.data ? <>
          <div className="flex-1 min-h-0"><TrendLine data={trendPoints} selectedDate={selectedDate} onSelectDate={setSelectedDate} chartHeight={124} fill /></div>
          {selectedDate && <Link className="text-sm text-teal min-h-11 inline-flex items-center" to={withReturn(`/evidence?start=${selectedDate}&end=${selectedDate}&measure=spending`)}>View this day's records</Link>}
        </> : trendQuery.isLoading ? <Skeleton className="h-[168px] w-full" /> : <p className="text-sm text-muted">Couldn't load the daily trend. <Button type="button" variant="link" size="sm" className="h-auto min-h-11 p-0 align-baseline" onClick={() => void trendQuery.refetch()}>Retry</Button></p>}
      </div> },
      { value: 'changed', label: 'Changed', panel: <div className="flex h-full flex-col">
        <div className="flex-1 px-3 pt-2">
          {changes.length
            ? changes.map((item) => <div key={item.category} className="border-b border-border last:border-0">
              <CategoryChangeBarRow datum={item} max={maxChange} selected={false} onSelect={() => openDrill('changed')} />
            </div>)
            : <p className="p-1 text-sm text-muted">{facts.change ? 'No category spending changes in these periods.' : 'Resolve the records needing attention to compare categories.'}</p>}
        </div>
        {lensAction('Why it changed', () => openDrill('changed'))}
      </div> },
    ];
    const glance = (
      <HeroCard
        title={`${formatShortDate(facts.current.start).split(' ')[0]}–${formatShortDate(facts.as_of)}`}
        className="p-4"
        glowColor={overTarget ? 'coral' : 'warm'}
        action={<div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="lg" className="gap-1.5 px-2" onClick={() => openDrill('attention')}>
            <StatusDot tone={attentionCount ? 'notable' : sourcesNeedCare ? 'warm' : 'calm'} />
            {attentionCount ? `${attentionCount} to check` : sourcesNeedCare ? 'Sources' : 'Captured'}
          </Button>
          <Button asChild variant="outline" size="icon" aria-label="Add a transaction">
            <Link to="/transactions?add=1"><Plus aria-hidden="true" size={16} /></Link>
          </Button>
        </div>}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link to={withReturn(evidenceLink(facts.current))} aria-label={`See all spending, ${formatMoney(facts.current.spending)}`} className="rounded-sm active:scale-[0.98] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <HeroAmount value={facts.current.spending} className="text-4xl" />
          </Link>
          {facts.change && <Badge tone={facts.change.minor_units >= 0 ? 'warm' : 'calm'} className="font-mono gap-1">
            {facts.change.minor_units >= 0 ? <ArrowUp size={12} aria-label="up" /> : <ArrowDown size={12} aria-label="down" />}{changeAbs}
          </Badge>}
          {spending_target && <Badge tone={overTarget ? 'warm' : 'saved'} className="font-mono">{overTarget ? 'over target' : 'under target'}</Badge>}
        </div>
        {facts.current.status !== 'complete' && <p className="mt-1 text-xs text-muted">{facts.current.status === 'partial' ? 'Known subtotal · some records need review.' : 'Includes indicative currency conversions.'}</p>}
        {query.isError && <p role="alert" className="mt-1 text-xs text-warning">Couldn’t refresh. <Button type="button" variant="link" size="sm" className="h-auto min-h-11 p-0 align-baseline" onClick={() => void query.refetch()}>Retry</Button></p>}
        <div className="mt-3">
          {breakdownQuery.data
            ? <CategoryDonut data={categoryTotals} selected={null} onSelect={(category) => category && openDrill('category', category)} showLegend size="compact" />
            : breakdownQuery.isLoading
              ? <div className="flex items-center gap-3"><Skeleton className="h-[112px] w-[112px] shrink-0 rounded-full" /><Skeleton className="h-24 flex-1" /></div>
              : <p className="text-sm text-muted">Couldn't load the category mix. <Button type="button" variant="link" size="sm" className="h-auto min-h-11 p-0 align-baseline" onClick={() => void breakdownQuery.refetch()}>Retry</Button></p>}
        </div>
      </HeroCard>
    );
    const categoryTotal = selectedCategory ? categoryTotals.find((c) => c.category === selectedCategory)?.total : undefined;
    return (
      <>
        <h1 className="sr-only">Home</h1>
        <PhoneScreen glance={glance} lenses={lenses} lens={lens} onLensChange={setLens} label="Home views" />
        <DrillSheet
          open={drill === 'category' && !!selectedCategory}
          onOpenChange={(open) => !open && closeDrill()}
          backLabel="Home"
          title={<span className="inline-flex items-center gap-2">{selectedCategory && <StatusDot color={getCategoryColor(selectedCategory)} />}{selectedCategory}</span>}
          footer={selectedCategory && <Button asChild className="w-full min-h-12"><Link to={withReturn(evidenceLink(facts.current, selectedCategory))}>View {selectedCategory} transactions</Link></Button>}
        >
          {selectedCategory && categoryTotal !== undefined && (() => {
            const spendingTotal = facts.current.spending.minor_units / 100;
            const share = spendingTotal > 0 ? Math.round((categoryTotal / spendingTotal) * 100) : 0;
            const change = facts.category_changes.find((c) => c.category === selectedCategory)?.change;
            const merchants = merchantsQuery.data ?? [];
            const top = Math.max(...merchants.map((m) => m.total.minor_units), 1);
            const color = getCategoryColor(selectedCategory);
            return <>
              <HeroAmount value={{ ...facts.current.spending, minor_units: Math.round(categoryTotal * 100) }} className="text-5xl" />
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                <span>{share}% of {formatMoney(facts.current.spending)}</span>
                {change && <Badge tone={change.minor_units >= 0 ? 'warm' : 'calm'} className="font-mono gap-1">
                  <SignedChange change={change} /> vs last month
                </Badge>}
              </div>
              <div className="mt-4 h-2 rounded-full bg-foreground/10 overflow-hidden" aria-hidden>
                <div className="h-full rounded-full" style={{ width: `${share}%`, background: color }} />
              </div>
              <h3 className="mt-8 mb-1 text-2xs uppercase tracking-[0.22em] text-muted font-mono font-semibold">Where in {selectedCategory}</h3>
              {merchantsQuery.data && merchants.length ? (
                <ul className="divide-y divide-border">
                  {merchants.map((m) => (
                    <li key={m.merchant}>
                      <Link to={withReturn(evidenceLink(facts.current, selectedCategory, 'spending', m.merchant))} className="flex min-h-14 flex-col justify-center gap-1.5 py-2 active:bg-foreground/5">
                        <span className="flex justify-between text-sm"><span className="truncate">{m.merchant}</span><span className="font-mono tabular-nums">{formatMoney(m.total)}</span></span>
                        <span className="h-1.5 rounded-full" style={{ width: `${Math.max(4, (m.total.minor_units / top) * 100)}%`, background: `color-mix(in srgb, ${color} 70%, transparent)` }} aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : merchantList}
            </>;
          })()}
        </DrillSheet>
        <DrillSheet open={drill === 'changed'} onOpenChange={(open) => !open && closeDrill()} backLabel="Home" title="What changed" description={`${facts.comparison_current.start}–${facts.comparison_current.end} against ${facts.previous.start}–${facts.previous.end}`}>
          {renderChanged(true)}
        </DrillSheet>
        <DrillSheet open={drill === 'attention'} onOpenChange={(open) => !open && closeDrill()} backLabel="Home" title="Needs attention">
          {attentionBody}
        </DrillSheet>
      </>
    );
  }
  return (
    <div className={PAGE}>
      {header(<p className="text-muted">Through {facts.as_of} · {facts.timezone}{refreshing && <span role="status"> · Updating…</span>}</p>)}
      {query.isError && <p role="alert" className="text-warning">Couldn’t refresh. This briefing may be out of date. <Button type="button" variant="link" size="sm" className="h-auto min-h-11 p-0 align-baseline" onClick={() => void query.refetch()}>Retry</Button></p>}

      <div className={BAND}>
        <HeroCard
          title="Where it went"
          className="lg:col-span-8"
          glowColor={overTarget ? 'coral' : 'warm'}
          action={<Button asChild variant="ghost" size="sm"><Link to={withReturn(evidenceLink(facts.current))}>See spending<ArrowRight size={14} aria-hidden /></Link></Button>}
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
            <HeroAmount value={facts.current.spending} className="text-3xl md:text-4xl" />
            {changeBadges}
          </div>
          <p className="mt-1.5 text-sm text-muted">{facts.current.status === 'partial' ? 'Known spending subtotal · some amounts or dates need review.' : facts.current.status === 'indicative' ? 'Recorded spending · includes indicative currency conversions.' : 'Recorded spending this month'}</p>
          <p className="mt-1 text-sm">{facts.change ? `${formatMoneyAbs(facts.change)} ${facts.change.minor_units >= 0 ? 'more' : 'less'} than the comparable period last month.` : 'A comparison is unavailable while some records need review.'}</p>
          <p className="text-xs text-muted">Comparing {facts.comparison_current.start}–{facts.comparison_current.end} with {facts.previous.start}–{facts.previous.end}.</p>

          <div className="mt-5 pt-5 border-t border-border">
            {breakdownQuery.data ? (
              <>
                {breakdownQuery.isError && <p className="text-xs text-warning mb-2">Couldn't refresh the category mix — showing the last loaded data. <Button type="button" variant="link" size="sm" className="h-auto min-h-11 p-0 align-baseline" onClick={() => void breakdownQuery.refetch()}>Retry</Button></p>}
                <CategoryDonut
                  data={categoryTotals}
                  selected={selectedCategory}
                  onSelect={setSelectedCategory}
                  onViewTransactions={(category) => navigate(withReturn(evidenceLink(facts.current, category)))}
                  showLegend
                  layout="row"
                />
                {selectedCategory && (
                  <div className="mt-6 pt-4 border-t border-border space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <StatusDot color={getCategoryColor(selectedCategory)} />
                        <span className="font-display text-lg font-semibold">{selectedCategory}</span>
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedCategory(null)}>Clear selection</Button>
                    </div>
                    {merchantList}
                    <Link
                      className="text-sm text-teal min-h-11 inline-flex items-center gap-1"
                      to={withReturn(evidenceLink(facts.current, selectedCategory))}
                    >
                      View transactions <ArrowRight size={14} />
                    </Link>
                  </div>
                )}
              </>
            ) : breakdownQuery.isLoading ? (
              <Skeleton className="h-[220px] w-full" />
            ) : (
              <p className="text-sm text-muted">Couldn't load the category mix. <Button type="button" variant="link" size="sm" className="h-auto min-h-11 p-0 align-baseline" onClick={() => void breakdownQuery.refetch()}>Retry</Button></p>
            )}
          </div>
        </HeroCard>

        {/* Stretched to the hero's height so the band has no trailing gap. */}
        <div className="lg:col-span-4 grid gap-4 md:gap-5 sm:grid-cols-3 lg:grid-cols-1">
          <StatCard
            label="Income"
            value={facts.current.income ? formatMoney(facts.current.income) : 'None yet'}
            color={facts.current.income ? 'teal' : 'default'}
            subtext={facts.current.income ? 'Recorded this month' : 'Captured income appears here'}
            href={withReturn(evidenceLink(facts.current, undefined, 'income'))}
          />
          <StatCard
            label="Net flow"
            value={facts.current.recorded_net_flow ? formatMoney(facts.current.recorded_net_flow) : 'Unavailable'}
            color={!facts.current.recorded_net_flow ? 'default' : netFlowNegative ? 'coral' : 'teal'}
            subtext={facts.current.recorded_net_flow
              ? `Recorded net ${netFlowNegative ? 'outflow' : 'flow'}`
              : facts.current.income ? 'Hidden while records need review' : 'No income recorded this month'}
          />
          {spending_target ? (
            <StatCard
              label={overTarget ? 'Over target' : 'Target left'}
              value={formatMoneyAbs(spending_target.remaining)}
              color={overTarget ? 'coral' : 'teal'}
              subtext={overTarget
                ? `${formatMoneyAbs(spending_target.remaining)} over your ${formatMoney(spending_target.target)} monthly target.`
                : `${formatMoney(spending_target.remaining)} remaining of your ${formatMoney(spending_target.target)} monthly target.`}
              href="/plan"
            />
          ) : (
            <StatCard label="Overall budget" value="Not set" subtext="Set one in Plan to track pace." href="/plan" />
          )}
        </div>
      </div>

      <div className={BAND}>
          <PageCard title="Daily trend" className="lg:col-span-8">
            {trendQuery.data ? (
              <>
                {trendQuery.isError && <p className="text-xs text-warning mb-1">Couldn't refresh the daily trend — showing the last loaded data. <Button type="button" variant="link" size="sm" className="h-auto min-h-11 p-0 align-baseline" onClick={() => void trendQuery.refetch()}>Retry</Button></p>}
                <TrendLine data={trendPoints} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
                {selectedDate && <Link className="text-sm text-teal min-h-11 inline-flex items-center mt-1" to={withReturn(`/evidence?start=${selectedDate}&end=${selectedDate}&measure=spending`)}>View this day's records</Link>}
              </>
            ) : trendQuery.isLoading ? (
              <Skeleton className="h-[160px] w-full" />
            ) : (
              <p className="text-sm text-muted">Couldn't load the daily trend. <Button type="button" variant="link" size="sm" className="h-auto min-h-11 p-0 align-baseline" onClick={() => void trendQuery.refetch()}>Retry</Button></p>
            )}
          </PageCard>
          <PageCard title="What changed" className="lg:col-span-4">
            {renderChanged(false)}
          </PageCard>
      </div>

      <div className="grid gap-4 md:gap-5 md:grid-cols-2 xl:grid-cols-3">
        <PageCard title="Coming up" action={<Button asChild variant="ghost" size="sm"><Link to="/plan">Open plan<ArrowRight size={14} aria-hidden /></Link></Button>}>
          {upcomingBody}
        </PageCard>
        <PageCard title="Needs attention">
          {attentionBody}
        </PageCard>

      <PageCard title="Recent activity" className="md:col-span-2 xl:col-span-1" contentClassName="p-0" action={<Button asChild variant="ghost" size="sm"><Link to="/transactions">All activity<ArrowRight size={14} aria-hidden /></Link></Button>}>
        {recent.map(item => (
          <ActivityRowShell
            key={item.id}
            category={item.category}
            isIncome={item.type === 'income'}
            href={transactionLink(item.id)}
            title={item.merchant || 'Unnamed transaction'}
            metaPrimary={item.date?.slice(0, 10) ?? 'Date unknown'}
            amount={item.amount ? formatMoney(item.amount) : 'Amount unresolved'}
            amountSub={item.conversion_status === 'indicative' ? 'Indicative' : undefined}
          />
        ))}
        {!recent.length && <p className="text-muted p-4">Your captured purchases will appear here. Add a transaction or connect a source to begin.</p>}
      </PageCard>
      </div>
    </div>
  );
}
