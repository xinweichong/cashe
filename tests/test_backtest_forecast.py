"""Smoke test for scripts/backtest_forecast.py — the actual published numbers
live in docs/forecast-backtest-2026-09-16.md (re-run the script to regenerate
them); this just guards the harness itself against silently breaking as
forecast.py/analytics.py evolve."""
from scripts.backtest_forecast import SCENARIOS, render_markdown


def test_every_scenario_runs_and_produces_comparable_rows():
    results = [scenario() for scenario in SCENARIOS]
    assert len(results) == len(SCENARIOS)
    for result in results:
        assert result["true_total"] > 0
        assert len(result["rows"]) >= 2
        for row in result["rows"]:
            assert row["old_error"] is not None
            if row["new_total"] is not None:
                assert row["new_error"] == round(row["new_total"] - result["true_total"], 2)
            else:
                assert row["new_status"] == "unavailable"


def test_markdown_report_renders_every_scenario():
    results = [scenario() for scenario in SCENARIOS]
    report = render_markdown(results)
    for result in results:
        assert f"## {result['scenario']}" in report
        assert f"${result['true_total']:.2f}" in report
