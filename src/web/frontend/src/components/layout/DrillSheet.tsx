import { useEffect, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { motion, useReducedMotion, type PanInfo } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import { SheetOverlay, SheetPortal } from '@/components/ui/sheet';
import { tapFeedback } from '@/lib/haptics';

// Approved shared owner (phone redesign, 2026-09-25): the phone's drill-in
// card. It slides in from the right over the tab, and dragging it right
// (or the back row, Escape, or the browser's own back) returns to the
// overview. The footer sits in the thumb band for the screen's one action.

interface DrillSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Where "back" returns to, e.g. "Home". */
  backLabel: string;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 500;

export function DrillSheet({ open, onOpenChange, title, backLabel, description, footer, children }: DrillSheetProps) {
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (open) tapFeedback();
  }, [open]);
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > DISMISS_DISTANCE || info.velocity.x > DISMISS_VELOCITY) onOpenChange(false);
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <SheetPortal>
        <SheetOverlay />
        <DialogPrimitive.Content asChild>
          <motion.div
            drag={reduceMotion ? false : 'x'}
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0, right: 0.9 }}
            onDragEnd={onDragEnd}
            className="sheet-motion-right fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-card-elev text-foreground shadow-elev-md focus:outline-none"
          >
            {/* Edge grip: the cue that the card drags right to go back. */}
            <span aria-hidden className="pointer-events-none absolute left-1.5 top-1/2 h-10 w-1 -translate-y-1/2 rounded-full bg-border" />
            <div className="shrink-0 pt-[env(safe-area-inset-top)] border-b border-border">
              <div className="flex items-center gap-1 px-2 h-12">
                <DialogPrimitive.Close className="inline-flex min-h-11 min-w-11 items-center gap-1 rounded-sm pl-1 pr-3 text-sm text-teal active:scale-[0.97] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <ChevronLeft size={20} aria-hidden />{backLabel}
                </DialogPrimitive.Close>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-4 pb-6">
              <DialogPrimitive.Title className="font-display text-xl font-bold tracking-tight">{title}</DialogPrimitive.Title>
              {description
                ? <DialogPrimitive.Description className="mt-1 text-sm text-muted">{description}</DialogPrimitive.Description>
                : <DialogPrimitive.Description className="sr-only">Drag right or use back to return to {backLabel}.</DialogPrimitive.Description>}
              <div className="mt-4">{children}</div>
            </div>
            {footer && <div className="shrink-0 border-t border-border px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">{footer}</div>}
          </motion.div>
        </DialogPrimitive.Content>
      </SheetPortal>
    </DialogPrimitive.Root>
  );
}
