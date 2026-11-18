#!/usr/bin/env python3
"""axf-data backups: a daily tar.gz of the store, verified, kept 14 days plus weekly copies.

Postgres engine (AXF_DATA_DSN set): `axf-data.pgdump` (pg_dump custom format, compressed) + `backup.json` (at, cursor,
counts per namespace, journal lines, rows per table, sha256 of the dump). Verify: the dump matches its hash, pg_restore
can list it and names the core tables, and its counts match the live database (later writes explained by the feed).
Restore: pg_restore --clean into the DSN (stop axf-data first).

SQLite engine (no DSN): the online SQLite backup plus the blobs it names, as before.

Runs inside the axf-data container (it reads /data or the DSN directly; no token needed) with the host's backup folder
mounted at /backups (host: /root/hub/data/axf-data/backups). deploy/axf-data-backup.cron runs it daily.

  python backup.py run      [--data /data] [--out /backups]   back up, verify, prune; writes <out>/last.json
  python backup.py verify   [FILE]                              re-check a backup (default: the newest) against the live store
  python backup.py list                                         the backups kept, newest first (JSON)
  python backup.py prune                                        apply the retention rule only
  python backup.py restore  FILE [--to /data] [--force]         put a backup back (stop the container first)

Host side (the container is named axf-data, the volume axf-data):
  docker exec axf-data python backup.py run
  docker stop axf-data && docker run --rm -v axf-data:/data -v /root/hub/data/axf-data/backups:/backups \
    axf-data:latest python backup.py restore /backups/<file> --force && docker start axf-data

Archive `axf-data-<yyyymmdd>-<hhmmss>.tar.gz`: `axf-data.sqlite` (sqlite3 online backup: a consistent copy while the
server keeps writing), `blobs/<aa>/<sha>` for every blob a key or a history row names, `backup.json` (at, cursor, counts
per namespace, journal lines, blob count, sha256 of the database copy).

Verify: the copy passes `PRAGMA integrity_check`, every named blob is in the archive with the right hash, and its counts
match the live store. Writes after the backup are allowed for: a namespace whose count differs must have a change in the
live feed after the backup's cursor, otherwise the backup is short and verify fails.

Retention: every backup from the last 14 days, plus the newest of each ISO week for 12 weeks. A failed verify is never
pruned by a newer good one's rule only (the newest good backup is always kept).
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import sqlite3
import sys
import tarfile
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

KEEP_DAYS = int(os.environ.get('AXF_DATA_BACKUP_DAYS', '14'))
KEEP_WEEKS = int(os.environ.get('AXF_DATA_BACKUP_WEEKS', '12'))
PREFIX = 'axf-data-'



def write_last(out: Path, doc: dict) -> None:
    """<out>/last.json, written atomically: the console's backup status may read it while a backup thread writes it."""
    tmp = out / f'.last.json.{os.getpid()}.tmp'
    tmp.write_text(json.dumps(doc, indent=1), 'utf-8')
    os.replace(tmp, out / 'last.json')


def _extract(tar: "tarfile.TarFile", to, members=None) -> None:
    """Extract safely on every Python: the 'data' filter where tarfile has it (3.12, 3.11.4+), otherwise the same
    rules by hand (regular files and folders only, no absolute path, nothing climbing out with ..)."""
    chosen = list(members) if members is not None else tar.getmembers()
    if hasattr(tarfile, "data_filter"):
        tar.extractall(to, members=chosen, filter="data")
        return
    for m in chosen:
        parts = m.name.replace("\\", "/").split("/")
        if m.name.startswith("/") or ".." in parts or not (m.isfile() or m.isdir()):
            raise ValueError(f"unsafe member in backup: {m.name}")
    tar.extractall(to, members=chosen)

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(d: datetime) -> str:
    return d.isoformat(timespec='seconds').replace('+00:00', 'Z')


