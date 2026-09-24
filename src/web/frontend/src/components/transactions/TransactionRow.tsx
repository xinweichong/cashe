import { type Transaction } from '@/api/client';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { SOURCE_DISPLAY_LABELS } from '@/lib/sourceLabels';
import { Button } from '@/components/ui/button';
import { ActivityRowShell } from '@/components/ui/ActivityRowShell';
import { Trash2 } from 'lucide-react';

export function TransactionRow({
  tx,
  readOnly = false,
  onClick,
  selected = false,
  onRemove,
  removeDisabled = false,
  selectable = false,
}: {
  tx: Transaction;
  readOnly?: boolean;
  onClick?: () => void;
  selected?: boolean;
  onRemove?: () => void;
  removeDisabled?: boolean;
  /** R09: bulk-selection mode — replaces the category-icon avatar with a
   * checkbox reflecting `selected`, and clicking anywhere on the row toggles
   * selection (still via the same `onClick`, which the caller repurposes). */
  selectable?: boolean;
}) {
  const isIncome = tx.type === 'income';
  const sign = isIncome ? '+' : '-';
  const isClickable = !readOnly && !!onClick;

  return (
    <ActivityRowShell
      id={`tx-row-${tx.id}`}
      category={tx.category}
      isIncome={isIncome}
      selected={selected}
      onClick={isClickable ? onClick : undefined}
      avatarSlot={selectable ? (categoryColor) => (
        <input
          type="checkbox"
          tabIndex={-1}
          aria-label={`Select ${tx.merchant || tx.description || 'transaction'}`}
          checked={selected}
          readOnly
          className="w-5 h-5 shrink-0 justify-self-center accent-current"
          style={{ color: categoryColor }}
        />
      ) : undefined}
      title={tx.merchant || tx.description || 'Transaction'}
      metaPrimary={formatDateTime(tx.transaction_date)}
      amount={<>{sign}{formatCurrency(tx.amount, tx.currency)}</>}
      amountSub={tx.source ? (SOURCE_DISPLAY_LABELS[tx.source as keyof typeof SOURCE_DISPLAY_LABELS] ?? tx.source) : undefined}
      trailing={onRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-destructive"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          disabled={removeDisabled}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      )}
    />
  );
}
