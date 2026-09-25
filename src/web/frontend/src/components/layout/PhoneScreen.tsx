import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { tapFeedback } from '@/lib/haptics';

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

export function PhoneScreen<T extends string>({ glance, lenses, lens, onLensChange, label, dock, className }: PhoneScreenProps<T>) {
  const reduceMotion = useReducedMotion();
  return (
    <Tabs
      value={lens}
      onValueChange={(value) => { tapFeedback(); onLensChange(value as T); }}
      className={cn(PHONE_SCREEN_HEIGHT, 'flex flex-col gap-2 px-3 pt-3 pb-2 overflow-hidden', className)}
    >
      <div className="shrink-0">{glance}</div>
      <div className="relative flex-1 min-h-0">
        {/* No initial={false} here: it would reach into panels whose own
            staggered lists mount after data loads and leave them at their
            hidden initial state. The panel's first fade-in is the cost. */}
        <AnimatePresence mode="popLayout">
          {lenses.filter((l) => l.value === lens).map((l) => (
            <TabsContent key={l.value} value={l.value} forceMount asChild className="mt-0">
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, transition: { duration: 0.08 } }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  'absolute inset-0 overflow-y-auto overscroll-contain',
                  // A bare lens's own cards carry the radius; the frame stays
                  // square so it never trims their corners.
                  l.bare ? 'flex flex-col gap-2 [&>*]:shrink-0 [&>*:last-child]:flex-1' : 'rounded-lg border border-border bg-card',
                )}
              >
                {l.panel}
              </motion.div>
            </TabsContent>
          ))}
        </AnimatePresence>
      </div>
      <TabsList aria-label={label} className="shrink-0 w-full h-auto p-1 overflow-visible">
        {lenses.map((l) => (
          <TabsTrigger key={l.value} value={l.value} className="flex-1 min-w-0 min-h-11 px-1 text-[13px]">
            {l.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {dock && <div className="shrink-0">{dock}</div>}
    </Tabs>
  );
}
