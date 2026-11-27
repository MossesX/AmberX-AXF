#!/usr/bin/env python3
"""Mirror the SQLite files the console still writes into Postgres rows (tables.py: <prefix>_<table>, counts checked).

  python mirror_sync.py --all                        every source in AXF_DATA_MIRROR found under AXF_DATA_MIRROR_DIR
  python mirror_sync.py plugins/chat-viewer/chats.db  one source (its key in the data store)
  python mirror_sync.py --file /path/x.sqlite --prefix chats   any SQLite file, any prefix

Runs inside the axf-data container (the console's plugin data folders are mounted read-only at /mnt/console-plugins by
deploy/install-data.sh; deploy/axf-data-backup.cron runs --all nightly). The same work runs on demand through
POST /v1/_meta/tables/sync { source } (console: Data store plugin, `axf data tables --sync <source>`, MCP, voice).
The Shipped features ledger also lands here on every upload (blob-sqlite under the 256 MiB limit); the Chat viewer
database is bigger than a blob may be, so this file sync is its only road onto Postgres until the plugin writes rows itself.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog='mirror_sync.py')
    ap.add_argument('source', nargs='?', help='a mirrored key, e.g. plugins/chat-viewer/chats.db')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--file', default='')
    ap.add_argument('--prefix', default='')
    ap.add_argument('--dir', default=os.environ.get('AXF_DATA_MIRROR_DIR', '/mnt/console-plugins'))
    ap.add_argument('--dsn', default=os.environ.get('AXF_DATA_DSN', ''))
    ap.add_argument('--schema', default=os.environ.get('AXF_DATA_PG_SCHEMA', 'public'))
    a = ap.parse_args(argv)
    if not a.dsn:
        print('AXF_DATA_DSN is unset: the SQLite engine has no tables to mirror into', file=sys.stderr)
        return 1
    import psycopg
    from psycopg.rows import dict_row
    import tables as T
    from pg import _dsn_with_schema
    from store import now_iso

    jobs: list[tuple[str, str, str]] = []  # (source, prefix, file)
    mm = T.mirror_map()
    if a.file:
        if not a.prefix:
            ap.error('--file needs --prefix')
        jobs.append((a.file, a.prefix, a.file))
    elif a.all:
        for src, prefix in sorted(mm.items()):
            rel = src.split('/', 1)[1] if src.startswith('plugins/') else src
            f = Path(a.dir) / rel
            if f.is_file():
                jobs.append((src, prefix, str(f)))
            else:
                print(json.dumps({'source': src, 'skipped': f'{f} not mounted'}))
    elif a.source:
        if a.source not in mm:
            print(f'{a.source} is not in AXF_DATA_MIRROR ({", ".join(sorted(mm))})', file=sys.stderr)
            return 2
        rel = a.source.split('/', 1)[1] if a.source.startswith('plugins/') else a.source
        jobs.append((a.source, mm[a.source], str(Path(a.dir) / rel)))
    else:
        ap.error('give a source, --all, or --file + --prefix')
    rc = 0
    with psycopg.connect(_dsn_with_schema(a.dsn, a.schema), row_factory=dict_row) as conn:
        conn.execute(f'CREATE SCHEMA IF NOT EXISTS {a.schema}')
        conn.execute("CREATE TABLE IF NOT EXISTS mirror_runs (id BIGSERIAL PRIMARY KEY, prefix TEXT NOT NULL, source TEXT NOT NULL, at TEXT NOT NULL, tables JSONB NOT NULL, ok BOOLEAN NOT NULL, error TEXT NOT NULL DEFAULT '')")
        conn.commit()
        for source, prefix, file in jobs:
            try:
                with conn.transaction():
                    run = T.mirror_sqlite_file(conn.cursor(), prefix, file, source, now_iso())
                print(json.dumps({'source': source, 'prefix': prefix, 'ok': True, 'tables': run['tables']}))
            except Exception as e:  # noqa: BLE001
                rc = 2
                print(json.dumps({'source': source, 'prefix': prefix, 'ok': False, 'error': f'{type(e).__name__}: {e}'[:300]}))
    return rc


if __name__ == '__main__':
    sys.exit(main())
