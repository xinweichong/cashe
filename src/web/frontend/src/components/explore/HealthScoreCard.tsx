import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { briefingApi, formatMoney } from '@/api/briefing';
import { PageCard } from '@/components/ui/cards';
import { SpectrumCard, SpectrumCardSkeleton } from '@/components/ui/SpectrumCard';
import { cn } from '@/lib/utils';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { Skeleton } from '@/components/ui/skeleton';
import { getGoalTone } from '@/lib/utils';
import { springs } from '@/lib/motionPresets';
import { useChartTheme } from '@/lib/chartTheme';
import { formatRange } from './format';
import { ProgressRing } from '@/components/ui/ProgressRing';

const PILLAR_ORDER = ['savings_rate', 'needs_ratio', 'wants_ratio', 'budget_adherence', 'anomaly_frequency'] as const;

function pillarValue(key: (typeof PILLAR_ORDER)[number], value: number, benchmark?: number | null): string {
  if (key === 'anomaly_frequency') return `${value} ${value === 1 ? 'purchase' : 'purchases'}`;
  if (key === 'budget_adherence') return `${Math.round(value * 100)}% within limit`;
  return `${Math.round(value * 100)}%${benchmark != null ? ` · target ${Math.round(benchmark * 100)}%` : ''}`;
}

function ScoreRing({ score }: { score: number | null }) {
  const { COLOR_TRACK, COLOR_FOREGROUND } = useChartTheme();
  const ringColor = score == null ? COLOR_TRACK : getGoalTone(score).color;
  return (
    <ProgressRing
      percent={score ?? 0} color={ringColor} track={COLOR_TRACK} size={96} radius={40} strokeWidth={6} animated
      role="img" aria-label={`Health score ${score} out of 100`}
    >
      <text x="48" y="54" textAnchor="middle" fontSize="22" fontWeight="700" fill={COLOR_FOREGROUND}>{score}</text>
    </ProgressRing>
  );
}

/**
 * Explore's one spectrum card (P11, 2026-10-01): this month's score and
 * grade; the whole card opens the full breakdown at /explore/health.
 */
export function HealthSpectrum({ className }: { className?: string }) {
  const { data, isError, refetch } = useQuery({
    queryKey: ['health-score-v2', 1],
    queryFn: () => briefingApi.healthScore(1),
    staleTime: 60_000,
  });
  if (isError && !data) {
    return <PageCard title="Financial health" className={className}><div role="alert"><LoadFailed onRetry={() => void refetch()} /></div></PageCard>;
  }
  if (!data) return <SpectrumCardSkeleton className={className} />;
  const score = data.has_income_data ? data.score ?? null : null;
  const label = score != null ? `Financial health ${score} out of 100, ${data.grade}. Open the full breakdown.` : 'Financial health: no score yet. Open for details.';
  return (
    <Link to="/explore/health" aria-label={label}
      className={cn('block rounded-hero pressable-scale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background', className)}>
      <SpectrumCard
        className="h-full"
        label="Health score"
        meta="out of 100"
        value={score ?? '—'}
        valueSuffix={score != null ? data.grade : undefined}
        caption={score != null
          ? `${data.income ? `Spent ${formatMoney(data.spending)} of ${formatMoney(data.income)} income · ` : ''}50/30/20 rule${data.status === 'partial' ? ` · ${data.unresolved_count} left out` : ''}`
          : 'No income recorded this month, so there is no score yet'}
        progress={score != null ? score / 100 : undefined}
        progressLabel="Health score"
        status={data.status === 'partial' ? 'partial' : 'complete'}
      />
    </Link>
  );
}

/** The full 50/30/20 breakdown at /explore/health, from the shared spending facts. */
export function HealthScoreCard() {
  const [months, setMonths] = useState(1);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['health-score-v2', months],
    queryFn: () => briefingApi.healthScore(months),
    staleTime: 60_000,
  });

  const score = data?.score ?? null;

  const monthSelect = (
    <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="select-field text-xs" aria-label="Health score period">
      <option value={1}>This month</option>
      <option value={3}>Last 3 months</option>
      <option value={6}>Last 6 months</option>
    </select>
  );

  const content = isError && !data ? (
    <div role="alert"><LoadFailed onRetry={() => void refetch()} /></div>
  ) : isLoading || !data ? (
    <div role="status"><span className="sr-only">Loading…</span><Skeleton className="h-64" /></div>
  ) : !data.has_income_data ? (
    <div className="py-6 space-y-1">
      <p className="text-sm text-foreground">No income recorded for {formatRange(data.start, data.end)}.</p>
      <p className="text-sm text-muted">The score compares spending with income. Record income with /income in Telegram or add it in Activity.</p>
    </div>
  ) : (
    <div className="space-y-4">
      <div className="flex items-center gap-5">
        <ScoreRing score={score} />
        <div className="min-w-0">
          <p className="text-2xl font-bold text-foreground font-display">{data.grade}</p>
          <p className="text-sm text-muted mt-1">
            {data.income && <>Spent {formatMoney(data.spending)} of {formatMoney(data.income)} income</>}
          </p>
          <p className="text-xs text-muted mt-0.5">{formatRange(data.start, data.end)} · 50/30/20 rule</p>
        </div>
      </div>
      <ul className="space-y-3">
        {PILLAR_ORDER.map((key) => {
          const pillar = data.components[key];
          if (!pillar) return null;
          const pct = pillar.max ? pillar.score / pillar.max : 0;
          const color = getGoalTone(pct * 100).color;
          return (
            <li key={key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 text-sm">
                  <span className="font-medium text-foreground">{pillar.label}</span>
                  <span className="text-xs text-muted font-mono ml-2">{pillarValue(key, pillar.value, pillar.benchmark)}</span>
                </p>
                <span className="text-sm font-semibold tabular-nums font-mono" style={{ color }}>{pillar.score}/{pillar.max}</span>
              </div>
              <div className="h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct * 100}%` }}
                  transition={springs.gentle}
                />
              </div>
              <p className="text-xs text-muted truncate">{pillar.description}</p>
            </li>
          );
        })}
      </ul>
      {data.status === 'partial' && (
        <p className="text-xs text-muted">
          {data.unresolved_count} {data.unresolved_count === 1 ? 'record is' : 'records are'} left out until {data.unresolved_count === 1 ? 'its amount is' : 'their amounts are'} resolved. <Link to="/review" className="text-teal underline-offset-2 hover:underline">Review</Link>
        </p>
      )}
    </div>
  );

  return score != null && score >= 70 ? (
    <PageCard title="Financial health" action={monthSelect}>{content}</PageCard>
  ) : (
    <PageCard title="Financial health" action={monthSelect}>{content}</PageCard>
  );
}
