"""axf-data store engine on Postgres: data-store@1 over real tables.

Brett, Nov 15 2026: "Yeah, I want to migrate everything to a database in its own container. Land it, and then follow it
up with Postgres."

Same contract as store.py (framework/spec/DATA-STORE.md): keys, revs, etags, append-only journals, the change feed,
history + restore, manifests, snapshots. What differs is where a body lives:

  keys            one row per key: kind, rev, etag, at, actor, size, content type, tombstone, which table holds the body
  records         any record no domain table claims: `data JSONB` (queryable), canonical JSON on the way out
  blobs           bytes, content-addressed (sha256 → bytea); a history row points at the same blob
  journal         one row per journal line: `entry JSONB` plus the stored line (the etag hashes the lines); a trigger
                  refuses UPDATE and DELETE, so a journal is append-only in the database, not only in the API
  history         every accepted put / delete of a record or blob (newest N revs per key)
  changes         the change feed (cursor BIGSERIAL), idem (idempotent appends), meta (feed floor)
  domain tables   tables.py: builds + build_steps (the builds store), ui_review_items, planner_items, settings, notes,
                  control_targets (+ control_tabs), store_heads (the fields of a document that are not its rows);
                  mirror tables (ledger_*, chats_*) for the SQLite files the console still writes

A record whose key a domain table claims is decomposed into rows on PUT and assembled from them on GET. Its etag is
computed on the assembled body (what a reader gets back), so a reader's If-Match always means the same thing.

Every write runs under one process-wide lock and one Postgres transaction. One connection, one worker.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import tarfile
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from journal import KEEP, KEEP_LARGE, LARGE, Journal
from store import (ETAG, LIMITS, NAMESPACES, ZERO16, Caller, DataError, _frame, _matches, canonical, etag_of, journal_line,
                   manifest_of, norm_if_match, now_iso, parse_namespace, sha)
import tables as T

SQLITE_CT = 'application/vnd.sqlite3'

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS keys (
  ns TEXT NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL, rev BIGINT NOT NULL, etag TEXT NOT NULL,
  at TEXT NOT NULL, actor TEXT NOT NULL, size BIGINT NOT NULL, content_type TEXT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false,
  entries BIGINT NOT NULL DEFAULT 0, table_name TEXT NOT NULL DEFAULT '', blob_sha TEXT, PRIMARY KEY (ns, path)
);
CREATE INDEX IF NOT EXISTS keys_live ON keys (ns, path) WHERE NOT deleted;
CREATE TABLE IF NOT EXISTS records (ns TEXT NOT NULL, path TEXT NOT NULL, data JSONB, body BYTEA, PRIMARY KEY (ns, path));
CREATE TABLE IF NOT EXISTS blobs (sha TEXT PRIMARY KEY, bytes BYTEA NOT NULL, size BIGINT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS journal (
  ns TEXT NOT NULL, path TEXT NOT NULL, seq BIGINT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, entry JSONB NOT NULL, line TEXT NOT NULL,
  PRIMARY KEY (ns, path, seq)
);
CREATE OR REPLACE FUNCTION axf_journal_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'journal lines are append-only'; END $$;
DROP TRIGGER IF EXISTS journal_append_only ON journal;
CREATE TRIGGER journal_append_only BEFORE UPDATE OR DELETE ON journal FOR EACH ROW EXECUTE FUNCTION axf_journal_append_only();
CREATE TABLE IF NOT EXISTS changes (
  cursor BIGSERIAL PRIMARY KEY, ns TEXT NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL, op TEXT NOT NULL,
  rev BIGINT NOT NULL, etag TEXT NOT NULL, seq BIGINT, at TEXT NOT NULL, actor TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS changes_at ON changes (at);
CREATE TABLE IF NOT EXISTS idem (k TEXT PRIMARY KEY, value JSONB NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS history (
  ns TEXT NOT NULL, path TEXT NOT NULL, rev BIGINT NOT NULL, etag TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL,
  size BIGINT NOT NULL, content_type TEXT NOT NULL, deleted BOOLEAN NOT NULL, op TEXT NOT NULL, body BYTEA, blob_sha TEXT,
  PRIMARY KEY (ns, path, rev)
);
""" + T.SCHEMA_SQL

CORE_TABLES = ['keys', 'records', 'blobs', 'journal', 'history', 'changes', 'idem', 'meta']
_IDENT = re.compile(r'^[a-z_][a-z0-9_]*$')


def _dsn_with_schema(dsn: str, schema: str) -> str:
    if not _IDENT.match(schema):
        raise ValueError(f'bad schema name {schema!r}')
    sep = '&' if '?' in dsn else '?'
    return f'{dsn}{sep}options=-csearch_path%3D{schema}'


