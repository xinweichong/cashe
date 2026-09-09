import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { formatCurrency, getCategoryColor } from '@/lib/utils';
import { formatDateTick, formatDateLabel, useChartTheme } from '@/lib/chartTheme';

export function CategoryTrendLine({ data }: { data: Record<string, string | number | null>[] }) {
  const { CHART_AXIS_PROPS, CHART_TOOLTIP_STYLE, CHART_CURSOR_LINE, CHART_LEGEND_STYLE } = useChartTheme();
  const categories = useMemo(() => {
    const cats = new Set<string>();
    data.forEach(d => Object.keys(d).filter(k => k !== 'date').forEach(k => cats.add(k)));
    return Array.from(cats).sort();
  }, [data]);

  if (!data || data.length === 0) {
    return <div className="w-full h-full min-h-[160px] flex items-center justify-center text-muted text-sm">No trend data</div>;
  }

  return (
    <div className="w-full h-full min-h-[160px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <XAxis
            dataKey="date"
            {...CHART_AXIS_PROPS}
            tickFormatter={formatDateTick}
          />
          <YAxis
            {...CHART_AXIS_PROPS}
            tickFormatter={(v: number) => `$${v}`}
          />
          <Tooltip
            cursor={CHART_CURSOR_LINE}
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(value: unknown, name: unknown) => [formatCurrency(Number(value ?? 0)), String(name ?? '')]}
            labelFormatter={formatDateLabel}
          />
          <Legend wrapperStyle={{ ...CHART_LEGEND_STYLE, paddingTop: '8px' }} />
          {categories.map((cat) => (
            <Line
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
  );
}
