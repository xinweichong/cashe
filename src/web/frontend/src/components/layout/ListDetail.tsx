import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { AnimatePresence, animate, motion, useDragControls, useMotionValue, useReducedMotion, useTransform, type PanInfo } from 'framer-motion';
import { useIsPhone } from '@/hooks/useIsPhone';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useListKeyboard } from '@/hooks/useListKeyboard';
import { EASE_IOS } from '@/lib/motionPresets';
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

export function ListDetail(props: ListDetailProps) {
  const isPhone = useIsPhone();
  if (isPhone) return <PhoneStack {...props} />;
  return props.variant === 'inspector' ? <Inspector {...props} /> : <SplitView {...props} />;
}

function Inspector({ list, detail, onClose, onDeleteSelected, listLabel, detailLabel = 'Details', backLabel }: ListDetailProps) {
  const listRef = useRef<HTMLDivElement>(null);
  useListKeyboard(listRef, { onDelete: detail ? onDeleteSelected : undefined, onEscape: detail ? onClose : undefined });
  return (
    <StackContext.Provider value={{ back: onClose, label: backLabel }}>
      <div className="flex min-h-0 items-start">
        <section ref={listRef} aria-label={listLabel} className="min-w-0 flex-1">{list}</section>
        {detail && (
          <section aria-label={detailLabel}
            className="sticky top-[env(safe-area-inset-top)] h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-[26rem] shrink-0 overflow-y-auto overscroll-contain border-l-[0.5px] border-separator bg-background">
            {detail}
          </section>
        )}
      </div>
    </StackContext.Provider>
  );
}

function SplitView({ list, detail, onClose, emptyDetail, onDeleteSelected, listLabel, detailLabel = 'Details', backLabel }: ListDetailProps) {
  const listRef = useRef<HTMLDivElement>(null);
  useListKeyboard(listRef, { onDelete: detail ? onDeleteSelected : undefined, onEscape: detail ? onClose : undefined });
  return (
    <StackContext.Provider value={{ back: onClose, label: backLabel }}>
      <div className="flex h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-h-0">
        <section ref={listRef} aria-label={listLabel}
          className="w-[22rem] shrink-0 overflow-y-auto overscroll-contain border-r-[0.5px] border-separator lg:w-[24rem]">
          {list}
        </section>
        <section aria-label={detailLabel} className="min-w-0 flex-1 overflow-y-auto overscroll-contain">
          {detail ?? emptyDetail}
        </section>
      </div>
    </StackContext.Provider>
  );
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

const EDGE = 24;

function PhoneStack({ list, detail, onClose, backLabel }: ListDetailProps) {
  const reduceMotion = useReducedMotion();
  const standalone = useMediaQuery('(display-mode: standalone)') || (typeof navigator !== 'undefined' && isStandalone());
  // Whether the next pop is ours to animate (our back button or edge swipe).
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

  const back = () => { setOwnPop(true); onClose(); };

  const onPointerDown = (e: PointerEvent) => {
    if (standalone && e.clientX < EDGE) controls.start(e);
  };
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (x.get() > width * 0.35 || info.velocity.x > 500) back();
    else animate(x, 0, { duration: 0.25, ease: EASE_IOS });
  };

  // Pixel offsets (not %) so the list beneath can track the same value.
  // Exit reads AnimatePresence's `custom` at exit time: true when the pop is
  // ours to animate; a pop Safari already animated leaves instantly.
  const push = { duration: 0.35, ease: EASE_IOS };
  const variants = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.15 } }, exit: { opacity: 0, transition: { duration: 0.1 } } }
    : {
        initial: { x: width },
        animate: { x: 0, transition: push },
        exit: (ours: boolean) => (ours ? { x: width, transition: push } : { opacity: 0, transition: { duration: 0 } }),
      };
  return (
    <StackContext.Provider value={{ back, label: backLabel }}>
      <div className="relative">
        <motion.div
          aria-hidden={detail ? true : undefined}
          inert={detail ? true : undefined}
          style={detail && !reduceMotion ? { x: underX, filter: underFilter } : undefined}
        >
          {list}
        </motion.div>
        <AnimatePresence initial={false} custom={ownPop}>
          {detail && (
            <motion.div
              key="detail"
              className="fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-background shadow-[-12px_0_30px_rgb(0_0_0/0.35)] pt-[env(safe-area-inset-top)]"
              style={{ x }}
              custom={ownPop}
              variants={variants}
              initial="initial"
              animate="animate"
              exit="exit"
              onAnimationComplete={(def) => { if (def === 'exit') setOwnPop(false); }}
              drag="x"
              dragListener={false}
              dragControls={controls}
              dragConstraints={{ left: 0, right: width }}
              dragElastic={0}
              onPointerDown={onPointerDown}
              onDragEnd={onDragEnd}
            >
              {detail}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </StackContext.Provider>
  );
}

