import { useQuery } from '@tanstack/react-query';
import { api, type RecurringTransaction } from '@/api/client';
import { PageCard } from '@/components/ui/cards';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { getCategoryColor, formatCurrencyWhole } from '@/lib/utils';

export function RecurringCard() {
  const { data: recurring = [], isLoading } = useQuery({
    queryKey: ['recurring'],
    queryFn: () => api.getRecurring(),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <PageCard title="Recurring transactions">
      {isLoading ? (
        <Skeleton className="h-24" />
      ) : recurring.length === 0 ? (
        <p className="text-muted text-sm py-4 text-center">
          No recurring patterns yet. They appear after two or more consistent transactions.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {recurring.map((r: RecurringTransaction) => {
            const catColor = getCategoryColor(r.category);
            return (
              <div key={r.id} className="flex items-center gap-3 py-3">
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-medium shrink-0"
                  style={{ background: `${catColor}33`, color: catColor }}
                >
                  {r.category}
                </span>
                <span className="flex-1 min-w-0 text-sm font-medium text-foreground truncate">
                  {r.merchant}
                </span>
                <Badge variant="outline" className="shrink-0 capitalize text-muted">
                  {r.frequency}
                </Badge>
                <span className="text-sm font-mono text-foreground shrink-0">
                  ~{formatCurrencyWhole(r.avg_amount)}/{r.frequency === 'weekly' ? 'wk' : r.frequency === 'biweekly' ? '2wk' : 'mo'}
                </span>
                <span className="text-xs text-muted font-mono shrink-0 hidden sm:block">
                  {r.last_seen}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </PageCard>
  );
}
