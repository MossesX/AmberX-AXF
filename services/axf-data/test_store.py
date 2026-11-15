#!/usr/bin/env python3
"""axf-data tests: CRUD, rev conflicts, append-only journals, history + restore, watch, snapshots and auth refusal.

    python3 services/axf-data/test_store.py        (stdlib runner; needs fastapi, httpx, cryptography)
    python3 -m pytest services/axf-data/test_store.py

The wire contract itself is replayed from Node too: `node framework/spec/check-data-store.mjs --http <url>`.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
os.environ['AXF_DATA_NO_APP'] = '1'

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from store import REG, canonical, etag_of  # noqa: E402

TOKENS = {
    'admin': ('tok-admin', 'svc:cli', {'*': ['admin']}),
    'console': ('tok-console', 'svc:console', {'builds': ['read', 'write', 'append'], 'notes': ['read', 'write'], 'plugins': ['read', 'write', 'append']}),
    'plugin': ('tok-plugin', 'svc:plugin:ui-notes', {'plugins/ui-notes': ['read', 'write']}),
    'reader': ('tok-reader', 'svc:axhub', {'builds': ['read']}),
}


def make_client(tmp: Path) -> TestClient:
    tf = tmp / 'tokens.json'
    tf.write_text(json.dumps({'tokens': [{'id': k, 'sub': sub, 'sha256': hashlib.sha256(t.encode()).hexdigest(), 'grants': g} for k, (t, sub, g) in TOKENS.items()]}))
    os.environ['AXF_DATA_TOKENS_FILE'] = str(tf)
    os.environ.pop('AXF_DATA_KEYS_URL', None)
    return TestClient(main.create_app(tmp / 'data'))


def H(who: str = 'admin', **extra) -> dict:
    return {'authorization': f'Bearer {TOKENS[who][0]}', **extra}


def J(**extra) -> dict:
    return H(**{'content-type': 'application/json', **extra})


def code(r) -> str:
    return r.json().get('code', 'ok') if r.status_code >= 400 else 'ok'


class Env:
    def __enter__(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.c = make_client(Path(self.tmp.name))
        return self.c

    def __exit__(self, *a):
        self.tmp.cleanup()


# ── CRUD ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_crud_and_frames():
    with Env() as c:
        assert c.get('/v1/health').json()['ok'] is True
        assert c.get('/v1/builds/store.json', headers=H()).status_code == 404
        r = c.put('/v1/builds/store.json', content=json.dumps({'b': 1, 'a': [1.0, 'é']}), headers=J(**{'if-none-match': '*'}))
        assert r.status_code == 200, r.text
        f = r.json()
        assert f['$axf'] == 'data-record@1' and f['rev'] == 1
        assert f['etag'] == etag_of(1, canonical({'a': [1, 'é'], 'b': 1}).encode())
        g = c.get('/v1/builds/store.json', headers=H())
        assert g.headers['etag'] == f'"{f["etag"]}"' and g.headers['x-axf-rev'] == '1' and g.headers['x-axf-kind'] == 'record'
        assert g.json() == {'a': [1, 'é'], 'b': 1}
        assert c.get('/v1/builds/store.json', headers=H(**{'if-none-match': f'"{f["etag"]}"'})).status_code == 304
        fr = c.get('/v1/builds/store.json?frame=1', headers=H()).json()
        assert fr['data'] == {'a': [1, 'é'], 'b': 1} and fr['by'] == 'svc:cli'
        # blobs
        b = c.put('/v1/notes/handoffs/a.md', content=b'# Hi\n', headers=H(**{'content-type': 'text/markdown', 'if-none-match': '*'})).json()
        assert b['kind'] == 'blob' and b['contentType'] == 'text/markdown'
        assert c.get('/v1/notes/handoffs/a.md', headers=H()).content == b'# Hi\n'
        assert c.put('/v1/notes/handoffs/a.md?force=1', content=b'# Again\n', headers=H(**{'content-type': 'text/markdown'})).json()['rev'] == 2
        assert code(c.put('/v1/notes/x.json', content='{}', headers=J(**{'if-none-match': '*'}))) == 'invalid_key'  # notes hold no records
        # list + delete + tombstone
        c.put('/v1/builds/shipped/a.json', content='{"a":1}', headers=J(**{'if-none-match': '*'}))
        c.put('/v1/builds/shipped/b.json', content='{"b":1}', headers=J(**{'if-none-match': '*'}))
        lst = c.get('/v1/builds?prefix=shipped/&limit=1', headers=H()).json()
        assert [i['path'] for i in lst['items']] == ['shipped/a.json'] and lst['next'] == 'shipped/a.json' and lst['total'] == 2
        d = c.delete('/v1/builds/shipped/a.json', headers=H(**{'if-match': '1'})).json()
        assert d['deleted'] is True and d['rev'] == 2
        assert c.get('/v1/builds/shipped/a.json', headers=H()).status_code == 404
        assert c.get('/v1/builds/shipped/a.json?deleted=1', headers=H()).headers['x-axf-deleted'] == '1'
        assert [i['path'] for i in c.get('/v1/builds?prefix=shipped/', headers=H()).json()['items']] == ['shipped/b.json']
        assert code(c.get('/v1/nope/x', headers=H())) == 'invalid_key'
        assert code(c.get('/v1/builds/a//b', headers=H())) == 'invalid_key'


def test_rev_conflicts():
    with Env() as c:
        assert code(c.put('/v1/builds/store.json', content='{}', headers=J())) == 'precondition_required'
        r1 = c.put('/v1/builds/store.json', content='{"rev":1}', headers=J(**{'if-none-match': '*'})).json()
        assert code(c.put('/v1/builds/store.json', content='{}', headers=J(**{'if-none-match': '*'}))) == 'exists'
        assert code(c.put('/v1/builds/store.json', content='{"rev":2}', headers=J(**{'if-match': '7'}))) == 'conflict'
        stale = c.put('/v1/builds/store.json', content='{"rev":2}', headers=J(**{'if-match': '1-0000000000000000'}))
        assert stale.status_code == 409 and stale.json()['rev'] == 1 and stale.json()['etag'] == r1['etag']
        r2 = c.put('/v1/builds/store.json', content='{"rev":2}', headers=J(**{'if-match': f'"{r1["etag"]}"'})).json()
        assert r2['rev'] == 2
        assert code(c.put('/v1/builds/store.json', content='{"rev":3}', headers=J(**{'if-match': r1['etag']}))) == 'conflict'
        assert c.put('/v1/builds/store.json', content='{"rev":3}', headers=J(**{'if-match': '2'})).json()['rev'] == 3
        assert code(c.delete('/v1/builds/store.json', headers=H())) == 'precondition_required'
        assert code(c.delete('/v1/builds/store.json', headers=H(**{'if-match': '1'}))) == 'conflict'
        assert code(c.put('/v1/builds/x.json', content='not json', headers=J(**{'if-none-match': '*'}))) == 'invalid_body'


# ── journals ─────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_journal_append_only():
    with Env() as c:
        url = '/v1/builds/journal/2026-11'
        a = c.post(url + ':append', json={'entries': [{'rev': 1}, {'rev': 2}]}, headers=H()).json()
        assert (a['first'], a['last'], a['count']) == (1, 2, 2)
        i1 = c.post(url + ':append', json={'entries': [{'rev': 3}]}, headers=H(**{'idempotency-key': 'k1'})).json()
        i2 = c.post(url + ':append', json={'entries': [{'rev': 3}]}, headers=H(**{'idempotency-key': 'k1'})).json()
        assert i1 == i2 and i1['first'] == 3
        assert code(c.post(url + ':append', json={'entries': []}, headers=H())) == 'invalid_body'
        assert code(c.put(url, content='{}', headers=J(**{'if-none-match': '*'}))) == 'invalid_key'
        assert code(c.get(url, headers=H())) == 'invalid_key'
        assert code(c.delete(url + '?force=1', headers=H())) == 'read_only'
        assert code(c.post('/v1/settings/log:append', json={'entries': [{}]}, headers=H())) == 'invalid_key'
        r = c.get(url + '?since=0', headers=H()).json()
        assert [e['seq'] for e in r['entries']] == [1, 2, 3] and r['entries'][0]['entry'] == {'rev': 1}
        assert [e['seq'] for e in c.get(url + '?since=1&limit=1', headers=H()).json()['entries']] == [2]
        assert [e['seq'] for e in c.get(url + '?tail=1', headers=H()).json()['entries']] == [3]
        # the table itself refuses rewrites
        db = sqlite3.connect(c.app.state.store.db_path)
        for sql in ('UPDATE journal SET line = 1', 'DELETE FROM journal'):
            try:
                db.execute(sql)
                raise AssertionError(f'{sql} was allowed')
            except sqlite3.DatabaseError as e:
                assert 'append-only' in str(e)
        db.rollback()
        db.close()
        # the journal etag survives a restart (running hash rebuilt from the table)
        before = c.get('/v1/builds:manifest', headers=H()).json()
        st2 = main.Store(c.app.state.store.dir)
        st2.append('builds', 'journal/2026-11', [{'rev': 4}], main.Caller('svc:cli'))
        lines = [ln for (ln,) in st2.db.execute("SELECT line FROM journal WHERE path='journal/2026-11' ORDER BY seq")]
        want = f"4-{hashlib.sha256(''.join(ln + chr(10) for ln in lines).encode()).hexdigest()[:16]}"
        assert st2._row('builds', 'journal/2026-11')['etag'] == want
        assert before['journals']['journal/2026-11']['entries'] == 3


# ── history + restore ────────────────────────────────────────────────────────────────────────────────────────────────

def test_history_and_restore():
    with Env() as c:
        k = '/v1/planner/plans/p1.json'
        c.put(k, content='{"title":"one"}', headers=J(**{'if-none-match': '*'}))
        c.put(k, content='{"title":"two"}', headers=J(**{'if-match': '1'}))
        c.put(k, content='{"title":"three"}', headers=J(**{'if-match': '2'}))
        h = c.get(k + ':history', headers=H()).json()
        assert [x['rev'] for x in h['revs']] == [3, 2, 1]
        assert c.get(k + ':history?rev=1', headers=H()).json()['data'] == {'title': 'one'}
        assert code(c.post(k + ':restore', json={'rev': 1}, headers=H(**{'if-match': '2'}))) == 'conflict'
        r = c.post(k + ':restore', json={'rev': 1}, headers=H()).json()
        assert r['rev'] == 4
        assert c.get(k, headers=H()).json() == {'title': 'one'}
        assert code(c.post(k + ':restore', json={'rev': 99}, headers=H())) == 'not_found'
        assert code(c.post(k + ':restore', json={}, headers=H())) == 'invalid_body'
        # a deleted key comes back from its history
        c.delete(k, headers=H(**{'if-match': '4'}))
        assert c.post(k + ':restore', json={'rev': 2}, headers=H()).json()['rev'] == 6
        assert c.get(k, headers=H()).json() == {'title': 'two'}
        # blob history: content-addressed bodies survive overwrites
        b = '/v1/ui-review/shots/a.png'
        c.put(b, content=b'\x89PNG one', headers=H(**{'content-type': 'image/png', 'if-none-match': '*'}))
        c.put(b, content=b'\x89PNG two', headers=H(**{'content-type': 'image/png', 'if-match': '1'}))
        assert base64.b64decode(c.get(b + ':history?rev=1', headers=H()).json()['data']) == b'\x89PNG one'
        c.post(b + ':restore', json={'rev': 1}, headers=H())
        assert c.get(b, headers=H()).content == b'\x89PNG one'


# ── watch, manifests, snapshots ──────────────────────────────────────────────────────────────────────────────────────

def test_watch_manifest_snapshot():
    with Env() as c:
        c.put('/v1/builds/a.json', content='{"a":1}', headers=J(**{'if-none-match': '*'}))
        c.post('/v1/builds/journal/x:append', json={'entries': [{'x': 1}]}, headers=H())
        c.put('/v1/notes/n.md', content=b'n', headers=H(**{'content-type': 'text/markdown', 'if-none-match': '*'}))
        w = c.get('/v1/watch?poll=1&since=0&ns=builds', headers=H()).json()
        assert [(x['cursor'], x['op'], x['path']) for x in w['changes']] == [(1, 'put', 'a.json'), (2, 'append', 'journal/x')] and w['cursor'] == 3
        assert c.get('/v1/watch?poll=1&since=2', headers=H()).json()['changes'][0]['ns'] == 'notes'
        with c.stream('GET', '/v1/watch?ns=notes&since=0', headers=H()) as s:
            got = ''
            for chunk in s.iter_text():
                got += chunk
                if 'event: change' in got:
                    break
        assert 'id: 3' in got and '"path":"n.md"' in got
        m = c.get('/v1/builds:manifest', headers=H()).json()
        assert m['count'] == 2 and m['journals']['journal/x']['entries'] == 1
        snap = c.post('/v1/snapshot', json={'namespaces': ['builds', 'notes']}, headers=H()).json()
        assert snap['$axf'] == 'data-manifest@1' and snap['namespaces']['builds'] == m
        assert c.get(f"/v1/snapshot/{snap['id']}", headers=H()).json()['id'] == snap['id']
        tar = c.get(f"/v1/snapshot/{snap['id']}.tar", headers=H())
        assert tar.status_code == 200 and b'manifest.json' in tar.content
        counts = c.get('/v1/_meta/counts', headers=H()).json()['counts']
        assert counts == {'_meta': 1, 'builds': 2, 'notes': 1}


# ── auth refusal ─────────────────────────────────────────────────────────────────────────────────────────────────────

def test_auth_refusal():
    with Env() as c:
        assert code(c.get('/v1/builds')) == 'unauthorized'
        assert code(c.get('/v1/builds', headers={'authorization': 'Bearer nope'})) == 'unauthorized'
        assert c.get('/v1/builds', headers={'authorization': 'Bearer nope'}).status_code == 401
        # reader: read yes, write no
        assert c.get('/v1/builds', headers=H('reader')).status_code == 200
        assert code(c.put('/v1/builds/a.json', content='{}', headers={**H('reader'), 'content-type': 'application/json', 'if-none-match': '*'})) == 'forbidden'
        # a plugin token sees its own folder and nothing else
        ok = c.put('/v1/plugins/ui-notes/a.json', content='{}', headers={**H('plugin'), 'content-type': 'application/json', 'if-none-match': '*'})
        assert ok.status_code == 200, ok.text
        assert code(c.put('/v1/plugins/other/a.json', content='{}', headers={**H('plugin'), 'content-type': 'application/json', 'if-none-match': '*'})) == 'forbidden'
        assert code(c.get('/v1/plugins?prefix=other/', headers=H('plugin'))) == 'forbidden'
        assert c.get('/v1/plugins/ui-notes', headers=H('plugin')).json()['total'] == 1
        assert code(c.get('/v1/builds/a.json', headers=H('plugin'))) == 'forbidden'
        # only admin snapshots and touches _meta
        assert code(c.post('/v1/snapshot', json={}, headers=H('console'))) == 'forbidden'
        assert code(c.get('/v1/_meta/counts', headers=H('console'))) == 'forbidden'
        # the actor rides along in `by`
        r = c.put('/v1/builds/b.json', content='{}', headers={**H('console'), 'content-type': 'application/json', 'if-none-match': '*', 'x-axf-actor': 'session-42'}).json()
        assert r['by'] == 'svc:console/session-42'
        # revocation
        assert c.delete('/v1/_meta/tokens/reader', headers=H()).json()['deleted'] is True
        assert code(c.get('/v1/builds', headers=H('reader'))) == 'unauthorized'


def test_jws_tokens():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b'=').decode()  # noqa: E731
    with tempfile.TemporaryDirectory() as d:
        key = Ed25519PrivateKey.generate()
        pub = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        kf = Path(d) / 'keys.json'
        kf.write_text(json.dumps({'keys': [{'kid': 'k1', 'kty': 'OKP', 'crv': 'Ed25519', 'x': b64(pub)}]}))
        os.environ['AXF_DATA_KEYS_FILE'] = str(kf)
        try:
            c = make_client(Path(d))

            def tok(claims, kid='k1', signer=key):
                h = b64(json.dumps({'alg': 'EdDSA', 'kid': kid, 'typ': REG['token']['typ']}).encode())
                p = b64(json.dumps(claims).encode())
                return f'{h}.{p}.{b64(signer.sign(f"{h}.{p}".encode()))}'
            now = int(time.time())
            good = {'iss': 'axhub', 'aud': 'axf-data', 'sub': 'svc:orchestrator', 'jti': 'j1', 'iat': now, 'exp': now + 600, 'grants': {'builds': ['read']}}
            auth = lambda t: {'authorization': f'Bearer {t}'}  # noqa: E731
            assert c.get('/v1/builds', headers=auth(tok(good))).status_code == 200
            assert code(c.get('/v1/builds', headers=auth(tok({**good, 'exp': now - 1})))) == 'unauthorized'
            assert code(c.get('/v1/builds', headers=auth(tok({**good, 'aud': 'other'})))) == 'unauthorized'
            assert code(c.get('/v1/builds', headers=auth(tok(good, kid='k9')))) == 'unauthorized'
            assert code(c.get('/v1/builds', headers=auth(tok(good, signer=Ed25519PrivateKey.generate())))) == 'unauthorized'
            assert code(c.get('/v1/builds', headers=auth(tok({**good, 'exp': now + 2 * 86400})))) == 'unauthorized'
            assert code(c.get('/v1/notes', headers=auth(tok(good)))) == 'forbidden'
        finally:
            os.environ.pop('AXF_DATA_KEYS_FILE', None)


def test_read_only_in_rollback():
    with Env() as c:
        c.put('/v1/_meta/mode', content=json.dumps({'$axf': 'data-store-mode@1', 'mode': 'local', 'namespaces': {'builds': {'mode': 'rollback'}}}), headers=J(**{'if-none-match': '*'}))
        assert code(c.put('/v1/builds/a.json', content='{}', headers=J(**{'if-none-match': '*'}))) == 'read_only'
        assert code(c.post('/v1/builds/j:append', json={'entries': [{}]}, headers=H())) == 'read_only'
        assert c.put('/v1/notes/a.md', content=b'x', headers=H(**{'content-type': 'text/markdown', 'if-none-match': '*'})).status_code == 200


def test_node_contract_live():
    """The reference client's whole scenario, replayed over HTTP against a fresh server (same codes, revs, etags)."""
    import shutil
    import socket
    import subprocess
    check = HERE.parents[1] / 'framework/spec/check-data-store.mjs'
    if not shutil.which('node') or not check.is_file():
        return
    with tempfile.TemporaryDirectory() as d:
        tf = Path(d) / 'tokens.json'
        tf.write_text(json.dumps({'tokens': [{'id': 'a', 'sub': 'svc:cli', 'sha256': hashlib.sha256(b'live').hexdigest(), 'grants': {'*': ['admin']}}]}))
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            port = s.getsockname()[1]
        env = {**os.environ, 'AXF_DATA_DIR': str(Path(d) / 'data'), 'AXF_DATA_TOKENS_FILE': str(tf), 'AXF_DATA_NO_APP': '0'}
        srv = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'main:app', '--port', str(port), '--log-level', 'warning'], cwd=HERE, env=env)
        try:
            for _ in range(50):
                try:
                    socket.create_connection(('127.0.0.1', port), timeout=0.2).close()
                    break
                except OSError:
                    time.sleep(0.1)
            r = subprocess.run(['node', str(check), '--http', f'http://127.0.0.1:{port}'], env={**os.environ, 'AXF_DATA_TOKEN': 'live'}, capture_output=True, text=True, timeout=120)
            assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-2000:]
        finally:
            srv.terminate()
            srv.wait(10)


def test_registry_is_the_repo_schema():
    repo = HERE.parents[1] / 'framework/schemas/data-store.json'
    if repo.is_file():
        assert json.loads(repo.read_text()) == REG


if __name__ == '__main__':
    fails = 0
    for name, fn in [(n, f) for n, f in sorted(globals().items()) if n.startswith('test_') and callable(f)]:
        try:
            fn()
            print(f'ok   {name}')
        except Exception as e:  # noqa: BLE001
            fails += 1
            print(f'FAIL {name}: {type(e).__name__}: {e}')
            import traceback
            traceback.print_exc()
    print(f'axf-data: {"all ok" if not fails else f"{fails} failed"}')
    sys.exit(1 if fails else 0)
