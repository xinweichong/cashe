import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { evidenceLink, formatMoney, formatMoneyAbs, type Money } from '@/api/briefing';
import { api } from '@/api/client';
import { cn, datesInRange, formatShortDate, getCategoryColor } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/StatusDot';
import { CategoryAvatar } from '@/components/ui/CategoryAvatar';
import { ListGroup, ListRow } from '@/components/ui/list';
import { NavBar } from '@/components/ui/nav-bar';
import { SpectrumCard, SpectrumCardSkeleton } from '@/components/ui/SpectrumCard';
import { LoadFailed, RetryLink } from '@/components/ui/LoadFailed';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendLine } from '@/components/charts/TrendLine';
import { CategoryDonut } from '@/components/charts/CategoryDonut';
import { CategoryChangeBarRow } from '@/components/charts/CategoryChangeBars';
import { ProfileMenu } from '@/components/layout/ProfileMenu';
import { useIsPhone } from '@/hooks/useIsPhone';
import { useHomeBriefing } from '@/hooks/useBriefing';
import { useUrlParams } from '@/hooks/useUrlParams';

// Home is "now" (HIG alignment, 2026-10-01): this month so far, what needs a
// look, and the next 7 days. The month's spending against budget is the
// screen's one spectrum card; everything else is grouped lists. What's coming
// belongs to Plan and the full record to Activity, so Home previews both and
// links on. One scrolling page at every size: on a phone the groups stack in
// priority order; from lg they split into a main column and a side column.

const COMING_UP_DAYS = 7;
const PREVIEW_ROWS = 3;

// On a phone the two column wrappers dissolve (display: contents) so each
// group takes its own order in one stack; from lg they are real columns.
const COLUMNS = 'flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]';
const COLUMN = 'contents lg:flex lg:flex-col lg:gap-6';

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthName(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-SG', { month: 'long', timeZone: 'UTC' });
}

/** A group's free-form content (charts, explanations) inside the list surface. */
function GroupBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('p-4', className)}>{children}</div>;
}

const dot = (node: ReactNode) => <span className="flex w-8 justify-center">{node}</span>;

