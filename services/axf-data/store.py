"""axf-data store engine: data-store@1 on SQLite plus a content-addressed blob folder.

Brett, Nov 15 2026: "the console goes down, all the data is still available, all the notes are available, and the
builds keep running. That's what I need."

The contract is framework/spec/DATA-STORE.md; the reference client framework/core/data-store.mjs answers the same way
(its memory/file engine is the model this file follows line for line: etags, frames, errors, journal lines).

Layout on the volume (AXF_DATA_DIR, default /data):
  axf-data.sqlite          keys, journal lines, change feed, idempotent appends, history (journal.py)
  blobs/<aa>/<sha256>      blob bodies, content-addressed (a history row points at the same file)
  snapshots/<id>.tar       POST /v1/snapshot archives

Every write runs under one process-wide lock and one SQLite transaction: the key row, the body and the change feed line
move together. Blob bodies are written (temp file, fsync, rename) before the row that names them.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import tarfile
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

SCHEMA_CANDIDATES = [
    os.environ.get('AXF_DATA_SCHEMA', ''),
    str(Path(__file__).with_name('data-store.json')),
    *([str(Path(__file__).resolve().parents[2] / 'framework/schemas/data-store.json')] if len(Path(__file__).resolve().parents) > 2 else []),
]


def load_registry() -> dict:
    for p in SCHEMA_CANDIDATES:
        if p and Path(p).is_file():
            return json.loads(Path(p).read_text('utf-8'))
    raise RuntimeError('data-store.json registry not found (set AXF_DATA_SCHEMA)')


REG = load_registry()
NAMESPACES: dict = REG['namespaces']
LIMITS: dict = REG['limits']
ERRORS: dict = REG['errors']
SEGMENT = re.compile(REG['patterns']['segment'])
FOLDER = re.compile(REG['patterns']['pluginFolder'])
ETAG = re.compile(REG['patterns']['etag'])
ZERO16 = '0' * 16


class DataError(Exception):
    """A data-error@1: `code` is one of the registry's error codes."""

    def __init__(self, code: str, message: str = '', **extra: Any):
        super().__init__(message or code)
        self.code = code if code in ERRORS else 'internal'
        self.status = ERRORS[self.code]['status']
        self.message = message or code
        self.extra = {k: v for k, v in extra.items() if v is not None}

    def frame(self) -> dict:
        f = {'$axf': 'data-error@1', 'code': self.code, 'message': self.message}
        for k in ('ns', 'path', 'rev', 'etag', 'retryAfterMs'):
            if k in self.extra:
                f[k] = self.extra[k]
        return f


# ── pure helpers (mirror framework/core/data-store.mjs) ───────────────────────────────────────────────────────────────

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def _norm(v: Any) -> Any:
    if isinstance(v, float) and v.is_integer() and abs(v) < 2 ** 53:
        return int(v)
    if isinstance(v, list):
        return [_norm(x) for x in v]
    if isinstance(v, dict):
        return {k: _norm(x) for k, x in v.items()}
    return v


