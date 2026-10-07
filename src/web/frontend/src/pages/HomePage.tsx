import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/api/client';
import { evidenceLink, formatMoney, formatMoneyAbs, type HomeBriefing, type Money } from '@/api/briefing';
import { cn, datesInRange, formatShortDate, getCategoryTextColor } from '@/lib/utils';
import { changeTone, MONEY_TONE_CLASS } from '@/lib/moneyTone';
import { SignedChange } from '@/components/ui/SignedChange';
import { CategoryDonut } from '@/components/charts/CategoryDonut';
import { CategoryChangeBars } from '@/components/charts/CategoryChangeBars';
import { TrendLine } from '@/components/charts/TrendLine';
import { PhoneScreen, PhoneSummaryLine } from '@/components/layout/PhoneScreen';
import { useUrlParams } from '@/hooks/useUrlParams';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/StatusDot';
import { ListGroup, ListRow } from '@/components/ui/list';
import { NavBar } from '@/components/ui/nav-bar';
import { SpectrumCard, SpectrumCardSkeleton } from '@/components/ui/SpectrumCard';
import { StatCard } from '@/components/ui/StatCard';
import { PageCard } from '@/components/ui/cards';
import { CategoryAvatar } from '@/components/ui/CategoryAvatar';
import { AnimatedMoney } from '@/components/ui/AnimatedMoney';
import { LoadFailed, RetryLink } from '@/components/ui/LoadFailed';
import { Skeleton } from '@/components/ui/skeleton';
import { ProfileMenu } from '@/components/layout/ProfileMenu';
import { useIsPhone } from '@/hooks/useIsPhone';
import { useHomeBriefing } from '@/hooks/useBriefing';

// Home is "now": this month so far as the screen's one spectrum card, with
// its figures, trend and category mix, what needs a look, what is coming up
// and the latest purchases. One screen of views on a phone (HomePhone), the
// cockpit on iPad and desktop (HomeCockpit).

/** Fewer comparable days than this and a month-on-month change is noise. */
const MIN_COMPARE_DAYS = 7;

function daysInclusive(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

function monthName(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-SG', { month: 'long', timeZone: 'UTC' });
}

function shortMonth(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-SG', { month: 'short', timeZone: 'UTC' });
}

/** "1 Oct, 3:05 pm" for a capture timestamp. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const dot = (node: ReactNode) => <span className="flex w-8 justify-center">{node}</span>;

export function HomePage() {
  const location = useLocation();
  const isPhone = useIsPhone();
  const here = location.pathname + location.search;
  const withReturn = (href: string) => `${href}&returnTo=${encodeURIComponent(here)}`;
  const query = useHomeBriefing();

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

  if (isPhone) return <HomePhone navBar={navBar} withReturn={withReturn} />;

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

  const { facts, freshness, increased_commitments, capture_issue_count, followup_issue_count, review_count, recurring_suggestion_count } = query.data;
  const unresolved = facts.current.unresolved_count + facts.undated_count;
  const refreshing = query.isFetching;
  const sourcesNeedCare = freshness.gmail_needs_reconnection || !freshness.gmail_connected;
  const captureItems = capture_issue_count + followup_issue_count;
  const toReview = Math.max(unresolved, review_count);

  // ── Needs a look: only what actually does ──────────────────────────────────
  const needsALook = (
    <ListGroup
      title="Needs a look"
      footer={<>{freshness.last_capture_processed_at ? `Last capture ${formatWhen(freshness.last_capture_processed_at)}.` : 'Nothing captured yet.'} A recent check can’t prove every purchase was caught.</>}
    >
      {!!captureItems && <ListRow to="/review" leading={dot(<StatusDot tone="notable" />)} title={`${plural(captureItems, 'capture')} to check`} trailing="chevron" />}
      {/* This month's unresolved records are part of the all-history review
          count: one row, so one record is never listed twice. */}
      {!!toReview && <ListRow
        to={review_count >= unresolved ? '/review' : withReturn(evidenceLink(facts.current, undefined, 'unresolved'))}
        leading={dot(<StatusDot tone="warm" />)}
        title={`${plural(toReview, 'record')} to review`}
        subtitle="Missing a category, amount, currency rate or date"
        trailing="chevron"
      />}
      {!!recurring_suggestion_count && <ListRow to="/review" leading={dot(<StatusDot tone="calm" />)} title={plural(recurring_suggestion_count, 'possible subscription')} subtitle="Confirm or dismiss" trailing="chevron" />}
      {increased_commitments.map((change) => (
        <ListRow
          key={change.subscription_id}
          to="/plan"
          leading={dot(<StatusDot tone="warm" />)}
          title={`${change.label} went up`}
          subtitle={`${formatMoney(change.old_amount)} → ${formatMoney(change.new_amount)} · ${formatMoney(change.annualized_impact)} a year`}
          trailing="chevron"
        />
      ))}
      {sourcesNeedCare && (
        <ListRow
          to="/settings"
          leading={dot(<StatusDot tone="warm" />)}
          title={freshness.gmail_needs_reconnection ? 'Reconnect Gmail' : 'Connect Gmail'}
          subtitle={freshness.gmail_needs_reconnection ? 'Bank emails aren’t being read' : 'To capture bank emails automatically'}
          trailing="chevron"
        />
      )}
      {!captureItems && !toReview && !recurring_suggestion_count && !increased_commitments.length && !sourcesNeedCare && (
        <ListRow leading={dot(<StatusDot tone="calm" />)} title="All caught up" subtitle={freshness.gmail_last_checked ? `Gmail checked ${formatWhen(freshness.gmail_last_checked)}` : undefined} />
      )}
    </ListGroup>
  );

  return page(<>
    <p className="-mt-1 text-sm text-muted">As of {formatShortDate(facts.as_of)}{refreshing && <span role="status"> · Updating…</span>}</p>
    {query.isError && <p role="alert" className="text-warning">Couldn’t refresh. This may be out of date. <RetryLink onRetry={() => void query.refetch()} /></p>}
    <HomeCockpit data={query.data} needsALook={needsALook} withReturn={withReturn} />
  </>);
}

