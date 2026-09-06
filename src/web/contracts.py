"""Explicit public response contracts for the additive v2 API."""
from typing import Literal

from pydantic import BaseModel


class CaptureIssue(BaseModel):
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
