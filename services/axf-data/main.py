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

Run: uvicorn main:app --host 0.0.0.0 --port 7700 (one worker: writes serialise in-process).
"""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from auth import Auth, Principal
from store import Caller, DataError, Store, parse_key, parse_namespace

DATA_DIR = Path(os.environ.get('AXF_DATA_DIR', '/data'))
PORT = int(os.environ.get('AXF_DATA_PORT', '7700'))


def create_app(data_dir: Path | str = DATA_DIR, store: Store | None = None) -> FastAPI:
    st = store or Store(data_dir)
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
        return _backup_start('verify' if body.get('verify') else 'run', p.sub, st.dir)

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
            headers = {'ETag': f'"{r["etag"]}"', 'X-Axf-Rev': str(r['rev']), 'X-Axf-At': r['at'], 'X-Axf-By': r['by'], 'X-Axf-Kind': r['kind'],
                       'X-Axf-Deleted': '1' if r['deleted'] else '0'}
            if inm and inm == r['etag']:
                return Response(status_code=304, headers=headers)
            return Response(body or b'', media_type=r['content_type'], headers=headers)
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
    return {'$axf': 'data-backups@1', 'dir': str(out), 'last': json.loads(last.read_text('utf-8')) if last.is_file() else None,
            'kept': [{'file': p.name, 'bytes': p.stat().st_size} for p in backup.backups(out)] if out.is_dir() else [],
            'job': dict(_backup_job)}


def _backup_start(kind: str, by: str, data: Path) -> dict:
    """Backup now / Verify (Settings → Plugins → Data store, `axf data backup`): one job at a time, in a thread."""
    import threading
    import backup
    from store import now_iso
    out = _backups()
    if _backup_job.get('state') == 'running':
        return {'$axf': 'data-backup-job@1', **_backup_job}

    def work():
        try:
            if kind == 'run':
                r = backup.run(data, out)
                _backup_job.update(state='done', ok=bool(r['verify']['ok']), file=r['file'], finishedAt=now_iso())
            else:
                f = (backup.backups(out) or [None])[0]
                if not f:
                    raise RuntimeError('no backups yet')
                r = backup.verify(f, data)
                last = out / 'last.json'
                if last.is_file():
                    doc = json.loads(last.read_text('utf-8'))
                    if doc.get('file') == f.name:
                        doc['verify'] = r
                        last.write_text(json.dumps(doc, indent=1), 'utf-8')
                _backup_job.update(state='done', ok=bool(r['ok']), file=f.name, finishedAt=now_iso())
        except Exception as e:  # noqa: BLE001 — reported on the job, never raised into the server
            _backup_job.update(state='failed', ok=False, error=f'{type(e).__name__}: {e}'[:300], finishedAt=now_iso())

    _backup_job.clear()
    _backup_job.update(state='running', kind=kind, by=by, startedAt=now_iso())
    threading.Thread(target=work, name=f'axf-data-{kind}', daemon=True).start()
    return {'$axf': 'data-backup-job@1', **_backup_job}


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
