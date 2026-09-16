import { useMemo, useState } from 'react';
import { HeroCard, PageCard } from '@/components/ui/cards';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatShortDate, cn } from '@/lib/utils';
import { PROJECTION, PENDING_CHARGES, MONTH_LABEL, MONTH_DAYS, MONTH_START_WEEKDAY } from './planFixtures';
import { useIsDesktop } from './useIsDesktop';

// Plan layout study (increment 2): spatial composition of the projection
// hero and the month-calendar/agenda pairing across breakpoints, per
// docs/plans/2026-09-16-cashe-design-language-restoration.md. Reviews
// placement and the recorded/estimated visual distinction, not final
// calendar-completeness behaviour (no pagination/coverage logic here).
// Fixture data only, no backend. Mounted at /dev/preview/plan (dev-only).

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function PlanLayoutStudy() {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showCalendarMobile, setShowCalendarMobile] = useState(false);
  const isDesktop = useIsDesktop();

  const chargeDays = useMemo(() => new Set(PENDING_CHARGES.map((c) => c.date)), []);
  const total = PROJECTION.recorded + PROJECTION.committed + PROJECTION.estimatedRemaining;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6" data-testid="plan-layout-study">
      <header>
        <h1 className="font-display text-2xl font-semibold">Plan</h1>
        <p className="text-muted text-sm">Understand what's approaching and when.</p>
      </header>

      <HeroCard title="Projected total">
        <p className="font-display text-4xl md:text-5xl font-bold tracking-tight tabular-nums text-foreground">{formatCurrency(total)}</p>
        <p className="mt-2 text-sm text-muted">Recorded plus scheduled and estimated remaining spending.</p>

        <div className="mt-4 h-4 w-full rounded-pill overflow-hidden flex" role="img" aria-label={`Recorded ${formatCurrency(PROJECTION.recorded)}, scheduled ${formatCurrency(PROJECTION.committed)}, estimated remaining ${formatCurrency(PROJECTION.estimatedRemaining)}`}>
          <span className="h-full bg-teal" style={{ width: `${(PROJECTION.recorded / total) * 100}%` }} />
          <span className="h-full bg-honey" style={{ width: `${(PROJECTION.committed / total) * 100}%` }} />
          <span
            className="h-full bg-tangerine"
            style={{
              width: `${(PROJECTION.estimatedRemaining / total) * 100}%`,
              backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,.18) 3px, rgba(0,0,0,.18) 6px)',
            }}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs font-mono uppercase tracking-[0.1em] text-muted">
          <span><span className="inline-block w-2 h-2 rounded-full bg-teal mr-1" aria-hidden />Recorded {formatCurrency(PROJECTION.recorded)}</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-honey mr-1" aria-hidden />Scheduled (est.) {formatCurrency(PROJECTION.committed)}</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-tangerine mr-1" aria-hidden />Remaining (est.) {formatCurrency(PROJECTION.estimatedRemaining)}</span>
        </div>

        <div className="mt-6">
          <p className="text-2xs font-mono uppercase tracking-[0.1em] text-muted mb-1">Range, based on recorded weekday history</p>
          <div className="relative h-2 rounded-pill bg-card-hover">
            <div className="absolute inset-y-0 rounded-pill bg-foreground/20" style={{ left: '20%', right: '15%' }} />
          </div>
          <div className="flex justify-between text-sm font-mono tabular-nums mt-1">
            <span>{formatCurrency(PROJECTION.low)}</span>
            <span>{formatCurrency(PROJECTION.high)}</span>
          </div>
        </div>
      </HeroCard>

      {/* Month calendar + agenda: paired on wide layouts, week strip + agenda
          (calendar available on demand) on phone/portrait tablet. */}
      <div className="lg:grid lg:grid-cols-[280px_1fr] lg:gap-6 lg:items-start">
        {isDesktop ? (
          <MonthCalendar chargeDays={chargeDays} selectedDay={selectedDay} onSelect={setSelectedDay} />
        ) : (
          <div className="mb-4">
            <WeekStrip chargeDays={chargeDays} selectedDay={selectedDay} onSelect={setSelectedDay} />
            <Button variant="ghost" size="sm" className="mt-2 text-teal" onClick={() => setShowCalendarMobile((v) => !v)}>
              {showCalendarMobile ? 'Hide calendar' : 'View calendar'}
            </Button>
            {showCalendarMobile && (
              <div className="mt-3">
                <MonthCalendar chargeDays={chargeDays} selectedDay={selectedDay} onSelect={setSelectedDay} />
              </div>
            )}
          </div>
        )}

        <PageCard title="Agenda">
          <p className="text-sm text-muted mb-3">Next 14 days</p>
          <ul className="divide-y divide-border">
            {PENDING_CHARGES.map((c) => (
              <li
                key={c.id}
                data-testid={`agenda-row-${c.date}`}
                className={cn('py-3 flex items-center justify-between gap-4 px-2 -mx-2 rounded-md', selectedDay === c.date && 'bg-card-hover')}
              >
                <div>
                  <p className="text-sm font-medium">{c.label}</p>
                  <p className="text-xs font-mono text-muted">{formatShortDate(c.date)}</p>
                </div>
                <span className="text-sm font-mono tabular-nums">{c.amount != null ? formatCurrency(c.amount) : 'Amount unknown'}</span>
              </li>
            ))}
          </ul>
        </PageCard>
      </div>
    </div>
  );
}