// ── iPad and desktop: the cockpit (approved 2026-10-07, desktop pass) ───────
// Everything the phone shows across Month, Trend and Changed, side by side:
// the month card and its figures, the daily trend and category mix, then what
// needs a look, what is coming up and the latest purchases. Two columns on
// iPad, twelve on desktop.

function HomeCockpit({ data, needsALook, withReturn }: { data: HomeBriefing; needsALook: ReactNode; withReturn: (href: string) => string }) {
  const navigate = useNavigate();
  const [day, setDay] = useState<string | null>(null);
  const { facts, spending_target, upcoming, recent } = data;
  const period = facts.current;
  const breakdown = useQuery({
    queryKey: ['home-category-breakdown', period.start, period.end],
    queryFn: () => api.getCategoryBreakdownV2(period.start, period.end),
  });
  const trend = useQuery({
    queryKey: ['home-daily-totals', period.start, period.end],
    queryFn: () => api.getDailyTotalsV2(period.start, period.end),
  });
  const overTarget = !!spending_target && spending_target.remaining.minor_units < 0;
  const netFlow = period.recorded_net_flow;
  const negative = !!netFlow && netFlow.minor_units < 0;
  const comparable = !!facts.change && daysInclusive(facts.comparison_current.start, facts.comparison_current.end) >= MIN_COMPARE_DAYS;
  const totals = breakdown.data ? Object.entries(breakdown.data.by_category).map(([category, amount]) => ({ category, total: amount.minor_units / 100 })) : [];
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-12 lg:items-stretch">
      <div className="md:col-span-2 lg:col-span-5">
        <SpectrumCard
          className="h-full"
          label={monthName(period.start)}
          meta={spending_target ? `Budget ${formatMoney(spending_target.target)}` : 'So far'}
          value={<AnimatedMoney value={period.spending} />}
          caption={spending_target
            ? overTarget ? `${formatMoneyAbs(spending_target.remaining)} over budget` : `${formatMoney(spending_target.remaining)} left`
            : <Link to="/plan" className="underline underline-offset-2">Set a monthly budget</Link>}
          progress={spending_target && spending_target.target.minor_units > 0 ? period.spending.minor_units / spending_target.target.minor_units : undefined}
          progressLabel="Budget used"
          status={period.status === 'partial' ? 'partial' : 'complete'}
        />
      </div>
      <StatCard className="lg:col-span-2" label="Income" href={withReturn(evidenceLink(period, undefined, 'income'))}
        value={period.income ? formatMoney(period.income) : 'None yet'} color={period.income ? 'teal' : 'default'} />
      <StatCard className="lg:col-span-2" label={negative ? 'Spent more than earned' : 'Left after spending'}
        value={netFlow ? formatMoneyAbs(netFlow) : '—'} color={!netFlow ? 'default' : negative ? 'coral' : 'teal'} />
      {/* No change means records need review first; a short month means it's too early. */}
      <StatCard className="md:col-span-2 lg:col-span-3" label={`vs ${monthName(facts.previous.start)}`}
        value={!facts.change ? 'Unavailable' : comparable ? <span className="inline-flex items-center gap-1"><SignedChange change={facts.change} /></span> : 'Too early'}
        color={comparable && facts.change ? (facts.change.minor_units > 0 ? 'coral' : 'teal') : 'default'}
        subtext={!facts.change ? 'Some records need review first' : comparable ? 'Same days last month' : `Compares from day ${MIN_COMPARE_DAYS}`} />

      <PageCard title="Daily spending" className="md:col-span-2 lg:col-span-8">
        {trend.data
          ? <TrendLine data={datesInRange(period.start, period.end).map((date) => {
              const found = trend.data!.find((d) => d.date === date);
              return { date, amount: found ? found.spending.minor_units / 100 : 0 };
            })} selectedDate={day} onSelectDate={setDay} chartHeight={180} />
          : trend.isError
            ? <p className="text-sm text-muted">Couldn’t load the daily trend. <RetryLink onRetry={() => void trend.refetch()} /></p>
            : <Skeleton className="h-[220px] w-full" />}
      </PageCard>
      <PageCard title="Where it went" className="lg:col-span-4" action={<Link to="/explore?mode=by-category" className="text-sm text-teal">Explore</Link>}>
        {breakdown.data
          ? <CategoryDonut data={totals} selected={null} onSelect={(c) => c && navigate(withReturn(evidenceLink(period, c)))} showLegend size="compact" />
          : breakdown.isError
            ? <p className="text-sm text-muted">Couldn’t load the category mix. <RetryLink onRetry={() => void breakdown.refetch()} /></p>
            : <Skeleton className="h-[112px] w-full" />}
      </PageCard>

      <div className="lg:col-span-4">{needsALook}</div>
      <ListGroup className="lg:col-span-4" title="Coming up" action={<Link to="/plan" className="text-teal">Plan</Link>}>
        {upcoming.length ? upcoming.slice(0, 4).map((item) => (
          <ListRow key={item.id} to="/plan" title={item.label} subtitle={formatShortDate(item.date)}
            {...(item.amount ? { amount: formatMoney(item.amount), amountTone: 'estimate' as const } : { value: 'Amount unknown' })} />
        )) : <ListRow title="Nothing scheduled" subtitle="Subscriptions’ charges appear here" />}
      </ListGroup>
      <ListGroup className="lg:col-span-4" title="Latest" action={<Link to="/activity" className="text-teal">Activity</Link>}>
        {recent.length ? recent.slice(0, 4).map((item) => (
          <ListRow key={item.id} to={`/activity/${item.id}`} leading={<CategoryAvatar category={item.category} className="rounded-full" />}
            title={item.merchant || 'Unnamed'}
            subtitle={<>{item.date ? formatShortDate(item.date) : 'Undated'} · <span style={{ color: getCategoryTextColor(item.category) }}>{item.category}</span></>}
            {...(item.amount ? { amount: formatMoney(item.amount) } : { value: 'Amount unresolved' })} />
        )) : <ListRow title="Nothing captured yet" />}
      </ListGroup>
    </div>
  );
}

