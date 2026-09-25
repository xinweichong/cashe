import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { briefingApi, formatMoney } from '@/api/briefing';
import { ChartCard } from '@/components/ui/cards';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CHART_MOTION, COLOR_CORAL, useChartTheme } from '@/lib/chartTheme';

type Mode = '6mo' | '12mo' | 'yoy';
const LABELS: Record<Mode, string> = { '6mo': '6M', '12mo': '12M', yoy: 'YoY' };

function monthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number);
  return new Date(year, m - 1, 1).toLocaleString('en-SG', { month: 'short' });
}

/**
 * Monthly spending against income (or against the same month a year
 * earlier), from the shared spending facts. A month without income records
 * shows no income bar rather than a fabricated zero.
 */
export function IncomeExpenseBar() {
  const { CHART_AXIS_PROPS, CHART_TOOLTIP_STYLE, CHART_CURSOR_BAR, CHART_LEGEND_STYLE, COLOR_TEAL, COLOR_MUTED_BAR } = useChartTheme();
  const [mode, setMode] = useState<Mode>('6mo');
  const months = mode === '6mo' ? 6 : mode === '12mo' ? 12 : 24;
  const { data, isError, refetch } = useQuery({
    queryKey: ['spending-monthly', months],
    queryFn: () => briefingApi.monthly(months),
    staleTime: 60_000,
  });

  const isYoY = mode === 'yoy';
  const shown = data ? (isYoY ? data.slice(-12) : data) : [];
  const chartData = shown.map((flow, i) => isYoY
    ? { month: monthLabel(flow.month), 'This year': flow.spending.minor_units / 100, 'Year before': data![i].spending.minor_units / 100 }
    : { month: monthLabel(flow.month), Income: flow.income ? flow.income.minor_units / 100 : null, Spending: flow.spending.minor_units / 100 });
  const partial = (isYoY ? data ?? [] : shown).filter((flow) => flow.status === 'partial');
  const current = data?.[data.length - 1];

  const body = isError && !data ? (
    <div role="alert" className="p-4 pt-0"><LoadFailed onRetry={() => void refetch()} /></div>
  ) : !data ? (
    <div role="status" className="p-4 pt-0"><span className="sr-only">Loading…</span><Skeleton className="h-64 w-full" /></div>
  ) : (
    <div className="px-4 pb-4">
      <div className="w-full h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
            <XAxis dataKey="month" {...CHART_AXIS_PROPS} />
            <YAxis {...CHART_AXIS_PROPS} domain={[0, 'auto']} tickCount={5} allowDecimals={false} tickFormatter={(v: number) => (v >= 1000 ? `$${v / 1000}k` : `$${v}`)} />
            <Tooltip
              cursor={CHART_CURSOR_BAR}
              contentStyle={CHART_TOOLTIP_STYLE}
              formatter={(value) => value != null ? formatMoney({ minor_units: Math.round(Number(value) * 100), currency: 'SGD' }) : 'None recorded'}
            />
            <Legend wrapperStyle={CHART_LEGEND_STYLE} />
            {isYoY ? (
              <>
                <Bar {...CHART_MOTION} dataKey="This year" fill={COLOR_CORAL} radius={[4, 4, 0, 0]} />
                <Bar {...CHART_MOTION} dataKey="Year before" fill={COLOR_MUTED_BAR} radius={[4, 4, 0, 0]} />
              </>
            ) : (
              <>
                <Bar {...CHART_MOTION} dataKey="Income" fill={COLOR_TEAL} radius={[4, 4, 0, 0]} />
                <Bar {...CHART_MOTION} dataKey="Spending" fill={COLOR_CORAL} radius={[4, 4, 0, 0]} />
              </>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted mt-2">
        {current && `${monthLabel(current.month)} runs to date.`}
        {!!partial.length && ` ${partial.map((flow) => monthLabel(flow.month)).join(', ')} ${partial.length === 1 ? 'has' : 'have'} records left out until their amounts are resolved.`}
      </p>
    </div>
  );

  return (
    <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
      <ChartCard
        title={isYoY ? 'Spending, year over year' : 'Income vs. spending'}
        action={
          <TabsList aria-label="Comparison range">
            {(['6mo', '12mo', 'yoy'] as Mode[]).map((m) => <TabsTrigger key={m} value={m}>{LABELS[m]}</TabsTrigger>)}
          </TabsList>
        }
      >
        <TabsContent value={mode} className="mt-0">{body}</TabsContent>
      </ChartCard>
    </Tabs>
  );
}
