import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { evidenceLink, formatMoney, type SpendingFacts } from '@/api/briefing';
import { StatCard } from '@/components/ui/StatCard';
import { StatusDot } from '@/components/ui/StatusDot';
import { HeroAmount } from '@/components/ui/HeroAmount';
import { Skeleton } from '@/components/ui/skeleton';
import { datesInRange, getCategoryColor } from '@/lib/utils';
import { formatChange, formatRange } from './format';

/**
 * The month at a glance: a double-width hero for spend so far, then the
 * change against the same days last month and income. Every value comes
 * from the shared month facts, so they agree with Home and Telegram; each
 * tile opens the evidence behind it.
 */
export function PulseBand({ facts }: { facts: SpendingFacts | undefined }) {
  const current = facts?.current;
  const { data: daily } = useQuery({
    queryKey: ['explore-daily-totals', current?.start, current?.end],
    queryFn: () => api.getDailyTotalsV2(current!.start, current!.end),
    enabled: !!current,
  });

  if (!facts || !current) {
    return (
      <div role="status" className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <span className="sr-only">Loading…</span>
        <Skeleton className="col-span-2 h-[132px] rounded-lg" />
        <Skeleton className="h-[132px] rounded-lg" />
        <Skeleton className="h-[132px] rounded-lg" />
      </div>
    );
  }

  // Running total through the month: the shape of how the spend built up.
  let running = 0;
  const cumulative = daily
    ? datesInRange(current.start, current.end).map((date) => {
        running += daily.find((d) => d.date === date)?.spending.minor_units ?? 0;
        return running / 100;
      })
    : undefined;

  const { previous, change } = facts;
  const changePercent = change && previous.spending.minor_units > 0
    ? (change.minor_units / previous.spending.minor_units) * 100
    : undefined;

  const spentNote = current.unresolved_count
    ? `${current.unresolved_count} ${current.unresolved_count === 1 ? 'record needs' : 'records need'} review`
    : `${current.transaction_count} ${current.transaction_count === 1 ? 'record' : 'records'}${current.status === 'indicative' ? ' · includes indicative FX' : ''}`;

  const netNote = current.recorded_net_flow
    ? `Recorded net flow ${formatChange(current.recorded_net_flow)}`
    : current.income
      ? 'Net flow hidden while records need review'
      : 'No income recorded this month';

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
      <StatCard
        className="col-span-2"
        hero
        color="warm"
        label="Spent this month"
        value={<HeroAmount value={current.spending} className="text-3xl lg:text-5xl" />}
        subtext={`${formatRange(current.start, current.end)} · ${spentNote}`}
        sparklineData={cumulative}
        sparklineSize={{ width: 100, height: 40 }}
        href={evidenceLink(current)}
      />
      <StatCard
        label="vs. last month"
        value={change ? formatChange(change) : 'Unavailable'}
        color={!change ? 'default' : change.minor_units > 0 ? 'coral' : 'mint'}
        delta={changePercent !== undefined ? { value: changePercent } : undefined}
        subtext={change
          ? `${formatRange(previous.start, previous.end)}: ${formatMoney(previous.spending)}`
          : 'Resolve records needing review to compare'}
        href={change ? '/explore?mode=by-category#explore-patterns' : '/review'}
      />
      <StatCard
        label="Income"
        value={current.income ? formatMoney(current.income) : 'None yet'}
        color={current.income ? 'teal' : 'default'}
        subtext={netNote}
        href={evidenceLink(current, undefined, 'income')}
      />
    </div>
  );
}

/** The category that moved most against the same days last month. */
export function BiggestMoverTile({ facts }: { facts: SpendingFacts | undefined }) {
  if (!facts) return <Skeleton className="h-[112px] rounded-lg" />;
  const top = facts.category_changes[0];
  return (
    <StatCard
      label="Biggest mover"
      value={top
        ? <span className="inline-flex items-center gap-2 min-w-0"><StatusDot color={getCategoryColor(top.category)} /><span className="truncate">{top.category}</span></span>
        : 'None'}
      subtext={top ? `${formatChange(top.change)} vs. the same days last month` : 'No category changed against last month'}
      href={top ? evidenceLink(facts.comparison_current, top.category) : undefined}
    />
  );
}
