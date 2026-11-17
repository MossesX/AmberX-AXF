#!/usr/bin/env python3
"""Move a SQLite axf-data onto Postgres: backup first, copy key for key, count and manifest checks, never lose data.

  python migrate_pg.py            [--data /data] [--dsn $AXF_DATA_DSN] [--schema public]
  python migrate_pg.py --verify   only compare the two stores (counts, journal lines, manifests)
  python migrate_pg.py --dry-run  what would move (keys, journal lines, history rows, blobs) and whether Postgres is empty

Order: 1. a SQLite backup (backup.py run: the tar with the online copy + blobs, verified) unless --no-backup;
2. Postgres must be empty (or --replace: its schema is dropped and recreated) so counts can only come from this copy;
3. every live key and tombstone with its rev / etag / at / by as it is, bodies to their tables (pg.py, tables.py),
journal lines verbatim, history rows, the change feed with its cursors, idempotency keys, meta;
4. checks: keys per namespace, journal lines per namespace, and the data-store@1 manifest of every namespace must be
equal on both sides (count, bytes, hash, journal entries), else exit 2 with the differences and Postgres is left as it is
for inspection (nothing on the SQLite side is touched, ever).

After a clean copy the service is started in `shadow` (engine.py); `POST /v1/_meta/engine { mode: "postgres" }` cuts over.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from store import NAMESPACES, Store  # noqa: E402


def _nsid(ns: str, path: str) -> str:
    return f"{ns}/{path.split('/')[0]}" if NAMESPACES.get(ns, {}).get('open') else ns


def plan(data: Path) -> dict:
    db = sqlite3.connect(f'file:{data / "axf-data.sqlite"}?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    out = {'keys': db.execute('SELECT COUNT(*) FROM keys').fetchone()[0],
           'live': db.execute('SELECT COUNT(*) FROM keys WHERE deleted=0').fetchone()[0],
           'journalLines': db.execute('SELECT COUNT(*) FROM journal').fetchone()[0],
           'history': db.execute('SELECT COUNT(*) FROM history').fetchone()[0],
           'changes': db.execute('SELECT COUNT(*) FROM changes').fetchone()[0],
           'blobs': db.execute('SELECT COUNT(DISTINCT blob_sha) FROM keys WHERE blob_sha IS NOT NULL').fetchone()[0],
           'bytes': db.execute('SELECT COALESCE(SUM(size), 0) FROM keys WHERE deleted=0').fetchone()[0]}
    counts: dict[str, int] = {}
    for r in db.execute('SELECT ns, path FROM keys WHERE deleted=0'):
        counts[_nsid(r['ns'], r['path'])] = counts.get(_nsid(r['ns'], r['path']), 0) + 1
    out['counts'] = dict(sorted(counts.items()))
    db.close()
    return out


def copy(src: Store, pg, log=print) -> dict:
    t0 = time.time()
    n = {'keys': 0, 'journalLines': 0, 'history': 0, 'changes': 0, 'idem': 0}
    rows = [dict(r) for r in src.db.execute('SELECT * FROM keys ORDER BY ns, path')]
    for r in rows:
        lines = None
        body = None
        if r['kind'] == 'journal':
            lines = [ln for (ln,) in src.db.execute('SELECT line FROM journal WHERE ns=? AND path=? ORDER BY seq', (r['ns'], r['path']))]
            n['journalLines'] += len(lines)
        elif not r['deleted']:
            body = src.body_of(r)
        pg.import_key({k: r[k] for k in ('ns', 'path', 'kind', 'rev', 'etag', 'at', 'by', 'size', 'content_type', 'deleted', 'entries')}, body, lines)
        n['keys'] += 1
        if n['keys'] % 500 == 0:
            log(f"  {n['keys']}/{len(rows)} keys")
    hist = []
    for h in src.db.execute('SELECT * FROM history ORDER BY ns, path, rev'):
        h = dict(h)
        if h['blob_sha']:
            p = src.blob_path(h['blob_sha'])
            h['blob_bytes'] = p.read_bytes() if p.is_file() else None
        if h['body'] is not None:
            h['body'] = bytes(h['body'])
        hist.append(h)
        if len(hist) >= 200:
            pg.import_history(hist)
            n['history'] += len(hist)
            hist = []
    if hist:
        pg.import_history(hist)
        n['history'] += len(hist)
    ch = [dict(c) for c in src.db.execute('SELECT * FROM changes ORDER BY cursor')]
    for i in range(0, len(ch), 1000):
        pg.import_changes(ch[i:i + 1000])
    n['changes'] = len(ch)
    idem = [dict(i) for i in src.db.execute('SELECT k, value, at FROM idem')]
    if idem:
        pg.import_idem(idem)
    n['idem'] = len(idem)
    for k, v in src.db.execute('SELECT k, v FROM meta'):
        pg.meta_set(k, v)
    n['seconds'] = round(time.time() - t0, 1)
    return n


def verify(src: Store, pg) -> dict:
    problems: list[str] = []
    a, b = src.counts(), pg.counts()
    if a != b:
        for k in sorted(set(a) | set(b)):
            if a.get(k, 0) != b.get(k, 0):
                problems.append(f'{k}: {a.get(k, 0)} keys in SQLite, {b.get(k, 0)} in Postgres')
    ja = dict(src.db.execute('SELECT ns, COUNT(*) FROM journal GROUP BY ns').fetchall())
    jb = pg.journal_line_count()
    for k in sorted(set(ja) | set(jb)):
        if ja.get(k, 0) != jb.get(k, 0):
            problems.append(f'{k}: {ja.get(k, 0)} journal lines in SQLite, {jb.get(k, 0)} in Postgres')
    manifests = {}
    for ns in [n for n in NAMESPACES if not NAMESPACES[n].get('open')] + sorted({_nsid(k, '') for k in a if '/' in k}):
        try:
            ma, mb = src.manifest(ns), pg.manifest(ns)
        except Exception as e:  # noqa: BLE001
            problems.append(f'{ns}: manifest failed ({e})')
            continue
        manifests[ns] = {'equal': ma == mb, 'count': ma['count'], 'bytes': ma['bytes']}
        if ma != mb:
            problems.append(f"{ns}: manifests differ (SQLite {ma['count']} keys / {ma['hash'][:12]}, Postgres {mb['count']} / {mb['hash'][:12]})")
    ha = src.db.execute('SELECT COUNT(*) FROM history').fetchone()[0]
    hb = pg.fetchone('SELECT COUNT(*) AS n FROM history')['n']
    return {'$axf': 'data-migration-check@1', 'ok': not problems, 'problems': problems, 'counts': {'sqlite': a, 'postgres': b},
            'journalLines': {'sqlite': ja, 'postgres': jb}, 'history': {'sqlite': ha, 'postgres': hb}, 'manifests': manifests}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog='migrate_pg.py', description='SQLite axf-data → Postgres')
    ap.add_argument('--data', default=os.environ.get('AXF_DATA_DIR', '/data'))
    ap.add_argument('--dsn', default=os.environ.get('AXF_DATA_DSN', ''))
    ap.add_argument('--schema', default=os.environ.get('AXF_DATA_PG_SCHEMA', 'public'))
    ap.add_argument('--out', default=os.environ.get('AXF_DATA_BACKUPS', '/backups'), help='backup folder (backup.py)')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--verify', action='store_true')
    ap.add_argument('--no-backup', action='store_true')
    ap.add_argument('--replace', action='store_true', help='drop what Postgres holds first')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args(argv)
    data = Path(a.data)
    if not (data / 'axf-data.sqlite').is_file():
        print(f'no SQLite store at {data}: nothing to migrate (a fresh install runs on Postgres directly)', file=sys.stderr)
        return 1
    if not a.dsn:
        print('AXF_DATA_DSN (or --dsn) is required', file=sys.stderr)
        return 1
    say = (lambda *x: None) if a.json else print
    if a.dry_run:
        p = plan(data)
        from pg import PgStore
        pg = PgStore(a.dsn, data, schema=a.schema)
        p['postgresKeys'] = pg.fetchone('SELECT COUNT(*) AS n FROM keys')['n']
        print(json.dumps(p, indent=1))
        return 0
    os.environ['AXF_DATA_ENGINE'] = 'sqlite'
    src = Store(data)
    from pg import PgStore
    pg = PgStore(a.dsn, data, schema=a.schema)
    if a.verify:
        r = verify(src, pg)
        print(json.dumps(r, indent=1) if a.json else '\n'.join(['ok' if r['ok'] else 'MISMATCH', *r['problems']]))
        return 0 if r['ok'] else 2
    have = pg.fetchone('SELECT COUNT(*) AS n FROM keys')['n']
    if have and not a.replace:
        print(f'Postgres already holds {have} keys: pass --replace to drop them and copy again, or --verify to compare', file=sys.stderr)
        return 2
    if have:
        say(f'dropping schema {a.schema} ({have} keys) and starting clean')
        pg.drop_everything()
        pg = PgStore(a.dsn, data, schema=a.schema)
    if not a.no_backup:
        import backup
        say('1. SQLite backup first')
        b = backup.run_sqlite(data, Path(a.out))
        if not b['verify']['ok']:
            print(f"backup did not verify: {b['verify']['problems']}", file=sys.stderr)
            return 2
        say(f"   {b['file']} ({b['bytes']} bytes), verified")
    say('2. copying')
    n = copy(src, pg, say)
    say(f"   {n['keys']} keys, {n['journalLines']} journal lines, {n['history']} history rows, {n['changes']} changes in {n['seconds']} s")
    say('3. checking counts and manifests')
    r = verify(src, pg)
    r['copied'] = n
    if a.json:
        print(json.dumps(r, indent=1))
    else:
        print('\n'.join(['   equal: every namespace' if r['ok'] else '   MISMATCH:', *('   ' + p for p in r['problems'])]))
        if r['ok']:
            print('done: start axf-data with AXF_DATA_DSN set (engine mode shadow), then POST /v1/_meta/engine { "mode": "postgres" } to cut over')
    return 0 if r['ok'] else 2


if __name__ == '__main__':
    sys.exit(main())
