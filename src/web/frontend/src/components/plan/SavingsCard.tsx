import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { HeroCard } from '@/components/ui/cards';
import { formatCurrencyWhole } from '@/lib/utils';

export function SavingsCard() {
  const { data: overview } = useQuery({
    queryKey: ['savings-overview'],
    queryFn: () => api.getSavingsOverview(),
    staleTime: 30_000,
  });

  if (!overview) return null;

  const monthLabel = new Date(overview.month + '-01').toLocaleString('en', { month: 'long', year: 'numeric' });

  return (
    <HeroCard title={`Savings — ${monthLabel}`} glowColor="teal">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 py-1">
        <div>
          <p className="text-xs font-semibold font-mono uppercase tracking-[0.22em] text-muted mb-0.5">Saved</p>
          <p className="text-lg font-semibold text-success">{formatCurrencyWhole(overview.savings)}</p>
          <p className="text-xs text-muted font-mono">income − expenses</p>
        </div>
        <div>
          <p className="text-xs font-semibold font-mono uppercase tracking-[0.22em] text-muted mb-0.5">Toward Goals</p>
          <p className="text-lg font-semibold text-teal">{formatCurrencyWhole(overview.allocated_to_goals)}</p>
          <p className="text-xs text-muted font-mono">manually added</p>
        </div>
        <div>
          <p className="text-xs font-semibold font-mono uppercase tracking-[0.22em] text-muted mb-0.5">Unallocated</p>
          <p className="text-lg font-semibold text-foreground">{formatCurrencyWhole(overview.unallocated)}</p>
          <p className="text-xs text-muted font-mono">free to allocate</p>
        </div>
      </div>
    </HeroCard>
  );
}