def _sha_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def _open_ns() -> dict:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from store import NAMESPACES  # noqa: WPS433
    return NAMESPACES


def counts_of(db: sqlite3.Connection) -> dict:
    """Live keys per namespace (`plugins/<folder>` split out), journal lines per namespace, and the feed cursor."""
    ns_reg = _open_ns()
    counts: dict[str, int] = {}
    for ns, path in db.execute('SELECT ns, path FROM keys WHERE deleted=0'):
        nsid = f"{ns}/{path.split('/')[0]}" if ns_reg.get(ns, {}).get('open') else ns
        counts[nsid] = counts.get(nsid, 0) + 1
    lines = dict(db.execute('SELECT ns, COUNT(*) FROM journal GROUP BY ns').fetchall())
    cursor = db.execute('SELECT COALESCE(MAX(cursor), 0) FROM changes').fetchone()[0]
    return {'counts': dict(sorted(counts.items())), 'journalLines': dict(sorted(lines.items())), 'cursor': cursor}


def _blob_names(db: sqlite3.Connection) -> list[str]:
    rows = db.execute('SELECT blob_sha FROM keys WHERE blob_sha IS NOT NULL UNION SELECT blob_sha FROM history WHERE blob_sha IS NOT NULL')
    return sorted({r[0] for r in rows})


def run(data: Path, out: Path, now: datetime | None = None, dsn: str | None = None, schema: str = '') -> dict:
    """Back up whichever engine runs: Postgres (pg_dump) with a DSN (None = AXF_DATA_DSN), else the SQLite store ('' forces it)."""
    if dsn is None:
        dsn = os.environ.get('AXF_DATA_DSN', '')
    return run_pg(dsn, data, out, now, schema or os.environ.get('AXF_DATA_PG_SCHEMA', 'public')) if dsn else run_sqlite(data, out, now)


def run_sqlite(data: Path, out: Path, now: datetime | None = None) -> dict:
    now = now or _now()
    out.mkdir(parents=True, exist_ok=True)
    src = data / 'axf-data.sqlite'
    if not src.is_file():
        raise SystemExit(f'no store at {src}')
    name = f"{PREFIX}{now.strftime('%Y%m%d-%H%M%S')}.tar.gz"
    with tempfile.TemporaryDirectory(dir=out) as tmp:
        copy = Path(tmp) / 'axf-data.sqlite'
        live = sqlite3.connect(f'file:{src}?mode=ro', uri=True)
        dst = sqlite3.connect(copy)
        live.backup(dst)  # online backup: a consistent copy while the server writes
        live.close()
        info = counts_of(dst)
        blobs = _blob_names(dst)
        dst.close()
        meta = {'$axf': 'data-backup@1', 'at': _iso(now), 'file': name, **info, 'blobs': len(blobs), 'sqliteSha256': _sha_file(copy)}
        part = Path(tmp) / f'{name}.part'
        with tarfile.open(part, 'w:gz') as tar:
            tar.add(copy, 'axf-data.sqlite')
            for digest in blobs:
                f = data / 'blobs' / digest[:2] / digest
                if f.is_file():
                    tar.add(f, f'blobs/{digest[:2]}/{digest}')
            b = json.dumps(meta, indent=1).encode()
            ti = tarfile.TarInfo('backup.json')
            ti.size, ti.mtime = len(b), int(time.time())
            tar.addfile(ti, io.BytesIO(b))
        os.replace(part, out / name)
    result = {**meta, 'bytes': (out / name).stat().st_size}
    result['verify'] = verify(out / name, data)
    result['pruned'] = prune(out, now)
    write_last(out, {k: v for k, v in result.items() if k not in ('counts', 'journalLines')} | {'counts': result['counts']})
    return result


