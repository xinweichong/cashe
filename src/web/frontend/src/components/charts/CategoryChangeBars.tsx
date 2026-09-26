import { getCategoryColor, cn } from '@/lib/utils';
import { formatMoney, type Money } from '@/api/briefing';

interface CategoryChangeDatum {
  category: string;
  change: Money;
}

interface CategoryChangeBarRowProps {
  datum: CategoryChangeDatum;
  /** Largest |change| among the sibling rows sharing this scale — pass the same value to every row in a group so magnitudes stay comparable. */
  max: number;
  selected?: boolean;
  onSelect: (category: string) => void;
}

/**
 * One signed category-change bar, centred on a zero baseline — docs/design-
 * language.md's "Ranked category changes" upgrade. Category hue supplies
 * identity; left/right position and the +/− sign supply decrease/increase,
 * never colour alone (bar magnitude is absolute either side of centre).
 * Exported standalone (not just via CategoryChangeBars below) so a caller
 * that needs to interleave per-item content — Home's evidence links — can
 * still share this row's rendering instead of re-implementing it.
 */
export function CategoryChangeBarRow({ datum, max, selected, onSelect }: CategoryChangeBarRowProps) {
  const widthPct = (Math.abs(datum.change.minor_units) / max) * 50;
  const isIncrease = datum.change.minor_units >= 0;
  return (
    <button
      type="button"
      onClick={() => onSelect(datum.category)}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-center gap-2 min-h-11 px-2 py-1 rounded-md text-left',
        selected ? 'bg-card-hover' : 'hover:bg-card-hover'
      )}
    >
      <span className="w-28 shrink-0 text-sm truncate">{datum.category}</span>
      <span className="relative flex-1 h-4">
        <span className="absolute left-1/2 top-0 bottom-0 w-px bg-border" aria-hidden />
        <span
          className="absolute top-0.5 h-3 rounded-sm"
          style={{
            background: getCategoryColor(datum.category),
            width: `${widthPct}%`,
            left: isIncrease ? '50%' : `${50 - widthPct}%`,
          }}
          aria-hidden
        />
      </span>
      <span className={cn('w-24 shrink-0 text-sm font-mono tabular-nums text-right', isIncrease ? 'text-coral' : 'text-teal')}>
        {isIncrease ? '+' : '−'}{formatMoney({ ...datum.change, minor_units: Math.abs(datum.change.minor_units) })}
      </span>
    </button>
  );
}

interface CategoryChangeBarsProps {
  data: CategoryChangeDatum[];
  selected?: string | null;
  onSelect: (category: string) => void;
}

export function CategoryChangeBars({ data, selected, onSelect }: CategoryChangeBarsProps) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => Math.abs(d.change.minor_units)), 1);
  return (
    <ul className="space-y-2" data-testid="category-change-bars">
      {data.map((d) => (
        <li key={d.category}>
          <CategoryChangeBarRow datum={d} max={max} selected={selected === d.category} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}
