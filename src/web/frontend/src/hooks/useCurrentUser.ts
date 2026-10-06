import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CurrentUser } from '@/api/client';

export function useCurrentUser({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<CurrentUser>({
    queryKey: ['currentUser'],
    queryFn: () => api.getCurrentUser(),
    staleTime: 10_000,
    enabled,
  });
}

export function useInvalidateCurrentUser() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['currentUser'] });
}
