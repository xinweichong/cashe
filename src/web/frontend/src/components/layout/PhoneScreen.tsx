import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

// Approved shared owner (phone quick view, 2026-10-06): one phone tab as one
// screen. The page's large-title NavBar and a summary sit at the top, one
// view fills the middle, and the view switcher sits in the thumb band just
// above the tab bar. The page never scrolls; a view that outgrows a short
// phone scrolls inside itself. Below md only; iPad and desktop keep their
// scrolling layouts.

export interface PhoneView<T extends string> {
  value: T;
  label: string;
  panel: ReactNode;
}

interface PhoneScreenProps<T extends string> {
  /** The page's NavBar (large title). */
  navBar: ReactNode;
  /** What this tab answers at a look: the spectrum card and its status line. */
  summary?: ReactNode;
  views: readonly PhoneView<T>[];
  view: T;
  onViewChange: (view: T) => void;
  /** Names the switcher for assistive tech, e.g. "Home views". */
  label: string;
  className?: string;
}

// The shell's height on a phone: body pads for the status bar and home
// indicator (index.css) and main pads 80px for the tab bar (TAB_BAR_CLEARANCE).
export const PHONE_SCREEN_HEIGHT = 'h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-80px)]';
// At the Larger text size one screen leaves a view only a few rows, so the
// tab scrolls as a page instead and each view takes its natural height.
const LARGER_TEXT = '[html[data-text-size=larger]_&]:h-auto [html[data-text-size=larger]_&]:overflow-visible';
const LARGER_VIEW = '[html[data-text-size=larger]_&]:min-h-[60dvh]';
const LARGER_SCROLL = '[html[data-text-size=larger]_&]:static [html[data-text-size=larger]_&]:overflow-visible';

// A view's scroll area, with a fade at the bottom edge whenever more sits
// below it, so a scroll inside the screen is never invisible.
function ViewScroller({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // At most one measurement per frame: charts inside resize as they draw.
    let frame = 0;
    const check = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setMoreBelow(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
      });
    };
    check();
    const resize = new ResizeObserver(check);
    resize.observe(el);
    const watchChildren = () => { for (const child of Array.from(el.children)) resize.observe(child); check(); };
    watchChildren();
    const mutations = new MutationObserver(watchChildren);
    mutations.observe(el, { childList: true });
    el.addEventListener('scroll', check, { passive: true });
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect(); el.removeEventListener('scroll', check); };
  }, []);
  return (
    <>
      <div ref={ref} className={cn('absolute inset-0 overflow-y-auto overscroll-contain', LARGER_SCROLL)}>{children}</div>
      <div
        aria-hidden
        className={cn('pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent transition-opacity duration-[var(--dur-fast)]', moreBelow ? 'opacity-100' : 'opacity-0')}
      />
    </>
  );
}

export function PhoneScreen<T extends string>({ navBar, summary, views, view, onViewChange, label, className }: PhoneScreenProps<T>) {
  return (
    <Tabs value={view} onValueChange={(next) => onViewChange(next as T)} className={cn(PHONE_SCREEN_HEIGHT, 'flex flex-col overflow-hidden', LARGER_TEXT, className)}>
      <div className="shrink-0">{navBar}</div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4">
        {summary && <div className="shrink-0">{summary}</div>}
        {views.map((v) => (
          // Radix mounts only the chosen view, so hidden charts never fetch or measure.
          <TabsContent key={v.value} value={v.value} className={cn('relative mt-0 min-h-0 flex-1', LARGER_VIEW)}><ViewScroller>{v.panel}</ViewScroller></TabsContent>
        ))}
      </div>
      <div className="shrink-0 px-4 pt-2 pb-1">
        <TabsList aria-label={label} className="flex w-full">
          {views.map((v) => <TabsTrigger key={v.value} value={v.value} className="flex-1">{v.label}</TabsTrigger>)}
        </TabsList>
      </div>
    </Tabs>
  );
}

/** The line under a PhoneScreen summary card: a status on the left, a change
 * or count on the right, each a short label rather than a sentence. */
export function PhoneSummaryLine({ start, end }: { start: ReactNode; end?: ReactNode }) {
  return (
    <div className="mt-2 flex min-h-6 items-center justify-between gap-3 px-1 text-sm text-muted">
      <div className="flex min-w-0 items-center gap-1.5">{start}</div>
      {end && <div className="flex shrink-0 items-center gap-1">{end}</div>}
    </div>
  );
}
