import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Check, Pencil, Plane, Plus, Search, SlidersHorizontal, Tag, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NavBar } from '@/components/ui/nav-bar';
import { Toolbar, ToolbarAction } from '@/components/ui/toolbar';
import { TaskSheet } from '@/components/ui/task-sheet';
import { ListGroup, ListRow } from '@/components/ui/list';
import { SegmentedChoice } from '@/components/ui/segmented-choice';
import { RowMenu } from '@/components/ui/row-menu';
import { SwipeRow } from '@/components/ui/swipe-row';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { ListDetail } from '@/components/layout/ListDetail';
import { PHONE_SCREEN_HEIGHT } from '@/components/layout/PhoneScreen';
import { ProfileMenu } from '@/components/layout/ProfileMenu';
import { TransactionList } from '@/components/transactions/TransactionList';
import { TransactionFilters } from '@/components/transactions/TransactionFilters';
import { ActivitySummary } from '@/components/transactions/ActivitySummary';
import { TransactionDetail } from '@/components/transactions/TransactionDetail';
import { TransactionForm } from '@/components/transactions/TransactionForm';
import { useCategories } from '@/hooks/useCategories';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useBulkCorrectTransactions, useBulkUndoTransactions, useDeleteTransaction, useUpdateTransaction } from '@/hooks/useTransactions';
import { useToast } from '@/hooks/useToastContext';
import { useIsPhone } from '@/hooks/useIsPhone';
import { useSettings } from '@/hooks/useSettings';
import { useTrips } from '@/components/plan/planHooks';
import { useHomeBriefing } from '@/hooks/useBriefing';
import { api, type Transaction, type TransactionV2, type DailyTotalV2, type BulkTransactionResultItemV2 } from '@/api/client';
import { cn, formatCurrency, isCreditType, localDayKey, minorToMajor } from '@/lib/utils';

const PAGE_SIZE = 20;

// Activity is "the past" (HIG alignment, 2026-10-01): every recorded
// transaction, newest first, grouped by day. ListDetail pushes a
// transaction's page over the list on a phone and shows it beside the list
// on md+. Filters and Add are task sheets; multi-select actions sit in a
// toolbar; each row has swipe actions (touch) and a context menu, both also
// reachable from the detail page.

const ADD_FORM_ID = 'add-transaction-form';
type ActivityLens = 'all' | 'review' | 'income' | 'refund';
type TxType = 'expense' | 'income' | 'refund' | 'transfer';
const TYPE_LABELS: Record<TxType, string> = { expense: 'Spending', income: 'Income', refund: 'Refund', transfer: 'Transfer' };

