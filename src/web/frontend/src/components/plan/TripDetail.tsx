import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
import { TransactionRow } from '@/components/transactions/TransactionRow';
import { useTrips } from './planHooks';

const TX_PAGE_SIZE = 20;

export function TripDetail({ tripId, onClose }: { tripId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: trips = [] } = useTrips();
  const trip = trips.find((t) => t.id === tripId);
  const [txPage, setTxPage] = useState(1);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [delistingId, setDelistingId] = useState<number | null>(null);

  const { data: summary } = useQuery({
    queryKey: ['trip-summary', tripId],
    queryFn: () => api.getTripSummaryV2(tripId),
    staleTime: 60_000,
  });
  const { data: txs = [] } = useQuery({
    queryKey: ['trip-transactions', tripId],
    queryFn: () => api.getTripTransactions(tripId, 1000),
    staleTime: 30_000,
  });

  const activateMutation = useMutation({
    mutationFn: () => api.activateTrip(tripId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['trips'] }); qc.invalidateQueries({ queryKey: ['trips-active'] }); },
  });
  const deactivateMutation = useMutation({
    mutationFn: () => api.deactivateTrip(tripId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['trips'] }); qc.invalidateQueries({ queryKey: ['trips-active'] }); },
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.deleteTrip(tripId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['trips'] }); onClose(); },
  });
  const delistMutation = useMutation({
    mutationFn: (txId: number) => api.delistTransaction(tripId, txId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip-transactions', tripId] });
      qc.invalidateQueries({ queryKey: ['trip-summary', tripId] });
      qc.invalidateQueries({ queryKey: ['trip-membership', tripId] });
    },
  });

  if (!trip) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-start justify-between p-4 border-b border-border">
          <h2 className="text-lg font-bold font-display tracking-tight text-foreground">Trip</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4"><p className="text-sm text-muted">Catching up…</p></div>
      </div>
    );
  }

  const isActive = trip.status === 'active';
  const isPendingToggle = activateMutation.isPending || deactivateMutation.isPending;
  const totalTxPages = Math.ceil(txs.length / TX_PAGE_SIZE);
  const pageTxs = txs.slice((txPage - 1) * TX_PAGE_SIZE, txPage * TX_PAGE_SIZE);
  const dateLabel = trip.end_date ? `${trip.start_date} → ${trip.end_date}` : trip.start_date;

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-start justify-between p-4 border-b border-border">
        <div>
          <h2 className="text-lg font-bold font-display tracking-tight text-foreground">{trip.name}</h2>
          <p className="text-xs text-muted mt-0.5">{trip.destination ? `${trip.destination} · ` : ''}{dateLabel}</p>
        </div>
        <Button variant="ghost" size="icon" className="shrink-0" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></Button>
      </div>

      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground">Auto-assign new transactions</span>
          {isActive && <Badge tone="active">Active</Badge>}
        </div>
        <Switch
          checked={isActive}
          onCheckedChange={() => (isActive ? deactivateMutation.mutate() : activateMutation.mutate())}
          pending={isPendingToggle}
          aria-label={`Auto-assign new transactions to ${trip.name}`}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {summary && (
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Total', value: formatCurrency(summary.total.minor_units / 100) },
              { label: 'Transactions', value: String(summary.transaction_count) },
              { label: 'Per day', value: formatCurrency(summary.daily_average.minor_units / 100) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-background rounded-lg p-3 border border-border">
                <p className="text-[10px] font-mono uppercase tracking-[0.06em] text-muted">{label}</p>
                <p className="text-sm font-display font-bold text-foreground mt-0.5">{value}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold font-mono uppercase tracking-[0.22em] text-muted">Transactions</p>
          {totalTxPages > 1 && (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" aria-label="Previous page" onClick={() => setTxPage((p) => Math.max(1, p - 1))} disabled={txPage === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted">{txPage}/{totalTxPages}</span>
              <Button variant="ghost" size="icon" aria-label="Next page" onClick={() => setTxPage((p) => Math.min(totalTxPages, p + 1))} disabled={txPage === totalTxPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {txs.length === 0 ? (
          <p className="text-xs text-muted">Nothing captured this period.</p>
        ) : (
          <div className="border-t border-border">
            {pageTxs.map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                readOnly
                onRemove={() => { setDelistingId(tx.id); delistMutation.mutate(tx.id, { onSettled: () => setDelistingId(null) }); }}
                removeDisabled={delistingId === tx.id}
              />
            ))}
          </div>
        )}

        {confirmDelete ? (
          <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 space-y-2">
            <p className="text-sm text-foreground">Delete trip "{trip.name}"? Its transactions stay in Activity; only the trip grouping is removed.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button type="button" variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? 'Deleting…' : 'Delete trip'}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="min-h-11 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="w-3.5 h-3.5" />Delete trip
          </Button>
        )}
      </div>
    </div>
  );
}
