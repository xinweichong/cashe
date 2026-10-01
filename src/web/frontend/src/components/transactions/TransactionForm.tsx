import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { SegmentedChoice } from '@/components/ui/segmented-choice';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateTransaction } from '@/hooks/useTransactions';
import { useToast } from '@/hooks/useToastContext';
import { api, type Category } from '@/api/client';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useSettings } from '@/hooks/useSettings';
import { useTrips } from '@/components/plan/planHooks';

const TX_TYPES = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'cash', label: 'Cash' },
] as const;

type TxType = typeof TX_TYPES[number]['value'];

const CURRENCIES = ['SGD', 'USD', 'THB', 'MYR', 'JPY', 'EUR', 'GBP'] as const;

interface TransactionFormProps {
  categories: Category[];
  onClose: () => void;
  /** Set when a sheet's header Save submits the form; hides the form's own button. */
  formId?: string;
  onPendingChange?: (pending: boolean) => void;
}

export function TransactionForm({ categories, onClose, formId, onPendingChange }: TransactionFormProps) {
  const [type, setType] = useState<TxType>('expense');
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('SGD');
  const [rate, setRate] = useState('');
  const fieldId = useId();
  const [tripId, setTripId] = useState('');
  const [tripTouched, setTripTouched] = useState(false);
  // Currency/date/category/notes/trip are secondary — amount and merchant
  // are the only fields needed to capture something fast; everything else
  // stays collapsed until the user asks for it (R09).
  const [showMore, setShowMore] = useState(false);
  const moreId = useId();
  const [datetime, setDatetime] = useState(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  });

  const { data: settings } = useSettings();
  const tripsEnabled = settings?.trips_enabled === true;
  const { data: trips = [] } = useTrips({ enabled: tripsEnabled });
  const { data: activeTrip } = useQuery({
    queryKey: ['active-trip'], queryFn: () => api.getActiveTrip().catch(() => null),
    enabled: tripsEnabled, staleTime: 30_000,
  });
  // Pre-select the active trip once it loads, but only if the user hasn't
  // already made an explicit choice (including "no trip").
  useEffect(() => {
    if (activeTrip && !tripTouched) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTripId(String(activeTrip.id));
    }
  }, [activeTrip, tripTouched]);

  const [requestKey] = useState(() => crypto.randomUUID());
  const createTx = useCreateTransaction();
  useEffect(() => { onPendingChange?.(createTx.isPending); }, [createTx.isPending, onPendingChange]);
  const toast = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0 || createTx.isPending) return;
    createTx.mutate(
      {
        requestKey,
        data: {
          type: type === 'cash' ? 'expense' : type,
          amount: parsed,
          merchant: merchant || undefined,
          category: category || undefined,
          description: description || undefined,
          currency,
          exchange_rate: currency !== 'SGD' && Number(rate) > 0 ? Number(rate) : undefined,
          source: type === 'cash' ? 'cash' : 'manual',
          transaction_date: datetime ? datetime + ':00' : undefined,
        },
      },
      {
        onSuccess: async (result) => {
          if (tripId) {
            // Best-effort — a failed enlist shouldn't block or roll back an
            // already-captured transaction; the user can still add it to
            // the trip later from the transaction detail panel.
            await api.enlistTransaction(Number(tripId), result.id).catch(() => {});
          }
          toast('Captured.');
          onClose();
        },
      }
    );
  };

  return (
    // Lives in the Add sheet, whose header carries Cancel: no card of its own.
    <form id={formId} onSubmit={handleSubmit} className="space-y-3 p-1">
        <SegmentedChoice<TxType> name="transaction-type" aria-label="Transaction type" value={type} onValueChange={setType} options={TX_TYPES} />

        {/* Primary fields — amount and merchant are all it takes to capture something */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${fieldId}-amount`} className="text-xs text-muted">Amount</label>
            <Input
              id={`${fieldId}-amount`}
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.]?[0-9]*"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="text-lg font-semibold"
              required
              autoFocus
            />
          </div>
          <div>
            <label htmlFor={`${fieldId}-merchant`} className="text-xs text-muted">Merchant</label>
            <Input
              id={`${fieldId}-merchant`}
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder="e.g. Coffee Shop"
            />
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 px-2 text-xs text-muted"
          aria-expanded={showMore}
          aria-controls={moreId}
          onClick={() => setShowMore((v) => !v)}
        >
          {showMore ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {showMore ? 'Fewer details' : 'Currency, date, category, notes…'}
        </Button>

        {showMore && (
          <div id={moreId} className="space-y-3">
            <div>
              <label htmlFor={`${fieldId}-currency`} className="text-xs text-muted">Currency</label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id={`${fieldId}-currency`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {currency !== 'SGD' && (
              <div>
                <label htmlFor={`${fieldId}-rate`} className="text-xs text-muted">SGD per 1 {currency} (optional)</label>
                <Input id={`${fieldId}-rate`} type="text" inputMode="decimal" pattern="[0-9]*[.]?[0-9]*" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 0.0089" />
                <p className="mt-1 text-xs text-muted">Leave it blank if you don’t know it. The purchase is saved, and waits in Review until a rate is added.</p>
              </div>
            )}

            <div>
              <label htmlFor={`${fieldId}-category`} className="text-xs text-muted">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id={`${fieldId}-category`}>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.name} value={cat.name}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label htmlFor={`${fieldId}-date`} className="text-xs text-muted">Date and time</label>
              <Input
                id={`${fieldId}-date`}
                type="datetime-local"
                value={datetime}
                onChange={(e) => setDatetime(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor={`${fieldId}-notes`} className="text-xs text-muted">Notes (optional)</label>
              <Input
                id={`${fieldId}-notes`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Notes..."
              />
            </div>

            {tripsEnabled && trips.length > 0 && (
              <div>
                <label htmlFor={`${fieldId}-trip`} className="text-xs text-muted">Trip</label>
                <Select
                  value={tripId || 'none'}
                  onValueChange={(v) => {
                    // Radix's hidden native-select bubble (used for native
                    // form/autofill compatibility) can self-trigger a
                    // spurious onValueChange('') when the controlled value
                    // updates programmatically (the pre-select effect
                    // above) rather than from a real user pick — '' is
                    // never a legitimate value here (options are 'none' or
                    // a trip id), so ignore it rather than let it silently
                    // clear the selection.
                    if (!v) return;
                    setTripId(v === 'none' ? '' : v);
                    setTripTouched(true);
                  }}
                >
                  <SelectTrigger id={`${fieldId}-trip`}>
                    <SelectValue placeholder="No trip" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No trip</SelectItem>
                    {trips.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        {createTx.isError && (
          <p role="alert" className="text-sm text-destructive">
            {createTx.error.message.includes('409')
              ? 'This entry was already submitted. Check Activity before starting another entry.'
              : 'Save was not confirmed. Retry with the same fields, or check Activity before starting another entry.'}
          </p>
        )}

        {/* In the Add sheet the header's Save submits this form (formId). */}
        {!formId && (
          <Button type="submit" className="min-h-11 w-full" disabled={!amount || createTx.isPending}>
            {createTx.isPending ? 'Saving…' : 'Save'}
          </Button>
        )}
      </form>
  );
}
