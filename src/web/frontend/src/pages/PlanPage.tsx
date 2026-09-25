import { subscriptionConfirmationLabels } from '@/lib/subscriptionConfirmation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { briefingApi, formatMoney, type MonthForecast, type UpcomingPlan } from '@/api/briefing';
import { HeroCard, PageCard } from '@/components/ui/cards';
import { StatCard } from '@/components/ui/StatCard';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/StatusDot';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { cn, formatShortDate, formatCurrencyWhole, toDateStr } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { slideInRightVariants } from '@/lib/motionPresets';
import { SavingsCard } from '@/components/plan/SavingsCard';
import { BudgetsCard } from '@/components/plan/BudgetsCard';
import { BudgetDetail } from '@/components/plan/BudgetDetail';
import { GoalsCard } from '@/components/plan/GoalsCard';
import { GoalDetail } from '@/components/plan/GoalDetail';
import { TripsCard } from '@/components/plan/TripsCard';
import { TripDetail } from '@/components/plan/TripDetail';
import { RecurringCard } from '@/components/plan/RecurringCard';
import { SubscriptionsSection } from '@/components/subscriptions/SubscriptionsSection';
import { SubscriptionDetail } from '@/components/subscriptions/SubscriptionDetail';

const amountBasisLabels: Record<'matched_charge' | 'user' | 'unknown', string> = {
  matched_charge: 'Amount based on your last confirmed charge',
  user: 'Amount you set',
  unknown: 'Amount unknown — no confirmed charge yet',
};

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function shiftMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthWindow(monthStr: string) {
  const [y, m] = monthStr.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  return {
    start: toDateStr(start), end: toDateStr(end), days: end.getDate(), startWeekday: start.getDay(),
    label: start.toLocaleDateString('en-SG', { month: 'long', year: 'numeric' }),
  };
}

// This month's projection: recorded/scheduled/remaining-estimate are
// disjoint components of month_forecast (src/forecast.py) that reconcile
// exactly to projected_total by construction — stacking them is safe. Guard
// on remaining_variable_estimate itself (not `status`) before stacking,
// since projected_total can be present without it in edge/test data.
function ProjectionComposition({ data }: { data: MonthForecast }) {
  if (!data.remaining_variable_estimate || !data.projected_total) return null;
  const total = data.projected_total.minor_units;
  if (total <= 0) return null;
  const recorded = data.recorded_actual.minor_units;
  const committed = data.confirmed_commitments.minor_units;
  const remaining = data.remaining_variable_estimate.minor_units;
  return (
    <div className="mt-4">
      <div
        className="h-4 w-full rounded-pill overflow-hidden flex"
        role="img"
        aria-label={`Recorded ${formatMoney(data.recorded_actual)}, scheduled ${formatMoney(data.confirmed_commitments)}, estimated remaining ${formatMoney(data.remaining_variable_estimate)}`}
      >
        <span className="h-full bg-teal" style={{ width: `${(recorded / total) * 100}%` }} />
        <span className="h-full bg-honey" style={{ width: `${(committed / total) * 100}%` }} />
        <span
          className="h-full bg-tangerine"
          style={{
            width: `${(remaining / total) * 100}%`,
            backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,.18) 3px, rgba(0,0,0,.18) 6px)',
          }}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs font-mono uppercase tracking-[0.1em] text-muted">
        <span className="inline-flex items-center gap-1.5"><StatusDot tone="saved" />Recorded {formatMoney(data.recorded_actual)}</span>
        <span className="inline-flex items-center gap-1.5"><StatusDot tone="active" />Scheduled (est.) {formatMoney(data.confirmed_commitments)}</span>
        <span className="inline-flex items-center gap-1.5"><StatusDot tone="notable" />Remaining (est.) {formatMoney(data.remaining_variable_estimate)}</span>
      </div>
    </div>
  );
}

