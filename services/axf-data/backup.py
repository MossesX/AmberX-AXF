#!/usr/bin/env python3
"""axf-data backups: a daily tar of the SQLite online backup plus the blobs it names, kept 14 days plus weekly copies.

Runs inside the axf-data container (it reads /data directly; no token needed) with the host's backup folder mounted at
/backups (host: /root/hub/data/axf-data/backups). deploy/axf-data-backup.cron runs it daily.

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


def run(data: Path, out: Path, now: datetime | None = None) -> dict:
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
    (out / 'last.json').write_text(json.dumps({k: v for k, v in result.items() if k not in ('counts', 'journalLines')} | {'counts': result['counts']}, indent=1))
    return result


def verify(file: Path, data: Path) -> dict:
    """Integrity, blob hashes and counts against the live store (writes after the backup's cursor are allowed for)."""
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


def restore(file: Path, to: Path, force: bool = False) -> dict:
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
    a = ap.parse_args(argv)
    data, out = Path(a.data), Path(a.out)
    if a.cmd == 'run':
        r = run(data, out)
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
                last.write_text(json.dumps(doc, indent=1))
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