// ── Phone: one screen (approved 2026-10-06, phone quick view) ────────────────
// The month's spectrum card and a status line, then Month (category mix and
// figures), Trend and Changed in place, switched from the thumb band.

const HOME_VIEWS = [
  { value: 'month', label: 'Month' },
  { value: 'trend', label: 'Trend' },
  { value: 'changed', label: 'Changed' },
] as const;
type HomeView = (typeof HOME_VIEWS)[number]['value'];

function HomePhone({ navBar, withReturn }: { navBar: ReactNode; withReturn: (href: string) => string }) {
  const query = useHomeBriefing();
  const navigate = useNavigate();
  const [search, updateParams] = useUrlParams();
  const viewParam = search.get('view');
  const view: HomeView = HOME_VIEWS.some((v) => v.value === viewParam) ? (viewParam as HomeView) : 'month';
  const [day, setDay] = useState<string | null>(null);
  const period = query.data?.facts.current;
  const breakdown = useQuery({
    queryKey: ['home-category-breakdown', period?.start, period?.end],
    queryFn: () => api.getCategoryBreakdownV2(period!.start, period!.end),
    enabled: !!period && view === 'month',
  });
  const trend = useQuery({
    queryKey: ['home-daily-totals', period?.start, period?.end],
    queryFn: () => api.getDailyTotalsV2(period!.start, period!.end),
    enabled: !!period && view === 'trend',
  });

  const panel = (body: ReactNode) => <div className="space-y-3 pb-2">{body}</div>;
  const views = (data: HomeBriefing | undefined) => HOME_VIEWS.map(({ value, label }) => ({
    value, label,
    panel: !data ? panel(<Skeleton className="h-64 rounded-group" />)
      : value === 'month' ? panel(<HomeMonth data={data} breakdown={breakdown} withReturn={withReturn} onCategory={(c) => navigate(withReturn(evidenceLink(data.facts.current, c)))} />)
      : value === 'trend' ? <HomeTrend data={data} trend={trend} day={day} onDay={setDay} withReturn={withReturn} />
      : panel(<HomeChanged data={data} onCategory={(c) => navigate(withReturn(evidenceLink(data.facts.comparison_current, c)))} />),
  }));

  const data = query.data;
  return (
    <PhoneScreen
      navBar={navBar}
      summary={data ? <HomeSummary data={data} isError={query.isError} onRetry={() => void query.refetch()} /> : query.isError
        ? <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div>
        : <div role="status" aria-label="Preparing your briefing"><SpectrumCardSkeleton /></div>}
      views={views(data)}
      view={view}
      onViewChange={(next) => updateParams({ view: next === 'month' ? null : next })}
      label="Home views"
    />
  );
}

