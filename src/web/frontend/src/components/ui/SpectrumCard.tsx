import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

// Approved shared owner (P11, HIG alignment 2026-10-01): the one spectrum
// card per screen, only at the top of a tab root (Home, Plan, Explore). It
// replaces HeroCard/HighlightCard/HeroAmount's glow and gradient text. The
// fill is identical in both themes and text is --color-on-brand, which holds
// ≥4.5:1 against every spectrum stop. Callers pass pre-formatted values.

export type SpectrumStatus = 'complete' | 'partial' | 'estimated';

interface SpectrumCardProps {
  /** Top-left label, e.g. "September". */
  label: ReactNode;
  /** Top-right context, e.g. "Budget S$3,000". Status labels override it. */
  meta?: ReactNode;
  value: ReactNode;
  /** Small text beside the value, e.g. "Healthy". */
  valueSuffix?: ReactNode;
  caption?: ReactNode;
  /** 0–1. Omitted for estimates and when there is nothing to measure against. */
  progress?: number;
  /** Accessible name for the progress bar, e.g. "Budget used". */
  progressLabel?: string;
  status?: SpectrumStatus;
  className?: string;
}

const STATUS_LABEL: Record<Exclude<SpectrumStatus, 'complete'>, string> = {
  partial: 'Partial',
  estimated: 'Estimated',
};

export function SpectrumCard({
  label, meta, value, valueSuffix, caption, progress, progressLabel = 'Progress',
  status = 'complete', className,
}: SpectrumCardProps) {
  const showBar = progress !== undefined && status !== 'estimated';
  const clamped = Math.min(1, Math.max(0, progress ?? 0));
  return (
    <div className={cn('spectrum-fill relative isolate overflow-hidden rounded-hero px-4 py-3.5', className)}>
      {/* A soft top sheen gives the flat gradient a surface, as Wallet cards have. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgb(255_255_255/0.18),transparent_50%)]" />
      <div className="flex items-baseline justify-between gap-3 text-xs font-semibold opacity-80">
        <span>{label}</span>
        {status !== 'complete' ? <span>{STATUS_LABEL[status]}</span> : meta && <span>{meta}</span>}
      </div>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-2 font-display text-3xl font-extrabold leading-tight tracking-[-0.02em] tabular-nums">
        {value}
        {valueSuffix && <span className="font-body text-sm font-semibold tracking-normal opacity-75">{valueSuffix}</span>}
      </p>
      {caption && <p className="mt-0.5 text-xs font-medium opacity-85">{caption}</p>}
      {showBar && (
        <div
          role="progressbar"
          aria-label={progressLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(clamped * 100)}
          className="mt-3 h-1.5 rounded-pill bg-on-brand/18"
        >
          <div
            className={cn(
              'h-full rounded-pill',
              status === 'partial' ? 'bg-[repeating-linear-gradient(90deg,var(--color-on-brand)_0_6px,transparent_6px_10px)]' : 'bg-on-brand',
            )}
            style={{ width: `${clamped * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Same footprint as the card while its facts load. */
export function SpectrumCardSkeleton({ className }: { className?: string }) {
  return <Skeleton aria-hidden className={cn('h-[8.25rem] rounded-hero', className)} />;
}
