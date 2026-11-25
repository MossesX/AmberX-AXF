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


def test_pipeline_summary():
    """pipeline-summary@1 and data-item@1: a build is read and updated as one row by its id, and the pipeline's status
    (counts, the queued build, running builds with slot and account) never needs the document. Both engines agree."""
    with Env() as c:
        pl = lambda **k: {'slot': '', 'account': '', 'queuedAt': '', **k}  # noqa: E731
        doc = {'$axf': 'builds@1', 'rev': 1, 'meta': {}, 'builds': [
            {'id': 'a', 'title': 'A', 'status': 'pending', 'rev': 1, 'steps': [{'id': 's1', 'done': False}], 'notes': []},
            {'id': 'b', 'title': 'B', 'status': 'queued', 'rev': 1, 'priority': 'P0', 'pipeline': pl(queuedAt='2026-11-25T10:00:00Z'), 'steps': [], 'notes': []},
            {'id': 'c', 'title': 'C', 'status': 'running', 'rev': 4, 'number': 'B-0007', 'pipeline': pl(slot='2', account='acct-one', session='axf-c'), 'steps': [], 'notes': [{'text': 'n'}]},
            {'id': 'd', 'title': 'D', 'status': 'building', 'rev': 1, 'pipeline': pl(slot='1', account='acct-two'), 'steps': []},
            {'id': 'e', 'title': 'E', 'status': 'complete', 'rev': 1},
            {'id': 'f', 'title': 'F', 'status': 'queued', 'rev': 1, 'deleted': True},
            {'id': 'g', 'title': 'G', 'status': 'queued', 'rev': 1, 'pipeline': pl(queuedAt='2026-11-25T09:00:00Z')}]}
        c.put('/v1/builds/store.json', content=json.dumps(doc), headers=J(**{'if-none-match': '*'}))
        s = c.get('/v1/builds/store.json:summary', headers=H()).json()
        assert s['$axf'] == 'pipeline-summary@1' and s['rev'] == 1 and s['total'] == 6
        assert s['counts'] == {'building': 1, 'complete': 1, 'pending': 1, 'queued': 2, 'running': 1}, 'a deleted build is not counted'
        assert s['queued']['id'] == 'g' and [q['id'] for q in s['queuedAll']] == ['g', 'b'], 'queued: oldest queuedAt first'
        assert [(r['id'], r['status'], r['slot'], r['account']) for r in s['running']] == [('d', 'building', '1', 'acct-two'), ('c', 'running', '2', 'acct-one')]
        assert s['running'][1]['number'] == 'B-0007' and s['running'][1]['session'] == 'axf-c' and s['queuedAll'][1]['priority'] == 'P0'
        assert 'steps' not in s['running'][0] and 'notes' not in s['running'][1], 'a summary row never carries steps or notes'
        # one build by id: its row with steps and notes
        it = c.get('/v1/builds/store.json:item?key=c', headers=H()).json()
        assert it['$axf'] == 'data-item@1' and it['key'] == 'c' and it['item'] == json.loads(canonical(doc['builds'][2]))
        assert it['head'] == {'$axf': 'builds@1', 'rev': 1}, 'the scalar head fields ride along, never meta or the lists'
        assert code(c.get('/v1/builds/store.json:item?key=nope', headers=H())) == 'not_found'
        assert code(c.get('/v1/builds/store.json:item', headers=H())) == 'invalid_body'
        # single-row update by id (ifRev of that build only): the summary follows, the other rows are untouched
        g2 = {**doc['builds'][6], 'rev': 2, 'status': 'running', 'pipeline': pl(slot='3', account='acct-one')}
        p = c.post('/v1/builds/store.json:patch', json={'lists': {'builds': [{'key': 'g', 'ifRev': 1, 'item': g2}]}}, headers=H()).json()
        assert p['applied'] == 1 and p['added'] == 0
        s2 = c.get('/v1/builds/store.json:summary', headers=H()).json()
        assert s2['rev'] == 2 and s2['counts']['queued'] == 1 and s2['counts']['running'] == 2 and s2['queued']['id'] == 'b'
        assert [r['id'] for r in s2['running']] == ['d', 'c', 'g'] and s2['running'][2]['slot'] == '3'
        assert c.get('/v1/builds/store.json:item?key=g', headers=H()).json()['item']['status'] == 'running'
        assert c.get('/v1/builds/store.json:item?key=c', headers=H()).json()['item'] == it['item']
        assert code(c.post('/v1/builds/store.json:patch', json={'lists': {'builds': [{'key': 'g', 'ifRev': 1, 'item': g2}]}}, headers=H())) == 'conflict'
        # no queued build: null, never a missing key; a record no table claims has no summary; a reader may read it
        b2 = {**doc['builds'][1], 'rev': 2, 'status': 'pending'}
        c.post('/v1/builds/store.json:patch', json={'lists': {'builds': [{'key': 'b', 'ifRev': 1, 'item': b2}]}}, headers=H())
        s3 = c.get('/v1/builds/store.json:summary', headers=H('reader')).json()
        assert s3['queued'] is None and s3['queuedAll'] == [] and 'queued' not in s3['counts']
        c.put('/v1/builds/other.json', content='{"builds":[]}', headers=J(**{'if-none-match': '*'}))
        assert code(c.get('/v1/builds/other.json:summary', headers=H())) == 'invalid_body'
        assert code(c.get('/v1/builds/missing.json:summary', headers=H())) == 'not_found'


