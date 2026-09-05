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
