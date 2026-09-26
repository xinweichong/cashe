import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { formatCurrency, formatShortDate, getCategoryColor } from '@/lib/utils';
import { formatDateTick, formatDateLabel, useChartTheme, useChartMotion, CHART_Y_DOMAIN } from '@/lib/chartTheme';
import { DayStepper, NoTrendData } from './DayStepper';

interface CategoryTrendLineProps {
  data: Record<string, string | number | null>[];
  /** Selected day (a point's `date`); enables the same tap/step selection as TrendLine. */
  selectedDate?: string | null;
  onSelectDate?: (date: string) => void;
}

export function CategoryTrendLine({ data, selectedDate, onSelectDate }: CategoryTrendLineProps) {
  const { CHART_AXIS_PROPS, CHART_TOOLTIP_STYLE, CHART_CURSOR_LINE, CHART_LEGEND_STYLE, COLOR_MUTED_BAR } = useChartTheme();
  // Recharts' Line animates its draw-in on its own JS timer, independent of
  // the CSS-level reduced-motion override in index.css.
  const chartMotion = useChartMotion();
  const categories = useMemo(() => {
    const cats = new Set<string>();
    data.forEach(d => Object.keys(d).filter(k => k !== 'date').forEach(k => cats.add(k)));
    return Array.from(cats).sort();
  }, [data]);

  if (!data || data.length === 0) {
    return <NoTrendData />;
  }

  const activeIndex = selectedDate ? data.findIndex((d) => d.date === selectedDate) : -1;
  const dayTotal = (point: Record<string, string | number | null>) =>
    categories.reduce((sum, cat) => sum + Number(point[cat] ?? 0), 0);
  function step(delta: number) {
    if (!onSelectDate) return;
    const from = activeIndex === -1 ? data.length : activeIndex;
    const next = data[Math.min(data.length - 1, Math.max(0, from + delta))];
    if (next) onSelectDate(String(next.date));
  }

  return (
    <div className="w-full h-full min-h-[160px] flex flex-col">
      <div className="flex-1 min-h-[160px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
          onClick={onSelectDate ? (state) => { if (state?.activeLabel) onSelectDate(String(state.activeLabel)); } : undefined}
        >
          <XAxis
            dataKey="date"
            {...CHART_AXIS_PROPS}
            tickFormatter={formatDateTick}
          />
          <YAxis
            {...CHART_AXIS_PROPS}
            domain={CHART_Y_DOMAIN}
            tickFormatter={(v: number) => `$${v}`}
          />
          <Tooltip
            cursor={CHART_CURSOR_LINE}
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(value: unknown, name: unknown) => [formatCurrency(Number(value ?? 0)), String(name ?? '')]}
            labelFormatter={formatDateLabel}
          />
          <Legend wrapperStyle={{ ...CHART_LEGEND_STYLE, paddingTop: '8px' }} />
          {activeIndex >= 0 && <ReferenceLine x={String(data[activeIndex].date)} stroke={COLOR_MUTED_BAR} strokeDasharray="3 3" />}
          {categories.map((cat) => (
            <Line
              {...chartMotion}
              key={cat}
              type="monotone"
              dataKey={cat}
              stroke={getCategoryColor(cat)}
              strokeWidth={2}
              dot={{ r: 2, fill: getCategoryColor(cat) }}
              activeDot={{ r: 4 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      </div>
      {onSelectDate && (
        <DayStepper
          testId="category-trend-day-readout"
          canPrev={activeIndex !== 0}
          canNext={activeIndex !== -1 && activeIndex < data.length - 1}
          onStep={step}
        >
          {activeIndex >= 0
            ? <>{formatShortDate(String(data[activeIndex].date))} · <span className="font-semibold text-foreground">{formatCurrency(dayTotal(data[activeIndex]))}</span> charted</>
            : <span className="text-muted">Select a day to break it down</span>}
        </DayStepper>
      )}
    </div>
  );
}
