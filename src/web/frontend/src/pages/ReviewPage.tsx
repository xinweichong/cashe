import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { briefingApi, formatMoney, type DuplicateSide } from '@/api/briefing';
import { PageCard } from '@/components/ui/cards';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { invalidateSpendingQueries } from '@/hooks/useTransactions';
import { frequencyLabel } from '@/lib/subscriptionFrequency';

const sourceLabels: Record<string, string> = { telegram_nl: 'Telegram entry', gmail: 'Gmail', wallet_request: 'Wallet request', apple_wallet: 'Apple Wallet' };
const effectLabels: Record<string, string> = { trip: 'Trip assignment', recurring: 'Recurring analysis', notification: 'Transaction notification', suggestion: 'Recurring suggestion' };

export function ReviewPage() {
  const client = useQueryClient();
  const [includeHandled, setIncludeHandled] = useState(false);
  const [page, setPage] = useState(0);
  const query = useQuery({ queryKey: ['capture-review', page, includeHandled], queryFn: async () => {
    const [capture, followups] = await Promise.all([briefingApi.captureIssues(page * 50, includeHandled), briefingApi.followups(page * 50)]);
    return { capture, followups };
  } });
  const retry = useMutation({ mutationFn: ({ id, type }: { id: number; type: 'capture' | 'followup' }) => type === 'capture' ? briefingApi.retryCapture(id) : briefingApi.retryFollowup(id), onSuccess: () => invalidateSpendingQueries(client) });
  const resolve = useMutation({ mutationFn: ({ id, handled }: { id: number; handled: boolean }) => briefingApi.resolveCapture(id, handled), onSuccess: () => invalidateSpendingQueries(client) });
  return <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
    <header className="space-y-1"><Link to="/home" className="text-teal min-h-11 inline-flex items-center">Back to briefing</Link><h1 className="font-display text-2xl font-semibold">Review</h1><p className="text-muted">Spending records, recurring suggestions, and capture follow-ups that need attention.</p></header>
    <SpendingReviewList />
    <DuplicateReviewList />
    <RefundMatchReviewList />
    <RecurringReviewList />
    {resolve.isError && <p role="alert" className="text-destructive">Couldn’t update this entry. Please try again.</p>}
    {retry.isError && <p role="alert" className="text-destructive">Couldn’t queue the retry. Please try again.</p>}
    {retry.isSuccess && <p role="status">Retry queued. Processing normally runs within two minutes.</p>}
    {query.isError ? <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div> : !query.data ? <div role="status"><span className="sr-only">Loading capture review…</span><Skeleton className="h-20 w-full" /></div> : <>
      <PageCard title="Source observations">
        <label className="min-h-11 flex items-center gap-2"><input type="checkbox" checked={includeHandled} onChange={event => { setIncludeHandled(event.target.checked); setPage(0); }} />Show handled Telegram entries</label>
        <p className="text-sm text-muted">After entering a missing transaction or deciding no entry is needed, mark the Telegram input handled. Its original input and processing status are retained.</p>
        {query.data.capture.map(item => <div key={item.id} className="py-4 border-b border-border last:border-0 flex items-center gap-4 justify-between"><div><p>{sourceLabels[item.source] || 'Bank alert'} · {item.status}{item.handled ? ' · Handled' : ''}</p><p className="text-sm text-muted">{item.source === 'telegram_nl' ? 'No draft was completed. Use /add or send a new entry in Telegram. Parsing is not retried automatically.' : item.status === 'unrecognized' ? 'The request could not be parsed. Check the source or Shortcut fields before retrying.' : item.attempts >= 5 ? 'Automatic retries have stopped. Retry after resolving the cause.' : 'Pending or temporarily failed processing.'}</p></div>{item.source === 'telegram_nl' ? <Button variant="outline" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: item.id, handled: !item.handled })}>{item.handled ? 'Return to Review' : 'Mark handled'}</Button> : <Button variant="outline" disabled={retry.isPending} onClick={() => retry.mutate({ id: item.id, type: 'capture' })}>Retry</Button>}</div>)}
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
    missing_merchant: 'No merchant is recorded for this transaction.',
    missing_category: 'No category is recorded for this transaction.',
  };
  return <PageCard title="Spending records">
    <p className="text-sm text-muted mb-3">Across all recorded dates. These records can make totals incomplete. Existing indicative conversions are labeled in reports and are not included here.</p>
    {query.isError ? <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div> : !query.data ? <div role="status"><span className="sr-only">Loading spending review…</span><Skeleton className="h-20 w-full" /></div> : <>
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

function duplicateSideLabel(side: DuplicateSide): string {
  return `${side.merchant || 'Unnamed transaction'} · ${side.date || 'Date unknown'} · ${side.amount ? formatMoney(side.amount) : 'Amount unresolved'}`;
}

function DuplicateReviewList() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['duplicate-review'], queryFn: () => briefingApi.duplicateReview() });
  const dismiss = useMutation({
    mutationFn: ({ aId, bId }: { aId: number; bId: number }) => briefingApi.dismissDuplicate(aId, bId),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['duplicate-review'] }); },
  });
  const merge = useMutation({
    mutationFn: ({ survivorId, loserId }: { survivorId: number; loserId: number }) => briefingApi.mergeDuplicates(survivorId, loserId),
    // A merge changes which transaction records exist, so every spending
    // total downstream of them (Home, Explore, Plan, evidence) needs to
    // refetch too — not just this review list.
    onSuccess: () => invalidateSpendingQueries(client),
  });
  const undo = useMutation({
    mutationFn: (mergeId: number) => briefingApi.undoDuplicateMerge(mergeId),
    onSuccess: () => invalidateSpendingQueries(client),
  });
  return <PageCard title="Possible duplicates">
    <p className="text-sm text-muted mb-3">Two records from different sources that look like the same purchase. Keep whichever one you want as the record — its evidence, trip, and any billing match carry over. Keep separate if they're actually different.</p>
    {merge.isSuccess && !undo.isSuccess && <p role="status" className="py-2">Merged. <Button type="button" variant="link" size="sm" className="h-auto min-h-11 p-0 align-baseline" disabled={undo.isPending} onClick={() => undo.mutate(merge.data.merge_id)}>Undo</Button></p>}
    {undo.isSuccess && <p role="status" className="py-2">Merge undone.</p>}
    {(dismiss.isError || merge.isError || undo.isError) && <p role="alert" className="text-destructive">Couldn’t update this pair. Please try again.</p>}
    {query.isError ? <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div> : !query.data ? <div role="status"><span className="sr-only">Loading possible duplicates…</span><Skeleton className="h-20 w-full" /></div> : <>
      <p className="text-sm text-muted">{query.data.total} possible duplicates need review</p>
      {query.data.items.map(item => <div key={`${item.transaction_a.id}-${item.transaction_b.id}`} className="py-4 border-b border-border last:border-0 space-y-2">
        <div className="grid sm:grid-cols-2 gap-3">
          {[item.transaction_a, item.transaction_b].map((side, idx) => {
            const other = idx === 0 ? item.transaction_b : item.transaction_a;
            return <div key={side.id} className="border border-border rounded-md p-3 space-y-2">
              <p className="text-sm">{duplicateSideLabel(side)}</p>
              <p className="text-xs text-muted">Source: {side.source}</p>
              <Button variant="outline" className="min-h-11" disabled={merge.isPending}
                onClick={() => merge.mutate({ survivorId: side.id, loserId: other.id })}>Keep this one</Button>
            </div>;
          })}
        </div>
        <Button variant="ghost" className="min-h-11" disabled={dismiss.isPending}
          onClick={() => dismiss.mutate({ aId: item.transaction_a.id, bId: item.transaction_b.id })}>Keep separate</Button>
      </div>)}
      {!query.data.items.length && <p className="py-4 text-muted">No possible duplicates to review.</p>}
    </>}
  </PageCard>;
}

