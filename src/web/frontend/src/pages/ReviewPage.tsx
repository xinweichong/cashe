import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { NavBar } from '@/components/ui/nav-bar';
import { useIsPhone } from '@/hooks/useIsPhone';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { briefingApi, formatMoney, type DuplicateSide } from '@/api/briefing';
import { PageCard } from '@/components/ui/cards';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { invalidateSpendingQueries } from '@/hooks/useTransactions';
import { frequencyLabel } from '@/lib/subscriptionFrequency';
import { ListGroup, ListRow } from '@/components/ui/list';
import { CheckCircle2 } from 'lucide-react';
import { formatDate } from '@/lib/utils';

const sourceLabels: Record<string, string> = { telegram_nl: 'Telegram entry', gmail: 'Gmail', wallet_request: 'Wallet request', apple_wallet: 'Apple Wallet' };
const effectLabels: Record<string, string> = { trip: 'Trip assignment', recurring: 'Recurring analysis', notification: 'Transaction notification', suggestion: 'Recurring suggestion' };

/** A group's explanation, folded away until asked for (progressive disclosure). */
function About({ children }: { children: ReactNode }) {
  return (
    <details className="mb-2 text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-teal">About this</summary>
      <p className="max-w-prose text-muted">{children}</p>
    </details>
  );
}

/** True once a group has had items, so resolving the last one keeps its
 * confirmation and Undo on screen instead of the group vanishing. */
function useSeen(hasItems: boolean): boolean {
  const [seen, setSeen] = useState(false);
  if (hasItems && !seen) setSeen(true);
  return seen || hasItems;
}

const count = (n: number, one: string, many: string, verb: [string, string] = ['needs', 'need']) => `${n} ${n === 1 ? one : many} ${n === 1 ? verb[0] : verb[1]} review`;

