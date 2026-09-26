import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartCard } from '@/components/ui/cards';
import { useChartMotion, useChartTheme } from '@/lib/chartTheme';
import { formatCurrency } from '@/lib/utils';

// A small single-series SGD bar chart in a card: a detail panel's recent
// history (a merchant's months, a subscription's charges).
export function MiniBarChart({ title, data, xKey, valueKey, valueLabel }: {
  title: string;
  data: object[];
  xKey: string;
  valueKey: string;
  valueLabel: string;
}) {
  const { CHART_AXIS_PROPS, CHART_TOOLTIP_STYLE, CHART_CURSOR_BAR, COLOR_TEAL } = useChartTheme();
  const chartMotion = useChartMotion();
  return (
    <ChartCard title={title}>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <XAxis dataKey={xKey} {...CHART_AXIS_PROPS} />
          <YAxis hide />
          <Tooltip
            formatter={(v) => [formatCurrency(Number(v ?? 0)), valueLabel]}
            contentStyle={CHART_TOOLTIP_STYLE}
            cursor={CHART_CURSOR_BAR}
          />
          <Bar {...chartMotion} dataKey={valueKey} fill={COLOR_TEAL} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
