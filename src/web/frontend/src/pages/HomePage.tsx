import { useId, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Plus } from 'lucide-react';
import { briefingApi, evidenceLink, formatMoney } from '@/api/briefing';
import { api } from '@/api/client';
import { datesInRange, getCategoryColor } from '@/lib/utils';
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

const PAGE = 'p-4 md:p-6 space-y-4 md:space-y-5 max-w-[1600px] text-base';
const BAND = 'grid gap-4 md:gap-5 lg:grid-cols-12';

export function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useSearchParams();
  // Category and day selections live in the URL (replace-history) so the
  // evidence → correction → Back journey returns to the same selection.
  const setParam = (key: 'category' | 'day', value: string | null) => {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value); else next.delete(key);
    setSearch(next, { replace: true });
  };
  const setSelectedCategory = (value: string | null) => setParam('category', value);
  const setSelectedDate = (value: string | null) => setParam('day', value);
  const withReturn = (href: string) => `${href}&returnTo=${encodeURIComponent(location.pathname + location.search)}`;
  const transactionLink = (id: number) => `/transactions/${id}?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
  const [selectedChangeCategory, setSelectedChangeCategory] = useState<string | null>(null);
  const [showMoreChange, setShowMoreChange] = useState(false);
  const moreChangeId = useId();
  const query = useQuery({ queryKey: ['home-briefing'], queryFn: briefingApi.home });
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
    <div className={PAGE}>
      {header(null)}
      <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div>
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
  const categoryTotals = breakdownQuery.data
    ? Object.entries(breakdownQuery.data.by_category).map(([category, amount]) => ({ category, total: amount.minor_units / 100 }))
    : [];
  // The API lists days newest-first and omits days with no records; the
  // chart needs every day of the period in order, with those as recorded $0.
  const trendPoints = trendQuery.data && currentStart && currentEnd ? datesInRange(currentStart, currentEnd).map((date) => {
    const day = trendQuery.data!.find((d) => d.date === date);
    return { date, amount: day ? day.spending.minor_units / 100 : 0 };
  }) : [];
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
            {facts.change && <Badge tone={facts.change.minor_units >= 0 ? 'warm' : 'calm'} className="font-mono">
              {facts.change.minor_units >= 0 ? '▲' : '▼'} {formatMoney({ ...facts.change, minor_units: Math.abs(facts.change.minor_units) })}
            </Badge>}
            {spending_target && <Badge tone={overTarget ? 'warm' : 'saved'} className="font-mono">
              {overTarget ? 'over target' : 'under target'}
            </Badge>}
          </div>
          <p className="mt-1.5 text-sm text-muted">{facts.current.status === 'partial' ? 'Known spending subtotal · some amounts or dates need review.' : facts.current.status === 'indicative' ? 'Recorded spending · includes indicative currency conversions.' : 'Recorded spending this month'}</p>
          <p className="mt-1 text-sm">{facts.change ? `${formatMoney({ ...facts.change, minor_units: Math.abs(facts.change.minor_units) })} ${facts.change.minor_units >= 0 ? 'more' : 'less'} than the comparable period last month.` : 'A comparison is unavailable while some records need review.'}</p>
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
              value={formatMoney({ ...spending_target.remaining, minor_units: Math.abs(spending_target.remaining.minor_units) })}
              color={overTarget ? 'coral' : 'teal'}
              subtext={overTarget
                ? `${formatMoney({ ...spending_target.remaining, minor_units: Math.abs(spending_target.remaining.minor_units) })} over your ${formatMoney(spending_target.target)} monthly target.`
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
            {(() => {
              // Lead with the strongest change and its evidence; the rest of the
              // explanation sits behind "More context". Bars share one scale so
              // nothing rescales when context expands.
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
              return <>
                {changes.length
                  ? <div data-testid="category-change-bars">{changeRow(changes[0])}</div>
                  : <p className="text-muted">{facts.change ? 'No category spending changes in these periods.' : 'Resolve the records needing attention to compare categories.'}</p>}
                {hasMore && <Button
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
                {showMoreChange && <div id={moreChangeId}>
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
            })()}
          </PageCard>
      </div>

      <div className="grid gap-4 md:gap-5 md:grid-cols-2 xl:grid-cols-3">
        <PageCard title="Coming up" action={<Button asChild variant="ghost" size="sm"><Link to="/plan">Open plan<ArrowRight size={14} aria-hidden /></Link></Button>}>
          <p>{formatMoney(upcoming_total)} in estimated charges over the next 14 days.</p>
          {!!upcoming_unknown_count && <p className="text-warning">{upcoming_unknown_count} expected charges have no amount yet.</p>}
          {upcoming.map(item => <div key={item.id} className="flex justify-between gap-4 py-3 border-b border-border last:border-0"><div>{item.label}<p className="text-sm text-muted">{item.date}</p></div><span>{item.amount ? formatMoney(item.amount) : 'Amount unknown'}</span></div>)}
          {!upcoming.length && <p className="text-muted mt-3">No pending charges are recorded for these dates. Add subscriptions in Plan to track them.</p>}
          {!!increased_commitments.length && <div className="mt-4 pt-4 border-t border-border space-y-2">
            <p className="font-medium">Recently increased</p>
            {increased_commitments.map(change => <p key={change.subscription_id}>{change.label}: {formatMoney(change.old_amount)} → {formatMoney(change.new_amount)} (<strong>+{formatMoney(change.change)}</strong>, {formatMoney(change.annualized_impact)}/year)</p>)}
          </div>}
        </PageCard>
        <PageCard title="Needs attention">
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
