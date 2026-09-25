import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card } from '@/components/ui/card';
import { HeroCard } from '@/components/ui/cards';
import { formatCurrencyWhole } from '@/lib/utils';

export function SavingsCard({ compact = false }: { compact?: boolean }) {
  const { data: overview } = useQuery({
    queryKey: ['savings-overview'],
    queryFn: () => api.getSavingsOverview(),
    staleTime: 30_000,
  });

  if (!overview) return null;

  const monthLabel = new Date(overview.month + '-01').toLocaleString('en', { month: 'long', year: 'numeric' });

  // The phone's Goals lens: the same three figures as one flat strip, so
  // the goals list below keeps the room (and the lens keeps its one glow).
  if (compact) {
    const figures = [
      { label: 'Saved', value: overview.savings, className: 'text-success' },
      { label: 'To goals', value: overview.allocated_to_goals, className: 'text-teal' },
      { label: 'Free', value: overview.unallocated, className: 'text-foreground' },
    ];
    return (
      <Card aria-label={`Savings, ${monthLabel}`} className="grid grid-cols-3 divide-x divide-border py-3">
        {figures.map((f) => (
          <div key={f.label} className="px-3">
            <p className="text-2xs font-semibold font-mono uppercase tracking-[0.18em] text-muted">{f.label}</p>
            <p className={`text-base font-semibold tabular-nums ${f.className}`}>{formatCurrencyWhole(f.value)}</p>
          </div>
        ))}
      </Card>
    );
  }

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