def verify(file: Path, data: Path, dsn: str = '') -> dict:
    """Integrity, blob hashes and counts against the live store (writes after the backup's cursor are allowed for)."""
    with tarfile.open(file, 'r:gz') as tar:
        if 'axf-data.pgdump' in tar.getnames():
            return verify_pg(file, dsn or os.environ.get('AXF_DATA_DSN', ''))
    at = _iso(_now())
    problems: list[str] = []
    with tempfile.TemporaryDirectory() as tmp, tarfile.open(file, 'r:gz') as tar:
        names = set(tar.getnames())
        meta = json.loads(tar.extractfile('backup.json').read())
        _extract(tar, tmp, [tar.getmember('axf-data.sqlite')])
        copy = Path(tmp) / 'axf-data.sqlite'
        if _sha_file(copy) != meta['sqliteSha256']:
            problems.append('the database copy does not match its recorded hash')
        db = sqlite3.connect(copy)
        ic = db.execute('PRAGMA integrity_check').fetchone()[0]
        if ic != 'ok':
            problems.append(f'integrity_check: {ic}')
        mine = counts_of(db)
        for digest in _blob_names(db):
            n = f'blobs/{digest[:2]}/{digest}'
            if n not in names:
                problems.append(f'blob {digest[:12]} missing from the archive')
                continue
            if hashlib.sha256(tar.extractfile(n).read()).hexdigest() != digest:
                problems.append(f'blob {digest[:12]} is damaged')
        db.close()
    if mine['counts'] != meta['counts']:
        problems.append('backup.json counts differ from the database copy')
    live_db = data / 'axf-data.sqlite'
    diffs = []
    live_cursor = None
    if live_db.is_file():
        live = sqlite3.connect(f'file:{live_db}?mode=ro', uri=True)
        now_counts = counts_of(live)
        live_cursor = now_counts['cursor']
        touched = set()
        for ns, path in live.execute('SELECT ns, path FROM changes WHERE cursor > ?', (mine['cursor'],)):
            touched.add(f"{ns}/{path.split('/')[0]}" if _open_ns().get(ns, {}).get('open') else ns)
        live.close()
        for nsid in sorted(set(mine['counts']) | set(now_counts['counts'])):
            a, b = mine['counts'].get(nsid, 0), now_counts['counts'].get(nsid, 0)
            if a != b:
                explained = nsid in touched
                diffs.append({'ns': nsid, 'backup': a, 'live': b, 'explained': explained})
                if not explained:
                    problems.append(f'{nsid}: backup has {a} keys, live has {b} and nothing changed there since the backup')
    else:
        problems.append(f'no live store at {live_db} to compare with')
    return {'ok': not problems, 'at': at, 'problems': problems, 'diffs': diffs, 'backupCursor': mine['cursor'], 'liveCursor': live_cursor}


def backups(out: Path) -> list[Path]:
    return sorted(out.glob(f'{PREFIX}*.tar.gz'), reverse=True)


def _when(p: Path) -> datetime:
    return datetime.strptime(p.name[len(PREFIX):len(PREFIX) + 15], '%Y%m%d-%H%M%S').replace(tzinfo=timezone.utc)


def prune(out: Path, now: datetime | None = None) -> list[str]:
    now = now or _now()
    all_ = backups(out)
    keep: set[Path] = set(all_[:1])
    weeks: dict[tuple[int, int], Path] = {}
    for p in all_:
        w = _when(p)
        if now - w <= timedelta(days=KEEP_DAYS):
            keep.add(p)
        wk = w.isocalendar()[:2]
        if now - w <= timedelta(weeks=KEEP_WEEKS) and wk not in weeks:
            weeks[wk] = p  # newest first, so the first seen is the week's newest
    keep |= set(weeks.values())
    gone = []
    for p in all_:
        if p not in keep:
            p.unlink()
            gone.append(p.name)
    return gone


# ── Postgres (AXF_DATA_DSN): pg_dump custom archive in the same tar.gz shape, verified with pg_restore --list + counts ──

