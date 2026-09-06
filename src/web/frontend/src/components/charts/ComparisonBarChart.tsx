import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { formatCurrency } from '@/lib/utils';
import { useChartTheme } from '@/lib/chartTheme';

interface ComparisonData {
  category: string;
  current: number;
  previous: number;
}

export function ComparisonBarChart({ data }: { data: ComparisonData[] }) {
  const { CHART_AXIS_PROPS, CHART_TOOLTIP_STYLE, CHART_CURSOR_BAR, CHART_LEGEND_STYLE, COLOR_TEAL, COLOR_MUTED_BAR } = useChartTheme();
  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <XAxis
            dataKey="category"
            {...CHART_AXIS_PROPS}
            tickFormatter={(v: string) => v.replace(/\s*[\u{1F000}-\u{1FFFF}]/gu, '').trim()}
          />
          <YAxis
            {...CHART_AXIS_PROPS}
            tickFormatter={(v: number) => `$${v}`}
          />
          <Tooltip
            cursor={CHART_CURSOR_BAR}
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(value) => value != null ? formatCurrency(Number(value)) : ''}
          />
          <Legend wrapperStyle={CHART_LEGEND_STYLE} />
          <Bar dataKey="current" name="This period" fill={COLOR_TEAL} radius={[4, 4, 0, 0]} />
          <Bar dataKey="previous" name="Last period" fill={COLOR_MUTED_BAR} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
