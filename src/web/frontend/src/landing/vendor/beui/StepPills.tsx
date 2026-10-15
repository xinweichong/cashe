/**
 * Adapted from beUI "Tabs" (beui.dev/components/motion/tabs).
 * Copyright beUI; used under the beUI license, which permits modification and
 * commercial use with this notice kept.
 *
 * Landing page only: Home · Activity · Plan · Explore above the tour phone and
 * in the phone-width floating bar. Kept from the original: the shared-layout
 * pill that glides between items on a no-overshoot spring, scoped with
 * `layoutRoot` so page scroll never replays as movement. Changes: these jump
 * to a step of the tour, so they are a nav with aria-current rather than a
 * tablist; the selected pill is cashe teal; m.* for LazyMotion.
 */
import { LayoutGroup, m, useReducedMotion } from 'motion/react';
import { useId } from 'react';
import { cn } from '@/lib/utils';
import { SPRING_GLIDE } from '../../lib/ease';

export function StepPills({ steps, current, onPick, label, className }: {
  steps: readonly { id: string; label: string }[];
  current: number;
  onPick: (index: number) => void;
  label: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const id = useId();
  return (
    <LayoutGroup id={id}>
      <m.nav layoutRoot aria-label={label} className={cn('inline-flex gap-1 rounded-full bg-card p-1 shadow-elev-md', className)}>
        {steps.map((step, i) => (
          <a
            key={step.id}
            href={`#${step.id}`}
            onClick={event => { event.preventDefault(); onPick(i); }}
            aria-current={i === current ? 'step' : undefined}
            className={cn(
              'relative inline-flex min-h-10 items-center rounded-full px-4 text-sm font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal',
              i === current ? 'text-on-teal' : 'text-muted hover:text-foreground',
            )}
          >
            {i === current && (
              <m.span
                layoutId="pill"
                transition={reduce ? { duration: 0 } : SPRING_GLIDE}
                className="absolute inset-0 rounded-full bg-teal"
                aria-hidden="true"
              />
            )}
            <span className="relative">{step.label}</span>
          </a>
        ))}
      </m.nav>
    </LayoutGroup>
  );
}
