import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { formatMoney } from '@/api/briefing';
import { StatTiles } from '@/components/ui/detail-panel';
import { formatCurrency, minorToMajor } from '@/lib/utils';
import { useHomeBriefing } from '@/hooks/useBriefing';

// This month's savings as three tiles (Plan's right column and phone Goals
// view), coloured by role (lib/moneyTone): saved in teal, toward goals in
// honey. "Saved" is the shared month facts' net flow, the figure Home shows.
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
