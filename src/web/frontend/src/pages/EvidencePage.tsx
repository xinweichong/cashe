import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { briefingApi, formatMoney } from '@/api/briefing';
import { PageCard } from '@/components/ui/cards';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { ActivityRowShell } from '@/components/ui/ActivityRowShell';

export function EvidencePage() {
  const [search, setSearch] = useSearchParams();
  const params = new URLSearchParams(search);
  params.delete('returnTo');
  params.set('limit', '50');
  const offset = Math.max(0, Number(search.get('offset')) || 0);
  params.set('offset', String(offset));
  const query = useQuery({ queryKey: ['spending-evidence', params.toString()], queryFn: () => briefingApi.evidence(params), enabled: search.has('start') && search.has('end') });
  // Only same-origin paths; anything else falls back to the briefing.
  const returnTo = search.get('returnTo');
  const back = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') && !returnTo.includes('\\') ? returnTo : '/home';
  const move = (next: number) => { const value = new URLSearchParams(search); value.set('offset', String(next)); setSearch(value); };
  return <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
    <header className="space-y-1">
      <Link to={back} className="text-teal min-h-11 inline-flex items-center">Back to briefing</Link>
      <h1 className="font-display text-2xl font-semibold">{[search.get('merchant'), search.get('category')].filter(Boolean).join(' · ') || 'Spending'} evidence</h1>
      <p className="text-muted">{search.get('start')}–{search.get('end')} · {search.get('measure') || 'spending'}</p>
    </header>
    {query.isError ? <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div> : !query.data ? (query.isLoading ? <div role="status"><span className="sr-only">Loading supporting transactions…</span><Skeleton className="h-40 w-full" /></div> : <p role="status">Choose a period from your briefing.</p>) : <PageCard title={`${query.data.total} supporting records`} contentClassName="p-0">
      {query.data.items.map(item => <ActivityRowShell
        key={item.id}
        href={`/transactions/${item.id}?returnTo=${encodeURIComponent(`/evidence?${search}`)}`}
        category={item.category}
        isIncome={item.type === 'income'}
        title={item.merchant || 'Unnamed transaction'}
        metaPrimary={`${item.date || 'Date unknown'} · ${item.type}`}
        amount={item.amount ? formatMoney(item.amount) : 'Amount unresolved'}
        amountSub={item.conversion_status === 'indicative' ? 'Indicative conversion' : undefined}
      />)}
      {!query.data.items.length && <p className="text-muted p-4">No records match this period and filter.</p>}
      <div className="flex items-center justify-between p-4"><Button variant="outline" disabled={!offset} onClick={() => move(Math.max(0, offset - 50))}>Previous</Button><span className="text-sm text-muted">Page {Math.floor(offset / 50) + 1}</span><Button variant="outline" disabled={offset + 50 >= query.data.total} onClick={() => move(offset + 50)}>Next</Button></div>
    </PageCard>}
  </div>;
}