export function ReviewPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const isPhone = useIsPhone();
  const [includeHandled, setIncludeHandled] = useState(false);
  const [page, setPage] = useState(0);
  const query = useQuery({ queryKey: ['capture-review', page, includeHandled], queryFn: async () => {
    const [capture, followups] = await Promise.all([briefingApi.captureIssues(page * 50, includeHandled), briefingApi.followups(page * 50)]);
    return { capture, followups };
  } });
  const retry = useMutation({ mutationFn: ({ id, type }: { id: number; type: 'capture' | 'followup' }) => type === 'capture' ? briefingApi.retryCapture(id) : briefingApi.retryFollowup(id), onSuccess: () => invalidateSpendingQueries(client) });
  const resolve = useMutation({ mutationFn: ({ id, handled }: { id: number; handled: boolean }) => briefingApi.resolveCapture(id, handled), onSuccess: () => invalidateSpendingQueries(client) });
  // The groups' own first-page queries (same keys, so no extra requests):
  // when every one is loaded and empty, the page says so once.
  const [search] = useSearchParams();
  const spendingOffset = Number(search.get('spending_offset')) || 0;
  const spending = useQuery({ queryKey: ['spending-review', spendingOffset], queryFn: () => briefingApi.spendingReview(spendingOffset) });
  const duplicates = useQuery({ queryKey: ['duplicate-review'], queryFn: () => briefingApi.duplicateReview() });
  const refunds = useQuery({ queryKey: ['refund-match-review'], queryFn: () => briefingApi.refundMatchReview() });
  const recurring = useQuery({ queryKey: ['recurring-review', 0], queryFn: () => briefingApi.recurringReview(0) });
  const captureSeen = useSeen(!!query.data && (query.data.capture.length > 0 || page > 0));
  const followupSeen = useSeen(!!query.data && (query.data.followups.length > 0 || page > 0));
  const allClear = !!query.data && !captureSeen && !followupSeen
    && [spending.data, duplicates.data, refunds.data, recurring.data].every((d) => d && d.total === 0)
    && spendingOffset === 0;
  return <div className="mx-auto max-w-3xl md:px-2">
    <NavBar large title="Review" back={isPhone ? { label: 'Back', onClick: () => navigate(-1) } : undefined} />
    <div className="space-y-6 px-4 pb-8">
    <p className="-mt-1 px-1 text-muted">Purchases, possible subscriptions and captured messages that need a decision.</p>
    {allClear && (
      <ListGroup>
        <ListRow leading={<CheckCircle2 aria-hidden className="h-5 w-5 text-success" />} title="All clear" subtitle="Nothing needs review right now." />
      </ListGroup>
    )}
    <SpendingReviewList />
    <DuplicateReviewList />
    <RefundMatchReviewList />
    <RecurringReviewList />
    {resolve.isError && <p role="alert" className="text-destructive">Couldn’t update this entry. Please try again.</p>}
    {retry.isError && <p role="alert" className="text-destructive">Couldn’t queue the retry. Please try again.</p>}
    {retry.isSuccess && <p role="status">Retry queued. Processing normally runs within two minutes.</p>}
    {query.isError ? <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div> : !query.data ? <div role="status"><span className="sr-only">Loading capture review…</span><Skeleton className="h-20 w-full" /></div> : <>
      {(captureSeen || includeHandled) && <PageCard title="Captured messages">
        <About>After entering a missing transaction or deciding no entry is needed, mark the Telegram input handled. Its original input and processing status are retained.</About>
        {query.data.capture.map(item => <div key={item.id} className="py-4 border-b border-border last:border-0 flex items-center gap-4 justify-between"><div><p>{sourceLabels[item.source] || 'Bank alert'} · {item.status}{item.handled ? ' · Handled' : ''}</p><p className="text-sm text-muted">{item.source === 'telegram_nl' ? 'No draft was completed. Use /add or send a new entry in Telegram. Parsing is not retried automatically.' : item.status === 'unrecognized' ? 'The request could not be parsed. Check the source or Shortcut fields before retrying.' : item.attempts >= 5 ? 'Automatic retries have stopped. Retry after resolving the cause.' : 'Pending or temporarily failed processing.'}</p></div>{item.source === 'telegram_nl' ? <Button variant="outline" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: item.id, handled: !item.handled })}>{item.handled ? 'Return to Review' : 'Mark handled'}</Button> : <Button variant="outline" disabled={retry.isPending} onClick={() => retry.mutate({ id: item.id, type: 'capture' })}>Retry</Button>}</div>)}
        {!query.data.capture.length && <p className="text-muted">No capture issues on this page.</p>}
      </PageCard>}
      {followupSeen && <PageCard title="Transaction follow-ups">
        {query.data.followups.map(item => <div key={item.id} className="py-4 border-b border-border last:border-0 flex items-center gap-4 justify-between"><div><p>{effectLabels[item.kind] || 'Follow-up'} · {item.status}</p><Link to={`/transactions/${item.transaction_id}`} className="text-teal min-h-11 inline-flex items-center">Open transaction</Link><p className="text-sm text-muted">{item.attempts >= 5 ? 'Automatic retries have stopped.' : 'The transaction is stored; this follow-up is pending.'}</p></div><Button variant="outline" disabled={retry.isPending} onClick={() => retry.mutate({ id: item.id, type: 'followup' })}>Retry</Button></div>)}
        {!query.data.followups.length && <p className="text-muted">No pending follow-ups on this page.</p>}
      </PageCard>}
      {(page > 0 || query.data.capture.length >= 50 || query.data.followups.length >= 50) && <div className="flex justify-between items-center"><Button variant="ghost" className="min-h-11 text-teal" disabled={!page} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-sm text-muted">Page {page + 1}</span><Button variant="ghost" className="min-h-11 text-teal" disabled={query.data.capture.length < 50 && query.data.followups.length < 50} onClick={() => setPage(page + 1)}>Next</Button></div>}
      <label className="flex min-h-11 items-center gap-2 px-1 text-sm text-muted"><input type="checkbox" checked={includeHandled} onChange={event => { setIncludeHandled(event.target.checked); setPage(0); }} />Show handled Telegram entries</label>
      <p className="px-1 text-sm text-muted">Up to 50 items per group per page. <Link className="inline-flex min-h-11 items-center text-teal" to="/settings">Manage connections</Link></p>
    </>}
    </div>
  </div>;
}

