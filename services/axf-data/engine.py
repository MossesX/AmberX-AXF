"""Which engine axf-data runs on, and the staged move from SQLite to Postgres inside the service.

  AXF_DATA_DSN unset                 SQLite (store.py), as before
  AXF_DATA_DSN set                   Postgres (pg.py) — a fresh install goes straight here
  both, with an existing SQLite store  the move is staged, like a namespace move (data-store-mode@1), but for the whole
                                     store and inside this process:

    sqlite ──start-shadow──▶ shadow ──cut-over──▶ postgres
      ▲                        │                     │
      └──────back-to-sqlite────┘◀────roll-back───────┘

  sqlite    reads and writes go to SQLite only
  shadow    reads from SQLite; every put / delete / append also lands on Postgres with the same precondition, and any
            difference (an error, another rev or etag) is a data-drift@1 line in <data>/engine-drift.jsonl
  postgres  Postgres only (the SQLite file stays on the volume as the read-only copy until it is removed by hand)

The mode is <data>/engine.json (`{ mode, since, by, drift, lastDriftAt }`), set at install (deploy/install-data.sh:
migrate_pg.py first, then shadow) and changed with POST /v1/_meta/engine { mode } (admin): start-shadow needs the two
stores' counts equal, cut-over needs shadow with zero drift since it started (or acceptDrift), back-to-sqlite and roll-back
are always allowed. `GET /v1/_meta/engine` reads it; the health frame carries `engine`.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

from store import Caller, DataError, Store, now_iso

MODES = ('sqlite', 'shadow', 'postgres')
MOVES = {('sqlite', 'shadow'): 'start-shadow', ('shadow', 'postgres'): 'cut-over', ('shadow', 'sqlite'): 'back-to-sqlite', ('postgres', 'shadow'): 'roll-back'}


def open_store(data_dir: str | os.PathLike, dsn: str = '', mode: str = '', schema: str = 'public'):
    """The engine for this process. `mode` (AXF_DATA_ENGINE) only matters when both stores are configured."""
    dsn = dsn or os.environ.get('AXF_DATA_DSN', '')
    if not dsn:
        return Store(data_dir)
    from pg import PgStore
    pg = PgStore(dsn, data_dir, schema=schema if schema != 'public' else os.environ.get('AXF_DATA_PG_SCHEMA', 'public'))
    state = EngineState(Path(data_dir))
    want = mode or os.environ.get('AXF_DATA_ENGINE', '') or state.read().get('mode') or ''
    sqlite_file = Path(data_dir) / 'axf-data.sqlite'
    if not want:
        want = 'shadow' if sqlite_file.is_file() else 'postgres'
    if want not in MODES:
        raise RuntimeError(f'AXF_DATA_ENGINE must be one of {", ".join(MODES)}, not {want!r}')
    if want == 'postgres' and not sqlite_file.is_file():
        state.write(mode='postgres', by='svc:boot')
        return pg
    return EngineStore(Store(data_dir), pg, state, want)


class EngineState:
    def __init__(self, data_dir: Path):
        self.file = data_dir / 'engine.json'
        self.lock = threading.Lock()

    def read(self) -> dict:
        try:
            return json.loads(self.file.read_text('utf-8'))
        except (OSError, ValueError):
            return {}

    def write(self, **fields: Any) -> dict:
        with self.lock:
            doc = {'$axf': 'data-engine@1', **self.read()}
            doc.update(fields)
            doc.setdefault('since', now_iso())
            doc.setdefault('drift', 0)
            doc.setdefault('lastDriftAt', '')
            tmp = self.file.with_suffix('.json.tmp')
            tmp.write_text(json.dumps(doc, indent=1), 'utf-8')
            os.replace(tmp, self.file)
            return doc


class EngineStore:
    """SQLite and Postgres behind one Store API; reads and writes route by mode (see the module doc)."""

    def __init__(self, sqlite: Store, pg, state: EngineState, mode: str):
        self.sqlite, self.pg, self.state = sqlite, pg, state
        self.mode = mode
        cur = state.read()
        if cur.get('mode') != mode:
            state.write(mode=mode, since=now_iso(), by='svc:boot', drift=0, lastDriftAt='')
        self.drift_file = sqlite.dir / 'engine-drift.jsonl'
        self.dlock = threading.Lock()
        self.journal = _JournalFacade(self)
        self.hooks = [self.journal]

    # ── routing ──
    @property
    def primary(self):
        return self.pg if self.mode == 'postgres' else self.sqlite

    @property
    def mirror(self):
        return self.pg if self.mode == 'shadow' else None

    def __getattr__(self, name: str):
        # everything not routed here (lock, dir, db, _row, _commit_row, get, list, read, changes, manifest, counts…) goes
        # to the engine reads come from right now
        if name in ('sqlite', 'pg', 'state', 'mode'):
            raise AttributeError(name)
        return getattr(self.primary, name)

    @property
    def engine(self) -> str:
        return self.mode

    # ── writes: primary first, then the mirror with the same precondition ──
    def put(self, ns, path, body, content_type, caller, if_match='', create=False, force=False):
        out = self.primary.put(ns, path, body, content_type, caller, if_match=if_match, create=create, force=force)
        m = self.mirror
        if m:
            self._mirror('write', f'{ns}/{path}', out, lambda: m.put(ns, path, body, content_type, caller, if_match=if_match, create=create, force=force))
        return out

    def delete(self, ns, path, caller, if_match='', force=False):
        out = self.primary.delete(ns, path, caller, if_match=if_match, force=force)
        m = self.mirror
        if m:
            self._mirror('write', f'{ns}/{path}', out, lambda: m.delete(ns, path, caller, if_match=if_match, force=force))
        return out

    def append(self, ns, path, entries, caller, idempotency_key=''):
        out = self.primary.append(ns, path, entries, caller, idempotency_key=idempotency_key)
        m = self.mirror
        if m:
            self._mirror('append', f'{ns}/{path}', out, lambda: m.append(ns, path, entries, caller, idempotency_key=idempotency_key))
        return out

    def patch(self, ns, path, body, caller):
        out = self.primary.patch(ns, path, body, caller)
        m = self.mirror
        if m:
            self._mirror('write', f'{ns}/{path}', out, lambda: m.patch(ns, path, body, caller))
        return out

    def snapshot(self, namespaces, caller, mode=''):
        out = self.primary.snapshot(namespaces, caller, mode=mode)
        m = self.mirror
        if m:
            self._mirror('write', '_meta/manifests', out, lambda: m.snapshot(namespaces, caller, mode=mode))
        return out

    def _mirror(self, op: str, key: str, local: dict, fn) -> None:
        try:
            remote = fn()
        except DataError as e:
            self._drift(op, key, f'{op}-failed', local, None, f'{e.code}: {e.message}')
            return
        except Exception as e:  # noqa: BLE001 — a mirror failure is drift, never an error for the caller
            self._drift(op, key, f'{op}-failed', local, None, f'{type(e).__name__}: {e}')
            return
        a, b = _compare_fields(local), _compare_fields(remote)
        if a != b:
            self._drift(op, key, 'etag' if op == 'write' else 'entries', a, b, '')

    def _drift(self, op: str, key: str, kind: str, local: Any, remote: Any, error: str) -> None:
        line = {'$axf': 'data-drift@1', 'at': now_iso(), 'op': op, 'key': key, 'kind': kind, 'local': local, 'remote': remote}
        if error:
            line['error'] = error
        with self.dlock:
            with open(self.drift_file, 'a', encoding='utf-8') as f:
                f.write(json.dumps(line, separators=(',', ':')) + '\n')
            doc = self.state.read()
            self.state.write(drift=int(doc.get('drift') or 0) + 1, lastDriftAt=line['at'])

    def drift_tail(self, n: int = 50) -> list[dict]:
        try:
            lines = self.drift_file.read_text('utf-8').splitlines()
        except OSError:
            return []
        return [json.loads(x) for x in lines[-max(1, n):] if x.strip()]

    # ── state ──
    def engine_state(self) -> dict:
        doc = self.state.read()
        counts = {'sqlite': self.sqlite.counts()}
        try:
            counts['postgres'] = self.pg.counts()
        except Exception as e:  # noqa: BLE001
            counts['postgres'] = {'error': f'{type(e).__name__}: {e}'[:200]}
        same = counts['sqlite'] == counts['postgres']
        nxt = {'sqlite': 'start-shadow' if same else 'migrate (counts differ: python migrate_pg.py)',
               'shadow': 'cut-over' if not doc.get('drift') else f"read the drift ({doc.get('drift')} lines) and cut over with acceptDrift, or roll back to sqlite",
               'postgres': 'done'}[self.mode]
        return {'$axf': 'data-engine@1', 'mode': self.mode, 'since': doc.get('since', ''), 'by': doc.get('by', ''), 'drift': int(doc.get('drift') or 0),
                'lastDriftAt': doc.get('lastDriftAt', ''), 'counts': counts, 'countsEqual': same, 'next': nxt, 'moves': [MOVES[k] for k in MOVES if k[0] == self.mode],
                'drift_tail': self.drift_tail(10)}

    def set_mode(self, to: str, caller: Caller, accept_drift: bool = False) -> dict:
        if to not in MODES:
            raise DataError('invalid_body', f'mode must be one of {", ".join(MODES)}')
        if to == self.mode:
            return self.engine_state()
        move = MOVES.get((self.mode, to))
        if not move:
            raise DataError('invalid_body', f'{self.mode} → {to} is not a move: shadow first')
        doc = self.state.read()
        if move == 'start-shadow':
            a, b = self.sqlite.counts(), self.pg.counts()
            if a != b:
                raise DataError('invalid_body', f'counts differ (sqlite {sum(a.values())} keys, postgres {sum(b.values())}): run migrate_pg.py first')
        if move == 'cut-over' and int(doc.get('drift') or 0) and not accept_drift:
            raise DataError('invalid_body', f"{doc.get('drift')} drift lines since shadow started: read them (GET /v1/_meta/engine) and pass acceptDrift, or roll back")
        self.mode = to
        self.state.write(mode=to, since=now_iso(), by=caller.by, drift=0, lastDriftAt='', move=move)
        return self.engine_state()

    def health(self, keys: dict | None = None) -> dict:
        h = self.primary.health(keys)
        doc = self.state.read()
        h['engine'] = {**(h.get('engine') or {'kind': 'sqlite'}), 'mode': self.mode, 'drift': int(doc.get('drift') or 0), 'since': doc.get('since', '')}
        return h

    def tables(self) -> dict:
        t = self.pg.tables()
        t['engine'] = self.mode
        return t


class _JournalFacade:
    """What main.py mounts: watch polls whichever engine reads come from; history reads it; restore writes through the
    engine so a shadow mirror sees it too."""

    def __init__(self, eng: EngineStore):
        self.eng = eng
        from journal import Journal
        self._watch = Journal(eng)  # its mount() only uses st.changes (dynamic through the engine) and the limits

    def mount(self, app, who) -> None:
        self._watch.mount(app, who)

    def route(self, req, p, ns: str, path: str, action: str, caller: Caller):
        j = self.eng.primary.journal
        if action == 'restore' and req.method == 'POST':
            p.need('restore', ns, path)
            return self._restore(req, j, ns, path, caller)
        return j.route(req, p, ns, path, action, caller)

    async def _restore(self, req, j, ns: str, path: str, caller: Caller):
        raw = await req.body()
        try:
            body = json.loads(raw) if raw else {}
            rev = int(body.get('rev'))
        except (ValueError, TypeError) as e:
            raise DataError('invalid_body', 'restore needs { "rev": <n> }', ns=ns, path=path) from e
        h = j.one(ns, path, rev)
        data = j.body(h)
        if data is None:
            raise DataError('invalid_body', f'{ns}/{path} rev {rev} is a delete: nothing to restore', ns=ns, path=path, rev=rev)
        if_match = req.headers.get('if-match') or ''
        with self.eng.lock:
            cur = self.eng._row(ns, path)  # noqa: SLF001
            live = bool(cur and not cur['deleted'])
            if not if_match:
                if_match = cur['etag'] if live else ''
            return self.eng.put(ns, path, data, h['content_type'], caller, if_match=if_match, create=not live)


def _compare_fields(d: Any) -> Any:
    if not isinstance(d, dict):
        return d
    if isinstance(d.get('record'), dict):  # data-patch@1: the record frame carries the rev / etag
        d = d['record']
    return {k: d[k] for k in ('rev', 'etag', 'deleted', 'first', 'last', 'count', 'id') if k in d}