class PgStore:
    """The Store API (store.Store) on Postgres. `dsn`: AXF_DATA_DSN; `data_dir` keeps snapshots and the engine files."""

    engine = 'postgres'

    def __init__(self, dsn: str, data_dir: str | os.PathLike, now=now_iso, schema: str = 'public'):
        self.dsn, self.schema = dsn, schema
        self.dir = Path(data_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / 'snapshots').mkdir(exist_ok=True)
        self.lock = threading.RLock()
        self.now = now
        self.started = time.time()
        self._jhash: dict[tuple[str, str], tuple[int, Any]] = {}
        self._assembled: dict[tuple[str, str], tuple[str, bytes]] = {}  # (ns, path) → (etag, body) of the last table-backed document
        self.hooks: list = []
        self.db: psycopg.Connection = self._connect()
        self.journal = PgJournal(self)
        self.hooks.append(self.journal)
        self.mirror_map = T.mirror_map()

    # ── connection ──
    def _connect(self) -> psycopg.Connection:
        conn = psycopg.connect(_dsn_with_schema(self.dsn, self.schema), autocommit=True, row_factory=dict_row)
        with conn.transaction():
            conn.execute(f'CREATE SCHEMA IF NOT EXISTS {self.schema}')
            conn.execute(T.MIGRATE_V2_SQL)
            conn.execute(SCHEMA_SQL)
            T.migrate_v2(conn)
            conn.execute('INSERT INTO meta (k, v) VALUES (%s, %s) ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v', ('tables_version', str(T.TABLES_VERSION)))
        return conn

    def _ensure(self) -> psycopg.Connection:
        if self.db.closed or self.db.broken:
            self.db = self._connect()
        return self.db

    def q(self, sql: str, params: Iterable | None = None):
        """One statement under the lock (the connection is shared by request threads and the watch poller)."""
        with self.lock:
            return self._ensure().execute(sql, params)

    def fetchone(self, sql: str, params: Iterable | None = None) -> dict | None:
        with self.lock:
            return self._ensure().execute(sql, params).fetchone()

    def fetchall(self, sql: str, params: Iterable | None = None) -> list[dict]:
        with self.lock:
            return self._ensure().execute(sql, params).fetchall()

    def tx(self):
        """`with st.tx() as cur:` — one transaction under the lock; nested use becomes a savepoint."""
        return _Tx(self)

    # ── low level ──
    def _row(self, ns: str, path: str) -> dict | None:
        r = self.fetchone('SELECT ns, path, kind, rev, etag, at, actor AS by, size, content_type, deleted, entries, table_name, blob_sha FROM keys WHERE ns=%s AND path=%s', (ns, path))
        return dict(r) if r else None

    def _write_blob(self, cur, data: bytes) -> str:
        digest = sha(data)
        cur.execute('INSERT INTO blobs (sha, bytes, size, at) VALUES (%s, %s, %s, %s) ON CONFLICT (sha) DO NOTHING', (digest, data, len(data), self.now()))
        return digest

    def blob_bytes(self, digest: str) -> bytes | None:
        r = self.fetchone('SELECT bytes FROM blobs WHERE sha=%s', (digest,))
        return bytes(r['bytes']) if r else None

    def body_of(self, r: dict) -> bytes | None:
        if r['deleted']:
            return None
        if r['kind'] == 'blob' and r.get('blob_sha'):
            return self.blob_bytes(r['blob_sha'])
        with self.tx() as cur:
            return self._read_body(cur, r)

    def _read_body(self, cur, r: dict) -> bytes | None:
        if r['kind'] == 'journal':
            return None
        t = T.by_name(r.get('table_name') or '')
        if t:
            hit = self._assembled.get((r['ns'], r['path']))
            if hit and hit[0] == r['etag']:
                return hit[1]  # the builds store is read every minute and assembled from 900+ rows: keep the last body
            body = t.read(cur, r['ns'], r['path'])
            if body is not None and len(self._assembled) < 64:
                self._assembled[(r['ns'], r['path'])] = (r['etag'], body)
            return body
        if r['kind'] == 'blob':
            return self.blob_bytes(r['blob_sha']) if r.get('blob_sha') else None
        cur.execute('SELECT data, body FROM records WHERE ns=%s AND path=%s', (r['ns'], r['path']))
        rec = cur.fetchone()
        if not rec:
            return None
        if rec['body'] is not None:
            return bytes(rec['body'])
        return canonical(rec['data']).encode('utf-8')

    def _store_body(self, cur, ns: str, path: str, kind: str, body: bytes, content_type: str) -> tuple[bytes, str, str | None]:
        """Put a body where it belongs. Returns (body as a reader gets it, table name, blob sha)."""
        t = T.table_for(ns, path, kind, content_type, body)
        if t:
            cur.execute('DELETE FROM records WHERE ns=%s AND path=%s', (ns, path))
            t.write(cur, ns, path, body)
            out = t.read(cur, ns, path)
            return out if out is not None else body, t.name, None
        if kind == 'blob':
            self._clear_tables(cur, ns, path)
            digest = self._write_blob(cur, body)
            return body, '', digest
        self._clear_tables(cur, ns, path)
        doc = json.loads(body.decode('utf-8'))
        try:
            with cur.connection.transaction():
                cur.execute('INSERT INTO records (ns, path, data, body) VALUES (%s, %s, %s, NULL) ON CONFLICT (ns, path) DO UPDATE SET data=EXCLUDED.data, body=NULL',
                            (ns, path, Jsonb(doc, dumps=canonical)))
                cur.execute('SELECT data FROM records WHERE ns=%s AND path=%s', (ns, path))
                out = canonical(cur.fetchone()['data']).encode('utf-8')
        except psycopg.errors.UntranslatableCharacter:
            # jsonb cannot hold \u0000: keep the exact bytes instead
            cur.execute('INSERT INTO records (ns, path, data, body) VALUES (%s, %s, NULL, %s) ON CONFLICT (ns, path) DO UPDATE SET data=NULL, body=EXCLUDED.body', (ns, path, body))
            out = body
        return out, '', None

    def _clear_tables(self, cur, ns: str, path: str) -> None:
        cur.execute('SELECT table_name FROM keys WHERE ns=%s AND path=%s', (ns, path))
        r = cur.fetchone()
        t = T.by_name(r['table_name']) if r and r['table_name'] else None
        if t:
            t.delete(cur, ns, path)

    def _change(self, cur, r: dict, op: str, seq: int | None = None) -> dict:
        cur.execute('INSERT INTO changes (ns, path, kind, op, rev, etag, seq, at, actor) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING cursor',
                    (r['ns'], r['path'], r['kind'], op, r['rev'], r['etag'], seq, r['at'], r['by']))
        c = {'$axf': 'data-change@1', 'cursor': cur.fetchone()['cursor'], 'ns': r['ns'], 'path': r['path'], 'kind': r['kind'], 'op': op,
             'rev': r['rev'], 'etag': r['etag'], 'at': r['at'], 'by': r['by']}
        if seq:
            c['seq'] = seq
        return c

    def _upsert_key(self, cur, r: dict) -> None:
        cur.execute('INSERT INTO keys (ns, path, kind, rev, etag, at, actor, size, content_type, deleted, entries, table_name, blob_sha) '
                    'VALUES (%(ns)s,%(path)s,%(kind)s,%(rev)s,%(etag)s,%(at)s,%(by)s,%(size)s,%(content_type)s,%(deleted)s,%(entries)s,%(table_name)s,%(blob_sha)s) '
                    'ON CONFLICT (ns, path) DO UPDATE SET kind=EXCLUDED.kind, rev=EXCLUDED.rev, etag=EXCLUDED.etag, at=EXCLUDED.at, actor=EXCLUDED.actor, '
                    'size=EXCLUDED.size, content_type=EXCLUDED.content_type, deleted=EXCLUDED.deleted, entries=EXCLUDED.entries, table_name=EXCLUDED.table_name, blob_sha=EXCLUDED.blob_sha',
                    {**r, 'deleted': bool(r['deleted']), 'table_name': r.get('table_name') or '', 'blob_sha': r.get('blob_sha')})

    def _commit_row(self, r: dict, op: str, seq: int | None = None, prev: dict | None = None, body: bytes | None = None) -> dict:
        """Write a key row (body already placed by the caller inside the same transaction, or passed here for a delete / meta write)."""
        with self.tx() as cur:
            if op == 'put' and body is not None and 'table_name' not in r:
                stored, tname, digest = self._store_body(cur, r['ns'], r['path'], r['kind'], body, r['content_type'])
                r = {**r, 'table_name': tname, 'blob_sha': digest, 'etag': etag_of(r['rev'], stored), 'size': len(stored)}
                body = stored
            if op == 'delete':
                cur.execute('DELETE FROM records WHERE ns=%s AND path=%s', (r['ns'], r['path']))
                if prev and prev.get('table_name'):
                    t = T.by_name(prev['table_name'])
                    if t:
                        t.delete(cur, r['ns'], r['path'])
            self._upsert_key(cur, r)
            for h in self.hooks:
                h.on_row(cur, r, op, prev, body)
            c = self._change(cur, r, op, seq)
        for h in self.hooks:
            h.on_change(c)
        return c

    def read_only_check(self, ns: str, path: str) -> None:
        if ns == '_meta':
            return
        r = self._row('_meta', 'mode')
        if not r or r['deleted']:
            return
        try:
            doc = json.loads(self.body_of(r) or b'null')
        except ValueError:
            return
        if not isinstance(doc, dict):
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
                 'size': len(body), 'content_type': 'application/json' if kind == 'record' else ct, 'deleted': False, 'entries': 0}
            with self.tx() as tcur:
                stored, tname, digest = self._store_body(tcur, ns, path, kind, body, r['content_type'])
                r = {**r, 'table_name': tname, 'blob_sha': digest, 'etag': etag_of(rev, stored), 'size': len(stored)}
                self._upsert_key(tcur, r)
                for h in self.hooks:
                    h.on_row(tcur, r, 'put', cur, stored)
                c = self._change(tcur, r, 'put')
                mirrored = self._mirror_if_sqlite(tcur, ns, path, r['content_type'], stored)
            if tname:
                self._assembled[(ns, path)] = (r['etag'], stored)
            else:
                self._assembled.pop((ns, path), None)
            for h in self.hooks:
                h.on_change(c)
            if mirrored:
                self.journal.on_mirror(mirrored)
            return _frame(r)

    def _mirror_if_sqlite(self, cur, ns: str, path: str, content_type: str, body: bytes) -> dict | None:
        """A SQLite file the console uploads (blob-sqlite) becomes real rows: <prefix>_<table> for every table in it."""
        prefix = self.mirror_map.get(f'{ns}/{path}')
        if not prefix or content_type != SQLITE_CT:
            return None
        return T.mirror_sqlite_bytes(cur, prefix, body, source=f'{ns}/{path}', at=self.now())

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
            r = {**cur, 'rev': rev, 'etag': f'{rev}-{ZERO16}', 'at': self.now(), 'by': caller.by, 'size': 0, 'deleted': True, 'table_name': '', 'blob_sha': None}
            self._commit_row(r, 'delete', prev=cur)
            return _frame(r)

    def list(self, ns: str, prefix: str = '', after: str = '', limit: int = 0, deleted: bool = False) -> dict:
        limit = max(1, min(LIMITS['listPage'], int(limit or LIMITS['listPage'])))
        where, args = 'ns=%s AND left(path, %s) = %s', [ns, len(prefix), prefix]
        if not deleted:
            where += ' AND NOT deleted'
        total = self.fetchone(f'SELECT COUNT(*) AS n FROM keys WHERE {where}', args)['n']
        q = f'SELECT ns, path, kind, rev, etag, at, actor AS by, size, content_type, deleted FROM keys WHERE {where}'
        if after:
            q += ' AND path > %s'
            args = [*args, after]
        rows = self.fetchall(q + ' ORDER BY path COLLATE "C" LIMIT %s', [*args, limit + 1])
        page = rows[:limit]
        return {'$axf': 'data-list@1', 'ns': ns, 'prefix': prefix, 'items': [_frame(r) for r in page],
                'next': page[-1]['path'] if len(rows) > limit else '', 'total': total}

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
                seen = self.fetchone('SELECT value FROM idem WHERE k=%s', (idem,))
                if seen:
                    return seen['value']
            try:
                with self.tx() as tcur:
                    out, c = self._append_rows(tcur, ns, path, entries, lines, caller, idem)
            except BaseException:
                self._jhash.pop((ns, path), None)
                raise
            for hk in self.hooks:
                hk.on_change(c)
            return out

    def _append_rows(self, tcur, ns: str, path: str, entries: list, lines: list[str], caller: Caller, idem: str) -> tuple[dict, dict]:
        """The journal rows, key row and change of one append, inside the caller's transaction (append, patch)."""
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
             'at': at, 'by': by, 'size': size, 'content_type': 'application/x-ndjson', 'deleted': False, 'entries': total, 'table_name': 'journal', 'blob_sha': None}
        out = {'$axf': 'data-append@1', 'ns': ns, 'path': path, 'first': have + 1, 'last': total, 'count': len(lines)}
        with tcur.copy('COPY journal (ns, path, seq, at, actor, entry, line) FROM STDIN') as cp:
            for i, (s, e) in enumerate(zip(stamped, entries)):
                cp.write_row((ns, path, have + i + 1, at, by, Jsonb(e, dumps=canonical), s))
        self._upsert_key(tcur, r)
        c = self._change(tcur, r, 'append', total)
        if idem:
            tcur.execute('INSERT INTO idem (k, value, at) VALUES (%s, %s, %s)', (idem, Jsonb(out), at))
        self._jhash[(ns, path)] = (total, h)
        return out, c

    def patch(self, ns: str, path: str, body: dict, caller: Caller) -> dict:
        """data-patch@1 (row-level): some rows of a keyed list (the builds), the head fields given, and one journal line,
        in one transaction. Only the named rows are locked (`SELECT … FOR UPDATE`); a row whose `rev` is not the `ifRev`
        the writer read is a `conflict` naming the keys, and nothing is written. The record's rev and etag move like a put."""
        cur = self._row(ns, path)
        if not cur or cur['deleted']:
            raise DataError('not_found', f'{ns}/{path} not found: put the document first', ns=ns, path=path)
        t = T.by_name(cur.get('table_name') or '')
        try:
            p = T.check_patch(body, t if isinstance(t, T.DocTable) else None)
        except ValueError as e:
            raise DataError('invalid_body', str(e), ns=ns, path=path) from e
        journal = p['journal']
        jlines: list[str] = []
        if journal:
            jns, jpath = ns, journal['path']
            self._kind_ok(jns, 'journal', jpath)
            jlines = [canonical(journal['entry'])]
            if len(jlines[0].encode('utf-8')) > LIMITS['entryBytes']:
                raise DataError('too_large', f"the journal entry is over {LIMITS['entryBytes']} bytes", ns=jns, path=jpath)
        with self.lock:
            self.read_only_check(ns, path)
            for jp in ([journal['path']] if journal else []):
                self.read_only_check(ns, jp)
            idem = f"{ns}/{journal['path']}#{journal['idem']}" if journal and journal.get('idem') else ''
            jout = None
            try:
                with self.tx() as tcur:
                    conflicts = []
                    for lkey, changes in p['lists'].items():
                        have = t.lock_rows(tcur, t.lists[lkey], [ch['key'] for ch in changes])
                        conflicts += [{'list': lkey, **c} for c in T.rev_conflicts(changes, have)]
                    if conflicts:
                        raise DataError('conflict', f"{ns}/{path}: {len(conflicts)} item(s) changed since they were read: {', '.join(c['key'] for c in conflicts[:10])}",
                                        ns=ns, path=path, rev=cur['rev'], etag=cur['etag'])
                    applied = t.patch(tcur, ns, path, p['head'], p['lists'])
                    stored = t.read(tcur, ns, path)
                    rev = cur['rev'] + 1
                    r = {'ns': ns, 'path': path, 'kind': 'record', 'rev': rev, 'etag': etag_of(rev, stored), 'at': self.now(), 'by': caller.by,
                         'size': len(stored), 'content_type': 'application/json', 'deleted': False, 'entries': 0, 'table_name': t.name, 'blob_sha': None}
                    self._upsert_key(tcur, r)
                    for h in self.hooks:
                        h.on_row(tcur, r, 'put', cur, stored)
                    c = self._change(tcur, r, 'put')
                    changes_out = [c]
                    if journal:
                        if idem:
                            tcur.execute('SELECT value FROM idem WHERE k=%s', (idem,))
                            seen = tcur.fetchone()
                        else:
                            seen = None
                        if seen:
                            jout = seen['value']
                        else:
                            jout, jc = self._append_rows(tcur, ns, journal['path'], [journal['entry']], jlines, caller, idem)
                            changes_out.append(jc)
            except BaseException:
                if journal:
                    self._jhash.pop((ns, journal['path']), None)
                raise
            self._assembled[(ns, path)] = (r['etag'], stored)
            for h in self.hooks:
                for ch in changes_out:
                    h.on_change(ch)
            return {'$axf': 'data-patch@1', 'record': _frame(r), 'applied': applied['applied'], 'added': applied['added'], 'journal': jout}

    def _journal_hasher(self, ns: str, path: str, have: int):
        cached = self._jhash.get((ns, path))
        if cached and cached[0] == have:
            return cached[1].copy()
        h = hashlib.sha256()
        for r in self.fetchall('SELECT line FROM journal WHERE ns=%s AND path=%s ORDER BY seq', (ns, path)):
            h.update((r['line'] + '\n').encode('utf-8'))
        return h

    def journal_lines(self, ns: str, path: str) -> list[str]:
        return [r['line'] for r in self.fetchall('SELECT line FROM journal WHERE ns=%s AND path=%s ORDER BY seq', (ns, path))]

    def read(self, ns: str, path: str, since: int = 0, limit: int = 0, tail: int = 0) -> dict:
        r = self._row(ns, path)
        if not r:
            raise DataError('not_found', f'{ns}/{path} not found', ns=ns, path=path)
        if r['kind'] != 'journal':
            raise DataError('invalid_key', f"{ns}/{path} is a {r['kind']}: get it", ns=ns, path=path)
        limit = max(1, min(LIMITS['journalPage'], int(limit or LIMITS['journalPage'])))
        if tail:
            rows = self.fetchall('SELECT line FROM (SELECT seq, line FROM journal WHERE ns=%s AND path=%s ORDER BY seq DESC LIMIT %s) t ORDER BY seq', (ns, path, max(1, int(tail))))
        else:
            rows = self.fetchall('SELECT line FROM journal WHERE ns=%s AND path=%s AND seq>%s ORDER BY seq LIMIT %s', (ns, path, max(0, int(since or 0)), limit))
        entries = []
        for row in rows:
            e = json.loads(row['line'])
            entries.append({'$axf': 'data-entry@1', 'ns': ns, 'path': path, 'seq': e['seq'], 'at': e['at'], 'by': e['by'], 'entry': e['entry']})
        last = entries[-1]['seq'] if entries else int(since or 0)
        return {'$axf': 'data-entries@1', 'ns': ns, 'path': path, 'entries': entries, 'next': last if last < r['entries'] else 0}

    def changes(self, since: int = 0, ns: list[str] | None = None, prefix: str = '', limit: int = 0) -> dict:
        since = max(0, int(since or 0))
        floor = int(self.meta_get('feed_floor', '0'))
        if since and since < floor:
            raise DataError('cursor_expired', f'cursor {since} is older than the retained feed ({floor}): list instead')
        limit = max(1, min(LIMITS['journalPage'], int(limit or LIMITS['journalPage'])))
        cursor = self.fetchone('SELECT COALESCE(MAX(cursor), 0) AS c FROM changes')['c']
        out = []
        for c in self.fetchall('SELECT cursor, ns, path, kind, op, rev, etag, seq, at, actor AS by FROM changes WHERE cursor > %s ORDER BY cursor', (since,)):
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
        rows = self.fetchall('SELECT path, etag, size, kind, entries, deleted FROM keys WHERE ns=%s AND NOT deleted AND left(path, %s) = %s', (head, len(prefix), prefix))
        return manifest_of({**r, 'path': r['path'][len(prefix):]} for r in rows)

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
                    for r in self.fetchall('SELECT ns, path, kind, rev, etag, at, actor AS by, size, content_type, deleted, entries, table_name, blob_sha FROM keys WHERE ns=%s AND NOT deleted AND left(path, %s) = %s', (head, len(prefix), prefix)):
                        if r['kind'] == 'journal':
                            data = ''.join(ln + '\n' for ln in self.journal_lines(head, r['path'])).encode('utf-8')
                        else:
                            data = self.body_of(r) or b''
                        _tar_add(tar, f"{head}/{r['path']}", data)
                _tar_add(tar, 'manifest.json', body)
            os.replace(tmp, tar_path)
            r = {'ns': '_meta', 'path': f'manifests/{sid}', 'kind': 'record', 'rev': 1, 'etag': etag_of(1, body), 'at': at, 'by': caller.by,
                 'size': len(body), 'content_type': 'application/json', 'deleted': False, 'entries': 0}
            self._commit_row(r, 'put', body=body)
            return man

    def snapshot_tar(self, sid: str) -> Path:
        if not re.fullmatch(r'm-\d{14}-[0-9a-f]{8}', sid or ''):
            raise DataError('invalid_key', f'bad snapshot id "{sid}"')
        p = self.dir / 'snapshots' / f'{sid}.tar'
        if not p.is_file():
            raise DataError('not_found', f'snapshot {sid} not found')
        return p

    def meta_get(self, k: str, default: str = '') -> str:
        r = self.fetchone('SELECT v FROM meta WHERE k=%s', (k,))
        return r['v'] if r else default

    def meta_set(self, k: str, v: str) -> None:
        self.q('INSERT INTO meta (k, v) VALUES (%s, %s) ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v', (k, v))

    def purge(self, now: datetime | None = None) -> dict:
        now = now or datetime.now(timezone.utc)
        feed_cut = (now - timedelta(days=LIMITS['feedDays'])).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        tomb_cut = (now - timedelta(days=LIMITS['tombstoneDays'])).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        with self.tx() as cur:
            cur.execute('SELECT MAX(cursor) AS c FROM changes WHERE at < %s', (feed_cut,))
            last = cur.fetchone()['c']
            cur.execute('DELETE FROM changes WHERE at < %s', (feed_cut,))
            n_feed = cur.rowcount
            if last:
                cur.execute('INSERT INTO meta (k, v) VALUES (%s, %s) ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v', ('feed_floor', str(last)))
            cur.execute('DELETE FROM keys WHERE deleted AND at < %s', (tomb_cut,))
            n_tomb = cur.rowcount
            cur.execute('DELETE FROM idem WHERE at < %s', (feed_cut,))
        return {'changes': n_feed, 'tombstones': n_tomb}

    def health(self, keys: dict | None = None) -> dict:
        try:
            du = shutil.disk_usage(self.dir)
            vol = {'freeBytes': du.free, 'totalBytes': du.total}
        except OSError:
            vol = {'freeBytes': -1, 'totalBytes': -1}
        ok, cursor, db_bytes = True, 0, -1
        try:
            cursor = self.fetchone('SELECT COALESCE(MAX(cursor), 0) AS c FROM changes')['c']
            db_bytes = self.fetchone('SELECT pg_database_size(current_database()) AS b')['b']
        except psycopg.Error:
            ok = False
        return {'$axf': 'data-health@1', 'ok': ok, 'cursor': cursor, 'uptimeMs': int((time.time() - self.started) * 1000),
                'volume': vol, 'keys': keys or {'verified': False, 'fetchedAt': ''},
                'engine': {'kind': 'postgres', 'databaseBytes': db_bytes, 'tables': len(self.table_names())}}

    def counts(self) -> dict:
        out: dict[str, int] = {}
        for r in self.fetchall('SELECT ns, path FROM keys WHERE NOT deleted'):
            nsid = f"{r['ns']}/{r['path'].split('/')[0]}" if NAMESPACES.get(r['ns'], {}).get('open') else r['ns']
            out[nsid] = out.get(nsid, 0) + 1
        return dict(sorted(out.items()))

    # ── tables (what makes this engine different) ──
    def table_names(self) -> list[str]:
        return [r['t'] for r in self.fetchall("SELECT tablename AS t FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename")]

    def tables(self) -> dict:
        """data-tables@1: every table with its rows and bytes, grouped as core / domain / mirror."""
        rows = []
        for name in self.table_names():
            n = self.fetchone(f'SELECT COUNT(*) AS n FROM "{name}"')['n']
            b = self.fetchone('SELECT pg_total_relation_size(%s) AS b', (name,))['b']
            group = 'core' if name in CORE_TABLES else ('mirror' if any(name.startswith(p + '_') for p in set(self.mirror_map.values())) else 'domain')
            rows.append({'name': name, 'rows': n, 'bytes': b, 'group': group, 'holds': T.describe(name, self.mirror_map)})
        return {'$axf': 'data-tables@1', 'engine': 'postgres', 'tables': rows, 'mirrors': T.mirror_runs(self), 'at': self.now()}

    # ── import (migrate_pg.py: copy a SQLite axf-data in, metadata kept as it was) ──
    def import_key(self, r: dict, body: bytes | None, lines: list[str] | None = None) -> None:
        """One key as the SQLite store has it: same rev / etag / at / by. Bodies go to their tables; journal lines verbatim."""
        with self.tx() as cur:
            row = {**r, 'deleted': bool(r['deleted']), 'table_name': '', 'blob_sha': None}
            if r['kind'] == 'journal':
                row['table_name'] = 'journal'
                if lines:
                    with cur.copy('COPY journal (ns, path, seq, at, actor, entry, line) FROM STDIN') as cp:
                        for ln in lines:
                            e = json.loads(ln)
                            cp.write_row((r['ns'], r['path'], e['seq'], e['at'], e['by'], Jsonb(e['entry'], dumps=canonical), ln))
            elif not row['deleted'] and body is not None:
                # the source etag is kept even when a domain table normalises the body: the two manifests must compare equal
                _stored, tname, digest = self._store_body(cur, r['ns'], r['path'], r['kind'], body, r['content_type'])
                row['table_name'], row['blob_sha'] = tname, digest
            self._upsert_key(cur, row)

    def import_history(self, rows: list[dict]) -> None:
        with self.tx() as cur:
            for h in rows:
                digest = None
                if h.get('blob_bytes') is not None:
                    digest = self._write_blob(cur, h['blob_bytes'])
                cur.execute('INSERT INTO history (ns, path, rev, etag, at, actor, size, content_type, deleted, op, body, blob_sha) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (ns, path, rev) DO NOTHING',
                            (h['ns'], h['path'], h['rev'], h['etag'], h['at'], h['by'], h['size'], h['content_type'], bool(h['deleted']), h['op'], h.get('body'), digest))

    def import_changes(self, rows: list[dict]) -> None:
        with self.tx() as cur:
            for c in rows:
                cur.execute('INSERT INTO changes (cursor, ns, path, kind, op, rev, etag, seq, at, actor) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (cursor) DO NOTHING',
                            (c['cursor'], c['ns'], c['path'], c['kind'], c['op'], c['rev'], c['etag'], c['seq'], c['at'], c['by']))
            cur.execute("SELECT setval('changes_cursor_seq', GREATEST((SELECT COALESCE(MAX(cursor), 0) FROM changes), 1), (SELECT COUNT(*) > 0 FROM changes))")

    def import_idem(self, rows: list[dict]) -> None:
        with self.tx() as cur:
            for i in rows:
                cur.execute('INSERT INTO idem (k, value, at) VALUES (%s, %s, %s) ON CONFLICT (k) DO NOTHING', (i['k'], Jsonb(json.loads(i['value'])), i['at']))

    def journal_line_count(self) -> dict:
        return {r['ns']: r['n'] for r in self.fetchall('SELECT ns, COUNT(*) AS n FROM journal GROUP BY ns ORDER BY ns')}

    def drop_everything(self) -> None:
        """Tests and a refused migration: the schema goes, nothing else."""
        with self.lock:
            self._ensure().execute(f'DROP SCHEMA IF EXISTS {self.schema} CASCADE')
            self.db.close()