def _pg_cmd(tool: str, *args: str) -> list[str]:
    """pg_dump / pg_restore argv. AXF_DATA_PG_TOOLS (e.g. `docker exec -i axf-data-db`) runs them elsewhere; the archive then
    travels over stdin / stdout, and AXF_DATA_PG_TOOLS_DSN is the DSN as seen from there."""
    import shlex
    prefix = shlex.split(os.environ.get('AXF_DATA_PG_TOOLS', ''))
    if not prefix and not shutil.which(tool):
        raise SystemExit(f'{tool} is not installed here (postgresql-client-16: the Dockerfile installs it) and AXF_DATA_PG_TOOLS is unset')
    return [*prefix, tool, *args]


def _tools_dsn(dsn: str) -> str:
    return os.environ.get('AXF_DATA_PG_TOOLS_DSN') or dsn


def _pg_connect(dsn: str):
    import psycopg
    from psycopg.rows import dict_row
    return psycopg.connect(dsn, row_factory=dict_row)


def counts_of_pg(conn) -> dict:
    ns_reg = _open_ns()
    counts: dict[str, int] = {}
    for r in conn.execute('SELECT ns, path FROM keys WHERE NOT deleted'):
        nsid = f"{r['ns']}/{r['path'].split('/')[0]}" if ns_reg.get(r['ns'], {}).get('open') else r['ns']
        counts[nsid] = counts.get(nsid, 0) + 1
    lines = {r['ns']: r['n'] for r in conn.execute('SELECT ns, COUNT(*) AS n FROM journal GROUP BY ns')}
    cursor = conn.execute('SELECT COALESCE(MAX(cursor), 0) AS c FROM changes').fetchone()['c']
    names = [r['t'] for r in conn.execute("SELECT tablename AS t FROM pg_tables WHERE schemaname = current_schema() ORDER BY 1")]
    tables = {t: conn.execute(f'SELECT COUNT(*) AS n FROM "{t}"').fetchone()['n'] for t in names}
    return {'counts': dict(sorted(counts.items())), 'journalLines': dict(sorted(lines.items())), 'cursor': cursor, 'tables': tables}


def run_pg(dsn: str, data: Path, out: Path, now: datetime | None = None, schema: str = 'public') -> dict:
    import subprocess
    now = now or _now()
    out.mkdir(parents=True, exist_ok=True)
    name = f"{PREFIX}{now.strftime('%Y%m%d-%H%M%S')}.tar.gz"
    with tempfile.TemporaryDirectory(dir=out) as tmp:
        dump = Path(tmp) / 'axf-data.pgdump'
        with _pg_connect(dsn) as conn:
            info = counts_of_pg(conn)
        with open(dump, 'wb') as fh:
            r = subprocess.run(_pg_cmd('pg_dump', '--format=custom', '--no-owner', '--no-acl', '--compress=6', f'--schema={schema}', '--dbname', _tools_dsn(dsn)), stdout=fh, stderr=subprocess.PIPE, text=False)
        if r.returncode:
            raise SystemExit(f'pg_dump failed: {r.stderr.decode(errors="replace").strip()[-400:]}')
        meta = {'$axf': 'data-backup@1', 'engine': 'postgres', 'at': _iso(now), 'file': name, **{k: v for k, v in info.items() if k != 'tables'}, 'tables': info['tables'], 'pgdumpSha256': _sha_file(dump)}
        part = Path(tmp) / f'{name}.part'
        with tarfile.open(part, 'w:gz') as tar:
            tar.add(dump, 'axf-data.pgdump')
            b = json.dumps(meta, indent=1).encode()
            ti = tarfile.TarInfo('backup.json')
            ti.size, ti.mtime = len(b), int(time.time())
            tar.addfile(ti, io.BytesIO(b))
        os.replace(part, out / name)
    result = {**meta, 'bytes': (out / name).stat().st_size}
    result['verify'] = verify_pg(out / name, dsn)
    result['pruned'] = prune(out, now)
    write_last(out, {k: v for k, v in result.items() if k not in ('counts', 'journalLines', 'tables')} | {'counts': result['counts']})
    return result


