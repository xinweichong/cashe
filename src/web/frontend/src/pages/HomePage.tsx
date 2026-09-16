import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Plus } from 'lucide-react';
import { briefingApi, evidenceLink, formatMoney } from '@/api/briefing';
import { api } from '@/api/client';
import { HeroCard, PageCard } from '@/components/ui/cards';
import { HeroAmount } from '@/components/ui/HeroAmount';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendLine } from '@/components/charts/TrendLine';
import { CategoryDonut } from '@/components/charts/CategoryDonut';

export function HomePage() {
  const navigate = useNavigate();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['home-briefing'], queryFn: briefingApi.home });
  const currentStart = query.data?.facts.current.start;
  const currentEnd = query.data?.facts.current.end;
  // Both charts read start/end scoped to facts.current — the exact period the
  // hero amount above them covers — and are built on the same spending_facts
  // rules as that hero (see src/spending_facts.py's category_breakdown/
  // daily_totals), never the legacy /api/v2/overview/* SQL aggregates, so
  // chart and hero totals always reconcile for an identical period.
  const breakdownQuery = useQuery({
    queryKey: ['home-category-breakdown', currentStart, currentEnd],
    queryFn: () => api.getCategoryBreakdownV2(currentStart!, currentEnd!),
    enabled: !!currentStart && !!currentEnd,
  });
  const trendQuery = useQuery({
    queryKey: ['home-daily-totals', currentStart, currentEnd],
    queryFn: () => api.getDailyTotalsV2(currentStart!, currentEnd!),
    enabled: !!currentStart && !!currentEnd,
  });
  if (!query.data && query.isError) return <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div>;
  if (!query.data) return <p role="status" className="p-6 text-muted">Preparing your briefing…</p>;
  const { facts, spending_target, freshness, recent, upcoming, upcoming_total, upcoming_unknown_count, increased_commitments, capture_issue_count, followup_issue_count, review_count, recurring_suggestion_count } = query.data;
  const overTarget = !!spending_target && spending_target.remaining.minor_units < 0;
  const unresolved = facts.current.unresolved_count + facts.undated_count;
  const netFlowNegative = !!facts.current.recorded_net_flow && facts.current.recorded_net_flow.minor_units < 0;
  const driver = facts.top_category_driver;
  const categoryTotals = breakdownQuery.data
    ? Object.entries(breakdownQuery.data.by_category).map(([category, amount]) => ({ category, total: amount.minor_units / 100 }))
    : [];
  const trendPoints = trendQuery.data?.map((day) => ({ date: day.date, amount: day.spending.minor_units / 100 })) ?? [];
  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-6 text-base">
      <header className="flex items-center justify-between gap-4">
        <div><h1 className="text-2xl font-semibold font-display">Your money briefing</h1><p className="text-muted">Through {facts.as_of} · {facts.timezone}</p></div>
        <Link className="min-h-11 min-w-11 inline-flex items-center gap-2 text-teal" to="/transactions?add=1"><Plus aria-hidden="true" size={20} />Add</Link>
      </header>
      {query.isError && <p role="alert" className="text-warning">Couldn’t refresh. This briefing may be out of date. <button className="underline min-h-11" onClick={() => void query.refetch()}>Retry</button></p>}
      <HeroCard title="Month spending" action={<Link className="min-h-11 inline-flex items-center text-teal" to={evidenceLink(facts.current)}>See spending <ArrowRight className="ml-2" size={16} /></Link>}>
        <HeroAmount value={facts.current.spending} />
        <p className="mt-2 text-muted">{facts.current.status === 'partial' ? 'Known spending subtotal · some amounts or dates need review.' : facts.current.status === 'indicative' ? 'Recorded spending · includes indicative currency conversions.' : 'Recorded spending this month'}</p>
        <p className="mt-4">{facts.change ? `${formatMoney({ ...facts.change, minor_units: Math.abs(facts.change.minor_units) })} ${facts.change.minor_units >= 0 ? 'more' : 'less'} than the comparable period last month.` : 'A comparison is unavailable while some records need review.'}</p>
        <p className="text-sm text-muted">Comparing {facts.comparison_current.start}–{facts.comparison_current.end} with {facts.previous.start}–{facts.previous.end}.</p>
        {facts.current.income && <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2"><Link className="text-teal min-h-11 inline-flex items-center" to={evidenceLink(facts.current, undefined, 'income')}>Recorded income {formatMoney(facts.current.income)}</Link>{facts.current.recorded_net_flow && <p className={`py-2 ${netFlowNegative ? 'text-warning' : ''}`}>Recorded net {netFlowNegative ? 'outflow' : 'flow'} {formatMoney(facts.current.recorded_net_flow)}</p>}</div>}
        {spending_target && <p className={`mt-4 pt-4 border-t border-border ${overTarget ? 'text-warning' : ''}`}>{overTarget
          ? `${formatMoney({ ...spending_target.remaining, minor_units: Math.abs(spending_target.remaining.minor_units) })} over your ${formatMoney(spending_target.target)} monthly target.`
          : `${formatMoney(spending_target.remaining)} remaining of your ${formatMoney(spending_target.target)} monthly target.`}</p>}
        <div className="mt-6 pt-4 border-t border-border">
          {trendQuery.isLoading ? <Skeleton className="h-[160px] w-full" /> : trendQuery.isError ? (
            <p className="text-sm text-muted">Couldn't load the daily trend. <button className="underline min-h-11" onClick={() => void trendQuery.refetch()}>Retry</button></p>
          ) : (
            <>
              <TrendLine data={trendPoints} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
              {selectedDate && <Link className="text-sm text-teal min-h-11 inline-flex items-center mt-1" to={`/evidence?start=${selectedDate}&end=${selectedDate}&measure=spending`}>View this day's records</Link>}
            </>
          )}
        </div>
      </HeroCard>
      <PageCard title="Where it went">
        {breakdownQuery.isLoading ? <Skeleton className="h-[220px] w-full" /> : breakdownQuery.isError ? (
          <p className="text-sm text-muted">Couldn't load the category mix. <button className="underline min-h-11" onClick={() => void breakdownQuery.refetch()}>Retry</button></p>
        ) : (
          <CategoryDonut
            data={categoryTotals}
            selected={selectedCategory}
            onSelect={setSelectedCategory}
            onViewTransactions={(category) => navigate(evidenceLink(facts.current, category))}
            showLegend
          />
        )}
      </PageCard>
      <PageCard title="What changed">
        {facts.category_changes.slice(0, 3).map(item => <div key={item.category} className="py-3 border-b border-border last:border-0">
          <p>{item.category}: <strong>{formatMoney(item.change)}</strong> change</p>
          <div className="flex gap-6"><Link className="text-teal min-h-11 inline-flex items-center" to={evidenceLink(facts.comparison_current, item.category)}>This period</Link><Link className="text-teal min-h-11 inline-flex items-center" to={evidenceLink(facts.previous, item.category)}>Previous period</Link></div>
        </div>)}
        {!facts.category_changes.length && <p className="text-muted">{facts.change ? 'No category spending changes in these periods.' : 'Resolve the records needing attention to compare categories.'}</p>}
        {driver && <div className="mt-4 pt-4 border-t border-border space-y-3">
          <p className="text-sm text-muted">{driver.overlap_note}</p>
          {driver.merchant_driver && <p>Biggest contributor in {driver.category}: <Link className="text-teal underline" to={evidenceLink(facts.comparison_current, driver.category, 'spending', driver.merchant_driver.merchant)}>{driver.merchant_driver.merchant}</Link> (<strong>{formatMoney(driver.merchant_driver.change)}</strong> change)</p>}
          {driver.frequency_driver && driver.frequency_driver.classification !== 'none' && <p>
            {driver.frequency_driver.classification === 'frequency' && `Driven mostly by more purchases: ${driver.frequency_driver.current_count} this period vs ${driver.frequency_driver.previous_count} previously, at a similar average.`}
            {driver.frequency_driver.classification === 'size' && `Driven mostly by bigger purchases: average ${formatMoney(driver.frequency_driver.current_avg)} this period vs ${formatMoney(driver.frequency_driver.previous_avg)} previously, at a similar count.`}
            {driver.frequency_driver.classification === 'mixed' && `Both purchase count (${driver.frequency_driver.previous_count} → ${driver.frequency_driver.current_count}) and average size (${formatMoney(driver.frequency_driver.previous_avg)} → ${formatMoney(driver.frequency_driver.current_avg)}) changed.`}
          </p>}
          {driver.one_off_driver && <p>Largely one purchase: <Link className="text-teal underline" to={`/transactions/${driver.one_off_driver.transaction_id}`}>{driver.one_off_driver.merchant || 'Unnamed transaction'}</Link> for <strong>{formatMoney(driver.one_off_driver.amount)}</strong> on {driver.one_off_driver.date}.</p>}
        </div>}
        {!!facts.trip_drivers.length && <div className="mt-4 pt-4 border-t border-border space-y-3">
          {facts.trip_drivers.map(trip => <p key={trip.trip_id}>Trip <Link className="text-teal underline" to={`/transactions?trip=${trip.trip_id}&start=${facts.current.start}&end=${facts.comparison_current.end}`}>{trip.name}</Link>: {formatMoney(trip.current_total)} this period ({formatMoney(trip.previous_total)} previously). <span className="text-sm text-muted">{trip.overlap_note}</span></p>)}
        </div>}
      </PageCard>
      <div className="grid md:grid-cols-2 gap-6">
        <PageCard title="Coming up" action={<Link className="text-teal min-h-11 inline-flex items-center" to="/plan">Open plan</Link>}>
          <p>{formatMoney(upcoming_total)} in estimated charges over the next 14 days.</p>
          {!!upcoming_unknown_count && <p className="text-warning">{upcoming_unknown_count} expected charges have no amount yet.</p>}
          {upcoming.map(item => <div key={item.id} className="flex justify-between gap-4 py-3 border-b border-border last:border-0"><div>{item.label}<p className="text-sm text-muted">{item.date}</p></div><span>{item.amount ? formatMoney(item.amount) : 'Amount unknown'}</span></div>)}
          {!upcoming.length && <p className="text-muted mt-3">No pending charges are recorded for these dates. Add subscriptions in Plan to track them.</p>}
          {!!increased_commitments.length && <div className="mt-4 pt-4 border-t border-border space-y-2">
            <p className="font-medium">Recently increased</p>
            {increased_commitments.map(change => <p key={change.subscription_id}>{change.label}: {formatMoney(change.old_amount)} → {formatMoney(change.new_amount)} (<strong>+{formatMoney(change.change)}</strong>, {formatMoney(change.annualized_impact)}/year)</p>)}
          </div>}
        </PageCard>
        <PageCard title="Needs attention">
          <Link to="/review" className="block text-teal py-3 min-h-11">{capture_issue_count + followup_issue_count} capture or follow-up items</Link>
          {!!unresolved && <Link to={evidenceLink(facts.current, undefined, 'unresolved')} className="block text-warning py-3 min-h-11">Review {unresolved} spending records with unresolved amounts or dates</Link>}
          {!!review_count && <Link to="/review" className="block text-teal py-3 min-h-11">{review_count} spending records need review</Link>}
          {!!recurring_suggestion_count && <Link to="/review" className="block text-teal py-3 min-h-11">{recurring_suggestion_count} recurring suggestions</Link>}
          <p className="mt-4 text-muted">{freshness.gmail_needs_reconnection ? 'Gmail needs reconnection.' : freshness.gmail_connected ? `Gmail last checked: ${freshness.gmail_last_checked ?? 'not checked in this session'}.` : 'Gmail is not connected in this session.'}</p>
          <p className="text-sm text-muted">{freshness.last_capture_processed_at ? `Last capture processed: ${freshness.last_capture_processed_at}.` : 'No capture has been processed yet.'}</p>
          <p className="text-sm text-muted mt-2">Recent checks do not prove every purchase was captured.</p>
          <Link to="/settings" className="inline-flex text-teal min-h-11 items-center">Manage connections</Link>
        </PageCard>
      </div>
      <PageCard title="Recent activity" action={<Link to="/transactions" className="text-teal min-h-11 inline-flex items-center">All activity</Link>}>
        {recent.map(item => <Link key={item.id} to={`/transactions/${item.id}`} className="flex justify-between gap-4 py-3 min-h-11 border-b border-border last:border-0 hover:underline"><div>{item.merchant || 'Unnamed transaction'}<p className="text-sm text-muted">{item.date?.slice(0, 10) ?? 'Date unknown'} · {item.category} · {item.type}</p></div><div>{item.amount ? formatMoney(item.amount) : 'Amount unresolved'}{item.conversion_status === 'indicative' && <p className="text-sm text-muted">Indicative</p>}</div></Link>)}
        {!recent.length && <p className="text-muted">Your captured purchases will appear here. Add a transaction or connect a source to begin.</p>}
      </PageCard>
    </div>
  );
}
