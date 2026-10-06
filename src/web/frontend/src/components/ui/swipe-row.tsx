import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { animate, m, useDragControls, useMotionValue, useReducedMotion, type PanInfo } from 'motion/react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { sheetSpring } from '@/lib/motionPresets';
import { cn } from '@/lib/utils';

// Approved shared owner (P8, HIG alignment 2026-10-01): swipe actions on a
// list row. Swipe left for trailing actions (Delete), right for leading ones
// (Category). A full swipe runs the outermost action; a destructive action
// with `confirm` first turns into its own confirmation. One row is open at
// a time and scrolling closes it. Touch only: with a fine pointer the row
// renders untouched and RowMenu (P9) carries the same actions, as does the
// detail page. Drags starting at the screen's left edge are left to the
// edge-swipe back gesture (P6).

export interface SwipeAction {
  label: string;
  tone: 'destructive' | 'warm' | 'neutral';
  onAction: () => void;
  /** Destructive only: the confirmation shown before onAction, e.g. "Delete S$4.50?". */
  confirm?: string;
}

interface SwipeRowProps {
  leadingActions?: readonly SwipeAction[];
  trailingActions?: readonly SwipeAction[];
  children: ReactNode;
}

const ACTION_WIDTH = 76;
const EDGE_GUARD = 24;
const FREE_TRAVEL = 4000;
const OPEN_EVENT = 'cashe:swipe-row-open';

const toneClass: Record<SwipeAction['tone'], string> = {
  destructive: 'bg-destructive text-white',
  warm: 'bg-tangerine text-on-brand',
  neutral: 'bg-muted text-background',
};

export function SwipeRow(props: SwipeRowProps) {
  const touch = useMediaQuery('(pointer: coarse)');
  const hasActions = !!(props.leadingActions?.length || props.trailingActions?.length);
  if (!touch || !hasActions) return <>{props.children}</>;
  return <SwipeRowTouch {...props} />;
}

function SwipeRowTouch({ leadingActions = [], trailingActions = [], children }: SwipeRowProps) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const controls = useDragControls();
  const reduceMotion = useReducedMotion();
  const [side, setSide] = useState<'leading' | 'trailing' | null>(null);
  const [confirming, setConfirming] = useState<SwipeAction | null>(null);
  // Actions are visible only while a drag or an open row needs them, so a row
  // that doesn't fill its slot (the md+ inset selection pill) never shows
  // their colour around its edges.
  const [dragging, setDragging] = useState(false);

  const leadWidth = leadingActions.length * ACTION_WIDTH;
  const trailWidth = trailingActions.length * ACTION_WIDTH;
  const settle = (to: number) => animate(x, to, reduceMotion ? { duration: 0 } : sheetSpring);

  const close = () => { setSide(null); setConfirming(null); setDragging(false); settle(0); };

  useEffect(() => {
    if (!side) return;
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    const onOtherOpen = (e: Event) => { if ((e as CustomEvent).detail !== id) close(); };
    const onOutside = (e: globalThis.PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    window.addEventListener(OPEN_EVENT, onOtherOpen);
    window.addEventListener('scroll', close, { capture: true, passive: true });
    document.addEventListener('pointerdown', onOutside);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOtherOpen);
      window.removeEventListener('scroll', close, { capture: true });
      document.removeEventListener('pointerdown', onOutside);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, id]);

  const run = (action: SwipeAction) => {
    if (action.confirm) {
      setConfirming(action);
      setSide(trailingActions.includes(action) ? 'trailing' : 'leading');
      settle(0);
      return;
    }
    close();
    action.onAction();
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const width = ref.current?.offsetWidth ?? 360;
    const offset = x.get() + info.velocity.x * 0.1;
    if (offset < -width * 0.6 && trailingActions.length) return run(trailingActions[trailingActions.length - 1]);
    if (offset > width * 0.6 && leadingActions.length) return run(leadingActions[0]);
    if (offset < -trailWidth / 2 && trailWidth) { setSide('trailing'); settle(-trailWidth); return; }
    if (offset > leadWidth / 2 && leadWidth) { setSide('leading'); settle(leadWidth); return; }
    close();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.clientX < EDGE_GUARD) return; // the edge-swipe back gesture owns this
    controls.start(e);
  };

  const actionButtons = (actions: readonly SwipeAction[], open: boolean) =>
    actions.map((action) => (
      <button key={action.label} type="button" tabIndex={open ? 0 : -1} onClick={() => run(action)}
        className={cn('flex h-full min-w-[76px] items-center justify-center px-3 text-sm font-semibold', toneClass[action.tone])}>
        {action.label}
      </button>
    ));

  return (
    <div ref={ref} className="relative overflow-hidden">
      {confirming ? (
        <div role="alert" className="flex min-h-row">
          <button type="button" autoFocus onClick={() => { const a = confirming; close(); a.onAction(); }}
            className={cn('flex-1 px-4 text-sm font-semibold', toneClass[confirming.tone])}>
            {confirming.confirm}
          </button>
          <button type="button" onClick={close} className="px-4 text-sm font-medium text-teal">Cancel</button>
        </div>
      ) : (
        <>
          <div aria-hidden={side !== 'leading'} className={cn('absolute inset-y-0 left-0 flex', !dragging && !side && 'invisible')}>{actionButtons(leadingActions, side === 'leading')}</div>
          <div aria-hidden={side !== 'trailing'} className={cn('absolute inset-y-0 right-0 flex', !dragging && !side && 'invisible')}>{actionButtons(trailingActions, side === 'trailing')}</div>
          <m.div
            className="relative z-10 touch-pan-y bg-card"
            style={{ x }}
            drag="x"
            dragListener={false}
            dragControls={controls}
            dragDirectionLock
            // Free travel on a side with actions (a full swipe must reach 60%); none on the other.
            dragConstraints={{ left: trailWidth ? -FREE_TRAVEL : 0, right: leadWidth ? FREE_TRAVEL : 0 }}
            dragElastic={0}
            onPointerDown={onPointerDown}
            onDragStart={() => setDragging(true)}
            onDragEnd={(e, info) => { setDragging(false); onDragEnd(e, info); }}
          >
            {children}
          </m.div>
        </>
      )}
    </div>
  );
}
