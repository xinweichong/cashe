import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { api } from '@/api/client';
import { ChartCard } from '@/components/ui/cards';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { COLOR_CORAL, useChartTheme, CHART_Y_DOMAIN } from '@/lib/chartTheme';

type Mode = '6mo' | '12mo' | 'yoy';

function formatMonth(month: string): string {
  const [year, m] = month.split('-');
  return new Date(Number(year), Number(m) - 1, 1).toLocaleString('default', { month: 'short' });
}

export function IncomeExpenseBar() {
  const { CHART_AXIS_PROPS, CHART_TOOLTIP_STYLE, CHART_CURSOR_BAR, CHART_LEGEND_STYLE, COLOR_TEAL, COLOR_MUTED_BAR } = useChartTheme();
  const [mode, setMode] = useState<Mode>('6mo');
  const isYoY = mode === 'yoy';
  const months = mode === '6mo' ? 6 : 12;

  const { data: standardData, isLoading: standardLoading } = useQuery({
    queryKey: ['income-vs-expense', months],
    queryFn: () => api.getIncomeVsExpense(months),
    enabled: !isYoY,
    staleTime: 60_000,
  });

  const { data: yoyData, isLoading: yoyLoading } = useQuery({
    queryKey: ['analytics-yoy', 12],
    queryFn: () => api.getAnalyticsYoY(12),
    enabled: isYoY,
    staleTime: 60_000,
  });

  const isLoading = isYoY ? yoyLoading : standardLoading;

  const labels: Record<Mode, string> = { '6mo': '6M', '12mo': '12M', yoy: 'YoY' };
  const card = (body: React.ReactNode) => (
    <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
      <ChartCard
        title={title}
        action={
          <TabsList aria-label="Comparison range">
            {(['6mo', '12mo', 'yoy'] as Mode[]).map((m) => <TabsTrigger key={m} value={m}>{labels[m]}</TabsTrigger>)}
          </TabsList>
        }
      >
        <TabsContent value={mode} className="mt-0">{body}</TabsContent>
      </ChartCard>
    </Tabs>
  );

  const title = isYoY
    ? 'Income vs Expenses — Year over Year'
    : `Income vs Expenses — Last ${months === 6 ? '6' : '12'} Months`;

  if (isLoading) {
    return card(<div className="p-4 h-64 flex items-center justify-center text-muted text-sm">Catching up…</div>);
  }

  let chartData: object[] = [];
  if (isYoY && yoyData) {
    chartData = yoyData.map((d) => ({
      month: d.month_label.split(' ')[0],
      'This Year': d.this_year_expenses,
      'Last Year': d.last_year_expenses,
    }));
  } else if (standardData) {
    chartData = standardData.map((d) => ({
      month: formatMonth(d.month),
      Income: d.income,
      Expenses: d.expenses,
    }));
  }

  if (!chartData.length) {
    return card(<div className="p-4 h-64 flex items-center justify-center text-muted text-sm">No data for this period.</div>);
  }

  return card(
      <div className="p-4 w-full h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <XAxis dataKey="month" {...CHART_AXIS_PROPS} />
            <YAxis
              {...CHART_AXIS_PROPS}
              domain={CHART_Y_DOMAIN}
              tickFormatter={(v: number) => `$${v}`}
            />
            <Tooltip
              cursor={CHART_CURSOR_BAR}
              contentStyle={CHART_TOOLTIP_STYLE}
              formatter={(value) =>
                value != null
                  ? `$${Number(value).toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                  : ''
              }
            />
            <Legend wrapperStyle={CHART_LEGEND_STYLE} />
            {isYoY ? (
              <>
                <Bar dataKey="This Year" fill={COLOR_TEAL} radius={[4, 4, 0, 0]} />
                <Bar dataKey="Last Year" fill={COLOR_MUTED_BAR} radius={[4, 4, 0, 0]} />
              </>
            ) : (
              <>
                <Bar dataKey="Income" fill={COLOR_TEAL} radius={[4, 4, 0, 0]} />
                <Bar dataKey="Expenses" fill={COLOR_CORAL} radius={[4, 4, 0, 0]} />
              </>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
  );
}
