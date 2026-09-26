from scripts.export_v2_openapi_schema import build_v2_schema


def test_only_v2_paths_are_included():
    schema = build_v2_schema()
    assert schema["paths"], "expected at least one /api/v2 path"
    assert all(path.startswith("/api/v2/") for path in schema["paths"])
    assert "/api/transactions" not in schema["paths"]
    assert "/api/transactions/{tx_id}" not in schema["paths"]


def test_transaction_command_paths_present():
    schema = build_v2_schema()
    assert "/api/v2/transactions" in schema["paths"]
    assert "/api/v2/transactions/{tx_id}" in schema["paths"]
    assert "/api/v2/transactions/{tx_id}/undo" in schema["paths"]
    assert "/api/v2/transactions/{tx_id}/restore" in schema["paths"]


def test_referenced_schemas_are_included_and_transitively_expanded():
    schema = build_v2_schema()
    schemas = schema["components"]["schemas"]
    assert "TransactionV2" in schemas
    assert "TransactionCreate" in schemas
    assert "TransactionDeletion" in schemas
    assert "TransactionUndo" in schemas
    # TransactionV2 references OriginalMoney/Money/ConversionProvenance —
    # pulled in transitively, not just the schemas named directly by paths.
    assert "OriginalMoney" in schemas
    assert "ConversionProvenance" in schemas


def test_schema_is_valid_json_serializable_and_deterministic():
    first = build_v2_schema()
    second = build_v2_schema()
    assert first == second
