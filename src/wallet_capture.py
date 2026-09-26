"""Validation of persisted Wallet requests, shared by intake and replay."""
import json
import math
from typing import Optional

from pydantic import BaseModel, field_validator

from src.parsers.apple_wallet import AppleWalletParser
from src.parsers.base import ParseResult


class AppleWalletPayload(BaseModel):
    amount: Optional[str] = None
    merchant: Optional[str] = None
    card: Optional[str] = None
    date: Optional[str] = None

    @field_validator("amount", mode="before")
    @classmethod
    def coerce_amount_to_str(cls, value):
        return None if value is None else str(value)


class WalletPayloadError(ValueError):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def parse_wallet_request(body: bytes) -> ParseResult:
    try:
        payload = AppleWalletPayload.model_validate(json.loads(body))
    except ValueError:
        raise WalletPayloadError("Invalid Wallet payload", 422) from None
    if payload.amount is None:
        raise WalletPayloadError("missing required field: amount")
    if not payload.merchant or not payload.merchant.strip():
        raise WalletPayloadError("missing required field: merchant")
    try:
        result = AppleWalletParser().parse(payload.model_dump())
        if not math.isfinite(result.amount):
            raise ValueError("Non-finite amount")
        return result
    except ValueError:
        raise WalletPayloadError("Invalid Wallet amount") from None