function SpendingReviewList() {
  const [search, setSearch] = useSearchParams();
  const requested = Number(search.get('spending_offset'));
  const offset = Number.isSafeInteger(requested) && requested >= 0 ? requested : 0;
  const query = useQuery({ queryKey: ['spending-review', offset], queryFn: () => briefingApi.spendingReview(offset) });
  const move = (next: number) => { const value = new URLSearchParams(search); value.set('spending_offset', String(next)); setSearch(value); };
  const returnTo = `/review${search.size ? `?${search}` : ''}`;
  const seen = useSeen(!!query.data && (query.data.total > 0 || offset > 0));
  if (query.data && !seen) return null;
  const reasons = {
    missing_date: 'The date is missing or unreadable; period comparisons remain unavailable.',
    unresolved_money: 'The amount or currency conversion cannot be resolved. Check the original amount and exchange rate.',
    unknown_type: 'The transaction type is not recognized as spending, income, or a refund.',
    missing_merchant: 'No merchant is recorded for this transaction.',
    missing_category: 'No category is recorded for this transaction.',
  };
  return <PageCard title="Spending records">
    <About>Across all recorded dates. These records can make totals incomplete. Existing indicative conversions are labeled in reports and are not included here.</About>
    {query.isError ? <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div> : !query.data ? <div role="status"><span className="sr-only">Loading spending review…</span><Skeleton className="h-20 w-full" /></div> : <>
      {!!query.data.total && <p className="text-sm text-muted">{count(query.data.total, 'record', 'records')}</p>}
      {query.data.items.map(item => <div key={item.id} className="py-4 border-b border-border last:border-0 space-y-2">
        <p>{item.merchant || 'Unnamed transaction'} <span className="text-muted">· {item.date ? formatDate(item.date) : 'Date unknown'} · {item.category}</span></p>
        <ul className="text-sm text-muted space-y-1">{item.reasons.map(reason => <li key={reason}>{reasons[reason]}</li>)}</ul>
        <Link className="text-teal min-h-11 inline-flex items-center" to={`/transactions/${item.id}?returnTo=${encodeURIComponent(returnTo)}`}>Open transaction</Link>
      </div>)}
      {!query.data.items.length && <p className="py-4 text-muted">{query.data.total ? 'No spending records on this page. Return to an earlier page.' : 'No unresolved spending records.'}</p>}
    </>}
    <nav aria-label="Spending review pages" className="flex justify-between items-center gap-3 pt-4">
      <Button variant="ghost" className="min-h-11 text-teal" aria-label="Previous spending records" disabled={!offset} onClick={() => move(Math.max(0, offset - 50))}>Previous</Button>
      <Button variant="ghost" className="min-h-11 text-teal" aria-label="Next spending records" disabled={!query.data || query.isError || offset + 50 >= query.data.total} onClick={() => move(offset + 50)}>Next</Button>
    </nav>
  </PageCard>;
}

function duplicateSideLabel(side: DuplicateSide): string {
  return `${side.merchant || 'Unnamed transaction'} · ${side.date ? formatDate(side.date) : 'Date unknown'} · ${side.amount ? formatMoney(side.amount) : 'Amount unresolved'}`;
}

