"""LLM Intelligence service — wraps Google Gemini Flash API.

Absent when gemini_api_key is not configured. All callers must guard:
    if self.llm_service:
        result = self.llm_service.method(...)
"""

import json
import logging
from typing import Optional

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

    def parse_telegram_message(self, text: str, categories: list[str], timezone: str = "Asia/Singapore") -> Optional[dict]:
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
            raw = self._call(prompt)
            raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            return json.loads(raw)
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
            raw = self._call(prompt)
            raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            data = json.loads(raw)
            return {
                "narrative": data.get("narrative", ""),
                "nudges": data.get("nudges", [])[:3],
            }
        except Exception as e:
            logger.warning("generate_period_insight failed (%s): %s", type(e).__name__, str(e)[:120])
            return {"narrative": "", "nudges": []}

    def generate_weekly_insight(self, summary: dict) -> dict:
        """Narrative + 2–3 nudges for last 7 days. Focuses on daily patterns and velocity.

        summary keys: period_label, total_expense, total_income, top_categories,
                      velocity_status, change_vs_last_week_pct
        Returns {narrative: str, nudges: list[str]}
        """
        prompt = f"""You are a concise personal finance advisor writing for a mobile app.
Given this 7-day spending summary for {summary.get('period_label', 'this week')}, write:
1. A 2–3 sentence narrative focusing on daily spending patterns and pace.
2. Exactly 2–3 short, actionable nudge strings (max 12 words each).

Summary data:
{json.dumps(summary, indent=2)}

Respond with valid JSON only:
{{"narrative": "...", "nudges": ["...", "...", "..."]}}
No markdown, no extra text."""
        try:
            raw = self._call(prompt)
            raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            data = json.loads(raw)
            return {"narrative": data.get("narrative", ""), "nudges": data.get("nudges", [])[:3]}
        except Exception as e:
            logger.warning("generate_weekly_insight failed (%s): %s", type(e).__name__, str(e)[:120])
            return {"narrative": "", "nudges": []}

    def generate_monthly_insight(self, summary: dict) -> dict:
        """Narrative + 2–3 nudges for a calendar month. Focuses on category shifts and savings rate.

        summary keys: period_label, total_expense, total_income, savings_rate,
                      change_vs_last_month_pct, top_categories, velocity_status
        Returns {narrative: str, nudges: list[str]}
        """
        prompt = f"""You are a concise personal finance advisor writing for a mobile app.
Given this monthly spending summary for {summary.get('period_label', 'this month')}, write:
1. A 2–3 sentence narrative focusing on category shifts vs last month and savings rate.
2. Exactly 2–3 short, actionable nudge strings (max 12 words each).

Summary data:
{json.dumps(summary, indent=2)}

Respond with valid JSON only:
{{"narrative": "...", "nudges": ["...", "...", "..."]}}
No markdown, no extra text."""
        try:
            raw = self._call(prompt)
            raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            data = json.loads(raw)
            return {"narrative": data.get("narrative", ""), "nudges": data.get("nudges", [])[:3]}
        except Exception as e:
            logger.warning("generate_monthly_insight failed (%s): %s", type(e).__name__, str(e)[:120])
            return {"narrative": "", "nudges": []}

    def explain_anomaly(self, merchant: str, amount: float, avg: float, category: str) -> str:
        """Return one sentence explaining an unusual transaction."""
        prompt = f"""In one concise sentence (max 20 words), explain why a {category} charge of \
${amount:.2f} at {merchant} is unusual given the typical amount is ${avg:.2f}. \
No markdown."""
        try:
            return self._call(prompt)
        except Exception as e:
            logger.warning("explain_anomaly failed (%s): %s", type(e).__name__, str(e)[:120])
            return ""

    def explain_subscription_change(
        self, merchant: str, label: str, old_amount: float, new_amount: float
    ) -> str:
        """Return one sentence noting a subscription price change."""
        diff = new_amount - old_amount
        annual = abs(diff) * 12
        prompt = f"""In one sentence (max 25 words), note that {label or merchant} changed price \
from ${old_amount:.2f} to ${new_amount:.2f}/month (${annual:.2f}/year {'more' if diff > 0 else 'less'}). \
No markdown."""
        try:
            return self._call(prompt)
        except Exception as e:
            logger.warning("explain_subscription_change failed (%s): %s", type(e).__name__, str(e)[:120])
            return ""

    def generate_goal_coaching(self, goal: dict, spending: dict) -> str:
        """Return a short paragraph with coaching toward a savings goal."""
        prompt = f"""In 2–3 sentences, give practical advice to help reach this savings goal faster.
Focus on the highest-spending categories as the lever. Be specific and encouraging.
No markdown.

Goal: {json.dumps(goal, indent=2)}
Spending context: {json.dumps(spending, indent=2)}"""
        try:
            return self._call(prompt)
        except Exception as e:
            logger.warning("generate_goal_coaching failed (%s): %s", type(e).__name__, str(e)[:120])
            return ""


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
