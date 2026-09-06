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
import { SOURCE_DISPLAY_LABELS } from '@/components/icons/sources';

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
  const [exchangeRate, setExchangeRate] = useState(tx.exchange_rate ?? 1.0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isAppleWallet = tx.source === 'apple_wallet';
  const categoryColor = getCategoryColor(tx.category ?? '');

  const resetFields = useCallback(() => {
    setMerchant(tx.merchant ?? '');
    setCategory(tx.category ?? '');
    setRememberCategory(false);
    setDescription(tx.description ?? '');
    setExchangeRate(tx.exchange_rate ?? 1.0);
  }, [tx.merchant, tx.category, tx.description, tx.exchange_rate]);

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
    if (isAppleWallet) data.description = description;
    if (tx.currency !== 'SGD') data.exchange_rate = exchangeRate;
    updateTx.mutate(
      { id: tx.id, data },
      {
        onSuccess: () => setEditing(false),
        onError: () => setSaveError('Couldn\'t save — try again.'),
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
            {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount, tx.currency)}
          </p>
          {tx.currency !== 'SGD' && tx.exchange_rate != null && (
            <p className="text-sm text-muted mt-1">
              ≈ {formatCurrency(tx.amount * tx.exchange_rate)} SGD
            </p>
          )}
        </div>

        {/* View mode: all fields */}
        {!editing && (
          <div className="space-y-3">
            <DetailRow label="Date" value={formatDateTime(tx.transaction_date)} />
            <DetailRow label="Type" value={tx.type === 'income' ? 'Income' : 'Expense'} />
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
            {/* Meta */}
            <div className="pt-2 border-t border-border space-y-2">
              <DetailRow label="Source ID" value={tx.source_id} muted />
              <DetailRow label="Ingested" value={formatDateTime(tx.ingested_at)} muted />
            </div>
          </div>
        )}

        {/* Edit mode */}
        {editing && (
          <div className="space-y-4">
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
            {tx.currency !== 'SGD' && (
              <div>
                <label className="text-xs text-muted mb-1 block">
                  Exchange rate (1 {tx.currency} = ? SGD)
                </label>
                <Input
                  type="number"
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(parseFloat(e.target.value) || 1)}
                  className="bg-background border-border text-sm"
                  step="0.0001"
                  min="0"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
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
