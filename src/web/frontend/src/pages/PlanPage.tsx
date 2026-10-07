import { subscriptionConfirmationLabels } from '@/lib/subscriptionConfirmation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { briefingApi, formatMoney, type MonthForecast, type UpcomingPlan } from '@/api/briefing';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/StatusDot';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { ListGroup, ListRow } from '@/components/ui/list';
import { NavBar } from '@/components/ui/nav-bar';
import { SegmentedChoice } from '@/components/ui/segmented-choice';
import { SpectrumCard, SpectrumCardSkeleton } from '@/components/ui/SpectrumCard';
import { AnimatedMoney } from '@/components/ui/AnimatedMoney';
import { DetailHeader } from '@/components/ui/detail-panel';
import { PageCard } from '@/components/ui/cards';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { cn, formatCurrencyWhole, formatShortDate, toDateStr } from '@/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SavingsTiles } from '@/components/plan/SavingsCard';
import { PhoneScreen } from '@/components/layout/PhoneScreen';
import { MONEY_TONE_CLASS } from '@/lib/moneyTone';
import { BudgetsCard } from '@/components/plan/BudgetsCard';
import { BudgetDetail } from '@/components/plan/BudgetDetail';
import { GoalsCard } from '@/components/plan/GoalsCard';
import { GoalDetail } from '@/components/plan/GoalDetail';
import { TripsCard } from '@/components/plan/TripsCard';
import { TripDetail } from '@/components/plan/TripDetail';
import { RecurringCard } from '@/components/plan/RecurringCard';
import { SubscriptionsSection } from '@/components/subscriptions/SubscriptionsSection';
import { SubscriptionDetail } from '@/components/subscriptions/SubscriptionDetail';
import { ListDetail } from '@/components/layout/ListDetail';
import { ProfileMenu } from '@/components/layout/ProfileMenu';
import { useIsPhone } from '@/hooks/useIsPhone';
import { invalidateSpendingQueries } from '@/hooks/useTransactions';
import { useSettings } from '@/hooks/useSettings';
import { useHomeBriefing, useMonthForecast } from '@/hooks/useBriefing';
import { useUrlParams } from '@/hooks/useUrlParams';
import { frequencyLabel } from '@/lib/subscriptionFrequency';
import { QueryState } from '@/components/ui/QueryState';

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
// The stacked recorded / scheduled / estimated-remaining bar. Callers
// check remaining_variable_estimate and a positive projected_total first.
function ProjectionBar({ data, compact = false }: { data: MonthForecast; compact?: boolean }) {
  const total = data.projected_total!.minor_units;
  const remaining = data.remaining_variable_estimate!;
  const width = (m: { minor_units: number }) => `${(m.minor_units / total) * 100}%`;
  return (
    <div
      className={cn('w-full rounded-pill overflow-hidden flex', compact ? 'mt-3 h-2.5' : 'h-4')}
      role="img"
      aria-label={`Recorded ${formatMoney(data.recorded_actual)}, scheduled ${formatMoney(data.confirmed_commitments)}, estimated remaining ${formatMoney(remaining)}`}
    >
      <span className="h-full bg-teal" style={{ width: width(data.recorded_actual) }} />
      <span className="h-full bg-honey" style={{ width: width(data.confirmed_commitments) }} />
      <span
        className={cn('h-full bg-tangerine', compact && 'opacity-70')}
        style={{
          width: width(remaining),
          backgroundImage: compact ? undefined : 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,.18) 3px, rgba(0,0,0,.18) 6px)',
        }}
      />
    </div>
  );
}

function ProjectionComposition({ data }: { data: MonthForecast }) {
  if (!data.remaining_variable_estimate || !data.projected_total) return null;
  if (data.projected_total.minor_units <= 0) return null;
  return (
    <div className="mt-4">
      <ProjectionBar data={data} />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><StatusDot tone="saved" />Recorded {formatMoney(data.recorded_actual)}</span>
        <span className="inline-flex items-center gap-1.5"><StatusDot tone="active" />Scheduled, estimated {formatMoney(data.confirmed_commitments)}</span>
        <span className="inline-flex items-center gap-1.5"><StatusDot tone="notable" />Rest of month, estimated {formatMoney(data.remaining_variable_estimate)}</span>
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
        <div className="flex justify-between text-sm"><span>Scheduled, estimated</span><span className="tabular-nums">{formatMoney(data.confirmed_commitments)}</span></div>
        <div className="h-2 rounded bg-foreground/10 mt-1 overflow-hidden"><div className="h-full bg-honey" style={{ width: `${(data.confirmed_commitments.minor_units / max) * 100}%` }} /></div>
      </div>
    </div>
  );
}

