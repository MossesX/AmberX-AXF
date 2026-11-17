"""axf-data journals, per-key history and the change feed.

- `journal` holds one row per journal line. SQLite triggers refuse every UPDATE and DELETE on it: a journal is
  append-only at the storage level, not only in the API.
- `history` keeps every accepted put / delete of a record or blob (newest AXF_DATA_HISTORY_KEEP revs per key, default
  50; 10 for records over 1 MiB such as the builds store). `GET /v1/<key>:history` lists them, `GET
  /v1/<key>:history?rev=n` reads one, and `POST /v1/<key>:restore { rev }` writes that rev's body back as a new rev (the
  history never rewinds: a restore is one more write, with the usual If-Match check when the caller sends one).
- `GET /v1/watch?ns=a,b&prefix=&since=<cursor>` streams data-change@1 as server-sent events (`event: change`, `id:
  <cursor>`, a `: ping` comment every 15 s); a reconnect sends Last-Event-ID. `?poll=1` answers one JSON page
  `{ changes, cursor }` instead (what the reference client's `watch` polls).
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import threading
from collections import defaultdict

from fastapi import Request
from fastapi.responses import StreamingResponse

from store import NAMESPACES, Caller, DataError

JOURNAL_SQL = """
CREATE TABLE IF NOT EXISTS journal (
  ns TEXT NOT NULL, path TEXT NOT NULL, seq INTEGER NOT NULL, at TEXT NOT NULL, by TEXT NOT NULL, line TEXT NOT NULL,
  PRIMARY KEY (ns, path, seq)
);
CREATE TRIGGER IF NOT EXISTS journal_no_update BEFORE UPDATE ON journal
  BEGIN SELECT RAISE(ABORT, 'journal lines are append-only'); END;
CREATE TRIGGER IF NOT EXISTS journal_no_delete BEFORE DELETE ON journal
  BEGIN SELECT RAISE(ABORT, 'journal lines are append-only'); END;
