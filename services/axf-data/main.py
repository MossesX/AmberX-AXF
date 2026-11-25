"""axf-data: the container that holds all console data (data-store@1 over HTTP).

Brett, Nov 15 2026: "the console goes down, all the data is still available, all the notes are available, and the
builds keep running. That's what I need."

Routes (base /v1, spec framework/spec/DATA-STORE.md → Operations):
  GET    /v1/health                         no token (internal network only)
  GET    /v1/<key>                          body + ETag / X-Axf-* headers; ?frame=1 data-record@1 with data; ?meta=1 without
  GET    /v1/<key>?since=|tail=             a journal's entries (data-entries@1)
  PUT    /v1/<key>                          If-Match <etag|rev> | If-None-Match: * | ?force=1 (blobs)
  DELETE /v1/<key>                          same preconditions; leaves a tombstone
  GET    /v1/<ns>                           data-list@1 (?prefix= &after= &limit= &deleted=1); `plugins/<folder>` too
  POST   /v1/<key>:append                   { entries } ; Idempotency-Key
  GET    /v1/<key>:summary                  pipeline-summary@1: counts by status, the queued build, running builds (builds/store.json)
  GET    /v1/<key>:item?key=<id>            data-item@1: one row of a keyed list by its key (one build), no document read
  POST   /v1/<key>:patch                    data-patch@1: { head?, lists: { <list>: [{ key, ifRev?, item }] }, journal? } on a
                                            table-backed record (the builds store): only the named rows are locked and rewritten
  GET    /v1/<ns>:manifest                  one namespace of data-manifest@1
  POST   /v1/snapshot                       { namespaces?, mode? } → data-manifest@1 + snapshots/<id>.tar
  GET    /v1/snapshot/<id> | <id>.tar       the manifest | the archive
  GET    /v1/watch?ns=&prefix=&since=       SSE of data-change@1 (journal.py); ?poll=1 answers JSON once
  GET    /v1/<key>:history · POST /v1/<key>:restore   per-key history (journal.py)
  DELETE /v1/_meta/tokens/<jti>             revoke a token (admin)
  POST   /mcp                               MCP tools (mcp.py): what axHub proxies as a downstream
  GET    /v1/_meta/counts                   live keys per namespace (backup verify; read on `_meta`)
  GET    /v1/_meta/backup                   last backup + verify result, kept files, the running job
  POST   /v1/_meta/backup  { verify? }      back up now (or re-verify the newest) in the background (write on `_meta/backup`)
  GET    /v1/_meta/tables                   data-tables@1: the Postgres tables, rows and bytes, the SQLite mirrors (read on `_meta`)
  POST   /v1/_meta/tables/sync { source }   mirror a SQLite file the console writes (AXF_DATA_MIRROR_DIR) into rows, in the background
  GET    /v1/_meta/engine                   data-engine@1: sqlite | shadow | postgres, drift, counts on both sides, the next move
  POST   /v1/_meta/engine { mode, acceptDrift? }   move the engine (admin): sqlite → shadow → postgres, back, or roll back to shadow

Engine: AXF_DATA_DSN set → Postgres (pg.py, real tables); unset → SQLite (store.py); both with an existing SQLite store →
staged move (engine.py). Run: uvicorn main:app --host 0.0.0.0 --port 7700 (one worker: writes serialise in-process).
"""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from auth import Auth, Principal
from engine import open_store
from store import Caller, DataError, Store, parse_key, parse_namespace

DATA_DIR = Path(os.environ.get('AXF_DATA_DIR', '/data'))
PORT = int(os.environ.get('AXF_DATA_PORT', '7700'))


