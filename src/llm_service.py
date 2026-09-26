"""LLM Intelligence service — wraps Google Gemini Flash API.

Absent when gemini_api_key is not configured. All callers must guard:
    if self.llm_service:
        result = self.llm_service.method(...)
"""

import json
import logging
from typing import Optional

from src.config import DEFAULT_TIMEZONE

logger = logging.getLogger(__name__)


class LLMService:
    """Thin wrapper around Gemini Flash for finance-domain tasks.

    All methods receive pre-computed structured data (never raw transactions).
    LLM only produces prose and classifications — never financial arithmetic.
    """

    def __init__(self, api_key: str, model: str = "gemini-2.0-flash"):
        from google import genai
        from google.genai import types
        self._client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=15000),
        )
        self._model = model
        logger.info("LLMService initialised with model %s", model)

    def _call(self, prompt: str) -> str:
        """Make a single Gemini call. Raises on API error."""
        response = self._client.models.generate_content(
            model=self._model,
            contents=prompt,
        )
        return response.text.strip()

    def _call_json(self, prompt: str):
        """_call, then parse the reply as JSON (tolerating a markdown fence)."""
        raw = self._call(prompt).removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        return json.loads(raw)

    def parse_telegram_message(self, text: str, categories: list[str], timezone: str = DEFAULT_TIMEZONE) -> Optional[dict]:
        """Parse free-text transaction message into structured fields.

        Returns {amount, currency, merchant, date, category_hint, confidence}
        or None if the message doesn't look like a transaction.
        confidence is 0.0–1.0.
        """
        from src.config import local_now
        today = local_now(timezone).strftime("%Y-%m-%d")
        cat_list = ", ".join(categories)
        prompt = f"""You are a transaction parser for a personal finance app.
Parse the following message into a JSON object with these fields:
  amount (number, required), currency (string, default "SGD"),
  merchant (string, required), date (ISO date string YYYY-MM-DD, default today {today}),
  category_hint (string — pick the closest from: {cat_list}),
  confidence (number 0.0–1.0 — how sure you are this is a transaction).

If the message is not a financial transaction, return {{"confidence": 0.0}}.
Respond with valid JSON only, no markdown.

Message: {text}"""
        try:
            return self._call_json(prompt)
        except Exception as e:
            logger.warning("parse_telegram_message failed (%s): %s", type(e).__name__, str(e)[:120])
            return None

    def generate_period_insight(self, summary: dict) -> dict:
        """Generate a narrative summary + 2–3 actionable nudges from a pre-computed summary dict.

        summary keys expected:
          period_label, total_expense, total_income, savings_rate,
          change_vs_last_month_pct, top_categories [{name, amount, change_pct}],
          velocity_status

        Returns {narrative: str, nudges: list[str]}
        """
        prompt = f"""You are a concise personal finance advisor writing for a dashboard card.
Given this financial summary for {summary.get('period_label', 'this period')}, write:
1. A 2–3 sentence narrative paragraph summarising spending, income, and financial health.
2. Exactly 2–3 short, actionable nudge strings (max 12 words each).

Summary data:
{json.dumps(summary, indent=2)}

Respond with valid JSON only:
{{"narrative": "...", "nudges": ["...", "...", "..."]}}
No markdown, no extra text."""
        try:
            data = self._call_json(prompt)
            return {
                "narrative": data.get("narrative", ""),
                "nudges": data.get("nudges", [])[:3],
            }
        except Exception as e:
            logger.warning("generate_period_insight failed (%s): %s", type(e).__name__, str(e)[:120])
            return {"narrative": "", "nudges": []}

def create_llm_service(config: dict) -> Optional[LLMService]:
    """Return LLMService only when both an API key and an explicit policy
    acknowledgement are configured, else None.

    An API key alone is not sufficient. `gemini_policy_confirmed: true` must
    only be set by an operator who has verified the current project's
    billing/quota status and applicable data terms — this flag is a manual
    gate, not evidence of that verification.
    """
    api_key = config.get("gemini_api_key", "")
    if not api_key:
        logger.info("LLMService disabled — gemini_api_key not configured")
        return None
    if not config.get("gemini_policy_confirmed", False):
        logger.warning(
            "LLMService disabled — gemini_api_key is set but gemini_policy_confirmed "
            "is not true. Set gemini_policy_confirmed: true only after verifying "
            "billing/quota and data-handling terms for the configured project."
        )
        return None
    model = config.get("gemini_model", "gemini-2.0-flash")
    return LLMService(api_key=api_key, model=model)