CREATE TABLE IF NOT EXISTS history (
  ns TEXT NOT NULL, path TEXT NOT NULL, rev INTEGER NOT NULL, etag TEXT NOT NULL, at TEXT NOT NULL, by TEXT NOT NULL,
  size INTEGER NOT NULL, content_type TEXT NOT NULL, deleted INTEGER NOT NULL, op TEXT NOT NULL, body BLOB, blob_sha TEXT,
  PRIMARY KEY (ns, path, rev)
);
"""
KEEP = int(os.environ.get('AXF_DATA_HISTORY_KEEP', '50'))
KEEP_LARGE = int(os.environ.get('AXF_DATA_HISTORY_KEEP_LARGE', '10'))
LARGE = 1 << 20
PING_S = 15.0
POLL_S = 0.5


class Journal:
    def __init__(self, store):
        self.st = store
        self.watchers: dict[str, int] = defaultdict(int)
        self.wlock = threading.Lock()

    # ── hooks the Store calls ──
    def on_row(self, r: dict, op: str, prev: dict | None) -> None:
        if r['ns'] == '_meta' or r['kind'] == 'journal':
            return
        db = self.st.db
        db.execute('INSERT OR REPLACE INTO history (ns, path, rev, etag, at, by, size, content_type, deleted, op, body, blob_sha) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                   (r['ns'], r['path'], r['rev'], r['etag'], r['at'], r['by'], r['size'], r['content_type'], r['deleted'], op, r['body'], r['blob_sha']))
        keep = KEEP_LARGE if (r['size'] or 0) > LARGE else KEEP
        old = db.execute('SELECT rev, blob_sha FROM history WHERE ns=? AND path=? ORDER BY rev DESC LIMIT -1 OFFSET ?', (r['ns'], r['path'], keep)).fetchall()
        if old:
            db.execute('DELETE FROM history WHERE ns=? AND path=? AND rev <= ?', (r['ns'], r['path'], old[0]['rev']))
            for o in old:
                if o['blob_sha']:
                    self._gc_blob(o['blob_sha'])

    def on_change(self, _c: dict) -> None:
        """Watchers poll the feed table; nothing to push here (kept for listeners added later)."""

    def _gc_blob(self, digest: str) -> None:
        db = self.st.db
        used = db.execute('SELECT 1 FROM keys WHERE blob_sha=? UNION ALL SELECT 1 FROM history WHERE blob_sha=? LIMIT 1', (digest, digest)).fetchone()
        if not used:
            try:
                self.st.blob_path(digest).unlink()
            except FileNotFoundError:
                pass

    # ── history + restore ──
    def history(self, ns: str, path: str) -> dict:
        rows = self.st.db.execute('SELECT rev, etag, at, by, size, content_type, deleted, op FROM history WHERE ns=? AND path=? ORDER BY rev DESC', (ns, path)).fetchall()
        if not rows and not self.st._row(ns, path):  # noqa: SLF001
            raise DataError('not_found', f'{ns}/{path} has no history', ns=ns, path=path)
        return {'$axf': 'data-history@1', 'ns': ns, 'path': path,
                'revs': [{'rev': r['rev'], 'etag': r['etag'], 'at': r['at'], 'by': r['by'], 'size': r['size'], 'contentType': r['content_type'], 'deleted': bool(r['deleted']), 'op': r['op']} for r in rows]}

    def one(self, ns: str, path: str, rev: int) -> dict:
        r = self.st.db.execute('SELECT * FROM history WHERE ns=? AND path=? AND rev=?', (ns, path, rev)).fetchone()
        if not r:
            raise DataError('not_found', f'{ns}/{path} rev {rev} is not in the history (kept: the newest {KEEP})', ns=ns, path=path, rev=rev)
        return dict(r)

    def body(self, h: dict) -> bytes | None:
        if h['deleted']:
            return None
        if h['blob_sha']:
            return self.st.blob_path(h['blob_sha']).read_bytes()
        return bytes(h['body']) if h['body'] is not None else None

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

    # ── routes on a key (main.py asks every hook first) ──
    def route(self, req: Request, p, ns: str, path: str, action: str, caller: Caller):
        if action == 'history' and req.method == 'GET':
            p.need('history', ns, path)
            rev = req.query_params.get('rev')
            if not rev:
                return self.history(ns, path)
            h = self.one(ns, path, int(rev))
            out = {'$axf': 'data-record@1', 'ns': ns, 'path': path, 'kind': 'blob' if h['blob_sha'] else 'record', 'rev': h['rev'], 'etag': h['etag'], 'at': h['at'],
                   'by': h['by'], 'size': h['size'], 'contentType': h['content_type'], 'deleted': bool(h['deleted'])}
            b = self.body(h)
            if b is not None:
                out['data'] = json.loads(b) if not h['blob_sha'] else base64.b64encode(b).decode('ascii')
            return out
        if action == 'restore' and req.method == 'POST':
            p.need('restore', ns, path)
            return self._restore_req(req, ns, path, caller)
        return None

    async def _restore_req(self, req: Request, ns: str, path: str, caller: Caller):
        raw = await req.body()
        try:
            body = json.loads(raw) if raw else {}
            rev = int(body.get('rev'))
        except (ValueError, TypeError) as e:
            raise DataError('invalid_body', 'restore needs { "rev": <n> }', ns=ns, path=path) from e
        return self.restore(ns, path, rev, caller, req.headers.get('if-match') or '')

    # ── watch ──
    def mount(self, app, who) -> None:
        st = self.st

        @app.get('/v1/watch')
        async def watch(req: Request):
            p = who(req)
            q = req.query_params
            nss = [s.strip() for s in (q.get('ns') or '').split(',') if s.strip()]
            for n in nss:
                head = n.split('/')[0]
                if head not in NAMESPACES:
                    raise DataError('invalid_key', f'unknown namespace "{n}"', ns=n)
                p.need('watch', head, n[len(head) + 1:])
            if not nss and not p.allows('watch', '*'):
                nss = [s for s in p.grants if s != '*']
            prefix = q.get('prefix') or ''
            since = int(req.headers.get('last-event-id') or q.get('since') or 0)
            visible = lambda c: p.allows('watch', c['ns'], c['path'])  # noqa: E731
            if q.get('poll') == '1':
                r = st.changes(since, nss, prefix, int(q.get('limit') or 0))
                return {'changes': [c for c in r['changes'] if visible(c)], 'cursor': r['cursor']}
            st.changes(since, nss, prefix, 1)  # cursor_expired surfaces before the stream opens
            key = p.jti or p.sub
            with self.wlock:
                if self.watchers[key] >= st_limits()['watchPerToken']:
                    raise DataError('rate_limited', f"{st_limits()['watchPerToken']} watch connections per token", retryAfterMs=5000)
                self.watchers[key] += 1

            async def stream():
                cursor, idle = since, 0.0
                try:
                    yield f'retry: 2000\n: cursor {cursor}\n\n'
                    while not await req.is_disconnected():
                        r = await asyncio.to_thread(st.changes, cursor, nss, prefix, 500)
                        for c in r['changes']:
                            if visible(c):
                                yield f"id: {c['cursor']}\nevent: change\ndata: {json.dumps(c, separators=(',', ':'))}\n\n"
                        cursor = max(cursor, r['cursor'])
                        if r['changes']:
                            idle = 0.0
                            continue
                        await asyncio.sleep(POLL_S)
                        idle += POLL_S
                        if idle >= PING_S:
                            idle = 0.0
                            yield ': ping\n\n'
                finally:
                    with self.wlock:
                        self.watchers[key] -= 1

            return StreamingResponse(stream(), media_type='text/event-stream', headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})


def st_limits() -> dict:
    from store import LIMITS
    return LIMITS


def install(store) -> None:
    store.db.executescript(JOURNAL_SQL)
    store.journal = Journal(store)
    store.hooks.append(store.journal)
