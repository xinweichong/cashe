import re
from datetime import datetime
from typing import Optional

from src.parsers.base import ParseResult


class UobParser:
    """Handles all UOB alert email formats from @uobgroup.com.

    Seven patterns in priority order:
      1. Card purchase       (any currency, DD/MM/YY, no time)
      2. Accumulated transit (DD/MM/YY, no time)
      3. Card reversal       (DD Mon YY H:MMAM/PM — income)
      4. PayNow received     (DD-MON-YYYY H:MMAM/PM — income)
      5. One-time transfer   (H:MMAM/PM SGT, D Mon YY — expense)
      6. NETS QR payment     (H:MMAM/PM SGT, DD Mon YY — expense)
      7. PayNow transfer     (H:MMAM/PM SGT, D Mon YY — expense, outbound)
    """

    @property
    def sender_domain(self) -> str:
        return "uobgroup.com"

    # Pattern 1: Card purchase (any currency)
    CARD_PATTERN = re.compile(
        r"A transaction of ([A-Z]{3})\s+([0-9,]+\.\d{2})\s+was made with your UOB Card ending (\d{4})"
        r"\s+on\s+(\d{2}/\d{2}/\d{2})\s+at\s+(.+?)\s*\.\s*If unauthorised",
        re.IGNORECASE,
    )
    # Pattern 2: Accumulated transit
    TRANSIT_PATTERN = re.compile(
        r"accumulated transit transactions of SGD\s+([0-9,]+\.\d{2})\s+has been billed"
        r"\s+to your UOB card ending (\d{4})\s+on\s+(\d{2}/\d{2}/\d{2})",
        re.IGNORECASE,
    )
    # Pattern 3: Card reversal (income, non-SGD currency possible)
    REVERSAL_PATTERN = re.compile(
        r"A transaction of ([0-9,]+\.\d{2})\s+([A-Z]{3})\s+made with your UOB card ending (\d{4})"
        r"\s+on\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2}),"
        r"\s+(\d{1,2}:\d{2}(?:AM|PM))\s+at\s+(.+?)\s+has been reversed",
        re.IGNORECASE,
    )
    # Pattern 4: PayNow received (income)
    PAYNOW_RECEIVED_PATTERN = re.compile(
        r"You have received\s+SGD\s+([0-9,]+\.\d{2})\s+in your PayNow-linked account ending\s+(\d+)"
        r"\s+on\s+(\d{2}-[A-Z]{3}-\d{4})\s+(\d{1,2}:\d{2}(?:AM|PM))",
        re.IGNORECASE,
    )
    # Pattern 5: One-time transfer (expense)
    TRANSFER_PATTERN = re.compile(
        r"You made a one-time transfer of SGD\s+([0-9,]+\.\d{2})\s+to\s+(.+?)"
        r"\s+at\s+(\d{1,2}:\d{2}(?:AM|PM))\s+SGT,\s+(\d{1,2})\s+"
        r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2}),",
        re.IGNORECASE,
    )
    # Pattern 6: NETS QR payment (expense)
    NETS_QR_PATTERN = re.compile(
        r"You made a NETS QR payment of SGD\s+([0-9,]+\.\d{2})\s+to\s+(.+?)"
        r"\s+on your a/c ending\s+\d+"
        r"\s+at\s+(\d{1,2}:\d{2}(?:AM|PM))\s+SGT,\s+(\d{1,2})\s+"
        r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2})",
        re.IGNORECASE,
    )
    # Pattern 7: PayNow transfer (expense, outbound)
    PAYNOW_SENT_PATTERN = re.compile(
        r"You made a PayNow transfer of SGD\s+([0-9,]+\.\d{2})\s+to\s+(.+?)"
        r"\s+on your a/c ending\s+\d+"
        r"\s+at\s+(\d{1,2}:\d{2}(?:AM|PM))\s+SGT,\s+(\d{1,2})\s+"
        r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2})",
        re.IGNORECASE,
    )

    def can_parse(self, sender: str, subject: str) -> bool:
        return self.sender_domain in sender.lower()

    def parse(self, email_body: str) -> Optional[ParseResult]:
        return (
            self._parse_card(email_body)
            or self._parse_transit(email_body)
            or self._parse_reversal(email_body)
            or self._parse_paynow_received(email_body)
            or self._parse_transfer(email_body)
            or self._parse_nets_qr(email_body)
            or self._parse_paynow_sent(email_body)
        )

    @staticmethod
    def _parse_time_12h(time_str: str) -> Optional[tuple[int, int]]:
        """Parse '2:05PM' or '12:14AM' → (hour24, minute). Returns None on parse failure."""
        try:
            dt = datetime.strptime(time_str.upper(), "%I:%M%p")
            return dt.hour, dt.minute
        except ValueError:
            return None

    @staticmethod
    def _iso_from_slash_date(date_str: str) -> str:
        """'DD/MM/YY' → 'YYYY-MM-DD'."""
        day, month, short_year = date_str.split("/")
        return f"{2000 + int(short_year)}-{month}-{day}"

    @staticmethod
    def _iso_from_dmmy(day: int, month_str: str, short_year: int) -> str:
        """day=3, month_str='Mar', short_year=26 → '2026-03-03'."""
        month = datetime.strptime(month_str[:3].capitalize(), "%b").month
        return f"{2000 + short_year}-{month:02d}-{day:02d}"

    def _parse_card(self, body: str) -> Optional[ParseResult]:
        m = self.CARD_PATTERN.search(body)
        if not m:
            return None
        currency = m.group(1).upper()
        amount = float(m.group(2).replace(",", ""))
        card_last4 = m.group(3)
        iso_date = self._iso_from_slash_date(m.group(4))
        merchant = m.group(5).strip()
        return ParseResult(
            source="uob_card",
            source_id="",
            amount=amount,
            currency=currency,
            merchant=merchant,
            description=f"UOB Card *{card_last4} - {merchant}",
            payment_identity_kind="uob_card_last4",
            payment_identity=card_last4,
            transaction_date=f"{iso_date}T00:00:00",
            timestamp_precision="date",
            raw_data=body,
        )

    def _parse_transit(self, body: str) -> Optional[ParseResult]:
        m = self.TRANSIT_PATTERN.search(body)
        if not m:
            return None
        amount = float(m.group(1).replace(",", ""))
        iso_date = self._iso_from_slash_date(m.group(3))
        return ParseResult(
            source="uob_card",
            source_id="",
            amount=amount,
            merchant="Transit",
            description=f"UOB Card *{m.group(2)} - Transit",
            payment_identity_kind="uob_card_last4",
            payment_identity=m.group(2),
            transaction_date=f"{iso_date}T00:00:00",
            timestamp_precision="date",
            raw_data=body,
        )

    def _parse_reversal(self, body: str) -> Optional[ParseResult]:
        m = self.REVERSAL_PATTERN.search(body)
        if not m:
            return None
        amount = float(m.group(1).replace(",", ""))
        currency, card_last4 = m.group(2).upper(), m.group(3)
        day, month_str, short_year = int(m.group(4)), m.group(5), int(m.group(6))
        time_str, merchant = m.group(7), m.group(8).strip()
        iso_date = self._iso_from_dmmy(day, month_str, short_year)
        parsed_time = self._parse_time_12h(time_str)
        h, mi = parsed_time or (0, 0)
        return ParseResult(
            source="uob_card",
            source_id="",
            amount=amount,
            merchant=merchant,
            description=f"UOB Card *{card_last4} - {merchant} (Reversal)",
            payment_identity_kind="uob_card_last4",
            payment_identity=card_last4,
            transaction_date=f"{iso_date}T{h:02d}:{mi:02d}:00",
            timestamp_precision="minute" if parsed_time else "unknown",
            currency=currency,
            tx_type="income",
            raw_data=body,
        )

    def _parse_paynow_received(self, body: str) -> Optional[ParseResult]:
        m = self.PAYNOW_RECEIVED_PATTERN.search(body)
        if not m:
            return None
        amount = float(m.group(1).replace(",", ""))
        account_ending = m.group(2)
        dt = datetime.strptime(
            f"{m.group(3).upper()} {m.group(4).upper()}", "%d-%b-%Y %I:%M%p"
        )
        return ParseResult(
            source="uob_paynow",
            source_id="",
            amount=amount,
            merchant="PayNow",
            description=f"PayNow received to a/c ending {account_ending}",
            transaction_date=dt.strftime("%Y-%m-%dT%H:%M:%S"),
            timestamp_precision="minute",
            payment_identity_kind="uob_account_suffix",
            payment_identity=account_ending,
            tx_type="income",
            raw_data=body,
        )

    def _parse_transfer(self, body: str) -> Optional[ParseResult]:
        m = self.TRANSFER_PATTERN.search(body)
        if not m:
            return None
        amount = float(m.group(1).replace(",", ""))
        recipient = m.group(2).strip()
        time_str = m.group(3)
        day, month_str, short_year = int(m.group(4)), m.group(5), int(m.group(6))
        iso_date = self._iso_from_dmmy(day, month_str, short_year)
        parsed_time = self._parse_time_12h(time_str)
        h, mi = parsed_time or (0, 0)
        return ParseResult(
            source="uob_transfer",
            source_id="",
            amount=amount,
            merchant=recipient,
            description=f"Transfer to {recipient}",
            transaction_date=f"{iso_date}T{h:02d}:{mi:02d}:00",
            timestamp_precision="minute" if parsed_time else "unknown",
            raw_data=body,
        )

    def _parse_nets_qr(self, body: str) -> Optional[ParseResult]:
        m = self.NETS_QR_PATTERN.search(body)
        if not m:
            return None
        amount = float(m.group(1).replace(",", ""))
        merchant = m.group(2).strip()
        time_str = m.group(3)
        day, month_str, short_year = int(m.group(4)), m.group(5), int(m.group(6))
        iso_date = self._iso_from_dmmy(day, month_str, short_year)
        parsed_time = self._parse_time_12h(time_str)
        h, mi = parsed_time or (0, 0)
        return ParseResult(
            source="uob_nets",
            source_id="",
            amount=amount,
            merchant=merchant,
            description=f"NETS QR - {merchant}",
            transaction_date=f"{iso_date}T{h:02d}:{mi:02d}:00",
            timestamp_precision="minute" if parsed_time else "unknown",
            raw_data=body,
        )

    def _parse_paynow_sent(self, body: str) -> Optional[ParseResult]:
        m = self.PAYNOW_SENT_PATTERN.search(body)
        if not m:
            return None
        amount = float(m.group(1).replace(",", ""))
        recipient = m.group(2).strip()
        time_str = m.group(3)
        day, month_str, short_year = int(m.group(4)), m.group(5), int(m.group(6))
        iso_date = self._iso_from_dmmy(day, month_str, short_year)
        parsed_time = self._parse_time_12h(time_str)
        h, mi = parsed_time or (0, 0)
        return ParseResult(
            source="uob_paynow_sent",
            source_id="",
            amount=amount,
            merchant=recipient,
            description=f"PayNow transfer to {recipient}",
            transaction_date=f"{iso_date}T{h:02d}:{mi:02d}:00",
            timestamp_precision="minute" if parsed_time else "unknown",
            raw_data=body,
        )
