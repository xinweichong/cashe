import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { type Transaction, type Trip, api } from '@/api/client';
import { formatCurrency, formatDateTime, getCategoryColor, isCreditType } from '@/lib/utils';
import { useUpdateTransaction, useDeleteTransaction, useTransactions } from '@/hooks/useTransactions';
import { useCategories } from '@/hooks/useCategories';
import { useIconMap } from '@/hooks/useIconMap';
import { Button } from '@/components/ui/button';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CategoryAvatar } from '@/components/ui/CategoryAvatar';
import { SelectableRow } from '@/components/ui/selectable-row';
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
          <CategoryAvatar category={tx.category} isIncome={isCreditType(tx.type)} size="detail" glyph={categoryIcon} />
          <div className="min-w-0">
            <p className="text-base font-semibold truncate">
              {tx.merchant || tx.description || 'Transaction'}
            </p>
            {tx.category && (
              <Badge variant="outline" className="mt-0.5">
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
          <p className={`text-3xl font-bold ${isCreditType(tx.type) ? 'text-success' : ''}`}>
            {isCreditType(tx.type) ? '+' : '-'}{/^[A-Z]{3}$/.test(tx.currency ?? '') ? formatCurrency(tx.amount, tx.currency) : `${tx.amount} · Currency unknown`}
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
            <QuickCategoryPicker tx={tx} categories={categories ?? []} />
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
                  className="h-auto min-h-11 p-0 text-xs gap-1"
                  onClick={() => navigate(`/merchants/${encodeURIComponent(tx.merchant!)}`)}
                >
                  View merchant profile
                  <ExternalLink className="w-3 h-3" />
                </Button>
              </div>
            )}
            <TripMembershipRow txId={tx.id} />
            <RefundEvidenceSection tx={tx} />
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
              <select id={`type-${tx.id}`} className="select-field min-h-11 w-full" value={type} onChange={e => setType(e.target.value)}>
                {!['expense', 'income', 'refund', 'transfer'].includes(type) && <option value={type} disabled>Choose a classification</option>}
                <option value="expense">Spending</option>
                <option value="income">Income</option>
                <option value="refund">Refund</option>
                <option value="transfer">Transfer</option>
              </select>
              <p className="text-xs text-muted mt-1">
                Changes this record only. The category and future merchant rules are separate choices.
                {(type === 'refund' || type === 'transfer') && (
                  <> {type === 'refund'
                    ? 'Refund reduces spending in this record’s own period — it won’t change the original purchase.'
                    : 'Transfer excludes this from spending and income entirely — for moving money between your own accounts, like a card repayment.'}</>
                )}
              </p>
            </div>
            <div>
              <label htmlFor={`merchant-${tx.id}`} className="text-xs text-muted mb-1 block">Merchant</label>
              <Input
                id={`merchant-${tx.id}`}
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                className="text-sm"
              />
            </div>
            <div>
              <label htmlFor={`category-${tx.id}`} className="text-xs text-muted mb-1 block">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id={`category-${tx.id}`}>
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
                <label htmlFor={`card-${tx.id}`} className="text-xs text-muted mb-1 block">Card</label>
                <Select value={description} onValueChange={setDescription}>
                  <SelectTrigger id={`card-${tx.id}`}>
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
                  className="text-sm"
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

// R09: a direct category picker in view mode, so recategorizing an already-
// open transaction takes one tap (select a pill; it saves immediately) —
// the full Edit flow (with the "remember for future matching transactions"
// choice) stays available separately for that less common case. Applies
// to this transaction only, matching the pill's own tap-and-go semantics.
function QuickCategoryPicker({ tx, categories }: { tx: Transaction; categories: { name: string }[] }) {
  const updateTx = useUpdateTransaction();
  if (categories.length === 0) return null;
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="flex flex-wrap gap-1.5">
        {categories.map((cat) => {
          const catColor = getCategoryColor(cat.name);
          const isActive = tx.category === cat.name;
          return (
            <ChoiceChip
              key={cat.name}
              selected={isActive}
              categoryColor={catColor}
              disabled={updateTx.isPending}
              onClick={() => { if (!isActive) updateTx.mutate({ id: tx.id, data: { category: cat.name } }); }}
            >
              {cat.name}
            </ChoiceChip>
          );
        })}
      </div>
    </div>
  );
}

