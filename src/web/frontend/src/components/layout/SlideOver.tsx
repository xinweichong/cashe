import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from 'framer-motion';
import { useIsPhone } from '@/hooks/useIsPhone';
import { slideInRightVariants } from '@/lib/motionPresets';
import { tapFeedback } from '@/lib/haptics';
import { cn } from '@/lib/utils';

// Approved shared owner (phone redesign, 2026-09-26): the route-held detail
// panel (a transaction, budget, goal, subscription or trip). A side panel
// on desktop; on a phone it covers the tab like a DrillSheet and drags
// right to close, so every drill-in on the phone slides back the same way.
// One element for both layouts, so an in-progress edit survives crossing
// the breakpoint.

const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 500;

export function SlideOver({ show, onClose, className, children }: {
  show: boolean;
  onClose: () => void;
  /** Width and layering above the phone breakpoint, e.g. "md:w-96". */
  className?: string;
  children: ReactNode;
}) {
  const isPhone = useIsPhone();
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (show && isPhone) tapFeedback();
  }, [show, isPhone]);
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > DISMISS_DISTANCE || info.velocity.x > DISMISS_VELOCITY) onClose();
  };
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className={cn('fixed inset-y-0 right-0 z-50 w-full overflow-hidden border-l border-border bg-card shadow-elev-md', className)}
          variants={slideInRightVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          drag={isPhone && !reduceMotion ? 'x' : false}
          dragDirectionLock
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={{ left: 0, right: 0.9 }}
          onDragEnd={onDragEnd}
        >
          {isPhone && <span aria-hidden className="pointer-events-none absolute left-1.5 top-1/2 z-10 h-10 w-1 -translate-y-1/2 rounded-full bg-muted/50" />}
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
