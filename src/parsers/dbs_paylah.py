import re
from datetime import datetime
from typing import Optional
from src.parsers.base import ParseResult
from src.config import local_now


class DbsPaylahParser:
    @property
    def sender_domain(self) -> str:
        return "dbs.com"

    AMOUNT_PATTERN = re.compile(r"Amount:\s+SGD([0-9,]+\.\d{2})")
    MERCHANT_PATTERN = re.compile(r"To:\s+(.+?)(?:\s{2,}|$)", re.MULTILINE)
    REF_PATTERN = re.compile(r"Transaction Ref:\s+(\S+)")
    DATE_PATTERN = re.compile(r"Date & Time:\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}):(\d{2})")

    def can_parse(self, sender: str, subject: str) -> bool:
        return self.sender_domain in sender.lower()

    def parse(self, email_body: str) -> Optional[ParseResult]:
        amount_match = self.AMOUNT_PATTERN.search(email_body)
        merchant_match = self.MERCHANT_PATTERN.search(email_body)

        if not amount_match or not merchant_match:
            return None

        amount_str = amount_match.group(1).replace(",", "")
        merchant = merchant_match.group(1).strip()

        ref_match = self.REF_PATTERN.search(email_body)
        source_id = ref_match.group(1) if ref_match else None

        # Parse date — DBS omits the year, so infer from current date
        transaction_date = None
        date_match = self.DATE_PATTERN.search(email_body)
        if date_match:
            day = int(date_match.group(1))
            month_str = date_match.group(2)
            month = datetime.strptime(month_str, "%b").month
            year = local_now().year
            hour = int(date_match.group(3))
            minute = int(date_match.group(4))
            transaction_date = f"{year}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:00"

        return ParseResult(
            source="dbs_paylah",
            source_id=source_id,
            amount=float(amount_str),
            merchant=merchant,
            description=email_body.strip(),
            transaction_date=transaction_date,
            timestamp_precision="minute" if date_match else "unknown",
            raw_data=email_body,
        )