function RefundMatchReviewList() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['refund-match-review'], queryFn: () => briefingApi.refundMatchReview() });
  const resolve = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'accept' | 'dismiss' }) => briefingApi.resolveRefundMatch(id, action),
    // Accepting links the refund as evidence against a purchase, which can
    // change refund-netting in every spending total; dismissing only clears
    // this review item. Invalidate broadly in both cases rather than
    // special-casing — a stale total is worse than one extra refetch.
    onSuccess: () => invalidateSpendingQueries(client),
  });
  return <PageCard title="Refund matches">
    <p className="text-sm text-muted mb-3">A likely purchase for an unlinked refund, based on matching merchant, currency, and amount within 180 days. Confirm to link it as evidence, or dismiss if it's wrong.</p>
    {resolve.isError && <p role="alert" className="text-destructive">Couldn’t update this match. Please try again.</p>}
    {query.isError ? <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div> : !query.data ? <div role="status"><span className="sr-only">Loading refund matches…</span><Skeleton className="h-20 w-full" /></div> : <>
      <p className="text-sm text-muted">{query.data.total} refund matches need review</p>
      {query.data.items.map(item => <div key={item.refund_transaction_id} className="py-4 border-b border-border last:border-0 space-y-2">
        <p>{item.refund.merchant || 'Unnamed refund'} <span className="text-muted">· {item.refund.date || 'Date unknown'} · {formatMoney(item.refund.amount)}</span></p>
        <p className="text-sm text-muted">Likely refunds <Link className="text-teal min-h-11 inline-flex items-center" to={`/transactions/${item.candidate_purchase.transaction_id}?returnTo=${encodeURIComponent('/review')}`}>{item.candidate_purchase.merchant || 'Unnamed transaction'} · {item.candidate_purchase.date || 'Date unknown'} · {formatMoney(item.candidate_purchase.amount)}</Link></p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-11" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: item.refund_transaction_id, action: 'accept' })}>Confirm match</Button>
          <Button variant="ghost" className="min-h-11" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: item.refund_transaction_id, action: 'dismiss' })}>Dismiss</Button>
        </div>
      </div>)}
      {!query.data.items.length && <p className="py-4 text-muted">No refund matches to review.</p>}
    </>}
  </PageCard>;
}

