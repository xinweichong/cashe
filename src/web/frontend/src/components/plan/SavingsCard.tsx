import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ListGroup, ListRow } from '@/components/ui/list';
import { formatCurrencyWhole } from '@/lib/utils';

// This month's savings as a grouped list (Direction B, 2026-10-01): Plan's
// one spectrum card is the month's projection, so savings stay plain rows.
export function SavingsCard() {
  const { data: overview } = useQuery({
    queryKey: ['savings-overview'],
    queryFn: () => api.getSavingsOverview(),
    staleTime: 30_000,
  });

  if (!overview) return null;

  const monthLabel = new Date(overview.month + '-01').toLocaleString('en', { month: 'long', year: 'numeric' });
  return (
    <ListGroup title={`Savings, ${monthLabel}`}>
      <ListRow title="Saved" subtitle="Income minus expenses" amount={<span className="text-success">{formatCurrencyWhole(overview.savings)}</span>} />
      <ListRow title="Toward goals" subtitle="Added by you" amount={formatCurrencyWhole(overview.allocated_to_goals)} />
      <ListRow title="Unallocated" subtitle="Free to allocate" amount={formatCurrencyWhole(overview.unallocated)} />
    </ListGroup>
  );
}