def create_app(data_dir: Path | str = DATA_DIR, store: Store | None = None) -> FastAPI:
    st = store or open_store(data_dir)
    auth = Auth(Path(data_dir), revoked=lambda jti: _revoked(st, jti))
    app = FastAPI(title='axf-data', version='1', docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store = st
    app.state.auth = auth

    @app.exception_handler(DataError)
    async def _data_error(_req: Request, e: DataError):
        return JSONResponse(e.frame(), status_code=e.status)

    @app.exception_handler(Exception)
    async def _internal(_req: Request, e: Exception):  # pragma: no cover - last resort
        return JSONResponse(DataError('internal', f'{type(e).__name__}: {e}').frame(), status_code=500)

    def who(req: Request) -> Principal:
        return auth.principal(req.headers.get('authorization'), req.headers.get('x-axf-actor'))

    @app.get('/v1/health')
    def health():
        return st.health(auth.health())

    st.journal.mount(app, who)
    import mcp as mcp_tools
    mcp_tools.mount(app, st, who, lambda: st.health(auth.health()))

    @app.post('/v1/snapshot')
    async def snapshot(req: Request):
        p = who(req)
        p.need('snapshot', '_meta')
        body = await _json(req)
        nss = body.get('namespaces') or []
        for n in nss:
            parse_namespace(n)
        return st.snapshot(nss, Caller(p.sub), mode=str(body.get('mode') or ''))

    @app.get('/v1/snapshot/{sid}')
    def snapshot_get(sid: str, req: Request):
        p = who(req)
        p.need('read', '_meta')
        if sid.endswith('.tar'):
            return FileResponse(st.snapshot_tar(sid[:-4]), media_type='application/x-tar', filename=sid)
        r, body = st.get('_meta', f'manifests/{sid}')
        return Response(body, media_type='application/json')

    @app.get('/v1/_meta/counts')
    def counts(req: Request):
        who(req).need('read', '_meta')
        return {'$axf': 'data-counts@1', 'counts': st.counts(), 'cursor': st.health()['cursor']}

    @app.get('/v1/_meta/backup')
    def backup_state(req: Request):
        who(req).need('read', '_meta')
        return _backup_state()

    @app.post('/v1/_meta/backup')
    async def backup_now(req: Request):
        p = who(req)
        p.need('put', '_meta', 'backup')
        body = await _json(req)
        return _backup_start('verify' if body.get('verify') else 'run', p.sub, st)

    @app.get('/v1/_meta/tables')
    def tables(req: Request):
        who(req).need('read', '_meta')
        pg = _pg_of(st)
        if not pg:
            return {'$axf': 'data-tables@1', 'engine': 'sqlite', 'tables': [], 'mirrors': [], 'note': 'SQLite engine: set AXF_DATA_DSN for Postgres tables'}
        return st.tables() if hasattr(st, 'tables') else pg.tables()

    @app.post('/v1/_meta/tables/sync')
    async def tables_sync(req: Request):
        p = who(req)
        p.need('put', '_meta', 'tables')
        body = await _json(req)
        pg = _pg_of(st)
        if not pg:
            raise DataError('invalid_body', 'the SQLite engine has no tables to mirror into: set AXF_DATA_DSN')
        return _mirror_start(pg, str(body.get('source') or ''), p.sub)

    @app.get('/v1/_meta/engine')
    def engine_get(req: Request):
        who(req).need('read', '_meta')
        return _engine_state(st)

    @app.post('/v1/_meta/engine')
    async def engine_set(req: Request):
        p = who(req)
        p.need('put', '_meta', 'engine')  # write on _meta, like a namespace move: the console's token may run it, a reader may not
        body = await _json(req)
        if not hasattr(st, 'set_mode'):
            raise DataError('invalid_body', f"this axf-data runs on {_engine_state(st)['mode']} only: there is no second store to move to (AXF_DATA_DSN + a SQLite file on the volume make the staged move)")
        return st.set_mode(str(body.get('mode') or ''), Caller(p.sub), accept_drift=bool(body.get('acceptDrift')))

    @app.delete('/v1/_meta/tokens/{jti}')
    def revoke(jti: str, req: Request):
        p = who(req)
        p.need('admin', '_meta')
        return _revoke(st, jti, p.sub)

    @app.api_route('/v1/{rest:path}', methods=['GET', 'PUT', 'DELETE', 'POST'])
    async def data(rest: str, req: Request):
        p = who(req)
        q = req.query_params
        action = ''
        if ':' in rest.rsplit('/', 1)[-1]:
            rest, action = rest.rsplit(':', 1)
        # a namespace (list / manifest) or a key
        is_ns = True
        try:
            head, prefix = parse_namespace(rest)
        except DataError:
            is_ns = False
        if is_ns:
            if req.method != 'GET' or action not in ('', 'manifest'):
                raise DataError('invalid_key', f'{req.method} {rest}{":" + action if action else ""}: a namespace is listed or has a manifest')
            if action == 'manifest':
                p.need('manifest', head, prefix.rstrip('/'))
                return st.manifest(rest)
            full = prefix + (q.get('prefix') or '')
            p.need('list', head, full.rstrip('/'))
            return st.list(head, full, q.get('after') or '', _int(q.get('limit')), q.get('deleted') == '1')
        ns, path = parse_key(rest)
        caller = Caller(p.sub)
        for hook in st.hooks:
            handled = hook.route(req, p, ns, path, action, caller) if hasattr(hook, 'route') else None
            if handled is not None:
                return await handled if hasattr(handled, '__await__') else handled
        if action == 'append' and req.method == 'POST':
            p.need('append', ns, path)
            body = await _json(req)
            entries = body.get('entries') if isinstance(body, dict) else None
            return st.append(ns, path, entries, caller, req.headers.get('idempotency-key') or '')
        if action == 'patch' and req.method == 'POST':
            # data-patch@1: some rows of a keyed list (the builds store's builds), the head fields given and one journal
            # line in one transaction; only the named rows are locked (pg.py PgStore.patch, store.py the document twin)
            p.need('put', ns, path)
            body = await _json(req)
            if isinstance(body, dict) and isinstance(body.get('journal'), dict):
                p.need('append', ns, str(body['journal'].get('path') or ''))
            return st.patch(ns, path, body, caller)
        if action == 'summary' and req.method == 'GET':
            # pipeline-summary@1: counts by status, the queued build, the running builds, computed from the rows
            p.need('get', ns, path)
            return st.summary(ns, path, q.get('list') or 'builds')
        if action == 'item' and req.method == 'GET':
            # data-item@1: one row of a keyed list by its key (one build by id); its update is :patch with ifRev
            p.need('get', ns, path)
            return st.item(ns, path, q.get('key') or '', q.get('list') or 'builds')
        if action:
            raise DataError('invalid_key', f'unknown action :{action}', ns=ns, path=path)
        if req.method == 'GET':
            p.need('get', ns, path)
            if any(k in q for k in ('since', 'tail', 'limit')):
                return st.read(ns, path, _int(q.get('since')), _int(q.get('limit')), _int(q.get('tail')))
            r, body = st.get(ns, path, q.get('deleted') == '1')
            if q.get('frame') == '1' or q.get('meta') == '1':
                f = _frame(r)
                if q.get('frame') == '1' and body is not None:
                    f['data'] = json.loads(body) if r['kind'] == 'record' else base64.b64encode(body).decode('ascii')
                return f
            inm = (req.headers.get('if-none-match') or '').strip('"')
            # A row the shadow mirror is still writing may lack a field: headers carry '' then, never None (a 500).
            headers = {'ETag': f'"{r["etag"] or ""}"', 'X-Axf-Rev': str(r['rev'] or 0), 'X-Axf-At': r['at'] or '', 'X-Axf-By': r['by'] or '',
                       'X-Axf-Kind': r['kind'] or '', 'X-Axf-Deleted': '1' if r['deleted'] else '0'}
            if inm and inm == r['etag']:
                return Response(status_code=304, headers=headers)
            return Response(body or b'', media_type=r['content_type'] or 'application/octet-stream', headers=headers)
        if req.method == 'PUT':
            p.need('put', ns, path)
            body = await req.body()
            return st.put(ns, path, body, req.headers.get('content-type') or '', caller,
                          if_match=req.headers.get('if-match') or '', create=(req.headers.get('if-none-match') or '').strip() == '*',
                          force=q.get('force') == '1')
        if req.method == 'DELETE':
            p.need('delete', ns, path)
            return st.delete(ns, path, caller, if_match=req.headers.get('if-match') or '', force=q.get('force') == '1')
        raise DataError('invalid_key', f'{req.method} is not an operation on a key', ns=ns, path=path)

    return app


def _frame(r: dict) -> dict:
    return {'$axf': 'data-record@1', 'ns': r['ns'], 'path': r['path'], 'kind': r['kind'], 'rev': r['rev'], 'etag': r['etag'], 'at': r['at'],
            'by': r['by'], 'size': r['size'], 'contentType': r['content_type'], 'deleted': bool(r['deleted'])}


def _int(v) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


async def _json(req: Request):
    raw = await req.body()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except ValueError as e:
        raise DataError('invalid_body', f'not JSON ({e})') from e


def _backups() -> Path:
    return Path(os.environ.get('AXF_DATA_BACKUPS', '/backups'))


_backup_job: dict = {'state': 'idle'}


def _backup_state() -> dict:
    import backup
    out = _backups()
    last = out / 'last.json'
    try:
        last_doc = json.loads(last.read_text('utf-8')) if last.is_file() else None
    except (OSError, ValueError):  # an older writer mid-write: report no last backup rather than a 500
        last_doc = None
    return {'$axf': 'data-backups@1', 'dir': str(out), 'last': last_doc,
            'kept': [{'file': p.name, 'bytes': p.stat().st_size} for p in backup.backups(out)] if out.is_dir() else [],
            'job': dict(_backup_job)}


def _backup_start(kind: str, by: str, st) -> dict:
    """Backup now / Verify (Settings → Plugins → Data store, `axf data backup`): one job at a time, in a thread.
    The engine reads come from is the one backed up: pg_dump on Postgres, the online copy on SQLite (and in shadow)."""
    import threading
    import backup
    from store import now_iso
    out = _backups()
    data = Path(st.dir)
    pg = _pg_of(st)
    dsn, schema = '', ''
    if pg and _engine_state(st)['mode'] == 'postgres':
        from pg import _dsn_with_schema
        dsn, schema = _dsn_with_schema(pg.dsn, pg.schema), pg.schema
    if _backup_job.get('state') == 'running':
        return {'$axf': 'data-backup-job@1', **_backup_job}

    def work():
        try:
            if kind == 'run':
                r = backup.run(data, out, dsn=dsn, schema=schema)
                _backup_job.update(state='done', ok=bool(r['verify']['ok']), file=r['file'], finishedAt=now_iso())
            else:
                f = (backup.backups(out) or [None])[0]
                if not f:
                    raise RuntimeError('no backups yet')
                r = backup.verify(f, data, dsn=dsn)
                last = out / 'last.json'
                if last.is_file():
                    doc = json.loads(last.read_text('utf-8'))
                    if doc.get('file') == f.name:
                        doc['verify'] = r
                        backup.write_last(out, doc)
                _backup_job.update(state='done', ok=bool(r['ok']), file=f.name, finishedAt=now_iso())
        except BaseException as e:  # noqa: BLE001 — reported on the job (SystemExit included), never raised into the server
            _backup_job.update(state='failed', ok=False, error=f'{type(e).__name__}: {e}'[:300], finishedAt=now_iso())

    _backup_job.clear()
    _backup_job.update(state='running', kind=kind, by=by, startedAt=now_iso())
    threading.Thread(target=work, name=f'axf-data-{kind}', daemon=True).start()
    return {'$axf': 'data-backup-job@1', **_backup_job}


def _pg_of(st):
    """The Postgres store behind `st` (PgStore itself, the EngineStore's pg, or None on SQLite)."""
    if getattr(st, 'engine', '') == 'postgres' and hasattr(st, 'tables') and not hasattr(st, 'set_mode'):
        return st
    return getattr(st, 'pg', None)


def _engine_state(st) -> dict:
    if hasattr(st, 'engine_state'):
        return st.engine_state()
    kind = 'postgres' if _pg_of(st) else 'sqlite'
    return {'$axf': 'data-engine@1', 'mode': kind, 'since': '', 'by': '', 'drift': 0, 'lastDriftAt': '', 'counts': {kind: st.counts()}, 'countsEqual': True,
            'next': 'done', 'moves': [], 'drift_tail': []}


_mirror_job: dict = {'state': 'idle'}


def _mirror_dir() -> Path:
    return Path(os.environ.get('AXF_DATA_MIRROR_DIR', '/mnt/console-plugins'))


def _mirror_start(pg, source: str, by: str) -> dict:
    """Mirror a SQLite file the console still writes (chats.db is bigger than a blob may be) into <prefix>_<table> rows."""
    import threading
    import tables as T
    from store import now_iso
    prefix = pg.mirror_map.get(source)
    if not prefix:
        raise DataError('invalid_body', f'{source or "(none)"} is not a mirrored source: one of {", ".join(sorted(pg.mirror_map))} (AXF_DATA_MIRROR)')
    rel = source.split('/', 1)[1] if source.startswith('plugins/') else source
    file = _mirror_dir() / rel
    if not file.is_file():
        raise DataError('not_found', f'{file} is not mounted into axf-data (AXF_DATA_MIRROR_DIR, deploy/install-data.sh mounts the console plugin folders read-only)')
    if _mirror_job.get('state') == 'running':
        return {'$axf': 'data-mirror-job@1', **_mirror_job}

    def work():
        try:
            # its own connection: a big file copies for a while and must not hold the store's lock
            import psycopg
            from psycopg.rows import dict_row
            from pg import _dsn_with_schema
            with psycopg.connect(_dsn_with_schema(pg.dsn, pg.schema), row_factory=dict_row) as conn:
                with conn.transaction():
                    run = T.mirror_sqlite_file(conn.cursor(), prefix, str(file), source, now_iso())
            _mirror_job.update(state='done', ok=True, tables=run['tables'], finishedAt=now_iso())
        except Exception as e:  # noqa: BLE001 — reported on the job, never raised into the server
            _mirror_job.update(state='failed', ok=False, error=f'{type(e).__name__}: {e}'[:300], finishedAt=now_iso())

    _mirror_job.clear()
    _mirror_job.update(state='running', source=source, prefix=prefix, by=by, startedAt=now_iso())
    threading.Thread(target=work, name=f'axf-data-mirror-{prefix}', daemon=True).start()
    return {'$axf': 'data-mirror-job@1', **_mirror_job}


def _revoked(st: Store, jti: str) -> bool:
    r = st._row('_meta', f'tokens/{jti}')  # noqa: SLF001 (same service)
    return bool(r and r['deleted'])


def _revoke(st: Store, jti: str, by: str) -> dict:
    from store import ZERO16, now_iso
    with st.lock:
        cur = st._row('_meta', f'tokens/{jti}')  # noqa: SLF001
        rev = (cur['rev'] if cur else 0) + 1
        r = {'ns': '_meta', 'path': f'tokens/{jti}', 'kind': 'record', 'rev': rev, 'etag': f'{rev}-{ZERO16}', 'at': now_iso(), 'by': by,
             'size': 0, 'content_type': 'application/json', 'deleted': 1, 'entries': 0, 'body': None, 'blob_sha': None}
        st._commit_row(r, 'delete', prev=cur)  # noqa: SLF001
    return {'$axf': 'data-record@1', 'ns': '_meta', 'path': f'tokens/{jti}', 'rev': rev, 'deleted': True}


app = create_app() if os.environ.get('AXF_DATA_NO_APP') != '1' else None

if __name__ == '__main__':  # pragma: no cover
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=PORT, workers=1)  # noqa: S104 (internal docker network only)
