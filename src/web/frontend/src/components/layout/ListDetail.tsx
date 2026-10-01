import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { AnimatePresence, animate, motion, useDragControls, useMotionValue, useReducedMotion, useTransform, type PanInfo } from 'framer-motion';
import { useIsPhone } from '@/hooks/useIsPhone';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useListKeyboard } from '@/hooks/useListKeyboard';
import { EASE_IOS } from '@/lib/motionPresets';
import { cn } from '@/lib/utils';
import { StackContext } from './stackContext';

// Approved shared owners P6 (navigation stack) and P7 (split view), HIG
// alignment 2026-10-01. One layout for every list with details: the detail
// is a route (/activity/:id), so browser Back, reload and deep links work.
//
// Phone: the detail is pushed over the list as its own page. The list stays
// mounted beneath (filters and scroll survive), shifted and dimmed. Back
// comes from the detail's NavBar (useStackBack), the browser, or, in the
// home-screen app where iOS offers no gesture, an edge swipe built here.
// A pop the browser already animated (Safari's own swipe) is not animated
// again.
//
// md+: list and detail sit side by side, each scrolling on its own; the
// list column takes the Mac keyboard conventions (useListKeyboard).

interface ListDetailProps {
  list: ReactNode;
  /** The selected item's page, or null when nothing is selected. */
  detail: ReactNode | null;
  /** Leaves the detail: back to the list (the page decides history vs replace). */
  onClose: () => void;
  /** md+ detail column when nothing is selected. */
  emptyDetail?: ReactNode;
  /** md+: ⌫ on the list asks to delete the selected item. */
  onDeleteSelected?: () => void;
  /** Accessible names for the two regions. */
  listLabel: string;
  detailLabel?: string;
  /** What the detail's back button calls the list, e.g. "Plan". */
  backLabel?: string;
  /**
   * 'split' (default): a narrow list column beside the detail (Activity).
   * 'inspector': the list is the whole page and the detail opens as a
   * column on its right only while something is selected (Plan), the HIG
   * inspector arrangement. Phones push the detail either way.
   */
  variant?: 'split' | 'inspector';
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

const EDGE = 24;

// One element tree in every mode: the list and the detail keep the same
// positions whether the screen is a phone (pushed page), split or inspector,
// so crossing the 768px breakpoint (rotating an iPad mini) only restyles
// them and an in-progress edit in the detail survives.
export function ListDetail({ list, detail, onClose, emptyDetail, onDeleteSelected, listLabel, detailLabel = 'Details', backLabel, variant = 'split' }: ListDetailProps) {
  const isPhone = useIsPhone();
  const inspector = variant === 'inspector';
  const reduceMotion = useReducedMotion();
  const standalone = useMediaQuery('(display-mode: standalone)') || (typeof navigator !== 'undefined' && isStandalone());
  const listRef = useRef<HTMLElement>(null);
  useListKeyboard(listRef, { onDelete: detail ? onDeleteSelected : undefined, onEscape: detail ? onClose : undefined, enabled: !isPhone });

  // Phone push: whether the next pop is ours to animate (our back button or
  // edge swipe); a pop Safari already animated leaves instantly.
  const [ownPop, setOwnPop] = useState(false);
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 390 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const x = useMotionValue(0);
  const controls = useDragControls();
  // The list beneath tracks the pushed page: -30% and dimmed when covered.
  const underX = useTransform(x, [0, width], ['-30%', '0%']);
  const underDim = useTransform(x, [0, width], [0.7, 1]);
  const underFilter = useTransform(underDim, (v) => `brightness(${v})`);

  const back = isPhone ? () => { setOwnPop(true); onClose(); } : onClose;
  const onPointerDown = (e: PointerEvent) => {
    if (isPhone && standalone && e.clientX < EDGE) controls.start(e);
  };
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (x.get() > width * 0.35 || info.velocity.x > 500) back();
    else animate(x, 0, { duration: 0.25, ease: EASE_IOS });
  };
  // Pixel offsets (not %) so the list beneath can track the same value.
  // Exit reads AnimatePresence's `custom` at exit time.
  const push = { duration: 0.35, ease: EASE_IOS };
  const phoneVariants = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.15 } }, exit: { opacity: 0, transition: { duration: 0.1 } } }
    : {
        initial: { x: width },
        animate: { x: 0, transition: push },
        exit: (ours: boolean) => (ours ? { x: width, transition: push } : { opacity: 0, transition: { duration: 0 } }),
      };
  const staticVariants = { initial: {}, animate: {}, exit: {} };

  const covered = isPhone && !!detail;
  const viewportHeight = 'h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))]';
  return (
    <StackContext.Provider value={{ back, label: backLabel }}>
      <div className={isPhone ? 'relative' : inspector ? 'flex min-h-0 items-start' : cn('flex min-h-0', viewportHeight)}>
        <motion.section
          ref={listRef}
          aria-label={listLabel}
          aria-hidden={covered ? true : undefined}
          inert={covered ? true : undefined}
          style={covered && !reduceMotion ? { x: underX, filter: underFilter } : undefined}
          className={isPhone ? undefined : inspector
            ? 'min-w-0 flex-1'
            : 'w-[22rem] shrink-0 overflow-y-auto overscroll-contain border-r-[0.5px] border-separator lg:w-[24rem]'}
        >
          {list}
        </motion.section>
        <AnimatePresence initial={false} custom={ownPop}>
          {detail && (
            <motion.section
              key="detail"
              aria-label={detailLabel}
              className={isPhone
                ? 'fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-background pt-[env(safe-area-inset-top)] shadow-[-12px_0_30px_rgb(0_0_0/0.35)]'
                : inspector
                  ? cn('sticky top-[env(safe-area-inset-top)] w-[26rem] shrink-0 overflow-y-auto overscroll-contain border-l-[0.5px] border-separator bg-background', viewportHeight)
                  : 'min-w-0 flex-1 overflow-y-auto overscroll-contain'}
              style={isPhone ? { x } : undefined}
              custom={ownPop}
              variants={isPhone ? phoneVariants : staticVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              onAnimationComplete={(def) => { if (def === 'exit') setOwnPop(false); }}
              drag={isPhone ? 'x' : false}
              dragListener={false}
              dragControls={controls}
              dragConstraints={{ left: 0, right: width }}
              dragElastic={0}
              onPointerDown={onPointerDown}
              onDragEnd={onDragEnd}
            >
              {detail}
            </motion.section>
          )}
        </AnimatePresence>
        {!detail && !isPhone && !inspector && (
          <section aria-label={detailLabel} className="min-w-0 flex-1 overflow-y-auto overscroll-contain">{emptyDetail}</section>
        )}
      </div>
    </StackContext.Provider>
  );
}
