"""Export the /api/v2/* OpenAPI schema for TypeScript generation.

python -m scripts.export_v2_openapi_schema [OUTPUT]

Writes a filtered OpenAPI document containing only /api/v2/* paths (and the
component schemas they reference) to OUTPUT (default stdout). The frontend
build regenerates TypeScript types from this file with openapi-typescript;
`npm run check-types:v2` fails if the checked-in generated file has drifted
from what the current backend contracts.py/app.py would produce.
"""
import argparse
import json
import sys
from pathlib import Path

from src.web.app import create_dashboard_app


def _referenced_schema_names(node, names: set[str]) -> None:
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            names.add(ref.removeprefix("#/components/schemas/"))
        for value in node.values():
            _referenced_schema_names(value, names)
    elif isinstance(node, list):
        for item in node:
            _referenced_schema_names(item, names)


def build_v2_schema() -> dict:
    app = create_dashboard_app(user_manager=None, admin_storage=None)
    full = app.openapi()

    v2_paths = {path: item for path, item in full["paths"].items() if path.startswith("/api/v2/")}

    all_schemas = full.get("components", {}).get("schemas", {})
    referenced: set[str] = set()
    _referenced_schema_names(v2_paths, referenced)
    # Schemas can reference other schemas (e.g. TransactionDeletion -> TransactionV2's
    # fields); keep expanding until no new ones are pulled in.
    frontier = set(referenced)
    while frontier:
        newly_referenced: set[str] = set()
        for name in frontier:
            _referenced_schema_names(all_schemas.get(name, {}), newly_referenced)
        frontier = newly_referenced - referenced
        referenced |= newly_referenced

    return {
        "openapi": full["openapi"],
        "info": {"title": "Expense Tracker v2 API", "version": full["info"]["version"]},
        "paths": v2_paths,
        "components": {"schemas": {name: all_schemas[name] for name in sorted(referenced)}},
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, nargs="?", default=None)
    args = parser.parse_args(argv)
    text = json.dumps(build_v2_schema(), indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