def test_patch_document():
    """data-patch@1 on the document engine (SQLite): the same answers as the row engine, item by item."""
    with Env() as c:
        doc = {'rev': 1, 'builds': [{'id': 'a', 'rev': 1, 'status': 'pending', 'steps': [], 'notes': []}, {'id': 'b', 'rev': 1, 'status': 'pending'}]}
        c.put('/v1/builds/store.json', content=json.dumps(doc), headers=J(**{'if-none-match': '*'}))
        body = {'head': {'rev': 2}, 'lists': {'builds': [{'key': 'a', 'ifRev': 1, 'item': {'id': 'a', 'rev': 2, 'status': 'running', 'steps': [{'id': 's1'}], 'notes': [{'text': 'go'}]}},
                                              {'key': 'c', 'ifRev': None, 'item': {'id': 'c', 'rev': 1}}]},
                'journal': {'path': 'journal/2026-11', 'entry': {'rev': 2, 'action': 'tick'}, 'idem': 'rev-2'}}
        p = c.post('/v1/builds/store.json:patch', json=body, headers=H()).json()
        assert (p['$axf'], p['applied'], p['added'], p['record']['rev'], p['journal']['first']) == ('data-patch@1', 2, 1, 2, 1)
        got = c.get('/v1/builds/store.json', headers=H()).json()
        assert got['rev'] == 2 and [b['id'] for b in got['builds']] == ['a', 'b', 'c'] and got['builds'][0]['status'] == 'running'
        assert c.get('/v1/builds/store.json?meta=1', headers=H()).json()['etag'] == etag_of(2, canonical(got).encode())
        stale = c.post('/v1/builds/store.json:patch', json={'lists': {'builds': [{'key': 'a', 'ifRev': 1, 'item': {'id': 'a', 'rev': 3}}]}}, headers=H())
        assert stale.status_code == 409 and stale.json()['code'] == 'conflict'
        assert code(c.post('/v1/builds/store.json:patch', json={'lists': {'nope': []}}, headers=H())) == 'invalid_body'
        assert code(c.post('/v1/builds/missing.json:patch', json={'lists': {'builds': []}}, headers=H())) == 'not_found'
        assert code(c.post('/v1/builds/store.json:patch', json={'head': {'rev': 3}}, headers=H('reader'))) == 'forbidden'
        assert len(c.get('/v1/builds/journal/2026-11?since=0', headers=H()).json()['entries']) == 1


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