// Plan's one spectrum card (P11): this month's projection, estimated, with
// pace against the overall target when one is set. The notes underneath keep
// every qualification the projection carries.
function ProjectionMonth() {
  const { data, isError, refetch } = useMonthForecast();
  const { data: briefing } = useHomeBriefing();
  const target = briefing?.spending_target?.target;
  if (!data) return isError
    ? <div role="alert"><LoadFailed onRetry={() => void refetch()} /></div>
    : <SpectrumCardSkeleton />;
  const projected = data.projected_total;
  const month = new Date(`${data.period_start}T00:00:00Z`).toLocaleDateString('en-SG', { month: 'long', timeZone: 'UTC' });
  const over = !!projected && !!target && projected.minor_units > target.minor_units;
  const gap = projected && target ? formatMoney({ ...target, minor_units: Math.abs(projected.minor_units - target.minor_units) }) : null;
  return (
    <div className="space-y-2">
      <SpectrumCard
        label={`${month} projection`}
        meta="Recorded so far"
        value={<AnimatedMoney value={projected ?? data.recorded_actual} />}
        caption={projected
          ? `${target ? `${gap} ${over ? 'over' : 'under'} your ${formatMoney(target)} target` : 'No monthly target set'}${data.projected_total_low && data.projected_total_high ? ` · likely ${formatCurrencyWhole(data.projected_total_low.minor_units / 100)}–${formatCurrencyWhole(data.projected_total_high.minor_units / 100)}` : ''}`
          : 'A projection needs about 4 weeks of history'}
        status={projected ? 'estimated' : 'complete'}
      />
      <div className="space-y-1 px-1 text-sm">
        {projected == null ? <>
          <p className="max-w-prose text-muted">Not enough recorded history yet to project the rest of this month. A projection needs about 4 weeks of spending.</p>
          <ProjectionComparisonFallback data={data} />
        </> : <>
          <ProjectionComposition data={data} />
          {!!data.unpriced_commitment_count && <p className="text-warning">{data.unpriced_commitment_count} upcoming charge{data.unpriced_commitment_count > 1 ? 's have' : ' has'} no known amount and {data.unpriced_commitment_count > 1 ? "aren't" : "isn't"} included.</p>}
          {data.reasons.includes('unresolved_conversion') && <p className="text-warning">Some recorded spending this month has an unresolved currency conversion and is excluded from the actual figure above.</p>}
          <details>
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-teal">How this is calculated</summary>
            <ul className="mt-1 max-w-prose list-disc space-y-1 pl-5 text-muted">
              {data.projected_total_low && data.projected_total_high && <li>The likely range is the lowest and highest you have spent on these weekdays before, not a statistical estimate.</li>}
              {data.assumptions.map((assumption, i) => <li key={i}>{assumption}</li>)}
            </ul>
          </details>
        </>}
      </div>
    </div>
  );
}

