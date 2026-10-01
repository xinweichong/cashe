import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { briefingApi, formatMoney } from '@/api/briefing';
import { ListGroup } from '@/components/ui/list';
import { NavBar } from '@/components/ui/nav-bar';
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
  // A pushed page (P3): the back button names where it returns to.
  const backLabel = back.startsWith('/explore') ? 'Explore' : back.startsWith('/activity') || back.startsWith('/transactions') ? 'Activity' : back.startsWith('/review') ? 'Review' : back.startsWith('/plan') ? 'Plan' : 'Home';
  const title = `${[search.get('merchant'), search.get('category')].filter(Boolean).join(' · ') || 'Spending'} evidence`;
  return <div className="mx-auto max-w-3xl">
    <NavBar title={title} back={{ label: backLabel, to: back }} />
    <div className="space-y-4 px-4 pb-8 pt-3">
      <p className="px-1 text-sm text-muted">{search.get('start')}–{search.get('end')} · {search.get('measure') || 'spending'}</p>
      {query.isError ? <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div> : !query.data ? (query.isLoading ? <div role="status"><span className="sr-only">Loading supporting transactions…</span><Skeleton className="h-40 w-full rounded-group" /></div> : <p role="status">Choose a period from your briefing.</p>) : <ListGroup
        title={`${query.data.total} supporting records`}
        footer={query.data.total > 50 && <span className="flex items-center justify-between gap-2">
          <Button variant="ghost" className="text-teal" disabled={!offset} onClick={() => move(Math.max(0, offset - 50))}>Previous</Button>
          <span>Page {Math.floor(offset / 50) + 1}</span>
          <Button variant="ghost" className="text-teal" disabled={offset + 50 >= query.data.total} onClick={() => move(offset + 50)}>Next</Button>
        </span>}
      >
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
        {!query.data.items.length && <p className="p-4 text-muted">No records match this period and filter.</p>}
      </ListGroup>}
    </div>
  </div>;
}
