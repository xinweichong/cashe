import { useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { getCategoryColor, formatCurrency, cn } from '@/lib/utils';
import { useChartTheme } from '@/lib/chartTheme';

interface CategoryData {
  category: string;
  total: number;
}

const REMAINING_LABEL = 'Remaining categories';
const REMAINING_COLOR = '#3A3A46'; // COLOR_MUTED_BAR — distinguishable from any real category hue

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
}

export function CategoryDonut({ data, selected, onSelect, onViewTransactions, showLegend = false }: CategoryDonutProps) {
  const { CHART_TOOLTIP_STYLE } = useChartTheme();
  const [remainingExpanded, setRemainingExpanded] = useState(false);

  if (!data || data.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center text-muted text-sm">
        No spending data
      </div>
    );
  }

  const sorted = [...data].sort((a, b) => b.total - a.total);
  const top = sorted.slice(0, 5);
  const rest = sorted.slice(5);
  const remainingTotal = rest.reduce((sum, d) => sum + d.total, 0);
  const total = sorted.reduce((sum, d) => sum + d.total, 0);

  const sliceData: CategoryData[] = rest.length
    ? [...top, { category: REMAINING_LABEL, total: remainingTotal }]
    : top;

  const selectedDatum = selected ? sorted.find((d) => d.category === selected) : undefined;

  function handleSelect(category: string) {
    if (category === REMAINING_LABEL) {
      setRemainingExpanded((v) => !v);
      return;
    }
    onSelect?.(selected === category ? null : category);
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative w-full max-w-[220px] h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
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
          <div className="text-center px-4">
            {selectedDatum ? (
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

      {showLegend && (
        <ul className="w-full space-y-1" data-testid="category-donut-legend">
          {sliceData.map((item) => {
            const isRemaining = item.category === REMAINING_LABEL;
            const isSelected = selected === item.category;
            return (
              <li key={item.category}>
                <button
                  type="button"
                  onClick={() => handleSelect(item.category)}
                  aria-pressed={isRemaining ? undefined : isSelected}
                  aria-expanded={isRemaining ? remainingExpanded : undefined}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-2 min-h-11 text-left transition-colors',
                    isSelected ? 'bg-card-hover' : 'hover:bg-card-hover'
                  )}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: isRemaining ? REMAINING_COLOR : getCategoryColor(item.category) }}
                    aria-hidden
                  />
                  <span className="flex-1 min-w-0 truncate text-sm">{item.category}</span>
                  <span className="text-sm font-mono tabular-nums text-muted">{formatCurrency(item.total)}</span>
                </button>
                {isRemaining && remainingExpanded && (
                  <ul className="pl-6 space-y-1 mt-1">
                    {rest.map((member) => (
                      <li key={member.category}>
                        <button
                          type="button"
                          onClick={() => handleSelect(member.category)}
                          aria-pressed={selected === member.category}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-2 min-h-11 text-left transition-colors',
                            selected === member.category ? 'bg-card-hover' : 'hover:bg-card-hover'
                          )}
                        >
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: getCategoryColor(member.category) }} aria-hidden />
                          <span className="flex-1 min-w-0 truncate text-sm">{member.category}</span>
                          <span className="text-sm font-mono tabular-nums text-muted">{formatCurrency(member.total)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {selectedDatum && onViewTransactions && (
        <button
          type="button"
          onClick={() => onViewTransactions(selectedDatum.category)}
          className="text-sm text-teal min-h-11 inline-flex items-center gap-1 self-start"
        >
          View transactions
        </button>
      )}
    </div>
  );
}
