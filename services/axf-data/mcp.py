"""axf-data MCP tools (POST /mcp): what axHub proxies as a downstream, so notes, builds and settings tools work with the
console down.

Brett, Nov 15 2026: "the console goes down, all the data is still available, all the notes are available, and the
builds keep running. That's what I need."

Streamable HTTP, JSON answers (MCP 2025-06-18): initialize, notifications/initialized, tools/list, tools/call. Every
call carries the caller's data token (axHub sends its own service token, kept in axHub: conf/env/axhub.env), and every
tool runs with that token's grants, so the hub sees exactly what its grants allow. axHub stores nothing: it routes.

Tools (axHub shows them under its downstream prefix, e.g. `data.notes_list`):
  data_status                      reachable, cursor, keys per namespace, last backup + verify
  notes_list {folder?}             notes (path, size, rev, at)
  note_read {path}                 a note's text and its etag
  note_write {path, text, etag?}   write a note (etag from note_read = only if nobody changed it since; none = create)
  builds_list {status?, limit?}    builds from the builds store (id, title, status, steps done / total, PR)
  build_get {id}                   one build as stored
  build_note {id, text}            add a note to a build (store rev check + one journal line)
  settings_get {path}              a settings document (settings/<path>)
  settings_set {path, value, etag?}  write a settings document; Claude settings (claude/…) are refused here: their
                                   owner-only keys change only with Brett's own click in the console
  data_get {key} · data_list {ns, prefix?} · data_append {key, entries}   the raw data-store@1 operations
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import Request
from fastapi.responses import JSONResponse, Response

from store import Caller, DataError, canonical, parse_key

PROTOCOL = '2025-06-18'


def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {'type': 'object', 'properties': props, 'required': required or [], 'additionalProperties': False}


S = {'type': 'string'}
TOOLS: list[dict] = [
    {'name': 'data_status', 'description': 'axf-data: reachable, change cursor, keys per namespace, last backup and its verify result.', 'inputSchema': _obj({}), 'annotations': {'readOnlyHint': True}},
    {'name': 'notes_list', 'description': "Brett's notes on axf-data (path, size, rev, when). Optional folder (e.g. handoffs).", 'inputSchema': _obj({'folder': S}), 'annotations': {'readOnlyHint': True}},
    {'name': 'note_read', 'description': 'Read one note (Markdown) and its etag.', 'inputSchema': _obj({'path': S}, ['path']), 'annotations': {'readOnlyHint': True}},
    {'name': 'note_write', 'description': 'Write a note. Pass the etag from note_read to change it only if nobody else did since; without one the note must be new.', 'inputSchema': _obj({'path': S, 'text': S, 'etag': S}, ['path', 'text'])},
    {'name': 'builds_list', 'description': 'Builds from the builds store: id, title, status, steps done / total, PR. Optional status filter and limit (default 50).', 'inputSchema': _obj({'status': S, 'limit': {'type': 'integer', 'minimum': 1, 'maximum': 500}}), 'annotations': {'readOnlyHint': True}},
    {'name': 'build_get', 'description': 'One build as stored (builds@1 record).', 'inputSchema': _obj({'id': S}, ['id']), 'annotations': {'readOnlyHint': True}},
    {'name': 'build_note', 'description': "Add a note to a build in the builds store (rev-checked, journalled): keeps builds' notes flowing with the console down.", 'inputSchema': _obj({'id': S, 'text': S}, ['id', 'text'])},
    {'name': 'settings_get', 'description': 'A settings document (path under settings/, e.g. claude/settings.json).', 'inputSchema': _obj({'path': S}, ['path']), 'annotations': {'readOnlyHint': True}},
    {'name': 'settings_set', 'description': "Write a settings document (path under settings/). Claude settings (claude/…) are refused: their owner-only keys change only with Brett's click in the console.", 'inputSchema': _obj({'path': S, 'value': {'type': 'object'}, 'etag': S}, ['path', 'value'])},
    {'name': 'data_get', 'description': 'Read any key (namespace/path) the token may read. Records come back as JSON, blobs as text when they are text.', 'inputSchema': _obj({'key': S}, ['key']), 'annotations': {'readOnlyHint': True}},
    {'name': 'data_list', 'description': 'List a namespace (optionally under a prefix).', 'inputSchema': _obj({'ns': S, 'prefix': S}, ['ns']), 'annotations': {'readOnlyHint': True}},
    {'name': 'data_append', 'description': 'Append entries to a journal key (append-only).', 'inputSchema': _obj({'key': S, 'entries': {'type': 'array', 'items': {'type': 'object'}}}, ['key', 'entries'])},
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


class Tools:
    def __init__(self, st, principal, health: Callable[[], dict]):
        self.st, self.p, self.health = st, principal, health
        self.caller = Caller(principal.sub)

    def _get_json(self, ns: str, path: str) -> tuple[Any, dict] | None:
        self.p.need('get', ns, path)
        try:
            r, body = self.st.get(ns, path)
        except DataError as e:
            if e.code == 'not_found':
                return None
            raise
        return (json.loads(body) if r['kind'] == 'record' else body), r

    def data_status(self) -> dict:
        out = {'health': self.health()}
        if self.p.allows('read', '_meta'):
            out['counts'] = self.st.counts()
        return out

    def notes_list(self, folder: str = '') -> dict:
        prefix = f"{folder.strip('/')}/" if folder else ''
        self.p.need('list', 'notes', prefix.rstrip('/'))
        r = self.st.list('notes', prefix)
        return {'notes': [{'path': i['path'], 'size': i['size'], 'rev': i['rev'], 'at': i['at']} for i in r['items'] if i['kind'] == 'blob' and not i['path'].startswith('_')]}

    def note_read(self, path: str) -> dict:
        ns, p = parse_key(f'notes/{path}')
        got = self._get_json(ns, p)
        if not got:
            raise DataError('not_found', f'no note {path}', ns=ns, path=p)
        body, r = got
        return {'path': path, 'text': body.decode('utf-8', 'replace'), 'etag': r['etag'], 'rev': r['rev'], 'at': r['at'], 'by': r['by']}

    def note_write(self, path: str, text: str, etag: str = '') -> dict:
        ns, p = parse_key(f'notes/{path}')
        self.p.need('put', ns, p)
        return self.st.put(ns, p, text.encode('utf-8'), 'text/markdown', self.caller, if_match=etag, create=not etag)

    def _store(self) -> tuple[dict, dict]:
        got = self._get_json('builds', 'store.json')
        if not got:
            raise DataError('not_found', 'the builds store is not on axf-data (namespace builds not migrated)', ns='builds', path='store.json')
        return got

    def builds_list(self, status: str = '', limit: int = 50) -> dict:
        doc, r = self._store()
        rows = []
        for b in doc.get('builds', []):
            if b.get('deleted') or (status and b.get('status') != status):
                continue
            steps = b.get('steps') or []
            rows.append({'id': b.get('id'), 'title': b.get('title'), 'status': b.get('status'), 'steps': f"{sum(1 for s in steps if s.get('done'))}/{len(steps)}", 'pr': b.get('pr')})
        return {'rev': doc.get('rev'), 'etag': r['etag'], 'builds': rows[: max(1, min(int(limit or 50), 500))]}

    def build_get(self, id: str) -> dict:
        doc, _ = self._store()
        b = next((x for x in doc.get('builds', []) if x.get('id') == id), None)
        if not b:
            raise DataError('not_found', f'no build {id}')
        return b

    def build_note(self, id: str, text: str) -> dict:
        self.p.need('put', 'builds', 'store.json')
        for _ in range(5):
            doc, r = self._store()
            b = next((x for x in doc.get('builds', []) if x.get('id') == id), None)
            if not b:
                raise DataError('not_found', f'no build {id}')
            at = _now()
            b.setdefault('notes', []).append({'at': at, 'by': self.p.sub, 'text': str(text)[:4000]})
            b['rev'] = int(b.get('rev') or 0) + 1
            doc['rev'] = int(doc.get('rev') or 0) + 1
            doc['updatedAt'] = at
            try:
                self.st.put('builds', 'store.json', canonical(doc).encode('utf-8'), 'application/json', self.caller, if_match=r['etag'])
            except DataError as e:
                if e.code == 'conflict':
                    continue
                raise
            self.st.append('builds', f'journal/{at[:7]}', [{'rev': doc['rev'], 'at': at, 'by': self.p.sub, 'action': 'note', 'note': '', 'builds': [{'id': id, 'op': 'change', 'rev': b['rev'], 'after': b}]}], self.caller)
            return {'id': id, 'rev': doc['rev'], 'notes': len(b['notes'])}
        raise DataError('conflict', 'the builds store kept changing: try again')

    def settings_get(self, path: str) -> dict:
        ns, p = parse_key(f'settings/{path}')
        got = self._get_json(ns, p)
        if not got:
            raise DataError('not_found', f'no settings document {path}')
        return {'path': path, 'value': got[0], 'etag': got[1]['etag']}

    def settings_set(self, path: str, value: dict, etag: str = '') -> dict:
        if path.strip('/').startswith('claude/'):
            raise DataError('forbidden', "Claude settings change only through the console's Claude settings (owner-only keys need Brett's own click)")
        ns, p = parse_key(f'settings/{path}')
        self.p.need('put', ns, p)
        return self.st.put(ns, p, canonical(value).encode('utf-8'), 'application/json', self.caller, if_match=etag, create=not etag)

    def data_get(self, key: str) -> dict:
        ns, p = parse_key(key)
        got = self._get_json(ns, p)
        if not got:
            raise DataError('not_found', f'{key} not found')
        body, r = got
        if isinstance(body, (bytes, bytearray)):
            try:
                body = body.decode('utf-8')
            except UnicodeDecodeError:
                body = f'<{len(body)} bytes, {r["content_type"]}>'
        return {'key': key, 'rev': r['rev'], 'etag': r['etag'], 'data': body}

    def data_list(self, ns: str, prefix: str = '') -> dict:
        head, _, folder = ns.partition('/')
        full = (f'{folder}/' if folder else '') + (prefix or '')
        self.p.need('list', head, full.rstrip('/'))
        return self.st.list(head, full)

    def data_append(self, key: str, entries: list) -> dict:
        ns, p = parse_key(key)
        self.p.need('append', ns, p)
        return self.st.append(ns, p, entries, self.caller)


def mount(app, st, who, health: Callable[[], dict]) -> None:
    @app.post('/mcp')
    async def mcp(req: Request):
        p = who(req)
        try:
            msg = json.loads(await req.body() or b'{}')
        except ValueError:
            return JSONResponse({'jsonrpc': '2.0', 'id': None, 'error': {'code': -32700, 'message': 'parse error'}}, status_code=400)
        mid, method, params = msg.get('id'), msg.get('method'), msg.get('params') or {}
        if mid is None:
            return Response(status_code=202)  # a notification
        if method == 'initialize':
            result = {'protocolVersion': PROTOCOL, 'capabilities': {'tools': {'listChanged': False}}, 'serverInfo': {'name': 'axf-data', 'version': '1'},
                      'instructions': 'Console data held by axf-data (notes, builds, settings, planner, UI reviews, plugin data); works with the console down.'}
        elif method == 'tools/list':
            result = {'tools': TOOLS}
        elif method == 'tools/call':
            name, args = params.get('name'), params.get('arguments') or {}
            t = Tools(st, p, health)
            if name not in {x['name'] for x in TOOLS}:
                return JSONResponse({'jsonrpc': '2.0', 'id': mid, 'error': {'code': -32602, 'message': f'unknown tool {name}'}})
            try:
                out = getattr(t, name)(**args)
                result = {'content': [{'type': 'text', 'text': json.dumps(out, ensure_ascii=False, default=str)}], 'isError': False}
            except DataError as e:
                result = {'content': [{'type': 'text', 'text': json.dumps(e.frame())}], 'isError': True}
            except TypeError as e:
                result = {'content': [{'type': 'text', 'text': f'bad arguments: {e}'}], 'isError': True}
        elif method == 'ping':
            result = {}
        else:
            return JSONResponse({'jsonrpc': '2.0', 'id': mid, 'error': {'code': -32601, 'message': f'unknown method {method}'}})
        return JSONResponse({'jsonrpc': '2.0', 'id': mid, 'result': result})
