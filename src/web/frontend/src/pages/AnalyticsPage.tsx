import { useState } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { PageCard, ChartCard, HighlightCard } from '@/components/ui/cards';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { ComparisonBarChart } from '@/components/charts/ComparisonBarChart';
import { IncomeExpenseBar } from '@/components/charts/IncomeExpenseBar';
import { MerchantTable } from '@/components/charts/MerchantTable';
import { VelocityRing } from '@/components/charts/VelocityRing';
import { api } from '@/api/client';
import type { LLMInsight } from '@/api/client';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency } from '@/lib/utils';
import { AlertTriangle, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { springs } from '@/lib/animations';
import { useChartTheme } from '@/lib/chartTheme';

const PILLAR_ORDER = [
  'savings_rate',
  'needs_ratio',
  'wants_ratio',
  'budget_adherence',
  'anomaly_frequency',
] as const;

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff <= 0) return 'just now';
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function InsightCard({ period, queryFn, emptyLabel }: { period: string; queryFn: () => Promise<LLMInsight>; emptyLabel: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['analytics-insight', period],
    queryFn,
    staleTime: 60 * 60 * 1000,
  });

  if (isLoading) {
    return <div className="h-16 animate-pulse bg-foreground/10 rounded-md" />;
  }

  if (!data?.content) {
    return (
      <p className="text-sm text-muted">
        {emptyLabel}
        {!data?.generated_at && ' Configure gemini_api_key in config.yaml to enable.'}
      </p>
    );
  }

  const generatedLabel = data.generated_at
    ? `Generated ${formatRelativeTime(data.generated_at)}${data.is_stale ? ' · may be stale' : ''}`
    : null;

  return (
    <div className="space-y-3">
      {generatedLabel && (
        <p className="text-xs text-muted">{generatedLabel}</p>
      )}
      <p className="text-sm text-foreground leading-relaxed">
        {data.content.narrative}
      </p>
      {data.content.nudges?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.content.nudges.map((nudge: string, i: number) => (
            <span
              key={i}
              className="px-2.5 py-1 text-xs rounded-full border border-teal/40 text-teal bg-teal/5"
            >
              {nudge}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AIInsightsCard() {
  const [tab, setTab] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  const tabs = [
    { key: 'daily' as const, label: 'Daily', queryFn: () => api.getAnalyticsInsight(), emptyLabel: 'No insight yet — generated daily at 8am.' },
    { key: 'weekly' as const, label: 'Weekly', queryFn: () => api.getWeeklyInsight(), emptyLabel: 'No archived weekly insight.' },
    { key: 'monthly' as const, label: 'Monthly', queryFn: () => api.getMonthlyInsight(), emptyLabel: 'No archived monthly insight.' },
  ];

  const activeTab = tabs.find(t => t.key === tab)!;

  const tabSelector = (
    <div className="flex rounded-md border border-border overflow-hidden">
      {tabs.map((t, i) => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          className={`px-2.5 py-1 text-xs transition-colors ${
            i > 0 ? 'border-l border-border' : ''
          } ${
            tab === t.key
              ? 'bg-foreground/10 text-foreground font-medium'
              : 'text-muted hover:text-foreground'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  return (
    <PageCard title="AI Insights" action={tabSelector}>
      {tab !== 'daily' && <p className="text-sm text-muted mb-3">Archived AI text; no longer refreshed. Current spending facts are available in Home and Telegram summaries.</p>}
      <InsightCard period={tab} queryFn={activeTab.queryFn} emptyLabel={activeTab.emptyLabel} />
    </PageCard>
  );
}

function HealthScoreBreakdown() {
  const { COLOR_TRACK, COLOR_FOREGROUND } = useChartTheme();
  const [months, setMonths] = useState(1);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['health-score', months],
    queryFn: () => api.getHealthScore(months),
    staleTime: 60_000,
  });

  const score = data?.score ?? null;
  const isHighlighted = score != null && score >= 70;
  const ringColor =
    !score ? COLOR_TRACK :
    score >= 80 ? '#30D158' :
    score >= 60 ? '#64D2FF' :
    score >= 40 ? '#FFD60A' :
    '#FF453A';

  const r = 40;
  const circ = 2 * Math.PI * r;
  const filled = score != null ? (score / 100) * circ : 0;
  const strokeDashoffset = circ - filled;

  const monthSelect = (
    <select
      value={months}
      onChange={(e) => setMonths(Number(e.target.value))}
      className="select-field text-xs"
    >
      <option value={1}>This month</option>
      <option value={3}>Last 3 months</option>
      <option value={6}>Last 6 months</option>
    </select>
  );

  const scoreContent = isError ? (
    <LoadFailed onRetry={() => refetch()} />
  ) : isLoading ? (
    <Skeleton className="h-48" />
  ) : !data?.has_income_data ? (
    <div className="py-8 text-center">
      <p className="text-muted text-sm">No income transactions found for this period.</p>
      <p className="text-muted/60 text-xs mt-1">Add income transactions to calculate your health score.</p>
    </div>
  ) : (
    <div className="space-y-6">
      {/* Score header */}
      <div className="flex items-center gap-6">
        <svg width="96" height="96" className="shrink-0">
          <circle cx="48" cy="48" r={r} fill="none" stroke={COLOR_TRACK} strokeWidth="6" />
          <motion.circle
            cx="48" cy="48" r={r} fill="none"
            stroke={ringColor}
            strokeWidth="6"
            strokeDasharray={circ}
            strokeLinecap="round"
            transform="rotate(-90 48 48)"
            initial={{ strokeDashoffset: circ }}
            animate={{ strokeDashoffset }}
            transition={springs.gentle}
          />
          <text x="48" y="52" textAnchor="middle" fontSize="20" fontWeight="700" fill={COLOR_FOREGROUND}>
            {score}
          </text>
        </svg>
        <div>
          <p className="text-2xl font-bold text-foreground">{data.grade}</p>
          <p className="text-xs font-semibold font-mono uppercase tracking-[0.22em] text-muted mt-1">Score for {data.period}</p>
          <p className="text-xs text-muted/70 mt-0.5">Based on the 50/30/20 rule</p>
        </div>
      </div>

      {/* Pillar breakdown */}
      <div className="space-y-4">
        {PILLAR_ORDER.map((key) => {
          const comp = data.components[key];
          if (!comp) return null;
          const pct = comp.score / comp.max;
          const barColor =
            pct >= 0.8  ? '#30D158' :
            pct >= 0.5  ? '#64D2FF' :
            pct >= 0.25 ? '#FFD60A' :
            '#FF453A';

          // Format the value label
          let valueLabel = '';
          if (key === 'anomaly_frequency') {
            valueLabel = `${comp.value} anomalies`;
          } else if (key === 'budget_adherence') {
            valueLabel = `${Math.round(comp.value * 100)}% within limit`;
          } else {
            const benchmarkStr = comp.benchmark != null ? ` / target ${Math.round(comp.benchmark * 100)}%` : '';
            valueLabel = `${Math.round((comp.value as number) * 100)}%${benchmarkStr}`;
          }

          return (
            <div key={key} className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <div>
                  <span className="text-sm font-medium text-foreground">{comp.label}</span>
                  <span className="text-xs text-muted font-mono ml-2">{valueLabel}</span>
                </div>
                <span className="text-sm font-semibold tabular-nums" style={{ color: barColor }}>
                  {comp.score}/{comp.max}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: barColor }}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct * 100}%` }}
                  transition={springs.gentle}
                />
              </div>
              <p className="text-xs text-muted/70">{comp.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );

  return isHighlighted ? (
    <HighlightCard title="Financial Health" action={monthSelect}>
      {scoreContent}
    </HighlightCard>
  ) : (
    <PageCard title="Financial Health Score" action={monthSelect}>
      {scoreContent}
    </PageCard>
  );
}

export function AnalyticsPage() {
  const { data: comparison } = useQuery({
    queryKey: ['analytics-comparison'],
    queryFn: () => api.getAnalyticsComparison('month'),
  });

  const { data: merchants } = useQuery({
    queryKey: ['analytics-merchants'],
    queryFn: () => api.getAnalyticsMerchants(10),
  });

  const { data: velocity } = useQuery({
    queryKey: ['analytics-velocity'],
    queryFn: () => api.getAnalyticsVelocity(),
  });

  const { data: alerts } = useQuery({
    queryKey: ['analytics-alerts'],
    queryFn: () => api.getAnalyticsAlerts(),
  });

  const hasAlerts = (alerts?.anomalies?.length ?? 0) > 0 || (alerts?.new_merchants?.length ?? 0) > 0;

  const comparisonBadge = comparison?.overall && (
    <Badge variant="outline" className="border-border text-xs">
      <TrendingUp className="w-3 h-3 mr-1" />
      {comparison.overall.change_percent != null
        ? `${comparison.overall.change_percent > 0 ? '+' : ''}${comparison.overall.change_percent}%`
        : 'New'}
    </Badge>
  );

  return (
    <div className="p-4 space-y-4 md:h-full md:overflow-hidden md:grid md:gap-4 md:p-6 md:space-y-0 page-grid-analytics">

      {/* ── Header area ── */}
      <div className="area-header">
        <div className="flex flex-col gap-1 pb-5 border-b border-border">
          <div className="text-xs uppercase tracking-[0.22em] text-muted font-mono font-semibold">
            Analytics
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground font-display">
            Spending velocity, patterns, comparisons.
          </h1>
        </div>
      </div>

      {/* ── AI Insights — full-width ── */}
      <div className="area-insight">
        <AIInsightsCard />
      </div>

      {/* ── Left panel: health score + alerts ── */}
      <div className="area-left grid-scroll-panel space-y-4">
        <HealthScoreBreakdown />

        {hasAlerts && (
          <Card className="p-4 border-tangerine/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-tangerine shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs text-muted mb-2">
                  Unusual = transaction is over 2× the category average (last 30 days, min 3 transactions).
                  New merchant = first appearance this month.
                </p>
                {alerts.anomalies?.map((a: any) => (
                  <div key={a.id} className="space-y-0.5">
                    <p className="text-sm">
                      Unusual: <span className="font-medium">{a.merchant}</span>{' '}
                      {formatCurrency(a.amount)} in {a.category}
                    </p>
                    {a.explanation && (
                      <p className="text-xs text-muted italic">{a.explanation}</p>
                    )}
                  </div>
                ))}
                {alerts.new_merchants?.slice(0, 3).map((m: any) => (
                  <p key={m.merchant} className="text-sm flex items-center gap-2">
                    <Badge variant="default" className="text-[10px] px-1.5 py-0">New</Badge>
                    <span className="font-medium">{m.merchant}</span>
                  </p>
                ))}
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* ── Right panel: charts + merchants + income bar ── */}
      <div className="area-right grid-scroll-panel space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Period Comparison" action={comparisonBadge}>
            <div className="p-4">
              {comparison?.categories && (
                <ComparisonBarChart data={comparison.categories} />
              )}
            </div>
          </ChartCard>

          <PageCard title="Spending Velocity">
            {velocity && <VelocityRing data={velocity} />}
          </PageCard>
        </div>

        <PageCard title="Top Merchants This Month">
          <MerchantTable data={merchants?.top ?? []} />
        </PageCard>

        <IncomeExpenseBar />
      </div>

    </div>
  );
}