def test_backup_verify_restore_prune():
    import backup
    from datetime import datetime, timezone
    with Env() as c:
        st = c.app.state.store
        c.put('/v1/builds/store.json', content='{"a":1}', headers=J(**{'if-none-match': '*'}))
        c.post('/v1/builds/journal/2026-11:append', json={'entries': [{'x': 1}, {'x': 2}]}, headers=H())
        c.put('/v1/ui-review/shots/a.png', content=b'png', headers=H(**{'content-type': 'image/png', 'if-none-match': '*'}))
        c.put('/v1/plugins/shipped-features/ledger.sqlite', content=b'sqlite', headers=H(**{'content-type': 'application/vnd.sqlite3', 'if-none-match': '*'}))
        out = st.dir.parent / 'backups'
        r = backup.run(st.dir, out)
        assert r['verify']['ok'], r['verify']
        assert r['counts'] == {'builds': 2, 'plugins/shipped-features': 1, 'ui-review': 1} and r['blobs'] == 2
        assert json.loads((out / 'last.json').read_text())['verify']['ok'] is True
        # a write after the backup is explained by the feed
        c.put('/v1/builds/b.json', content='{}', headers=J(**{'if-none-match': '*'}))
        v = backup.verify(out / r['file'], st.dir)
        assert v['ok'] and v['diffs'] == [{'ns': 'builds', 'backup': 2, 'live': 3, 'explained': True}]
        # a key lost without a change in the feed is not
        st.db.execute("DELETE FROM keys WHERE ns='ui-review'")
        v = backup.verify(out / r['file'], st.dir)
        assert not v['ok'] and 'ui-review' in v['problems'][0]
        # restore into an empty folder, then over an existing one only with force
        to = st.dir.parent / 'restored'
        to.mkdir()
        rr = backup.restore(out / r['file'], to)
        assert rr['ok'] and rr['counts'] == r['counts']
        assert (to / 'blobs').is_dir()
        try:
            backup.restore(out / r['file'], to)
            raise AssertionError('restore over a live store needs --force')
        except SystemExit:
            pass
        assert backup.restore(out / r['file'], to, force=True)['movedAside'].startswith('pre-restore-')
        restored = main.Store(to)
        assert json.loads(restored.get('builds', 'store.json')[1]) == {'a': 1}
        assert restored.get('ui-review', 'shots/a.png')[1] == b'png'
        # retention: 14 days plus the newest of each week for 12 weeks
        for p in out.glob('axf-data-*.tar.gz'):
            p.unlink()
        now = datetime(2026, 11, 15, 4, 0, tzinfo=timezone.utc)
        for d in range(0, 120, 1):
            t = now.timestamp() - d * 86400
            (out / f"axf-data-{datetime.fromtimestamp(t, timezone.utc).strftime('%Y%m%d-%H%M%S')}.tar.gz").write_bytes(b'x')
        backup.prune(out, now)
        kept = sorted(p.name for p in out.glob('axf-data-*.tar.gz'))
        assert len([k for k in kept if k >= 'axf-data-20261101']) == 15  # Nov 1 … Nov 15
        older = [k for k in kept if k < 'axf-data-20261101']
        assert 8 <= len(older) <= 11 and all(k >= 'axf-data-20260816' for k in older)


def test_backup_run_one_at_a_time():
    """`backup.py run` while another run holds the lock stops at once (exit 0, nothing written) instead of a second dump."""
    import fcntl
    import io
    from contextlib import redirect_stdout
    import backup
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / 'backups'
        out.mkdir()
        with open(out / '.backup.lock', 'w') as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            buf = io.StringIO()
            with redirect_stdout(buf):
                rc = backup.main(['run', '--data', str(Path(d) / 'data'), '--out', str(out), '--dsn', ''])
        assert rc == 0 and json.loads(buf.getvalue())['skipped'], buf.getvalue()
        assert not backup.backups(out) and not (out / 'last.json').exists(), 'the second run wrote nothing'


def test_backup_routes():
    with Env() as c:
        os.environ['AXF_DATA_BACKUPS'] = str(Path(c.app.state.store.dir).parent / 'bk')
        try:
            c.put('/v1/builds/a.json', content='{}', headers=J(**{'if-none-match': '*'}))
            assert c.get('/v1/_meta/backup', headers=H()).json()['last'] is None
            assert code(c.post('/v1/_meta/backup', json={}, headers=H('reader'))) == 'forbidden'
            job = c.post('/v1/_meta/backup', json={}, headers=H()).json()
            assert job['state'] in ('running', 'done')
            for _ in range(100):
                st = c.get('/v1/_meta/backup', headers=H()).json()
                if st['job']['state'] != 'running':
                    break
                time.sleep(0.05)
            assert st['job']['state'] == 'done' and st['job']['ok'] is True, st
            assert st['last']['verify']['ok'] is True and len(st['kept']) == 1
        finally:
            os.environ.pop('AXF_DATA_BACKUPS', None)


