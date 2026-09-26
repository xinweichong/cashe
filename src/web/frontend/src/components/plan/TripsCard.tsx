import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Trip } from '@/api/client';
import { PageCard } from '@/components/ui/cards';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SelectableRow } from '@/components/ui/selectable-row';
import { ActiveTripCard } from '@/components/trips/ActiveTripCard';
import { useTrips } from './planHooks';

function TripSummaryRow({ trip, onSelect }: { trip: Trip; onSelect: () => void }) {
  const dateLabel = trip.end_date ? `${trip.start_date} → ${trip.end_date}` : trip.start_date;
  return (
    <SelectableRow onClick={onSelect} className="rounded-none border-b border-border last:border-b-0 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground truncate">{trip.name}</span>
          {trip.status === 'active' && <Badge tone="active" className="shrink-0">Auto-assigning</Badge>}
        </div>
        <p className="text-xs text-muted truncate">{trip.destination ? `${trip.destination} · ` : ''}{dateLabel}</p>
      </div>
    </SelectableRow>
  );
}

function CreateTripForm({ onAdd }: { onAdd: () => void }) {
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newStartDate, setNewStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [newEndDate, setNewEndDate] = useState('');
  const [newDest, setNewDest] = useState('');

  const createMutation = useMutation({
    mutationFn: async () => {
      const trip = await api.createTrip({ name: newName, start_date: newStartDate, destination: newDest || undefined });
      if (newEndDate) await api.updateTrip(trip.id, { end_date: newEndDate }).catch(() => {});
      return trip;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      setNewName(''); setNewDest(''); setNewEndDate('');
      onAdd();
    },
  });

  return (
    <div className="space-y-3 pt-4 border-t border-border">
      <p className="text-sm font-medium text-foreground">New Trip</p>
      <div className="flex flex-wrap gap-2">
        <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Trip name" className="input-field flex-1 min-w-40" />
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted font-mono">Start date</span>
          <input type="date" value={newStartDate} onChange={(e) => setNewStartDate(e.target.value)} className="input-field" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <input type="text" value={newDest} onChange={(e) => setNewDest(e.target.value)} placeholder="Destination (optional)" className="input-field flex-1 min-w-32" />
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted font-mono">End date (optional)</span>
          <input type="date" value={newEndDate} onChange={(e) => setNewEndDate(e.target.value)} className="input-field" />
        </label>
      </div>
      <Button type="button" onClick={() => createMutation.mutate()} disabled={!newName || !newStartDate || createMutation.isPending}>
        {createMutation.isPending ? 'Creating…' : 'Create Trip'}
      </Button>
    </div>
  );
}

export function TripsCard({ onSelect }: { onSelect: (id: number) => void }) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const { data: trips = [], isLoading } = useTrips();

  return (
    <>
      <ActiveTripCard showEndButton />
      <PageCard
        title="Trips"
        action={<Button variant="ghost" size="sm" onClick={() => setShowCreateForm((v) => !v)}>{showCreateForm ? 'Cancel' : '+ New Trip'}</Button>}
      >
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : trips.length === 0 ? (
          <p className="text-muted text-sm text-center py-8">No trips yet. Create one to start grouping transactions.</p>
        ) : (
          trips.map((trip) => <TripSummaryRow key={trip.id} trip={trip} onSelect={() => onSelect(trip.id)} />)
        )}
        {showCreateForm && <CreateTripForm onAdd={() => setShowCreateForm(false)} />}
      </PageCard>
    </>
  );
}
