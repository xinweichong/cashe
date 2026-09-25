import { useId } from 'react';
import { useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Dot,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatShortDate } from '@/lib/utils';
import { formatDateTick, formatDateLabel, useChartTheme, CHART_Y_DOMAIN } from '@/lib/chartTheme';

interface TrendPoint {
  date: string;
  amount: number;
}

interface TrendLineProps {
  data: TrendPoint[];
  /** Selected day's date (matches a point's `date`). Defaults to the last point when omitted. */
  selectedDate?: string | null;
  /** Fires on chart-point click/keyboard day-step — the same handler drives both. */
  onSelectDate?: (date: string) => void;
  /** Plot height in px; the phone Trend lens passes a shorter plot. */
  chartHeight?: number;
  /** Grow the plot to fill the parent's height (chartHeight becomes the floor). */
  fill?: boolean;
}

export function TrendLine({ data, selectedDate, onSelectDate, chartHeight = 160, fill = false }: TrendLineProps) {
  const { CHART_AXIS_PROPS, CHART_TOOLTIP_STYLE, COLOR_TEAL } = useChartTheme();
  const gradientId = useId().replace(/:/g, '');
  // Recharts' Area animates its draw-in on its own JS timer, independent of
  // the CSS-level reduced-motion override in index.css.
  const reduceMotion = useReducedMotion();

  if (!data || data.length === 0) {
    return <div className="w-full h-full min-h-[160px] flex items-center justify-center text-muted text-sm">No trend data</div>;
  }

  const activeDate = selectedDate ?? data[data.length - 1].date;
  const activeIndex = data.findIndex((d) => d.date === activeDate);
  const activePoint = activeIndex >= 0 ? data[activeIndex] : data[data.length - 1];

  function step(delta: number) {
    if (!onSelectDate) return;
    const next = data[Math.min(data.length - 1, Math.max(0, activeIndex + delta))];
    if (next) onSelectDate(next.date);
  }

  return (
    <div className={fill ? 'w-full h-full flex flex-col' : 'w-full'}>
      <div className={fill ? 'w-full flex-1 min-h-0' : 'w-full h-full'} style={{ minHeight: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%" minHeight={chartHeight}>
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
              domain={CHART_Y_DOMAIN}
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
              isAnimationActive={!reduceMotion}
              activeDot={onSelectDate ? {
                r: 5,
                // Recharts' DotProps type omits `payload` even though it spreads the
                // point's data onto the active dot at runtime.
                onClick: (props: unknown) => {
                  const date = (props as { payload?: TrendPoint })?.payload?.date;
                  if (date) onSelectDate(date);
                },
                style: { cursor: 'pointer' },
              } : undefined}
              dot={onSelectDate ? (props: { cx?: number; cy?: number; payload?: TrendPoint; index?: number }) =>
                props.payload?.date === activeDate ? (
                  <Dot key={props.index} cx={props.cx} cy={props.cy} r={4} fill={COLOR_TEAL} stroke="var(--color-card)" strokeWidth={2} />
                ) : (
                  <g key={props.index} />
                )
              : false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {onSelectDate && (
        <div className="flex items-center justify-between gap-2 mt-2" data-testid="trend-day-readout">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => step(-1)}
            disabled={activeIndex <= 0}
            aria-label="Previous day"
          >
            <ChevronLeft size={16} aria-hidden />
          </Button>
          <p className="text-sm font-mono tabular-nums text-center">
            {formatShortDate(activePoint.date)} · <span className="font-semibold text-foreground">{formatCurrency(activePoint.amount)}</span>
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => step(1)}
            disabled={activeIndex === -1 || activeIndex >= data.length - 1}
            aria-label="Next day"
          >
            <ChevronRight size={16} aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}