def test_health_check_judge():
    sys.path.insert(0, str(HERE.parents[1] / 'apps/console-web/plugins/systems-check/server'))
    import axf_data as chk  # the systems-check probe's pure part
    now = 1_763_200_000.0  # 2025-11-15T09:46:40Z
    h = {'ok': True, 'cursor': 5, 'volume': {'freeBytes': 1 << 30}}
    fresh = {'file': 'axf-data-x.tar.gz', 'at': '2025-11-15T03:17:00Z', 'bytes': 1 << 20, 'verify': {'ok': True}}
    assert chk.judge(h, fresh, now)['status'] == 'ok'
    assert chk.judge(h, {**fresh, 'at': '2025-11-13T03:17:00Z'}, now)['status'] == 'error'
    assert 'failed its check' in chk.judge(h, {**fresh, 'verify': {'ok': False, 'problems': ['x short']}}, now)['summary']
    assert chk.judge(h, None, now)['summary'] == 'axf-data has no backup yet.'
    assert chk.judge(None, None, now, 'refused')['unreachable'] is True


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


def test_mcp_tools():
    with Env() as c:
        rpc = lambda method, params=None, who='console': c.post('/mcp', json={'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params or {}}, headers=H(who)).json()  # noqa: E731
        call = lambda name, args=None, who='console': (lambda r: (r['result']['isError'], json.loads(r['result']['content'][0]['text'])))(rpc('tools/call', {'name': name, 'arguments': args or {}}, who))  # noqa: E731
        assert rpc('initialize')['result']['serverInfo']['name'] == 'axf-data'
        assert {'notes_list', 'note_read', 'builds_list', 'build_note', 'settings_get'} <= {t['name'] for t in rpc('tools/list')['result']['tools']}
        assert c.post('/mcp', json={'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'}).status_code == 401
        err, w = call('note_write', {'path': 'handoffs/a.md', 'text': '# Hi'})
        assert not err and w['rev'] == 1
        err, n = call('note_read', {'path': 'handoffs/a.md'})
        assert n['text'] == '# Hi'
        err, e = call('note_write', {'path': 'handoffs/a.md', 'text': 'x'})
        assert err and e['code'] == 'exists'
        assert not call('note_write', {'path': 'handoffs/a.md', 'text': '# Two', 'etag': n['etag']})[0]
        assert [x['path'] for x in call('notes_list')[1]['notes']] == ['handoffs/a.md']
        c.put('/v1/builds/store.json', content=json.dumps({'$axf': 'builds@1', 'rev': 4, 'builds': [{'id': 'b1', 'title': 'One', 'status': 'running', 'steps': [{'done': True}, {}]}]}), headers=J(**{'if-none-match': '*'}))
        assert call('builds_list')[1]['builds'] == [{'id': 'b1', 'title': 'One', 'status': 'running', 'steps': '1/2', 'pr': None}]
        err, r = call('build_note', {'id': 'b1', 'text': 'console is down, still noting'})
        assert not err and r['rev'] == 5 and r['notes'] == 1
        assert call('build_get', {'id': 'b1'})[1]['notes'][0]['by'] == 'svc:console'
        month = time.strftime('%Y-%m', time.gmtime())
        assert c.get(f'/v1/builds/journal/{month}?since=0', headers=H()).json()['entries'][0]['entry']['action'] == 'note'
        err, e = call('settings_set', {'path': 'claude/settings.json', 'value': {'noWait': True}})
        assert err and e['code'] == 'forbidden'
        assert call('settings_set', {'path': 'apps/x.json', 'value': {'a': 1}})[1]['code'] == 'forbidden', 'the test console token holds no settings grant'
        assert not call('settings_set', {'path': 'apps/x.json', 'value': {'a': 1}}, who='admin')[0]
        assert call('settings_get', {'path': 'apps/x.json'}, who='admin')[1]['value'] == {'a': 1}
        assert call('note_read', {'path': 'handoffs/a.md'}, who='reader')[0], 'the reader token holds builds only'


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
