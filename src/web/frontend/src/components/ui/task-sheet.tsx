import { useEffect, useState, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { animate, motion, useDragControls, useMotionValue, useReducedMotion, type PanInfo } from 'framer-motion';
import { SheetOverlay, SheetPortal } from '@/components/ui/sheet';
import { ToolbarAction } from '@/components/ui/toolbar';
import { useIsPhone } from '@/hooks/useIsPhone';
import { sheetSpring } from '@/lib/motionPresets';
import { cn } from '@/lib/utils';

// Approved shared owner (P5, HIG alignment 2026-10-01): the sheet for tasks —
// Add, Filters, Edit, confirmations. On a phone it rises from the bottom
// with medium and large detents, a grabber, and Cancel / title / confirm in
// its header; dragging the header snaps between detents or dismisses. A
// dirty form never closes silently: every dismissal (drag, Escape, scrim,
// Cancel) asks to discard first. On md+ the same API renders a centred
// dialog. Details are pages in the navigation stack (P6), not sheets.

export type Detent = 'medium' | 'large';

interface TaskSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Explains the sheet to assistive tech when the title alone doesn't. */
  description?: ReactNode;
  detents?: readonly Detent[];
  initialDetent?: Detent;
  cancelLabel?: string;
  confirm?: { label: string; onClick: () => void; pending?: boolean; pendingLabel?: string; disabled?: boolean };
  /** Unsaved input: dismissing asks "Discard changes?" first. */
  dirty?: boolean;
  children: ReactNode;
}

const TOP_GAP = 12; // px of the page left visible above a large sheet
const MEDIUM_RATIO = 0.55;

export function TaskSheet({
  open, onOpenChange, title, description, detents = ['medium', 'large'], initialDetent,
  cancelLabel = 'Cancel', confirm, dirty = false, children,
}: TaskSheetProps) {
  const isPhone = useIsPhone();
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  // A sheet closed from outside (a save succeeding) reopens without the prompt.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setConfirmingDiscard(false);
  }

  const requestClose = () => {
    if (dirty) setConfirmingDiscard(true);
    else onOpenChange(false);
  };

  const header = (
    <div className="grid min-h-11 grid-cols-[1fr_auto_1fr] items-center gap-2">
      <div>
        <ToolbarAction onClick={requestClose}>{cancelLabel}</ToolbarAction>
      </div>
      <DialogPrimitive.Title className="truncate text-center text-headline font-semibold">{title}</DialogPrimitive.Title>
      <div className="flex justify-end">
        {confirm && (
          <ToolbarAction tone="strong" onClick={confirm.onClick} pending={confirm.pending}
            pendingLabel={confirm.pendingLabel} disabled={confirm.disabled}>
            {confirm.label}
          </ToolbarAction>
        )}
      </div>
    </div>
  );

  const discard = confirmingDiscard && (
    <div role="alert" className="mx-1 mb-2 flex items-center justify-between gap-3 rounded-[12px] bg-fill-press px-3 py-2 text-sm">
      <span>Discard changes?</span>
      <span className="flex gap-1">
        <ToolbarAction onClick={() => setConfirmingDiscard(false)}>Keep editing</ToolbarAction>
        <ToolbarAction tone="destructive" onClick={() => onOpenChange(false)}>Discard</ToolbarAction>
      </span>
    </div>
  );

  const body = (
    <>
      {description
        ? <DialogPrimitive.Description className="px-1 pb-2 text-sm text-muted">{description}</DialogPrimitive.Description>
        : <DialogPrimitive.Description className="sr-only">Use {cancelLabel} to close without saving.</DialogPrimitive.Description>}
      {discard}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-[calc(1rem+env(safe-area-inset-bottom))]">{children}</div>
    </>
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
      <SheetPortal>
        <SheetOverlay className="bg-scrim md:bg-scrim md:backdrop-blur-none" />
        {isPhone
          ? <PhoneSheet detents={detents} initialDetent={initialDetent ?? detents[0]} onDismiss={requestClose} header={header}>{body}</PhoneSheet>
          : (
            <DialogPrimitive.Content className="pop-motion fixed left-1/2 top-1/2 z-50 flex max-h-[85dvh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-hero bg-card-elev px-3 pt-2 text-foreground shadow-elev-md focus:outline-none">
              {header}
              {body}
            </DialogPrimitive.Content>
          )}
      </SheetPortal>
    </DialogPrimitive.Root>
  );
}

function PhoneSheet({ detents, initialDetent, onDismiss, header, children }: {
  detents: readonly Detent[];
  initialDetent: Detent;
  onDismiss: () => void;
  header: ReactNode;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const controls = useDragControls();
  const [viewport, setViewport] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  useEffect(() => {
    const onResize = () => setViewport(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The sheet is always large-height; detents are how far it sits below that.
  const height = viewport - TOP_GAP;
  const offsetFor = (d: Detent) => (d === 'large' ? 0 : Math.round(height * (1 - MEDIUM_RATIO)));
  const [detent, setDetent] = useState<Detent>(initialDetent);
  const y = useMotionValue(offsetFor(initialDetent));

  useEffect(() => {
    animate(y, offsetFor(detent), reduceMotion ? { duration: 0 } : sheetSpring);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detent, height]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    // Project where a flick is heading, then snap to the nearest resting place.
    const projected = y.get() + info.velocity.y * 0.2;
    const stops = [...detents.map((d) => ({ d, at: offsetFor(d) })), { d: 'dismiss' as const, at: height }];
    const nearest = stops.reduce((a, b) => (Math.abs(b.at - projected) < Math.abs(a.at - projected) ? b : a));
    if (nearest.d === 'dismiss') {
      onDismiss();
      animate(y, offsetFor(detent), reduceMotion ? { duration: 0 } : sheetSpring); // stays put if the close is refused
    } else if (nearest.d === detent) {
      animate(y, nearest.at, reduceMotion ? { duration: 0 } : sheetSpring);
    } else {
      setDetent(nearest.d);
    }
  };

  return (
    <DialogPrimitive.Content asChild>
      <motion.div
        data-detent={detent}
        className="sheet-motion-bottom fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-hero bg-card-elev px-3 text-foreground shadow-sheet focus:outline-none"
        style={{ height, y }}
        drag="y"
        dragListener={false}
        dragControls={controls}
        dragConstraints={{ top: 0, bottom: height }}
        dragElastic={{ top: 0.05, bottom: 0.4 }}
        onDragEnd={onDragEnd}
      >
        {/* Only the grabber and header start a drag, so the body scrolls freely. */}
        <div className="shrink-0 touch-none" onPointerDown={(e) => controls.start(e)}>
          <div aria-hidden className="mx-auto mb-1 mt-1.5 h-[5px] w-9 rounded-pill bg-foreground/25" />
          {header}
        </div>
        <div className={cn('flex min-h-0 flex-1 flex-col', detent === 'medium' && 'pb-[45dvh]')}>{children}</div>
      </motion.div>
    </DialogPrimitive.Content>
  );
}
