import { request } from './client';

export interface Money { minor_units: number; currency: 'SGD' }
export interface SpendingPeriod {
  start: string; end: string; spending: Money; income: Money | null;
  recorded_net_flow: Money | null; transaction_count: number;
  unresolved_count: number; indicative_count: number;
  status: 'complete' | 'indicative' | 'partial';
}
export interface SpendingFacts {
  as_of: string; timezone: string; undated_count: number;
  current: SpendingPeriod; comparison_current: SpendingPeriod; previous: SpendingPeriod;
  change: Money | null; category_changes: { category: string; change: Money }[];
}
export interface EvidenceItem {
  id: number; merchant: string | null; category: string; type: string; date: string | null;
  amount: Money | null; conversion_status: 'native' | 'indicative' | 'unresolved';
}
export interface HomeBriefing {
  facts: SpendingFacts; recent: EvidenceItem[];
  upcoming: { id: number; subscription_id: number; label: string; date: string; amount: Money | null }[];
  upcoming_total: Money; upcoming_unknown_count: number;
  capture_issue_count: number; followup_issue_count: number;
  freshness: { gmail_connected: boolean; gmail_last_checked: string | null; gmail_needs_reconnection: boolean };
}
export interface CaptureIssue {
  id: number; source: string; handled?: boolean; status: string; attempts: number; error_code: string | null;
}
export interface UpcomingPlan {
  start: string; end: string; timezone: string; enabled: boolean;
  items: { id: number; subscription_id: number; label: string; date: string;
    frequency: string; schedule_status: 'active' | 'possibly_cancelled'; amount: Money | null }[];
  total: number; limit: number; offset: number; known_total: Money;
  unknown_count: number; status: 'partial' | 'estimated';
}
export interface SpendingReview {
  items: { id: number; merchant: string | null; category: string; date: string | null;
    reasons: ('missing_date' | 'unresolved_money' | 'unknown_type')[] }[];
  total: number; limit: number; offset: number;
}
export interface FollowupIssue {
  id: number; transaction_id: number; kind: string; status: string; attempts: number;
}
export const briefingApi = {
  upcoming: (days = 30, offset = 0) => request<UpcomingPlan>(`/api/v2/plan/upcoming?days=${days}&limit=50&offset=${offset}`),
  home: () => request<HomeBriefing>('/api/v2/home'),
  spendingReview: (offset = 0) => request<SpendingReview>(`/api/v2/spending/review?limit=50&offset=${offset}`),
  evidence: (query: URLSearchParams) => request<{ items: EvidenceItem[]; total: number; limit: number; offset: number }>(`/api/v2/spending/evidence?${query}`),
  captureIssues: (offset = 0, includeHandled = false) => request<CaptureIssue[]>(`/api/v2/capture/issues?limit=50&offset=${offset}&include_handled=${includeHandled}`),
  followups: (offset = 0) => request<FollowupIssue[]>(`/api/v2/capture/followups?limit=50&offset=${offset}`),
  resolveCapture: (id: number, handled: boolean) => request(`/api/v2/capture/issues/${id}/${handled ? 'resolve' : 'reopen'}`, { method: 'POST' }),
  retryCapture: (id: number) => request(`/api/v2/capture/issues/${id}/retry`, { method: 'POST' }),
  retryFollowup: (id: number) => request(`/api/v2/capture/followups/${id}/retry`, { method: 'POST' }),
};
export function formatMoney(value: Money): string {
  return new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD', currencyDisplay: 'symbol' }).format(value.minor_units / 100);
}
export function evidenceLink(period: SpendingPeriod, category?: string, measure = 'spending'): string {
  const query = new URLSearchParams({ start: period.start, end: period.end, measure });
  if (category !== undefined) query.set('category', category);
  return `/evidence?${query}`;
}
