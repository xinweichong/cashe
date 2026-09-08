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
    money_basis: Literal["legacy_values_rounded_per_transaction"]
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