class _Tx:
    def __init__(self, st: PgStore):
        self.st = st

    def __enter__(self):
        self.st.lock.acquire()
        conn = self.st._ensure()
        self._t = conn.transaction()
        self._t.__enter__()
        return conn.cursor()

    def __exit__(self, *exc):
        try:
            return self._t.__exit__(*exc)
        finally:
            self.st.lock.release()


class PgJournal(Journal):
    """History + restore + watch on Postgres (journal lines live in the engine; this keeps the per-key history)."""

    def on_row(self, cur, r: dict, op: str, prev: dict | None, body: bytes | None = None) -> None:  # noqa: D401
        if r['ns'] == '_meta' or r['kind'] == 'journal':
            return
        if r.get('content_type') == SQLITE_CT:
            return  # a mirrored SQLite file is big and its rows are the history; the blob is kept once
        cur.execute('INSERT INTO history (ns, path, rev, etag, at, actor, size, content_type, deleted, op, body, blob_sha) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) '
                    'ON CONFLICT (ns, path, rev) DO UPDATE SET etag=EXCLUDED.etag, at=EXCLUDED.at, actor=EXCLUDED.actor, size=EXCLUDED.size, content_type=EXCLUDED.content_type, deleted=EXCLUDED.deleted, op=EXCLUDED.op, body=EXCLUDED.body, blob_sha=EXCLUDED.blob_sha',
                    (r['ns'], r['path'], r['rev'], r['etag'], r['at'], r['by'], r['size'], r['content_type'], bool(r['deleted']), op,
                     None if (r['kind'] == 'blob' or r['deleted']) else body, r.get('blob_sha')))
        keep = KEEP_LARGE if (r['size'] or 0) > LARGE else KEEP
        cur.execute('SELECT rev, blob_sha FROM history WHERE ns=%s AND path=%s ORDER BY rev DESC OFFSET %s', (r['ns'], r['path'], keep))
        old = cur.fetchall()
        if old:
            cur.execute('DELETE FROM history WHERE ns=%s AND path=%s AND rev <= %s', (r['ns'], r['path'], old[0]['rev']))
            for o in old:
                if o['blob_sha']:
                    self._gc_blob(cur, o['blob_sha'])

    def _gc_blob(self, cur, digest: str) -> None:
        cur.execute('SELECT 1 FROM keys WHERE blob_sha=%s UNION ALL SELECT 1 FROM history WHERE blob_sha=%s LIMIT 1', (digest, digest))
        if not cur.fetchone():
            cur.execute('DELETE FROM blobs WHERE sha=%s', (digest,))

    def on_mirror(self, run: dict) -> None:
        """Hook for listeners: a SQLite upload was exploded into rows (kept for later listeners)."""

    def history(self, ns: str, path: str) -> dict:
        rows = self.st.fetchall('SELECT rev, etag, at, actor AS by, size, content_type, deleted, op FROM history WHERE ns=%s AND path=%s ORDER BY rev DESC', (ns, path))
        if not rows and not self.st._row(ns, path):  # noqa: SLF001
            raise DataError('not_found', f'{ns}/{path} has no history', ns=ns, path=path)
        return {'$axf': 'data-history@1', 'ns': ns, 'path': path,
                'revs': [{'rev': r['rev'], 'etag': r['etag'], 'at': r['at'], 'by': r['by'], 'size': r['size'], 'contentType': r['content_type'], 'deleted': bool(r['deleted']), 'op': r['op']} for r in rows]}

    def one(self, ns: str, path: str, rev: int) -> dict:
        r = self.st.fetchone('SELECT ns, path, rev, etag, at, actor AS by, size, content_type, deleted, op, body, blob_sha FROM history WHERE ns=%s AND path=%s AND rev=%s', (ns, path, rev))
        if not r:
            raise DataError('not_found', f'{ns}/{path} rev {rev} is not in the history (kept: the newest {KEEP})', ns=ns, path=path, rev=rev)
        return dict(r)

    def body(self, h: dict) -> bytes | None:
        if h['deleted']:
            return None
        if h.get('blob_sha'):
            return self.st.blob_bytes(h['blob_sha'])
        return bytes(h['body']) if h.get('body') is not None else None

    def restore(self, ns: str, path: str, rev: int, caller: Caller, if_match: str = '') -> dict:
        h = self.one(ns, path, rev)
        data = self.body(h)
        if data is None:
            raise DataError('invalid_body', f'{ns}/{path} rev {rev} is a delete: nothing to restore', ns=ns, path=path, rev=rev)
        with self.st.lock:
            cur = self.st._row(ns, path)  # noqa: SLF001
            live = bool(cur and not cur['deleted'])
            if not if_match:
                if_match = cur['etag'] if live else ''
            return self.st.put(ns, path, data, h['content_type'], caller, if_match=if_match, create=not live)


def _tar_add(tar: tarfile.TarFile, name: str, data: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mtime = int(time.time())
    tar.addfile(info, io.BytesIO(data))