function HomeSummary({ data, isError, onRetry }: { data: HomeBriefing; isError: boolean; onRetry: () => void }) {
  const { facts, spending_target, freshness, capture_issue_count, followup_issue_count, review_count, recurring_suggestion_count, increased_commitments } = data;
  const overTarget = !!spending_target && spending_target.remaining.minor_units < 0;
  const toCheck = capture_issue_count + followup_issue_count + Math.max(facts.current.unresolved_count + facts.undated_count, review_count) + recurring_suggestion_count + increased_commitments.length;
  const sourcesNeedCare = freshness.gmail_needs_reconnection || !freshness.gmail_connected;
  const comparable = !!facts.change && daysInclusive(facts.comparison_current.start, facts.comparison_current.end) >= MIN_COMPARE_DAYS;
  const status = toCheck
    ? <Link to="/review" className="inline-flex min-h-11 items-center gap-1.5 text-teal"><StatusDot tone="warm" />{toCheck} to check</Link>
    : sourcesNeedCare
      ? <Link to="/settings" className="inline-flex min-h-11 items-center gap-1.5 text-teal"><StatusDot tone="warm" />{freshness.gmail_needs_reconnection ? 'Reconnect Gmail' : 'Connect Gmail'}</Link>
      : <><StatusDot tone="calm" />All caught up</>;
  const change = isError
    ? <span role="alert" className="text-warning">Couldn’t refresh · <RetryLink onRetry={onRetry} /></span>
    : comparable && facts.change
      ? <><span className={cn('inline-flex items-center gap-0.5 font-mono font-medium', MONEY_TONE_CLASS[changeTone(facts.change.minor_units)])}><SignedChange change={facts.change} /></span>vs {shortMonth(facts.previous.start)}</>
      : <>As of {formatShortDate(facts.as_of)}</>;
  return (
    <>
      <SpectrumCard
        label={monthName(facts.current.start)}
        meta={spending_target ? `Budget ${formatMoney(spending_target.target)}` : 'So far'}
        value={<AnimatedMoney value={facts.current.spending} />}
        caption={spending_target ? overTarget ? `${formatMoneyAbs(spending_target.remaining)} over budget` : `${formatMoney(spending_target.remaining)} left` : undefined}
        progress={spending_target && spending_target.target.minor_units > 0 ? facts.current.spending.minor_units / spending_target.target.minor_units : undefined}
        progressLabel="Budget used"
        status={facts.current.status === 'partial' ? 'partial' : 'complete'}
      />
      <PhoneSummaryLine start={status} end={change} />
    </>
  );
}

