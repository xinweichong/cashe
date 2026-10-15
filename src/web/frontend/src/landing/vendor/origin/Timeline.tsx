/**
 * Adapted from Origin UI "Timeline" (MIT), https://coss.com/origin
 *
 * Landing page only: the three setup steps. Kept from the original: the item,
 * header, separator and indicator anatomy, steps up to the active one marked,
 * and the separator filling between marked steps. Changes: vertical only, no
 * Radix Slot, a marked step is a teal outline rather than a fill (these are
 * steps to come, not steps done), m.* for LazyMotion, and Motion draws the
 * separator's fill.
 */
import { m, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from '@/lib/utils';
import { EASE_OUT } from '../../lib/ease';

export function Timeline({ children, className }: { children: ReactNode; className?: string }) {
  return <ol className={cn("flex flex-col", className)}>{children}</ol>;
}

export function TimelineItem({
  completed,
  last = false,
  indicator,
  title,
  children,
}: {
  completed: boolean;
  last?: boolean;
  indicator: ReactNode;
  title: ReactNode;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <li data-completed={completed || undefined} className={cn("relative ps-14", !last && "pb-10")}>
      {last ? null : (
        <span
          aria-hidden="true"
          className="absolute start-[19px] top-11 bottom-1 w-0.5 rounded-full bg-border"
        >
          <m.span
            className="absolute inset-0 origin-top rounded-full bg-teal"
            initial={false}
            animate={{ scaleY: completed ? 1 : 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.7, ease: EASE_OUT, delay: 0.15 }}
          />
        </span>
      )}
      <span
        aria-hidden="true"
        className={cn(
          "absolute start-0 top-0 grid size-10 place-items-center rounded-full border-2 font-display text-base font-semibold tabular-nums transition-colors duration-300",
          completed
            ? "border-teal bg-card text-teal"
            : "border-border bg-card text-muted",
        )}
      >
        {indicator}
      </span>
      <h3 className="pt-1.5 font-display text-xl font-semibold tracking-[-0.01em] text-foreground">
        {title}
      </h3>
      <div className="mt-2 max-w-[56ch] text-base leading-6 text-muted">{children}</div>
    </li>
  );
}
