import { useQuery } from '@tanstack/react-query';
import { api, type GoalProgress, type GoalProgressV2 } from '@/api/client';

export function useBudget(id: number | null) {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings(), staleTime: 10_000 });
  const { data: progress = [] } = useQuery({
    queryKey: ['budget-progress-v2'],
    queryFn: () => api.getBudgetProgressV2(),
    enabled: settings?.budgets_enabled === true && id != null,
    staleTime: 30_000,
  });
  return progress.find((b) => b.id === id);
}

// GoalCard/GoalDetail were built around v1's plain-number GoalProgress shape.
// Unwrap Money to plain dollar numbers here, once, so that display logic
// stays untouched. Mutations stay on their v1 endpoints — no v2 mutation
// contract exists for goals yet.
export function goalV2ToLegacy(g: GoalProgressV2): GoalProgress {
  return {
    id: g.id,
    name: g.name,
    target_amount: g.target_amount.minor_units / 100,
    saved_amount: g.saved_amount.minor_units / 100,
    target_date: g.target_date,
    status: g.status,
    percent: g.percent,
    monthly_rate: g.monthly_rate ? g.monthly_rate.minor_units / 100 : null,
    rate_window: g.rate_window,
    months_to_target: g.months_to_target,
    on_track: g.on_track,
    contributions: g.contributions.map(c => ({
      id: c.id,
      goal_id: c.goal_id,
      amount: c.amount.minor_units / 100,
      month: c.month,
      contributed_date: c.contributed_date,
      source: c.source,
      note: c.note,
      created_at: c.created_at,
    })),
  };
}

export function useGoals() {
  return useQuery({
    queryKey: ['goals-v2'],
    queryFn: async () => (await api.getGoalsV2()).map(goalV2ToLegacy),
    staleTime: 30_000,
  });
}

export function useTrips() {
  return useQuery({ queryKey: ['trips'], queryFn: () => api.getTrips(), staleTime: 30_000 });
}
