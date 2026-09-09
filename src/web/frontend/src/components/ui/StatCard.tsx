import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { springs } from '@/lib/motionPresets';
import { DeltaBadge, Sparkline } from '@/lib/animations';

type StatColor = 'teal' | 'warm' | 'coral' | 'mint' | 'default';

const COLOR_CLASS: Record<StatColor, string> = {
  teal:    'text-teal',
  warm:    'text-honey',
  coral:   'text-coral',
  mint:    'text-mint',
  default: 'text-foreground',
};

const SPARKLINE_COLOR: Record<StatColor, string> = {
  teal:    '#00D4AA',
  warm:    '#FBBF24',
  coral:   '#FF6B6B',
  mint:    '#34D399',
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
}: StatCardProps) {
  const glowClass = hero && color in GLOW_CLASS
    ? GLOW_CLASS[color as keyof typeof GLOW_CLASS]
    : undefined;

  const fontSizeClass =
    typeof value === 'string' && value.length >= 10 ? 'text-lg' :
    typeof value === 'string' && value.length >= 8  ? 'text-xl' :
    'text-2xl';

  return (
    <motion.div whileHover={{ y: -2 }} transition={springs.snappy} className={cn(className)}>
      <Card className={cn(glowClass, 'h-full')}>
        {glowClass && <div className="hero-hairline" aria-hidden />}
        <CardHeader className="pb-1">
          <CardTitle className="text-xs font-semibold font-mono uppercase tracking-[0.22em] text-muted">
            {label}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <p
                data-testid="stat-value"
                className={cn(fontSizeClass, 'font-bold truncate', COLOR_CLASS[color])}
              >
                {value}
              </p>
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
              />
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
