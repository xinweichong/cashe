import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { springs } from '@/lib/motionPresets';
import type { BadgeTone } from '@/components/ui/badge';
import { TONE_FILL } from '@/lib/tones';

// Approved shared owner (P6/U18, 2026-09-25): budget and goal progress only.
// Forecast composition, ranking bars and ProgressRing are different data and
// stay separate. Above 100% the fill caps; the accessible value keeps the
// real percentage so an overage is announced, not hidden.
interface ProgressBarProps {
  percent: number;
  label: string;
  tone?: BadgeTone;
  className?: string;
}

export function ProgressBar({ percent, label, tone = 'saved', className }: ProgressBarProps) {
  const reduceMotion = useReducedMotion();
  const rounded = Math.round(percent);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.max(100, rounded)}
      aria-valuenow={rounded}
      aria-valuetext={`${rounded}%`}
      className={cn('h-1.5 w-full overflow-hidden rounded-pill bg-foreground/10', className)}
    >
      <motion.div
        className={cn('h-full rounded-pill', TONE_FILL[tone])}
        initial={reduceMotion ? false : { width: 0 }}
        animate={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
        transition={springs.gentle}
      />
    </div>
  );
}