// Fallback when the variable estimate isn't available: adjacent directly
// labelled comparison bars instead of a fabricated stacked composition.
function ProjectionComparisonFallback({ data }: { data: MonthForecast }) {
  const max = Math.max(1, data.recorded_actual.minor_units, data.confirmed_commitments.minor_units);
  return (
    <div className="mt-4 space-y-2">
      <div>
        <div className="flex justify-between text-sm"><span>Recorded so far</span><span className="tabular-nums">{formatMoney(data.recorded_actual)}</span></div>
        <div className="h-2 rounded bg-foreground/10 mt-1 overflow-hidden"><div className="h-full bg-teal" style={{ width: `${(data.recorded_actual.minor_units / max) * 100}%` }} /></div>
      </div>
      <div>
        <div className="flex justify-between text-sm"><span>Scheduled (est.)</span><span className="tabular-nums">{formatMoney(data.confirmed_commitments)}</span></div>
        <div className="h-2 rounded bg-foreground/10 mt-1 overflow-hidden"><div className="h-full bg-honey" style={{ width: `${(data.confirmed_commitments.minor_units / max) * 100}%` }} /></div>
      </div>
    </div>
  );
}

function ProjectionHero() {
  const { data, isError, refetch } = useQuery({ queryKey: ['month-forecast'], queryFn: () => briefingApi.monthForecast() });
  return (
    <HeroCard title="This month's projection" className="col-span-2">
      {isError && !data ? <div role="alert"><LoadFailed onRetry={() => void refetch()} /></div> : !data ? <div role="status"><span className="sr-only">Loading…</span><Skeleton className="h-20 w-full" /></div> :
        data.projected_total == null ? <>
          <p className="text-muted">Not enough recorded history yet to project the rest of this month — at least 4 weeks of history is needed for each remaining weekday.</p>
          <ProjectionComparisonFallback data={data} />
        </> : <>
        <p className="font-display text-4xl md:text-5xl font-bold tracking-tight tabular-nums text-foreground">{formatMoney(data.projected_total)}</p>
        <p className="mt-1 text-muted">Projected total for {data.period_start} to {data.period_end} · {formatMoney(data.recorded_actual)} recorded so far</p>
        <ProjectionComposition data={data} />
        {data.projected_total_low && data.projected_total_high && <p className="text-sm text-muted mt-3">Likely range {formatMoney(data.projected_total_low)}–{formatMoney(data.projected_total_high)} — the lowest and highest ever recorded on these weekdays, not a statistical estimate.</p>}
        {!!data.unpriced_commitment_count && <p className="text-warning mt-1">{data.unpriced_commitment_count} upcoming charge{data.unpriced_commitment_count > 1 ? 's have' : ' has'} no known amount and {data.unpriced_commitment_count > 1 ? "aren't" : "isn't"} included.</p>}
        {data.reasons.includes('unresolved_conversion') && <p className="text-warning mt-1">Some recorded spending this month has an unresolved currency conversion and is excluded from the actual figure above.</p>}
        <details className="mt-2">
          <summary className="cursor-pointer text-teal min-h-11 inline-flex items-center">How this is calculated</summary>
          <ul className="text-sm text-muted list-disc pl-5 mt-2 space-y-1">
            {data.assumptions.map((assumption, i) => <li key={i}>{assumption}</li>)}
          </ul>
        </details>
      </>}
    </HeroCard>
  );
}

function SavedThisMonthStat() {
  const { data: overview } = useQuery({ queryKey: ['savings-overview'], queryFn: () => api.getSavingsOverview(), staleTime: 30_000 });
  return (
    <StatCard
      label="Saved this month"
      value={overview ? formatCurrencyWhole(overview.savings) : '—'}
      color="teal"
      subtext={overview ? `${formatCurrencyWhole(overview.allocated_to_goals)} toward goals` : 'Income minus expenses'}
    />
  );
}

function UpcomingThisWeekStat() {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return toDateStr(d); }), []);
  const { data } = useQuery({ queryKey: ['plan-upcoming-calendar', days[0], days[6]], queryFn: () => briefingApi.upcomingCalendar(days[0], days[6]) });
  const count = (data?.days ?? []).reduce((sum, d) => sum + d.recorded_charge_count, 0);
  return (
    <StatCard
      label="Upcoming this week"
      value={data ? `${count} charge${count === 1 ? '' : 's'}` : '—'}
      color="mint"
      subtext="Recorded pending schedules, next 7 days"
    />
  );
}