function RefundEvidenceSection({ tx }: { tx: Transaction }) {
  const qc = useQueryClient();
  const updateTx = useUpdateTransaction();
  const [linking, setLinking] = useState(false);
  const [query, setQuery] = useState('');

  const { data: v2 } = useQuery({
    queryKey: ['transaction-v2', tx.id],
    queryFn: () => api.getTransactionV2(tx.id),
  });

  const { data: candidates = [] } = useTransactions({ merchant_search: query, limit: 8 });
  const purchaseCandidates = candidates.filter(
    (c) => c.id !== tx.id && (c.type === 'expense' || !c.type)
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['transaction-v2', tx.id] });
    if (v2?.refund_of) qc.invalidateQueries({ queryKey: ['transaction-v2', v2.refund_of.transaction_id] });
  };

  const link = (purchaseId: number) => {
    updateTx.mutate(
      { id: tx.id, data: { refund_of_transaction_id: purchaseId } },
      { onSuccess: () => { invalidate(); setLinking(false); setQuery(''); } },
    );
  };

  const unlink = () => {
    updateTx.mutate(
      { id: tx.id, data: { refund_of_transaction_id: null } },
      { onSuccess: invalidate },
    );
  };

  if (tx.type === 'refund') {
    return (
      <div className="space-y-2">
        <span className="text-xs text-muted block">Refunds</span>
        {v2?.refund_of ? (
          <div className="flex items-start justify-between gap-2 text-xs bg-background rounded-md border border-border p-2">
            <div className="min-w-0">
              <p className="text-foreground truncate">{v2.refund_of.merchant ?? 'Unknown merchant'} — {formatCurrency(v2.refund_of.amount, v2.refund_of.currency)}</p>
              <p className="text-muted">{formatDateTime(v2.refund_of.transaction_date ?? '')}</p>
              {v2.refund_of.warning && <p className="text-warning mt-1">{v2.refund_of.warning}</p>}
            </div>
            <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={unlink} disabled={updateTx.isPending}>Unlink</Button>
          </div>
        ) : linking ? (
          <div className="space-y-1.5">
            <Input
              autoFocus
              placeholder="Search purchases by merchant…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {purchaseCandidates.length === 0 ? (
                  <p className="text-xs text-muted py-1">No matching purchases.</p>
                ) : purchaseCandidates.map((c) => (
                  <SelectableRow
                    key={c.id}
                    onClick={() => link(c.id)}
                    disabled={updateTx.isPending}
                    className="flex-col items-start gap-0 border border-border text-xs"
                  >
                    <span className="text-foreground">{c.merchant ?? 'Unknown merchant'} — {formatCurrency(c.amount, c.currency)}</span>
                    <span className="text-muted">{formatDateTime(c.transaction_date)}</span>
                  </SelectableRow>
                ))}
              </div>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => { setLinking(false); setQuery(''); }}>Cancel</Button>
          </div>
        ) : (
          <Button type="button" variant="link" size="sm" className="h-auto min-h-11 p-0 text-xs" onClick={() => setLinking(true)}>
            + Link to purchase
          </Button>
        )}
      </div>
    );
  }

  if (v2?.refunded_by && v2.refunded_by.length > 0) {
    return (
      <div className="space-y-2">
        <span className="text-xs text-muted block">Refunded by</span>
        <div className="space-y-1">
          {v2.refunded_by.map((r) => (
            <div key={r.transaction_id} className="text-xs bg-background rounded-md border border-border p-2">
              <p className="text-foreground">{formatCurrency(r.amount, r.currency)}</p>
              <p className="text-muted">{formatDateTime(r.transaction_date ?? '')}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
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
          <span className="text-xs text-success">✓ {trip.name}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => delist.mutate()} disabled={delist.isPending}>
            {delist.isPending ? 'Removing…' : 'Remove'}
          </Button>
        </>
      ) : (
        <>
          <span className="text-xs text-muted">{trip.name}</span>
          <Button type="button" variant="link" size="sm" className="h-auto min-h-11 p-0 text-xs" onClick={() => enlist.mutate()} disabled={enlist.isPending}>
            {enlist.isPending ? 'Adding…' : '+ Add'}
          </Button>
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
