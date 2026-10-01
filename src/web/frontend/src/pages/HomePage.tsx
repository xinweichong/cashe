import { type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { evidenceLink, formatMoney, formatMoneyAbs, type Money } from '@/api/briefing';
import { formatShortDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/StatusDot';
import { ListGroup, ListRow } from '@/components/ui/list';
import { NavBar } from '@/components/ui/nav-bar';
import { SpectrumCard, SpectrumCardSkeleton } from '@/components/ui/SpectrumCard';
import { LoadFailed, RetryLink } from '@/components/ui/LoadFailed';
import { Skeleton } from '@/components/ui/skeleton';
import { ProfileMenu } from '@/components/layout/ProfileMenu';
import { useIsPhone } from '@/hooks/useIsPhone';
import { useHomeBriefing } from '@/hooks/useBriefing';

// Home is "now" (HIG alignment, 2026-10-01; distilled after the v3.1 critique):
// this month so far as the screen's one spectrum card, what needs a look, and
// the month's other figures. What's coming belongs to Plan, the record to
// Activity and patterns to Explore, so Home links to each in one row.

const COMING_UP_DAYS = 7;
/** Fewer comparable days than this and a month-on-month change is noise. */
const MIN_COMPARE_DAYS = 7;

// On a phone the two column wrappers dissolve (display: contents) so each
// group takes its own order in one stack; from lg they are real columns.
const COLUMNS = 'flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]';
const COLUMN = 'contents lg:flex lg:flex-col lg:gap-6';

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysInclusive(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

function monthName(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-SG', { month: 'long', timeZone: 'UTC' });
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
  const refreshing = query.isFetching;
  const soonUntil = addDays(facts.as_of, COMING_UP_DAYS);
  const soon = upcoming.filter((item) => item.date <= soonUntil);
  const sourcesNeedCare = freshness.gmail_needs_reconnection || !freshness.gmail_connected;
  const amountOrUnknown = (money: Money | null | undefined, unknown: string) => money ? { amount: formatMoney(money) } : { value: unknown };
  const captureItems = capture_issue_count + followup_issue_count;
  const toReview = Math.max(unresolved, review_count);
  const comparable = !!facts.change && daysInclusive(facts.comparison_current.start, facts.comparison_current.end) >= MIN_COMPARE_DAYS;
  const changeText = facts.change && `${formatMoneyAbs(facts.change)} ${facts.change.minor_units >= 0 ? 'more' : 'less'} than by this date in ${monthName(facts.previous.start)}`;

  // ── The month: spectrum card and what qualifies it ─────────────────────────
  const spendingCaption = spending_target
    ? overTarget ? `${formatMoneyAbs(spending_target.remaining)} over budget` : `${formatMoney(spending_target.remaining)} left`
    : comparable ? changeText ?? undefined : undefined;
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
        <p className="text-muted">{facts.current.status === 'partial' ? 'Known spending so far · some amounts or dates need review.' : facts.current.status === 'indicative' ? 'Spending so far · includes estimated currency conversions.' : 'Spending recorded this month'}</p>
        <p>{!facts.change ? 'Can’t compare with last month while some records need review.' : comparable ? `${changeText}.` : 'Too early in the month to compare with last month.'}</p>
      </div>
    </div>
  );

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

  // ── This month's other figures ─────────────────────────────────────────────
  const thisMonth = (
    <ListGroup title="This month">
      <ListRow
        to={withReturn(evidenceLink(facts.current, undefined, 'income'))}
        title="Income"
        {...amountOrUnknown(facts.current.income, 'None yet')}
        trailing="chevron"
      />
      <ListRow
        title={netFlowNegative ? 'Spent more than earned' : 'Left after spending'}
        subtitle={facts.current.recorded_net_flow ? 'Income minus spending' : facts.current.income ? 'Hidden while records need review' : 'Shows once income is recorded'}
        {...amountOrUnknown(facts.current.recorded_net_flow && (netFlowNegative ? { ...facts.current.recorded_net_flow, minor_units: -facts.current.recorded_net_flow.minor_units } : facts.current.recorded_net_flow), '—')}
      />
      {spending_target ? (
        <ListRow
          to="/plan"
          title={overTarget ? 'Over budget' : 'Budget left'}
          subtitle={`Of ${formatMoney(spending_target.target)} this month`}
          amount={formatMoneyAbs(spending_target.remaining)}
          trailing="chevron"
        />
      ) : (
        <ListRow to="/plan" title="Monthly budget" subtitle="Set one in Plan to track pace" value="Not set" trailing="chevron" />
      )}
    </ListGroup>
  );

  // ── Elsewhere: one row each for Plan, Activity and Explore ─────────────────
  const latest = recent[0];
  const elsewhere = (
    <ListGroup footer={upcoming_unknown_count ? `${plural(upcoming_unknown_count, 'expected charge')} without an amount yet. Upcoming amounts are estimates.` : undefined}>
      <ListRow
        to="/plan"
        title="Coming up"
        subtitle={soon.length ? `${plural(soon.length, 'charge')} in the next ${COMING_UP_DAYS} days` : `Nothing due in the next ${COMING_UP_DAYS} days`}
        trailing="chevron"
      />
      <ListRow
        to="/activity"
        title="Recent activity"
        subtitle={latest ? `Latest: ${latest.merchant || 'Unnamed'}${latest.date ? ` · ${formatShortDate(latest.date)}` : ''}` : 'Nothing captured yet'}
        {...(latest ? amountOrUnknown(latest.amount, 'Amount unresolved') : {})}
        trailing="chevron"
      />
      <ListRow to="/explore" title="Where it went" subtitle="Categories, merchants and trends" trailing="chevron" />
    </ListGroup>
  );

  return page(<>
    <p className="-mt-1 text-sm text-muted">As of {formatShortDate(facts.as_of)}{refreshing && <span role="status"> · Updating…</span>}</p>
    {query.isError && <p role="alert" className="text-warning">Couldn’t refresh. This may be out of date. <RetryLink onRetry={() => void query.refetch()} /></p>}
    <div className={COLUMNS}>
      <div className={COLUMN}>
        <div className="order-1">{month}</div>
        <div className="order-3">{thisMonth}</div>
      </div>
      <div className={COLUMN}>
        <div className="order-2">{needsALook}</div>
        <div className="order-4">{elsewhere}</div>
      </div>
    </div>
  </>);
}
