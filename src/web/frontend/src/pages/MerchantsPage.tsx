import { useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type MerchantSummaryV2 } from '@/api/client';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { NavBar } from '@/components/ui/nav-bar';
import { ListGroup, ListRow } from '@/components/ui/list';
import { ListDetail } from '@/components/layout/ListDetail';
import { MerchantProfile } from '@/components/merchants/MerchantProfile';
import { Search } from 'lucide-react';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { ALL_TAGS } from '@/lib/merchants';
import { SPECTRUM_PALETTE } from '@/lib/chartTheme';
import { formatCurrency } from '@/lib/utils';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

function merchantInitialColor(name: string): string {
  const idx = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % SPECTRUM_PALETTE.length;
  return SPECTRUM_PALETTE[idx];
}

const SORT_OPTIONS = [
  { value: 'total_spent',       label: 'Total Spent' },
  { value: 'transaction_count', label: 'Transactions' },
  { value: 'last_seen',         label: 'Last Seen' },
  { value: 'merchant_name',     label: 'Name' },
];

export function MerchantsPage() {
  const { merchantName } = useParams<{ merchantName?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const merchantsPath = location.pathname.startsWith('/explore/') ? '/explore/merchants' : '/merchants';

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('total_spent');
  const [tagFilter, setTagFilter] = useState('');
  // The open profile is the route's :merchantName; opening and closing navigate.
  const selectedMerchant = merchantName ?? null;
  const debouncedSearch = useDebouncedValue(search);

  const { data: merchants = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['merchant-intelligence-v2', sortBy, tagFilter, debouncedSearch],
    queryFn: () =>
      api.getMerchantListV2({
        sort_by: sortBy as 'total_spent' | 'transaction_count' | 'last_seen' | 'merchant_name',
        tag: tagFilter || undefined,
        search: debouncedSearch || undefined,
        limit: 100,
      }),
    staleTime: 30_000,
  });

  const handleCloseProfile = () => {
    navigate(`${merchantsPath}${location.search}`);
  };

  const handleRowClick = (m: MerchantSummaryV2) => {
    if (selectedMerchant === m.merchant) {
      handleCloseProfile();
    } else {
      navigate(`${merchantsPath}/${encodeURIComponent(m.merchant)}${location.search}`);
    }
  };

  // Merchants is a list with details (P6/P7): pushed pages on a phone, a
  // split view on md+. The table's columns become grouped rows that fit a
  // list column; category and tags live in the merchant's profile.
  const totalSpent = merchants.reduce((sum, m) => sum + m.total.minor_units / 100, 0);
  const list = (
    <div>
      <NavBar title="Merchants" back={{ label: 'Explore', to: '/explore' }} />
      <div className="space-y-3 px-4 pb-8 pt-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            type="search"
            data-list-search=""
            aria-label="Search merchants"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search merchants"
            className="h-11 rounded-[10px] border-0 bg-fill-press pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Sort merchants" value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="select-field text-xs">
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {ALL_TAGS.map((tag) => (
            <ChoiceChip key={tag} selected={tagFilter === tag} onClick={() => setTagFilter(tagFilter === tag ? '' : tag)}>{tag}</ChoiceChip>
          ))}
        </div>
        {isError ? (
          <LoadFailed onRetry={() => refetch()} />
        ) : isLoading ? (
          <Skeleton className="h-64 rounded-group" />
        ) : merchants.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">Nothing captured yet.</p>
        ) : (
          <ListGroup title={`${merchants.length} merchants`} footer={`${formatCurrency(totalSpent)} across all of them.`}>
            {merchants.map((m) => (
              <ListRow
                key={m.merchant}
                onClick={() => handleRowClick(m)}
                selected={selectedMerchant === m.merchant}
                leading={<span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold"
                  style={{ background: `${merchantInitialColor(m.merchant)}22`, color: merchantInitialColor(m.merchant) }}>
                  {m.display_name.charAt(0).toUpperCase()}
                </span>}
                title={m.display_name}
                subtitle={`${m.transaction_count} ${m.transaction_count === 1 ? 'visit' : 'visits'} · ${m.last_seen ?? 'not seen yet'}${m.category ? ` · ${m.category}` : ''}`}
                amount={formatCurrency(m.total.minor_units / 100)}
              />
            ))}
          </ListGroup>
        )}
      </div>
    </div>
  );

  return (
    <ListDetail
      listLabel="Merchants"
      backLabel="Merchants"
      list={list}
      detail={selectedMerchant && <MerchantProfile key={selectedMerchant} merchant={selectedMerchant} onClose={handleCloseProfile} />}
      onClose={handleCloseProfile}
      emptyDetail={<p className="flex h-full items-center justify-center p-8 text-center text-sm text-muted">Choose a merchant to see its profile.</p>}
    />
  );
}