function WeekStrip({ selectedDate, onSelect }: { selectedDate: string | null; onSelect: (d: string) => void }) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return toDateStr(d); }), []);
  const start = days[0], end = days[6];
  const { data } = useQuery({ queryKey: ['plan-upcoming-calendar', start, end], queryFn: () => briefingApi.upcomingCalendar(start, end) });
  const byDate = new Map((data?.days ?? []).map(d => [d.date, d]));
  return (
    <div className="flex justify-between gap-1" data-testid="week-strip">
      {days.map((date) => {
        const d = new Date(date + 'T00:00:00');
        return (
          <button
            key={date}
            type="button"
            onClick={() => onSelect(date)}
            aria-pressed={selectedDate === date}
            className={cn(
              'flex-1 min-h-11 flex flex-col items-center justify-center gap-1 rounded-md text-sm',
              selectedDate === date ? 'bg-teal/13 text-teal' : 'hover:bg-card-hover'
            )}
          >
            <span className="text-2xs text-muted">{WEEKDAY_LABELS[d.getDay()]}</span>
            <span>{d.getDate()}</span>
            {!!byDate.get(date)?.recorded_charge_count && <span className="w-1 h-1 rounded-full bg-tangerine" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

function MonthCalendar({ month, onMonth, selectedDate, onSelect }: {
  month: string; onMonth: (m: string) => void; selectedDate: string | null; onSelect: (d: string) => void;
}) {
  const bounds = monthWindow(month);
  const { data, isError, refetch, isLoading } = useQuery({
    queryKey: ['plan-upcoming-calendar', bounds.start, bounds.end],
    queryFn: () => briefingApi.upcomingCalendar(bounds.start, bounds.end),
  });
  const byDate = new Map((data?.days ?? []).map(d => [d.date, d]));
  const cells = [
    ...Array.from({ length: bounds.startWeekday }, () => null),
    ...Array.from({ length: bounds.days }, (_, i) => i + 1),
  ];
  return (
    <div data-testid="month-calendar">
      <PageCard title={bounds.label} action={
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="min-h-9 px-2" aria-label="Previous month" onClick={() => onMonth(shiftMonth(month, -1))}>‹</Button>
          <Button variant="ghost" size="sm" className="min-h-9 px-2" aria-label="Next month" onClick={() => onMonth(shiftMonth(month, 1))}>›</Button>
        </div>
      }>
        {isError && !data ? <div role="alert"><LoadFailed onRetry={() => void refetch()} /></div> : <>
          <div className="grid grid-cols-7 gap-1 text-2xs text-muted text-center mb-1">
            {WEEKDAY_LABELS.map((w, i) => <span key={i}>{w}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (day == null) return <span key={`blank-${i}`} />;
              const date = `${bounds.start.slice(0, 8)}${String(day).padStart(2, '0')}`;
              const summary = byDate.get(date);
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => onSelect(date)}
                  aria-pressed={selectedDate === date}
                  className={cn(
                    'aspect-square min-h-9 flex flex-col items-center justify-center rounded-md text-sm',
                    selectedDate === date ? 'bg-teal/13 text-teal' : 'hover:bg-card-hover'
                  )}
                >
                  {day}
                  {!isLoading && !!summary?.recorded_charge_count && <span className="w-1 h-1 rounded-full bg-tangerine mt-0.5" aria-hidden />}
                </button>
              );
            })}
          </div>
        </>}
      </PageCard>
    </div>
  );
}

// Detail for a selected calendar day outside the currently loaded agenda
// window: a bounded, paginated read of just that day, under the same
// pending/unmatched/active-subscription rules as the agenda itself.
function SelectedDayDetail({ date }: { date: string }) {
  const [offset, setOffset] = useState(0);
  const query = useQuery({ queryKey: ['plan-upcoming-day', date, offset], queryFn: () => briefingApi.upcomingOnDate(date, offset) });
  const report = query.data;
  return (
    <PageCard title={`Charges on ${formatShortDate(date)}`}>
      {query.isError && !report ? <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div> : !report ? <div role="status"><span className="sr-only">Loading…</span><Skeleton className="h-20 w-full" /></div> :
        !report.items.length ? <p className="text-muted">No recorded pending charges on this day.</p> : <>
        <ol>
          {report.items.map(item => <li key={item.id} className="py-3 border-b border-border last:border-0 flex justify-between gap-4">
            <span className="font-medium">{item.label}</span>
            <span className="tabular-nums">{item.amount ? formatMoney(item.amount) : 'Amount unknown'}</span>
          </li>)}
        </ol>
        {report.total > 50 && <nav aria-label="Selected day charge pages" className="flex items-center justify-between gap-3 mt-2">
          <Button variant="outline" size="sm" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button>
          <span className="text-sm text-muted">{report.total} charges</span>
          <Button variant="outline" size="sm" disabled={offset + 50 >= report.total} onClick={() => setOffset(offset + 50)}>Next</Button>
        </nav>}
      </>}
    </PageCard>
  );
}

type Panel =
  | { type: 'subscription'; id: number }
  | { type: 'budget'; id: number }
  | { type: 'goal'; id: number }
  | { type: 'trip'; id: number };

export function PlanPage() {
  const [search, setSearch] = useSearchParams();
  const isDesktop = useIsDesktop();
  // Window, page and phone calendar view live in the URL (replace-history)
  // so returning from a detail panel restores them. Invalid values fall
  // back to defaults.
  const daysParam = Number(search.get('days'));
  const days = [14, 30, 90].includes(daysParam) ? daysParam : 30;
  const offsetParam = Number(search.get('offset'));
  const offset = Number.isInteger(offsetParam) && offsetParam > 0 && offsetParam % 50 === 0 ? offsetParam : 0;
  const showCalendarMobile = search.get('view') === 'calendar';
  function updateParams(changes: Record<string, string | null>) {
    const params = new URLSearchParams(search);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) params.delete(key); else params.set(key, value);
    }
    setSearch(params, { replace: true });
  }
  const setDays = (value: number) => updateParams({ days: value === 30 ? null : String(value), offset: null });
  const setOffset = (value: number) => updateParams({ offset: value ? String(value) : null });
  const setShowCalendarMobile = (open: boolean) => updateParams({ view: open ? 'calendar' : null });
  const selectedDate = search.get('date');
  const calendarMonth = search.get('month') || toDateStr(new Date()).slice(0, 7);

  // The right-side detail panel: exactly one of these params is set at a
  // time. Setting one clears the other three, so deep links (e.g. Explore's
  // "review this subscription") always land on a single, unambiguous panel.
  const panel: Panel | null = (() => {
    const subId = Number(search.get('subscription'));
    if (Number.isSafeInteger(subId) && subId > 0) return { type: 'subscription', id: subId };
    const budgetId = Number(search.get('budget'));
    if (Number.isSafeInteger(budgetId) && budgetId > 0) return { type: 'budget', id: budgetId };
    const goalId = Number(search.get('goal'));
    if (Number.isSafeInteger(goalId) && goalId > 0) return { type: 'goal', id: goalId };
    const tripId = Number(search.get('trip'));
    if (Number.isSafeInteger(tripId) && tripId > 0) return { type: 'trip', id: tripId };
    return null;
  })();
  function panelHref(type: Panel['type'], id: number) {
    const params = new URLSearchParams(search);
    params.delete('subscription'); params.delete('budget'); params.delete('goal'); params.delete('trip');
    params.set(type, String(id));
    return `/plan?${params.toString()}`;
  }
  function openPanel(type: Panel['type'], id: number) {
    const params = new URLSearchParams(search);
    params.delete('subscription'); params.delete('budget'); params.delete('goal'); params.delete('trip');
    params.set(type, String(id));
    setSearch(params);
  }
  function closePanel() {
    const params = new URLSearchParams(search);
    params.delete('subscription'); params.delete('budget'); params.delete('goal'); params.delete('trip');
    setSearch(params);
  }

  const query = useQuery({
    queryKey: ['plan-upcoming', days, offset],
    queryFn: () => briefingApi.upcoming(days, offset),
    refetchOnMount: 'always',
  });
  const report = query.data;
  // After a dismissal removes a charge, its controls unmount and focus is
  // lost; once the refreshed report renders, move focus to the agenda.
  const agendaFocusPending = useRef(false);
  useEffect(() => {
    if (!agendaFocusPending.current) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    agendaFocusPending.current = false;
    document.getElementById('upcoming-agenda')?.focus();
  }, [report]);
  const grouped = useMemo(() => {
    const groups: { date: string; items: UpcomingPlan['items'] }[] = [];
    for (const item of report?.items ?? []) {
      const last = groups[groups.length - 1];
      if (last && last.date === item.date) last.items.push(item); else groups.push({ date: item.date, items: [item] });
    }
    return groups;
  }, [report]);
  const frequencies: Record<string, string> = { weekly: 'Weekly', biweekly: 'Every two weeks', monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual' };

  function selectDate(date: string) {
    const params = new URLSearchParams(search);
    if (params.get('date') === date) params.delete('date'); else params.set('date', date);
    setSearch(params, { replace: true });
  }
  function setCalendarMonth(month: string) {
    const params = new URLSearchParams(search);
    params.set('month', month);
    setSearch(params, { replace: true });
  }

  // A date's charges can straddle an agenda page boundary; only treat the
  // highlighted agenda group as the full day when it cannot have been cut.
  const selectedIndex = selectedDate ? grouped.findIndex(g => g.date === selectedDate) : -1;
  const cutBefore = offset > 0 && selectedIndex === 0;
  const cutAfter = !!report && offset + report.items.length < report.total && selectedIndex === grouped.length - 1;
  const selectedInAgenda = selectedIndex >= 0 && !cutBefore && !cutAfter;

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings(), staleTime: 10_000 });

  const calendarPane = isDesktop ? (
    <MonthCalendar month={calendarMonth} onMonth={setCalendarMonth} selectedDate={selectedDate} onSelect={selectDate} />
  ) : (
    <div className="mb-4">
      <WeekStrip selectedDate={selectedDate} onSelect={selectDate} />
      <Button variant="ghost" size="sm" className="mt-2 text-teal" aria-expanded={showCalendarMobile} onClick={() => setShowCalendarMobile(!showCalendarMobile)}>
        {showCalendarMobile ? 'Hide calendar' : 'View calendar'}
      </Button>
      {showCalendarMobile && <div className="mt-3">
        <MonthCalendar month={calendarMonth} onMonth={setCalendarMonth} selectedDate={selectedDate} onSelect={selectDate} />
      </div>}
    </div>
  );

  const anyManageEnabled = !!settings && (settings.budgets_enabled || settings.subscriptions_enabled || settings.recurring_enabled || settings.goals_enabled || settings.trips_enabled);

  return (
    <div className="flex h-full">
      <div className={cn('flex-1 min-w-0 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-5 max-w-[1600px]', panel && 'hidden md:block')}>
        <header className="space-y-2">
          <div className="text-xs uppercase tracking-[0.22em] text-muted font-mono font-semibold">Plan</div>
          <h1 className="text-xl md:text-3xl font-bold leading-tight tracking-tight text-foreground font-display">See what's coming, and where it's going.</h1>
          <p className="text-muted">Upcoming charges, budgets, goals, subscriptions and trips — all in one place.</p>
        </header>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <ProjectionHero />
          <SavedThisMonthStat />
          <UpcomingThisWeekStat />
        </div>

        <div className="grid gap-4 md:gap-5 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-4">{calendarPane}</div>
          <div className="lg:col-span-8 space-y-4">
            <label className="flex items-center gap-3">Show
              <select className="select-field min-h-11" value={days} onChange={event => setDays(Number(event.target.value))}>
                <option value={14}>Next 14 days</option><option value={30}>Next 30 days</option><option value={90}>Next 90 days</option>
              </select>
            </label>
            {query.isError && <div role="alert">{report ? <p className="text-warning">Couldn't refresh. This timeline may be out of date.</p> : null}<LoadFailed onRetry={() => void query.refetch()} /></div>}
            {!report && !query.isError && <div role="status"><span className="sr-only">Loading upcoming charges…</span><Skeleton className="h-20 w-full" /></div>}
            {report && (!report.enabled ? <PageCard title="Track upcoming charges">
              <p>Enable Subscriptions in Settings to see your recorded schedules here.</p>
              <Link to="/settings" className="text-teal min-h-11 inline-flex items-center">Open Settings</Link>
            </PageCard> : <>
              <PageCard title="Upcoming timeline">
                <p className="text-3xl font-semibold tabular-nums">{formatMoney(report.known_total)}</p>
                <p className="text-muted">{report.status === 'partial' ? 'Known estimated subtotal' : 'Estimated charges'} · {report.start} to {report.end} · {report.timezone}</p>
                {!!report.unknown_count && <p className="text-warning">{report.unknown_count} charges have unknown amounts and are excluded from this subtotal.</p>}
                <p className="text-sm text-muted mt-3">Dates and amounts are estimates, not confirmed charges. Only recorded pending schedules appear; this is not a complete forecast. Matched or dismissed charges are excluded.</p>
                <div id="upcoming-agenda" tabIndex={-1} aria-label="Upcoming charges" className="mt-4 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {grouped.map(group => <div key={group.date} id={`agenda-date-${group.date}`} className={cn('scroll-mt-24 rounded-md', selectedDate === group.date && '-mx-2 px-2 bg-card-hover/60')}>
                    <h3 className="text-2xs font-mono uppercase tracking-[0.1em] text-muted pt-4 pb-1 first:pt-0">{formatShortDate(group.date)}</h3>
                    <ol>
                      {group.items.map(item => <li key={item.id} className="py-4 border-b border-border last:border-0 space-y-1">
                        <div className="flex justify-between gap-4"><p className="font-medium">{item.label}</p><p className="tabular-nums">{item.amount ? formatMoney(item.amount) : 'Amount unknown'}</p></div>
                        <p className="text-muted"><time dateTime={item.date}>{item.date}</time> · {frequencies[item.frequency] || item.frequency} · {item.date_basis === 'user' ? 'Date you set' : 'Scheduled estimate'}</p>
                        <p className="text-sm text-muted">{amountBasisLabels[item.amount_basis]}</p>
                        <p className="text-sm text-muted">{subscriptionConfirmationLabels[item.confirmation_source]}</p>
                        {item.schedule_status === 'possibly_cancelled' && <p className="text-warning">Schedule needs review: a previous charge may be overdue.</p>}
                        <ChargeActions item={item} onDismissed={() => { agendaFocusPending.current = true; }} />
                        {item.subscription_id != null && <Link to={panelHref('subscription', item.subscription_id)} className="text-teal min-h-11 inline-flex items-center">Review or match schedule for {item.label}</Link>}
                      </li>)}
                    </ol>
                  </div>)}
                </div>
                {!report.items.length && <p className="py-4 text-muted">{report.total ? 'No charges on this page. Return to an earlier page.' : 'No pending charges recorded in this window. Add or review a subscription schedule to get started.'}</p>}
              </PageCard>
              <nav aria-label="Upcoming charge pages" className="flex items-center justify-between gap-3">
                <Button variant="outline" className="min-h-11" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous charges</Button>
                <span>{report.total} recorded charges</span>
                <Button variant="outline" className="min-h-11" disabled={query.isError || offset + 50 >= report.total} onClick={() => setOffset(offset + 50)}>Next charges</Button>
              </nav>
              {selectedDate && !selectedInAgenda && <SelectedDayDetail date={selectedDate} />}
            </>)}
          </div>
        </div>

        {!settings ? null : !anyManageEnabled ? (
          <div className="p-6 flex flex-col items-center justify-center min-h-48 text-center gap-3">
            <p className="text-muted text-sm">Enable Budgets, Goals, Trips, Subscriptions, or Recurring in Settings to get started.</p>
            <Link to="/settings" className="text-sm text-teal underline-offset-4 hover:underline min-h-11 inline-flex items-center">Go to Settings →</Link>
          </div>
        ) : (
          <section className="space-y-4 pt-2">
            <h2 className="text-lg font-semibold font-display">Budgets, goals, subscriptions &amp; trips</h2>
            <div className="grid gap-4 md:gap-5 lg:grid-cols-2 items-start">
              <div className="space-y-4">
                {settings.budgets_enabled && <BudgetsCard onSelect={(id) => openPanel('budget', id)} />}
                {settings.subscriptions_enabled && <SubscriptionsSection selectedSubId={panel?.type === 'subscription' ? panel.id : null} onSelectSub={(id) => openPanel('subscription', id)} />}
                {settings.recurring_enabled && <RecurringCard />}
              </div>
              <div className="space-y-4">
                {settings.goals_enabled && <SavingsCard />}
                {settings.goals_enabled && <GoalsCard onSelect={(id) => openPanel('goal', id)} />}
                {settings.trips_enabled && <TripsCard onSelect={(id) => openPanel('trip', id)} />}
              </div>
            </div>
          </section>
        )}
      </div>

      <AnimatePresence>
        {panel && (
          <motion.div
            className="fixed top-0 bottom-16 md:bottom-0 right-0 z-40 w-full md:w-[420px] border-l border-border bg-card flex-shrink-0 overflow-hidden"
            variants={slideInRightVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {panel.type === 'subscription' && <SubscriptionDetail subId={panel.id} onClose={closePanel} />}
            {panel.type === 'budget' && <BudgetDetail budgetId={panel.id} onClose={closePanel} />}
            {panel.type === 'goal' && <GoalDetail goalId={panel.id} onClose={closePanel} />}
            {panel.type === 'trip' && <TripDetail tripId={panel.id} onClose={closePanel} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChargeActions({ item, onDismissed }: { item: UpcomingPlan['items'][number]; onDismissed: () => void }) {
  const client = useQueryClient();
  const [mode, setMode] = useState<'edit' | 'dismiss' | null>(null);
  const [expectedDate, setExpectedDate] = useState('');
  const [expectedAmount, setExpectedAmount] = useState('');
  const [original, setOriginal] = useState({ date: '', amount: '' });
  const editRef = useRef<HTMLButtonElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  // Which opener to refocus once the panel closes (§5 Plan: return focus to
  // the initiating control); if the charge is gone, the agenda region.
  const focusAfterClose = useRef<'edit' | 'dismiss' | null>(null);
  useEffect(() => {
    if (mode || !focusAfterClose.current) return;
    const target = (focusAfterClose.current === 'edit' ? editRef : dismissRef).current;
    focusAfterClose.current = null;
    target?.focus();
  }, [mode]);
  const mutation = useMutation({
    mutationFn: (action: 'save' | 'dismiss') => {
      if (action === 'dismiss') return briefingApi.dismissPlannedCharge(item.id);
      const fields: { expected_date?: string; expected_amount?: string | null } = {};
      if (expectedDate !== original.date) fields.expected_date = expectedDate;
      if (expectedAmount !== original.amount) fields.expected_amount = expectedAmount.trim() || null;
      return briefingApi.updatePlannedCharge(item.id, fields);
    },
    onSuccess: async (_data, action) => {
      if (action === 'dismiss') onDismissed();
      setMode(null);
      await Promise.all(['plan-upcoming', 'home-briefing', 'subscriptions', 'subscription-upcoming', 'plan-upcoming-calendar', 'plan-upcoming-day'].map(key =>
        client.invalidateQueries({ queryKey: [key] })));
    },
  });
  const openEdit = () => {
    const values = { date: item.date.slice(0, 10), amount: item.amount ? (item.amount.minor_units / 100).toFixed(2) : '' };
    setOriginal(values); setExpectedDate(values.date); setExpectedAmount(values.amount); mutation.reset();
    focusAfterClose.current = 'edit'; setMode('edit');
  };
  return <div className="space-y-2">
    {!mode ? <div className="flex flex-wrap gap-2">
      <Button ref={editRef} variant="outline" className="min-h-11" disabled={mutation.isPending} onClick={openEdit}>Edit estimate</Button>
      <Button ref={dismissRef} variant="ghost" className="min-h-11" disabled={mutation.isPending} onClick={() => { mutation.reset(); focusAfterClose.current = 'dismiss'; setMode('dismiss'); }}>Dismiss prediction</Button>
    </div> : <div className="border border-border rounded-lg p-3 space-y-3">
      {mode === 'edit' ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); mutation.mutate('save'); }}>
        <p className="text-sm text-muted">Edit this prediction. Future dates may follow the revised date. Amounts are estimated SGD; leave blank if unknown.</p>
        <label className="block">Expected date<input autoFocus className="input-field min-h-11 block w-full" type="date" required value={expectedDate} onChange={event => setExpectedDate(event.target.value)} /></label>
        <label className="block">Estimated amount (SGD)<input className="input-field min-h-11 block w-full" type="number" min="0" step="0.01" value={expectedAmount} onChange={event => setExpectedAmount(event.target.value)} /></label>
        <Button type="submit" className="min-h-11" disabled={mutation.isPending || (expectedDate === original.date && expectedAmount === original.amount)}>Save estimate</Button>
      </form> : <>
        <p>Dismiss this prediction from upcoming totals? This does not cancel your subscription with the provider.</p>
        <Button autoFocus variant="outline" className="min-h-11" disabled={mutation.isPending} onClick={() => mutation.mutate('dismiss')}>Dismiss charge</Button>
      </>}
      <Button variant="ghost" className="min-h-11" disabled={mutation.isPending} onClick={() => { setMode(null); mutation.reset(); }}>Cancel</Button>
      {mutation.isError && <div role="alert" className="text-destructive">
        <p>Couldn't update this prediction. Check the date and amount; the charge may already have changed.</p>
        <Button variant="outline" className="min-h-11" onClick={() => void client.invalidateQueries({ queryKey: ['plan-upcoming'] })}>Refresh timeline</Button>
      </div>}
    </div>}
  </div>;
}
