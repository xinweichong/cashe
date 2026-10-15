import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { ArrowDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn, getCategoryColor, getCategoryTextColor } from '@/lib/utils';
import { CATCHES, TAGLINE, money, type Catch } from '../content';
import { SPRING_LAND } from '../lib/ease';
import { usePhases } from '../lib/usePhases';
import { SlidingNumber } from '../vendor/animate-ui/SlidingNumber';
import { TopoBackground } from '../vendor/kokonut/TopoBackground';
import { TourLink } from './TourLink';

// One purchase is caught every beat, after a pause to read the headline.
const CATCH_SCRIPT = [1400, ...CATCHES.slice(1).map(() => 1100)] as const;

/**
 * The first screen: the headline on the left, and on the right loose
 * purchases (an alert, a Wallet tap, a Telegram message) drifting over
 * contour lines in the brand spectrum. One at a time they are caught: each
 * straightens into a merchant, category and amount, and the total rolls up.
 */
export function Hero() {
  const caught = usePhases(CATCH_SCRIPT, true);
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-10 px-4 pb-14 pt-10 md:gap-12 md:px-8 md:pb-20 md:pt-16 lg:min-h-[min(calc(100svh-3.5rem),56rem)] lg:grid-cols-12 lg:items-center lg:gap-6 lg:py-16">
        <div className="relative z-10 lg:col-span-5">
          {/* No entrance fade: the headline is the largest paint. */}
          <h1 id="hero-title" className="font-display text-[3.5rem] font-extrabold leading-[0.95] tracking-tighter md:text-7xl lg:text-[5.25rem]">
            {TAGLINE}
          </h1>
          <p className="mt-5 max-w-[34ch] text-lg text-muted md:mt-6 md:text-xl">
            cashe writes down every purchase from your bank alerts, Apple Pay and Telegram, sorts it, and shows where each number came from.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3 md:mt-9">
            <Button asChild size="lg"><Link to="/login">Sign In</Link></Button>
            <Button asChild size="lg" variant="outline"><TourLink>See it work <ArrowDown /></TourLink></Button>
          </div>
          <p className="mt-5 text-sm text-muted">By invitation only. No ads, and data is never sold.</p>
        </div>
        <div className="relative min-w-0 lg:col-span-7">
          <FieldDesktop caught={caught} />
          <FieldPhone caught={caught} />
        </div>
      </div>
    </section>
  );
}

/** Desktop: the purchases drift in an open field over the contour lines. */
function FieldDesktop({ caught }: { caught: number }) {
  return (
    <div className="relative hidden aspect-[7/6] max-h-[40rem] w-full lg:block">
      <div className="absolute -inset-x-16 -inset-y-10">
        <TopoBackground />
      </div>
      <ul aria-label="Purchases as they arrive, for example" className="absolute inset-0">
        {CATCHES.map((c, i) => (
          <li key={c.id} className="absolute" style={{ left: `${c.x}%`, top: `${c.y}%` }}>
            <Drift index={i}><CatchChip item={c} caught={i < caught} /></Drift>
          </li>
        ))}
      </ul>
      <CaughtLine caught={caught} className="absolute -bottom-2 left-[4%]" />
    </div>
  );
}

