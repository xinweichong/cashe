import { useMemo, useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { usePeriod, type Period } from '@/hooks/usePeriod';
import { useSummary, useTrend, useTrendByCategory, useBalance } from '@/hooks/useCategories';
import { useTransactions } from '@/hooks/useTransactions';
import { api, type Transaction, type BudgetProgress, type GoalProgress } from '@/api/client';
import { formatCurrency, formatCurrencyWhole, formatDate, getCategoryColor, cn } from '@/lib/utils';
import { CategoryDonut } from '@/components/charts/CategoryDonut';
import { TrendLine } from '@/components/charts/TrendLine';
import { CategoryTrendLine } from '@/components/charts/CategoryTrendLine';
import { TransactionRow } from '@/components/transactions/TransactionRow';
import { PageCard, HeroCard, HighlightCard } from '@/components/ui/cards';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { ActiveTripCard } from '@/components/trips/ActiveTripCard';
import { springs, staggerContainerVariants, staggerItemVariants } from '@/lib/motionPresets';
import { AnimatedCurrency } from '@/lib/animations';
import { COLOR_HONEY, COLOR_TANGERINE, COLOR_CORAL, useChartTheme } from '@/lib/chartTheme';

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDateRange(date: string, period: Period): { start: string; end: string } {
  const [y, m, dd] = date.split('-').map(Number);
  const d = new Date(y, m - 1, dd);
  if (period === 'day') {
    return { start: date, end: date };
  }
  if (period === 'week') {
    const dayOfWeek = d.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(d);
    monday.setDate(d.getDate() + mondayOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: toDateStr(monday), end: toDateStr(sunday) };
  }
  // month
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: toDateStr(first), end: toDateStr(last) };
}

function getRangeLabel(date: string, period: Period): string {
  const [y, m, dd] = date.split('-').map(Number);
  const d = new Date(y, m - 1, dd);
  if (period === 'day') {
    return d.toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
  if (period === 'week') {
    const { start, end } = getDateRange(date, period);
    return `${formatDate(start)} - ${formatDate(end)}`;
  }
  return d.toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });
}

const PERIOD_OPTIONS: Period[] = ['day', 'week', 'month'];

function HealthScoreCard() {
  const { COLOR_TRACK, COLOR_FOREGROUND } = useChartTheme();
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['health-score'],
    queryFn: () => api.getHealthScore(1),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <Skeleton className="h-16" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="p-4">
          <LoadFailed onRetry={() => refetch()} />
        </CardContent>
      </Card>
    );
  }

  if (!data?.has_income_data) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold font-mono text-muted uppercase tracking-[0.22em]">Health Score</p>
            <p className="text-sm text-muted mt-0.5">Add income transactions to calculate your score.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const score = data.score ?? 0;
  const ringColor =
    score >= 80 ? '#30D158' :
    score >= 60 ? '#64D2FF' :
    score >= 40 ? '#FFD60A' :
    '#FF453A';

  const r = 22;
  const circ = 2 * Math.PI * r;
  const strokeDashoffset = circ - (score / 100) * circ;

  const topWeakness = data.components
    ? Object.values(data.components).sort((a, b) => (a.score / a.max) - (b.score / b.max))[0]
    : null;

  const scoreContent = (
    <div
      className="flex items-center gap-4 cursor-pointer"
      onClick={() => navigate('/analytics')}
    >
      {/* Score ring */}
      <svg width="56" height="56" className="shrink-0">
        <circle cx="28" cy="28" r={r} fill="none" stroke={COLOR_TRACK} strokeWidth="4" />
        <motion.circle
          cx="28" cy="28" r={r} fill="none"
          stroke={ringColor}
          strokeWidth="4"
          strokeDasharray={circ}
          strokeLinecap="round"
          transform="rotate(-90 28 28)"
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset }}
          transition={springs.gentle}
        />
        <text x="28" y="32" textAnchor="middle" fontSize="11" fontWeight="700" fill={COLOR_FOREGROUND}>
          {score}
        </text>
      </svg>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          {score < 70 && (
            <p className="text-xs font-semibold font-mono text-muted uppercase tracking-[0.22em]">Health Score</p>
          )}
          <span
            className="text-xs font-medium"
            style={{ color: ringColor }}
          >
            {data.grade}
          </span>
        </div>
        {topWeakness && topWeakness.score < topWeakness.max && (
          <p className="text-xs text-muted mt-0.5 truncate">
            {topWeakness.description.split(' ').slice(0, 8).join(' ')}
          </p>
        )}
        <p className="text-xs text-muted/60 mt-0.5">See breakdown →</p>
      </div>
    </div>
  );

  if (score >= 70) {
    return (
      <HighlightCard title="Financial Health">
        {scoreContent}
      </HighlightCard>
    );
  }

  return (
    <Card
      className="cursor-pointer hover:border-foreground/30 transition-colors"
      onClick={() => navigate('/analytics')}
    >
      <CardContent className="p-4">
        {scoreContent}
      </CardContent>
    </Card>
  );
}

