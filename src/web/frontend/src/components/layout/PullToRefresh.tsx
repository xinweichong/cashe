import { useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

const DAMPING = 0.4;
const MAX_PULL = 96;
const TRIGGER = 40;

function hasScrolledAncestor(el: Element | null): boolean {
  while (el) {
    if (el.scrollTop > 0) return true;
    el = el.parentElement;
  }
  return false;
}

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onTouchStart = (e: React.TouchEvent) => {
    if (refreshing) return;
    if (window.scrollY > 0) return;
    if (hasScrolledAncestor(e.target as Element)) return;
    startY.current = e.touches[0].clientY;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    const dy = e.touches[0].clientY - startY.current;
    setPull(dy > 0 ? Math.min(dy * DAMPING, MAX_PULL) : 0);
  };

  const onTouchEnd = async () => {
    if (startY.current === null) return;
    const shouldRefresh = pull >= TRIGGER;
    startY.current = null;
    setPull(0);
    if (shouldRefresh) {
      setRefreshing(true);
      try {
        await qc.refetchQueries({ type: 'active' });
      } finally {
        setRefreshing(false);
      }
    }
  };

  return (
    <div
      data-testid="ptr-surface"
      className="md:contents"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <AnimatePresence>
        {(pull > 0 || refreshing) && (
          <m.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{
              opacity: refreshing ? 1 : Math.min(pull / TRIGGER, 1),
              scale: 1,
            }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="md:hidden fixed top-14 left-1/2 -translate-x-1/2 z-50 h-8 w-8 rounded-full bg-card border border-border flex items-center justify-center shadow-lg"
          >
            <RefreshCw
              className={`w-4 h-4 text-teal ${refreshing ? 'animate-spin' : ''}`}
              style={refreshing ? undefined : { transform: `rotate(${pull * 4}deg)` }}
            />
          </m.div>
        )}
      </AnimatePresence>
      {children}
    </div>
  );
}
