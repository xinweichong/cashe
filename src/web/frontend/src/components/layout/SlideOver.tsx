import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useIsPhone } from '@/hooks/useIsPhone';
import { fadeVariants, pushInRightVariants, slideInRightVariants } from '@/lib/motionPresets';
import { tapFeedback } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import { useDragDismiss } from '@/hooks/useDragDismiss';
import { EdgeGrip } from './EdgeGrip';

// Approved shared owner (phone redesign, 2026-09-26): the route-held detail
// panel (a transaction, budget, goal, subscription or trip). A side panel
// on desktop; on a phone it covers the tab like a DrillSheet and drags
// right to close, so every drill-in on the phone slides back the same way.
// One element for both layouts, so an in-progress edit survives crossing
// the breakpoint.

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
  const dragDismiss = useDragDismiss(onClose, isPhone);
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className={cn('fixed inset-y-0 right-0 z-50 w-full overflow-hidden border-l border-border bg-card shadow-elev-md will-change-transform', className)}
          variants={reduceMotion ? fadeVariants : isPhone ? pushInRightVariants : slideInRightVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          {...dragDismiss}
        >
          {isPhone && <EdgeGrip />}
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
