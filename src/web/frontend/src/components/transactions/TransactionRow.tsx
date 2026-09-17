import { type Transaction } from '@/api/client';
import { cn, formatCurrency, formatDateTime, getCategoryColor } from '@/lib/utils';
import { SOURCE_DISPLAY_LABELS } from '@/lib/sourceLabels';
import { Button } from '@/components/ui/button';
import { CategoryAvatar } from '@/components/ui/CategoryAvatar';
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
  const categoryColor = getCategoryColor(tx.category ?? 'Other');
  const sign = isIncome ? '+' : '-';
  const isClickable = !readOnly && !!onClick;

  return (
    <div
      onClick={isClickable ? onClick : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
      } : undefined}
      className={cn(
        'grid gap-3 items-center px-3.5 py-2.5 border-b border-border/30 last:border-b-0',
        'transition-[background,transform] duration-[150ms]',
        onRemove ? 'grid-cols-[36px_1fr_auto_auto]' : 'grid-cols-[36px_1fr_auto]',
        isClickable && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
      style={{ background: `${categoryColor}${selected ? '1A' : '0D'}` }}
      onMouseEnter={isClickable ? (e) => {
        e.currentTarget.style.background = `${categoryColor}1A`;
        e.currentTarget.style.transform = 'translateY(-1px)';
      } : undefined}
      onMouseLeave={isClickable ? (e) => {
        e.currentTarget.style.background = `${categoryColor}${selected ? '1A' : '0D'}`;
        e.currentTarget.style.transform = '';
      } : undefined}
    >
      {selectable ? (
        <input
          type="checkbox"
          tabIndex={-1}
          aria-label={`Select ${tx.merchant || tx.description || 'transaction'}`}
          checked={selected}
          readOnly
          className="w-5 h-5 shrink-0 justify-self-center accent-current"
          style={{ color: categoryColor }}
        />
      ) : (
        <CategoryAvatar category={tx.category} isIncome={isIncome} />
      )}

      <div className="min-w-0">
        <div className="text-sm font-medium tracking-[-0.005em] truncate">
          {tx.merchant || tx.description || 'Transaction'}
        </div>
        <div className="font-mono text-[10px] text-muted uppercase tracking-[0.06em] mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span>{formatDateTime(tx.transaction_date)}</span>
          {tx.category && (
            <span
              className="px-1 py-0.5 rounded text-[9px] font-semibold font-mono uppercase tracking-[0.08em]"
              style={{ color: categoryColor, background: `${categoryColor}1F` }}
            >
              {tx.category}
            </span>
          )}
        </div>
      </div>

      <div className="text-right shrink-0">
        <div
          data-testid="tx-amount"
          className={cn('font-bold tracking-tight text-sm font-display', isIncome && 'text-teal')}
        >
          {sign}{formatCurrency(tx.amount, tx.currency)}
        </div>
        {tx.source && (
          <div className="text-[10px] text-muted font-mono mt-0.5 truncate max-w-[80px]">
            {SOURCE_DISPLAY_LABELS[tx.source as keyof typeof SOURCE_DISPLAY_LABELS] ?? tx.source}
          </div>
        )}
      </div>

      {onRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-destructive"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          disabled={removeDisabled}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}
