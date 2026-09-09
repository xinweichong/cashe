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
