import { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { cn, getCategoryColor, formatCurrency } from '@/lib/utils';
import { SelectableRow } from '@/components/ui/selectable-row';
import { Button } from '@/components/ui/button';
import { useChartMotion, useChartTheme } from '@/lib/chartTheme';

interface CategoryData {
  category: string;
  total: number;
}

const REMAINING_LABEL = 'Remaining categories';

interface CategoryDonutProps {
  data: CategoryData[];
  /** Currently selected category name, or null/undefined for the neutral "Spending mix" state. */
  selected?: string | null;
  onSelect?: (category: string | null) => void;
  onViewTransactions?: (category: string) => void;
  /**
   * Ranked, selectable legend below the chart, with a presentation-only
   * "Remaining categories" group for anything past the top 5. Off by default
   * so the legacy Overview donut (no legend caller today) is unaffected.
   */
  showLegend?: boolean;
  /** 'row' sets the legend beside the chart from `sm` up (stacked below it on phones). */
  layout?: 'stacked' | 'row';
  /**
   * 'compact' is the phone glance: a 112px ring always beside a top-3 legend,
   * no remaining-group expansion and no inline "View transactions" (the
   * caller opens a DrillSheet from onSelect instead).
   */
  size?: 'default' | 'compact';
}

export function CategoryDonut({ data, selected, onSelect, onViewTransactions, showLegend = false, layout = 'stacked', size = 'default' }: CategoryDonutProps) {
  const compact = size === 'compact';
  // The muted bar colour is distinguishable from any real category hue.
  const { CHART_TOOLTIP_STYLE, COLOR_MUTED_BAR: REMAINING_COLOR } = useChartTheme();
  const [remainingExpanded, setRemainingExpanded] = useState(false);
  // Recharts' Pie animates its sweep on its own JS timer, independent of the
  // CSS-level reduced-motion override in index.css — must be wired here
  // explicitly or reduced-motion users still get the animated draw-in.
  const chartMotion = useChartMotion();

  // Memoised on `data` so a parent re-render (a lens switch, a selection)
  // hands Recharts the same slice array and the sweep never replays.
  const { sorted, top, rest, total, sliceData } = useMemo(() => {
    const sorted = [...(data ?? [])].sort((a, b) => b.total - a.total);
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5);
    const remainingTotal = rest.reduce((sum, d) => sum + d.total, 0);
    const total = sorted.reduce((sum, d) => sum + d.total, 0);
    const sliceData: CategoryData[] = rest.length
      ? [...top, { category: REMAINING_LABEL, total: remainingTotal }]
      : top;
    return { sorted, top, rest, total, sliceData };
  }, [data]);

  if (!data || data.length === 0) {
    return (
      <div className={cn('flex items-center justify-center text-muted text-sm', compact ? 'h-[112px]' : 'h-[220px]')}>
        No spending data
      </div>
    );
  }

  const selectedDatum = selected ? sorted.find((d) => d.category === selected) : undefined;

  function handleSelect(category: string) {
    if (category === REMAINING_LABEL) {
      setRemainingExpanded((v) => !v);
      return;
    }
    onSelect?.(selected === category ? null : category);
  }

  return (
    <div className={cn(compact ? 'flex flex-row items-center gap-3' : 'flex flex-col items-center gap-6', !compact && layout === 'row' && 'sm:flex-row sm:items-center')}>
      <div className={cn(compact ? 'relative w-[112px] h-[112px] shrink-0' : 'relative w-full max-w-[220px] h-[220px]', !compact && layout === 'row' && 'shrink-0')}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              {...chartMotion}
              data={sliceData}
              dataKey="total"
              nameKey="category"
              cx="50%"
              cy="50%"
              innerRadius="60%"
              outerRadius="85%"
              paddingAngle={2}
              strokeWidth={0}
              onClick={(entry: { category?: string; payload?: CategoryData }) => {
                const category = entry.category ?? entry.payload?.category;
                if (category) handleSelect(category);
              }}
              className="cursor-pointer"
            >
              {sliceData.map((entry) => (
                <Cell
                  key={entry.category}
                  fill={entry.category === REMAINING_LABEL ? REMAINING_COLOR : getCategoryColor(entry.category)}
                  opacity={selected && selected !== entry.category ? 0.45 : 1}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={CHART_TOOLTIP_STYLE}
              formatter={(value, name) => [formatCurrency(Number(value ?? 0)), name]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className={cn('text-center', compact ? 'px-2' : 'px-4')}>
            {compact ? (
              <p className="text-2xs font-mono uppercase tracking-[0.18em] text-muted truncate max-w-[72px]">{selectedDatum ? `${total > 0 ? Math.round((selectedDatum.total / total) * 100) : 0}%` : 'Mix'}</p>
            ) : selectedDatum ? (
              <>
                <p className="text-2xs font-mono uppercase tracking-[0.22em] text-muted truncate max-w-[140px]">{selectedDatum.category}</p>
                <p className="text-xl font-bold font-display">{formatCurrency(selectedDatum.total)}</p>
                <p className="text-2xs text-muted">{total > 0 ? Math.round((selectedDatum.total / total) * 100) : 0}% of spending</p>
              </>
            ) : (
              <>
                <p className="text-xl font-bold font-display">{formatCurrency(total)}</p>
                <p className="text-xs text-muted">Spending mix</p>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="w-full min-w-0 flex flex-col gap-6">
      {showLegend && (
        <ul className="w-full space-y-1" data-testid="category-donut-legend">
          {(compact ? top.slice(0, 3) : sliceData).map((item) => {
            const isRemaining = item.category === REMAINING_LABEL;
            const isSelected = selected === item.category;
            return (
              <li key={item.category}>
                <SelectableRow
                  onClick={() => handleSelect(item.category)}
                  selected={isSelected}
                  aria-expanded={isRemaining ? remainingExpanded : undefined}
                  className={compact ? 'px-2 py-1.5' : undefined}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: isRemaining ? REMAINING_COLOR : getCategoryColor(item.category) }}
                    aria-hidden
                  />
                  <span className="flex-1 min-w-0 truncate text-sm">{item.category}</span>
                  <span className="text-sm font-mono tabular-nums text-muted">{formatCurrency(item.total)}</span>
                </SelectableRow>
                {isRemaining && remainingExpanded && (
                  <ul className="pl-6 space-y-1 mt-1">
                    {rest.map((member) => (
                      <li key={member.category}>
                        <SelectableRow onClick={() => handleSelect(member.category)} selected={selected === member.category}>
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: getCategoryColor(member.category) }} aria-hidden />
                          <span className="flex-1 min-w-0 truncate text-sm">{member.category}</span>
                          <span className="text-sm font-mono tabular-nums text-muted">{formatCurrency(member.total)}</span>
                        </SelectableRow>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!compact && selectedDatum && onViewTransactions && (
        <Button type="button" variant="link" size="sm" className="h-auto min-h-11 self-start p-0" onClick={() => onViewTransactions(selectedDatum.category)}>
          View transactions
        </Button>
      )}
      </div>
    </div>
  );
}