def verify_pg(file: Path, dsn: str) -> dict:
    """The archive is readable by pg_restore and matches its hash; its counts match the live database (later writes explained by the feed)."""
    import subprocess
    at = _iso(_now())
    problems: list[str] = []
    with tempfile.TemporaryDirectory() as tmp, tarfile.open(file, 'r:gz') as tar:
        meta = json.loads(tar.extractfile('backup.json').read())
        _extract(tar, tmp, [tar.getmember('axf-data.pgdump')])
        dump = Path(tmp) / 'axf-data.pgdump'
        if _sha_file(dump) != meta.get('pgdumpSha256'):
            problems.append('the dump does not match its recorded hash')
        with open(dump, 'rb') as fh:
            r = subprocess.run(_pg_cmd('pg_restore', '--list'), stdin=fh, capture_output=True, text=True)
        if r.returncode:
            problems.append(f'pg_restore --list: {r.stderr.strip()[-200:]}')
        else:
            listed = {ln.split('TABLE DATA ')[1].split(' ')[1] for ln in r.stdout.splitlines() if 'TABLE DATA ' in ln}
            for t in ('keys', 'journal', 'changes', 'history'):
                if t not in listed:
                    problems.append(f'table {t} is not in the dump')
    diffs: list[dict] = []
    live_cursor = None
    if not dsn:
        problems.append('AXF_DATA_DSN unset: no live database to compare with')
    else:
        try:
            with _pg_connect(dsn) as conn:
                now_counts = counts_of_pg(conn)
                live_cursor = now_counts['cursor']
                touched = set()
                for r in conn.execute('SELECT ns, path FROM changes WHERE cursor > %s', (meta['cursor'],)):
                    touched.add(f"{r['ns']}/{r['path'].split('/')[0]}" if _open_ns().get(r['ns'], {}).get('open') else r['ns'])
            for nsid in sorted(set(meta['counts']) | set(now_counts['counts'])):
                a, b = meta['counts'].get(nsid, 0), now_counts['counts'].get(nsid, 0)
                if a != b:
                    explained = nsid in touched
                    diffs.append({'ns': nsid, 'backup': a, 'live': b, 'explained': explained})
                    if not explained:
                        problems.append(f'{nsid}: backup has {a} keys, live has {b} and nothing changed there since the backup')
        except Exception as e:  # noqa: BLE001
            problems.append(f'live database: {type(e).__name__}: {e}'[:200])
    return {'ok': not problems, 'at': at, 'engine': 'postgres', 'problems': problems, 'diffs': diffs, 'backupCursor': meta.get('cursor'), 'liveCursor': live_cursor}


def restore_pg(file: Path, dsn: str, force: bool = False) -> dict:
    import subprocess
    with _pg_connect(dsn) as conn:
        have = conn.execute("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'keys'").fetchone()['n']
        if have and not force:
            raise SystemExit('the database already holds a store: stop axf-data and pass --force (pg_restore --clean replaces every table)')
    with tempfile.TemporaryDirectory() as tmp, tarfile.open(file, 'r:gz') as tar:
        meta = json.loads(tar.extractfile('backup.json').read())
        _extract(tar, tmp, [tar.getmember('axf-data.pgdump')])
        with open(Path(tmp) / 'axf-data.pgdump', 'rb') as fh:
            r = subprocess.run(_pg_cmd('pg_restore', '--clean', '--if-exists', '--no-owner', '--no-acl', '--exit-on-error', '--dbname', _tools_dsn(dsn)), stdin=fh, capture_output=True, text=True)
        if r.returncode:
            raise SystemExit(f'pg_restore failed: {r.stderr.strip()[-400:]}')
    with _pg_connect(dsn) as conn:
        got = counts_of_pg(conn)
    return {'$axf': 'data-restore@1', 'engine': 'postgres', 'file': file.name, 'at': meta['at'], 'counts': got['counts'], 'ok': got['counts'] == meta['counts'], 'movedAside': ''}