// Plan's phone summary (phone quick view, 2026-10-06): the projection card,
// its composition bar and one line of coloured parts. Qualifications stay in
// the md+ layout and the projection's own explanation.
function PhoneProjection() {
  const { data, isError, refetch } = useMonthForecast();
  const { data: briefing } = useHomeBriefing();
  const target = briefing?.spending_target?.target;
  if (!data) return isError
    ? <div role="alert"><LoadFailed onRetry={() => void refetch()} /></div>
    : <SpectrumCardSkeleton />;
  const projected = data.projected_total;
  const month = new Date(`${data.period_start}T00:00:00Z`).toLocaleDateString('en-SG', { month: 'long', timeZone: 'UTC' });
  const over = !!projected && !!target && projected.minor_units > target.minor_units;
  const gap = projected && target ? formatMoney({ ...target, minor_units: Math.abs(projected.minor_units - target.minor_units) }) : null;
  const stacked = !!data.remaining_variable_estimate && !!projected && projected.minor_units > 0;
  const whole = (m: { minor_units: number }) => formatCurrencyWhole(m.minor_units / 100);
  return (
    <div className="space-y-2">
      <SpectrumCard
        label={`${month} projection`}
        meta="Recorded so far"
        value={<AnimatedMoney value={projected ?? data.recorded_actual} />}
        caption={projected
          ? target ? `${gap} ${over ? 'over' : 'under'} your ${formatMoney(target)} target` : 'No monthly target set'
          : 'Needs about 4 weeks of history'}
        status={projected ? 'estimated' : 'complete'}
      />
      {stacked && <>
        <ProjectionBar data={data} compact />
        <p className="flex flex-wrap gap-x-3 px-1 text-xs text-muted">
          <span><span className={cn('font-mono font-medium', MONEY_TONE_CLASS.in)}>{whole(data.recorded_actual)}</span> recorded</span>
          <span><span className={cn('font-mono font-medium', MONEY_TONE_CLASS.estimate)}>{whole(data.confirmed_commitments)}</span> scheduled</span>
          <span><span className={cn('font-mono font-medium', MONEY_TONE_CLASS.spend)}>{whole(data.remaining_variable_estimate!)}</span> rest, est.</span>
        </p>
      </>}
    </div>
  );
}

type PlanView = 'soon' | 'budgets' | 'goals' | 'subs' | 'trips';

type PlanWindow = '14' | '30' | '90';

// Today and the next six days, with their pending-charge calendar.
function useNextWeekCalendar() {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return toDateStr(d); }), []);
  const calendar = useQuery({ queryKey: ['plan-upcoming-calendar', days[0], days[6]], queryFn: () => briefingApi.upcomingCalendar(days[0], days[6]) });
  return { days, data: calendar.data };
}

