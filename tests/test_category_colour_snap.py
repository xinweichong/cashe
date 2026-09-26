import json
import sqlite3

from src.migrations import _snap_category_colours


def _db(colours: dict, snapped: str | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE categories (name TEXT PRIMARY KEY, color TEXT)")
    conn.execute("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    conn.executemany("INSERT INTO categories VALUES (?, ?)", colours.items())
    if snapped is not None:
        conn.execute("INSERT INTO app_settings VALUES ('category_colors_snapped_v2', ?)", (snapped,))
    return conn


def _colours(conn) -> dict:
    return dict(conn.execute("SELECT name, color FROM categories"))


def _setting(conn, key):
    row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None


def test_snaps_custom_colours_to_the_nearest_palette_colour_and_backs_them_up():
    conn = _db({"Food": "#00D0A0", "Fun": "#FF6B6B", "Other": None})
    _snap_category_colours(conn)
    assert _colours(conn) == {"Food": "#00D4AA", "Fun": "#FF6B6B", "Other": None}
    assert json.loads(_setting(conn, "category_colors_pre_v2")) == {"Food": "#00D0A0", "Fun": "#FF6B6B", "Other": None}
    assert _setting(conn, "category_colors_snapped_v2") == "true"


def test_leaves_a_database_the_browser_already_snapped_alone():
    conn = _db({"Food": "#123456"}, snapped="true")
    _snap_category_colours(conn)
    assert _colours(conn) == {"Food": "#123456"}
    assert _setting(conn, "category_colors_pre_v2") is None


def test_skips_a_snap_that_would_duplicate_another_categorys_colour():
    conn = _db({"Food": "#00D4AA", "Cafe": "#00D0A0"})
    _snap_category_colours(conn)
    assert _colours(conn) == {"Food": "#00D4AA", "Cafe": "#00D0A0"}
    assert _setting(conn, "category_colors_snapped_v2") == "true"


def test_an_unparseable_colour_takes_the_first_palette_colour():
    conn = _db({"Odd": "teal"})
    _snap_category_colours(conn)
    assert _colours(conn) == {"Odd": "#00D4AA"}


def test_nearest_palette_colour_matches_the_former_frontend_rule():
    from src.migrations import _nearest_palette_colour
    assert _nearest_palette_colour("#00D4AA") == "#00D4AA"
    assert _nearest_palette_colour("#00D2A8") == "#00D4AA"
    assert _nearest_palette_colour("#FF6F70") == "#FF6B6B"
    assert _nearest_palette_colour("#FF0000") in {"#FB923C", "#FB7185", "#FF6B6B", "#F97316"}
    assert _nearest_palette_colour("not-a-hex") == "#00D4AA"
