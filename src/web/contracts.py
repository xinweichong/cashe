"""Explicit public response contracts for the additive v2 API."""
from typing import Literal

from pydantic import BaseModel


class CaptureResolution(BaseModel):
    id: int
    handled: bool


class CaptureIssue(BaseModel):
    handled: bool
    id: int
    source: str
    parser_version: str
    status: Literal["pending", "failed", "unrecognized"]
    transaction_id: int | None
    attempts: int
    error_code: str | None
    created_at: str
    updated_at: str


class QueuedResponse(BaseModel):
    status: Literal["queued"] = "queued"


class TransactionSource(BaseModel):
    channel: Literal["apple_wallet", "gmail", "manual", "cash", "other"]
    evidence_recorded: bool


class TransactionProvenance(BaseModel):
    transaction_id: int
    sources: list[TransactionSource]


class CaptureFollowup(BaseModel):
    id: int
    transaction_id: int
    kind: Literal["trip", "recurring", "suggestion", "notification"]
    status: Literal["pending", "failed"]
    attempts: int
    error_code: str | None
    created_at: str
    updated_at: str


class Money(BaseModel):
    minor_units: int
    currency: Literal["SGD"] = "SGD"


class SpendingPeriod(BaseModel):
    start: str
    end: str
    spending: Money
    income: Money | None
    recorded_net_flow: Money | None
    transaction_count: int
    unresolved_count: int
    indicative_count: int
    status: Literal["complete", "indicative", "partial"]


class DailyTotal(BaseModel):
    date: str
    spending: Money
    income: Money | None
    recorded_net_flow: Money | None
    transaction_count: int
    unresolved_count: int
    indicative_count: int
    status: Literal["complete", "indicative", "partial"]


class CategoryChange(BaseModel):
    category: str
    change: Money


class SpendingFacts(BaseModel):
    undated_count: int
    as_of: str
    timezone: str
    money_basis: Literal["canonical_minor_units_with_legacy_fallback"]
    current: SpendingPeriod
    comparison_current: SpendingPeriod
    previous: SpendingPeriod
    change: Money | None
    category_changes: list[CategoryChange]


class SpendingEvidenceItem(BaseModel):
    id: int
    merchant: str | None
    category: str
    type: str
    date: str | None
    amount: Money | None
    conversion_status: Literal["native", "indicative", "unresolved"]


class SpendingEvidence(BaseModel):
    items: list[SpendingEvidenceItem]
    total: int
    limit: int
    offset: int


class SpendingReviewItem(BaseModel):
    id: int
    merchant: str | None
    category: str
    date: str | None
    reasons: list[Literal["missing_date", "unresolved_money", "unknown_type", "missing_merchant", "missing_category"]]


class SpendingReview(BaseModel):
    items: list[SpendingReviewItem]
    total: int
    limit: int
    offset: int


class UpcomingCharge(BaseModel):
    id: int
    subscription_id: int
    label: str
    date: str
    amount: Money | None


class PlanMutationResponse(BaseModel):
    status: Literal["ok"] = "ok"


class PlannedCharge(UpcomingCharge):
    confirmation_source: Literal["unknown", "user", "recurring_suggestion"]
    frequency: str
    schedule_status: Literal["active", "possibly_cancelled"]


class UpcomingPlan(BaseModel):
    start: str
    end: str
    timezone: str
    enabled: bool
    items: list[PlannedCharge]
    total: int
    limit: int
    offset: int
    known_total: Money
    unknown_count: int
    status: Literal["partial", "estimated"]


class CaptureFreshness(BaseModel):
    gmail_connected: bool
    gmail_last_checked: str | None
    gmail_needs_reconnection: bool


class HomeBriefing(BaseModel):
    facts: SpendingFacts
    recent: list[SpendingEvidenceItem]
    upcoming: list[UpcomingCharge]
    upcoming_total: Money
    upcoming_unknown_count: int
    capture_issue_count: int
    followup_issue_count: int
    review_count: int
    recurring_suggestion_count: int
    freshness: CaptureFreshness


class RecurringReviewItem(BaseModel):
    id: str
    merchant: str
    frequency: str


