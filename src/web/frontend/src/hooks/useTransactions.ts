import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Transaction } from '@/api/client';
import { useToast } from '@/components/ui/toast';

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

export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Transaction> & { source?: string }) => api.createTransaction(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['home-briefing'] });
      qc.invalidateQueries({ queryKey: ['spending-evidence'] });
      qc.invalidateQueries({ queryKey: ['balance'] });
    },
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Transaction> & { remember_category?: boolean } }) =>
      api.updateTransaction(id, data),
    onMutate: async ({ id, data }) => {
      await qc.cancelQueries({ queryKey: ['transactions'] });
      await qc.cancelQueries({ queryKey: ['transaction', id] });
      const listSnapshots = qc.getQueriesData<TxCache>({ queryKey: ['transactions'] });
      const single = qc.getQueryData<Transaction>(['transaction', id]);
      qc.setQueriesData<TxCache>({ queryKey: ['transactions'] }, (old) =>
        mapTxCache(old, (tx) => (tx.id === id ? { ...tx, ...data } : tx))
      );
      if (single) qc.setQueryData(['transaction', id], { ...single, ...data });
      return { listSnapshots, single, id };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return;
      for (const [key, snapshot] of ctx.listSnapshots) qc.setQueryData(key, snapshot);
      if (ctx.single) qc.setQueryData(['transaction', ctx.id], ctx.single);
    },
    onSettled: (_data, _err, { id }) => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['transaction', id] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['home-briefing'] });
      qc.invalidateQueries({ queryKey: ['spending-evidence'] });
    },
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
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['home-briefing'] });
      qc.invalidateQueries({ queryKey: ['spending-evidence'] });
      qc.invalidateQueries({ queryKey: ['balance'] });
    },
  });
}
