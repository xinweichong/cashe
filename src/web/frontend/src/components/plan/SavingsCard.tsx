import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { formatMoney } from '@/api/briefing';
import { ListGroup, ListRow } from '@/components/ui/list';
import { StatTiles } from '@/components/ui/detail-panel';
import { formatCurrency, minorToMajor } from '@/lib/utils';
import { useHomeBriefing } from '@/hooks/useBriefing';

// This month's savings as a grouped list (Direction B, 2026-10-01): Plan's
// one spectrum card is the month's projection, so savings stay plain rows.
// "Saved" is the shared month facts' net flow, the figure Home shows, so it
// is hidden on both screens while records need review.
export function SavingsCard() {
  const { data: briefing } = useHomeBriefing();
  const { data: overview } = useQuery({
    queryKey: ['savings-overview'],
    queryFn: () => api.getSavingsOverview(),
    staleTime: 30_000,
  });

  if (!briefing || !overview) return null;

  const current = briefing.facts.current;
  const saved = current.recorded_net_flow;
  const monthLabel = new Date(`${current.start}T00:00:00Z`).toLocaleString('en-SG', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const notYetToGoals = saved ? minorToMajor(saved.minor_units, saved.currency) - overview.allocated_to_goals : null;
  return (
    <ListGroup title={`Savings, ${monthLabel}`} footer="Saved is this month’s income minus spending; toward goals is what you’ve set aside for them.">
      <ListRow
        title="Saved"
        {...(saved
          ? { amount: <span className={saved.minor_units < 0 ? undefined : 'text-success'}>{formatMoney(saved)}</span> }
          : { value: current.income ? 'Shows once records are reviewed' : 'No income recorded yet' })}
      />
      <ListRow title="Toward goals" amount={formatCurrency(overview.allocated_to_goals)} />
      {notYetToGoals != null && notYetToGoals > 0 && (
        <ListRow title="Not yet toward a goal" amount={formatCurrency(notYetToGoals)} />
      )}
    </ListGroup>
  );
}

/** The same savings as three tiles for Plan's phone Goals view, coloured by
 * role (lib/moneyTone): saved in teal, toward goals in honey. */
export function SavingsTiles() {
  const { data: briefing } = useHomeBriefing();
  const { data: overview } = useQuery({ queryKey: ['savings-overview'], queryFn: () => api.getSavingsOverview(), staleTime: 30_000 });
  if (!briefing || !overview) return null;
  const saved = briefing.facts.current.recorded_net_flow;
  const free = saved ? minorToMajor(saved.minor_units, saved.currency) - overview.allocated_to_goals : null;
  return (
    <StatTiles columns={3} items={[
      { label: 'Saved', value: saved ? formatMoney(saved) : '—', color: saved && saved.minor_units >= 0 ? 'var(--color-teal)' : undefined },
      { label: 'To goals', value: formatCurrency(overview.allocated_to_goals), color: 'var(--color-honey)' },
      { label: 'Free', value: free != null && free > 0 ? formatCurrency(free) : '—' },
    ]} />
  );
}
