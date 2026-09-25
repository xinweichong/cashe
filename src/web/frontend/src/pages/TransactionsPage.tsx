import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery, useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TransactionList } from '@/components/transactions/TransactionList';
import { TransactionFilters } from '@/components/transactions/TransactionFilters';
import { TransactionDetail } from '@/components/transactions/TransactionDetail';
import { TransactionForm } from '@/components/transactions/TransactionForm';
import { BulkActionBar } from '@/components/transactions/BulkActionBar';
import { useCategories } from '@/hooks/useCategories';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useBulkCorrectTransactions, useBulkUndoTransactions } from '@/hooks/useTransactions';
import { useToast } from '@/hooks/useToastContext';
import { api, type Transaction, type TransactionV2, type DailyTotalV2, type BulkTransactionResultItemV2 } from '@/api/client';
import { briefingApi } from '@/api/briefing';
import { slideInRightVariants, fadeUpVariants } from '@/lib/motionPresets';
import { localDayKey } from '@/lib/utils';
import { CheckSquare, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { HeroCard } from '@/components/ui/cards';
import { HeroAmount } from '@/components/ui/HeroAmount';
import { PhoneScreen, type Lens } from '@/components/layout/PhoneScreen';
import { DrillSheet } from '@/components/layout/DrillSheet';
import { useIsPhone } from '@/hooks/useIsPhone';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { Skeleton } from '@/components/ui/skeleton';

const PAGE_SIZE = 20;

type ActivityLens = 'all' | 'review' | 'income' | 'refund';

// Monday of the current local week through today, as YYYY-MM-DD.
function currentWeek(): { start: string; end: string } {
  const today = new Date();
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { start: key(monday), end: key(today) };
}

// v2 transactions carry canonical Money instead of flat amount/currency
// fields — convert at this page boundary so TransactionList/TransactionRow/
// TransactionDetail keep working against the existing v1-shaped Transaction,
// the same adapter pattern planHooks' goalV2ToLegacy established for R04.
function transactionV2ToLegacy(tx: TransactionV2): Transaction {
  return {
    id: tx.id,
    source: tx.source,
    source_id: '',
    amount: (tx.original.minor_units ?? 0) / 100,
    currency: tx.original.currency,
    exchange_rate: tx.conversion.rate !== null ? Number(tx.conversion.rate) : null,
    merchant: tx.merchant,
    description: tx.description,
    category: tx.category,
    transaction_date: tx.transaction_date ?? '',
    ingested_at: tx.ingested_at ?? '',
    type: tx.type,
  };
}

export function TransactionsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const activityPath = location.pathname.startsWith('/activity') ? '/activity' : '/transactions';
  const { transactionId } = useParams<{ transactionId?: string }>();
  const parsed = transactionId ? parseInt(transactionId, 10) : NaN;
  const selectedId = isNaN(parsed) ? undefined : parsed;

  const [searchParams, setSearchParams] = useSearchParams();
  // Filters are hydrated from the URL once on mount (lazy initializer), then
  // kept in sync back to it below — shareable/bookmarkable links, and the
  // exact filter state survives a full navigate-away-and-back (R09).
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [category, setCategory] = useState(() => searchParams.get('category') ?? 'all');
  const [startDate, setStartDate] = useState(() => searchParams.get('start') ?? '');
  const [endDate, setEndDate] = useState(() => searchParams.get('end') ?? '');
  const [type, setType] = useState(() => searchParams.get('type') ?? 'all');
  const [tripId, setTripId] = useState(() => searchParams.get('trip') ?? '');
  const [needsReview, setNeedsReview] = useState(() => searchParams.get('review') === '1');
  const [showForm, setShowForm] = useState(false);
  const isPhone = useIsPhone();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [week] = useState(currentWeek);
  const weekTotals = useQuery({
    queryKey: ['activity-week-totals', week.start, week.end],
    queryFn: () => api.getDailyTotalsV2(week.start, week.end),
    enabled: isPhone,
  });
  const { data: categories } = useCategories();
  const briefing = useQuery({ queryKey: ['home-briefing'], queryFn: briefingApi.home });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings(), staleTime: 30_000 });
  const { data: trips = [] } = useQuery({
    queryKey: ['trips'],
    queryFn: () => api.getTrips(),
    enabled: settings?.trips_enabled === true,
    staleTime: 30_000,
  });

  const returnTo = searchParams.get('returnTo');
  const listRef = useRef<HTMLDivElement>(null);
  const closeDetail = () => {
    if (returnTo && /^\/(evidence\?|review(\?|$)|home(\?|$)|explore(\/signals)?(\?|$)|\?|$)/.test(returnTo)) {
      navigate(returnTo);
      return;
    }
    const closedId = selectedId;
    navigate(`${activityPath}${location.search}`);
    // Return focus to the row that opened the detail, or the list if that
    // row no longer exists (deleted or filtered out).
    requestAnimationFrame(() => {
      const row = closedId !== undefined ? document.getElementById(`tx-row-${closedId}`) : null;
      (row ?? listRef.current)?.focus();
    });
  };
  // Consumes a one-time "open the add form" signal from a deep link, then
  // strips it from the URL — the URL mutation itself requires an effect
  // (it updates the router, an external system), and opening the form is
  // the same one-time signal-consumption step. Uses the functional updater
  // so it only removes `add`, never clobbering the filter params the sync
  // effect below writes in the same render pass.
  useEffect(() => {
    if (searchParams.get('add') === '1') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowForm(true);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('add');
        return next;
      }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Keep the URL in sync with filter state (shareable, and read back on a
  // fresh mount above). Replace, not push — filter changes shouldn't spam
  // browser history.
  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const set = (key: string, value: string) => { if (value) next.set(key, value); else next.delete(key); };
      set('q', debouncedSearch);
      set('category', category !== 'all' ? category : '');
      set('type', type !== 'all' ? type : '');
      set('trip', tripId);
      set('review', needsReview ? '1' : '');
      set('start', startDate);
      set('end', endDate);
      return next;
    }, { replace: true });
  }, [debouncedSearch, category, type, tripId, needsReview, startDate, endDate, setSearchParams]);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, refetch } =
    useInfiniteQuery({
      queryKey: ['transactions-v2', debouncedSearch, category, startDate, endDate, type, tripId, needsReview],
      queryFn: ({ pageParam = 0 }) => {
        const params: Record<string, string | number> = {
          limit: PAGE_SIZE,
          offset: pageParam as number,
        };
        if (debouncedSearch) params.merchant_search = debouncedSearch;
        if (category && category !== 'all') params.category = category;
        if (startDate) params.start_date = startDate;
        if (endDate) params.end_date = endDate;
        if (type && type !== 'all') params.type = type;
        if (tripId) params.trip_id = tripId;
        if (needsReview) params.needs_review = 'true';
        return api.getTransactionsV2(params);
      },
      initialPageParam: 0,
      getNextPageParam: (lastPage: TransactionV2[], allPages: TransactionV2[][]) => {
        if (lastPage.length < PAGE_SIZE) return undefined;
        return allPages.length * PAGE_SIZE;
      },
      placeholderData: keepPreviousData,
    });

  // Kept alongside the legacy-adapted txs — bulk actions (below) need each
  // row's revision, which the legacy Transaction shape doesn't carry.
  const txsV2 = useMemo(() => data?.pages.flat() ?? [], [data]);
  const txs = useMemo(() => txsV2.map(transactionV2ToLegacy), [txsV2]);
  const revisionById = useMemo(() => new Map(txsV2.map((tx) => [tx.id, tx.revision])), [txsV2]);

  // Use list data if available — only hit the single-tx endpoint for deep-links
  // where the transaction isn't in the loaded pages (e.g. direct URL navigation)
  const txFromList = selectedId !== undefined
    ? txs.find((tx) => tx.id === selectedId)
    : undefined;

  const { data: txFromQuery } = useQuery({
    queryKey: ['transaction-v2', selectedId],
    queryFn: async () => transactionV2ToLegacy(await api.getTransactionV2(selectedId!)),
    enabled: selectedId !== undefined && txFromList === undefined,
    staleTime: 30_000,
  });

  const selectedTransaction = txFromList ?? txFromQuery ?? null;

  // Daily totals are a separate shared-fact query over whatever date range
  // is currently on screen — never a client-side sum of loaded rows — so a
  // day split across an infinite-scroll page boundary always shows one
  // complete total (R09). Withheld while any row-narrowing filter is
  // active (search, category, type, trip, or needs-review), since the
  // shared fact has none of these and showing the full unfiltered day
  // total next to a filtered row subset would be misleading.
  const isFilterNarrowed = !!debouncedSearch || (category !== 'all' && !!category)
    || type !== 'all' || !!tripId || needsReview;
  const dayKeys = useMemo(
    () => Array.from(new Set(txs.map((tx) => localDayKey(tx.transaction_date)).filter((d) => d !== 'undated'))),
    [txs],
  );
  const rangeStart = dayKeys.length ? dayKeys.reduce((a, b) => (a < b ? a : b)) : undefined;
  const rangeEnd = dayKeys.length ? dayKeys.reduce((a, b) => (a > b ? a : b)) : undefined;
  const { data: dailyTotalsData } = useQuery({
    queryKey: ['transactions-daily-totals', rangeStart, rangeEnd],
    queryFn: () => api.getDailyTotalsV2(rangeStart!, rangeEnd!),
    enabled: !isFilterNarrowed && !!rangeStart && !!rangeEnd,
    placeholderData: keepPreviousData,
  });
  const dailyTotals = useMemo(() => {
    const map = new Map<string, DailyTotalV2>();
    if (!isFilterNarrowed) for (const t of dailyTotalsData ?? []) map.set(t.date, t);
    return map;
  }, [dailyTotalsData, isFilterNarrowed]);

  const handleCategoryChange = useCallback((v: string) => setCategory(v), []);
  const handleSearchChange = useCallback((v: string) => setSearch(v), []);
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Restore a scroll anchor after a full remount (browser back/forward, or
  // navigating away and returning) — R09. The scrollable list container
  // never unmounts across opening/closing the detail panel on the same
  // page, so scroll position already survives that case for free; this
  // covers the case a fresh TransactionsPage instance mounts with an empty
  // list and no scroll history. Tracks the topmost visible row's id
  // (not a raw pixel offset), so it's independent of how many pages
  // happen to be loaded when the anchor was saved vs. restored.
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const containerTop = el.getBoundingClientRect().top;
        const rows = el.querySelectorAll<HTMLElement>('[data-tx-row-id]');
        for (const row of rows) {
          if (row.getBoundingClientRect().top - containerTop >= -4) {
            sessionStorage.setItem('activity-scroll-anchor', row.dataset.txRowId ?? '');
            break;
          }
        }
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    if (restoredRef.current) return;
    const anchorId = sessionStorage.getItem('activity-scroll-anchor');
    if (!anchorId) { restoredRef.current = true; return; }
    if (isLoading) return; // wait for the first page before deciding anything
    if (txs.some((tx) => String(tx.id) === anchorId)) {
      scrollRef.current
        ?.querySelector(`[data-tx-row-id="${anchorId}"]`)
        ?.scrollIntoView({ block: 'start' });
      restoredRef.current = true;
    } else if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    } else if (!hasNextPage) {
      restoredRef.current = true; // anchor row no longer exists (deleted, or filtered out)
    }
  }, [txs, hasNextPage, isFetchingNextPage, isLoading, fetchNextPage]);

  // R09 sub-project 3: bulk selection/categorization + R05 relation
  // (type) controls. Each row's correction goes through the ordinary
  // per-transaction update path server-side (Storage.bulk_correct loops
  // update_transaction), so undo/revision-conflict semantics are exactly
  // the single-row ones, just applied per selected id.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lastBulkUndo, setLastBulkUndo] = useState<{ ids: number[]; revisions: Record<number, number> } | null>(null);
  const toast = useToast();
  const bulkCorrect = useBulkCorrectTransactions();
  const bulkUndo = useBulkUndoTransactions();

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => !prev);
    setSelectedIds(new Set());
    setShowForm(false);
  }, []);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleBulkResult = useCallback((results: BulkTransactionResultItemV2[]) => {
    const ok = results.filter((r) => r.status === 'ok');
    const conflicts = results.filter((r) => r.status === 'conflict');
    const errors = results.filter((r) => r.status === 'error');
    let message = `Updated ${ok.length}.`;
    if (conflicts.length) message += ` ${conflicts.length} skipped — edited elsewhere.`;
    if (errors.length) message += ` ${errors.length} failed.`;
    toast(message);
    setLastBulkUndo(
      ok.length ? { ids: ok.map((r) => r.id), revisions: Object.fromEntries(ok.map((r) => [r.id, r.revision!])) } : null,
    );
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, [toast]);

  const expectedRevisionsFor = useCallback((ids: number[]) => {
    const entries: [number, number][] = [];
    for (const id of ids) {
      const revision = revisionById.get(id);
      if (revision !== undefined) entries.push([id, revision]);
    }
    return Object.fromEntries(entries);
  }, [revisionById]);

  const handleBulkCategorize = useCallback((selectedCategory: string) => {
    const ids = Array.from(selectedIds);
    bulkCorrect.mutate(
      { transaction_ids: ids, category: selectedCategory, expected_revisions: expectedRevisionsFor(ids) },
      { onSuccess: handleBulkResult },
    );
  }, [selectedIds, bulkCorrect, expectedRevisionsFor, handleBulkResult]);

  const handleBulkSetType = useCallback((newType: 'expense' | 'income' | 'refund' | 'transfer') => {
    const ids = Array.from(selectedIds);
    bulkCorrect.mutate(
      { transaction_ids: ids, type: newType, expected_revisions: expectedRevisionsFor(ids) },
      { onSuccess: handleBulkResult },
    );
  }, [selectedIds, bulkCorrect, expectedRevisionsFor, handleBulkResult]);

  const handleBulkUndo = useCallback(() => {
    if (!lastBulkUndo) return;
    bulkUndo.mutate(
      { transaction_ids: lastBulkUndo.ids, expected_revisions: lastBulkUndo.revisions },
      {
        onSuccess: (results) => {
          const reverted = results.filter((r) => r.status === 'ok').length;
          toast(reverted === results.length ? 'Reverted.' : `Reverted ${reverted} of ${results.length}.`);
          setLastBulkUndo(null);
        },
      },
    );
  }, [lastBulkUndo, bulkUndo, toast]);

  // Toggle: clicking the active row navigates back to /transactions (closes panel)
  const handleTransactionClick = useCallback(
    (tx: Transaction) => {
      if (selectedId === tx.id) {
        navigate(`${activityPath}${location.search}`);
      } else {
        navigate(`${activityPath}/${tx.id}${location.search}`);
      }
    },
    [selectedId, navigate, activityPath, location.search],
  );

  const detailOverlay = (
    <>
      {/* Mobile backdrop — closes panel when tapped */}
      <AnimatePresence>
        {selectedTransaction && (
          <motion.div
            className="fixed inset-0 bg-black/30 z-40 md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeDetail}
          />
        )}
      </AnimatePresence>

      {/* Right: transaction detail panel — fixed overlay */}
      <AnimatePresence>
        {selectedTransaction && (
          <motion.div
            className="fixed inset-y-0 right-0 w-full md:w-96 z-50 border-l border-border bg-card shadow-xl overflow-hidden"
            variants={slideInRightVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <TransactionDetail
              key={selectedTransaction.id}
              transaction={selectedTransaction}
              onClose={closeDetail}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  let phoneView: React.ReactNode = null;
  if (isPhone) {
    // Lenses are the four most-used type views; they write the same filter
    // state (and URL params) as the desktop chips, so a lens survives a
    // rotate to tablet and back.
    const lens: ActivityLens = needsReview ? 'review' : type === 'income' ? 'income' : type === 'refund' ? 'refund' : 'all';
    const setLens = (next: ActivityLens) => {
      setNeedsReview(next === 'review');
      setType(next === 'income' || next === 'refund' ? next : 'all');
    };
    const otherFilterCount = [category !== 'all', !!startDate, !!endDate, !!tripId, type !== 'all' && type !== 'income' && type !== 'refund'].filter(Boolean).length;
    const reviewCount = briefing.data?.review_count ?? 0;
    const weekSpend = weekTotals.data?.reduce((sum, d) => sum + d.spending.minor_units, 0);
    const weekCount = weekTotals.data?.reduce((sum, d) => sum + d.transaction_count, 0);
    const list = (
      <div ref={listRef} tabIndex={-1} aria-label="Transactions" className="focus-visible:outline-none">
        {isError ? <LoadFailed onRetry={() => refetch()} /> : (
          <TransactionList
            transactions={txs}
            onLoadMore={loadMore}
            hasMore={!!hasNextPage}
            isLoading={isLoading || isFetchingNextPage}
            onTransactionClick={handleTransactionClick}
            selectedTransactionId={selectedId}
            dailyTotals={dailyTotals}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            stickyDayHeaders={false}
          />
        )}
      </div>
    );
    const lenses: Lens<ActivityLens>[] = [
      { value: 'all', label: 'All', panel: list },
      { value: 'review', label: reviewCount ? `Review ${reviewCount}` : 'Review', panel: list },
      { value: 'income', label: 'Income', panel: list },
      { value: 'refund', label: 'Refunds', panel: list },
    ];
    const glance = (
      <HeroCard
        title="This week"
        className="p-4"
        action={<div className="flex items-center gap-1">
          <Button type="button" variant={selectionMode ? 'default' : 'ghost'} size="icon" aria-label={selectionMode ? 'Done selecting' : 'Select transactions'} aria-pressed={selectionMode} onClick={toggleSelectionMode}>
            <CheckSquare size={16} aria-hidden />
          </Button>
          <Button type="button" variant="outline" size="icon" aria-label="Add a transaction" onClick={() => setShowForm(true)} disabled={selectionMode}>
            <Plus size={16} aria-hidden />
          </Button>
        </div>}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {weekSpend !== undefined
            ? <HeroAmount value={{ minor_units: weekSpend, currency: weekTotals.data?.[0]?.spending.currency ?? 'SGD' }} className="text-4xl" />
            : <Skeleton className="h-10 w-36" />}
          {!!reviewCount && lens !== 'review' && (
            <Button type="button" variant="ghost" size="sm" className="h-auto min-h-11 px-0 hover:bg-transparent" onClick={() => setLens('review')}>
              <Badge tone="warm" className="font-mono">{reviewCount} to review</Badge>
            </Button>
          )}
        </div>
        <p className="mt-1 text-xs text-muted">{weekCount !== undefined ? `${weekCount} ${weekCount === 1 ? 'purchase' : 'purchases'} since Monday` : ' '}</p>
      </HeroCard>
    );
    const dock = selectionMode ? (
      <BulkActionBar
        count={selectedIds.size}
        categories={categories ?? []}
        onCategorize={handleBulkCategorize}
        onSetType={handleBulkSetType}
        onCancel={toggleSelectionMode}
        pending={bulkCorrect.isPending}
      />
    ) : (
      <div className="flex flex-col gap-1.5">
        {lastBulkUndo && (
          <p role="status" className="px-1 text-sm text-muted">
            Updated {lastBulkUndo.ids.length}.{' '}
            <Button type="button" variant="link" size="sm" className="h-auto min-h-11 p-0 align-baseline" disabled={bulkUndo.isPending} onClick={handleBulkUndo}>
              {bulkUndo.isPending ? 'Undoing…' : 'Undo'}
            </Button>
          </p>
        )}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" aria-hidden />
            <Input
              type="search"
              aria-label="Search transactions"
              placeholder="Search merchant, amount, category"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-12 pl-9 pr-9"
            />
            {search && (
              <Button type="button" variant="ghost" size="icon" aria-label="Clear search" onClick={() => setSearch('')} className="absolute right-0.5 top-0.5 text-muted">
                <X size={16} aria-hidden />
              </Button>
            )}
          </div>
          <Button type="button" variant="outline" className="relative h-12 w-12 shrink-0 p-0" aria-label={otherFilterCount ? `Filters, ${otherFilterCount} active` : 'Filters'} onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal size={18} aria-hidden />
            {!!otherFilterCount && <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-pill bg-teal px-1 text-2xs font-mono font-semibold text-background">{otherFilterCount}</span>}
          </Button>
        </div>
      </div>
    );
    phoneView = (
      <>
        <h1 className="sr-only">Activity</h1>
        <PhoneScreen glance={glance} lenses={lenses} lens={lens} onLensChange={setLens} label="Activity views" dock={dock} />
        <DrillSheet
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          backLabel="Activity"
          title="Filters"
          footer={<Button type="button" className="w-full min-h-12" onClick={() => setFiltersOpen(false)}>Show results</Button>}
        >
          <TransactionFilters
            variant="sheet"
            search={search}
            onSearchChange={handleSearchChange}
            category={category}
            onCategoryChange={handleCategoryChange}
            categories={categories ?? []}
            startDate={startDate}
            setStartDate={setStartDate}
            endDate={endDate}
            setEndDate={setEndDate}
            type={type}
            onTypeChange={setType}
            trips={settings?.trips_enabled ? trips : []}
            tripId={tripId}
            onTripChange={setTripId}
            needsReview={needsReview}
            onNeedsReviewChange={setNeedsReview}
          />
        </DrillSheet>
        <DrillSheet open={showForm} onOpenChange={setShowForm} backLabel="Activity" title="Add a transaction">
          <TransactionForm categories={categories ?? []} onClose={() => setShowForm(false)} />
        </DrillSheet>
      </>
    );
  }

  // Both layouts render the detail at the same tree position, so an
  // in-progress edit survives resizing across the phone breakpoint.
  return (
    <>
      {phoneView ?? (
        <div className="flex h-full overflow-hidden">
          {/* Left: transaction list */}
          <div
            ref={scrollRef}
            className={`flex-1 overflow-y-auto p-4 md:p-6 space-y-4 transition-[margin-right] duration-300 ease-out${selectedTransaction ? ' hidden md:block md:mr-96' : ''}`}
          >
            <div className="flex items-start justify-between pb-4 border-b border-border">
              <div className="flex flex-col gap-1">
                <div className="text-xs uppercase tracking-[0.22em] text-muted font-mono font-semibold">
                  {activityPath === '/activity' ? 'Activity' : 'Transactions'}
                </div>
                <h1 className="text-xl font-bold leading-tight tracking-tight text-foreground font-display">
                  Every dollar tracked.
                </h1>
              </div>
              <div className="flex items-center gap-2">
              <Link to="/review" className="min-h-11 inline-flex items-center px-2 text-sm text-teal">Review{!!briefing.data?.review_count && ` (${briefing.data.review_count})`}</Link>
              <Button
                className="min-h-11"
                size="sm"
                variant={selectionMode ? 'default' : 'outline'}
                onClick={toggleSelectionMode}
              >
                <CheckSquare className="w-4 h-4 mr-1" />
                {selectionMode ? 'Done' : 'Select'}
              </Button>
              <Button className="min-h-11" size="sm" onClick={() => setShowForm(!showForm)} disabled={selectionMode}>
                <Plus className="w-4 h-4 mr-1" />
                Add
              </Button>
              </div>
            </div>

            {selectionMode && (
              <BulkActionBar
                count={selectedIds.size}
                categories={categories ?? []}
                onCategorize={handleBulkCategorize}
                onSetType={handleBulkSetType}
                onCancel={toggleSelectionMode}
                pending={bulkCorrect.isPending}
              />
            )}

            {lastBulkUndo && (
              <p role="status" className="text-sm text-muted">
                Updated {lastBulkUndo.ids.length}.{' '}
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto min-h-11 p-0 align-baseline"
                  disabled={bulkUndo.isPending}
                  onClick={handleBulkUndo}
                >
                  {bulkUndo.isPending ? 'Undoing…' : 'Undo'}
                </Button>
              </p>
            )}

            <TransactionFilters
              search={search}
              onSearchChange={handleSearchChange}
              category={category}
              onCategoryChange={handleCategoryChange}
              categories={categories ?? []}
              startDate={startDate}
              setStartDate={setStartDate}
              endDate={endDate}
              setEndDate={setEndDate}
              type={type}
              onTypeChange={setType}
              trips={settings?.trips_enabled ? trips : []}
              tripId={tripId}
              onTripChange={setTripId}
              needsReview={needsReview}
              onNeedsReviewChange={setNeedsReview}
            />

            {showForm && (
              <AnimatePresence>
                <motion.div
                  variants={fadeUpVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                >
                  <TransactionForm
                    categories={categories ?? []}
                    onClose={() => setShowForm(false)}
                  />
                </motion.div>
              </AnimatePresence>
            )}

            <Card
              ref={listRef}
              tabIndex={-1}
              aria-label="Transactions"
              className="overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {isError ? (
                <LoadFailed onRetry={() => refetch()} />
              ) : (
                <TransactionList
                  transactions={txs}
                  onLoadMore={loadMore}
                  hasMore={!!hasNextPage}
                  isLoading={isLoading || isFetchingNextPage}
                  onTransactionClick={handleTransactionClick}
                  selectedTransactionId={selectedId}
                  dailyTotals={dailyTotals}
                  selectionMode={selectionMode}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                />
              )}
            </Card>
          </div>

        </div>
      )}
      {detailOverlay}
    </>
  );
}
