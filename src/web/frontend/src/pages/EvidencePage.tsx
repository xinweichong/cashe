import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { briefingApi, formatMoney } from '@/api/briefing';
import { PageCard } from '@/components/ui/cards';
import { Button } from '@/components/ui/button';
import { LoadFailed } from '@/components/ui/LoadFailed';

export function EvidencePage() {
  const [search, setSearch] = useSearchParams();
  const params = new URLSearchParams(search);
  params.set('limit', '50');
  const offset = Math.max(0, Number(search.get('offset')) || 0);
  params.set('offset', String(offset));
  const query = useQuery({ queryKey: ['spending-evidence', params.toString()], queryFn: () => briefingApi.evidence(params), enabled: search.has('start') && search.has('end') });
  const move = (next: number) => { const value = new URLSearchParams(search); value.set('offset', String(next)); setSearch(value); };
  return <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
    <header><Link to="/home" className="text-teal min-h-11 inline-flex items-center">Back to briefing</Link><h1 className="text-2xl font-semibold">{search.get('category') || 'Spending'} evidence</h1><p className="text-muted">{search.get('start')}–{search.get('end')} · {search.get('measure') || 'spending'}</p></header>
    {query.isError ? <div role="alert"><LoadFailed onRetry={() => void query.refetch()} /></div> : !query.data ? <p role="status">{query.isLoading ? 'Loading supporting transactions…' : 'Choose a period from your briefing.'}</p> : <PageCard title={`${query.data.total} supporting records`}>
      {query.data.items.map(item => <Link to={`/transactions/${item.id}?returnTo=${encodeURIComponent(`/evidence?${search}`)}`} key={item.id} className="flex justify-between gap-4 py-4 border-b border-border last:border-0 hover:underline"><div>{item.merchant || 'Unnamed transaction'}<p className="text-sm text-muted">{item.date || 'Date unknown'} · {item.category} · {item.type}</p></div><div>{item.amount ? formatMoney(item.amount) : 'Amount unresolved'}{item.conversion_status === 'indicative' && <p className="text-muted text-sm">Indicative conversion</p>}</div></Link>)}
      {!query.data.items.length && <p className="text-muted py-4">No records match this period and filter.</p>}
      <div className="flex items-center justify-between pt-4"><Button variant="outline" disabled={!offset} onClick={() => move(Math.max(0, offset - 50))}>Previous</Button><span className="text-sm text-muted">Page {Math.floor(offset / 50) + 1}</span><Button variant="outline" disabled={offset + 50 >= query.data.total} onClick={() => move(offset + 50)}>Next</Button></div>
    </PageCard>}
  </div>;
}