function WeekStrip({ selectedDate, onSelect }: { selectedDate: string | null; onSelect: (d: string) => void }) {
  const { days, data } = useNextWeekCalendar();
  const byDate = new Map((data?.days ?? []).map(d => [d.date, d]));
  return (
    <div className="flex justify-between gap-1 rounded-group bg-card p-1.5" data-testid="week-strip">
      {days.map((date) => {
        const d = new Date(date + 'T00:00:00');
        return (
          <button
            key={date}
            type="button"
            onClick={() => onSelect(date)}
            aria-pressed={selectedDate === date}
            className={cn(
              'flex min-h-11 flex-1 flex-col items-center justify-center gap-1 rounded-[12px] text-sm',
              selectedDate === date ? 'bg-teal text-on-teal' : 'pressable'
            )}
          >
            <span className={cn('text-2xs', selectedDate === date ? 'text-on-teal/80' : 'text-muted')}>{WEEKDAY_LABELS[d.getDay()]}</span>
            <span>{d.getDate()}</span>
            {!!byDate.get(date)?.recorded_charge_count && <span className="h-1 w-1 rounded-full bg-tangerine" aria-hidden />}
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
          <Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label="Previous month" onClick={() => onMonth(shiftMonth(month, -1))}><ChevronLeft aria-hidden className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label="Next month" onClick={() => onMonth(shiftMonth(month, 1))}><ChevronRight aria-hidden className="h-4 w-4" /></Button>
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
                    selectedDate === date ? 'bg-teal text-on-teal' : 'pressable'
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
      <QueryState data={report} isError={query.isError} onRetry={() => void query.refetch()}>{(report) =>
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
      </>}</QueryState>
    </PageCard>
  );
}

const PANEL_TYPES = ['subscription', 'budget', 'goal', 'trip', 'charge'] as const;
type Panel = { type: (typeof PANEL_TYPES)[number]; id: number };
type UpcomingItem = UpcomingPlan['items'][number];

// Plan is "the future" (HIG alignment, 2026-10-01): this month's projection,
// upcoming charges, and the budgets, goals, subscriptions and trips that
// shape them, on one scrolling page. A selected item opens through
// ListDetail: pushed on a phone, an inspector column on md+. On a phone each
// charge is a row that opens its own page; with room, charges show their
// actions inline.
export function PlanPage() {
  const [search, setSearch] = useSearchParams();
  const [, updateParams] = useUrlParams();
  const isDesktop = useIsDesktop();
  const isPhone = useIsPhone();
  const navigate = useNavigate();
  const location = useLocation();
  // Window, page and phone calendar view live in the URL (replace-history)
  // so returning from a detail restores them. Invalid values fall back.
  const daysParam = Number(search.get('days'));
  const days = [14, 30, 90].includes(daysParam) ? daysParam : 30;
  const offsetParam = Number(search.get('offset'));
  const offset = Number.isInteger(offsetParam) && offsetParam > 0 && offsetParam % 50 === 0 ? offsetParam : 0;
  const showCalendarMobile = search.get('view') === 'calendar';

  const setDays = (value: number) => updateParams({ days: value === 30 ? null : String(value), offset: null });
  const setOffset = (value: number) => updateParams({ offset: value ? String(value) : null });
  const setShowCalendarMobile = (open: boolean) => updateParams({ view: open ? 'calendar' : null });
  const selectedDate = search.get('date');
  const calendarMonth = search.get('month') || toDateStr(new Date()).slice(0, 7);

  // The open detail: exactly one of these params is set at a time. Setting
  // one clears the others, so deep links (e.g. Explore's "review this
  // subscription") always land on a single, unambiguous detail.
  const panel: Panel | null = (() => {
    for (const type of PANEL_TYPES) {
      const id = Number(search.get(type));
      if (Number.isSafeInteger(id) && id > 0) return { type, id };
    }
    return null;
  })();
  function withPanel(type: Panel['type'] | null, id?: number) {
    const params = new URLSearchParams(search);
    for (const other of PANEL_TYPES) params.delete(other);
    if (type) params.set(type, String(id));
    return params;
  }
  const panelHref = (type: Panel['type'], id: number) => `/plan?${withPanel(type, id).toString()}`;
  // Opening a detail pushes history, so the back gesture closes it; closing
  // one that was opened here pops that entry instead of pushing another.
  const openPanel = (type: Panel['type'], id: number) => setSearch(withPanel(type, id), { state: { panel: true } });
  function closePanel() {
    if ((location.state as { panel?: boolean } | null)?.panel) { navigate(-1); return; }
    setSearch(withPanel(null), { replace: true });
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
    const groups: { date: string; items: UpcomingItem[] }[] = [];
    for (const item of report?.items ?? []) {
      const last = groups[groups.length - 1];
      if (last && last.date === item.date) last.items.push(item); else groups.push({ date: item.date, items: [item] });
    }
    return groups;
  }, [report]);

  const selectDate = (date: string) => updateParams({ date: search.get('date') === date ? null : date });
  const setCalendarMonth = (month: string) => updateParams({ month });

  // A date's charges can straddle an agenda page boundary; only treat the
  // highlighted agenda group as the full day when it cannot have been cut.
  const selectedIndex = selectedDate ? grouped.findIndex(g => g.date === selectedDate) : -1;
  const cutBefore = offset > 0 && selectedIndex === 0;
  const cutAfter = !!report && offset + report.items.length < report.total && selectedIndex === grouped.length - 1;
  const selectedInAgenda = selectedIndex >= 0 && !cutBefore && !cutAfter;

  const { data: settings } = useSettings();
  const anyManageEnabled = !!settings && (settings.budgets_enabled || settings.subscriptions_enabled || settings.recurring_enabled || settings.goals_enabled || settings.trips_enabled);

  const calendarPane = isDesktop ? (
    <MonthCalendar month={calendarMonth} onMonth={setCalendarMonth} selectedDate={selectedDate} onSelect={selectDate} />
  ) : (
    <div>
      <WeekStrip selectedDate={selectedDate} onSelect={selectDate} />
      <Button variant="ghost" size="sm" className="mt-1 text-teal" aria-expanded={showCalendarMobile} onClick={() => setShowCalendarMobile(!showCalendarMobile)}>
        {showCalendarMobile ? 'Hide calendar' : 'View calendar'}
      </Button>
      {showCalendarMobile && <div className="mt-2">
        <MonthCalendar month={calendarMonth} onMonth={setCalendarMonth} selectedDate={selectedDate} onSelect={selectDate} />
      </div>}
    </div>
  );

  const chargeMeta = (item: UpcomingItem) => <>
    <p className="text-muted"><time dateTime={item.date}>{formatShortDate(item.date)}</time> · {frequencyLabel(item.frequency)} · {item.date_basis === 'user' ? 'Date you set' : 'Scheduled estimate'}</p>
    <p className="text-sm text-muted">{amountBasisLabels[item.amount_basis]}</p>
    <p className="text-sm text-muted">{subscriptionConfirmationLabels[item.confirmation_source]}</p>
    {item.schedule_status === 'possibly_cancelled' && <p className="text-warning">Schedule needs review: a previous charge may be overdue.</p>}
  </>;

  const timeline = (
    <section aria-labelledby="plan-upcoming-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 id="plan-upcoming-heading" className="font-display text-lg font-bold tracking-[-0.01em]">Upcoming</h2>
      </div>
      <SegmentedChoice<PlanWindow>
        name="plan-window"
        aria-label="Window"
        value={String(days) as PlanWindow}
        onValueChange={(value) => setDays(Number(value))}
        className="w-full"
        options={[{ value: '14', label: 'Next 14 days' }, { value: '30', label: 'Next 30 days' }, { value: '90', label: 'Next 90 days' }]}
      />
      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        <div className="lg:col-span-5">{calendarPane}</div>
        <div className="space-y-3 lg:col-span-7">
          {query.isError && <div role="alert">{report ? <p className="text-warning">Couldn't refresh. This timeline may be out of date.</p> : null}<LoadFailed onRetry={() => void query.refetch()} /></div>}
          {!report && !query.isError && <div role="status"><span className="sr-only">Loading upcoming charges…</span><Skeleton className="h-20 w-full rounded-group" /></div>}
          {report && (!report.enabled ? <ListGroup title="Track upcoming charges">
            <div className="p-4">
              <p>Enable Subscriptions in Settings to see your recorded schedules here.</p>
              <Link to="/settings" className="inline-flex min-h-11 items-center text-teal">Open Settings</Link>
            </div>
          </ListGroup> : <>
            <div className="px-1">
              <p className="font-mono text-3xl font-medium tabular-nums">{formatMoney(report.known_total)}</p>
              <p className="text-muted">{report.status === 'partial' ? 'Known estimated subtotal' : 'Estimated charges'}, {formatShortDate(report.start)}–{formatShortDate(report.end)}</p>
              {!!report.unknown_count && <p className="text-warning">{report.unknown_count} {report.unknown_count === 1 ? 'charge has an unknown amount and isn’t' : 'charges have unknown amounts and aren’t'} included.</p>}
              <details className="text-sm">
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-teal">About these estimates</summary>
                <p className="max-w-prose text-muted">Dates and amounts are estimates, not confirmed charges. Only recorded pending schedules appear; this is not a complete forecast. Matched or dismissed charges are excluded.</p>
              </details>
            </div>
            <div id="upcoming-agenda" tabIndex={-1} aria-label="Upcoming charges" className="rounded-group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {grouped.map(group => <div key={group.date} id={`agenda-date-${group.date}`} className="scroll-mt-24">
                <h3 className={cn('px-1 pb-1.5 pt-4 text-xs font-semibold first:pt-0', selectedDate === group.date ? 'text-teal' : 'text-muted')}>{formatShortDate(group.date)}</h3>
                <ol className={cn('overflow-hidden rounded-group bg-card', selectedDate === group.date && 'ring-2 ring-teal/40')}>
                  {/* One compact row per charge; its actions live in the charge's detail (desktop pass, 2026-10-07). */}
                  {group.items.map(item => (
                    <li key={item.id} className="separator-inset">
                      <ListRow onClick={() => openPanel('charge', item.id)} title={item.label}
                        selected={panel?.type === 'charge' && panel.id === item.id}
                        subtitle={`${frequencyLabel(item.frequency)}${item.schedule_status === 'possibly_cancelled' ? ' · needs review' : ''}`}
                        {...(item.amount ? { amount: formatMoney(item.amount), amountTone: 'estimate' as const } : { value: 'Amount unknown' })} trailing="chevron" />
                    </li>
                  ))}
                </ol>
              </div>)}
            </div>
            {!report.items.length && (report.total
              ? <p className="px-1 py-2 text-muted">No charges on this page. Return to an earlier page.</p>
              : <div className="px-1 py-2">
                  <p className="text-muted">No pending charges recorded in this window.</p>
                  {settings?.subscriptions_enabled && <Button type="button" variant="ghost" className="-ml-3 min-h-11 text-teal" onClick={() => document.getElementById('plan-subscriptions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Add a subscription</Button>}
                </div>)}
            {report.total > 50 && <nav aria-label="Upcoming charge pages" className="flex items-center justify-between gap-3">
              <Button variant="ghost" className="min-h-11 text-teal" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous charges</Button>
              <span className="text-sm text-muted">{report.total} recorded charges</span>
              <Button variant="ghost" className="min-h-11 text-teal" disabled={query.isError || offset + 50 >= report.total} onClick={() => setOffset(offset + 50)}>Next charges</Button>
            </nav>}
            {selectedDate && !selectedInAgenda && <SelectedDayDetail date={selectedDate} />}
          </>)}
        </div>
      </div>
    </section>
  );

  const manage = !settings ? null : !anyManageEnabled ? (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-muted">Enable Budgets, Goals, Trips, Subscriptions, or Recurring in Settings to get started.</p>
      <Link to="/settings" className="inline-flex min-h-11 items-center text-sm text-teal">Go to Settings</Link>
    </div>
  ) : (
    <section aria-labelledby="plan-manage-heading" className="space-y-4">
      <h2 id="plan-manage-heading" className="sr-only">Budgets, goals, subscriptions &amp; trips</h2>
      {/* Two-up on iPad, one column beside the timeline on desktop. */}
      <div className="grid items-start gap-6 md:grid-cols-2 lg:grid-cols-1">
        {settings.budgets_enabled && <BudgetsCard onSelect={(id) => openPanel('budget', id)} />}
        {settings.goals_enabled && <GoalsCard onSelect={(id) => openPanel('goal', id)} />}
        {settings.subscriptions_enabled && <div id="plan-subscriptions" className="scroll-mt-24"><SubscriptionsSection selectedSubId={panel?.type === 'subscription' ? panel.id : null} onSelectSub={(id) => openPanel('subscription', id)} /></div>}
        {settings.recurring_enabled && <RecurringCard />}
        {settings.trips_enabled && <TripsCard onSelect={(id) => openPanel('trip', id)} />}
      </div>
    </section>
  );

  const page = (
    <div className="mx-auto max-w-[1200px] md:px-2">
      <NavBar large title="Plan" trailing={isPhone ? <ProfileMenu /> : undefined} />
      {/* Two columns from lg (desktop pass, 2026-10-07): the month and its
          charges on the left, the tools on the right, all in the first screen. */}
      <div className="grid gap-6 px-4 pb-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
        <div className="min-w-0 space-y-6">
          <ProjectionMonth />
          {timeline}
        </div>
        <div className="min-w-0 space-y-6">
          {settings?.goals_enabled && <SavingsTiles />}
          {manage}
        </div>
      </div>
    </div>
  );

  const chargeItem = panel?.type === 'charge' ? report?.items.find((item) => item.id === panel.id) : undefined;
  const detail = !panel ? null : (
    <div className="flex h-full flex-col">
      {panel.type === 'subscription' && <SubscriptionDetail subId={panel.id} onClose={closePanel} />}
      {panel.type === 'budget' && <BudgetDetail budgetId={panel.id} onClose={closePanel} />}
      {panel.type === 'goal' && <GoalDetail goalId={panel.id} onClose={closePanel} />}
      {panel.type === 'trip' && <TripDetail tripId={panel.id} onClose={closePanel} />}
      {panel.type === 'charge' && <>
        <DetailHeader title={chargeItem?.label ?? 'Charge'} onClose={closePanel} />
        <div className="space-y-3 p-4">
          {!chargeItem ? <p className="text-muted">This charge isn't on the current page of the timeline.</p> : <>
            <p className="pb-1 pt-2 text-center font-mono text-3xl font-medium tabular-nums">{chargeItem.amount ? formatMoney(chargeItem.amount) : 'Amount unknown'}</p>
            {chargeMeta(chargeItem)}
            <ChargeActions item={chargeItem} onDismissed={() => { agendaFocusPending.current = true; closePanel(); }} />
            {chargeItem.subscription_id != null && <Link to={panelHref('subscription', chargeItem.subscription_id)} className="inline-flex min-h-11 items-center text-teal">Review or match schedule</Link>}
          </>}
        </div>
      </>}
    </div>
  );

  // ── Phone: one screen (approved 2026-10-06, phone quick view) ─────────────
  const phoneViews = !isPhone ? [] : [
    { value: 'soon' as const, label: 'Soon', panel: (
      <div className="space-y-3 pb-2">
        {!report ? (query.isError ? <LoadFailed onRetry={() => void query.refetch()} /> : <Skeleton className="h-64 rounded-group" />)
          : !report.enabled ? (
            <ListGroup><ListRow to="/settings" title="Turn on Subscriptions" subtitle="Upcoming charges come from your subscriptions" trailing="chevron" /></ListGroup>
          ) : (
            <ListGroup>
              <ListRow
                title={`Next ${days} days`}
                subtitle={`${report.total} ${report.total === 1 ? 'charge' : 'charges'}${report.unknown_count ? ` · ${report.unknown_count} unpriced` : ''}`}
                amount={formatMoney(report.known_total)}
                amountTone="estimate"
              />
              {report.items.slice(0, 8).map((item) => (
                <ListRow
                  key={item.id}
                  onClick={() => openPanel('charge', item.id)}
                  title={item.label}
                  subtitle={formatShortDate(item.date)}
                  {...(item.amount ? { amount: formatMoney(item.amount), amountTone: 'estimate' as const } : { value: 'Unknown' })}
                  trailing="chevron"
                />
              ))}
              {report.total > 8 && <ListRow onClick={() => setDays(90)} title={`${report.total - 8} more`} trailing="chevron" />}
            </ListGroup>
          )}
        <ListGroup><ListRow onClick={() => setShowCalendarMobile(!showCalendarMobile)} title={showCalendarMobile ? 'Hide calendar' : 'Calendar'} aria-label={showCalendarMobile ? 'Hide calendar' : 'Show calendar'} trailing="chevron" /></ListGroup>
        {showCalendarMobile && <MonthCalendar month={calendarMonth} onMonth={setCalendarMonth} selectedDate={selectedDate} onSelect={selectDate} />}
      </div>
    ) },
    ...(settings?.budgets_enabled ? [{ value: 'budgets' as const, label: 'Budgets', panel: <div className="pb-2"><BudgetsCard onSelect={(id) => openPanel('budget', id)} /></div> }] : []),
    ...(settings?.goals_enabled ? [{ value: 'goals' as const, label: 'Goals', panel: <div className="space-y-3 pb-2"><SavingsTiles /><GoalsCard onSelect={(id) => openPanel('goal', id)} /></div> }] : []),
    ...(settings?.subscriptions_enabled || settings?.recurring_enabled ? [{ value: 'subs' as const, label: 'Subs', panel: (
      <div className="space-y-6 pb-2">
        {settings.subscriptions_enabled && <SubscriptionsSection selectedSubId={panel?.type === 'subscription' ? panel.id : null} onSelectSub={(id) => openPanel('subscription', id)} />}
        {settings.recurring_enabled && <RecurringCard />}
      </div>
    ) }] : []),
    ...(settings?.trips_enabled ? [{ value: 'trips' as const, label: 'Trips', panel: <div className="pb-2"><TripsCard onSelect={(id) => openPanel('trip', id)} /></div> }] : []),
  ];
  const viewParam = search.get('lens');
  const phoneView: PlanView = phoneViews.some((v) => v.value === viewParam) ? (viewParam as PlanView) : 'soon';
  const phonePage = isPhone && (
    <PhoneScreen
      navBar={<NavBar large title="Plan" trailing={<ProfileMenu />} />}
      summary={<PhoneProjection />}
      views={phoneViews}
      view={phoneView}
      onViewChange={(next) => updateParams({ lens: next === 'soon' ? null : next })}
      label="Plan views"
    />
  );

  return <ListDetail variant="inspector" listLabel="Plan" backLabel="Plan" list={phonePage || page} detail={detail} onClose={closePanel} />;
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
      await invalidateSpendingQueries(client);
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
