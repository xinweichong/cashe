import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

// ── PageCard ──────────────────────────────────────────────────────────────────
interface PageCardProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  headerClassName?: string;
}

export function PageCard({ title, action, children, className, contentClassName, headerClassName }: PageCardProps) {
  return (
    <Card className={cn(className)}>
      <div className={cn('flex flex-row items-center justify-between p-4 gap-2', headerClassName)}>
        <span className="min-w-0 truncate text-base font-semibold text-foreground font-display">{title}</span>
        {action && <div className="shrink-0 ml-2">{action}</div>}
      </div>
      <CardContent className={cn('p-4 pt-0', contentClassName)}>{children}</CardContent>
    </Card>
  );
}

// ── ChartCard ─────────────────────────────────────────────────────────────────
interface ChartCardProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function ChartCard({ title, action, children, className }: ChartCardProps) {
  return (
    <Card className={cn(className)}>
      <div className="flex flex-row items-center justify-between p-4 gap-2">
        <span className="min-w-0 truncate text-base font-semibold text-foreground font-display">{title}</span>
        {action && <div className="shrink-0 ml-2">{action}</div>}
      </div>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

// ── HeroCard ─────────────────────────────────────────────────────────────────
export type GlowColor = 'warm' | 'teal' | 'coral';

const GLOW_CLASS: Record<GlowColor, string> = {
  warm:  'hero-glow-warm',
  teal:  'hero-glow-teal',
  coral: 'hero-glow-coral',
};

interface HeroCardProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  glowColor?: GlowColor;
}

export function HeroCard({ title, action, children, className, glowColor = 'warm' }: HeroCardProps) {
  return (
    <div className={cn('rounded-[24px] p-8', GLOW_CLASS[glowColor], className)}>
      <div className="hero-hairline" aria-hidden />
      <div className="flex flex-row items-center justify-between gap-2 mb-3">
        <span className="text-xs uppercase tracking-[0.22em] text-muted font-semibold font-mono">
          {title}
        </span>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}

// ── HighlightCard ─────────────────────────────────────────────────────────────
interface HighlightCardProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

const HIGHLIGHT_CARD_STYLE: CSSProperties = {
  border: '1px solid rgba(0,212,170,.25)',
  background:
    'radial-gradient(120% 100% at 0% 0%, rgba(0,212,170,.08) 0%, rgba(11,11,20,0) 50%), var(--color-card)',
  boxShadow: '0 0 0 1px rgba(0,212,170,.18), 0 0 36px -8px rgba(0,212,170,.28)',
  borderRadius: '14px',
  padding: '20px',
};

export function HighlightCard({ title, action, children, className }: HighlightCardProps) {
  return (
    <div style={HIGHLIGHT_CARD_STYLE} className={cn(className)}>
      <div className="flex flex-row items-center justify-between gap-2 mb-3">
        <span className="text-xs uppercase tracking-[0.22em] font-semibold font-mono" style={{ color: '#00D4AA' }}>
          {title}
        </span>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}
