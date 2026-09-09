import { useState, useCallback, useEffect } from 'react';
import { useInfiniteQuery, useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TransactionList } from '@/components/transactions/TransactionList';
import { TransactionFilters } from '@/components/transactions/TransactionFilters';
import { TransactionDetail } from '@/components/transactions/TransactionDetail';
import { TransactionForm } from '@/components/transactions/TransactionForm';
import { useCategories } from '@/hooks/useCategories';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { api, type Transaction } from '@/api/client';
import { slideInRightVariants, fadeUpVariants } from '@/lib/motionPresets';
import { Plus } from 'lucide-react';
import { LoadFailed } from '@/components/ui/LoadFailed';

const PAGE_SIZE = 20;

export function TransactionsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const activityPath = location.pathname.startsWith('/activity') ? '/activity' : '/transactions';
  const { transactionId } = useParams<{ transactionId?: string }>();
  const parsed = transactionId ? parseInt(transactionId, 10) : NaN;
  const selectedId = isNaN(parsed) ? undefined : parsed;

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [category, setCategory] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showForm, setShowForm] = useState(false);
  const { data: categories } = useCategories();

  const [searchParams, setSearchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo');
  const closeDetail = () => navigate(returnTo?.startsWith('/evidence?') || returnTo === '/review' || returnTo?.startsWith('/review?') ? returnTo : `${activityPath}${location.search}`);
  // Consumes a one-time "open the add form" signal from a deep link, then
  // strips it from the URL — the URL mutation itself requires an effect
  // (it updates the router, an external system), and opening the form is
  // the same one-time signal-consumption step.
  useEffect(() => {
    if (searchParams.get('add') === '1') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowForm(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, refetch } =
    useInfiniteQuery({
      queryKey: ['transactions', debouncedSearch, category, startDate, endDate],
      queryFn: ({ pageParam = 0 }) => {
        const params: Record<string, string | number> = {
          limit: PAGE_SIZE,
          offset: pageParam as number,
        };
        if (debouncedSearch) params.merchant = debouncedSearch;
        if (category && category !== 'all') params.category = category;
        if (startDate) params.start_date = startDate;
        if (endDate) params.end_date = endDate;
        return api.getTransactions(params);
      },
      initialPageParam: 0,
      getNextPageParam: (lastPage: Transaction[], allPages: Transaction[][]) => {
        if (lastPage.length < PAGE_SIZE) return undefined;
        return allPages.length * PAGE_SIZE;
      },
      placeholderData: keepPreviousData,
    });

  const txs = data?.pages.flat() ?? [];

  // Use list data if available — only hit the single-tx endpoint for deep-links
  // where the transaction isn't in the loaded pages (e.g. direct URL navigation)
  const txFromList = selectedId !== undefined
    ? txs.find((tx) => tx.id === selectedId)
    : undefined;

  const { data: txFromQuery } = useQuery({
    queryKey: ['transaction', selectedId],
    queryFn: () => api.getTransaction(selectedId!),
    enabled: selectedId !== undefined && txFromList === undefined,
    staleTime: 30_000,
  });

  const selectedTransaction = txFromList ?? txFromQuery ?? null;

  const handleCategoryChange = useCallback((v: string) => setCategory(v), []);
  const handleSearchChange = useCallback((v: string) => setSearch(v), []);
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

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

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: transaction list */}
      <div
        className={`flex-1 overflow-y-auto p-4 md:p-6 space-y-4 transition-[margin-right] duration-300 ease-out${selectedTransaction ? ' hidden md:block md:mr-96' : ''}`}
      >
        <div className="flex items-start justify-between pb-5 border-b border-border">
          <div className="flex flex-col gap-1">
            <div className="text-xs uppercase tracking-[0.22em] text-muted font-mono font-semibold">
              {activityPath === '/activity' ? 'Activity' : 'Transactions'}
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground font-display">
              Every dollar tracked.
            </h1>
          </div>
          <div className="flex items-center gap-2">
          <Link to="/review" className="min-h-11 inline-flex items-center px-2 text-sm text-teal">Review</Link>
          <Button className="min-h-11" size="sm" onClick={() => setShowForm(!showForm)}>
            <Plus className="w-4 h-4 mr-1" />
            Add
          </Button>
          </div>
        </div>

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

        <Card className="overflow-hidden">
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
            />
          )}
        </Card>
      </div>

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
    </div>
  );
}
