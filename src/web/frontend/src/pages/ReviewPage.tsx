import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { briefingApi } from '@/api/briefing';
import { PageCard } from '@/components/ui/cards';
import { Button } from '@/components/ui/button';
import { LoadFailed } from '@/components/ui/LoadFailed';

const sourceLabels: Record<string, string> = { gmail: 'Gmail', wallet_request: 'Wallet request', apple_wallet: 'Apple Wallet' };
const effectLabels: Record<string, string> = { trip: 'Trip assignment', recurring: 'Recurring analysis', notification: 'Transaction notification', suggestion: 'Recurring suggestion' };

export function ReviewPage() {
  const client = useQueryClient();
  const [page, setPage] = useState(0);
  const query = useQuery({ queryKey: ['capture-review', page], queryFn: async () => {
    const [capture, followups] = await Promise.all([briefingApi.captureIssues(page * 50), briefingApi.followups(page * 50)]);
    return { capture, followups };
  } });
  const retry = useMutation({ mutationFn: ({ id, type }: { id: number; type: 'capture' | 'followup' }) => type === 'capture' ? briefingApi.retryCapture(id) : briefingApi.retryFollowup(id), onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ['capture-review'] }), client.invalidateQueries({ queryKey: ['home-briefing'] })]); } });
  return <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
    <header><Link to="/home" className="text-teal min-h-11 inline-flex items-center">Back to briefing</Link><h1 className="text-2xl font-semibold">Review</h1><p className="text-muted">Spending records, requests, and follow-ups that need attention.</p></header>
    <SpendingReviewList />
    {retry.isError && <p role="alert" className="text-destructive">Couldn’t queue the retry. Please try again.</p>}
    {retry.isSuccess && <p role="status">Retry queued. Processing normally runs within two minutes.</p>}
    {query.isError ? <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div> : !query.data ? <p role="status">Loading capture review…</p> : <>
      <PageCard title="Source observations">
        {query.data.capture.map(item => <div key={item.id} className="py-4 border-b border-border last:border-0 flex items-center gap-4 justify-between"><div><p>{sourceLabels[item.source] || 'Bank alert'} · {item.status}</p><p className="text-sm text-muted">{item.status === 'unrecognized' ? 'The request could not be parsed. Check the source or Shortcut fields before retrying.' : item.attempts >= 5 ? 'Automatic retries have stopped. Retry after resolving the cause.' : 'Pending or temporarily failed processing.'}</p></div><Button variant="outline" disabled={retry.isPending} onClick={() => retry.mutate({ id: item.id, type: 'capture' })}>Retry</Button></div>)}
        {!query.data.capture.length && <p className="text-muted">No capture issues on this page.</p>}
      </PageCard>
      <PageCard title="Transaction follow-ups">
        {query.data.followups.map(item => <div key={item.id} className="py-4 border-b border-border last:border-0 flex items-center gap-4 justify-between"><div><p>{effectLabels[item.kind] || 'Follow-up'} · {item.status}</p><Link to={`/transactions/${item.transaction_id}`} className="text-teal min-h-11 inline-flex items-center">Open transaction</Link><p className="text-sm text-muted">{item.attempts >= 5 ? 'Automatic retries have stopped.' : 'The transaction is stored; this follow-up is pending.'}</p></div><Button variant="outline" disabled={retry.isPending} onClick={() => retry.mutate({ id: item.id, type: 'followup' })}>Retry</Button></div>)}
        {!query.data.followups.length && <p className="text-muted">No pending follow-ups on this page.</p>}
      </PageCard>
      <div className="flex justify-between items-center"><Button variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page + 1}</span><Button variant="outline" disabled={query.data.capture.length < 50 && query.data.followups.length < 50} onClick={() => setPage(page + 1)}>Next</Button></div>
      <p className="text-sm text-muted">Showing up to 50 items per group per page. <Link className="text-teal" to="/settings">Manage source connections</Link>.</p>
    </>}
  </div>;
}

function SpendingReviewList() {
  const [search, setSearch] = useSearchParams();
  const requested = Number(search.get('spending_offset'));
  const offset = Number.isSafeInteger(requested) && requested >= 0 ? requested : 0;
  const query = useQuery({ queryKey: ['spending-review', offset], queryFn: () => briefingApi.spendingReview(offset) });
  const move = (next: number) => { const value = new URLSearchParams(search); value.set('spending_offset', String(next)); setSearch(value); };
  const returnTo = `/review${search.size ? `?${search}` : ''}`;
  const reasons = {
    missing_date: 'The date is missing or unreadable; period comparisons remain unavailable.',
    unresolved_money: 'The amount or currency conversion cannot be resolved. Check the original amount and exchange rate.',
    unknown_type: 'The transaction type is not recognized as spending, income, or a refund.',
  };
  return <PageCard title="Spending records">
    <p className="text-sm text-muted mb-3">Across all recorded dates. These records can make totals incomplete. Existing indicative conversions are labeled in reports and are not included here.</p>
    {query.isError ? <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div> : !query.data ? <p role="status">Loading spending review…</p> : <>
      <p className="text-sm text-muted">{query.data.total} records need review</p>
      {query.data.items.map(item => <div key={item.id} className="py-4 border-b border-border last:border-0 space-y-2">
        <p>{item.merchant || 'Unnamed transaction'} <span className="text-muted">· {item.date || 'Date unknown'} · {item.category}</span></p>
        <ul className="text-sm text-muted space-y-1">{item.reasons.map(reason => <li key={reason}>{reasons[reason]}</li>)}</ul>
        <Link className="text-teal min-h-11 inline-flex items-center" to={`/transactions/${item.id}?returnTo=${encodeURIComponent(returnTo)}`}>Open transaction</Link>
      </div>)}
      {!query.data.items.length && <p className="py-4 text-muted">{query.data.total ? 'No spending records on this page. Return to an earlier page.' : 'No unresolved spending records.'}</p>}
    </>}
    <nav aria-label="Spending review pages" className="flex justify-between items-center gap-3 pt-4">
      <Button variant="outline" className="min-h-11" disabled={!offset} onClick={() => move(Math.max(0, offset - 50))}>Previous spending records</Button>
      <Button variant="outline" className="min-h-11" disabled={!query.data || query.isError || offset + 50 >= query.data.total} onClick={() => move(offset + 50)}>Next spending records</Button>
    </nav>
  </PageCard>;
}
