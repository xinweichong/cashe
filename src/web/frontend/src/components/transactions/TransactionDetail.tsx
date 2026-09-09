import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { type Transaction, type Trip, api } from '@/api/client';
import { formatCurrency, formatDateTime, getCategoryColor } from '@/lib/utils';
import { useUpdateTransaction, useDeleteTransaction } from '@/hooks/useTransactions';
import { useCategories } from '@/hooks/useCategories';
import { useIconMap } from '@/hooks/useIconMap';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { X, Pencil, Trash2, Check, ExternalLink } from 'lucide-react';
import { SOURCE_DISPLAY_LABELS } from '@/lib/sourceLabels';

export function TransactionDetail({
  transaction: tx,
  onClose,
}: {
  transaction: Transaction;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [merchant, setMerchant] = useState(tx.merchant ?? '');
  const [rememberCategory, setRememberCategory] = useState(false);
  const [category, setCategory] = useState(tx.category ?? '');
  const [description, setDescription] = useState(tx.description ?? '');
  const [date, setDate] = useState(tx.transaction_date ?? '');
  const [type, setType] = useState(tx.type ?? 'expense');
  const [amount, setAmount] = useState(String(tx.amount));
  const [currency, setCurrency] = useState(tx.currency ?? '');
  const [exchangeRate, setExchangeRate] = useState(tx.exchange_rate == null ? '' : String(tx.exchange_rate));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isAppleWallet = tx.source === 'apple_wallet';
  const categoryColor = getCategoryColor(tx.category ?? '');

  const resetFields = useCallback(() => {
    setMerchant(tx.merchant ?? '');
    setCategory(tx.category ?? '');
    setRememberCategory(false);
    setDescription(tx.description ?? '');
    setDate(tx.transaction_date ?? '');
    setType(tx.type ?? 'expense');
    setAmount(String(tx.amount));
    setCurrency(tx.currency ?? '');
    setExchangeRate(tx.exchange_rate == null ? '' : String(tx.exchange_rate));
  }, [tx.merchant, tx.category, tx.description, tx.exchange_rate, tx.transaction_date, tx.type, tx.amount, tx.currency]);

  // Reset form + exit edit mode when switching to a different transaction
  useEffect(() => {
    resetFields();
    setEditing(false);
    setSaveError(null);
    setConfirmingDelete(false);
  }, [tx.id, resetFields]);

  const updateTx = useUpdateTransaction();
  const deleteTx = useDeleteTransaction();
  const { data: categories } = useCategories();

  const { data: appleWalletCards } = useQuery({
    queryKey: ['apple-wallet-cards'],
    queryFn: api.getAppleWalletCards,
    enabled: isAppleWallet && editing,
    staleTime: 5 * 60 * 1000,
  });

  const iconMap = useIconMap();
  const categoryIcon = tx.category ? (iconMap[tx.category] ?? tx.category[0] ?? '•') : '•';

  const handleEdit = () => {
    setSaveError(null);
    resetFields();
    setEditing(true);
  };

  const handleSave = () => {
    setSaveError(null);
    const data: Partial<Transaction> & { remember_category?: boolean } = { merchant, category, remember_category: rememberCategory };
    if (amount !== String(tx.amount)) {
      if (!amount.trim() || !Number.isFinite(Number(amount)) || Number(amount) < 0) { setSaveError('Enter a non-negative amount.'); return; }
      data.amount = Number(amount);
    }
    if (currency !== (tx.currency ?? '')) {
      if (!/^[A-Z]{3}$/.test(currency)) { setSaveError('Use a three-letter currency code.'); return; }
      data.currency = currency;
    }
    if (currency !== 'SGD' && (currency !== tx.currency || exchangeRate !== (tx.exchange_rate == null ? '' : String(tx.exchange_rate)))) {
      if (exchangeRate.trim() && (!Number.isFinite(Number(exchangeRate)) || Number(exchangeRate) <= 0)) { setSaveError('Enter a positive exchange rate, or leave it blank.'); return; }
      data.exchange_rate = exchangeRate.trim() ? Number(exchangeRate) : null;
    }
    if (date !== (tx.transaction_date ?? '')) {
      if (!date) { setSaveError('Choose a transaction date.'); return; }
      data.transaction_date = date;
    }
    if (type !== (tx.type ?? 'expense')) data.type = type;
    if (isAppleWallet) data.description = description;
    updateTx.mutate(
      { id: tx.id, data },
      {
        onSuccess: () => setEditing(false),
        onError: () => setSaveError('Couldn\'t save. Check the date and transaction fields, then try again.'),
      },
    );
  };

  const handleDelete = () => {
    setConfirmingDelete(true);
  };

  const handleDeleteConfirm = () => {
    deleteTx.mutate(tx.id, {
      onSuccess: onClose,
      onError: () => setConfirmingDelete(false),
    });
  };

  const sourceLabel = isAppleWallet && tx.description
    ? tx.description
    : (SOURCE_DISPLAY_LABELS[tx.source ?? ''] ?? tx.source ?? '');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-lg"
            style={{ backgroundColor: `${categoryColor}33` }}
          >
            {categoryIcon}
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold truncate">
              {tx.merchant || tx.description || 'Transaction'}
            </p>
            {tx.category && (
              <Badge variant="outline" className="text-xs mt-0.5 border-border">
                {tx.category}
              </Badge>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close transaction" className="h-11 w-11 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Action bar — always visible below header */}
      <div className="shrink-0 border-b border-border">
        {editing ? (
          <div className="flex flex-col gap-1 px-4 py-2">
            {saveError && (
              <p className="text-sm text-destructive">{saveError}</p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setEditing(false);
                  setSaveError(null);
                  resetFields();
                }}
                disabled={updateTx.isPending}
              >
                <X className="w-4 h-4 mr-1" />
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleSave}
                disabled={updateTx.isPending}
              >
                <Check className="w-4 h-4 mr-1" />
                {updateTx.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        ) : confirmingDelete ? (
          <div className="flex flex-col gap-1 px-4 py-2">
            <p className="text-sm text-destructive">Delete this? It's gone for good.</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleteTx.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={handleDeleteConfirm}
                disabled={deleteTx.isPending}
              >
                {deleteTx.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 px-4 py-2">
            <Button variant="ghost" size="icon" aria-label="Edit" className="h-11 w-11" onClick={handleEdit}>
              <Pencil className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete transaction"
              className="h-11 w-11 text-destructive"
              onClick={handleDelete}
              disabled={deleteTx.isPending}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Amount */}
        <div>
          <p className={`text-3xl font-bold ${tx.type === 'income' ? 'text-success' : ''}`}>
            {tx.type === 'income' ? '+' : '-'}{/^[A-Z]{3}$/.test(tx.currency ?? '') ? formatCurrency(tx.amount, tx.currency) : `${tx.amount} · Currency unknown`}
          </p>
          {tx.currency !== 'SGD' && tx.exchange_rate != null && Number.isFinite(tx.exchange_rate) && tx.exchange_rate > 0 && tx.exchange_rate !== 1 && Number.isFinite(tx.amount) && tx.amount >= 0 ? (
            <p className="text-sm text-muted mt-1">
              ≈ {formatCurrency(tx.amount * tx.exchange_rate)} SGD · Indicative conversion
            </p>
          ) : tx.currency !== 'SGD' && <p className="text-sm text-warning mt-1">SGD conversion unresolved</p>}
        </div>

        {/* View mode: all fields */}
        {!editing && (
          <div className="space-y-3">
            <DetailRow label="Date" value={formatDateTime(tx.transaction_date)} />
            <DetailRow label="Type" value={({ expense: 'Spending', income: 'Income', refund: 'Refund', transfer: 'Transfer' } as Record<string, string>)[tx.type ?? 'expense'] ?? 'Needs classification'} />
            <DetailRow label="Source" value={sourceLabel} />
            {tx.description && !isAppleWallet && (
              <DetailRow label="Description" value={tx.description} />
            )}
            {tx.currency !== 'SGD' && (
              <>
                <DetailRow label="Currency" value={tx.currency} />
                {tx.exchange_rate != null && (
                  <DetailRow
                    label="Exchange rate"
                    value={`1 ${tx.currency} = ${tx.exchange_rate} SGD`}
                  />
                )}
              </>
            )}
            {tx.merchant && (
              <div className="pt-1">
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs text-accent hover:text-accent hover:bg-transparent gap-1"
                  onClick={() => navigate(`/merchants/${encodeURIComponent(tx.merchant!)}`)}
                >
                  View merchant profile
                  <ExternalLink className="w-3 h-3" />
                </Button>
              </div>
            )}
            <TripMembershipRow txId={tx.id} />
            <TransactionSources txId={tx.id} />
            {/* Meta */}
            <div className="pt-2 border-t border-border space-y-2">
              <DetailRow label="Ingested" value={formatDateTime(tx.ingested_at)} muted />
            </div>
          </div>
        )}

        {/* Edit mode */}
        {editing && (
          <div className="space-y-4">
            <div>
              <label htmlFor={`amount-${tx.id}`} className="text-xs text-muted mb-1 block">Original amount</label>
              <Input id={`amount-${tx.id}`} type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <div>
              <label htmlFor={`currency-${tx.id}`} className="text-xs text-muted mb-1 block">Currency</label>
              <Input id={`currency-${tx.id}`} value={currency} maxLength={3} onChange={e => { setCurrency(e.target.value.toUpperCase()); setExchangeRate(''); }} />
              <p className="text-xs text-muted mt-1">Changing currency clears the conversion. Enter a replacement rate only when known.</p>
            </div>
            <div>
              <label htmlFor={`date-${tx.id}`} className="text-xs text-muted mb-1 block">Transaction date</label>
              <Input id={`date-${tx.id}`} value={date} placeholder="YYYY-MM-DD" onChange={e => setDate(e.target.value)} aria-describedby={`date-help-${tx.id}`} />
              <p id={`date-help-${tx.id}`} className="text-xs text-muted mt-1">Use YYYY-MM-DD or the full timestamp from the original record. Keep any existing time and timezone offset unless correcting them. Capture evidence stays unchanged.</p>
            </div>
            <div>
              <label htmlFor={`type-${tx.id}`} className="text-xs text-muted mb-1 block">Transaction type</label>
              <select id={`type-${tx.id}`} className="input-field min-h-11 w-full" value={type} onChange={e => setType(e.target.value)}>
                {!['expense', 'income'].includes(type) && <option value={type} disabled>{type === 'refund' ? 'Refund' : type === 'transfer' ? 'Transfer' : 'Choose a classification'}</option>}
                <option value="expense">Spending</option><option value="income">Income</option>
              </select>
              <p className="text-xs text-muted mt-1">Changes this record only. The category and future merchant rules are separate choices.</p>
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">Merchant</label>
              <Input
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                className="bg-background border-border text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="bg-background border-border text-sm">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  {categories?.map((cat) => (
                    <SelectItem key={cat.name} value={cat.name}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <fieldset className="space-y-1 text-sm">
              <legend className="text-xs text-muted">Apply category</legend>
              <label className="min-h-11 flex items-center gap-2">
                <input type="radio" name={`category-scope-${tx.id}`} checked={!rememberCategory} onChange={() => setRememberCategory(false)} />
                This transaction only
              </label>
              <label className="min-h-11 flex items-center gap-2">
                <input type="radio" name={`category-scope-${tx.id}`} checked={rememberCategory} onChange={() => setRememberCategory(true)} />
                Remember for future matching transactions
              </label>
              {rememberCategory && <p className="text-muted">Future purchases matching this merchant will use this category. Earlier transactions stay unchanged.</p>}
            </fieldset>
            {isAppleWallet && appleWalletCards && appleWalletCards.length > 0 && (
              <div>
                <label className="text-xs text-muted mb-1 block">Card</label>
                <Select value={description} onValueChange={setDescription}>
                  <SelectTrigger className="bg-background border-border text-sm">
                    <SelectValue placeholder="Card (Apple Wallet)" />
                  </SelectTrigger>
                  <SelectContent>
                    {appleWalletCards.map((card) => (
                      <SelectItem key={card} value={card}>{card}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {currency !== 'SGD' && (
              <div>
                <label htmlFor={`rate-${tx.id}`} className="text-xs text-muted mb-1 block">
                  Exchange rate (1 {currency} = ? SGD)
                </label>
                <Input
                  id={`rate-${tx.id}`}
                  type="number"
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(e.target.value)}
                  className="bg-background border-border text-sm"
                  step="any"
                  min="0"
                />
                <p className="text-xs text-muted mt-1">Leave blank if unknown. A legacy rate of 1 stays unresolved in spending reports. Other retained rates are indicative, not statement settlement amounts.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TransactionSources({ txId }: { txId: number }) {
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ['transaction-provenance', txId],
    queryFn: () => api.getTransactionProvenance(txId),
  });
  const labels = { apple_wallet: 'Apple Wallet', gmail: 'Gmail', manual: 'Manual entry', cash: 'Cash entry', other: 'Other source' };

  return (
    <section aria-label="Capture sources" className="pt-3 border-t border-border space-y-2 text-sm">
      <h3 className="font-medium">Capture sources</h3>
      {isPending ? <p role="status" className="text-muted">Loading capture sources…</p> : isError ? (
        <div>
          <p role="status" className="text-muted">Couldn’t load capture sources.</p>
          <Button variant="outline" className="min-h-11 mt-2" disabled={isFetching} onClick={() => void refetch()}>Retry sources</Button>
        </div>
      ) : data && (
        <>
          <ul className="space-y-2">
            {data.sources.map((source) => (
              <li key={source.channel}>
                <span>{labels[source.channel]}</span>
                <p className="text-xs text-muted">{source.evidence_recorded ? 'Capture evidence retained' : 'Recorded source only; no capture evidence retained'}</p>
              </li>
            ))}
          </ul>
          {data.sources.filter((source) => source.evidence_recorded).length > 1 && (
            <p className="text-muted">These sources are linked to one transaction and counted once.</p>
          )}
        </>
      )}
    </section>
  );
}

function DetailRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-xs text-muted shrink-0">{label}</span>
      <span className={`text-xs text-right break-all ${muted ? 'text-muted' : 'text-foreground'}`}>
        {value}
      </span>
    </div>
  );
}

function TripMembershipItem({ trip, txId }: { trip: Trip; txId: number }) {
  const qc = useQueryClient();

  const { data: membership } = useQuery({
    queryKey: ['trip-membership', trip.id, txId],
    queryFn: () => api.checkTripMembership(trip.id, txId),
    staleTime: 30_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['trip-membership', trip.id, txId] });
    qc.invalidateQueries({ queryKey: ['trip-transactions', trip.id] });
    qc.invalidateQueries({ queryKey: ['trip-summary', trip.id] });
  };

  const enlist = useMutation({
    mutationFn: () => api.enlistTransaction(trip.id, txId),
    onSuccess: invalidate,
  });

  const delist = useMutation({
    mutationFn: () => api.delistTransaction(trip.id, txId),
    onSuccess: invalidate,
  });

  const inTrip = membership?.in_trip ?? false;

  return (
    <div className="flex items-center justify-between gap-2">
      {inTrip ? (
        <>
          <span className="text-xs text-accent">✓ {trip.name}</span>
          <button
            onClick={() => delist.mutate()}
            disabled={delist.isPending}
            className="text-xs text-muted hover:text-destructive transition-colors"
          >
            {delist.isPending ? 'Removing…' : 'Remove'}
          </button>
        </>
      ) : (
        <>
          <span className="text-xs text-muted">{trip.name}</span>
          <button
            onClick={() => enlist.mutate()}
            disabled={enlist.isPending}
            className="text-xs text-accent hover:opacity-80 transition-opacity"
          >
            {enlist.isPending ? 'Adding…' : '+ Add'}
          </button>
        </>
      )}
    </div>
  );
}

function TripMembershipRow({ txId }: { txId: number }) {
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
    staleTime: 30_000,
  });

  const { data: trips = [] } = useQuery({
    queryKey: ['trips'],
    queryFn: () => api.getTrips(),
    enabled: settings?.trips_enabled === true,
    staleTime: 30_000,
  });

  if (!settings?.trips_enabled || trips.length === 0) return null;

  return (
    <div className="flex justify-between gap-4">
      <span className="text-xs text-muted shrink-0">Trips</span>
      <div className="flex flex-col gap-1 items-end flex-1 min-w-0">
        {trips.map((trip) => (
          <TripMembershipItem key={trip.id} trip={trip} txId={txId} />
        ))}
      </div>
    </div>
  );
}