function WeekStrip({
  chargeDays, selectedDay, onSelect,
}: {
  chargeDays: Set<string>;
  selectedDay: string | null;
  onSelect: (d: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => `2026-09-${String(8 + i).padStart(2, '0')}`);
  return (
    <div className="flex justify-between gap-1" data-testid="week-strip">
      {days.map((date, i) => (
        <button
          key={date}
          type="button"
          onClick={() => onSelect(date)}
          aria-pressed={selectedDay === date}
          className={cn(
            'flex-1 min-h-11 flex flex-col items-center justify-center gap-1 rounded-md text-sm',
            selectedDay === date ? 'bg-teal/13 text-teal' : 'hover:bg-card-hover'
          )}
        >
          <span className="text-2xs text-muted">{WEEKDAY_LABELS[i]}</span>
          <span>{8 + i}</span>
          {chargeDays.has(date) && <span className="w-1 h-1 rounded-full bg-tangerine" aria-hidden />}
        </button>
      ))}
    </div>
  );
}

function MonthCalendar({
  chargeDays, selectedDay, onSelect,
}: {
  chargeDays: Set<string>;
  selectedDay: string | null;
  onSelect: (d: string) => void;
}) {
  const cells = [
    ...Array.from({ length: MONTH_START_WEEKDAY }, () => null),
    ...Array.from({ length: MONTH_DAYS }, (_, i) => i + 1),
  ];
  return (
    <div data-testid="month-calendar">
      <PageCard title={MONTH_LABEL}>
        <div className="grid grid-cols-7 gap-1 text-2xs text-muted text-center mb-1">
          {WEEKDAY_LABELS.map((w, i) => <span key={i}>{w}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (day == null) return <span key={`blank-${i}`} />;
            const date = `2026-09-${String(day).padStart(2, '0')}`;
            const hasCharge = chargeDays.has(date);
            return (
              <button
                key={date}
                type="button"
                onClick={() => onSelect(date)}
                aria-pressed={selectedDay === date}
                className={cn(
                  'aspect-square min-h-9 flex flex-col items-center justify-center rounded-md text-sm',
                  selectedDay === date ? 'bg-teal/13 text-teal' : 'hover:bg-card-hover'
                )}
              >
                {day}
                {hasCharge && <span className="w-1 h-1 rounded-full bg-tangerine mt-0.5" aria-hidden />}
              </button>
            );
          })}
        </div>
      </PageCard>
    </div>
  );
}