function HomeMonth({ data, breakdown, withReturn, onCategory }: {
  data: HomeBriefing;
  breakdown: { data?: { by_category: Record<string, Money> }; isError: boolean; refetch: () => unknown };
  withReturn: (href: string) => string;
  onCategory: (category: string) => void;
}) {
  const { facts, upcoming, recent } = data;
  const netFlow = facts.current.recorded_net_flow;
  const negative = !!netFlow && netFlow.minor_units < 0;
  const next = upcoming[0];
  const latest = recent[0];
  const totals = breakdown.data ? Object.entries(breakdown.data.by_category).map(([category, amount]) => ({ category, total: amount.minor_units / 100 })) : [];
  return <>
    <ListGroup>
      <div className="p-3">
        {breakdown.data
          ? <CategoryDonut data={totals} selected={null} onSelect={(c) => c && onCategory(c)} showLegend size="compact" />
          : breakdown.isError
            ? <p className="text-sm text-muted">Couldn’t load the category mix. <RetryLink onRetry={() => void breakdown.refetch()} /></p>
            : <div className="flex items-center gap-3"><Skeleton className="h-[112px] w-[112px] shrink-0 rounded-full" /><Skeleton className="h-24 flex-1" /></div>}
      </div>
    </ListGroup>
    <ListGroup>
      <ListRow
        to={withReturn(evidenceLink(facts.current, undefined, 'income'))}
        title="Income"
        {...(facts.current.income ? { amount: formatMoney(facts.current.income), amountTone: 'in' as const } : { value: 'None yet' })}
        trailing="chevron"
      />
      <ListRow
        title={negative ? 'Spent more than earned' : 'Left after spending'}
        {...(netFlow ? { amount: formatMoneyAbs(netFlow), amountTone: negative ? 'over' as const : 'in' as const } : { value: '—' })}
      />
      <ListRow
        to="/plan"
        title="Coming up"
        subtitle={next ? `${next.label} · ${formatShortDate(next.date)}` : 'Nothing scheduled'}
        {...(next?.amount ? { amount: formatMoney(next.amount), amountTone: 'estimate' as const } : {})}
        trailing="chevron"
      />
      <ListRow
        to="/activity"
        title="Latest"
        subtitle={latest ? <>{latest.merchant || 'Unnamed'} · <span style={{ color: getCategoryTextColor(latest.category) }}>{latest.category}</span></> : 'Nothing captured yet'}
        {...(latest?.amount ? { amount: formatMoney(latest.amount) } : {})}
        trailing="chevron"
      />
    </ListGroup>
  </>;
}

function HomeTrend({ data, trend, day, onDay, withReturn }: {
  data: HomeBriefing;
  trend: { data?: { date: string; spending: Money }[]; isError: boolean; refetch: () => unknown };
  day: string | null;
  onDay: (day: string) => void;
  withReturn: (href: string) => string;
}) {
  const { start, end } = data.facts.current;
  // The API lists days newest first and omits empty days; the chart needs every day, in order.
  const points = trend.data ? datesInRange(start, end).map((date) => {
    const found = trend.data!.find((d) => d.date === date);
    return { date, amount: found ? found.spending.minor_units / 100 : 0 };
  }) : [];
  const selected = day ?? points.at(-1)?.date ?? null;
  return (
    <div className="flex h-full flex-col gap-2 pb-2">
      <ListGroup className="min-h-0 flex-1 [&>div]:h-full">
        <div className="flex h-full flex-col p-3">
          {trend.data
            ? <TrendLine data={points} selectedDate={selected} onSelectDate={onDay} chartHeight={150} fill />
            : trend.isError
              ? <p className="text-sm text-muted">Couldn’t load the daily trend. <RetryLink onRetry={() => void trend.refetch()} /></p>
              : <Skeleton className="h-full min-h-[150px] w-full" />}
        </div>
      </ListGroup>
      {selected && <ListGroup><ListRow to={withReturn(`/evidence?start=${selected}&end=${selected}&measure=spending`)} title={`${formatShortDate(selected)} records`} trailing="chevron" /></ListGroup>}
    </div>
  );
}

function HomeChanged({ data, onCategory }: { data: HomeBriefing; onCategory: (category: string) => void }) {
  const { facts } = data;
  const changes = facts.category_changes.slice(0, 5);
  return <>
    <ListGroup>
      <div className="p-2">
        {changes.length
          ? <CategoryChangeBars data={changes} onSelect={onCategory} />
          : <p className="p-1 text-sm text-muted">{facts.change ? 'No category changes yet.' : 'Resolve records to compare categories.'}</p>}
      </div>
    </ListGroup>
    <ListGroup><ListRow to="/explore?mode=by-category" title="Why it changed" trailing="chevron" /></ListGroup>
  </>;
}
