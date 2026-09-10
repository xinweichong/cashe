import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api.getCategories(),
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; keywords?: string; icon?: string; color?: string }) => api.createCategory(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: { keywords?: string; icon?: string; color?: string } }) =>
      api.updateCategory(name, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.deleteCategory(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useSummary(start_date: string, end_date: string) {
  return useQuery({
    queryKey: ['summary', start_date, end_date],
    queryFn: () => api.getSummary(start_date, end_date),
  });
}

export function useSummaryV2(start_date: string, end_date: string) {
  return useQuery({
    queryKey: ['summary-v2', start_date, end_date],
    queryFn: () => api.getSummaryV2(start_date, end_date),
  });
}

export function useTrend(start_date: string, end_date: string) {
  return useQuery({
    queryKey: ['trend', start_date, end_date],
    queryFn: () => api.getTrend(start_date, end_date),
  });
}

export function useTrendV2(start_date: string, end_date: string) {
  return useQuery({
    queryKey: ['trend-v2', start_date, end_date],
    queryFn: () => api.getTrendV2(start_date, end_date),
  });
}

export function useTrendByCategory(start_date: string, end_date: string) {
  return useQuery({
    queryKey: ['trend-by-category', start_date, end_date],
    queryFn: () => api.getTrendByCategory(start_date, end_date),
  });
}

export function useTrendByCategoryV2(start_date: string, end_date: string) {
  return useQuery({
    queryKey: ['trend-by-category-v2', start_date, end_date],
    queryFn: () => api.getTrendByCategoryV2(start_date, end_date),
  });
}

export function useBalance(start_date: string, end_date: string) {
  return useQuery({
    queryKey: ['balance', start_date, end_date],
    queryFn: () => api.getBalance(start_date, end_date),
  });
}

export function useBalanceV2(start_date: string, end_date: string) {
  return useQuery({
    queryKey: ['balance-v2', start_date, end_date],
    queryFn: () => api.getBalanceV2(start_date, end_date),
  });
}

export function useInsights(start_date: string, end_date: string) {
  return useQuery({
    queryKey: ['insights', start_date, end_date],
    queryFn: () => api.getInsights(start_date, end_date),
  });
}

export function useMerchantOverrides() {
  return useQuery({
    queryKey: ['merchant-overrides'],
    queryFn: () => api.getMerchantOverrides(),
  });
}
