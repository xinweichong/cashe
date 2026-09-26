import pytest

from src.storage import RevisionConflict, Storage
from src import transaction_commands as commands


@pytest.fixture
def storage(in_memory_db):
    return Storage(connection=in_memory_db)


class TestCreateManual:
    def test_returns_typed_v2_shape(self, storage):
        result = commands.create_manual(
            storage, source_id="m1", amount=12.50, currency="SGD",
            merchant="Toast Box", category="Food", transaction_date="2026-04-16T12:00:00",
        )
        assert result["merchant"] == "Toast Box"
        assert result["revision"] == 1
        assert result["original"] == {"minor_units": 1250, "currency": "SGD"}
        assert result["conversion"]["status"] == "native"


class TestCreateManualWebParity:
    """R03 exit check: identical accepted values across clients — the
    Telegram-facing command (create_manual, wrapping
    create_manual_transaction) and the web v2 HTTP command (create_web,
    wrapping create_web_transaction) must classify and canonicalize the
    same logical input identically. They diverge only in caller-supplied
    identity (source/source_id), which this test excludes."""

    def test_identical_input_produces_identical_canonical_output(self):
        from src.db import init_db
        storage_a = Storage(connection=init_db(":memory:"))
        storage_b = Storage(connection=init_db(":memory:"))

        telegram_result = commands.create_manual(
            storage_a, source_id="tg1", amount=15.00, currency="THB", exchange_rate=0.039,
            merchant="Thai Cafe", category="Food", description="Lunch",
            transaction_date="2026-04-16T12:00:00", tx_type="expense",
        )
        web_result = commands.create_web(
            storage_b, {
                "amount": 15.00, "currency": "THB", "exchange_rate": 0.039,
                "merchant": "Thai Cafe", "category": "Food", "description": "Lunch",
                "transaction_date": "2026-04-16T12:00:00", "type": "expense",
            },
            source_id="web1",
        )

        for key in ("type", "merchant", "category", "description", "transaction_date",
                    "revision", "original", "reporting", "conversion"):
            assert telegram_result[key] == web_result[key], key
        # The only expected divergence is caller-supplied identity.
        assert telegram_result["source"] == "manual"
        assert web_result["source"] == "manual"


class TestCorrect:
    def test_applies_fields_and_returns_updated_shape(self, storage):
        tx_id = storage.insert_transaction(
            source="manual", source_id="m1", amount=12.50,
            merchant="Toast Box", transaction_date="2026-04-16T12:00:00",
        )
        result = commands.correct(storage, tx_id, {"merchant": "Ya Kun"})
        assert result["merchant"] == "Ya Kun"
        assert result["revision"] == 2

    def test_stale_expected_revision_raises_conflict(self, storage):
        tx_id = storage.insert_transaction(
            source="manual", source_id="m1", amount=12.50, transaction_date="2026-04-16T12:00:00",
        )
        with pytest.raises(RevisionConflict):
            commands.correct(storage, tx_id, {"merchant": "Ya Kun"}, expected_revision=99)