export function OverviewPage() {
  const { period, setPeriod, date, goBack, goForward, goToToday } = usePeriod();
  const { start, end } = useMemo(() => getDateRange(date, period), [date, period]);
  const [trendMode, setTrendMode] = useState<'total' | 'category'>('total');

  const TX_PAGE_SIZE = 15;
  const [txPage, setTxPage] = useState(1);
  const [txCategoryFilter, setTxCategoryFilter] = useState('');

  const { data: summary } = useSummary(start, end);
  const { data: trend } = useTrend(start, end);
  const { data: trendByCategory } = useTrendByCategory(start, end);
  const { data: balance } = useBalance(start, end);
  const { data: recentTransactions } = useTransactions({ start_date: start, end_date: end, limit: 200 });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
    staleTime: 10_000,
  });

  const { data: budgetProgress = [] } = useQuery({
    queryKey: ['budget-progress'],
    queryFn: () => api.getBudgetProgress(),
    enabled: settings?.budgets_enabled === true,
    staleTime: 30_000,
  });

  const { data: goalProgress = [] } = useQuery({
    queryKey: ['goals'],
    queryFn: () => api.getGoals(),
    enabled: settings?.goals_enabled === true,
    staleTime: 30_000,
  });

  // API returns { by_category: { "Food": 50, ... } } — transform to array
  const categories = useMemo(() => {
    const byCat = summary?.by_category;
    if (!byCat || typeof byCat !== 'object') return [];
    return Object.entries(byCat).map(([category, total]) => ({ category, total: total as number }));
  }, [summary]);
  const trendData = trend ?? [];
  const trendByCategoryData = trendByCategory ?? [];
  const income = balance?.income ?? 0;
  const expenses = balance?.expenses ?? 0;

  // Derive day counts from the selected period's end date, not wall-clock today.
  // If the period end is in the future (current month), clamp dayOfMonth to today.
  const { dayOfMonth, daysInMonth } = useMemo(() => {
    const [ey, em, ed] = end.split('-').map(Number);
    const periodEnd = new Date(ey, em - 1, ed);
    const today = new Date();
    const isCurrentOrFuture =
      ey > today.getFullYear() ||
      (ey === today.getFullYear() && em > today.getMonth() + 1) ||
      (ey === today.getFullYear() && em === today.getMonth() + 1);
    const lastDayOfPeriodMonth = new Date(ey, em, 0).getDate();
    const dom = isCurrentOrFuture
      ? Math.min(today.getDate(), lastDayOfPeriodMonth)
      : periodEnd.getDate();
    return { dayOfMonth: dom, daysInMonth: lastDayOfPeriodMonth };
  }, [end]);

  const dailyAvg = dayOfMonth > 0 ? expenses / dayOfMonth : 0;
  const projection = dailyAvg * daysInMonth;
  const saved = income - expenses;

  useEffect(() => {
    setTxPage(1);
  }, [start, end, txCategoryFilter]);

  const filteredTransactions = useMemo(
    () => txCategoryFilter === ''
      ? (recentTransactions ?? [])
      : (recentTransactions ?? []).filter(tx => tx.category === txCategoryFilter),
    [recentTransactions, txCategoryFilter],
  );
  const totalTxPages = Math.ceil(filteredTransactions.length / TX_PAGE_SIZE);
  const pageTxs = filteredTransactions.slice(
    (txPage - 1) * TX_PAGE_SIZE,
    txPage * TX_PAGE_SIZE,
  );

  const trendToggle = (
    <div className="flex rounded-md border border-border overflow-hidden">
      <button
        onClick={() => setTrendMode('total')}
        className={cn(
          'flex-1 px-2.5 py-1 text-xs transition-colors',
          trendMode === 'total'
            ? 'bg-foreground/10 text-foreground font-medium'
            : 'text-muted hover:text-foreground',
        )}
      >
        Total
      </button>
      <button
        onClick={() => setTrendMode('category')}
        className={cn(
          'flex-1 px-2.5 py-1 text-xs transition-colors border-l border-border',
          trendMode === 'category'
            ? 'bg-foreground/10 text-foreground font-medium'
            : 'text-muted hover:text-foreground',
        )}
      >
        By Category
      </button>
    </div>
  );

  return (
    <div className="p-4 space-y-4 md:h-full md:overflow-hidden md:grid md:gap-4 md:p-6 md:space-y-0 page-grid-overview">

      {/* ── Header area (period selector) ── */}
      <div className="area-header flex flex-col gap-3 pb-4 border-b border-border md:flex-row md:justify-between md:items-end">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-muted mb-2 font-mono font-semibold">
            Overview · {new Date(start).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' })}
          </div>
          <h1 className="text-xl md:text-3xl font-bold tracking-tight text-foreground font-display">
            Where the dollars go.
          </h1>
        </div>
        <div className="flex flex-row items-center gap-2 flex-wrap shrink-0">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={goBack}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={goToToday} className="gap-1.5 text-sm">
              <CalendarDays className="h-3.5 w-3.5" />
              Today
            </Button>
            <Button variant="ghost" size="icon" onClick={goForward}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted min-w-[120px] text-center">{getRangeLabel(date, period)}</span>
          </div>
          <div className="flex rounded-md border border-border overflow-hidden flex-shrink-0">
            {PERIOD_OPTIONS.map((p, i) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  'px-2.5 py-1 text-xs capitalize transition-colors whitespace-nowrap flex-shrink-0',
                  i > 0 && 'border-l border-border',
                  period === p
                    ? 'bg-foreground/10 text-foreground font-medium'
                    : 'text-muted hover:text-foreground',
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Left panel: stats + health + budget/goals + charts ── */}
      <motion.div
        className="area-left grid-scroll-panel space-y-4"
        variants={staggerContainerVariants}
        initial="initial"
        animate="animate"
      >

        {/* Hero spend card */}
        <motion.div variants={staggerItemVariants}>
          <HeroCard title={`This Month · Day ${dayOfMonth} of ${daysInMonth}`} glowColor="warm">
            {/* Big spend figure */}
            <div
              className="text-4xl md:text-5xl font-bold tracking-tight mb-1"
              style={{
                background: `linear-gradient(90deg, ${COLOR_HONEY} 0%, ${COLOR_TANGERINE} 50%, ${COLOR_CORAL} 100%)`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              <AnimatedCurrency value={expenses} />
            </div>
            {/* Daily avg + projection */}
            <p className="text-xs text-muted mb-4">
              {formatCurrency(dailyAvg)}/day avg · {formatCurrency(projection)} projected
            </p>
            {/* 3-col summary */}
            <div className="border-t border-dashed border-border/60 pt-3 grid grid-cols-3 gap-2">
              <div>
                <p className="text-xs text-muted uppercase tracking-wide font-mono mb-0.5">Income</p>
                <p className="text-sm font-semibold text-success"><AnimatedCurrency value={income} /></p>
              </div>
              <div>
                <p className="text-xs text-muted uppercase tracking-wide font-mono mb-0.5">Spent</p>
                <p className="text-sm font-semibold text-destructive"><AnimatedCurrency value={expenses} /></p>
              </div>
              <div>
                <p className="text-xs text-muted uppercase tracking-wide font-mono mb-0.5">Saved</p>
                <p className={cn('text-sm font-semibold', saved >= 0 ? 'text-teal' : 'text-destructive')}>
                  <AnimatedCurrency value={saved} />
                </p>
              </div>
            </div>
          </HeroCard>
        </motion.div>

        {/* Active trip */}
        {settings?.trips_enabled && (
          <motion.div variants={staggerItemVariants}>
            <ActiveTripCard />
          </motion.div>
        )}

        {/* Budget Summary */}
        {settings?.budgets_enabled && budgetProgress.length > 0 && (
          <motion.div variants={staggerItemVariants}>
            <PageCard
              title="Budget Summary"
              action={
                <Link to="/finance" className="text-xs text-muted hover:text-foreground">
                  Manage Budgets →
                </Link>
              }
            >
              {budgetProgress.every((b: BudgetProgress) => b.status === 'on_track') ? (
                <p className="text-sm text-success">All budgets on track.</p>
              ) : (
                <div className="space-y-2">
                  {budgetProgress
                    .filter((b: BudgetProgress) => b.status !== 'on_track')
                    .map((b: BudgetProgress) => (
                      <div key={b.id} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-foreground">
                            {b.label}{' '}
                            <span className="text-muted capitalize">({b.period})</span>
                          </span>
                          <span className={b.status === 'over_budget' ? 'text-destructive' : 'text-warning'}>
                            {b.percent.toFixed(0)}%
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-foreground/10 rounded-full overflow-hidden">
                          <motion.div
                            className={`h-full rounded-full ${b.status === 'over_budget' ? 'bg-destructive' : 'bg-warning'}`}
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(b.percent, 100)}%` }}
                            transition={springs.gentle}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </PageCard>
          </motion.div>
        )}

        {/* Goals Summary */}
        {settings?.goals_enabled && goalProgress.length > 0 && (
          <motion.div variants={staggerItemVariants}>
            <PageCard
              title="Goals Summary"
              action={
                <Link to="/finance" className="text-xs text-muted hover:text-foreground">
                  Manage Goals →
                </Link>
              }
            >
              <div className="space-y-3">
                {(goalProgress as GoalProgress[]).slice(0, 5).map((g) => (
                  <div key={g.id} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-foreground font-medium">{g.name}</span>
                      <span className={
                        g.on_track === 'behind'   ? 'text-destructive' :
                        g.on_track === 'ahead'    ? 'text-success' :
                        g.on_track === 'on_track' ? 'text-info' :
                        'text-muted'
                      }>
                        {g.percent.toFixed(0)}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-foreground/10 rounded-full overflow-hidden">
                      <motion.div
                        className={`h-full rounded-full ${g.percent >= 100 ? 'bg-success' : 'bg-primary'}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(g.percent, 100)}%` }}
                        transition={springs.gentle}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-muted">
                      <span>{formatCurrencyWhole(g.saved_amount)} of {formatCurrencyWhole(g.target_amount)}</span>
                      {g.target_date && <span>by {g.target_date}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </PageCard>
          </motion.div>
        )}

        {/* Health Score */}
        <motion.div variants={staggerItemVariants}>
          <HealthScoreCard />
        </motion.div>

        {/* Charts Row */}
        <motion.div variants={staggerItemVariants}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PageCard title="Spending by Category" className="flex flex-col">
              {categories.length > 0 ? (
                <>
                  <CategoryDonut data={categories} />
                  <div className="mt-4 space-y-1.5">
                    {categories.map((c: { category: string; total: number }) => (
                      <div key={c.category} className="flex items-center gap-2 text-sm min-w-0">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: getCategoryColor(c.category) }}
                        />
                         <span className="min-w-0 truncate text-muted">{c.category}</span>
                        <span className="ml-auto font-medium shrink-0">{formatCurrency(c.total)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-48 flex items-center justify-center text-muted text-sm">
                  No spending data for this period
                </div>
              )}
            </PageCard>

            <PageCard
              title="Daily Spending Trend"
              className="flex flex-col"
              contentClassName="flex-1 flex flex-col gap-3 min-h-0"
            >
              {trendToggle}
              <div className="flex-1 min-h-0">
                {trendMode === 'total'
                  ? <TrendLine data={trendData} />
                  : <CategoryTrendLine data={trendByCategoryData} />
                }
              </div>
            </PageCard>
          </div>
        </motion.div>

      </motion.div>

      {/* ── Right panel: transactions ── */}
      <div className="area-right grid-scroll-panel space-y-4">
        <PageCard
          title="Transactions"
          headerClassName="flex-col items-start gap-1 md:flex-row md:items-center"
          action={
            <div className="flex items-center gap-2">
              {categories.length > 0 && (
                <select
                  value={txCategoryFilter}
                  onChange={e => setTxCategoryFilter(e.target.value)}
                  className="select-field h-7 text-xs w-36"
                >
                  <option value="">All categories</option>
                  {categories.map(({ category }) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              )}
              {totalTxPages > 1 && (
                <>
                  {categories.length > 0 && <div className="w-px h-4 bg-border shrink-0" />}
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setTxPage(p => Math.max(1, p - 1))}
                      disabled={txPage === 1}
                    >
                      <ChevronLeft className="h-3 w-3" />
                    </Button>
                    <span className="text-xs text-muted">{txPage}/{totalTxPages}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setTxPage(p => Math.min(totalTxPages, p + 1))}
                      disabled={txPage === totalTxPages}
                    >
                      <ChevronRight className="h-3 w-3" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          }
        >
          {!recentTransactions || recentTransactions.length === 0 ? (
            <p className="text-muted text-sm py-4 text-center">Nothing captured this period.</p>
          ) : filteredTransactions.length === 0 ? (
            <p className="text-muted text-sm py-4 text-center">Nothing captured for this category.</p>
          ) : (
            <div className="flex flex-col -mx-4">
              {pageTxs.map((tx: Transaction) => (
                <TransactionRow key={tx.id} tx={tx} readOnly />
              ))}
            </div>
          )}
        </PageCard>
      </div>

    </div>
  );
}
