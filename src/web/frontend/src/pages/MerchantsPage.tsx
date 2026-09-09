import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { api, type MerchantSummary } from '@/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/StatCard';
import { MerchantProfile } from '@/components/merchants/MerchantProfile';
import { slideInRightVariants } from '@/lib/motionPresets';
import { Search } from 'lucide-react';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { TAG_COLORS, ALL_TAGS, formatSGD } from '@/lib/merchants';
import { SPECTRUM_PALETTE } from '@/lib/chartTheme';
import { getCategoryColor } from '@/lib/utils';

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
  const [selectedMerchant, setSelectedMerchant] = useState<string | null>(merchantName ?? null);

  // Sync URL param → panel
  useEffect(() => {
    if (merchantName) setSelectedMerchant(merchantName);
  }, [merchantName]);

  const { data: merchants = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['merchant-intelligence', sortBy, tagFilter, search],
    queryFn: () =>
      api.getMerchantIntelligenceList({
        sort_by: sortBy as 'total_spent' | 'transaction_count' | 'last_seen' | 'merchant_name',
        tag: tagFilter || undefined,
        search: search || undefined,
        limit: 100,
      }),
    staleTime: 30_000,
  });

  const handleCloseProfile = () => {
    setSelectedMerchant(null);
    navigate(`${merchantsPath}${location.search}`);
  };

  const handleRowClick = (m: MerchantSummary) => {
    if (selectedMerchant === m.merchant) {
      handleCloseProfile();
    } else {
      setSelectedMerchant(m.merchant);
      navigate(`${merchantsPath}/${encodeURIComponent(m.merchant)}${location.search}`);
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Merchant list */}
      <div
        className={`flex-1 overflow-y-auto p-4 md:p-6 space-y-4 ${
          selectedMerchant ? 'hidden md:block' : ''
        }`}
      >
        <div className="flex flex-col gap-1 pb-5 border-b border-border">
          <div className="text-xs uppercase tracking-[0.22em] text-muted font-mono font-semibold">
            Merchants
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground font-display">
            {merchants.length} tracked.
          </h1>
        </div>

        {/* Summary cards */}
        {!isLoading && merchants.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard
              label="Merchants"
              value={merchants.length}
              color="default"
            />
            <StatCard
              label="Total Spend"
              value={`$${merchants.reduce((sum, m) => sum + m.total_sgd, 0).toFixed(0)}`}
              color="warm"
            />
            {merchants.length > 0 && (
              <StatCard
                label="Top Merchant"
                value={merchants[0].merchant}
                subtext={formatSGD(merchants[0].total_sgd)}
              />
            )}
          </div>
        )}

        {/* Filters */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search merchants…"
              className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-border rounded-md text-foreground placeholder:text-muted"
            />
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="select-field text-xs"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>

            {ALL_TAGS.map((tag) => (
              <button
                key={tag}
                onClick={() => setTagFilter(tagFilter === tag ? '' : tag)}
                className="focus:outline-none"
              >
                <Badge
                  variant="outline"
                  className={`cursor-pointer transition-colors ${
                    tagFilter === tag
                      ? `${TAG_COLORS[tag]} border-current`
                      : 'border-border text-muted hover:text-foreground'
                  }`}
                >
                  {tag}
                </Badge>
              </button>
            ))}
          </div>
        </div>

        {/* Merchants table — Tier 3 bespoke card (bare Card + CardContent p-0) intentional:
             table headers/rows own their px-4 spacing and render edge-to-edge, consistent with
             TransactionsPage which also uses a bare <Card className="overflow-hidden">.
             Do NOT wrap in PageCard — its mandatory p-4 CardContent padding would break the layout. */}
        {isError ? (
          <LoadFailed onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="space-y-2 py-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : merchants.length === 0 ? (
          <div className="text-muted text-sm py-8 text-center">Nothing captured yet.</div>
        ) : (
          <div className="overflow-x-auto">
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted">
                    <th className="pl-3 pr-1 py-3" />
                    <th className="text-left px-4 py-3 font-medium">Merchant</th>
                    <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Category</th>
                    <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Tags</th>
                    <th className="text-right px-4 py-3 font-medium">Total</th>
                    <th className="text-right px-4 py-3 font-medium hidden sm:table-cell">Txns</th>
                    <th className="text-right px-4 py-3 font-medium hidden lg:table-cell">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {merchants.map((m) => (
                    <tr
                      key={m.merchant}
                      onClick={() => handleRowClick(m)}
                      className={`border-b border-border cursor-pointer hover:bg-foreground/5 transition-colors last:border-b-0 ${
                        selectedMerchant === m.merchant ? 'bg-foreground/10' : ''
                      }`}
                    >
                      <td className="py-2.5 pl-3 pr-1">
                        <div
                          className="w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold font-mono"
                          style={{
                            background: `${merchantInitialColor(m.merchant)}22`,
                            color: merchantInitialColor(m.merchant),
                          }}
                        >
                          {m.merchant.charAt(0).toUpperCase()}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground truncate max-w-[180px]">{m.merchant}</div>
                        <div className="font-mono text-[10px] text-muted uppercase tracking-[0.06em] mt-0.5 sm:hidden">
                          {m.transaction_count} txns · {m.last_seen ?? '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        {m.category ? (
                          <span
                            style={{
                              color: getCategoryColor(m.category),
                              background: `${getCategoryColor(m.category)}1F`,
                              padding: '2px 8px',
                              borderRadius: '9999px',
                              fontSize: '11px',
                              fontWeight: 600,
                              fontFamily: 'monospace',
                              display: 'inline-block',
                            }}
                          >
                            {m.category}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {(m.tags ?? []).map((tag) => (
                            <Badge
                              key={tag}
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 ${TAG_COLORS[tag] ?? 'text-muted'}`}
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-display font-bold text-foreground">
                        {formatSGD(m.total_sgd)}
                      </td>
                      <td className="px-4 py-3 text-right text-muted hidden sm:table-cell">
                        {m.transaction_count}
                      </td>
                      <td className="px-4 py-3 text-right text-muted hidden lg:table-cell">
                        {m.last_seen ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          </div>
        )}
      </div>

      {/* Profile panel — slide-over on desktop, full-screen on mobile */}
      <AnimatePresence>
        {selectedMerchant && (
          <motion.div
            className="w-full md:w-96 border-l border-border bg-card flex-shrink-0 overflow-hidden"
            variants={slideInRightVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <MerchantProfile
              merchant={selectedMerchant}
              onClose={handleCloseProfile}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
