import { useState } from 'react';
import { Link } from 'react-router-dom';
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
    <header><Link to="/home" className="text-teal min-h-11 inline-flex items-center">Back to briefing</Link><h1 className="text-2xl font-semibold">Capture review</h1><p className="text-muted">Requests and follow-ups that still need processing.</p></header>
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
