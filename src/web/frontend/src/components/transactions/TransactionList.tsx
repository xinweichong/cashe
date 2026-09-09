import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { type Transaction } from '@/api/client';
import { TransactionRow } from './TransactionRow';
import { Skeleton } from '@/components/ui/skeleton';
import { springs } from '@/lib/motionPresets';

const STAGGER_LIMIT = 10;

interface TransactionListProps {
  transactions: Transaction[];
  onLoadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
  onTransactionClick: (tx: Transaction) => void;
  selectedTransactionId?: number;
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

export function TransactionList({
  transactions,
  onLoadMore,
  hasMore,
  isLoading,
  onTransactionClick,
  selectedTransactionId,
}: TransactionListProps) {
  const observerRef = useRef<HTMLDivElement>(null);

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
        {transactions.map((tx, index) => (
          <motion.div
            key={tx.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{
              ...springs.gentle,
              delay: index < STAGGER_LIMIT ? index * 0.04 : 0,
            }}
          >
            <TransactionRow
              tx={tx}
              onClick={() => onTransactionClick(tx)}
              selected={tx.id === selectedTransactionId}
            />
          </motion.div>
        ))}
      </AnimatePresence>
      {hasMore && (
        <div ref={observerRef} className="py-4 text-center text-muted text-xs">
          {isLoading ? 'Catching up…' : 'Load more'}
        </div>
      )}
    </div>
  );
}
