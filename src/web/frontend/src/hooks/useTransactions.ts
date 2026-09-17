import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Transaction, type TransactionCreateV2, type TransactionCorrectionV2 } from '@/api/client';
import { useToast } from '@/hooks/useToastContext';

type TxCache =
  | Transaction[]
  | { pages: Transaction[][]; pageParams: unknown[] }
  | undefined;

function mapTxCache(
  data: TxCache,
  fn: (tx: Transaction) => Transaction | null
): TxCache {
  if (!data) return data;
  const mapRows = (rows: Transaction[]) =>
    rows.flatMap((tx) => {
      const r = fn(tx);
      return r === null ? [] : [r];
    });
  if (Array.isArray(data)) return mapRows(data);
  if ('pages' in data) return { ...data, pages: data.pages.map(mapRows) };
  return data;
}

export function useTransactions(params?: Record<string, string | number>) {
  return useQuery({
    queryKey: ['transactions', params],
    queryFn: () => api.getTransactions(params),
  });
}

// Every cache key downstream of "a transaction's money/date/category
// changed" — Home, Explore and Plan each read their own shared-facts
// queries under their own key prefixes (not just 'home-briefing'), so a
// transaction mutation that only invalidated a few of these left the other
// destinations showing pre-edit numbers on a fast cached return. See the
// "Query invalidation needs journey review" finding in
// docs/plans/2026-09-16-cashe-design-restoration-baseline-audit.md.
// react-query's invalidateQueries does prefix matching, so each entry here
// covers every parameterised variant of that query (e.g. ['home-daily-
// totals', start, end] is invalidated by the bare ['home-daily-totals']).
const SPENDING_AFFECTED_KEYS = [
  'transactions', 'transactions-v2', 'transaction', 'transaction-v2',
  'transactions-daily-totals', 'summary', 'balance',
  'home-briefing', 'home-category-breakdown', 'home-daily-totals', 'home-merchants',
  'explore-month-facts', 'explore-category-trend', 'explore-weekday-pattern',
  'explore-merchants-by-category', 'explore-subscription-review',
  'explore-trip-summary', 'explore-trip-month-facts',
  'month-forecast', 'plan-upcoming', 'plan-upcoming-calendar', 'plan-upcoming-day',
  'spending-evidence', 'spending-review',
] as const;

export function invalidateSpendingQueries(qc: ReturnType<typeof useQueryClient>) {
  for (const key of SPENDING_AFFECTED_KEYS) qc.invalidateQueries({ queryKey: [key] });
}

export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ data, requestKey }: { data: Partial<TransactionCreateV2> & { amount: number }; requestKey: string }) =>
      api.createTransaction(data, requestKey),
    onSuccess: () => invalidateSpendingQueries(qc),
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<TransactionCorrectionV2> }) =>
      api.updateTransaction(id, data),
    onMutate: async ({ id, data }) => {
      await qc.cancelQueries({ queryKey: ['transactions'] });
      await qc.cancelQueries({ queryKey: ['transaction', id] });
      const listSnapshots = qc.getQueriesData<TxCache>({ queryKey: ['transactions'] });
      const single = qc.getQueryData<Transaction>(['transaction', id]);
      // Only merge fields the caller actually set (never null/undefined) —
      // the correction contract allows amount/currency/etc. to be null, but
      // the cached Transaction shape requires them; an optimistic patch
      // should never blank out a required display field.
      const patch = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== null && v !== undefined)
      );
      qc.setQueriesData<TxCache>({ queryKey: ['transactions'] }, (old) =>
        mapTxCache(old, (tx) => (tx.id === id ? { ...tx, ...patch } : tx))
      );
      if (single) qc.setQueryData(['transaction', id], { ...single, ...patch });
      return { listSnapshots, single, id };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return;
      for (const [key, snapshot] of ctx.listSnapshots) qc.setQueryData(key, snapshot);
      if (ctx.single) qc.setQueryData(['transaction', ctx.id], ctx.single);
    },
    onSettled: () => invalidateSpendingQueries(qc),
  });
}

// R09: no optimistic patch — a bulk action can partially conflict per row,
// so the UI reads each row's real status/revision back from the response
// (rather than assuming success) and just refetches once settled.
export function useBulkCorrectTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.bulkCorrectTransactions,
    onSettled: () => invalidateSpendingQueries(qc),
  });
}

export function useBulkUndoTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.bulkUndoTransactions,
    onSettled: () => invalidateSpendingQueries(qc),
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: number) => api.deleteTransaction(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['transactions'] });
      const listSnapshots = qc.getQueriesData<TxCache>({ queryKey: ['transactions'] });
      qc.setQueriesData<TxCache>({ queryKey: ['transactions'] }, (old) =>
        mapTxCache(old, (tx) => (tx.id === id ? null : tx))
      );
      return { listSnapshots };
    },
    onError: (_err, _id, ctx) => {
      if (!ctx) return;
      for (const [key, snapshot] of ctx.listSnapshots) qc.setQueryData(key, snapshot);
      toast("Couldn't delete — restored.");
    },
    onSettled: () => invalidateSpendingQueries(qc),
  });
}
