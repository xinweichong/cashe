"""Shared v2 transaction command implementations (R03).

The single place that turns a Storage mutation into a typed v2
Transaction/Deletion result (classification, canonical Money, conversion
provenance, revision). Used by both the /api/v2/transactions HTTP routes
and Telegram's correction/deletion handlers, so there is one
implementation of "what a transaction command does" regardless of which
channel calls it — channel-specific concerns (HTTP status codes, chat
replies, idempotency identity per source) stay with the caller.

Raises whatever src.storage raises (ValueError, RevisionConflict,
TransactionRequestConflict) — callers translate those into their own
presentation layer.
"""


def _refund_evidence(tx: dict, *, warning: str | None = None) -> dict:
    return {
        "transaction_id": tx["id"],
        "merchant": tx.get("merchant"),
        "transaction_date": tx.get("transaction_date"),
        "amount": tx.get("amount"),
        "currency": tx.get("currency") or "SGD",
        "warning": warning,
    }


def _refund_warning(purchase: dict, refund_currency: str, total_refunded: float) -> str | None:
    """Informational only — never blocks a link, never affects any total
    (netting already works from type='refund' alone, independent of
    linkage)."""
    purchase_currency = purchase.get("currency") or "SGD"
    if refund_currency != purchase_currency:
        return f"Refund currency ({refund_currency}) differs from the purchase currency ({purchase_currency})"
    if total_refunded > (purchase.get("amount") or 0):
        return "Linked refunds exceed the purchase amount"
    return None


def to_v2(tx: dict, storage) -> dict:
    """A transaction row as the public v2 Transaction shape."""
    refund_of = None
    target_id = tx.get("refund_of_transaction_id")
    if target_id is not None:
        purchase = storage.get_transaction(target_id)
        if purchase is not None:
            siblings = storage.get_refunds_of(purchase["id"])
            total_refunded = sum(s["amount"] for s in siblings)
            warning = _refund_warning(purchase, tx.get("currency") or "SGD", total_refunded)
            refund_of = _refund_evidence(purchase, warning=warning)

    refunded_by = [_refund_evidence(r) for r in storage.get_refunds_of(tx["id"])]

    return {
        "id": tx["id"],
        "revision": tx["revision"],
        "source": tx["source"],
        "type": tx["type"],
        "merchant": tx.get("merchant"),
        "category": tx.get("category"),
        "description": tx.get("description"),
        "transaction_date": tx.get("transaction_date"),
        "original": {
            "minor_units": tx.get("original_minor_units"),
            "currency": tx.get("currency") or "SGD",
        },
        "reporting": (
            {"minor_units": tx["reporting_minor_units"], "currency": "SGD"}
            if tx.get("reporting_minor_units") is not None else None
        ),
        "conversion": {
            "status": tx.get("conversion_status"),
            "rate": tx.get("conversion_rate"),
            "source": tx.get("conversion_source"),
            "quoted_at": tx.get("conversion_quoted_at"),
        },
        "refund_of": refund_of,
        "refunded_by": refunded_by,
    }


def create_manual(storage, **fields) -> dict:
    """Create a transaction via Storage.create_manual_transaction.

    For callers with their own idempotency/identity story (Telegram's
    create_telegram_transaction, direct in-process callers) rather than the
    web Idempotency-Key header contract — see create_web for that.
    """
    tx_id = storage.create_manual_transaction(**fields)
    return to_v2(storage.get_transaction(tx_id), storage)


def create_web(storage, body: dict, *, source_id: str, request_key=None, timezone="Asia/Singapore") -> dict:
    tx = storage.create_web_transaction(body, source_id=source_id, request_key=request_key, timezone=timezone)
    return to_v2(tx, storage)


def correct(storage, tx_id: int, fields: dict, *, remember_category: bool = False, expected_revision=None) -> dict:
    storage.update_transaction(
        tx_id, remember_category=remember_category, expected_revision=expected_revision, **fields,
    )
    return to_v2(storage.get_transaction(tx_id), storage)


def delete(storage, tx_id: int) -> dict:
    tx = storage.get_transaction(tx_id)
    if tx is None:
        raise ValueError(f"transaction {tx_id} not found")
    deleted_at = storage.delete_transaction(tx_id)
    result = to_v2(tx, storage)
    result["deleted_at"] = deleted_at
    return result


def undo(storage, tx_id: int, *, expected_revision=None) -> dict:
    tx = storage.get_transaction(tx_id)
    if tx is None:
        raise ValueError(f"transaction {tx_id} not found")
    storage.undo_last_mutation(tx_id, expected_revision=expected_revision)
    return to_v2(storage.get_transaction(tx_id), storage)


def restore(storage, tx_id: int) -> dict:
    storage.restore_deleted_transaction(tx_id)
    return to_v2(storage.get_transaction(tx_id), storage)