def canonical(v: Any) -> str:
    """Stable JSON: sorted keys, no spaces, UTF-8 kept; integral floats print as JS prints them."""
    return json.dumps(_norm(v), sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def etag_of(rev: int, body: bytes) -> str:
    return f'{rev}-{sha(body)[:16]}'


def journal_line(seq: int, at: str, by: str, entry_canonical: str) -> str:
    """The stored line, byte-equal to the reference engine's JSON.stringify({ seq, at, by, entry })."""
    return '{"seq":%d,"at":%s,"by":%s,"entry":%s}' % (seq, json.dumps(at, ensure_ascii=False), json.dumps(by, ensure_ascii=False), entry_canonical)


def manifest_of(items: Iterable[dict]) -> dict:
    live = sorted((i for i in items if not i.get('deleted')), key=lambda i: i['path'].encode('utf-8'))
    text = ''.join(f"{i['path']}\t{i['etag']}\n" for i in live)
    out: dict = {'count': len(live), 'bytes': sum(int(i.get('size') or 0) for i in live), 'hash': sha(text.encode('utf-8'))}
    journals = [i for i in live if i.get('kind') == 'journal']
    if journals:
        out['journals'] = {j['path']: {'entries': int(j.get('entries') or 0), 'hash': str(j['etag']).split('-')[1] if '-' in str(j['etag']) else ''} for j in journals}
    return out


def parse_key(key: str) -> tuple[str, str]:
    s = key if isinstance(key, str) else ''
    if not s or len(s) > LIMITS['keyChars']:
        raise DataError('invalid_key', f"key must be <namespace>/<path>, ≤ {LIMITS['keyChars']} chars")
    ns, _, path = s.partition('/')
    if ns not in NAMESPACES:
        raise DataError('invalid_key', f'unknown namespace "{ns}"', ns=ns)
    if not path:
        raise DataError('invalid_key', 'a key needs a path after the namespace', ns=ns)
    segs = path.split('/')
    for seg in segs:
        if not SEGMENT.match(seg) or seg in ('.', '..'):
            raise DataError('invalid_key', f'bad path segment "{seg}"', ns=ns, path=path)
    if NAMESPACES[ns].get('open') and (not FOLDER.match(segs[0]) or len(segs) < 2):
        raise DataError('invalid_key', f'{ns} keys are {ns}/<folder>/<path>', ns=ns, path=path)
    return ns, path


def parse_namespace(ns: str) -> tuple[str, str]:
    """`builds` → ('builds', ''); `plugins/ui-review` → ('plugins', 'ui-review/')."""
    parts = (ns or '').split('/')
    head = parts[0]
    if head not in NAMESPACES:
        raise DataError('invalid_key', f'unknown namespace "{ns}"', ns=ns)
    if len(parts) == 1:
        return head, ''
    if len(parts) > 2 or not NAMESPACES[head].get('open') or not FOLDER.match(parts[1]):
        raise DataError('invalid_key', f'"{ns}" is not a namespace', ns=ns)
    return head, parts[1] + '/'


def norm_if_match(v: str | None) -> str:
    s = (v or '').strip()
    if s.startswith('W/'):
        s = s[2:]
    s = s.strip('"')
    return s if (ETAG.match(s) or s.isdigit()) and s not in ('0',) else ''


def _matches(if_match: str, row: dict) -> bool:
    return if_match == row['etag'] or if_match == str(row['rev'])


# ── the store ─────────────────────────────────────────────────────────────────────────────────────────────────────────

SCHEMA_SQL = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS keys (
  ns TEXT NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL, rev INTEGER NOT NULL, etag TEXT NOT NULL,
  at TEXT NOT NULL, by TEXT NOT NULL, size INTEGER NOT NULL, content_type TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
  entries INTEGER NOT NULL DEFAULT 0, body BLOB, blob_sha TEXT, PRIMARY KEY (ns, path)
);
CREATE TABLE IF NOT EXISTS changes (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT, ns TEXT NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL, op TEXT NOT NULL,
  rev INTEGER NOT NULL, etag TEXT NOT NULL, seq INTEGER, at TEXT NOT NULL, by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idem (k TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
"""


@dataclass
class Caller:
    by: str = 'svc:cli'


def _frame(r: dict) -> dict:
    return {'$axf': 'data-record@1', 'ns': r['ns'], 'path': r['path'], 'kind': r['kind'], 'rev': r['rev'], 'etag': r['etag'],
            'at': r['at'], 'by': r['by'], 'size': r['size'], 'contentType': r['content_type'], 'deleted': bool(r['deleted'])}


class Store:
    def __init__(self, data_dir: str | os.PathLike, now=now_iso):
        self.dir = Path(data_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / 'blobs').mkdir(exist_ok=True)
        (self.dir / 'snapshots').mkdir(exist_ok=True)
        self.db_path = self.dir / 'axf-data.sqlite'
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.db_path, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA_SQL)
        self.now = now
        self.started = time.time()
        self._jhash: dict[tuple[str, str], tuple[int, Any]] = {}
        self.hooks: list = []  # journal.py: history rows and change-feed listeners
        from journal import install  # noqa: WPS433 (the history / journal tables live next door)
        install(self)

    # ── low level ──
    def _row(self, ns: str, path: str) -> dict | None:
        r = self.db.execute('SELECT * FROM keys WHERE ns=? AND path=?', (ns, path)).fetchone()
        return dict(r) if r else None

    def blob_path(self, digest: str) -> Path:
        return self.dir / 'blobs' / digest[:2] / digest

    def _write_blob(self, data: bytes) -> str:
        digest = sha(data)
        f = self.blob_path(digest)
        if not f.exists():
            f.parent.mkdir(parents=True, exist_ok=True)
            tmp = f.with_name(f'{digest}.{os.getpid()}.{threading.get_ident()}.tmp')
            with open(tmp, 'wb') as fh:
                fh.write(data)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, f)
        return digest

    def body_of(self, r: dict) -> bytes | None:
        if r['deleted']:
            return None
        if r['kind'] == 'blob':
            return self.blob_path(r['blob_sha']).read_bytes()
        return bytes(r['body']) if r['body'] is not None else None

    def _change(self, r: dict, op: str, seq: int | None = None) -> dict:
        cur = self.db.execute('INSERT INTO changes (ns, path, kind, op, rev, etag, seq, at, by) VALUES (?,?,?,?,?,?,?,?,?)',
                              (r['ns'], r['path'], r['kind'], op, r['rev'], r['etag'], seq, r['at'], r['by']))
        c = {'$axf': 'data-change@1', 'cursor': cur.lastrowid, 'ns': r['ns'], 'path': r['path'], 'kind': r['kind'], 'op': op,
             'rev': r['rev'], 'etag': r['etag'], 'at': r['at'], 'by': r['by']}
        if seq:
            c['seq'] = seq
        return c

    def _commit_row(self, r: dict, op: str, seq: int | None = None, prev: dict | None = None) -> dict:
        self.db.execute('BEGIN IMMEDIATE')
        try:
            self.db.execute('INSERT OR REPLACE INTO keys (ns, path, kind, rev, etag, at, by, size, content_type, deleted, entries, body, blob_sha) '
                            'VALUES (:ns,:path,:kind,:rev,:etag,:at,:by,:size,:content_type,:deleted,:entries,:body,:blob_sha)', r)
            for h in self.hooks:
                h.on_row(r, op, prev)
            c = self._change(r, op, seq)
            self.db.execute('COMMIT')
        except BaseException:
            self.db.execute('ROLLBACK')
            raise
        for h in self.hooks:
            h.on_change(c)
        return c

    def read_only_check(self, ns: str, path: str) -> None:
        """A namespace in `rollback` (or marked frozen) refuses writes; `_meta` never does."""
        if ns == '_meta':
            return
        r = self._row('_meta', 'mode')
        if not r or r['deleted'] or r['body'] is None:
            return
        try:
            doc = json.loads(bytes(r['body']))
        except ValueError:
            return
        nsid = ns
        if NAMESPACES[ns].get('open'):
            nsid = f"{ns}/{path.split('/')[0]}"
        entry = (doc.get('namespaces') or {}).get(nsid) or (doc.get('namespaces') or {}).get(ns) or {}
        mode = entry.get('mode') or doc.get('mode') or 'local'
        if mode == 'rollback' or entry.get('frozen'):
            raise DataError('read_only', f'{nsid} is {"frozen" if entry.get("frozen") else "rolling back"}: writes wait for the mode change', ns=ns, path=path)

    def _kind_ok(self, ns: str, kind: str, path: str) -> None:
        if kind not in NAMESPACES[ns]['kinds']:
            raise DataError('invalid_key', f'{ns} does not hold {kind}s', ns=ns, path=path)

    # ── operations ──
    def get(self, ns: str, path: str, deleted: bool = False) -> tuple[dict, bytes | None]:
        r = self._row(ns, path)
        if not r or (r['deleted'] and not deleted):
            raise DataError('not_found', f'{ns}/{path} not found', ns=ns, path=path)
        if r['kind'] == 'journal':
            raise DataError('invalid_key', f'{ns}/{path} is a journal: read it', ns=ns, path=path)
        return r, self.body_of(r)

    def put(self, ns: str, path: str, body: bytes, content_type: str, caller: Caller, if_match: str = '', create: bool = False, force: bool = False) -> dict:
        ct = (content_type or 'application/octet-stream').split(';')[0].strip().lower()
        if ct == 'application/json':
            kind = 'record'
            try:
                body = canonical(json.loads(body.decode('utf-8'))).encode('utf-8')
            except (ValueError, UnicodeDecodeError) as e:
                raise DataError('invalid_body', f'a record is a JSON document ({e})', ns=ns, path=path) from e
        else:
            kind = 'blob'
        self._kind_ok(ns, kind, path)
        limit = LIMITS['blobBytes'] if kind == 'blob' else LIMITS['recordBytes']
        if len(body) > limit:
            raise DataError('too_large', f'{ns}/{path}: {len(body)} bytes, the {kind} limit is {limit}', ns=ns, path=path)
        if_match = norm_if_match(if_match)
        if not if_match and not create and not (kind == 'blob' and force):
            raise DataError('precondition_required', f'{ns}/{path}: pass ifMatch (the etag read) or create: true', ns=ns, path=path)
        with self.lock:
            self.read_only_check(ns, path)
            cur = self._row(ns, path)
            if cur and cur['kind'] == 'journal':
                raise DataError('invalid_key', f'{ns}/{path} is a journal', ns=ns, path=path)
            live = bool(cur and not cur['deleted'])
            if create and live:
                raise DataError('exists', f'{ns}/{path} exists', ns=ns, path=path, rev=cur['rev'], etag=cur['etag'])
            if if_match and not live:
                raise DataError('conflict', f"{ns}/{path} {'was deleted' if cur else 'does not exist'}", ns=ns, path=path, rev=cur['rev'] if cur else 0, etag=cur['etag'] if cur else '')
            if if_match and not _matches(if_match, cur):
                raise DataError('conflict', f"{ns}/{path} is at rev {cur['rev']}", ns=ns, path=path, rev=cur['rev'], etag=cur['etag'])
            if live and cur['kind'] != kind:
                raise DataError('invalid_key', f"{ns}/{path} is a {cur['kind']}", ns=ns, path=path)
            rev = (cur['rev'] if cur else 0) + 1
            r = {'ns': ns, 'path': path, 'kind': kind, 'rev': rev, 'etag': etag_of(rev, body), 'at': self.now(), 'by': caller.by,
                 'size': len(body), 'content_type': 'application/json' if kind == 'record' else ct, 'deleted': 0, 'entries': 0,
                 'body': body if kind == 'record' else None, 'blob_sha': self._write_blob(body) if kind == 'blob' else None}
            self._commit_row(r, 'put', prev=cur)
            return _frame(r)

    def delete(self, ns: str, path: str, caller: Caller, if_match: str = '', force: bool = False) -> dict:
        if_match = norm_if_match(if_match)
        if not if_match and not force:
            raise DataError('precondition_required', f'{ns}/{path}: pass ifMatch (the etag read)', ns=ns, path=path)
        with self.lock:
            self.read_only_check(ns, path)
            cur = self._row(ns, path)
            if not cur or cur['deleted']:
                raise DataError('not_found', f'{ns}/{path} not found', ns=ns, path=path)
            if cur['kind'] == 'journal':
                raise DataError('read_only', f'{ns}/{path} is a journal: journals are never removed', ns=ns, path=path)
            if if_match and not _matches(if_match, cur):
                raise DataError('conflict', f"{ns}/{path} is at rev {cur['rev']}", ns=ns, path=path, rev=cur['rev'], etag=cur['etag'])
            rev = cur['rev'] + 1
            r = {**cur, 'rev': rev, 'etag': f'{rev}-{ZERO16}', 'at': self.now(), 'by': caller.by, 'size': 0, 'deleted': 1, 'body': None, 'blob_sha': None}
            self._commit_row(r, 'delete', prev=cur)
            return _frame(r)

    def list(self, ns: str, prefix: str = '', after: str = '', limit: int = 0, deleted: bool = False) -> dict:
        limit = max(1, min(LIMITS['listPage'], int(limit or LIMITS['listPage'])))
        where, args = 'ns=? AND substr(path, 1, ?) = ?', [ns, len(prefix), prefix]
        if not deleted:
            where += ' AND deleted=0'
        total = self.db.execute(f'SELECT COUNT(*) FROM keys WHERE {where}', args).fetchone()[0]
        q = f'SELECT ns, path, kind, rev, etag, at, by, size, content_type, deleted FROM keys WHERE {where}'
        if after:
            q += ' AND path > ?'
            args = [*args, after]
        rows = [dict(r) for r in self.db.execute(q + ' ORDER BY path LIMIT ?', [*args, limit + 1])]
        page = rows[:limit]
        return {'$axf': 'data-list@1', 'ns': ns, 'prefix': prefix, 'items': [_frame(r) for r in page],
                'next': page[-1]['path'] if len(rows) > limit else '', 'total': total}

    def _doc_table(self, ns: str, path: str):
        import tables as T  # noqa: WPS433 (tables imports this module)
        cur = self._row(ns, path)
        if not cur or cur['deleted']:
            raise DataError('not_found', f'{ns}/{path} not found', ns=ns, path=path)
        t = T.table_for(ns, path, 'record', 'application/json', b'{}') if cur['kind'] == 'record' else None
        return T, cur, t

    def item(self, ns: str, path: str, key: str, lkey: str = 'builds') -> dict:
        """data-item@1 on the SQLite engine: the document twin of pg.PgStore.item."""
        T, cur, t = self._doc_table(ns, path)
        try:
            T.row_query(t, lkey, key)
        except ValueError as e:
            raise DataError('invalid_body', str(e), ns=ns, path=path) from e
        doc = json.loads(self.body_of(cur) or b'{}')
        item = T.list_row_doc(doc, t, lkey, key)
        if item is None:
            raise DataError('not_found', f'{ns}/{path}: no {lkey} item "{key}"', ns=ns, path=path)
        return {'$axf': 'data-item@1', 'ns': ns, 'path': path, 'list': lkey, 'key': key, 'rev': cur['rev'], 'head': T.head_scalars(doc), 'item': item}

    def summary(self, ns: str, path: str, lkey: str = 'builds') -> dict:
        """pipeline-summary@1 on the SQLite engine: the document twin of pg.PgStore.summary."""
        T, cur, t = self._doc_table(ns, path)
        try:
            T.row_query(t, lkey, '-')
        except ValueError as e:
            raise DataError('invalid_body', str(e), ns=ns, path=path) from e
        return {**T.pipeline_summary_doc(json.loads(self.body_of(cur) or b'{}'), lkey), 'ns': ns, 'path': path, 'rev': cur['rev'], 'at': cur['at']}

    def patch(self, ns: str, path: str, body: dict, caller: Caller) -> dict:
        """data-patch@1 on the SQLite engine: the document twin of pg.PgStore.patch. The record is read, the named items
        replaced or added (ifRev checked against each item's `rev`), the head fields set, then written with the etag read;
        the journal line follows. One process lock covers it, so no writer slips between the read and the write."""
        import tables as T  # noqa: WPS433 (tables imports this module)
        cur0 = self._row(ns, path)
        if not cur0 or cur0['deleted']:
            raise DataError('not_found', f'{ns}/{path} not found: put the document first', ns=ns, path=path)
        if cur0['kind'] != 'record':
            raise DataError('invalid_key', f"{ns}/{path} is a {cur0['kind']}", ns=ns, path=path)
        t = T.table_for(ns, path, 'record', 'application/json', b'{}')
        try:
            p = T.check_patch(body, t if isinstance(t, T.DocTable) else None)
        except ValueError as e:
            raise DataError('invalid_body', str(e), ns=ns, path=path) from e
        journal = p['journal']
        if journal:
            self._kind_ok(ns, 'journal', journal['path'])
        with self.lock:
            self.read_only_check(ns, path)
            cur = self._row(ns, path)
            doc = json.loads(self.body_of(cur) or b'{}')
            if not isinstance(doc, dict):
                raise DataError('invalid_body', f'{ns}/{path} is not an object: nothing to patch', ns=ns, path=path)
            conflicts = []
            for lkey, changes in p['lists'].items():
                conflicts += T.rev_conflicts(changes, T.doc_revs(doc, lkey, t.lists[lkey], [ch['key'] for ch in changes]))
            if conflicts:
                raise DataError('conflict', f"{ns}/{path}: {len(conflicts)} item(s) changed since they were read: {', '.join(c['key'] for c in conflicts[:10])}",
                                ns=ns, path=path, rev=cur['rev'], etag=cur['etag'])
            before = {lkey: {it.get(t.lists[lkey].key) for it in (doc.get(lkey) or []) if isinstance(it, dict)} for lkey in p['lists']}
            new = T.apply_patch_doc(doc, t, p['head'], p['lists'])
            added = sum(1 for lkey, chs in p['lists'].items() for ch in chs if ch['key'] not in before[lkey])
            frame = self.put(ns, path, canonical(new).encode('utf-8'), 'application/json', caller, if_match=cur['etag'])
            jout = None
            if journal:
                jout = self.append(ns, journal['path'], [journal['entry']], caller, idempotency_key=journal.get('idem') or '')
            return {'$axf': 'data-patch@1', 'record': frame, 'applied': sum(len(c) for c in p['lists'].values()), 'added': added, 'journal': jout}

    def append(self, ns: str, path: str, entries: list, caller: Caller, idempotency_key: str = '') -> dict:
        self._kind_ok(ns, 'journal', path)
        if not isinstance(entries, list) or not entries:
            raise DataError('invalid_body', 'append needs { entries: [ … ] } with at least one entry', ns=ns, path=path)
        lines = [canonical(e) for e in entries]
        for ln in lines:
            if len(ln.encode('utf-8')) > LIMITS['entryBytes']:
                raise DataError('too_large', f"a journal entry is over {LIMITS['entryBytes']} bytes", ns=ns, path=path)
        if sum(len(ln) + 1 for ln in lines) > LIMITS['appendBytes']:
            raise DataError('too_large', f"one append is over {LIMITS['appendBytes']} bytes", ns=ns, path=path)
        with self.lock:
            self.read_only_check(ns, path)
            idem = f'{ns}/{path}#{idempotency_key}' if idempotency_key else ''
            if idem:
                seen = self.db.execute('SELECT value FROM idem WHERE k=?', (idem,)).fetchone()
                if seen:
                    return json.loads(seen[0])
            cur = self._row(ns, path)
            if cur and cur['kind'] != 'journal':
                raise DataError('invalid_key', f"{ns}/{path} is a {cur['kind']}", ns=ns, path=path)
            have = cur['entries'] if cur else 0
            at, by = self.now(), caller.by
            stamped = [journal_line(have + i + 1, at, by, ln) for i, ln in enumerate(lines)]
            h = self._journal_hasher(ns, path, have)
            for s in stamped:
                h.update((s + '\n').encode('utf-8'))
            total = have + len(lines)
            size = (cur['size'] if cur else 0) + sum(len(s.encode('utf-8')) + 1 for s in stamped)
            r = {'ns': ns, 'path': path, 'kind': 'journal', 'rev': (cur['rev'] if cur else 0) + 1, 'etag': f'{total}-{h.hexdigest()[:16]}',
                 'at': at, 'by': by, 'size': size, 'content_type': 'application/x-ndjson', 'deleted': 0, 'entries': total, 'body': None, 'blob_sha': None}
            out = {'$axf': 'data-append@1', 'ns': ns, 'path': path, 'first': have + 1, 'last': total, 'count': len(lines)}
            self.db.execute('BEGIN IMMEDIATE')
            try:
                self.db.executemany('INSERT INTO journal (ns, path, seq, at, by, line) VALUES (?,?,?,?,?,?)',
                                    [(ns, path, have + i + 1, at, by, s) for i, s in enumerate(stamped)])
                self.db.execute('INSERT OR REPLACE INTO keys (ns, path, kind, rev, etag, at, by, size, content_type, deleted, entries, body, blob_sha) '
                                'VALUES (:ns,:path,:kind,:rev,:etag,:at,:by,:size,:content_type,:deleted,:entries,:body,:blob_sha)', r)
                c = self._change(r, 'append', total)
                if idem:
                    self.db.execute('INSERT INTO idem (k, value, at) VALUES (?,?,?)', (idem, json.dumps(out), at))
                self.db.execute('COMMIT')
            except BaseException:
                self.db.execute('ROLLBACK')
                self._jhash.pop((ns, path), None)
                raise
            self._jhash[(ns, path)] = (total, h)
            for hk in self.hooks:
                hk.on_change(c)
            return out

    def _journal_hasher(self, ns: str, path: str, have: int):
        """A running SHA-256 over the journal's lines (the journal etag), rebuilt from the table after a restart."""
        cached = self._jhash.get((ns, path))
        if cached and cached[0] == have:
            return cached[1].copy()
        h = hashlib.sha256()
        for (line,) in self.db.execute('SELECT line FROM journal WHERE ns=? AND path=? ORDER BY seq', (ns, path)):
            h.update((line + '\n').encode('utf-8'))
        return h

    def read(self, ns: str, path: str, since: int = 0, limit: int = 0, tail: int = 0) -> dict:
        r = self._row(ns, path)
        if not r:
            raise DataError('not_found', f'{ns}/{path} not found', ns=ns, path=path)
        if r['kind'] != 'journal':
            raise DataError('invalid_key', f"{ns}/{path} is a {r['kind']}: get it", ns=ns, path=path)
        limit = max(1, min(LIMITS['journalPage'], int(limit or LIMITS['journalPage'])))
        if tail:
            rows = list(self.db.execute('SELECT line FROM (SELECT seq, line FROM journal WHERE ns=? AND path=? ORDER BY seq DESC LIMIT ?) ORDER BY seq', (ns, path, max(1, int(tail)))))
        else:
            rows = list(self.db.execute('SELECT line FROM journal WHERE ns=? AND path=? AND seq>? ORDER BY seq LIMIT ?', (ns, path, max(0, int(since or 0)), limit)))
        entries = []
        for (line,) in rows:
            e = json.loads(line)
            entries.append({'$axf': 'data-entry@1', 'ns': ns, 'path': path, 'seq': e['seq'], 'at': e['at'], 'by': e['by'], 'entry': e['entry']})
        last = entries[-1]['seq'] if entries else int(since or 0)
        return {'$axf': 'data-entries@1', 'ns': ns, 'path': path, 'entries': entries, 'next': last if last < r['entries'] else 0}

    def changes(self, since: int = 0, ns: list[str] | None = None, prefix: str = '', limit: int = 0) -> dict:
        since = max(0, int(since or 0))
        floor = int(self.meta_get('feed_floor', '0'))
        if since and since < floor:
            raise DataError('cursor_expired', f'cursor {since} is older than the retained feed ({floor}): list instead')
        limit = max(1, min(LIMITS['journalPage'], int(limit or LIMITS['journalPage'])))
        cursor = self.db.execute('SELECT COALESCE(MAX(cursor), 0) FROM changes').fetchone()[0]
        out = []
        for row in self.db.execute('SELECT * FROM changes WHERE cursor > ? ORDER BY cursor', (since,)):
            c = dict(row)
            key = f"{c['ns']}/{c['path']}"
            if ns and not any(n == c['ns'] or key.startswith(f'{n}/') for n in ns):
                continue
            if prefix and not c['path'].startswith(prefix):
                continue
            f = {'$axf': 'data-change@1', 'cursor': c['cursor'], 'ns': c['ns'], 'path': c['path'], 'kind': c['kind'], 'op': c['op'],
                 'rev': c['rev'], 'etag': c['etag'], 'at': c['at'], 'by': c['by']}
            if c['seq']:
                f['seq'] = c['seq']
            out.append(f)
            if len(out) >= limit:
                break
        return {'changes': out, 'cursor': cursor}

    def manifest(self, nsid: str) -> dict:
        head, prefix = parse_namespace(nsid)
        rows = self.db.execute('SELECT path, etag, size, kind, entries, deleted FROM keys WHERE ns=? AND deleted=0 AND substr(path, 1, ?) = ?', (head, len(prefix), prefix))
        return manifest_of({**dict(r), 'path': r['path'][len(prefix):]} for r in rows)

    def namespaces_live(self) -> list[str]:
        return [n for n in NAMESPACES if not NAMESPACES[n].get('internal')]

    def snapshot(self, namespaces: list[str] | None, caller: Caller, mode: str = '') -> dict:
        nss = namespaces or self.namespaces_live()
        with self.lock:
            out = {n: self.manifest(n) for n in nss}
            at = self.now()
            sid = f"m-{re.sub(r'[-:.TZ]', '', at)[:14]}-{sha(canonical(out).encode('utf-8'))[:8]}"
            man = {'$axf': 'data-manifest@1', 'id': sid, 'at': at, 'by': caller.by, 'mode': mode or 'local', 'namespaces': out}
            body = canonical(man).encode('utf-8')
            tar_path = self.dir / 'snapshots' / f'{sid}.tar'
            tmp = tar_path.with_suffix('.tar.tmp')
            with tarfile.open(tmp, 'w') as tar:
                for n in nss:
                    head, prefix = parse_namespace(n)
                    for r in self.db.execute('SELECT * FROM keys WHERE ns=? AND deleted=0 AND substr(path, 1, ?) = ?', (head, len(prefix), prefix)).fetchall():
                        r = dict(r)
                        if r['kind'] == 'journal':
                            data = ''.join(ln + '\n' for (ln,) in self.db.execute('SELECT line FROM journal WHERE ns=? AND path=? ORDER BY seq', (head, r['path']))).encode('utf-8')
                        else:
                            data = self.body_of(r) or b''
                        _tar_add(tar, f"{head}/{r['path']}", data)
                _tar_add(tar, 'manifest.json', body)
            os.replace(tmp, tar_path)
            r = {'ns': '_meta', 'path': f'manifests/{sid}', 'kind': 'record', 'rev': 1, 'etag': etag_of(1, body), 'at': at, 'by': caller.by,
                 'size': len(body), 'content_type': 'application/json', 'deleted': 0, 'entries': 0, 'body': body, 'blob_sha': None}
            self._commit_row(r, 'put')
            return man

    def snapshot_tar(self, sid: str) -> Path:
        if not re.fullmatch(r'm-\d{14}-[0-9a-f]{8}', sid or ''):
            raise DataError('invalid_key', f'bad snapshot id "{sid}"')
        p = self.dir / 'snapshots' / f'{sid}.tar'
        if not p.is_file():
            raise DataError('not_found', f'snapshot {sid} not found')
        return p

    def meta_get(self, k: str, default: str = '') -> str:
        r = self.db.execute('SELECT v FROM meta WHERE k=?', (k,)).fetchone()
        return r[0] if r else default

    def meta_set(self, k: str, v: str) -> None:
        self.db.execute('INSERT OR REPLACE INTO meta (k, v) VALUES (?,?)', (k, v))

    def purge(self, now: datetime | None = None) -> dict:
        """Drop tombstones and change-feed lines older than the retention window; never a journal line."""
        now = now or datetime.now(timezone.utc)
        feed_cut = (now - timedelta(days=LIMITS['feedDays'])).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        tomb_cut = (now - timedelta(days=LIMITS['tombstoneDays'])).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        with self.lock:
            last = self.db.execute('SELECT MAX(cursor) FROM changes WHERE at < ?', (feed_cut,)).fetchone()[0]
            n_feed = self.db.execute('DELETE FROM changes WHERE at < ?', (feed_cut,)).rowcount
            if last:
                self.meta_set('feed_floor', str(last))
            n_tomb = self.db.execute('DELETE FROM keys WHERE deleted=1 AND at < ?', (tomb_cut,)).rowcount
            self.db.execute('DELETE FROM idem WHERE at < ?', (feed_cut,))
        return {'changes': n_feed, 'tombstones': n_tomb}

    def health(self, keys: dict | None = None) -> dict:
        try:
            du = shutil.disk_usage(self.dir)
            vol = {'freeBytes': du.free, 'totalBytes': du.total}
        except OSError:
            vol = {'freeBytes': -1, 'totalBytes': -1}
        cursor = self.db.execute('SELECT COALESCE(MAX(cursor), 0) FROM changes').fetchone()[0]
        return {'$axf': 'data-health@1', 'ok': True, 'cursor': cursor, 'uptimeMs': int((time.time() - self.started) * 1000),
                'volume': vol, 'keys': keys or {'verified': False, 'fetchedAt': ''}}

    def counts(self) -> dict:
        """Live keys per namespace (`plugins/<folder>` split out): what backup verify compares."""
        out: dict[str, int] = {}
        for r in self.db.execute('SELECT ns, path FROM keys WHERE deleted=0'):
            nsid = f"{r['ns']}/{r['path'].split('/')[0]}" if NAMESPACES.get(r['ns'], {}).get('open') else r['ns']
            out[nsid] = out.get(nsid, 0) + 1
        return dict(sorted(out.items()))


def _tar_add(tar: tarfile.TarFile, name: str, data: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mtime = int(time.time())
    tar.addfile(info, io.BytesIO(data))