function DuplicateReviewList() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['duplicate-review'], queryFn: () => briefingApi.duplicateReview() });
  const dismiss = useMutation({
    mutationFn: ({ aId, bId }: { aId: number; bId: number }) => briefingApi.dismissDuplicate(aId, bId),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['duplicate-review'] }); },
  });
  const seenDuplicates = useSeen(!!query.data && query.data.total > 0);
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
  if (query.data && !seenDuplicates) return null;
  return <PageCard title="Possible duplicates">
    <About>Two records from different sources that look like the same purchase. Keep whichever one you want as the record — its evidence, trip, and any billing match carry over. Keep separate if they're actually different.</About>
    {merge.isSuccess && !undo.isSuccess && <p role="status" className="py-2">Merged. <Button type="button" variant="link" size="sm" className="h-auto min-h-11 p-0 align-baseline" disabled={undo.isPending} onClick={() => undo.mutate(merge.data.merge_id)}>Undo</Button></p>}
    {undo.isSuccess && <p role="status" className="py-2">Merge undone.</p>}
    {(dismiss.isError || merge.isError || undo.isError) && <p role="alert" className="text-destructive">Couldn’t update this pair. Please try again.</p>}
    {query.isError ? <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div> : !query.data ? <div role="status"><span className="sr-only">Loading possible duplicates…</span><Skeleton className="h-20 w-full" /></div> : <>
      {!!query.data.total && <p className="text-sm text-muted">{count(query.data.total, 'possible duplicate', 'possible duplicates')}</p>}
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
  const seenRefunds = useSeen(!!query.data && query.data.total > 0);
  if (query.data && !seenRefunds) return null;
  return <PageCard title="Refund matches">
    <About>A likely purchase for an unlinked refund, based on matching merchant, currency, and amount within 180 days. Confirm to link it as evidence, or dismiss if it's wrong.</About>
    {resolve.isError && <p role="alert" className="text-destructive">Couldn’t update this match. Please try again.</p>}
    {query.isError ? <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div> : !query.data ? <div role="status"><span className="sr-only">Loading refund matches…</span><Skeleton className="h-20 w-full" /></div> : <>
      {!!query.data.total && <p className="text-sm text-muted">{count(query.data.total, 'refund match', 'refund matches')}</p>}
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
  const seenRecurring = useSeen(!!query.data && (query.data.total > 0 || offset > 0));
  const resolve = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'dismiss' }) => briefingApi.resolveRecurring(id, action),
    onSuccess: async () => {
      // Accepting creates a tracked schedule (a new confirmed commitment for
      // Plan's forecast); both actions clear this suggestion from Explore's
      // Recurring mode too.
      await invalidateSpendingQueries(client);
    },
  });
  if (query.data && !seenRecurring) return null;
  return <PageCard title="Recurring suggestions">
    <About>These patterns may repeat. Accept to track a schedule, then review its billing date and amount. Provider billing is unchanged. Dismissal handles this suggestion; later patterns may still appear.</About>
    {resolve.isError && <div role="alert" className="text-destructive">
      <p>{resolve.error instanceof Error ? resolve.error.message : 'Could not update this suggestion. Try again.'}</p>
      <Button variant="outline" className="min-h-11" onClick={() => void query.refetch()}>Refresh suggestions</Button>
    </div>}
    {resolve.isSuccess && <p role="status" className="py-2">
      {resolve.data.subscription_id != null ? <>Schedule saved. <Link className="text-teal min-h-11 inline-flex items-center" to={`/plan?subscription=${resolve.data.subscription_id}`}>Review billing details</Link></> : 'Suggestion dismissed.'}
    </p>}
    {query.isError ? <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div> : !query.data ? <div role="status"><span className="sr-only">Loading recurring suggestions…</span><Skeleton className="h-20 w-full" /></div> : <>
      {!!query.data.total && <p className="text-sm text-muted">{query.data.total} pending {query.data.total === 1 ? 'suggestion' : 'suggestions'}</p>}
      {query.data.items.map(item => <div key={item.id} className="py-4 border-b border-border last:border-0 space-y-2">
        <p>{item.merchant}</p><p className="text-sm text-muted">{frequencyLabel(item.frequency)} · Inferred pattern</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-11" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: item.id, action: 'accept' })}>Accept schedule</Button>
          <Button variant="ghost" className="min-h-11" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: item.id, action: 'dismiss' })}>Dismiss suggestion</Button>
        </div>
      </div>)}
      {!query.data.items.length && <p className="py-4 text-muted">{query.data.total ? 'No suggestions on this page. Return to an earlier page.' : 'No pending recurring suggestions.'}</p>}
    </>}
    {(offset > 0 || (query.data?.total ?? 0) > 50) && <nav aria-label="Recurring suggestion pages" className="flex justify-between gap-3 pt-4">
      <Button variant="ghost" className="min-h-11 text-teal" aria-label="Previous suggestions" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button>
      <Button variant="ghost" className="min-h-11 text-teal" aria-label="Next suggestions" disabled={!query.data || query.isError || offset + 50 >= query.data.total} onClick={() => setOffset(offset + 50)}>Next</Button>
    </nav>}
  </PageCard>;
}
