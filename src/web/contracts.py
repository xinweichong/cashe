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
    reasons: list[Literal["missing_date", "unresolved_money", "unknown_type"]]


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


class TransactionV2(BaseModel):
    id: int
    revision: int
    source: str
    type: str
    merchant: str | None
    category: str | None
    description: str | None
    transaction_date: str | None
    original: OriginalMoney
    reporting: Money | None
    conversion: ConversionProvenance


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