def restore(file: Path, to: Path, force: bool = False, dsn: str = '') -> dict:
    with tarfile.open(file, 'r:gz') as tar:
        if 'axf-data.pgdump' in tar.getnames():
            return restore_pg(file, dsn or os.environ.get('AXF_DATA_DSN', ''), force)
    return restore_sqlite(file, to, force)


def restore_sqlite(file: Path, to: Path, force: bool = False) -> dict:
    db = to / 'axf-data.sqlite'
    if db.exists() and not force:
        raise SystemExit(f'{db} exists: stop the container and pass --force (the current files move to pre-restore-<time>/)')
    moved = ''
    if db.exists():
        keep = to / f"pre-restore-{_now().strftime('%Y%m%d-%H%M%S')}"
        keep.mkdir()
        for n in ('axf-data.sqlite', 'axf-data.sqlite-wal', 'axf-data.sqlite-shm', 'blobs'):
            if (to / n).exists():
                shutil.move(str(to / n), str(keep / n))
        moved = keep.name
    with tarfile.open(file, 'r:gz') as tar:
        meta = json.loads(tar.extractfile('backup.json').read())
        members = [m for m in tar.getmembers() if m.name == 'axf-data.sqlite' or m.name.startswith('blobs/')]
        _extract(tar, to, members)
    got = counts_of(sqlite3.connect(db))
    ok = got['counts'] == meta['counts']
    return {'$axf': 'data-restore@1', 'file': file.name, 'at': meta['at'], 'counts': got['counts'], 'ok': ok, 'movedAside': moved}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog='backup.py', description='axf-data backups')
    ap.add_argument('cmd', choices=['run', 'verify', 'list', 'prune', 'restore'])
    ap.add_argument('file', nargs='?')
    ap.add_argument('--data', default=os.environ.get('AXF_DATA_DIR', '/data'))
    ap.add_argument('--out', default=os.environ.get('AXF_DATA_BACKUPS', '/backups'))
    ap.add_argument('--to', default='')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--dsn', default=os.environ.get('AXF_DATA_DSN', ''), help='Postgres DSN (default AXF_DATA_DSN); unset = the SQLite store')
    ap.add_argument('--schema', default=os.environ.get('AXF_DATA_PG_SCHEMA', 'public'))
    a = ap.parse_args(argv)
    data, out = Path(a.data), Path(a.out)
    if a.dsn:
        os.environ['AXF_DATA_DSN'] = a.dsn
    if a.cmd == 'run':
        r = run(data, out, dsn=a.dsn, schema=a.schema)
        print(json.dumps({k: v for k, v in r.items() if k != 'journalLines'}, indent=1))
        return 0 if r['verify']['ok'] else 2
    if a.cmd == 'verify':
        f = Path(a.file) if a.file else (backups(out) or [None])[0]
        if not f:
            print('no backups yet', file=sys.stderr)
            return 1
        r = verify(f, data)
        last = out / 'last.json'
        if last.is_file():
            doc = json.loads(last.read_text())
            if doc.get('file') == f.name:
                doc['verify'] = r
                write_last(out, doc)
        print(json.dumps(r, indent=1))
        return 0 if r['ok'] else 2
    if a.cmd == 'list':
        print(json.dumps([{'file': p.name, 'at': _iso(_when(p)), 'bytes': p.stat().st_size} for p in backups(out)], indent=1))
        return 0
    if a.cmd == 'prune':
        print(json.dumps(prune(out)))
        return 0
    if not a.file:
        ap.error('restore needs FILE')
    r = restore(Path(a.file), Path(a.to or a.data), a.force)
    print(json.dumps(r, indent=1))
    return 0 if r['ok'] else 2


if __name__ == '__main__':
    sys.exit(main())