class RecurringReview(BaseModel):
    items: list[RecurringReviewItem]
    total: int
    limit: int
    offset: int


class RecurringResolution(BaseModel):
    status: Literal["ok"] = "ok"
    subscription_id: int | None


class RefundMatchSide(BaseModel):
    merchant: str | None
    date: str | None
    amount: Money


class RefundMatchCandidate(BaseModel):
    transaction_id: int
    merchant: str | None
    date: str | None
    amount: Money


class RefundMatchProposal(BaseModel):
    refund_transaction_id: int
    refund: RefundMatchSide
    candidate_purchase: RefundMatchCandidate
    reason: Literal["same_merchant_amount_window"]


class RefundMatchReview(BaseModel):
    items: list[RefundMatchProposal]
    total: int
    limit: int
    offset: int


class RefundMatchResolution(BaseModel):
    status: Literal["ok"] = "ok"


class DuplicateSide(BaseModel):
    id: int
    merchant: str | None
    date: str
    source: str
    amount: Money | None
    conversion_status: str


class DuplicateProposal(BaseModel):
    transaction_a: DuplicateSide
    transaction_b: DuplicateSide
    reason: Literal["same_merchant_amount_time_cross_source"]


class DuplicateReview(BaseModel):
    items: list[DuplicateProposal]
    total: int
    limit: int
    offset: int


class DuplicateDismissal(BaseModel):
    status: Literal["ok"] = "ok"


class DuplicateMergeRequest(BaseModel):
    survivor_id: int
    loser_id: int


class DuplicateMergeResult(BaseModel):
    status: Literal["ok"] = "ok"
    merge_id: int


class DuplicateMergeUndoResult(BaseModel):
    status: Literal["ok"] = "ok"


# ── v2 Transaction (R03) ────────────────────────────────────────────────────

class OriginalMoney(BaseModel):
    """The amount in its own currency — unlike Money, not always SGD."""
    minor_units: int | None
    currency: str


class ConversionProvenance(BaseModel):
    status: Literal["native", "resolved", "indicative", "unresolved"] | None
    rate: str | None
    source: str | None
    quoted_at: str | None


# R05 sub-project 2: evidence-only summary of a linked transaction — raw
# original-currency amount/currency (not Money/SGD), since the refund/
# purchase currency-mismatch check compares them in their own currency.
class RefundEvidence(BaseModel):
    transaction_id: int
    merchant: str | None
    transaction_date: str | None
    amount: float
    currency: str
    warning: str | None = None


class TransactionV2(BaseModel):
    id: int
    revision: int
    source: str
    type: str
    merchant: str | None
    category: str | None
    description: str | None
    transaction_date: str | None
    ingested_at: str | None = None
    original: OriginalMoney
    reporting: Money | None
    conversion: ConversionProvenance
    refund_of: RefundEvidence | None = None
    refunded_by: list[RefundEvidence] = []


class TransactionCorrection(BaseModel):
    """PUT /api/v2/transactions/{id} body. All fields optional — only
    supplied ones are changed. expected_revision is optional so existing
    v1-style callers (that never read a revision back) still work."""
    merchant: str | None = None
    amount: float | None = None
    currency: str | None = None
    exchange_rate: float | None = None
    category: str | None = None
    description: str | None = None
    transaction_date: str | None = None
    type: str | None = None
    # None is ambiguous with "not supplied" via the usual exclude_none body
    # parsing — the route checks model_fields_set to tell "explicitly null
    # (unlink)" apart from "omitted (leave alone)".
    refund_of_transaction_id: int | None = None
    remember_category: bool = False
    expected_revision: int | None = None


class TransactionCreate(BaseModel):
    """POST /api/v2/transactions body."""
    amount: float
    currency: str = "SGD"
    exchange_rate: float | None = None
    merchant: str | None = None
    category: str | None = None
    description: str | None = None
    transaction_date: str | None = None
    type: Literal["expense", "income"] = "expense"
    source: Literal["manual", "cash"] = "manual"


class TransactionUndo(BaseModel):
    """POST /api/v2/transactions/{id}/undo body. expected_revision is
    optional — omitted, undo always reverts whatever correction most
    recently happened."""
    expected_revision: int | None = None


