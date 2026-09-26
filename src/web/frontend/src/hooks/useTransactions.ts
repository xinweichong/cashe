import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type TransactionCreateV2, type TransactionCorrectionV2 } from '@/api/client';
import { useToast } from '@/hooks/useToastContext';

type Row = { id: number };
type RowCache = Row[] | { pages: Row[][]; pageParams: unknown[] } | undefined;

// Every cache that holds transaction rows: the legacy list and Activity's
// infinite v2 pages. Each is either a plain array or infinite-query pages.
const ROW_LIST_KEYS = [['transactions'], ['transactions-v2']] as const;

function mapRows(data: RowCache, fn: (row: Row) => Row | null): RowCache {
  if (!data) return data;
  const mapPage = (rows: Row[]) => rows.flatMap((row) => {
    const next = fn(row);
    return next === null ? [] : [next];
  });
  if (Array.isArray(data)) return mapPage(data);
  if ('pages' in data) return { ...data, pages: data.pages.map(mapPage) };
  return data;
}

// Copies only fields the row already has, so one patch fits both the legacy
// and the v2 row shape (e.g. merchant/category, never v2's money objects).
function patchRow<T extends Row>(row: T, patch: Record<string, unknown>): T {
  const own = Object.fromEntries(Object.entries(patch).filter(([k]) => k in row));
  return { ...row, ...own };
}

export function useTransactions(params?: Record<string, string | number>) {
  return useQuery({
    queryKey: ['transactions', params],
    queryFn: () => api.getTransactions(params),
  });
}

// Queries a transaction change can't move. Everything else is invalidated
// after one — Home, Explore and Plan each read their own shared-facts
// queries, and an allowlist of those kept falling behind as screens added
// queries (see "Query invalidation needs journey review" in
// docs/plans/2026-09-16-cashe-design-restoration-baseline-audit.md).
// Only mounted queries refetch; the rest are marked stale.
const UNAFFECTED_BY_SPENDING = new Set([
  'settings', 'currentUser', 'status', 'sessions', 'categories', 'apple-wallet-cards', 'analytics-insight',
]);

export function invalidateSpendingQueries(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ predicate: (q) => !UNAFFECTED_BY_SPENDING.has(String(q.queryKey[0])) });
}

async function snapshotRowCaches(qc: ReturnType<typeof useQueryClient>, extraKeys: readonly (readonly unknown[])[] = []) {
  const keys = [...ROW_LIST_KEYS, ...extraKeys];
  await Promise.all(keys.map((queryKey) => qc.cancelQueries({ queryKey })));
  return keys.flatMap((queryKey) => qc.getQueriesData<unknown>({ queryKey }));
}

function restore(qc: ReturnType<typeof useQueryClient>, snapshots: [readonly unknown[], unknown][]) {
  for (const [key, snapshot] of snapshots) qc.setQueryData(key, snapshot);
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
      const snapshots = await snapshotRowCaches(qc, [['transaction-v2', id]]);
      // Only merge fields the caller actually set (never null/undefined) —
      // the correction contract allows amount/currency/etc. to be null, but
      // the cached rows require them; an optimistic patch should never blank
      // out a required display field.
      const patch = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== null && v !== undefined)
      );
      for (const queryKey of ROW_LIST_KEYS) {
        qc.setQueriesData<RowCache>({ queryKey }, (old) =>
          mapRows(old, (row) => (row.id === id ? patchRow(row, patch) : row)));
      }
      qc.setQueryData<Row>(['transaction-v2', id], (old) => (old ? patchRow(old, patch) : old));
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) restore(qc, ctx.snapshots);
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
      const snapshots = await snapshotRowCaches(qc);
      for (const queryKey of ROW_LIST_KEYS) {
        qc.setQueriesData<RowCache>({ queryKey }, (old) => mapRows(old, (row) => (row.id === id ? null : row)));
      }
      return { snapshots };
    },
    onError: (_err, _id, ctx) => {
      if (!ctx) return;
      restore(qc, ctx.snapshots);
      toast("Couldn't delete — restored.");
    },
    onSettled: () => invalidateSpendingQueries(qc),
  });
}
