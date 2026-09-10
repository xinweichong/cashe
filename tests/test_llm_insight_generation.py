from unittest.mock import Mock

from src.config import local_now
from src.storage import Storage
from src.user_manager import _generate_llm_insight


def test_skips_llm_call_when_no_income_this_period(in_memory_db):
    # A period with expenses but no recorded income has no meaningful
    # savings_rate denominator — generating an LLM narrative from a
    # fabricated 0% rate would be misleading "advice" from absent data,
    # the same class of gap get_health_score already guards against via
    # has_income_data.
    storage = Storage(connection=in_memory_db)
    today = local_now().strftime("%Y-%m-%d")
    storage.insert_transaction(
        source="manual", source_id="e1", amount=50.0, merchant="Fairprice",
        category="Groceries", transaction_date=today, tx_type="expense",
    )
    llm_service = Mock()

    _generate_llm_insight(storage, llm_service)

    llm_service.generate_period_insight.assert_not_called()
    assert storage.get_setting("llm_insight_content", "") == ""
    assert storage.get_setting("llm_insight_generated_at", "") == ""


def test_skips_llm_call_when_period_is_entirely_empty(in_memory_db):
    storage = Storage(connection=in_memory_db)
    llm_service = Mock()

    _generate_llm_insight(storage, llm_service)

    llm_service.generate_period_insight.assert_not_called()


def test_generates_and_caches_insight_when_income_present(in_memory_db):
    storage = Storage(connection=in_memory_db)
    today = local_now().strftime("%Y-%m-%d")
    storage.insert_transaction(
        source="manual", source_id="i1", amount=5000.0, merchant="Employer",
        category="Salary", transaction_date=today, tx_type="income",
    )
    storage.insert_transaction(
        source="manual", source_id="e1", amount=1000.0, merchant="Fairprice",
        category="Groceries", transaction_date=today, tx_type="expense",
    )
    llm_service = Mock()
    llm_service.generate_period_insight.return_value = {"narrative": "Doing fine.", "nudges": []}

    _generate_llm_insight(storage, llm_service)

    llm_service.generate_period_insight.assert_called_once()
    summary = llm_service.generate_period_insight.call_args[0][0]
    assert summary["total_income"] == 5000.0
    assert summary["total_expense"] == 1000.0
    assert summary["savings_rate"] == 80.0
    assert storage.get_setting("llm_insight_content", "") != ""
    assert storage.get_setting("llm_insight_generated_at", "") != ""