export function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isPhone = useIsPhone();
  // Category and day selections live in the URL (replace-history) so the
  // evidence → correction → Back journey returns to the same selection.
  const [search, updateParams] = useUrlParams();
  const setSelectedCategory = (value: string | null) => updateParams({ category: value || null });
  const setSelectedDate = (value: string | null) => updateParams({ day: value || null });
  const here = location.pathname + location.search;
  const withReturn = (href: string) => `${href}&returnTo=${encodeURIComponent(here)}`;
  const transactionLink = (id: number) => `/transactions/${id}?returnTo=${encodeURIComponent(here)}`;
  const [selectedChangeCategory, setSelectedChangeCategory] = useState<string | null>(null);
  const [showMoreChange, setShowMoreChange] = useState(false);
  const moreChangeId = useId();
  const query = useHomeBriefing();
  const currentStart = query.data?.facts.current.start;
  const currentEnd = query.data?.facts.current.end;
  // Both charts read start/end scoped to facts.current — the exact period the
  // spectrum card covers — and are built on the same spending_facts rules, so
  // chart and card totals always reconcile for an identical period.
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
  // Stable across re-renders so the donut's sweep plays once.
  const categoryTotals = useMemo(() => breakdownQuery.data
    ? Object.entries(breakdownQuery.data.by_category).map(([category, amount]) => ({ category, total: amount.minor_units / 100 }))
    : [], [breakdownQuery.data]);

  const navBar = (
    <NavBar
      large
      title="Home"
      trailing={<>
        {/* A bare + on a phone (iOS nav bar); labelled on md+ (Mac toolbar). */}
        <Button asChild variant="ghost" size={isPhone ? 'icon' : 'sm'} className="min-h-11 min-w-11 gap-1.5 text-teal" aria-label={isPhone ? 'Add a transaction' : undefined}>
          <Link to="/transactions?add=1"><Plus aria-hidden className="h-5 w-5" />{!isPhone && 'Add'}</Link>
        </Button>
        {/* On md+ the profile lives in the sidebar. */}
        {isPhone && <ProfileMenu />}
      </>}
    />
  );
  const page = (children: ReactNode) => (
    <div className="mx-auto max-w-[1200px] md:px-2">
      {navBar}
      {/* px-4 matches the NavBar's large title, so title and content share an edge. */}
      <div className="space-y-6 px-4 pb-8">{children}</div>
    </div>
  );

  if (!query.data && query.isError) return page(
    <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div>,
  );
  if (!query.data) return page(
    <div role="status" aria-label="Preparing your briefing" className="space-y-6">
      <Skeleton className="h-4 w-48" />
      <SpectrumCardSkeleton />
      <Skeleton className="h-40 rounded-group" />
      <Skeleton className="h-56 rounded-group" />
    </div>,
  );

  const { facts, spending_target, freshness, recent, upcoming, upcoming_unknown_count, increased_commitments, capture_issue_count, followup_issue_count, review_count, recurring_suggestion_count } = query.data;
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
  const soonUntil = addDays(facts.as_of, COMING_UP_DAYS);
  const soon = upcoming.filter((item) => item.date <= soonUntil);
  const sourcesNeedCare = freshness.gmail_needs_reconnection || !freshness.gmail_connected;
  const amountOrUnknown = (money: Money | null | undefined, unknown: string) => money ? { amount: formatMoney(money) } : { value: unknown };

  // ── The month: spectrum card and what qualifies it ─────────────────────────
  const spendingCaption = spending_target
    ? overTarget ? `${formatMoneyAbs(spending_target.remaining)} over budget` : `${formatMoney(spending_target.remaining)} left`
    : facts.change ? `${formatMoneyAbs(facts.change)} ${facts.change.minor_units >= 0 ? 'more' : 'less'} than last month by this date` : undefined;
  const month = (
    <div className="space-y-2">
      <SpectrumCard
        label={monthName(facts.current.start)}
        meta={spending_target ? `Budget ${formatMoney(spending_target.target)}` : 'So far'}
        value={formatMoney(facts.current.spending)}
        caption={spendingCaption}
        progress={spending_target && spending_target.target.minor_units > 0 ? facts.current.spending.minor_units / spending_target.target.minor_units : undefined}
        progressLabel="Budget used"
        status={facts.current.status === 'partial' ? 'partial' : 'complete'}
      />
      <div className="px-1 text-sm">
        <p className="text-muted">{facts.current.status === 'partial' ? 'Known spending subtotal · some amounts or dates need review.' : facts.current.status === 'indicative' ? 'Recorded spending · includes indicative currency conversions.' : 'Recorded spending this month'}</p>
        <p>{facts.change ? `${formatMoneyAbs(facts.change)} ${facts.change.minor_units >= 0 ? 'more' : 'less'} than the comparable period last month.` : 'A comparison is unavailable while some records need review.'}</p>
        <p className="text-xs text-muted">Comparing {facts.comparison_current.start}–{facts.comparison_current.end} with {facts.previous.start}–{facts.previous.end}.</p>
      </div>
    </div>
  );

  // ── Needs a look ───────────────────────────────────────────────────────────
  const needsALook = (
    <ListGroup
      title="Needs a look"
      footer={<>{freshness.last_capture_processed_at ? `Last capture processed: ${freshness.last_capture_processed_at}.` : 'No capture has been processed yet.'} Recent checks do not prove every purchase was captured.</>}
    >
      <ListRow to="/review" leading={dot(<StatusDot tone={capture_issue_count + followup_issue_count ? 'notable' : 'calm'} />)} title={`${capture_issue_count + followup_issue_count} capture or follow-up items`} trailing="chevron" />
      {!!unresolved && <ListRow to={withReturn(evidenceLink(facts.current, undefined, 'unresolved'))} leading={dot(<StatusDot tone="warm" />)} title={`Review ${unresolved} spending records with unresolved amounts or dates`} trailing="chevron" />}
      {!!review_count && <ListRow to="/review" leading={dot(<StatusDot tone="notable" />)} title={`${review_count} spending records need review`} trailing="chevron" />}
      {!!recurring_suggestion_count && <ListRow to="/review" leading={dot(<StatusDot tone="calm" />)} title={`${recurring_suggestion_count} recurring suggestions`} trailing="chevron" />}
      <ListRow
        to="/settings"
        leading={dot(<StatusDot tone={sourcesNeedCare ? 'warm' : 'calm'} />)}
        title="Sources"
        subtitle={freshness.gmail_needs_reconnection ? 'Gmail needs reconnection.' : freshness.gmail_connected ? `Gmail last checked: ${freshness.gmail_last_checked ?? 'not checked in this session'}.` : 'Gmail is not connected in this session.'}
        value="Manage"
        trailing="chevron"
      />
    </ListGroup>
  );

  // ── This month's other figures ─────────────────────────────────────────────
  const thisMonth = (
    <ListGroup title="This month">
      <ListRow
        to={withReturn(evidenceLink(facts.current, undefined, 'income'))}
        title="Income"
        subtitle={facts.current.income ? 'Recorded this month' : 'Captured income appears here'}
        {...amountOrUnknown(facts.current.income, 'None yet')}
        trailing="chevron"
      />
      <ListRow
        title="Net flow"
        subtitle={facts.current.recorded_net_flow
          ? `Recorded net ${netFlowNegative ? 'outflow' : 'flow'}`
          : facts.current.income ? 'Hidden while records need review' : 'No income recorded this month'}
        {...amountOrUnknown(facts.current.recorded_net_flow, 'Unavailable')}
      />
      {spending_target ? (
        <ListRow
          to="/plan"
          title={overTarget ? 'Over target' : 'Target left'}
          subtitle={overTarget
            ? `${formatMoneyAbs(spending_target.remaining)} over your ${formatMoney(spending_target.target)} monthly target.`
            : `${formatMoney(spending_target.remaining)} remaining of your ${formatMoney(spending_target.target)} monthly target.`}
          amount={formatMoneyAbs(spending_target.remaining)}
          trailing="chevron"
        />
      ) : (
        <ListRow to="/plan" title="Overall budget" subtitle="Set one in Plan to track pace." value="Not set" trailing="chevron" />
      )}
    </ListGroup>
  );

  // ── Where it went: the category mix, with a selection's merchants ──────────
  const merchantList = selectedCategory && <>
    {merchantsQuery.data ? (
      <>
        {merchantsQuery.isError && <p className="text-xs text-warning">Couldn't refresh merchants for {selectedCategory} — showing the last loaded data. <RetryLink onRetry={() => void merchantsQuery.refetch()} /></p>}
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
      <p className="text-sm text-muted">Couldn't load merchants for {selectedCategory}. <RetryLink onRetry={() => void merchantsQuery.refetch()} /></p>
    )}
  </>;
  const whereItWent = (
    <ListGroup title="Where it went" action={<Link className="inline-flex min-h-11 items-center text-teal" to={withReturn(evidenceLink(facts.current))}>See spending</Link>}>
      <GroupBody>
        {breakdownQuery.data ? (
          <>
            {breakdownQuery.isError && <p className="mb-2 text-xs text-warning">Couldn't refresh the category mix — showing the last loaded data. <RetryLink onRetry={() => void breakdownQuery.refetch()} /></p>}
            <CategoryDonut
              data={categoryTotals}
              selected={selectedCategory}
              onSelect={setSelectedCategory}
              onViewTransactions={(category) => navigate(withReturn(evidenceLink(facts.current, category)))}
              showLegend
              layout="row"
              size={isPhone ? 'compact' : undefined}
            />
            {selectedCategory && (
              <div className="mt-5 space-y-3 border-t-[0.5px] border-separator pt-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <StatusDot color={getCategoryColor(selectedCategory)} />
                    <span className="font-display text-lg font-bold">{selectedCategory}</span>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedCategory(null)}>Clear selection</Button>
                </div>
                {merchantList}
                <Link className="inline-flex min-h-11 items-center text-sm text-teal" to={withReturn(evidenceLink(facts.current, selectedCategory))}>
                  View transactions
                </Link>
              </div>
            )}
          </>
        ) : breakdownQuery.isLoading ? (
          <Skeleton className="h-[220px] w-full" />
        ) : (
          <p className="text-sm text-muted">Couldn't load the category mix. <RetryLink onRetry={() => void breakdownQuery.refetch()} /></p>
        )}
      </GroupBody>
    </ListGroup>
  );

  // ── Daily trend ────────────────────────────────────────────────────────────
  const dailyTrend = (
    <ListGroup title="Daily trend">
      <GroupBody className="pb-2">
        {trendQuery.data ? (
          <>
            {trendQuery.isError && <p className="mb-1 text-xs text-warning">Couldn't refresh the daily trend — showing the last loaded data. <RetryLink onRetry={() => void trendQuery.refetch()} /></p>}
            <TrendLine data={trendPoints} selectedDate={selectedDate} onSelectDate={setSelectedDate} chartHeight={isPhone ? 140 : undefined} />
            {selectedDate && <Link className="mt-1 inline-flex min-h-11 items-center text-sm text-teal" to={withReturn(`/evidence?start=${selectedDate}&end=${selectedDate}&measure=spending`)}>View this day's records</Link>}
          </>
        ) : trendQuery.isLoading ? (
          <Skeleton className="h-[160px] w-full" />
        ) : (
          <p className="text-sm text-muted">Couldn't load the daily trend. <RetryLink onRetry={() => void trendQuery.refetch()} /></p>
        )}
      </GroupBody>
    </ListGroup>
  );

  // ── What changed: the strongest change, the rest behind a disclosure ───────
  const changes = facts.category_changes.slice(0, 3);
  const maxChange = Math.max(...changes.map((c) => Math.abs(c.change.minor_units)), 1);
  const changeRow = (item: typeof changes[number]) => <div key={item.category} className="border-b-[0.5px] border-separator py-1 last:border-0">
    <CategoryChangeBarRow datum={item} max={maxChange} selected={selectedChangeCategory === item.category} onSelect={setSelectedChangeCategory} />
    <div className="flex gap-6 pb-2 pl-2">
      <Link className="inline-flex min-h-11 items-center text-teal" to={withReturn(evidenceLink(facts.comparison_current, item.category))}>This period</Link>
      <Link className="inline-flex min-h-11 items-center text-teal" to={withReturn(evidenceLink(facts.previous, item.category))}>Previous period</Link>
    </div>
  </div>;
  const hasMore = changes.length > 1 || !!driver || !!facts.trip_drivers.length;
  const whatChanged = (
    <ListGroup title="What changed">
      <GroupBody>
        {changes.length
          ? <div data-testid="category-change-bars">{changeRow(changes[0])}</div>
          : <p className="text-muted">{facts.change ? 'No category spending changes in these periods.' : 'Resolve the records needing attention to compare categories.'}</p>}
        {hasMore && <Button type="button" variant="ghost" size="sm" className="mt-2" aria-expanded={showMoreChange} aria-controls={moreChangeId} onClick={() => setShowMoreChange((open) => !open)}>
          {showMoreChange ? 'Less context' : 'More context'}
        </Button>}
        {showMoreChange && <div id={moreChangeId}>
          {changes.length > 1 && <div className="mt-2">{changes.slice(1).map(changeRow)}</div>}
          {driver && <div className="mt-4 space-y-3 border-t-[0.5px] border-separator pt-4">
            <p className="text-sm text-muted">{driver.overlap_note}</p>
            {driver.merchant_driver && <p>Biggest contributor in {driver.category}: <Link className="text-teal underline" to={withReturn(evidenceLink(facts.comparison_current, driver.category, 'spending', driver.merchant_driver.merchant))}>{driver.merchant_driver.merchant}</Link> (<strong>{formatMoney(driver.merchant_driver.change)}</strong> change)</p>}
            {driver.frequency_driver && driver.frequency_driver.classification !== 'none' && <p>
              {driver.frequency_driver.classification === 'frequency' && `Driven mostly by more purchases: ${driver.frequency_driver.current_count} this period vs ${driver.frequency_driver.previous_count} previously, at a similar average.`}
              {driver.frequency_driver.classification === 'size' && `Driven mostly by bigger purchases: average ${formatMoney(driver.frequency_driver.current_avg)} this period vs ${formatMoney(driver.frequency_driver.previous_avg)} previously, at a similar count.`}
              {driver.frequency_driver.classification === 'mixed' && `Both purchase count (${driver.frequency_driver.previous_count} → ${driver.frequency_driver.current_count}) and average size (${formatMoney(driver.frequency_driver.previous_avg)} → ${formatMoney(driver.frequency_driver.current_avg)}) changed.`}
            </p>}
            {driver.one_off_driver && <p>Largely one purchase: <Link className="text-teal underline" to={transactionLink(driver.one_off_driver.transaction_id)}>{driver.one_off_driver.merchant || 'Unnamed transaction'}</Link> for <strong>{formatMoney(driver.one_off_driver.amount)}</strong> on {driver.one_off_driver.date}.</p>}
          </div>}
          {!!facts.trip_drivers.length && <div className="mt-4 space-y-3 border-t-[0.5px] border-separator pt-4">
            {facts.trip_drivers.map(trip => <p key={trip.trip_id}>Trip <Link className="text-teal underline" to={`/transactions?trip=${trip.trip_id}&start=${facts.current.start}&end=${facts.comparison_current.end}`}>{trip.name}</Link>: {formatMoney(trip.current_total)} this period ({formatMoney(trip.previous_total)} previously). <span className="text-sm text-muted">{trip.overlap_note}</span></p>)}
          </div>}
        </div>}
      </GroupBody>
    </ListGroup>
  );

  // ── Coming up: the next 7 days; Plan owns the full timeline ────────────────
  const comingUp = <>
    <ListGroup
      title="Coming up"
      action={<Link className="inline-flex min-h-11 items-center text-teal" to="/plan">See Plan</Link>}
      footer={upcoming_unknown_count ? `${upcoming_unknown_count} expected charges have no amount yet. Every amount is an estimate.` : 'Every amount is an estimate.'}
    >
      {soon.slice(0, PREVIEW_ROWS).map((item) => (
        <ListRow key={item.id} title={item.label} subtitle={formatShortDate(item.date)} {...amountOrUnknown(item.amount, 'Amount unknown')} />
      ))}
      {soon.length > PREVIEW_ROWS && <ListRow to="/plan" title={`${soon.length - PREVIEW_ROWS} more in the next ${COMING_UP_DAYS} days`} trailing="chevron" />}
      {!soon.length && <ListRow title={`Nothing due in the next ${COMING_UP_DAYS} days`} subtitle="Add subscriptions in Plan to track them." />}
    </ListGroup>
    {!!increased_commitments.length && (
      <ListGroup title="Recently increased">
        {increased_commitments.map((change) => (
          <ListRow
            key={change.subscription_id}
            to="/plan"
            title={change.label}
            subtitle={`${formatMoney(change.old_amount)} → ${formatMoney(change.new_amount)} · ${formatMoney(change.annualized_impact)}/year`}
            amount={`+${formatMoney(change.change)}`}
            trailing="chevron"
          />
        ))}
      </ListGroup>
    )}
  </>;

  // ── Recent: a preview; Activity owns the record ────────────────────────────
  const recentGroup = (
    <ListGroup title="Recent" action={<Link className="inline-flex min-h-11 items-center text-teal" to="/activity">See all</Link>}>
      {recent.slice(0, PREVIEW_ROWS).map((item) => (
        <ListRow
          key={item.id}
          to={transactionLink(item.id)}
          leading={<CategoryAvatar category={item.category} isIncome={item.type === 'income'} />}
          title={item.merchant || 'Unnamed transaction'}
          subtitle={[item.date ? formatShortDate(item.date) : 'Date unknown', item.category, item.conversion_status === 'indicative' ? 'Indicative' : null].filter(Boolean).join(' · ')}
          {...amountOrUnknown(item.amount, 'Amount unresolved')}
        />
      ))}
      {!recent.length && <ListRow title="Nothing captured yet" subtitle="Your captured purchases will appear here. Add a transaction or connect a source to begin." />}
    </ListGroup>
  );

  return page(<>
    <p className="-mt-1 text-sm text-muted">Through {facts.as_of} · {facts.timezone}{refreshing && <span role="status"> · Updating…</span>}</p>
    {query.isError && <p role="alert" className="text-warning">Couldn’t refresh. This briefing may be out of date. <RetryLink onRetry={() => void query.refetch()} /></p>}
    <div className={COLUMNS}>
      <div className={COLUMN}>
        <div className="order-1">{month}</div>
        <div className="order-4">{whereItWent}</div>
        <div className="order-7">{dailyTrend}</div>
        <div className="order-8">{whatChanged}</div>
      </div>
      <div className={COLUMN}>
        <div className="order-2">{needsALook}</div>
        <div className="order-3">{thisMonth}</div>
        <div className="order-5 space-y-6">{comingUp}</div>
        <div className="order-6">{recentGroup}</div>
      </div>
    </div>
  </>);
}
