import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { briefingApi, formatMoney } from '@/api/briefing';
import { PageCard } from '@/components/ui/cards';
import { Button } from '@/components/ui/button';
import { LoadFailed } from '@/components/ui/LoadFailed';

export function PlanPage() {
  const location = useLocation();
  const [days, setDays] = useState(30);
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: ['plan-upcoming', days, offset],
    queryFn: () => briefingApi.upcoming(days, offset),
    refetchOnMount: 'always',
  });
  const report = query.data;
  const frequencies: Record<string, string> = { weekly: 'Weekly', biweekly: 'Every two weeks', monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual' };
  const legacySearch = new URLSearchParams(location.search);
  if (legacySearch.has('tab') || legacySearch.has('subscription')) {
    return <Navigate replace to={`/plan/manage${location.search}${location.hash}`} />;
  }
  return <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6 text-base">
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold">Plan</h1>
      <p className="text-muted">Upcoming charges from your recorded subscription schedules.</p>
      <Link to="/plan/manage" className="text-teal min-h-11 inline-flex items-center">Manage subscriptions, budgets, goals, and trips</Link>
    </header>
    <label className="flex items-center gap-3">Show
      <select className="select-field min-h-11" value={days} onChange={event => { setDays(Number(event.target.value)); setOffset(0); }}>
        <option value={14}>Next 14 days</option><option value={30}>Next 30 days</option><option value={90}>Next 90 days</option>
      </select>
    </label>
    {query.isError && <div role="alert">{report ? <p className="text-warning">Couldn’t refresh. This timeline may be out of date.</p> : null}<LoadFailed onRetry={() => void query.refetch()} /></div>}
    {!report && !query.isError && <p role="status">Loading upcoming charges…</p>}
    {report && (!report.enabled ? <PageCard title="Track upcoming charges">
      <p>Enable Subscriptions in Settings to see your recorded schedules here.</p>
      <Link to="/settings" className="text-teal min-h-11 inline-flex items-center">Open Settings</Link>
    </PageCard> : <>
      <PageCard title="Upcoming timeline">
        <p className="text-3xl font-semibold tabular-nums">{formatMoney(report.known_total)}</p>
        <p className="text-muted">{report.status === 'partial' ? 'Known estimated subtotal' : 'Estimated charges'} · {report.start} to {report.end} · {report.timezone}</p>
        {!!report.unknown_count && <p className="text-warning">{report.unknown_count} charges have unknown amounts and are excluded from this subtotal.</p>}
        <p className="text-sm text-muted mt-3">Dates and amounts are estimates, not confirmed charges. Only recorded pending schedules appear; this is not a complete forecast. Matched or dismissed charges are excluded.</p>
        <ol className="mt-4">
          {report.items.map(item => <li key={item.id} className="py-4 border-b border-border last:border-0 space-y-1">
            <div className="flex justify-between gap-4"><p className="font-medium">{item.label}</p><p className="tabular-nums">{item.amount ? formatMoney(item.amount) : 'Amount unknown'}</p></div>
            <p className="text-muted"><time dateTime={item.date}>{item.date}</time> · {frequencies[item.frequency] || item.frequency} · Estimated</p>
            {item.schedule_status === 'possibly_cancelled' && <p className="text-warning">Schedule needs review: a previous charge may be overdue.</p>}
            <Link to={`/plan/manage?subscription=${item.subscription_id}`} className="text-teal min-h-11 inline-flex items-center">Review schedule for {item.label}</Link>
          </li>)}
        </ol>
        {!report.items.length && <p className="py-4 text-muted">{report.total ? 'No charges on this page. Return to an earlier page.' : 'No pending charges recorded in this window. Add or review a subscription schedule to get started.'}</p>}
      </PageCard>
      <nav aria-label="Upcoming charge pages" className="flex items-center justify-between gap-3">
        <Button variant="outline" className="min-h-11" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous charges</Button>
        <span>{report.total} recorded charges</span>
        <Button variant="outline" className="min-h-11" disabled={query.isError || offset + 50 >= report.total} onClick={() => setOffset(offset + 50)}>Next charges</Button>
      </nav>
    </>)}
  </div>;
}
