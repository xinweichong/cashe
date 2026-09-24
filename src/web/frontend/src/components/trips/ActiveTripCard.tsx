import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function ActiveTripCard({ showEndButton = false }: { showEndButton?: boolean }) {
  const qc = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
    staleTime: 30_000,
  });

  const { data: activeTrip } = useQuery({
    queryKey: ['trips-active'],
    queryFn: () => api.getActiveTrip().catch(() => null),
    enabled: settings?.trips_enabled === true,
    staleTime: 30_000,
  });

  const { data: summary } = useQuery({
    queryKey: ['trip-summary', activeTrip?.id],
    queryFn: () => api.getTripSummary(activeTrip!.id),
    enabled: activeTrip != null,
    staleTime: 30_000,
  });

  const deactivateMutation = useMutation({
    mutationFn: () => api.deactivateTrip(activeTrip!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      qc.invalidateQueries({ queryKey: ['trips-active'] });
    },
  });

  if (!settings?.trips_enabled || !activeTrip) return null;

  const [sy, sm, sd] = activeTrip.start_date.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd); // local midnight, avoids UTC parse
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysElapsed = Math.max(1, Math.floor((today.getTime() - start.getTime()) / 86400000) + 1);

  return (
    <Card className="border-accent/40 bg-accent/5">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-foreground">✈️ {activeTrip.name}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent font-medium">
                Active
              </span>
            </div>
            {activeTrip.destination && (
              <p className="text-xs text-muted mt-0.5">{activeTrip.destination}</p>
            )}
            <p className="text-xs text-muted mt-0.5">
              Day {daysElapsed} · started {activeTrip.start_date}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xl font-bold text-foreground">
              S${summary?.total_sgd.toFixed(2) ?? '—'}
            </p>
            <p className="text-xs text-muted">
              {summary?.transaction_count ?? 0} transactions · S$
              {summary?.daily_average_sgd.toFixed(2) ?? '—'}/day
            </p>
            {showEndButton ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  if (confirm('End this trip?')) deactivateMutation.mutate();
                }}
                disabled={deactivateMutation.isPending}
              >
                {deactivateMutation.isPending ? 'Ending…' : 'End Trip'}
              </Button>
            ) : (
              <Link
                to="/trips"
                className="mt-2 block text-xs text-muted hover:text-foreground transition-colors"
              >
                View trips →
              </Link>
            )}
          </div>
        </div>

        {summary && summary.by_category.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            {summary.by_category.map((c) => (
              <span key={c.category} className="text-xs text-muted">
                {c.category}:{' '}
                <span className="text-foreground">S${c.amount_sgd.toFixed(0)}</span>
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
