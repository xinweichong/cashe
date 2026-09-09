import type { SubscriptionConfirmation } from '@/lib/subscriptionConfirmation';
const BASE = '';

export async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...opts?.headers,
    },
  });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error: ${res.status} ${body}`);
  }
  return res.json();
}

export interface Transaction {
  id: number;
  source: string;
  source_id: string;
  amount: number;
  currency: string;
  exchange_rate: number | null;
  merchant: string | null;
  description: string | null;
  category: string | null;
  transaction_date: string;
  ingested_at: string;
  type: string;
}

export interface TransactionProvenance {
  transaction_id: number;
  sources: {
    channel: 'apple_wallet' | 'gmail' | 'manual' | 'cash' | 'other';
    evidence_recorded: boolean;
  }[];
}

export interface Category {
  name: string;
  keywords: string | null;
  icon: string | null;
  color: string | null;
  type: 'needs' | 'wants' | 'neutral';
}

export interface Budget {
  id: number;
  category: string | null;
  period: 'monthly' | 'weekly';
  amount: number;
  created_at: string;
  updated_at: string;
}

export interface BudgetProgress {
  id: number;
  category: string | null;
  label: string;
  period: 'monthly' | 'weekly';
  budget_amount: number;
  spent: number;
  remaining: number;
  percent: number;
  projected: number;
  status: 'on_track' | 'warning' | 'over_budget';
  period_start: string;
  period_end: string;
}

export interface GoalContribution {
  id: number;
  goal_id: number;
  amount: number;
  month: string;
  contributed_date: string | null;
  source: 'auto' | 'manual';
  note: string | null;
  created_at: string;
}

export interface SavingsOverview {
  month: string;
  income: number;
  expenses: number;
  savings: number;
  allocated_to_goals: number;
  unallocated: number;
}

export interface GoalProgress {
  id: number;
  name: string;
  target_amount: number;
  saved_amount: number;
  target_date: string | null;
  status: 'active' | 'completed' | 'paused';
  percent: number;
  monthly_rate: number;
  months_to_target: number | null;
  on_track: 'on_track' | 'ahead' | 'behind' | null;
  contributions: GoalContribution[];
}

export interface MerchantSummary {
  merchant: string;
  total_sgd: number;
  transaction_count: number;
  avg_amount_sgd: number;
  category: string | null;
  first_seen: string;
  last_seen: string;
  tags: string[];
  notes: string;
}

export interface MerchantProfile {
  merchant: string;
  total_sgd: number;
  transaction_count: number;
  avg_amount_sgd: number;
  category: string | null;
  first_seen: string;
  last_seen: string;
  tags: string[];
  notes: string;
}

export interface MerchantTrend {
  merchant: string;
  months: Array<{ month: string; total: number; count: number }>;
  current_month: number;
  previous_month: number;
  trend: 'up' | 'down' | 'stable';
}

export interface HealthScoreComponent {
  score: number;
  max: number;
  value: number;
  benchmark?: number;
  label: string;
  description: string;
}

export interface Trip {
  id: number;
  name: string;
  destination: string | null;
  start_date: string;
  end_date: string | null;
  primary_currency: string;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  confirmation_source: SubscriptionConfirmation;
  id: number;
  merchant: string;
  label: string | null;
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual';
  billing_day: number | null;
  status: 'active' | 'possibly_cancelled' | 'paused' | 'cancelled';
  notes: string | null;
  last_amount: number | null;
  next_expected_date: string | null;
  next_upcoming_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface UpcomingTransaction {
  id: number;
  subscription_id: number;
  expected_date: string;
  expected_amount: number | null;
  matched_transaction_id: number | null;
  status: 'pending' | 'matched' | 'dismissed';
}

export interface SubscriptionSummary {
  total_monthly_sgd: number;
  active_count: number;
  possibly_cancelled_count: number;
}

export interface TripSummary {
  trip: Trip;
  total_sgd: number;
  transaction_count: number;
  days: number;
  daily_average_sgd: number;
  currencies_used: string[];
  by_category: { category: string; amount_sgd: number; count: number }[];
  by_day: { date: string; amount_sgd: number }[];
}

export interface HealthScore {
  score: number | null;
  grade: string | null;
  has_income_data: boolean;
  period: string;
  components: {
    savings_rate: HealthScoreComponent;
    needs_ratio: HealthScoreComponent;
    wants_ratio: HealthScoreComponent;
    budget_adherence: HealthScoreComponent;
    anomaly_frequency: HealthScoreComponent;
  };
}

export interface LLMInsight {
  content: { narrative: string; nudges: string[] } | null;
  generated_at: string | null;
  is_stale: boolean;
}

export interface RecurringTransaction {
  id: number;
  merchant: string;
  avg_amount: number;
  frequency: string;
  category: string;
  first_seen: string;
  last_seen: string;
  occurrences: number;
}

export interface CurrentUser {
  username: string;
  gmail_connected: boolean;
  telegram_chat_id: number | null;
  wants_gmail: boolean;
  wants_apple_wallet: boolean;
  onboarding_complete: boolean;
  force_password_change: boolean;
}

export interface SessionInfo {
  token: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string;
}

// Legacy analytics response shapes — these endpoints are slated for
// migration onto shared spending facts; see docs/plans completion roadmap R04.
export interface SpendingSummary {
  total: number;
  by_category: Record<string, number>;
}

export interface Balance {
  income: number;
  expenses: number;
  net: number;
}

export interface TrendPoint {
  date: string;
  amount: number;
}

export interface TrendByCategoryPoint {
  date: string;
  [category: string]: string | number | null;
}

export interface SpendingInsights {
  merchants: { merchant: string; visits: number; total: number }[];
  average_daily: number;
}

export interface PeriodComparison {
  current_start: string;
  current_end: string;
  previous_start: string;
  previous_end: string;
  current_total: number;
  previous_total: number;
  change: number;
  change_percent: number | null;
}

export interface CategoryComparison {
  category: string;
  current: number;
  previous: number;
  change: number;
  change_percent: number | null;
}

export interface AnalyticsComparison {
  overall: PeriodComparison;
  categories: CategoryComparison[];
}

export interface TopMerchant {
  merchant: string;
  count: number;
  total: number;
  avg_amount: number;
}

export interface MerchantTrend {
  merchant: string;
  months: { month: string; total: number; count: number }[];
  current_month: number;
  previous_month: number;
  trend: 'up' | 'down' | 'stable';
}

export interface AnalyticsMerchants {
  top: TopMerchant[];
  trend: MerchantTrend | null;
}

export interface SpendingVelocity {
  current_mtd: number;
  last_month_total: number;
  projected_total: number;
  days_elapsed: number;
  total_days: number;
  pace_percent: number;
  status: string;
}

export interface Anomaly {
  id: number;
  merchant: string | null;
  amount: number;
  currency: string;
  category: string | null;
  transaction_date: string;
  avg_amount: number;
  explanation?: string;
}

export interface NewMerchant {
  merchant: string;
  first_date: string;
  category: string | null;
  amount: number;
}

export interface AnalyticsAlerts {
  anomalies: Anomaly[];
  new_merchants: NewMerchant[];
}

export interface AnalyticsSummaries {
  monthly: Record<string, unknown> | null;
  weekly: Record<string, unknown> | null;
}

export interface YoyComparisonPoint {
  month_label: string;
  month: string;
  this_year_expenses: number;
  last_year_expenses: number;
  this_year_income: number;
  last_year_income: number;
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    request<{ status: string }>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  // Current user
  getCurrentUser: () => request<CurrentUser>('/api/users/me'),

  changePassword: (current_password: string, new_password: string) =>
    request<{ status: string }>('/api/users/me/password', {
      method: 'PUT',
      body: JSON.stringify({ current_password, new_password }),
    }),

  // Sessions
  listSessions: () => request<SessionInfo[]>('/api/sessions'),

  logoutAllOtherSessions: () =>
    request<{ status: string }>('/api/sessions', { method: 'DELETE' }),

  logoutSession: (token: string) =>
    request<{ status: string }>(`/api/sessions/${token}`, { method: 'DELETE' }),

  // Onboarding
  setOnboardingPreferences: (wants_gmail: boolean, wants_apple_wallet: boolean) =>
    request<{ status: string }>('/api/onboarding/preferences', {
      method: 'PUT',
      body: JSON.stringify({ wants_gmail, wants_apple_wallet }),
    }),

  getOnboardingGmailConnectUrl: () =>
    request<{ url: string }>('/api/onboarding/gmail/connect-url'),

  createTelegramLinkToken: () =>
    request<{ token: string }>('/api/onboarding/telegram/link-token', { method: 'POST' }),

  getWebhookUrl: () => request<{ url: string }>('/api/onboarding/webhook-url'),

  getWalletConnection: () => request<{ configured: boolean; required: boolean }>('/api/connections/apple-wallet'),
  createWalletCredential: () => request<{ token: string }>('/api/connections/apple-wallet/credential', { method: 'POST' }),
  revokeWalletCredential: () => request<{ status: string }>('/api/connections/apple-wallet/credential', { method: 'DELETE' }),


  completeOnboarding: () =>
    request<{ status: string }>('/api/onboarding/complete', { method: 'PUT' }),

  // Connections (post-onboarding management)
  disconnectTelegram: () =>
    request<{ status: string }>('/api/connections/telegram', { method: 'DELETE' }),

  disconnectGmail: () =>
    request<{ status: string }>('/api/connections/gmail', { method: 'DELETE' }),

  getGmailReconnectUrl: () =>
    request<{ url: string }>('/api/connections/gmail/connect-url'),

  // Transactions
  getTransactions: (params?: Record<string, string | number>) => {
    const query = params
      ? '?' + new URLSearchParams(
          Object.entries(params).map(([k, v]) => [k, String(v)])
        ).toString()
      : '';
    return request<Transaction[]>(`/api/transactions${query}`);
  },

  getTransaction: (id: number) =>
    request<Transaction>(`/api/transactions/${id}`),

  getTransactionProvenance: (id: number) =>
    request<TransactionProvenance>(`/api/v2/transactions/${id}/provenance`),

  createTransaction: (data: Partial<Transaction> & { source?: string }, requestKey?: string) =>
    request<Transaction>('/api/transactions', {
      method: 'POST',
      headers: requestKey ? { 'Idempotency-Key': requestKey } : undefined,
      body: JSON.stringify(data),
    }),

  updateTransaction: (id: number, data: Partial<Transaction> & { remember_category?: boolean }) =>
    request<Transaction>(`/api/transactions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteTransaction: (id: number) =>
    request<{ status: string }>(`/api/transactions/${id}`, { method: 'DELETE' }),

  // Summary & Analytics
  getSummary: (start_date: string, end_date: string) =>
    request<SpendingSummary>(`/api/summary?start_date=${start_date}&end_date=${end_date}`),

  getTrend: (start_date: string, end_date: string) =>
    request<TrendPoint[]>(`/api/trend?start_date=${start_date}&end_date=${end_date}`),

  getTrendByCategory: (start_date: string, end_date: string) =>
    request<TrendByCategoryPoint[]>(`/api/trend/by-category?start_date=${start_date}&end_date=${end_date}`),

  getBalance: (start_date: string, end_date: string) =>
    request<Balance>(`/api/balance?start_date=${start_date}&end_date=${end_date}`),

  getInsights: (start_date: string, end_date: string) =>
    request<SpendingInsights>(`/api/insights?start_date=${start_date}&end_date=${end_date}`),

  getMerchants: (start_date: string, end_date: string) =>
    request<string[]>(`/api/merchants?start_date=${start_date}&end_date=${end_date}`),

  getIncomeVsExpense: (months = 6) =>
    request<Array<{ month: string; income: number; expenses: number }>>(
      `/api/income-vs-expense?months=${months}`
    ),

  // Categories
  getCategories: () =>
    request<Category[]>('/api/categories'),

  createCategory: (data: { name: string; keywords?: string; icon?: string; color?: string }) =>
    request<{ status: string; name: string }>('/api/categories', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateCategory: (name: string, data: { keywords?: string; icon?: string; color?: string; type?: 'needs' | 'wants' | 'neutral' }) =>
    request<{ status: string; name: string }>(`/api/categories/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteCategory: (name: string) =>
    request<{ status: string; reassigned: number }>(`/api/categories/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),

  // Merchant Overrides
  getMerchantOverrides: () =>
    request<{ merchant: string; category: string }[]>('/api/merchant-overrides'),

  deleteMerchantOverride: (merchant: string) =>
    request<{ status: string }>(`/api/merchant-overrides/${encodeURIComponent(merchant)}`, {
      method: 'DELETE',
    }),

  // Apple Wallet
  getAppleWalletCards: () =>
    request<string[]>('/api/apple-wallet/cards'),

  // Analytics endpoints
  getAnalyticsComparison: (period: string, date?: string) => {
    const params = new URLSearchParams({ period });
    if (date) params.set('date', date);
    return request<AnalyticsComparison>(`/api/analytics/comparison?${params}`);
  },

  getAnalyticsMerchants: (limit = 10, merchant?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (merchant) params.set('merchant', merchant);
    return request<AnalyticsMerchants>(`/api/analytics/merchants?${params}`);
  },

  getAnalyticsVelocity: () =>
    request<SpendingVelocity>('/api/analytics/velocity'),

  getAnalyticsAlerts: () =>
    request<AnalyticsAlerts>('/api/analytics/alerts'),

  getAnalyticsSummaries: () =>
    request<AnalyticsSummaries>('/api/analytics/summaries'),

  getAnalyticsYoY: (months = 12) =>
    request<YoyComparisonPoint[]>(`/api/analytics/yoy?months=${months}`),

  getAnalyticsInsight: () =>
    request<LLMInsight>('/api/analytics/insight'),

  getWeeklyInsight: () => request<LLMInsight>('/api/analytics/insight/weekly'),
  getMonthlyInsight: () => request<LLMInsight>('/api/analytics/insight/monthly'),
  getRecurring: () => request<RecurringTransaction[]>('/api/recurring'),

  // Merchant Intelligence
  getMerchantIntelligenceList: (params?: {
    sort_by?: 'total_spent' | 'transaction_count' | 'last_seen' | 'merchant_name';
    tag?: string;
    category?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) => {
    const query = params
      ? '?' + new URLSearchParams(
          Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== '')
            .map(([k, v]) => [k, String(v)])
        ).toString()
      : '';
    return request<MerchantSummary[]>(`/api/merchant-intelligence${query}`);
  },

  getMerchantProfile: (merchant: string) =>
    request<MerchantProfile>(`/api/merchant-intelligence/${encodeURIComponent(merchant)}`),

  setMerchantTags: (merchant: string, tags: string[]) =>
    request<{ merchant: string; tags: string[]; notes: string }>(
      `/api/merchant-intelligence/${encodeURIComponent(merchant)}/tags`,
      { method: 'PUT', body: JSON.stringify({ tags }) }
    ),

  setMerchantNotes: (merchant: string, notes: string) =>
    request<{ merchant: string; tags: string[]; notes: string }>(
      `/api/merchant-intelligence/${encodeURIComponent(merchant)}/notes`,
      { method: 'PUT', body: JSON.stringify({ notes }) }
    ),

  getMerchantTrend: (merchant: string) =>
    request<MerchantTrend>(`/api/merchant-intelligence/${encodeURIComponent(merchant)}/trend`),

  // Budgets
  getBudgets: () => request<Budget[]>('/api/budgets'),

  getBudgetProgress: () => request<BudgetProgress[]>('/api/budgets/progress'),

  createBudget: (data: { category: string | null; amount: number; period: string }) =>
    request<Budget>('/api/budgets', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateBudget: (id: number, amount: number) =>
    request<Budget>(`/api/budgets/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ amount }),
    }),

  deleteBudget: (id: number) =>
    request<{ status: string }>(`/api/budgets/${id}`, { method: 'DELETE' }),

  getHealthScore: (months?: number) =>
    request<HealthScore>(`/api/health-score${months ? `?months=${months}` : ''}`),

  // App Settings
  getSettings: () =>
    request<{
      anomaly_multiplier: number;
      velocity_alert_threshold: number;
      budgets_enabled: boolean;
      goals_enabled: boolean;
      trips_enabled: boolean;
      subscriptions_enabled: boolean;
      recurring_enabled: boolean;
      home_briefing_enabled: boolean;
    }>('/api/settings'),

  updateSettings: (data: {
    anomaly_multiplier?: number;
    velocity_alert_threshold?: number;
    budgets_enabled?: boolean;
    goals_enabled?: boolean;
    trips_enabled?: boolean;
    subscriptions_enabled?: boolean;
    recurring_enabled?: boolean;
    home_briefing_enabled?: boolean;
  }) =>
    request<{
      anomaly_multiplier: number;
      velocity_alert_threshold: number;
      budgets_enabled: boolean;
      goals_enabled: boolean;
      trips_enabled: boolean;
      subscriptions_enabled: boolean;
      recurring_enabled: boolean;
    }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // Goals
  getGoals: () => request<GoalProgress[]>('/api/goals'),

  createGoal: (data: { name: string; target_amount: number; target_date?: string }) =>
    request<GoalProgress>('/api/goals', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateGoal: (id: number, data: { name?: string; target_amount?: number; target_date?: string; status?: 'active' | 'completed' | 'paused' }) =>
    request<GoalProgress>(`/api/goals/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteGoal: (id: number) =>
    request<{ status: string }>(`/api/goals/${id}`, { method: 'DELETE' }),

  contributeToGoal: (id: number, data: { amount: number; note?: string }) =>
    request<GoalProgress>(`/api/goals/${id}/contribute`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getGoalContributions: (id: number) =>
    request<GoalContribution[]>(`/api/goals/${id}/contributions`),

  updateContribution: (goalId: number, contributionId: number, data: { amount?: number; note?: string | null; contributed_date?: string }) =>
    request<GoalProgress>(`/api/goals/${goalId}/contributions/${contributionId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteContribution: (goalId: number, contributionId: number) =>
    request<GoalProgress>(`/api/goals/${goalId}/contributions/${contributionId}`, {
      method: 'DELETE',
    }),

  getSavingsOverview: () =>
    request<SavingsOverview>('/api/savings/overview'),

  // Trips
  getTrips: () => request<Trip[]>('/api/trips'),

  createTrip: (data: { name: string; start_date: string; destination?: string; primary_currency?: string }) =>
    request<Trip>('/api/trips', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateTrip: (id: number, data: Partial<Pick<Trip, 'name' | 'destination' | 'start_date' | 'end_date' | 'primary_currency'>>) =>
    request<Trip>(`/api/trips/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  activateTrip: (id: number) =>
    request<Trip>(`/api/trips/${id}/activate`, { method: 'POST' }),

  deactivateTrip: (id: number) =>
    request<Trip>(`/api/trips/${id}/deactivate`, { method: 'POST' }),

  deleteTrip: (id: number) =>
    request<{ status: string }>(`/api/trips/${id}`, { method: 'DELETE' }),

  getActiveTrip: () => request<Trip>('/api/trips/active'),

  getTripSummary: (id: number) => request<TripSummary>(`/api/trips/${id}/summary`),

  getTripTransactions: (id: number, limit?: number, offset?: number) =>
    request<Transaction[]>(`/api/trips/${id}/transactions?limit=${limit ?? 50}&offset=${offset ?? 0}`),

  enlistTransaction: (tripId: number, txId: number) =>
    request<{ status: string }>(`/api/trips/${tripId}/transactions`, {
      method: 'POST',
      body: JSON.stringify({ transaction_id: txId }),
    }),

  delistTransaction: (tripId: number, txId: number) =>
    request<{ status: string }>(`/api/trips/${tripId}/transactions/${txId}`, {
      method: 'DELETE',
    }),

  checkTripMembership: (tripId: number, txId: number) =>
    request<{ in_trip: boolean }>(`/api/trips/${tripId}/transactions/${txId}/membership`),

  // Subscriptions
  getSubscriptions: () =>
    request<{ subscriptions: Subscription[]; summary: SubscriptionSummary }>('/api/subscriptions'),

  getSubscriptionSummary: () =>
    request<SubscriptionSummary>('/api/subscriptions/summary'),

  createSubscription: (data: {
    merchant: string;
    frequency: string;
    billing_day?: number;
    label?: string;
    notes?: string;
  }) => request<Subscription>('/api/subscriptions', { method: 'POST', body: JSON.stringify(data) }),

  updateSubscription: (
    id: number,
    data: Partial<Pick<Subscription, 'merchant' | 'label' | 'frequency' | 'billing_day' | 'status' | 'notes'>>,
  ) =>
    request<Subscription>(`/api/subscriptions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  confirmSubscription: (id: number) =>
    request<{ status: string }>(`/api/subscriptions/${id}/confirm`, { method: 'POST' }),

  deleteSubscription: (id: number) =>
    request<{ status: string }>(`/api/subscriptions/${id}`, { method: 'DELETE' }),

  getSubscriptionHistory: (id: number, limit = 50) =>
    request<Transaction[]>(`/api/subscriptions/${id}/history?limit=${limit}`),

  getSubscriptionUpcoming: (id: number) =>
    request<UpcomingTransaction[]>(`/api/subscriptions/${id}/upcoming`),

  matchUpcoming: (subId: number, upcomingId: number, transactionId: number) =>
    request<{ status: string }>(
      `/api/subscriptions/${subId}/upcoming/${upcomingId}/match`,
      { method: 'POST', body: JSON.stringify({ transaction_id: transactionId }) },
    ),

  dismissUpcoming: (subId: number, upcomingId: number) =>
    request<{ status: string }>(
      `/api/subscriptions/${subId}/upcoming/${upcomingId}/dismiss`,
      { method: 'POST' },
    ),

  linkTransaction: (subId: number, transactionId: number) =>
    request<{ status: string }>(
      `/api/subscriptions/${subId}/link-transaction`,
      { method: 'POST', body: JSON.stringify({ transaction_id: transactionId }) },
    ),

  getStatus: () =>
    request<{
      gmail: { authenticated: boolean | null; last_auth_error: string | null; last_poll_at: string | null };
      telegram: { running: boolean | null; last_error: string | null };
      exchange: { using_fallback: boolean | null; last_fetch_error: string | null };
    }>('/api/status'),

  ping: () => request<{ status: string }>('/api/ping'),

  logout: () =>
    request<{ status: string }>('/api/logout', { method: 'POST' }),
};
