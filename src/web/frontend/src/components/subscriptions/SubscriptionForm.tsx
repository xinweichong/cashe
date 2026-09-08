import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { api, type Subscription } from '@/api/client';

type Mode = 'create' | 'edit';

interface SubscriptionFormProps {
  onClose: () => void;
  onSave: () => void;
  initial?: Subscription;
}

const FREQUENCIES: Subscription['frequency'][] = [
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'annual',
];

const FREQUENCY_LABELS: Record<Subscription['frequency'], string> = {
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
};

export function SubscriptionForm({ onClose, onSave, initial }: SubscriptionFormProps) {
  const mode: Mode = initial ? 'edit' : 'create';
  const qc = useQueryClient();

  const [merchant, setMerchant] = useState(initial?.merchant ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [frequency, setFrequency] = useState<Subscription['frequency']>(initial?.frequency ?? 'monthly');
  const [billingDay, setBillingDay] = useState<string>(
    initial?.billing_day != null ? String(initial.billing_day) : '',
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  // Today's start_date for the merchants query so the dropdown isn't empty.
  const today = new Date().toISOString().slice(0, 10);
  const startOfYear = `${new Date().getFullYear()}-01-01`;
  const { data: merchants = [] } = useQuery({
    queryKey: ['merchants', startOfYear, today],
    queryFn: () => api.getMerchants(startOfYear, today),
    staleTime: 60_000,
  });

  // If the existing merchant isn't in the list, still show it as an option.
  const merchantOptions = merchant && !merchants.includes(merchant)
    ? [merchant, ...merchants]
    : merchants;

  const billingDayNum = billingDay === '' ? undefined : Number(billingDay);
  const billingDayError =
    billingDayNum !== undefined && (billingDayNum < 1 || billingDayNum > 31)
      ? 'Billing day must be between 1 and 31'
      : null;

  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === 'create') {
        return api.createSubscription({
          merchant,
          frequency,
          billing_day: billingDayNum,
          label: label || undefined,
          notes: notes || undefined,
        });
      }
      return api.updateSubscription(initial!.id, {
        merchant,
        frequency,
        billing_day: billingDayNum ?? null,
        label: label || null,
        notes: notes || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
      qc.invalidateQueries({ queryKey: ['plan-upcoming'] });
      qc.invalidateQueries({ queryKey: ['home-briefing'] });
      onSave();
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : 'Failed to save');
    },
  });

  useEffect(() => {
    setError(null);
  }, [merchant, frequency, billingDay, label, notes]);

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="flex flex-col h-full p-0 w-full sm:max-w-md">
        <SheetHeader className="shrink-0 px-4 py-3 border-b border-border">
          <SheetTitle>{mode === 'create' ? 'New subscription' : 'Edit subscription'}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted font-mono">Merchant</span>
            <select
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              className="select-field"
            >
              <option value="">Select a merchant…</option>
              {merchantOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted font-mono">Label (optional)</span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Spotify Premium"
              className="input-field"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted font-mono">Frequency</span>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Subscription['frequency'])}
              className="select-field"
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted font-mono">
              Billing day (optional) — 1–31 for monthly/annual, 0–6 (Mon–Sun) for weekly
            </span>
            <input
              type="number"
              value={billingDay}
              onChange={(e) => setBillingDay(e.target.value)}
              placeholder="e.g. 15"
              className="input-field"
            />
            {billingDayError && <p className="text-sm text-destructive">{billingDayError}</p>}
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted font-mono">Notes (optional)</span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="input-field"
            />
          </label>
        </div>

        <div className="shrink-0 px-4 py-3 border-t border-border space-y-2">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={() => mutation.mutate()}
              disabled={!merchant || !!billingDayError || mutation.isPending}
              className="btn-action disabled:opacity-40"
            >
              {mutation.isPending ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
