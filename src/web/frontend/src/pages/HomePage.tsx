import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Plus } from 'lucide-react';
import { briefingApi, evidenceLink, formatMoney } from '@/api/briefing';
import { PageCard } from '@/components/ui/cards';
import { LoadFailed } from '@/components/ui/LoadFailed';

export function HomePage() {
  const query = useQuery({ queryKey: ['home-briefing'], queryFn: briefingApi.home });
  if (!query.data && query.isError) return <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div>;
  if (!query.data) return <p role="status" className="p-6 text-muted">Preparing your briefing…</p>;
  const { facts, freshness, recent, upcoming, upcoming_total, upcoming_unknown_count, capture_issue_count, followup_issue_count } = query.data;
  const unresolved = facts.current.unresolved_count + facts.undated_count;
  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-6 text-base">
      <header className="flex items-center justify-between gap-4">
        <div><h1 className="text-2xl font-semibold font-display">Your money briefing</h1><p className="text-muted">Through {facts.as_of} · {facts.timezone}</p></div>
        <Link className="min-h-11 min-w-11 inline-flex items-center gap-2 text-teal" to="/transactions?add=1"><Plus aria-hidden="true" size={20} />Add</Link>
      </header>
      {query.isError && <p role="alert" className="text-warning">Couldn’t refresh. This briefing may be out of date. <button className="underline min-h-11" onClick={() => void query.refetch()}>Retry</button></p>}
      <PageCard title="This month so far" action={<Link className="min-h-11 inline-flex items-center text-teal" to={evidenceLink(facts.current)}>See spending <ArrowRight className="ml-2" size={16} /></Link>}>
        <p className="text-4xl md:text-5xl font-semibold tabular-nums tracking-tight">{formatMoney(facts.current.spending)}</p>
        <p className="mt-2 text-muted">{facts.current.status === 'partial' ? 'Known spending subtotal · some amounts or dates need review.' : facts.current.status === 'indicative' ? 'Recorded spending · includes indicative currency conversions.' : 'Recorded spending this month'}</p>
        <p className="mt-4">{facts.change ? `${formatMoney({ ...facts.change, minor_units: Math.abs(facts.change.minor_units) })} ${facts.change.minor_units >= 0 ? 'more' : 'less'} than the comparable period last month.` : 'A comparison is unavailable while some records need review.'}</p>
        <p className="text-sm text-muted">Comparing {facts.comparison_current.start}–{facts.comparison_current.end} with {facts.previous.start}–{facts.previous.end}.</p>
        {facts.current.income && <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2"><Link className="text-teal min-h-11 inline-flex items-center" to={evidenceLink(facts.current, undefined, 'income')}>Recorded income {formatMoney(facts.current.income)}</Link>{facts.current.recorded_net_flow && <p className="py-2">Recorded net flow {formatMoney(facts.current.recorded_net_flow)}</p>}</div>}
      </PageCard>
      <PageCard title="What changed">
        {facts.category_changes.slice(0, 3).map(driver => <div key={driver.category} className="py-3 border-b border-border last:border-0">
          <p>{driver.category}: <strong>{formatMoney(driver.change)}</strong> change</p>
          <div className="flex gap-6"><Link className="text-teal min-h-11 inline-flex items-center" to={evidenceLink(facts.comparison_current, driver.category)}>This period</Link><Link className="text-teal min-h-11 inline-flex items-center" to={evidenceLink(facts.previous, driver.category)}>Previous period</Link></div>
        </div>)}
        {!facts.category_changes.length && <p className="text-muted">{facts.change ? 'No category spending changes in these periods.' : 'Resolve the records needing attention to compare categories.'}</p>}
      </PageCard>
      <div className="grid md:grid-cols-2 gap-6">
        <PageCard title="Coming up" action={<Link className="text-teal min-h-11 inline-flex items-center" to="/plan">Open plan</Link>}>
          <p>{formatMoney(upcoming_total)} in estimated charges over the next 14 days.</p>
          {!!upcoming_unknown_count && <p className="text-warning">{upcoming_unknown_count} expected charges have no amount yet.</p>}
          {upcoming.map(item => <div key={item.id} className="flex justify-between gap-4 py-3 border-b border-border last:border-0"><div>{item.label}<p className="text-sm text-muted">{item.date}</p></div><span>{item.amount ? formatMoney(item.amount) : 'Amount unknown'}</span></div>)}
          {!upcoming.length && <p className="text-muted mt-3">No pending charges are recorded for these dates. Add subscriptions in Plan to track them.</p>}
        </PageCard>
        <PageCard title="Needs attention">
          <Link to="/review" className="block text-teal py-3 min-h-11">{capture_issue_count + followup_issue_count} capture or follow-up items</Link>
          {!!unresolved && <Link to={evidenceLink(facts.current, undefined, 'unresolved')} className="block text-warning py-3 min-h-11">Review {unresolved} spending records with unresolved amounts or dates</Link>}
          <p className="mt-4 text-muted">{freshness.gmail_needs_reconnection ? 'Gmail needs reconnection.' : freshness.gmail_connected ? `Gmail last checked: ${freshness.gmail_last_checked ?? 'not checked in this session'}.` : 'Gmail is not connected in this session.'}</p>
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
