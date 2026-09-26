import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DeltaBadge, Sparkline } from '@/lib/animations';
import { CardLink } from '@/components/ui/cards';

type StatColor = 'teal' | 'warm' | 'coral' | 'mint' | 'default';

const COLOR_CLASS: Record<StatColor, string> = {
  teal:    'text-teal',
  warm:    'text-honey',
  coral:   'text-coral',
  mint:    'text-mint',
  default: 'text-foreground',
};

// Theme tokens, so the line follows light and dark mode.
const SPARKLINE_COLOR: Record<StatColor, string> = {
  teal:    'var(--color-teal)',
  warm:    'var(--color-honey)',
  coral:   'var(--color-coral)',
  mint:    'var(--color-mint)',
  default: 'var(--color-foreground)',
};

const GLOW_CLASS: Record<Exclude<StatColor, 'mint' | 'default'>, string> = {
  teal:  'hero-glow-teal',
  warm:  'hero-glow-warm',
  coral: 'hero-glow-coral',
};

interface StatCardProps {
  label: string;
  value: ReactNode;
  color?: StatColor;
  delta?: { value: number; label?: string; invert?: boolean };
  sparklineData?: number[];
  hero?: boolean;
  subtext?: string;
  className?: string;
  /** Makes the whole tile a link (CardLink treatment). */
  href?: string;
  /** Sparkline size; defaults to the compact 60×24. */
  sparklineSize?: { width: number; height: number };
}

export function StatCard({
  label,
  value,
  color = 'default',
  delta,
  sparklineData,
  hero = false,
  subtext,
  className,
  href,
  sparklineSize,
}: StatCardProps) {
  const glowClass = hero && color in GLOW_CLASS
    ? GLOW_CLASS[color as keyof typeof GLOW_CLASS]
    : undefined;

  const fontSizeClass =
    typeof value === 'string' && value.length >= 10 ? 'text-lg' :
    typeof value === 'string' && value.length >= 8  ? 'text-xl' :
    'text-2xl';

  const card = (
      <Card className={cn(glowClass, 'h-full rounded-lg shadow-none')}>
        {glowClass && <div className="hero-glow-clip" aria-hidden><div className="hero-hairline" /></div>}
        <CardHeader className={cn('pb-1', href && 'pr-10')}>
          <CardTitle className="text-xs font-semibold font-mono uppercase tracking-[0.22em] text-muted">
            {label}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div
                data-testid="stat-value"
                className={cn(fontSizeClass, 'font-bold truncate', COLOR_CLASS[color])}
              >
                {value}
              </div>
              {delta && (
                <div className="mt-1">
                  <DeltaBadge
                    value={delta.value}
                    label={delta.label}
                    invert={delta.invert}
                  />
                </div>
              )}
              {subtext && (
                <p className="text-xs text-muted mt-1">{subtext}</p>
              )}
            </div>
            {sparklineData && (
              <Sparkline
                data={sparklineData}
                color={SPARKLINE_COLOR[color]}
                width={sparklineSize?.width}
                height={sparklineSize?.height}
              />
            )}
          </div>
        </CardContent>
      </Card>
  );

  return href
    ? <CardLink to={href} className={cn(className)}>{card}</CardLink>
    : <div className={cn(className)}>{card}</div>;
}
