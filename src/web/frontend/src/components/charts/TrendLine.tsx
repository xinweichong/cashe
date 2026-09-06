import { useId } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { formatCurrency } from '@/lib/utils';
import { formatDateTick, formatDateLabel, useChartTheme } from '@/lib/chartTheme';

interface TrendPoint {
  date: string;
  amount: number;
}

export function TrendLine({ data }: { data: TrendPoint[] }) {
  const { CHART_AXIS_PROPS, CHART_TOOLTIP_STYLE, COLOR_TEAL } = useChartTheme();
  const gradientId = useId().replace(/:/g, '');

  if (!data || data.length === 0) {
    return <div className="w-full h-full min-h-[160px] flex items-center justify-center text-muted text-sm">No trend data</div>;
  }

  return (
    <div className="w-full h-full min-h-[160px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={COLOR_TEAL} stopOpacity={0.3} />
              <stop offset="95%" stopColor={COLOR_TEAL} stopOpacity={0} />
            </linearGradient>
          </defs>
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
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(value) => [formatCurrency(Number(value ?? 0)), 'Spent'] as [string, string]}
            labelFormatter={formatDateLabel}
          />
          <Area
            type="monotone"
            dataKey="amount"
            stroke={COLOR_TEAL}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
