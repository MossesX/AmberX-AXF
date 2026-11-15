"""axf-data journal tables (append-only journal lines).

`install(store)` creates the tables a Store needs next to its key index and registers its hooks.
"""
from __future__ import annotations

JOURNAL_SQL = """
CREATE TABLE IF NOT EXISTS journal (
  ns TEXT NOT NULL, path TEXT NOT NULL, seq INTEGER NOT NULL, at TEXT NOT NULL, by TEXT NOT NULL, line TEXT NOT NULL,
  PRIMARY KEY (ns, path, seq)
);
"""


def install(store) -> None:
    store.db.executescript(JOURNAL_SQL)