// v2 transactions carry canonical Money instead of flat amount/currency
// fields — convert at this page boundary so TransactionList/TransactionRow/
// TransactionDetail keep working against the existing v1-shaped Transaction,
// the same adapter pattern planHooks' goalV2ToLegacy established for R04.
function transactionV2ToLegacy(tx: TransactionV2): Transaction {
  return {
    id: tx.id,
    source: tx.source,
    source_id: '',
    amount: minorToMajor(tx.original.minor_units ?? 0, tx.original.currency),
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

const signedAmount = (tx: Transaction) => `${isCreditType(tx.type) ? '+' : '-'}${formatCurrency(tx.amount, tx.currency)}`;
const txName = (tx: Transaction) => tx.merchant || tx.description || 'Transaction';

export function TransactionsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isPhone = useIsPhone();
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
  const [addPending, setAddPending] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  // One row action at a time: a category pick or a delete confirmation.
  const [categoryFor, setCategoryFor] = useState<Transaction | 'selection' | null>(null);
  const [typeForSelection, setTypeForSelection] = useState(false);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [tripFor, setTripFor] = useState<Transaction | null>(null);
  const { data: categories } = useCategories();
  const briefing = useHomeBriefing();
  const { data: settings } = useSettings();
  const { data: trips = [] } = useTrips({ enabled: settings?.trips_enabled === true });
  const updateTx = useUpdateTransaction();
  const deleteTx = useDeleteTransaction();
  const qc = useQueryClient();
  // Same invalidation as the detail page's trip membership toggle.
  const enlist = useMutation({
    mutationFn: ({ tripId, txId }: { tripId: number; txId: number }) => api.enlistTransaction(tripId, txId),
    onSuccess: (_data, { tripId, txId }) => {
      qc.invalidateQueries({ queryKey: ['transaction-trips', txId] });
      qc.invalidateQueries({ queryKey: ['trip-transactions', tripId] });
      qc.invalidateQueries({ queryKey: ['trip-summary', tripId] });
    },
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
  // navigating away and returning) — R09. Tracks the topmost visible row's
  // id (not a raw pixel offset), so it's independent of how many pages
  // happen to be loaded when the anchor was saved vs. restored. The list
  // scrolls with the page on a phone and in its own column on md+, so
  // listen for scrolls anywhere (capture) and measure rows against the
  // viewport, below the 44px bar.
  const restoredRef = useRef(false);
  // The phone's own scrolling list, below its fixed header.
  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const rows = listRef.current?.querySelectorAll<HTMLElement>('[data-tx-row-id]') ?? [];
        for (const row of rows) {
          if (row.getBoundingClientRect().top >= (scrollerRef.current?.getBoundingClientRect().top ?? 40)) {
            sessionStorage.setItem('activity-scroll-anchor', row.dataset.txRowId ?? '');
            break;
          }
        }
      });
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    if (restoredRef.current) return;
    const anchorId = sessionStorage.getItem('activity-scroll-anchor');
    if (!anchorId) { restoredRef.current = true; return; }
    if (isLoading) return; // wait for the first page before deciding anything
    if (txs.some((tx) => String(tx.id) === anchorId)) {
      listRef.current
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

  const handleBulkSetType = useCallback((newType: TxType) => {
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

  // Toggle: clicking the open row closes its detail.
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

  // ── Row actions (swipe, context menu, ⌫ on md+) ────────────────────────────
  const tripsAvailable = settings?.trips_enabled === true && trips.length > 0;
  const applyCategory = (name: string) => {
    if (categoryFor === 'selection') handleBulkCategorize(name);
    else if (categoryFor) updateTx.mutate({ id: categoryFor.id, data: { category: name } }, { onSuccess: () => toast('Category changed.') });
    setCategoryFor(null);
  };
  const confirmDelete = () => {
    if (!deleting) return;
    const tx = deleting;
    deleteTx.mutate(tx.id, { onSuccess: () => { toast('Deleted.'); if (tx.id === selectedId) closeDetail(); } });
    setDeleting(null);
  };
  const renderRow = useCallback((tx: Transaction, row: React.ReactNode) => (
    <SwipeRow
      leadingActions={[{ label: 'Category', tone: 'warm', onAction: () => setCategoryFor(tx) }]}
      trailingActions={[{ label: 'Delete', tone: 'destructive', confirm: `Delete ${signedAmount(tx)}?`, onAction: () => deleteTx.mutate(tx.id) }]}
    >
      <RowMenu items={[
        { label: 'Open', icon: Pencil, onSelect: () => navigate(`${activityPath}/${tx.id}${location.search}`) },
        { label: 'Change category', icon: Tag, onSelect: () => setCategoryFor(tx) },
        { label: 'Add to trip', icon: Plane, onSelect: () => setTripFor(tx), hidden: !tripsAvailable },
        { separator: true },
        { label: 'Delete', icon: Trash2, destructive: true, onSelect: () => setDeleting(tx) },
      ]}>
        <div>{row}</div>
      </RowMenu>
    </SwipeRow>
  ), [activityPath, location.search, navigate, deleteTx, tripsAvailable]);

  // ── Header: quick views, search, filters ───────────────────────────────────
  const lens: ActivityLens = needsReview ? 'review' : type === 'income' ? 'income' : type === 'refund' ? 'refund' : 'all';
  const setLens = (next: ActivityLens) => {
    setNeedsReview(next === 'review');
    setType(next === 'income' || next === 'refund' ? next : 'all');
  };
  const reviewCount = briefing.data?.review_count ?? 0;
  const otherFilterCount = [category !== 'all', !!startDate, !!endDate, !!tripId, type !== 'all' && type !== 'income' && type !== 'refund'].filter(Boolean).length;
  const filterProps = {
    search, onSearchChange: handleSearchChange,
    category, onCategoryChange: handleCategoryChange, categories: categories ?? [],
    startDate, setStartDate, endDate, setEndDate,
    type, onTypeChange: setType,
    trips: settings?.trips_enabled ? trips : [], tripId, onTripChange: setTripId,
    needsReview, onNeedsReviewChange: setNeedsReview,
  };

  const navBar = (
    <NavBar
      large
      title={activityPath === '/activity' ? 'Activity' : 'Transactions'}
      trailing={selectionMode ? null : <>
        <ToolbarAction onClick={toggleSelectionMode}>Select</ToolbarAction>
        <Button type="button" variant="ghost" size={isPhone ? 'icon' : 'sm'} className="min-h-11 min-w-11 gap-1.5 text-teal" aria-label={isPhone ? 'Add a transaction' : undefined} onClick={() => setShowForm(true)}>
          <Plus aria-hidden className="h-5 w-5" />{!isPhone && 'Add'}
        </Button>
        {isPhone && <ProfileMenu />}
      </>}
    />
  );

  // Search, filters and the view switch: inline on md+, in the thumb band on a phone.
  const controls = (
    <>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              type="search"
              data-list-search=""
              aria-label="Search transactions"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 rounded-[10px] border-0 bg-fill-press pl-9 pr-9"
            />
            {search && (
              <Button type="button" variant="ghost" size="icon" aria-label="Clear search" onClick={() => setSearch('')} className="absolute right-0 top-0 text-muted">
                <X size={16} aria-hidden />
              </Button>
            )}
          </div>
          <Button type="button" variant="ghost" className="relative h-11 w-11 shrink-0 p-0 text-teal" aria-label={otherFilterCount ? `Filters, ${otherFilterCount} active` : 'Filters'} onClick={() => setShowFilters(true)}>
            <SlidersHorizontal size={18} aria-hidden />
            {!!otherFilterCount && <span className="absolute right-0.5 top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-pill bg-teal px-1 text-[10px] font-bold text-on-teal">{otherFilterCount}</span>}
          </Button>
        </div>
        <SegmentedChoice
          name="activity-view"
          aria-label="Activity view"
          value={lens}
          onValueChange={setLens}
          className="w-full"
          options={[
            { value: 'all', label: 'All' },
            { value: 'review', label: reviewCount ? `Review ${reviewCount}` : 'Review' },
            { value: 'income', label: 'Income' },
            { value: 'refund', label: 'Refunds' },
          ]}
        />
    </>
  );

  const selectionToolbar = selectionMode && (
    <Toolbar
      title={`${selectedIds.size} selected`}
      trailing={<>
        <ToolbarAction disabled={!selectedIds.size || bulkCorrect.isPending} onClick={() => setCategoryFor('selection')}>Category</ToolbarAction>
        <ToolbarAction disabled={!selectedIds.size || bulkCorrect.isPending} onClick={() => setTypeForSelection(true)}>Type</ToolbarAction>
        <ToolbarAction tone="strong" onClick={toggleSelectionMode} disabled={bulkCorrect.isPending}>Done</ToolbarAction>
      </>}
    />
  );
  const listBody = <>
    {lastBulkUndo && (
      <p role="status" className="px-1 text-sm text-muted">
        Updated {lastBulkUndo.ids.length}.{' '}
        <Button type="button" variant="link" size="sm" className="h-auto min-h-11 p-0 align-baseline" disabled={bulkUndo.isPending} onClick={handleBulkUndo}>
          {bulkUndo.isPending ? 'Undoing…' : 'Undo'}
        </Button>
      </p>
    )}
    {reviewCount > 0 && lens !== 'review' && (
      <p className="px-1 text-sm"><Link to="/review" className="inline-flex min-h-11 items-center text-teal">{reviewCount} waiting in Review</Link></p>
    )}
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
        compactRows
        renderRow={renderRow}
      />
    )}
  </>;

  // On a phone (approved 2026-10-07): the title, actions, search and view
  // switch stay fixed and only the purchases scroll, between them and the
  // tab bar, so the keyboard never covers search and nothing shows through.
  const list = isPhone ? (
    <div ref={listRef} tabIndex={-1} aria-label="Transactions" className={cn(PHONE_SCREEN_HEIGHT, 'flex flex-col overflow-hidden focus-visible:outline-none')}>
      <div className="shrink-0 border-b-[0.5px] border-separator">
        {navBar}
        {selectionToolbar}
        <div className="space-y-2 px-4 pt-1 pb-2">{controls}</div>
      </div>
      <div ref={scrollerRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pt-2 pb-4">{listBody}</div>
    </div>
  ) : (
    <div ref={listRef} tabIndex={-1} aria-label="Transactions" className="focus-visible:outline-none">
      {navBar}
      {selectionToolbar}
      <div className="space-y-3 px-4 pt-1 pb-8">
        {controls}
        {listBody}
      </div>
    </div>
  );

  const categoryList = categories ?? [];
  const currentCategory = categoryFor && categoryFor !== 'selection' ? categoryFor.category : null;

  return (
    <>
      <ListDetail
        listLabel="Transactions"
        list={list}
        detail={selectedTransaction && <TransactionDetail key={selectedTransaction.id} transaction={selectedTransaction} onClose={closeDetail} />}
        onClose={closeDetail}
        onDeleteSelected={() => selectedTransaction && setDeleting(selectedTransaction)}
        emptyDetail={<ActivitySummary filtered={isFilterNarrowed || lens !== 'all'} />}
      />

      <TaskSheet open={showFilters} onOpenChange={setShowFilters} title="Filters" confirm={{ label: 'Done', onClick: () => setShowFilters(false) }}>
        <TransactionFilters variant="sheet" {...filterProps} />
      </TaskSheet>

      <TaskSheet
        open={showForm}
        onOpenChange={setShowForm}
        title="Add a transaction"
        initialDetent="large"
        confirm={{ label: 'Save', onClick: () => (document.getElementById(ADD_FORM_ID) as HTMLFormElement | null)?.requestSubmit(), pending: addPending, pendingLabel: 'Saving…' }}
      >
        <TransactionForm categories={categoryList} onClose={() => setShowForm(false)} formId={ADD_FORM_ID} onPendingChange={setAddPending} />
      </TaskSheet>

      <TaskSheet
        open={categoryFor !== null}
        onOpenChange={(open) => !open && setCategoryFor(null)}
        title={categoryFor === 'selection' ? `Category for ${selectedIds.size}` : 'Category'}
        description={categoryFor && categoryFor !== 'selection' ? `${txName(categoryFor)} · this transaction only` : undefined}
      >
        <ListGroup>
          {categoryList.map((c) => (
            <ListRow key={c.name} onClick={() => applyCategory(c.name)} title={c.name}
              trailing={c.name === currentCategory ? <Check aria-hidden className="h-4 w-4 text-teal" /> : undefined} />
          ))}
        </ListGroup>
      </TaskSheet>

      <TaskSheet open={typeForSelection} onOpenChange={setTypeForSelection} title={`Type for ${selectedIds.size}`}>
        <ListGroup>
          {(Object.keys(TYPE_LABELS) as TxType[]).map((t) => (
            <ListRow key={t} onClick={() => { setTypeForSelection(false); handleBulkSetType(t); }} title={TYPE_LABELS[t]} />
          ))}
        </ListGroup>
      </TaskSheet>

      <TaskSheet open={tripFor !== null} onOpenChange={(open) => !open && setTripFor(null)} title="Add to trip"
        description={tripFor ? `${txName(tripFor)}, ${signedAmount(tripFor)}` : undefined}>
        <ListGroup>
          {trips.map((trip) => (
            <ListRow key={trip.id} title={trip.name} subtitle={trip.destination ?? undefined} disabled={enlist.isPending}
              onClick={() => {
                if (!tripFor) return;
                const tx = tripFor;
                enlist.mutate({ tripId: trip.id, txId: tx.id }, { onSuccess: () => toast(`Added to ${trip.name}.`), onError: () => toast("Couldn't add to the trip.") });
                setTripFor(null);
              }} />
          ))}
        </ListGroup>
      </TaskSheet>

      <TaskSheet open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)} title="Delete transaction?">
        {deleting && <div className="space-y-4 p-1">
          <p className="text-sm">{txName(deleting)}, {signedAmount(deleting)}. This can’t be undone.</p>
          <Button type="button" variant="destructive" className="min-h-11 w-full" onClick={confirmDelete}>Delete</Button>
        </div>}
      </TaskSheet>
    </>
  );
}