function RecurringReviewList() {
  const client = useQueryClient();
  const [offset, setOffset] = useState(0);
  const query = useQuery({ queryKey: ['recurring-review', offset], queryFn: () => briefingApi.recurringReview(offset) });
  const resolve = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'dismiss' }) => briefingApi.resolveRecurring(id, action),
    onSuccess: async () => {
      // Accepting creates a tracked schedule (a new confirmed commitment for
      // Plan's forecast); both actions clear this suggestion from Explore's
      // Recurring mode too.
      await invalidateSpendingQueries(client);
    },
  });
  return <PageCard title="Recurring suggestions">
    <p className="text-sm text-muted mb-3">These patterns may repeat. Accept to track a schedule, then review its billing date and amount. Provider billing is unchanged. Dismissal handles this suggestion; later patterns may still appear.</p>
    {resolve.isError && <div role="alert" className="text-destructive">
      <p>{resolve.error instanceof Error ? resolve.error.message : 'Could not update this suggestion. Try again.'}</p>
      <Button variant="outline" className="min-h-11" onClick={() => void query.refetch()}>Refresh suggestions</Button>
    </div>}
    {resolve.isSuccess && <p role="status" className="py-2">
      {resolve.data.subscription_id != null ? <>Schedule saved. <Link className="text-teal min-h-11 inline-flex items-center" to={`/plan?subscription=${resolve.data.subscription_id}`}>Review billing details</Link></> : 'Suggestion dismissed.'}
    </p>}
    {query.isError ? <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div> : !query.data ? <div role="status"><span className="sr-only">Loading recurring suggestions…</span><Skeleton className="h-20 w-full" /></div> : <>
      <p className="text-sm text-muted">{query.data.total} pending suggestions</p>
      {query.data.items.map(item => <div key={item.id} className="py-4 border-b border-border last:border-0 space-y-2">
        <p>{item.merchant}</p><p className="text-sm text-muted">{frequencyLabel(item.frequency)} · Inferred pattern</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-11" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: item.id, action: 'accept' })}>Accept schedule</Button>
          <Button variant="ghost" className="min-h-11" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: item.id, action: 'dismiss' })}>Dismiss suggestion</Button>
        </div>
      </div>)}
      {!query.data.items.length && <p className="py-4 text-muted">{query.data.total ? 'No suggestions on this page. Return to an earlier page.' : 'No pending recurring suggestions.'}</p>}
    </>}
    <nav aria-label="Recurring suggestion pages" className="flex justify-between gap-3 pt-4">
      <Button variant="outline" className="min-h-11" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous suggestions</Button>
      <Button variant="outline" className="min-h-11" disabled={!query.data || query.isError || offset + 50 >= query.data.total} onClick={() => setOffset(offset + 50)}>Next suggestions</Button>
    </nav>
  </PageCard>;
}
