import type { SubscriptionConfirmation } from '@/lib/subscriptionConfirmation';
import type { components } from './v2-schema.gen';
import { request } from './client';

export type SubscriptionPriceChange = components['schemas']['SubscriptionPriceChange'];
export type WeekdayPattern = components['schemas']['WeekdayPattern'];
export type MonthForecast = components['schemas']['MonthForecast'];

export interface Money { minor_units: number; currency: 'SGD' }
export interface SpendingPeriod {
  start: string; end: string; spending: Money; income: Money | null;
  recorded_net_flow: Money | null; transaction_count: number;
  unresolved_count: number; indicative_count: number;
  status: 'complete' | 'indicative' | 'partial';
}
export interface MerchantDriver { merchant: string; change: Money }
export interface FrequencyDriver {
  classification: 'frequency' | 'size' | 'mixed' | 'none';
  current_count: number; previous_count: number; current_avg: Money; previous_avg: Money;
}
export interface OneOffDriver { transaction_id: number; merchant: string | null; amount: Money; date: string }
export interface TopCategoryDriver {
  category: string; change: Money; merchant_driver: MerchantDriver | null;
  frequency_driver: FrequencyDriver | null; one_off_driver: OneOffDriver | null; overlap_note: string;
}
export interface TripDriver {
  trip_id: number; name: string; current_total: Money; previous_total: Money; change: Money; overlap_note: string;
}
export interface SpendingFacts {
  as_of: string; timezone: string; undated_count: number;
  current: SpendingPeriod; comparison_current: SpendingPeriod; previous: SpendingPeriod;
  change: Money | null; category_changes: { category: string; change: Money }[];
  top_category_driver: TopCategoryDriver | null; trip_drivers: TripDriver[];
}
export interface EvidenceItem {
  id: number; merchant: string | null; category: string; type: string; date: string | null;
  amount: Money | null; conversion_status: 'native' | 'indicative' | 'unresolved';
}
export interface SpendingTarget { target: Money; remaining: Money }
export interface HomeBriefing {
  facts: SpendingFacts; spending_target: SpendingTarget | null; recent: EvidenceItem[];
  upcoming: { id: number; subscription_id: number; label: string; date: string; amount: Money | null }[];
  upcoming_total: Money; upcoming_unknown_count: number;
  increased_commitments: SubscriptionPriceChange[];
  capture_issue_count: number; followup_issue_count: number;
  review_count: number; recurring_suggestion_count: number;
  freshness: { gmail_connected: boolean; gmail_last_checked: string | null; gmail_needs_reconnection: boolean; last_capture_processed_at: string | null };
}
export interface CaptureIssue {
  id: number; source: string; handled?: boolean; status: string; attempts: number; error_code: string | null;
}
export interface UpcomingPlan {
  start: string; end: string; timezone: string; enabled: boolean;
  items: { id: number; subscription_id: number; label: string; date: string;
    confirmation_source: SubscriptionConfirmation; frequency: string; schedule_status: 'active' | 'possibly_cancelled'; amount: Money | null;
    date_basis: 'schedule' | 'user'; amount_basis: 'matched_charge' | 'user' | 'unknown'; amount_basis_transaction_id: number | null }[];
  total: number; limit: number; offset: number; known_total: Money;
  unknown_count: number; status: 'partial' | 'estimated';
}
export interface UpcomingCalendarDay { date: string; known_total: Money; unknown_count: number; recorded_charge_count: number }
export interface UpcomingCalendar { start: string; end: string; timezone: string; days: UpcomingCalendarDay[] }
export interface SpendingReview {
  items: { id: number; merchant: string | null; category: string; date: string | null;
    reasons: ('missing_date' | 'unresolved_money' | 'unknown_type' | 'missing_merchant' | 'missing_category')[] }[];
  total: number; limit: number; offset: number;
}
export interface FollowupIssue {
  id: number; transaction_id: number; kind: string; status: string; attempts: number;
}
export interface RecurringReview {
  items: { id: string; merchant: string; frequency: string }[];
  total: number; limit: number; offset: number;
}
export interface RefundMatchReview {
  items: {
    refund_transaction_id: number;
    refund: { merchant: string | null; date: string | null; amount: Money };
    candidate_purchase: { transaction_id: number; merchant: string | null; date: string | null; amount: Money };
    reason: 'same_merchant_amount_window';
  }[];
  total: number; limit: number; offset: number;
}
export interface DuplicateSide {
  id: number; merchant: string | null; date: string; source: string;
  amount: Money | null; conversion_status: 'native' | 'indicative' | 'unresolved';
}
export interface DuplicateReview {
  items: { transaction_a: DuplicateSide; transaction_b: DuplicateSide;
    reason: 'same_merchant_amount_time_cross_source' }[];
  total: number; limit: number; offset: number;
}
export const briefingApi = {
  recurringReview: (offset = 0) => request<RecurringReview>(`/api/v2/recurring/review?limit=50&offset=${offset}`),
  resolveRecurring: (id: string, action: 'accept' | 'dismiss') =>
    request<{ status: 'ok'; subscription_id: number | null }>(`/api/v2/recurring/suggestions/${encodeURIComponent(id)}/${action}`, { method: 'POST' }),
  refundMatchReview: (offset = 0) => request<RefundMatchReview>(`/api/v2/refund-matches/review?limit=50&offset=${offset}`),
  resolveRefundMatch: (refundTransactionId: number, action: 'accept' | 'dismiss') =>
    request<{ status: 'ok' }>(`/api/v2/refund-matches/${refundTransactionId}/${action}`, { method: 'POST' }),
  duplicateReview: (offset = 0) => request<DuplicateReview>(`/api/v2/duplicates/review?limit=50&offset=${offset}`),
  dismissDuplicate: (aId: number, bId: number) =>
    request<{ status: 'ok' }>(`/api/v2/duplicates/${aId}/${bId}/dismiss`, { method: 'POST' }),
  mergeDuplicates: (survivorId: number, loserId: number) =>
    request<{ status: 'ok'; merge_id: number }>('/api/v2/duplicates/merge', {
      method: 'POST', body: JSON.stringify({ survivor_id: survivorId, loser_id: loserId }),
    }),
  undoDuplicateMerge: (mergeId: number) =>
    request<{ status: 'ok' }>(`/api/v2/duplicates/merges/${mergeId}/undo`, { method: 'POST' }),
  updatePlannedCharge: (id: number, data: { expected_date?: string; expected_amount?: string | null }) =>
    request(`/api/v2/plan/upcoming/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  dismissPlannedCharge: (id: number) => request(`/api/v2/plan/upcoming/${id}/dismiss`, { method: 'POST' }),
  upcoming: (days = 30, offset = 0) => request<UpcomingPlan>(`/api/v2/plan/upcoming?days=${days}&limit=50&offset=${offset}`),
  upcomingOnDate: (date: string, offset = 0) => request<UpcomingPlan>(`/api/v2/plan/upcoming?date=${date}&limit=50&offset=${offset}`),
  upcomingCalendar: (start: string, end: string) => request<UpcomingCalendar>(`/api/v2/plan/upcoming/calendar?start=${start}&end=${end}`),
  home: () => request<HomeBriefing>('/api/v2/home'),
  month: (as_of?: string) => request<SpendingFacts>(`/api/v2/spending/month${as_of ? `?as_of=${as_of}` : ''}`),
  weekdayPattern: (weeks = 8) => request<WeekdayPattern>(`/api/v2/spending/weekday-pattern?weeks=${weeks}`),
  monthForecast: (as_of?: string) => request<MonthForecast>(`/api/v2/forecast/month${as_of ? `?as_of=${as_of}` : ''}`),
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
export function evidenceLink(period: SpendingPeriod, category?: string, measure = 'spending', merchant?: string): string {
  const query = new URLSearchParams({ start: period.start, end: period.end, measure });
  if (category !== undefined) query.set('category', category);
  if (merchant !== undefined) query.set('merchant', merchant);
  return `/evidence?${query}`;
}