class TestRefundEvidence:
    def test_refund_of_shows_linked_purchase(self, storage):
        purchase_id = storage.insert_transaction(
            source="manual", source_id="p1", amount=100.0, merchant="Shop",
            transaction_date="2026-04-16", tx_type="expense",
        )
        refund_id = storage.insert_transaction(
            source="manual", source_id="r1", amount=30.0, merchant="Shop",
            transaction_date="2026-04-20", tx_type="refund",
        )
        result = commands.correct(storage, refund_id, {"refund_of_transaction_id": purchase_id})
        assert result["refund_of"]["transaction_id"] == purchase_id
        assert result["refund_of"]["merchant"] == "Shop"
        assert result["refund_of"]["amount"] == 100.0
        assert result["refund_of"]["warning"] is None
        assert result["refunded_by"] == []

    def test_refund_of_none_when_unlinked(self, storage):
        refund_id = storage.insert_transaction(
            source="manual", source_id="r2", amount=30.0, transaction_date="2026-04-20", tx_type="refund",
        )
        result = commands.to_v2(storage.get_transaction(refund_id), storage)
        assert result["refund_of"] is None

    def test_refunded_by_shows_linked_refunds_on_the_purchase(self, storage):
        purchase_id = storage.insert_transaction(
            source="manual", source_id="p2", amount=100.0, merchant="Shop",
            transaction_date="2026-04-16", tx_type="expense",
        )
        refund_id = storage.insert_transaction(
            source="manual", source_id="r3", amount=30.0, merchant="Shop",
            transaction_date="2026-04-20", tx_type="refund",
        )
        storage.update_transaction(refund_id, refund_of_transaction_id=purchase_id)
        result = commands.to_v2(storage.get_transaction(purchase_id), storage)
        assert len(result["refunded_by"]) == 1
        assert result["refunded_by"][0]["transaction_id"] == refund_id
        assert result["refunded_by"][0]["amount"] == 30.0

    def test_currency_mismatch_produces_a_warning(self, storage):
        purchase_id = storage.insert_transaction(
            source="manual", source_id="p3", amount=100.0, currency="SGD",
            transaction_date="2026-04-16", tx_type="expense",
        )
        refund_id = storage.insert_transaction(
            source="manual", source_id="r4", amount=30.0, currency="USD", exchange_rate=1.3,
            transaction_date="2026-04-20", tx_type="refund",
        )
        result = commands.correct(storage, refund_id, {"refund_of_transaction_id": purchase_id})
        assert "currency" in result["refund_of"]["warning"].lower()

    def test_refunds_exceeding_purchase_amount_produces_a_warning(self, storage):
        purchase_id = storage.insert_transaction(
            source="manual", source_id="p4", amount=50.0, currency="SGD",
            transaction_date="2026-04-16", tx_type="expense",
        )
        refund1_id = storage.insert_transaction(
            source="manual", source_id="r5", amount=30.0, currency="SGD",
            transaction_date="2026-04-18", tx_type="refund",
        )
        refund2_id = storage.insert_transaction(
            source="manual", source_id="r6", amount=30.0, currency="SGD",
            transaction_date="2026-04-20", tx_type="refund",
        )
        storage.update_transaction(refund1_id, refund_of_transaction_id=purchase_id)
        result = commands.correct(storage, refund2_id, {"refund_of_transaction_id": purchase_id})
        assert "exceed" in result["refund_of"]["warning"].lower()


class TestDelete:
    def test_returns_deletion_snapshot(self, storage):
        tx_id = storage.insert_transaction(
            source="manual", source_id="m1", amount=8.00,
            merchant="To Delete", transaction_date="2026-04-16T12:00:00",
        )
        result = commands.delete(storage, tx_id)
        assert result["merchant"] == "To Delete"
        assert "deleted_at" in result and result["deleted_at"]
        assert storage.get_transaction(tx_id) is None

    def test_nonexistent_raises(self, storage):
        with pytest.raises(ValueError, match="not found"):
            commands.delete(storage, 99999)


class TestUndo:
    def test_reverts_last_correction(self, storage):
        tx_id = storage.insert_transaction(
            source="manual", source_id="m1", amount=12.50,
            merchant="Old Name", transaction_date="2026-04-16T12:00:00",
        )
        commands.correct(storage, tx_id, {"merchant": "New Name"})
        result = commands.undo(storage, tx_id)
        assert result["merchant"] == "Old Name"

    def test_nonexistent_raises(self, storage):
        with pytest.raises(ValueError, match="not found"):
            commands.undo(storage, 99999)


class TestRestore:
    def test_recreates_deleted_transaction(self, storage):
        tx_id = storage.insert_transaction(
            source="manual", source_id="m1", amount=8.00,
            merchant="Restore Me", transaction_date="2026-04-16T12:00:00",
        )
        commands.delete(storage, tx_id)
        result = commands.restore(storage, tx_id)
        assert result["merchant"] == "Restore Me"
        assert result["revision"] == 2
