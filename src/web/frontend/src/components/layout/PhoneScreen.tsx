import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { SelectableRow } from '@/components/ui/selectable-row';
import { cn } from '@/lib/utils';
import { tapFeedback } from '@/lib/haptics';
import { quickFade, springs } from '@/lib/motionPresets';

// Approved shared owner (phone redesign, 2026-09-25): one phone tab as one
// screen. The glance sits on top, one lens panel fills the middle, and the
// lens triggers sit in the thumb band just above BottomTabs. The page itself
// never scrolls; a panel that outgrows a short phone scrolls inside itself.

export interface Lens<T extends string> {
  value: T;
  label: string;
  panel: ReactNode;
  /** The panel brings its own card(s), so the lens frame drops its border
   * and fill rather than nesting a card in a card. */
  bare?: boolean;
}

interface PhoneScreenProps<T extends string> {
  /** The fixed top glance: the one thing this tab answers at a look. */
  glance: ReactNode;
  lenses: readonly Lens<T>[];
  lens: T;
  onLensChange: (lens: T) => void;
  /** Names the lens group for assistive tech, e.g. "Home views". */
  label: string;
  /** Optional thumb-band control under the lenses, e.g. Activity's search. */
  dock?: ReactNode;
  className?: string;
}

// Everything else in the phone's document height: body's status-bar and
// home-indicator padding (index.css), AppShell's 3rem top bar, and main's
// 4rem bottom padding for the tab bar. dvh tracks Safari's toolbars.
export const PHONE_SCREEN_HEIGHT = 'h-[calc(100dvh-7rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]';

// At the Larger text size a fixed one-screen layout leaves the panel only a
// few rows, so the screen becomes page-scrolling instead: the glance, a
// generous panel and the lens bar stack at their natural height.
const LARGER_TEXT = '[html[data-text-size=larger]_&]:h-auto [html[data-text-size=larger]_&]:overflow-visible';
const LARGER_PANEL = '[html[data-text-size=larger]_&]:min-h-[70dvh]';

// A lens panel's scroll area, with a fade at the bottom edge whenever more
// content sits below it, so an inner scroll is never invisible.
function LensScroller({ bare, children }: { bare?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // At most one measurement per frame: charts animating inside the panel
    // resize constantly, and each check forces a layout read.
    let frame = 0;
    const check = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setMoreBelow(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
      });
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    // Direct children only: a card swapping in (loading → loaded) changes
    // the height; chart internals never need to be watched.
    const mutations = new MutationObserver(() => {
      for (const child of Array.from(el.children)) observer.observe(child);
      check();
    });
    mutations.observe(el, { childList: true });
    el.addEventListener('scroll', check, { passive: true });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); mutations.disconnect(); el.removeEventListener('scroll', check); };
  }, []);
  return (
    <>
      <div
        ref={ref}
        className={cn(
          'absolute inset-0 overflow-y-auto overscroll-contain',
          // A bare lens's own cards carry the radius; the frame stays
          // square so it never trims their corners.
          bare ? 'flex flex-col gap-2 [&>*]:shrink-0' : 'rounded-lg border border-border bg-card',
        )}
      >
        {children}
      </div>
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t to-transparent transition-opacity duration-[var(--dur-fast)]',
          bare ? 'from-background' : 'mx-px mb-px rounded-b-lg from-card',
          moreBelow ? 'opacity-100' : 'opacity-0',
        )}
      />
    </>
  );
}

export function PhoneScreen<T extends string>({ glance, lenses, lens, onLensChange, label, dock, className }: PhoneScreenProps<T>) {
  const reduceMotion = useReducedMotion();
  return (
    <Tabs
      value={lens}
      onValueChange={(value) => { tapFeedback(); onLensChange(value as T); }}
      className={cn(PHONE_SCREEN_HEIGHT, 'flex flex-col gap-2 px-3 pt-3 pb-2 overflow-hidden', LARGER_TEXT, className)}
    >
      <div className="shrink-0">{glance}</div>
      <div className={cn('relative flex-1 min-h-0', LARGER_PANEL)}>
        {/* No initial={false} here: it would reach into panels whose own
            staggered lists mount after data loads and leave them at their
            hidden initial state. The panel's first fade-in is the cost.
            Panels are already absolutely stacked, so a plain crossfade needs
            no popLayout measurement pass. */}
        <AnimatePresence>
          {lenses.filter((l) => l.value === lens).map((l) => (
            <TabsContent key={l.value} value={l.value} forceMount asChild className="mt-0">
              <motion.div
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.08 } }}
                transition={quickFade}
                className="absolute inset-0 will-change-[opacity,transform]"
              >
                <LensScroller bare={l.bare}>{l.panel}</LensScroller>
              </motion.div>
            </TabsContent>
          ))}
        </AnimatePresence>
      </div>
      <TabsList aria-label={label} className="shrink-0 w-full h-auto p-1 overflow-visible">
        {lenses.map((l) => (
          <TabsTrigger
            key={l.value}
            value={l.value}
            // The active fill is a shared-layout indicator that slides between
            // lenses; the press scale confirms the tap where haptics can't.
            className="relative flex-1 min-w-0 min-h-11 px-1 text-[0.8125rem] active:scale-[0.96] transition-transform data-[state=active]:border-transparent data-[state=active]:bg-transparent"
          >
            {l.value === lens && (
              <motion.span
                layoutId={`${label}-lens-indicator`}
                aria-hidden
                className="absolute inset-0 rounded-sm border border-teal/25 bg-teal/13"
                transition={reduceMotion ? { duration: 0 } : springs.snappy}
              />
            )}
            <span className="relative truncate">{l.label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {dock && <div className="shrink-0">{dock}</div>}
    </Tabs>
  );
}

/** In a bare lens, the one card that stretches to fill the panel. */
export function LensGrow({ children }: { children: ReactNode }) {
  return <div className="flex grow flex-col gap-2 [&>*]:grow">{children}</div>;
}

/**
 * A bare lens's secondary views as one-line rows that open DrillSheets,
 * so a lens shows one card instead of stacking a scroll feed.
 */
export function LensMore({ items }: { items: readonly { label: string; hint?: ReactNode; onOpen: () => void }[] }) {
  if (!items.length) return null;
  return (
    <Card className="divide-y divide-border overflow-hidden">
      {items.map((item) => (
        <SelectableRow key={item.label} onClick={item.onOpen} className="min-h-12 gap-3 rounded-none px-4">
          <span className="flex-1 text-sm font-medium">{item.label}</span>
          {item.hint && <span className="text-xs text-muted">{item.hint}</span>}
          <ChevronRight size={16} className="text-muted" aria-hidden />
        </SelectableRow>
      ))}
    </Card>
  );
}
