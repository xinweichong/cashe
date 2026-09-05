import hashlib
import re
from datetime import datetime
from typing import Optional, Any
from src.parsers.base import ParseResult


class AppleWalletParser:
    @property
    def sender_domain(self) -> str:
        return ""  # Not email-based — receives webhook payloads

    DATE_FORMATS = ["%d/%m/%Y %H:%M:%S", "%Y-%m-%dT%H:%M:%S"]

    # Multi-char symbols checked before single-char to avoid partial matches
    _MULTI_SYMBOLS: dict[str, str] = {
        "S$": "SGD", "A$": "AUD", "HK$": "HKD", "NZ$": "NZD", "CA$": "CAD",
        "RM": "MYR",
    }
    _SINGLE_SYMBOLS: dict[str, str] = {
        "£": "GBP", "€": "EUR", "¥": "JPY", "₩": "KRW", "₹": "INR",
        "฿": "THB", "$": "USD",
    }

    def can_parse(self, sender: str, subject: str) -> bool:
        return False  # Not used for email parsing

    @staticmethod
    def _parse_amount_currency(raw: str) -> tuple[str, float]:
        """Parse an iOS Wallet amount string into (currency_code, absolute_amount).

        iOS formats handled:
          "PLN 3.78"   → ("PLN", 3.78)
          "USD -12.50" → ("USD", 12.50)   # stored as positive expense
          "S$12.50"    → ("SGD", 12.50)
          "A$9.99"     → ("AUD", 9.99)
          "£12.50"     → ("GBP", 12.50)
          "€9.99"      → ("EUR", 9.99)
          "¥1,234"     → ("JPY", 1234.0)
          "12.50"      → ("SGD", 12.50)   # bare number = SGD home currency
          "-12.50"     → ("SGD", 12.50)   # negative = expense, stored positive
        """
        raw = str(raw).strip()

        def _to_float(s: str) -> float:
            return abs(float(s.replace(",", "").strip()))

        # Stage 1: ISO code prefix — "PLN 3.78" or "USD -12.50"
        m = re.match(r'^([A-Z]{3})\s+([-\d,\.]+)$', raw)
        if m:
            return m.group(1), _to_float(m.group(2))

        # Stage 2a: Multi-char symbol prefix — "S$", "A$", "HK$", "RM", …
        for sym, code in AppleWalletParser._MULTI_SYMBOLS.items():
            if raw.startswith(sym):
                return code, _to_float(raw[len(sym):])

        # Stage 2b: Single-char symbol prefix — "£", "€", "¥", …
        for sym, code in AppleWalletParser._SINGLE_SYMBOLS.items():
            if raw.startswith(sym):
                return code, _to_float(raw[len(sym):])

        # Stage 3: Bare number — SGD home currency fallback
        return "SGD", _to_float(raw)

    def parse(self, payload: dict) -> Optional[ParseResult]:
        if "amount" not in payload:
            raise ValueError("missing required field: amount")
        if "merchant" not in payload:
            raise ValueError("missing required field: merchant")

        currency, amount = self._parse_amount_currency(str(payload["amount"]))
        merchant = payload["merchant"]
        card = payload.get("card", "")
        date_str = payload.get("date", "")

        # Card is excluded from the hash to preserve dedup compatibility with
        # existing records (card_last4 was silently dropped before, so the slot
        # was always an empty string in the original hash formula).
        source_id = hashlib.sha256(
            f"{merchant}:{amount}::{date_str}".encode()
        ).hexdigest()[:16]

        # Parse date from Shortcut format (dd/MM/yyyy HH:mm:ss) to ISO format
        transaction_date = date_str
        precision = "unknown"
        for fmt in self.DATE_FORMATS:
            try:
                parsed = datetime.strptime(date_str, fmt)
                transaction_date = parsed.strftime("%Y-%m-%dT%H:%M:%S")
                precision = "second"
                break
            except (ValueError, TypeError):
                continue

        if precision == "unknown" and isinstance(date_str, str):
            try:
                datetime.fromisoformat(date_str)
                if re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_str):
                    precision = "date"
                elif re.match(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}", date_str):
                    precision = "second"
                elif re.match(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}", date_str):
                    precision = "minute"
            except ValueError:
                pass

        description = f"Apple Wallet - {card}" if card else "Apple Wallet"

        return ParseResult(
            source="apple_wallet",
            source_id=source_id,
            amount=amount,
            merchant=merchant,
            description=description,
            transaction_date=transaction_date,
            timestamp_precision=precision,
            payment_identity_kind="wallet_card_label" if card and card.strip() else None,
            payment_identity=" ".join(card.casefold().split()) if card and card.strip() else None,
            raw_data=str(payload),
            currency=currency,
        )