class BulkTransactionRequest(BaseModel):
    """POST /api/v2/transactions/bulk body (R09). At least one of category/
    type must be set. expected_revisions is keyed by transaction id (as a
    string over the wire, coerced back to int) — normally the revision each
    row had when the client last loaded it, so a row someone else edited in
    the meantime surfaces as a visible per-row conflict instead of being
    silently overwritten."""
    transaction_ids: list[int]
    category: str | None = None
    type: Literal["expense", "income", "refund", "transfer"] | None = None
    remember_category: bool = False
    expected_revisions: dict[int, int] = {}


class BulkUndoRequest(BaseModel):
    """POST /api/v2/transactions/bulk/undo body (R09)."""
    transaction_ids: list[int]
    expected_revisions: dict[int, int] = {}


class BulkTransactionResultItem(BaseModel):
    id: int
    status: Literal["ok", "conflict", "error"]
    revision: int | None = None
    current_revision: int | None = None
    detail: str | None = None


class TransactionDeletion(TransactionV2):
    """DELETE /api/v2/transactions/{id} response — the retained snapshot,
    as it stood immediately before deletion."""
    deleted_at: str


# ── Overview (R04) ──────────────────────────────────────────────────────────
# Typed wrappers over the existing (canonical-money-correct as of R04)
# Storage summary/trend functions. Calendar-month/week period semantics —
# deliberately distinct from spending_facts' equal-elapsed-days/weekday-
# aligned periods, which serve Home's day-over-day comparison instead of
# Overview's plain calendar-range browsing.

class OverviewSummary(BaseModel):
    start: str
    end: str
    total: Money
    by_category: dict[str, Money]


class TrendPoint(BaseModel):
    date: str
    amount: Money


class MerchantRanking(BaseModel):
    merchant: str
    visits: int
    total: Money


class TripInfo(BaseModel):
    id: int
    name: str
    destination: str | None
    start_date: str
    end_date: str | None
    primary_currency: str
    status: Literal["inactive", "active"]
    created_at: str
    updated_at: str


class TripCategoryTotal(BaseModel):
    category: str
    amount: Money
    count: int


class TripDayTotal(BaseModel):
    date: str
    amount: Money


class TripSummary(BaseModel):
    trip: TripInfo
    total: Money
    transaction_count: int
    days: int
    daily_average: Money
    currencies_used: list[str]
    by_category: list[TripCategoryTotal]
    by_day: list[TripDayTotal]


class BudgetProgress(BaseModel):
    id: int
    category: str | None
    label: str
    period: Literal["monthly", "weekly"]
    budget_amount: Money
    spent: Money
    remaining: Money
    percent: float
    projected: Money
    status: Literal["over_budget", "warning", "on_track"]
    period_start: str
    period_end: str


# Typed wrapper over the already-canonical-money-correct
# Storage.get_merchant_list / get_merchant_profile (both use the same
# reporting_minor_units-first SQL CASE as the rest of R04). Same shape
# serves both a list row and a single-merchant profile.
class MerchantSummary(BaseModel):
    merchant: str
    display_name: str
    total: Money
    transaction_count: int
    avg_amount: Money
    category: str | None
    first_seen: str
    last_seen: str
    tags: list[str]
    notes: str


# Typed wrapper over analytics.py's get_period_comparison/get_category_comparison
# (already canonical-money-correct as of R04's analytics.py sweep). `change` can
# be negative — spending can decrease period-over-period.
class PeriodComparison(BaseModel):
    current_start: str
    current_end: str
    previous_start: str
    previous_end: str
    current_total: Money
    previous_total: Money
    change: Money
    change_percent: float | None


class CategoryComparison(BaseModel):
    category: str
    current: Money
    previous: Money
    change: Money
    change_percent: float | None


class SpendingComparison(BaseModel):
    overall: PeriodComparison
    categories: list[CategoryComparison]


# Typed wrapper over analytics.py's get_spending_velocity (already
# canonical-money-correct — _query_total sums reporting_minor_units).
class SpendingVelocity(BaseModel):
    current_mtd: Money
    last_month_total: Money
    projected_total: Money
    days_elapsed: int
    total_days: int
    pace_percent: float
    status: Literal["ahead", "on_track", "behind"]


