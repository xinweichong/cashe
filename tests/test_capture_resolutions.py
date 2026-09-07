import pytest

from src.main import init_db
from src.storage import Storage, TransactionRequestConflict


def test_resolution_survives_restart_preserves_evidence_and_reopens_without_retry(tmp_path):
    path = str(tmp_path / 'user.db')
    conn = init_db(path)
    storage = Storage(conn)
    original = storage.begin_telegram_nl_input(100, 10, 'private text')
    storage.fail_telegram_nl_input(original['id'])
    original = storage.get_source_event('telegram_nl', original['source_id'])
    for _ in range(2):
        storage.set_capture_issue_handled(original['id'], True)
    conn.close()
    conn = init_db(path)
    try:
        storage = Storage(conn)
        assert storage.list_capture_issues() == []
        assert storage.get_home_briefing()['capture_issue_count'] == 0
        assert storage.list_capture_issues(include_handled=True)[0]['handled']
        assert storage.begin_telegram_nl_input(100, 10, 'private text') is None
        assert storage.get_source_event('telegram_nl', original['source_id']) == original
        for _ in range(2):
            storage.set_capture_issue_handled(original['id'], False)
        assert not storage.list_capture_issues()[0]['handled']
        assert storage.get_home_briefing()['capture_issue_count'] == 1
        assert storage.get_source_event('telegram_nl', original['source_id']) == original
        assert storage.query_transactions(limit=50) == []
    finally:
        conn.close()


def test_resolution_blocks_inflight_draft_without_replacing_existing_card(in_memory_db):
    storage = Storage(in_memory_db)
    proposal = dict(amount=12, currency='SGD', merchant='Cafe', category='Food', date='2026-09-08')
    storage.save_telegram_draft('a' * 32, 100, proposal)
    event = storage.begin_telegram_nl_input(100, 10, 'private')
    storage.set_capture_issue_handled(event['id'], True)
    with pytest.raises(TransactionRequestConflict, match='already handled'):
        storage.save_telegram_draft('b' * 32, 100, proposal, message_id=10, message_text='private')
    assert storage.get_telegram_draft('a' * 32, 100) is not None
    assert storage.get_telegram_draft('b' * 32, 100) is None
    assert storage.get_telegram_draft_for_message(100, 10, 'private') is None
    assert storage.get_source_event('telegram_nl', event['source_id']) == event


def test_resolution_selection_pagination_and_source_restrictions(in_memory_db):
    storage = Storage(in_memory_db)
    events = [storage.begin_telegram_nl_input(100, n, 'text') for n in range(1, 4)]
    storage.set_capture_issue_handled(events[1]['id'], True)
    assert [r['id'] for r in storage.list_capture_issues(1, 1)] == [events[0]['id']]
    assert [r['id'] for r in storage.list_capture_issues(1, 1, True)] == [events[1]['id']]
    bank = storage.record_source_event('gmail', 'bank', '{}', '1')
    for handled in (True, False):
        with pytest.raises(ValueError, match='Only unfinished'):
            storage.set_capture_issue_handled(bank['id'], handled)
        with pytest.raises(ValueError, match='not found'):
            storage.set_capture_issue_handled(9999, handled)
    storage.finish_source_event(events[0]['id'], status='processed')
    with pytest.raises(ValueError, match='Only unfinished'):
        storage.set_capture_issue_handled(events[0]['id'], True)


def test_reopening_preserves_exhausted_attempt_limit_and_user_isolation(in_memory_db):
    storage = Storage(in_memory_db)
    for _ in range(5):
        event = storage.begin_telegram_nl_input(100, 10, 'private')
    storage.set_capture_issue_handled(event['id'], True)
    other_conn = init_db(':memory:')
    try:
        other = Storage(other_conn)
        other_event = other.begin_telegram_nl_input(100, 10, 'other private')
        assert not other.list_capture_issues()[0]['handled']
        other.set_capture_issue_handled(other_event['id'], False)
        assert storage.list_capture_issues() == []
    finally:
        other_conn.close()
    storage.set_capture_issue_handled(event['id'], False)
    assert storage.begin_telegram_nl_input(100, 10, 'private') is None
    assert storage.list_capture_issues()[0]['attempts'] == 5
