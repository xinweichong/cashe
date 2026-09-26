import { cn } from '@/lib/utils';
import { WARM_GRADIENT } from '@/components/ui/Brand';
import { formatMoney, type Money } from '@/api/briefing';

interface HeroAmountProps {
  value: Money;
  className?: string;
}

/**
 * The one gradient, display-size hero numeric — docs/design-language.md §7.
 * Consumes the existing formatted-money contract (formatMoney); never
 * recomputes or re-derives the amount itself. Screen readers get the plain
 * formatted text — the gradient is a background-clip on real DOM text, not
 * an image, so no separate accessible label is needed.
 */
export function HeroAmount({ value, className }: HeroAmountProps) {
  return (
    <p
      className={cn(
        'font-display text-5xl md:text-6xl font-bold tracking-tight tabular-nums',
        'bg-clip-text text-transparent',
        className
      )}
      style={{ backgroundImage: WARM_GRADIENT }}
    >
      {formatMoney(value)}
    </p>
  );
}