/** Phones and tablets: two slow rows of purchases under the headline, then the total. */
function FieldPhone({ caught }: { caught: number }) {
  const reduce = useReducedMotion();
  const rows = [CATCHES.slice(0, 5), CATCHES.slice(5)];
  return (
    <div className="relative -mx-4 md:-mx-8 lg:hidden">
      <div className="absolute inset-x-0 -inset-y-16">
        <TopoBackground interactive={false} />
      </div>
      <ul aria-label="Purchases as they arrive, for example" className="sr-only">
        {CATCHES.map(c => <li key={c.id}>{c.raw}</li>)}
      </ul>
      <div aria-hidden="true" className="relative flex flex-col gap-3 overflow-hidden py-2 [mask-image:linear-gradient(to_right,transparent,#000_8%,#000_92%,transparent)]">
        {rows.map((row, r) => (
          <m.div
            key={row[0].id}
            className="flex w-max gap-3 pl-4 md:pl-8"
            animate={reduce ? undefined : { x: r === 0 ? ['0%', '-50%'] : ['-50%', '0%'] }}
            transition={{ duration: 46 + r * 8, ease: 'linear', repeat: Infinity }}
          >
            {/* Two copies, so the loop never shows a gap. */}
            {[...row, ...row].map((c, k) => (
              <CatchChip key={`${c.id}-${k}`} item={c} caught={CATCHES.indexOf(c) < caught} />
            ))}
          </m.div>
        ))}
      </div>
      <CaughtLine caught={caught} className="relative mt-5 px-4 md:px-8" />
    </div>
  );
}

/** Each purchase bobs on its own slow loop, so the field never moves in step. */
function Drift({ index, children }: { index: number; children: ReactNode }) {
  const reduce = useReducedMotion();
  const dx = index % 2 === 0 ? 6 : -5;
  const dy = index % 3 === 0 ? -9 : 7;
  return (
    <m.div
      // No entrance fade: the field is visible before the script runs.
      animate={reduce ? undefined : { x: [0, dx, 0], y: [0, dy, 0] }}
      transition={{
        x: { duration: 7 + (index % 4), repeat: Infinity, ease: 'easeInOut' },
        y: { duration: 6 + (index % 5) * 0.8, repeat: Infinity, ease: 'easeInOut' },
      }}
    >
      {children}
    </m.div>
  );
}

/** Loose, it is the message as it arrived; caught, it is the purchase cashe writes down. */
function CatchChip({ item, caught }: { item: Catch; caught: boolean }) {
  const color = getCategoryColor(item.category);
  return (
    <m.span
      layout
      initial={false}
      animate={{ rotate: caught ? 0 : item.tilt }}
      transition={SPRING_LAND}
      className={cn(
        'inline-flex min-h-10 items-center overflow-hidden whitespace-nowrap rounded-full border bg-card px-4 text-[15px] shadow-elev-xs transition-colors duration-500',
        !caught && 'border-border',
      )}
      style={caught ? { borderColor: `color-mix(in srgb, ${color} 50%, transparent)`, boxShadow: `0 6px 18px -8px color-mix(in srgb, ${color} 55%, transparent)` } : undefined}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {caught ? (
          <m.span key="caught" className="flex items-center gap-2" initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={SPRING_LAND}>
            <span className="size-2 rounded-full" style={{ background: color }} />
            <span className="font-medium">{item.merchant}</span>
            <span className="text-sm" style={{ color: getCategoryTextColor(item.category) }}>{item.category}</span>
            <span className="font-mono text-sm text-tangerine">{money(item.amount)}</span>
          </m.span>
        ) : (
          <m.span key="raw" className="font-mono text-sm text-muted" exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }} transition={{ duration: 0.2 }}>
            {item.raw}
          </m.span>
        )}
      </AnimatePresence>
    </m.span>
  );
}

/** "$146.64 caught this week", rolling as each purchase is caught. */
function CaughtLine({ caught, className }: { caught: number; className?: string }) {
  const total = CATCHES.slice(0, caught).reduce((sum, c) => sum + c.amount, 0);
  const done = caught >= CATCHES.length;
  return (
    <p className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-1', className)} aria-live="polite">
      <SlidingNumber className="font-mono text-3xl font-semibold leading-none text-tangerine" text={money(total)} />
      <span className="text-[15px] text-muted">caught this week</span>
      <AnimatePresence>
        {done && (
          <m.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={SPRING_LAND} className="inline-flex items-center gap-1.5 text-[15px] font-medium text-teal">
            <span className="size-2 rounded-full bg-teal" />All caught up
          </m.span>
        )}
      </AnimatePresence>
    </p>
  );
}
