import { useQuery } from '@tanstack/react-query';
import { briefingApi } from '@/api/briefing';

export function useHomeBriefing() {
  return useQuery({ queryKey: ['home-briefing'], queryFn: briefingApi.home });
}

export function useMonthForecast() {
  return useQuery({ queryKey: ['month-forecast'], queryFn: () => briefingApi.monthForecast() });
}
