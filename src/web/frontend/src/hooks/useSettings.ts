import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';

// Feature toggles and preferences; changed only from Settings, which
// invalidates this key on save.
export function useSettings({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings(), staleTime: 30_000, enabled });
}
