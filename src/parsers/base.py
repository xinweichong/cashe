from dataclasses import dataclass
from typing import Optional, Any, runtime_checkable, Protocol


@dataclass
class ParseResult:
    source: str
    source_id: str
    amount: float
    merchant: str
    description: Optional[str] = None
    transaction_date: Optional[str] = None
    raw_data: Optional[str] = None
    currency: str = "SGD"
    tx_type: str = "expense"
    timestamp_precision: str = "unknown"
    payment_identity_kind: Optional[str] = None
    payment_identity: Optional[str] = None


@runtime_checkable
class BankParser(Protocol):
    @property
    def sender_domain(self) -> str:
        ...

    def can_parse(self, sender: str, subject: str) -> bool:
        ...

    def parse(self, content: Any) -> Optional[ParseResult]:
        ...
