import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { BadgeTone } from '@/components/ui/badge';

// Approved shared owner (P4/U09, 2026-09-25): the §7.4 6px status dot, with
// an optional readable label. Colour never carries the meaning alone — pass a
// label, or place the dot beside visible text (it is aria-hidden either way).
const TONE_BG: Record<BadgeTone, string> = {
  saved: 'bg-teal',
  calm: 'bg-mint',
  active: 'bg-honey',
  notable: 'bg-tangerine',
  warm: 'bg-coral',
};

const TONE_TEXT: Record<BadgeTone, string> = {
  saved: 'text-teal',
  calm: 'text-mint',
  active: 'text-honey',
  notable: 'text-tangerine',
  warm: 'text-coral',
};

interface StatusDotProps {
  tone?: BadgeTone;
  /** Category identity colour (from getCategoryColor); overrides tone. */
  color?: string;
  label?: ReactNode;
  className?: string;
}

export function StatusDot({ tone = 'saved', color, label, className }: StatusDotProps) {
  const dot = (
    <span
      aria-hidden
      className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', !color && TONE_BG[tone])}
      style={color ? { background: color } : undefined}
    />
  );
  if (!label) return <span className={cn('inline-flex', className)}>{dot}</span>;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', !color && TONE_TEXT[tone], className)}>
      {dot}
      {label}
    </span>
  );
}