# Typed wrapper over analytics.py's get_top_merchants/get_merchant_trend
# (already canonical-money-correct — both read reporting_minor_units).
class TopMerchant(BaseModel):
    merchant: str
    count: int
    total: Money
    avg_amount: Money


class MerchantTrendMonth(BaseModel):
    month: str
    total: Money
    count: int


class MerchantTrendV2(BaseModel):
    merchant: str
    months: list[MerchantTrendMonth]
    current_month: Money
    previous_month: Money


class TopMerchantsResult(BaseModel):
    top: list[TopMerchant]
    trend: MerchantTrendV2 | None


# Typed wrapper over analytics.py's get_anomalies/check_new_merchants.
# get_anomalies's SQL compares reporting_minor_units (already correct) but
# returned the raw original-currency `amount` as the displayed value — a
# THB anomaly would render as "$<amount>" (SGD) in the v1 UI. The v2 route
# fixes this by building Money from reporting_minor_units instead, the same
# class of bug R04 fixed everywhere else money crossed a currency boundary.
class SpendingAnomaly(BaseModel):
    id: int
    merchant: str | None
    amount: Money
    category: str | None
    transaction_date: str
    avg_amount: Money
    explanation: str | None = None


class NewMerchant(BaseModel):
    merchant: str
    first_date: str
    category: str | None
    amount: Money


class SpendingAlerts(BaseModel):
    anomalies: list[SpendingAnomaly]
    new_merchants: list[NewMerchant]


# Typed wrapper over Storage.get_health_score. Every field here is a ratio
# or a score, never Money — the underlying computation already reads
# reporting_minor_units (R04-correct), so there's no currency-display
# concern, just a shape to validate. `components` is a dict (not a fixed
# five-field model) because it's genuinely `{}` when has_income_data is
# False — the frontend never dereferences it in that case.
class HealthScoreComponent(BaseModel):
    score: float
    max: float
    value: float
    benchmark: float | None = None
    label: str
    description: str


class HealthScore(BaseModel):
    score: int | None
    grade: str | None
    has_income_data: bool
    period: str
    components: dict[str, HealthScoreComponent]


# Typed wrapper over Storage.get_balance, which delegates to
# get_spending_summary/get_income_summary["total"] — both already
# canonical-money-correct.
class Balance(BaseModel):
    income: Money
    expenses: Money
    net: Money


# Typed wrapper over Storage.get_trend_by_category (already
# canonical-money-correct). The v1 shape is a flat dict per date with one
# dynamic key per category (`{"date": ..., "Food": 12.5, "Transport": None}`)
# — gap-filled with explicit None so every date has every category key, which
# Recharts needs for line continuity. A Money contract can't have dynamic
# top-level keys, so v2 nests them under `categories` instead of flattening;
# the frontend re-flattens when building chart data, same as it already
# does to unwrap Money elsewhere.
class CategoryTrendPoint(BaseModel):
    date: str
    categories: dict[str, Money | None]


# Typed wrapper over Storage.get_goal_progress (via get_goals). goal_contributions.amount
# is SGD-only by design (no currency/exchange_rate columns on that table), so this needs
# no FX validation, unlike almost every other Money in this file.
# get_goal_progress's monthly_rate formula (average of the last 3 contributions,
# not dated/elapsed-window) is explicitly R13 scope — deliberately not touched
# here; this contract types the existing computation, it doesn't fix it.
class GoalContributionV2(BaseModel):
    id: int
    goal_id: int
    amount: Money
    month: str
    contributed_date: str | None
    source: Literal["auto", "manual"]
    note: str | None
    created_at: str


class GoalProgress(BaseModel):
    id: int
    name: str
    target_amount: Money
    saved_amount: Money
    target_date: str | None
    status: Literal["active", "completed", "paused"]
    percent: float
    monthly_rate: Money
    months_to_target: float | None
    on_track: Literal["on_track", "ahead", "behind"] | None
    contributions: list[GoalContributionV2]
