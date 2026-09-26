import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { type Transaction, type DailyTotalV2 } from '@/api/client';
import { TransactionRow } from './TransactionRow';
import { Skeleton } from '@/components/ui/skeleton';
import { EASE_OUT_EXPO } from '@/lib/motionPresets';
import { formatCurrency, formatDayHeading, localDayKey } from '@/lib/utils';

const STAGGER_LIMIT = 10;

interface TransactionListProps {
  transactions: Transaction[];
  onLoadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
  onTransactionClick: (tx: Transaction) => void;
  selectedTransactionId?: number;
  /**
   * Per-day totals keyed by localDayKey, fetched independently of the
   * paginated row list (R09) — a day's total is always computed from every
   * transaction on that day, never from however many of that day's rows
   * have loaded so far, so it can't show a duplicate or partial figure
   * when a day happens to straddle a page boundary. A day with no entry
   * yet (still loading, or totals intentionally withheld while a search/
   * category filter is active) shows a neutral placeholder rather than 0.
   */
  dailyTotals?: Map<string, DailyTotalV2>;
  /** R09: bulk-selection mode — when set, rows render a checkbox and
   * clicking a row toggles selection instead of opening its detail. */
  selectionMode?: boolean;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
  /** Pin each day header while its rows scroll (desktop). The phone list
   * sits in a short card, where a pinned header only hides rows. */
  stickyDayHeaders?: boolean;
  /** Phone rows: time only, source only when manual (see TransactionRow). */
  compactRows?: boolean;
}

function TransactionRowSkeleton() {
  return (
    <div
      data-testid="tx-skeleton"
      className="flex items-center gap-3 px-4 py-3 border-b border-border/50"
    >
      <Skeleton className="h-8 w-8 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-4 w-16" />
    </div>
  );
}

function DayHeader({ dayKey, total, sticky }: { dayKey: string; total: DailyTotalV2 | undefined; sticky: boolean }) {
  return (
    <div
      data-testid="tx-day-header"
      className={`flex items-baseline justify-between px-4 py-1.5 bg-muted/30 border-b border-border/30${sticky ? ' sticky top-0 z-10' : ''}`}
    >
      <span className="text-2xs font-mono uppercase tracking-[0.08em] text-muted font-semibold">
        {formatDayHeading(dayKey)}
      </span>
      <span className="text-2xs font-mono text-muted" data-testid="tx-day-total">
        {total
          ? `${formatCurrency(total.spending.minor_units / 100, total.spending.currency)}${total.status !== 'complete' ? ' *' : ''}`
          : '···'}
      </span>
    </div>
  );
}

type Row = { kind: 'header'; day: string } | { kind: 'tx'; tx: Transaction; index: number };

function groupByDay(transactions: Transaction[]): Row[] {
  const rows: Row[] = [];
  let lastDay: string | null = null;
  transactions.forEach((tx, index) => {
    const day = localDayKey(tx.transaction_date);
    if (day !== lastDay) {
      rows.push({ kind: 'header', day });
      lastDay = day;
    }
    rows.push({ kind: 'tx', tx, index });
  });
  return rows;
}

// Memoised so changing the selection re-renders only the rows whose
// `selected` flips, not every loaded row.
const ListRow = memo(function ListRow({ tx, index, selected, selectable, compact, onActivate }: {
  tx: Transaction; index: number; selected: boolean; selectable: boolean; compact: boolean;
  onActivate: (tx: Transaction) => void;
}) {
  return (
    <motion.div
      data-tx-row-id={tx.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{
        duration: 0.2,
        ease: EASE_OUT_EXPO,
        delay: index < STAGGER_LIMIT ? index * 0.025 : 0,
      }}
    >
      <TransactionRow tx={tx} onClick={() => onActivate(tx)} selected={selected} selectable={selectable} compact={compact} />
    </motion.div>
  );
});

export function TransactionList({
  transactions,
  onLoadMore,
  hasMore,
  isLoading,
  onTransactionClick,
  selectedTransactionId,
  dailyTotals,
  selectionMode = false,
  selectedIds,
  onToggleSelect,
  stickyDayHeaders = true,
  compactRows = false,
}: TransactionListProps) {
  const observerRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => groupByDay(transactions), [transactions]);
  // A stable click handler that always sees the latest props, so memoised
  // rows don't re-render just because the parent passed new callbacks.
  const latest = useRef({ selectionMode, onToggleSelect, onTransactionClick });
  useLayoutEffect(() => {
    latest.current = { selectionMode, onToggleSelect, onTransactionClick };
  });
  const activate = useCallback((tx: Transaction) => {
    const { selectionMode, onToggleSelect, onTransactionClick } = latest.current;
    if (selectionMode) onToggleSelect?.(tx.id); else onTransactionClick(tx);
  }, []);

  useEffect(() => {
    if (!hasMore || isLoading) return;
    const el = observerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) onLoadMore(); },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, isLoading, onLoadMore]);

  if (transactions.length === 0 && isLoading) {
    return (
      <div>
        {Array.from({ length: 8 }).map((_, i) => (
          <TransactionRowSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (transactions.length === 0 && !isLoading) {
    return (
      <div className="py-12 text-center text-muted text-sm">
        Nothing captured this period.
      </div>
    );
  }

  return (
    <div>
      <AnimatePresence>
        {rows.map((row) =>
          row.kind === 'header' ? (
            <DayHeader key={`day-${row.day}`} dayKey={row.day} total={dailyTotals?.get(row.day)} sticky={stickyDayHeaders} />
          ) : (
            <ListRow
              key={row.tx.id}
              tx={row.tx}
              index={row.index}
              selected={selectionMode ? !!selectedIds?.has(row.tx.id) : row.tx.id === selectedTransactionId}
              selectable={selectionMode}
              compact={compactRows}
              onActivate={activate}
            />
          )
        )}
      </AnimatePresence>
      {hasMore && (
        <div ref={observerRef} className="py-4 text-center text-muted text-xs">
          {isLoading ? 'Catching up…' : 'Load more'}
        </div>
      )}
    </div>
  );
}
