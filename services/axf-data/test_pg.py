#!/usr/bin/env python3
"""axf-data on Postgres: the whole wire-contract suite from test_store.py replayed on the Postgres engine, plus the parts
only this engine has: real domain tables (builds + steps, UI Review items, planner, settings, notes, control registry),
SQLite mirrors (ledger_*, chats_*), the SQLite → Postgres migration with count + manifest checks, the staged engine move
(sqlite → shadow → postgres) with drift, pg_dump backups.

    AXF_DATA_TEST_DSN=postgresql://postgres:pw@127.0.0.1:5432/postgres python3 services/axf-data/test_pg.py
    (each test runs in its own schema and drops it; nothing else in the database is touched)

Without AXF_DATA_TEST_DSN the file prints "skipped" and exits 0 (CI starts a postgres container first).
pg_dump / pg_restore: installed, or AXF_DATA_PG_TOOLS="docker exec -i <container>" + AXF_DATA_PG_TOOLS_DSN.
AXF_DATA_PG_TOOLS_DSN is seen from inside that container, so it names the container's own port (127.0.0.1:5432), not
the host port the test DSN maps to.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
os.environ['AXF_DATA_NO_APP'] = '1'
os.environ['AXF_DATA_BACKFILL'] = '0'   # tests call store.backfill() themselves
DSN = os.environ.get('AXF_DATA_TEST_DSN', '')

import test_store as T  # noqa: E402  (the contract suite; its Env / make_client are swapped for Postgres below)
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from store import Caller, Store, canonical, etag_of  # noqa: E402

REPO = HERE.parents[1]
H, J, code = T.H, T.J, T.code


def schema_name() -> str:
    return 't_' + uuid.uuid4().hex[:12]


def pg_store(tmp: Path, schema: str | None = None):
    from pg import PgStore
    return PgStore(DSN, tmp / 'data', schema=schema or schema_name())


def pg_make_client(tmp: Path, store=None) -> TestClient:
    tf = tmp / 'tokens.json'
    tf.write_text(json.dumps({'tokens': [{'id': k, 'sub': sub, 'sha256': __import__('hashlib').sha256(t.encode()).hexdigest(), 'grants': g} for k, (t, sub, g) in T.TOKENS.items()]}))
    os.environ['AXF_DATA_TOKENS_FILE'] = str(tf)
    os.environ.pop('AXF_DATA_KEYS_URL', None)
    st = store or pg_store(tmp)
    return TestClient(main.create_app(tmp / 'data', store=st))


class PgEnv:
    def __enter__(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.c = pg_make_client(Path(self.tmp.name))
        return self.c

    def __exit__(self, *a):
        try:
            self.c.app.state.store.drop_everything()
        finally:
            self.tmp.cleanup()


T.Env = PgEnv
T.make_client = pg_make_client

# ── the contract suite, on Postgres ─────────────────────────────────────────────────────────────────────────────────

test_crud_and_frames = T.test_crud_and_frames
test_rev_conflicts = T.test_rev_conflicts
test_history_and_restore = T.test_history_and_restore
test_watch_manifest_snapshot = T.test_watch_manifest_snapshot
test_auth_refusal = T.test_auth_refusal
test_jws_tokens = T.test_jws_tokens
test_read_only_in_rollback = T.test_read_only_in_rollback
test_backup_routes = T.test_backup_routes
test_mcp_tools = T.test_mcp_tools
test_patch_document = T.test_patch_document


def test_journal_append_only():
    with PgEnv() as c:
        url = '/v1/builds/journal/2026-11'
        a = c.post(url + ':append', json={'entries': [{'rev': 1}, {'rev': 2}]}, headers=H()).json()
        assert (a['first'], a['last'], a['count']) == (1, 2, 2)
        i1 = c.post(url + ':append', json={'entries': [{'rev': 3}]}, headers=H(**{'idempotency-key': 'k1'})).json()
        i2 = c.post(url + ':append', json={'entries': [{'rev': 3}]}, headers=H(**{'idempotency-key': 'k1'})).json()
        assert i1 == i2 and i1['first'] == 3
        assert code(c.put(url, content='{}', headers=J(**{'if-none-match': '*'}))) == 'invalid_key'
        assert code(c.delete(url + '?force=1', headers=H())) == 'read_only'
        r = c.get(url + '?since=0', headers=H()).json()
        assert [e['seq'] for e in r['entries']] == [1, 2, 3] and r['entries'][0]['entry'] == {'rev': 1}
        assert [e['seq'] for e in c.get(url + '?tail=1', headers=H()).json()['entries']] == [3]
        st = c.app.state.store
        # the table itself refuses rewrites (trigger), and the entry is a real JSONB column
        for sql in ("UPDATE journal SET line = 'x'", 'DELETE FROM journal'):
            try:
                st.q(sql)
                raise AssertionError(f'{sql} was allowed')
            except Exception as e:  # noqa: BLE001
                assert 'append-only' in str(e)
        assert st.fetchone("SELECT COUNT(*) AS n FROM journal WHERE (entry->>'rev')::int >= 2")['n'] == 2
        assert st.fetchone("SELECT COUNT(*) AS n FROM build_journal")['n'] == 3
        # the journal etag survives a restart (running hash rebuilt from the table)
        before = c.get('/v1/builds:manifest', headers=H()).json()
        st2 = pg_store(Path(st.dir).parent, st.schema)
        st2.append('builds', 'journal/2026-11', [{'rev': 4}], Caller('svc:cli'))
        lines = st2.journal_lines('builds', 'journal/2026-11')
        want = f"4-{__import__('hashlib').sha256(''.join(ln + chr(10) for ln in lines).encode()).hexdigest()[:16]}"
        assert st2._row('builds', 'journal/2026-11')['etag'] == want
        assert before['journals']['journal/2026-11']['entries'] == 3


# ── real tables ─────────────────────────────────────────────────────────────────────────────────────────────────────

def test_builds_store_is_rows():
    with PgEnv() as c:
        st = c.app.state.store
        doc = {'$axf': 'builds@1', 'rev': 5, 'updatedAt': 'x', 'rules': {'all': {'a': 1}}, 'meta': {}, 'drafts': {},
               'builds': [{'id': 'one', 'title': 'One', 'status': 'queued', 'pr': '', 'order': 3, 'deleted': False, 'notes': [{'text': 'n'}],
                           'steps': [{'id': 's1', 'title': 'A', 'done': True, 'estimate': 10, 'checks': []}, {'id': 's2', 'title': 'B', 'done': False, 'estimate': 5}]},
                          {'id': 'two', 'title': 'Two', 'status': 'done', 'pr': 705, 'pending': None, 'steps': []},
                          {'id': 'three', 'title': 'No steps key', 'status': 'draft'}]}
        r = c.put('/v1/builds/store.json', content=json.dumps(doc), headers=J(**{'if-none-match': '*'})).json()
        assert r['etag'] == etag_of(1, canonical(doc).encode()), 'the etag is the canonical document, as on SQLite'
        assert c.get('/v1/builds/store.json', headers=H()).json() == json.loads(canonical(doc))
        rows = st.fetchall('SELECT rid, pos, id, title, status, pr, ord, deleted, extra, children_lifted FROM builds ORDER BY pos')
        assert [(x['rid'], x['pos'], x['status'], x['pr'], x['ord'], x['deleted'], x['children_lifted']) for x in rows] == [
            ('one', 0, 'queued', '', 3, False, {'steps': True, 'notes': True}), ('two', 1, 'done', None, None, None, {'steps': True}), ('three', 2, 'draft', None, None, None, None)]
        assert rows[1]['extra'] == {'pr': 705, 'pending': None}, 'a value that does not fit its column stays in extra'
        assert rows[0]['extra'] == {}, 'notes are rows now (build_notes), not extra'
        steps = st.fetchall('SELECT parent_rid, pos, id, done, estimate, extra FROM build_steps ORDER BY parent_rid, pos')
        assert [(s['parent_rid'], s['id'], s['done'], s['estimate']) for s in steps] == [('one', 's1', True, 10), ('one', 's2', False, 5)]
        assert steps[0]['extra'] == {'checks': []}
        assert st.fetchall('SELECT parent_rid, pos, text FROM build_notes') == [{'parent_rid': 'one', 'pos': 0, 'text': 'n'}]
        head = st.fetchone("SELECT head, lists FROM store_heads WHERE ns='builds' AND path='store.json'")
        assert head['lists'] == ['builds'] and head['head']['rev'] == 5 and 'builds' not in head['head']
        # a second write touches only the changed rows (hash per row)
        doc['builds'][1]['status'] = 'live'
        doc['builds'].append({'id': 'four', 'title': 'Four', 'status': 'queued', 'steps': [{'id': 'x'}]})
        c.put('/v1/builds/store.json', content=json.dumps(doc), headers=J(**{'if-match': r['etag']}))
        assert c.get('/v1/builds/store.json', headers=H()).json() == json.loads(canonical(doc))
        assert st.fetchone("SELECT status FROM builds WHERE id='two'")['status'] == 'live'
        assert st.fetchone('SELECT COUNT(*) AS n FROM builds')['n'] == 4 and st.fetchone('SELECT COUNT(*) AS n FROM build_steps')['n'] == 3
        # reorder: the same rows, new positions, nothing rewritten but pos
        doc['builds'] = [doc['builds'][3], *doc['builds'][:3]]
        c.put('/v1/builds/store.json', content=json.dumps(doc), headers=J(**{'if-match': '2'}))
        assert c.get('/v1/builds/store.json', headers=H()).json() == json.loads(canonical(doc))
        assert st.fetchone("SELECT pos FROM builds WHERE rid='four'")['pos'] == 0
        # shrink: rows no longer in the list go (with their children)
        doc['builds'] = doc['builds'][1:2]
        c.put('/v1/builds/store.json', content=json.dumps(doc), headers=J(**{'if-match': '3'}))
        assert st.fetchone('SELECT COUNT(*) AS n FROM builds')['n'] == 1 and st.fetchone('SELECT COUNT(*) AS n FROM build_steps')['n'] == 2 and st.fetchone('SELECT COUNT(*) AS n FROM build_notes')['n'] == 1
        assert c.get('/v1/builds/store.json', headers=H()).json() == json.loads(canonical(doc))
        # a document without a builds list, or not an object, still round-trips
        for odd in ({'rev': 1, 'builds': 'not a list'}, [1, 2, 3], {'builds': [{'a': 1}, 'mixed']}):
            c.put('/v1/builds/store.json', content=json.dumps(odd), headers=J(**{'if-match': c.get('/v1/builds/store.json?meta=1', headers=H()).json()['etag']}))
            assert c.get('/v1/builds/store.json', headers=H()).json() == odd
        # history keeps earlier revs, delete clears the rows
        assert [x['rev'] for x in c.get('/v1/builds/store.json:history', headers=H()).json()['revs']][:2] == [7, 6]
        c.delete('/v1/builds/store.json', headers=H(**{'if-match': '7'}))
        assert st.fetchone('SELECT COUNT(*) AS n FROM builds')['n'] == 0 and st.fetchone('SELECT COUNT(*) AS n FROM store_heads')['n'] == 0
        assert c.post('/v1/builds/store.json:restore', json={'rev': 2}, headers=H()).json()['rev'] == 9
        assert st.fetchone('SELECT COUNT(*) AS n FROM builds')['n'] == 4 and st.fetchone("SELECT status FROM builds WHERE id='two'")['status'] == 'live'


def test_patch_locks_only_the_rows_it_changes():
    """data-patch@1 on Postgres: changed builds, head fields and the journal line in one transaction; `ifRev` per build;
    only the named rows are locked (another connection updates a different build meanwhile)."""
    import threading
    import psycopg
    from psycopg.rows import dict_row
    from pg import _dsn_with_schema
    with PgEnv() as c:
        st = c.app.state.store
        doc = {'$axf': 'builds@1', 'rev': 1, 'updatedAt': 't0', 'meta': {}, 'rules': {}, 'drafts': {},
               'builds': [{'id': 'a', 'title': 'A', 'status': 'pending', 'rev': 1, 'steps': [{'id': 's1', 'done': False}], 'notes': []},
                          {'id': 'b', 'title': 'B', 'status': 'pending', 'rev': 1, 'steps': [], 'notes': []}]}
        r0 = c.put('/v1/builds/store.json', content=json.dumps(doc), headers=J(**{'if-none-match': '*'})).json()
        a2 = {**doc['builds'][0], 'rev': 2, 'status': 'running', 'steps': [{'id': 's1', 'done': True}], 'notes': [{'at': 't1', 'text': 'started'}]}
        body = {'head': {'rev': 2, 'updatedAt': 't1'}, 'lists': {'builds': [{'key': 'a', 'ifRev': 1, 'item': a2}]},
                'journal': {'path': 'journal/2026-11', 'entry': {'rev': 2, 'at': 't1', 'by': 'test', 'action': 'tick', 'builds': [{'id': 'a', 'op': 'change'}]}, 'idem': 'rev-2-t1'}}
        p = c.post('/v1/builds/store.json:patch', json=body, headers=H()).json()
        assert p['$axf'] == 'data-patch@1' and p['applied'] == 1 and p['added'] == 0 and p['record']['rev'] == 2 and p['journal']['first'] == 1
        got = c.get('/v1/builds/store.json', headers=H()).json()
        assert got['rev'] == 2 and got['updatedAt'] == 't1' and got['builds'][0] == json.loads(canonical(a2)) and got['builds'][1] == doc['builds'][1]
        assert c.get('/v1/builds/store.json?meta=1', headers=H()).json()['etag'] == etag_of(2, canonical(got).encode()), 'the etag is of the assembled record, as a put'
        assert st.fetchone("SELECT COUNT(*) AS n FROM build_notes WHERE parent_rid='a'")['n'] == 1
        assert c.get('/v1/builds/journal/2026-11?since=0', headers=H()).json()['entries'][0]['entry']['action'] == 'tick'
        # a stale ifRev is a conflict naming the build; nothing written (not the head, not the journal)
        stale = c.post('/v1/builds/store.json:patch', json={'head': {'rev': 3}, 'lists': {'builds': [{'key': 'a', 'ifRev': 1, 'item': {**a2, 'rev': 3}}]},
                                                          'journal': {'path': 'journal/2026-11', 'entry': {'rev': 3}}}, headers=H())
        assert stale.status_code == 409 and stale.json()['code'] == 'conflict' and 'a' in stale.json()['message']
        assert c.get('/v1/builds/store.json', headers=H()).json()['rev'] == 2
        assert len(c.get('/v1/builds/journal/2026-11?since=0', headers=H()).json()['entries']) == 1
        # a new build passes ifRev null; an existing one with null is a conflict
        p2 = c.post('/v1/builds/store.json:patch', json={'lists': {'builds': [{'key': 'c', 'ifRev': None, 'item': {'id': 'c', 'title': 'C', 'rev': 1}}]}}, headers=H()).json()
        assert p2['added'] == 1 and [b['id'] for b in c.get('/v1/builds/store.json', headers=H()).json()['builds']] == ['a', 'b', 'c']
        assert code(c.post('/v1/builds/store.json:patch', json={'lists': {'builds': [{'key': 'c', 'ifRev': None, 'item': {'id': 'c'}}]}}, headers=H())) == 'conflict'
        # row-level: while this connection holds build `a` FOR UPDATE, a patch of build `b` goes through at once
        dsn = _dsn_with_schema(st.dsn, st.schema)
        other = psycopg.connect(dsn, row_factory=dict_row)
        other.execute("SELECT 1 FROM builds WHERE section='builds' AND rid='a' FOR UPDATE")
        done = {}

        def patch_b():
            r = c.post('/v1/builds/store.json:patch', json={'lists': {'builds': [{'key': 'b', 'ifRev': 1, 'item': {**doc['builds'][1], 'rev': 2, 'status': 'queued'}}]}}, headers=H())
            done['b'] = r.status_code

        t = threading.Thread(target=patch_b)
        t.start()
        t.join(timeout=5)
        assert done.get('b') == 200, f'patching b waited on the lock of a ({done})'
        other.rollback()
        other.close()
        assert c.get('/v1/builds/store.json', headers=H()).json()['builds'][1]['status'] == 'queued'
        # shape errors are invalid_body; a record no table claims cannot be patched
        assert code(c.post('/v1/builds/store.json:patch', json={'lists': {'steps': []}}, headers=H())) == 'invalid_body'
        assert code(c.post('/v1/builds/store.json:patch', json={'lists': {'builds': [{'key': 'a', 'item': {'id': 'zz'}}]}}, headers=H())) == 'invalid_body'
        c.put('/v1/builds/other.json', content='{"builds":[]}', headers=J(**{'if-none-match': '*'}))
        assert code(c.post('/v1/builds/other.json:patch', json={'lists': {'builds': []}}, headers=H())) == 'invalid_body'
        # the orchestrator's grant (write + append) is enough; a reader is refused
        assert code(c.post('/v1/builds/store.json:patch', json={'head': {'rev': 9}}, headers=H('reader'))) == 'forbidden'


def test_tables_v1_rows_are_rekeyed_on_connect():
    """A database made by tables version 1 (builds keyed by position) comes up as version 2: same document, rows keyed by id."""
    with PgEnv() as c:
        st = c.app.state.store
        doc = {'rev': 1, 'builds': [{'id': 'x', 'title': 'X', 'notes': [{'text': 'n1'}], 'steps': [{'id': 's1'}]}, {'id': 'y', 'title': 'Y'}]}
        c.put('/v1/builds/store.json', content=json.dumps(doc), headers=J(**{'if-none-match': '*'}))
        # the version-1 shape (rows keyed by position, notes inside extra, one child flag), as the Nov 15 release made it
        from psycopg.types.json import Jsonb
        import tables as T
        st.q('DROP TABLE build_notes, build_steps, builds')
        st.q(f'CREATE TABLE builds (section TEXT NOT NULL, pos INTEGER NOT NULL{T._ddl_cols(T.BUILD_COLS)}, extra JSONB NOT NULL DEFAULT \'{{}}\', doc_hash TEXT NOT NULL, child_lifted BOOLEAN, PRIMARY KEY (section, pos))')  # noqa: SLF001
        st.q(f'CREATE TABLE build_steps (section TEXT NOT NULL, parent_pos INTEGER NOT NULL, pos INTEGER NOT NULL{T._ddl_cols(T.STEP_COLS)}, extra JSONB NOT NULL DEFAULT \'{{}}\', PRIMARY KEY (section, parent_pos, pos))')  # noqa: SLF001
        st.q("INSERT INTO builds (section, pos, id, title, extra, doc_hash, child_lifted) VALUES ('builds', 0, 'x', 'X', %s, 'h1', true), ('builds', 1, 'y', 'Y', '{}', 'h2', NULL)",
             (Jsonb({'notes': [{'text': 'n1'}]}),))
        st.q("INSERT INTO build_steps (section, parent_pos, pos, id, extra) VALUES ('builds', 0, 0, 's1', '{}')")
        # the other list tables carried one BOOLEAN child flag in version 1
        st.q('ALTER TABLE control_targets DROP COLUMN children_lifted')
        st.q('ALTER TABLE control_targets ADD COLUMN child_lifted BOOLEAN')
        st.q("INSERT INTO control_targets (section, pos, address, extra, doc_hash, child_lifted) VALUES ('tabGroups', 0, 'a', '{}', 'h', true), ('views', 0, 'v', '{}', 'h', NULL)")
        st.q("DELETE FROM meta WHERE k='tables_version'")
        st2 = pg_store(Path(st.dir).parent, st.schema)
        assert st2.meta_get('tables_version') == str(__import__('tables').TABLES_VERSION)
        assert st2.fetchall('SELECT rid, pos FROM builds ORDER BY pos') == [{'rid': 'x', 'pos': 0}, {'rid': 'y', 'pos': 1}]
        assert st2.fetchall('SELECT parent_rid, id FROM build_steps') == [{'parent_rid': 'x', 'id': 's1'}]
        assert st2.fetchall('SELECT parent_rid, text FROM build_notes') == [{'parent_rid': 'x', 'text': 'n1'}]
        assert st2.fetchall('SELECT section, children_lifted FROM control_targets ORDER BY section') == [{'section': 'tabGroups', 'children_lifted': {'tabs': True}}, {'section': 'views', 'children_lifted': None}]
        r, body = st2.get('builds', 'store.json')
        assert json.loads(body) == json.loads(canonical(doc))
        assert st2.fetchone("SELECT to_regclass('builds_v1') AS t")['t'] is None


def test_live_builds_store_round_trips():
    """The real builds store (931 builds, 9 MB): rows in, the same document out, within budget."""
    src = REPO / '_claude/builds/store.json'
    if not src.is_file():
        return
    with PgEnv() as c:
        st = c.app.state.store
        body = src.read_bytes()
        doc = json.loads(body)
        t0 = time.time()
        r = c.put('/v1/builds/store.json', content=body, headers=J(**{'if-none-match': '*'})).json()
        t_put = time.time() - t0
        assert r['etag'] == etag_of(1, canonical(doc).encode())
        t0 = time.time()
        got = c.get('/v1/builds/store.json', headers=H()).json()
        t_get = time.time() - t0
        assert got == json.loads(canonical(doc))
        n = st.fetchone('SELECT COUNT(*) AS n FROM builds')['n']
        assert n == len(doc['builds'])
        assert st.fetchone('SELECT COUNT(*) AS n FROM build_steps')['n'] == sum(len(b.get('steps') or []) for b in doc['builds'] if isinstance(b.get('steps'), list))
        by_status = st.fetchall('SELECT status, COUNT(*) AS n FROM builds GROUP BY status ORDER BY n DESC')
        assert sum(x['n'] for x in by_status) == n
        # one build changes: one row changes
        doc['builds'][0]['title'] = doc['builds'][0]['title'] + ' (changed)'
        t0 = time.time()
        c.put('/v1/builds/store.json', content=json.dumps(doc), headers=J(**{'if-match': r['etag']}))
        t_put2 = time.time() - t0
        assert c.get('/v1/builds/store.json', headers=H()).json() == json.loads(canonical(doc))
        print(f'    live store: {n} builds, put {t_put:.1f}s, get {t_get:.1f}s, second put {t_put2:.1f}s')
        assert t_put < 30 and t_get < 10 and t_put2 < 30


def test_other_domain_tables():
    with PgEnv() as c:
        st = c.app.state.store
        # UI Review items
        items = {'$axf': 'ui-review-store@1', 'groups': {'g': 1}, 'packDecisions': [], 'items': [
            {'id': 'r1', 'kind': 'screen', 'name': 'A', 'app': 'console-web', 'screen': 'home', 'group': 'g', 'status': 'pending', 'files': ['a.png'], 'history': [], 'createdAt': 't'},
            {'id': 'r2', 'kind': 'option', 'name': 'B', 'status': 'approved', 'section': 'x'}]}
        c.put('/v1/ui-review/items.json', content=json.dumps(items), headers=J(**{'if-none-match': '*'}))
        assert c.get('/v1/ui-review/items.json', headers=H()).json() == json.loads(canonical(items))
        assert [(x['id'], x['status'], x['sect']) for x in st.fetchall('SELECT id, status, sect FROM ui_review_items ORDER BY pos')] == [('r1', 'pending', None), ('r2', 'approved', 'x')]
        # planner items: plans/<id>.json and projects/<p>/plans/<id>.json are rows; other planner records are not
        plan = {'$axf': 'plan@1', 'id': 'p1', 'title': 'Plan', 'status': 'idea', 'priority': 'P2', 'version': 1, 'steps': [{'t': 1}], 'cost': {'usd': 1.5}}
        c.put('/v1/planner/plans/p1.json', content=json.dumps(plan), headers=J(**{'if-none-match': '*'}))
        c.put('/v1/planner/projects/sand/plans/p2.json', content=json.dumps({**plan, 'id': 'p2', 'project': 'sand'}), headers=J(**{'if-none-match': '*'}))
        c.put('/v1/planner/deleted.json', content='{"ids":["x"]}', headers=J(**{'if-none-match': '*'}))
        assert c.get('/v1/planner/plans/p1.json', headers=H()).json() == json.loads(canonical(plan))
        assert [(x['id'], x['project'], x['status']) for x in st.fetchall('SELECT id, project, status FROM planner_items ORDER BY id')] == [('p1', None, 'idea'), ('p2', 'sand', 'idea')]
        assert st.fetchone("SELECT extra FROM planner_items WHERE id='p1'")['extra'] == {'steps': [{'t': 1}], 'cost': {'usd': 1.5}}
        assert c.get('/v1/planner/deleted.json', headers=H()).json() == {'ids': ['x']}
        assert st.fetchone("SELECT value FROM planner_lists WHERE path='deleted.json'")['value'] == 'x'
        # settings documents
        c.put('/v1/settings/apps/axf-console.json', content='{"$axf":"app-settings@1","theme":"dark"}', headers=J(**{'if-none-match': '*'}))
        assert st.fetchone('SELECT schema, extra FROM settings') == {'schema': 'app-settings@1', 'extra': {'theme': 'dark'}}
        # notes: text rows; binary under notes stays a blob
        c.put('/v1/notes/handoffs/a.md', content='# Hi\n\nnote é'.encode(), headers=H(**{'content-type': 'text/markdown', 'if-none-match': '*'}))
        assert c.get('/v1/notes/handoffs/a.md', headers=H()).content == '# Hi\n\nnote é'.encode()
        assert st.fetchone('SELECT folder, name, text FROM notes') == {'folder': 'handoffs', 'name': 'a.md', 'text': '# Hi\n\nnote é'}
        c.put('/v1/notes/misc/x.bin', content=b'\x00\xff\xfe', headers=H(**{'content-type': 'application/octet-stream', 'if-none-match': '*'}))
        assert c.get('/v1/notes/misc/x.bin', headers=H()).content == b'\x00\xff\xfe'
        assert st.fetchone("SELECT table_name, blob_sha IS NOT NULL AS b FROM keys WHERE path='misc/x.bin'") == {'table_name': '', 'b': True}
        # the control registry: the committed inventory becomes control_targets rows, one per target, tabs in control_tabs
        inv_file = REPO / 'apps/console-web/src/control/inventory.json'
        if inv_file.is_file():
            inv = json.loads(inv_file.read_text())
            c.put('/v1/console/control/inventory.json', content=json.dumps(inv), headers=J(**{'if-none-match': '*'}))
            assert c.get('/v1/console/control/inventory.json', headers=H()).json() == json.loads(canonical(inv))
            per = {x['section']: x['n'] for x in st.fetchall('SELECT section, COUNT(*) AS n FROM control_targets GROUP BY section')}
            assert per == {k: len(inv[k]) for k in ('views', 'nav', 'tabGroups', 'settingsTabs', 'settings', 'functions', 'buttons', 'plugins')}
            assert st.fetchone('SELECT COUNT(*) AS n FROM control_tabs')['n'] == sum(len(g['tabs']) for g in inv['tabGroups'])
            assert st.fetchone("SELECT COUNT(*) AS n FROM control_targets WHERE address LIKE 'view:%'")['n'] >= len(inv['views'])
        # agent slots (s4.1): one row per entry, its list is its section; the same id may sit in two lists
        slots = {'$axf': 'agent-slots@1', 'seq': 7, 'guard': {'trips': [1]}, 'swap': {'since': None, 'mb': 0}, 'hosts': {'h': {'at': 1}},
                 'running': [{'id': 'a', 'name': 'b1', 'kind': 'headless', 'state': 'running', 'pid': 12, 'seq': 3, 'extra': {'x': 1}}],
                 'queue': [{'id': 'q', 'name': 'b2', 'state': 'waiting', 'priority': 'urgent', 'seq': 5}], 'heavy': [], 'done': [{'id': 'a', 'state': 'done'}]}
        c.put('/v1/console/agent-slots/state.json', content=json.dumps(slots), headers=J(**{'if-none-match': '*'}))
        assert c.get('/v1/console/agent-slots/state.json', headers=H()).json() == json.loads(canonical(slots))
        assert [(x['section'], x['id'], x['state'], x['pid']) for x in st.fetchall('SELECT section, id, state, pid FROM agent_slots ORDER BY section, pos')] == [('done', 'a', 'done', None), ('queue', 'q', 'waiting', None), ('running', 'a', 'running', 12)]
        # a record with \u0000 cannot be jsonb: kept byte-exact instead
        c.put('/v1/builds/odd.json', content=json.dumps({'s': 'a\u0000b'}), headers=J(**{'if-none-match': '*'}))
        assert c.get('/v1/builds/odd.json', headers=H()).json() == {'s': 'a\u0000b'}
        assert st.fetchone("SELECT body IS NOT NULL AS b, data IS NULL AS d FROM records WHERE path='odd.json'") == {'b': True, 'd': True}
        tables = c.get('/v1/_meta/tables', headers=H()).json()
        names = {t['name']: t for t in tables['tables']}
        assert tables['engine'] == 'postgres' and names['builds']['group'] == 'domain' and names['keys']['group'] == 'core'
        assert names['notes']['rows'] == 1 and names['planner_items']['rows'] == 2 and names['ui_review_items']['rows'] == 2
        assert code(c.get('/v1/_meta/tables', headers=H('console'))) == 'forbidden'


def test_plan_tables_and_backfill():
    """s4.2: plan, profiles, projects, plan media and Plan Studio documents are rows; keys stored before the tables
    existed (records, plain blobs) move in on connect with rev and etag unchanged."""
    with PgEnv() as c:
        st = c.app.state.store
        plan = {'$axf': 'plan@1', 'generatedAt': 't', 'statuses': ['built', 'planned'], 'features': [
            {'id': 'f1', 'title': 'One', 'status': 'built', 'group': 'g', 'files': ['a'], 'effort': {'m': 1}},
            {'id': 'f2', 'title': 'Two', 'status': 'planned', 'priority': 3}]}
        docs = {
            '/v1/console/framework/plan/plan.json': plan,
            '/v1/console/framework/plan/profiles/all/framework/plan/plan.json': {**plan, 'features': plan['features'][:1]},
            '/v1/console/framework/plan/profiles.json': {'$axf': 'build-profiles@1', 'active': 'all', 'profiles': [{'id': 'all', 'name': 'All'}]},
            '/v1/console/framework/plan/projects.json': {'$axf': 'projects@1', 'projects': [{'id': 'p', 'name': 'P', 'profile': 'all'}]},
            '/v1/console/projects/garden/project.manifest.json': {'$manifest': 'project-manifest@1', 'name': 'garden', 'data': {'shared': []}},
            '/v1/console/project.manifest.json': {'$manifest': 'project-manifest@1', 'name': 'amberx-axf'},
            '/v1/planner/history/x.work.json': {'$axf': 'plan-history@1', 'id': 'x.work', 'versions': [{'v': 1, 'at': 't', 'plan': {'id': 'x.work'}}, {'v': 2, 'at': 'u', 'plan': {}}]},
            '/v1/planner/categories.json': {'$axf': 'plan-categories@1', 'paths': ['AmberX', 'AmberX/Voice']},
            '/v1/planner/catalog-seen.json': {'keys': ['app:a', 'app:b']},
            '/v1/planner/blueprints.json': {'$axf': 'plan-blueprints@1', 'active': 'e', 'items': [{'id': 'e', 'name': 'Existing', 'plans': []}]},
            '/v1/planner/v2/tree.json': {'$axf': 'plan-tree@1', 'rev': 0, 'items': [{'id': 'n1', 'title': 'Root', 'kids': []}], 'trash': []},
            '/v1/planner/projects/sand/history/h.json': {'$axf': 'plan-history@1', 'id': 'h', 'versions': 'not a list'},
        }
        for url, doc in docs.items():
            assert c.put(url, content=json.dumps(doc), headers=J(**{'if-none-match': '*'})).status_code == 200, url
            assert c.get(url, headers=H()).json() == json.loads(canonical(doc)), url
        rows = {t: st.fetchone(f'SELECT COUNT(*) AS n FROM {t}')['n'] for t in ('plan_items', 'plan_profiles', 'plan_projects', 'projects', 'planner_history', 'planner_categories', 'planner_lists', 'planner_tree')}
        assert rows == {'plan_items': 2 + 2 + 1 + 2, 'plan_profiles': 1, 'plan_projects': 1, 'projects': 2, 'planner_history': 2, 'planner_categories': 2, 'planner_lists': 3, 'planner_tree': 1}
        assert st.fetchone("SELECT title, grp, extra FROM plan_items WHERE path='framework/plan/plan.json' AND rid='f1'") == {'title': 'One', 'grp': 'g', 'extra': {'files': ['a'], 'effort': {'m': 1}}}
        assert st.fetchone("SELECT priority, extra FROM plan_items WHERE rid='f2'") == {'priority': None, 'extra': {'priority': 3}}  # an int priority stays in extra
        assert st.fetchone("SELECT name, display_name FROM projects WHERE path='projects/garden/project.manifest.json'") == {'name': 'garden', 'display_name': None}
        # one edit rewrites one row
        plan2 = json.loads(canonical(plan))
        plan2['features'][1]['title'] = 'Two!'
        before = {r['rid']: r['doc_hash'] for r in st.fetchall("SELECT rid, doc_hash FROM plan_items WHERE path='framework/plan/plan.json' AND list='features'")}
        et = c.get('/v1/console/framework/plan/plan.json', headers=H()).headers['etag']
        assert c.put('/v1/console/framework/plan/plan.json', content=json.dumps(plan2), headers=J(**{'if-match': et})).status_code == 200
        after = {r['rid']: r['doc_hash'] for r in st.fetchall("SELECT rid, doc_hash FROM plan_items WHERE path='framework/plan/plan.json' AND list='features'")}
        assert before['f1'] == after['f1'] and before['f2'] != after['f2']
        assert c.get('/v1/console/framework/plan/plan.json', headers=H()).json() == plan2
        # plan media: bytes in blobs, a metadata row
        png = b'\x89PNG\r\n\x1a\n' + bytes(range(256))
        assert c.put('/v1/console/framework/plan/media/a.png', content=png, headers=H(**{'content-type': 'image/png', 'if-none-match': '*'})).status_code == 200
        assert c.get('/v1/console/framework/plan/media/a.png', headers=H()).content == png
        assert st.fetchone('SELECT name, ext, size, content_type FROM plan_media') == {'name': 'a.png', 'ext': 'png', 'size': len(png), 'content_type': 'image/png'}
        # the shipped log is a view over the journal
        c.post('/v1/planner/shipped-log:append', json={'entries': [{'build': 'b', 'plan': 'p', 'id': 'sm-b', 'ok': True, 'source': 'cli'}]}, headers=H())
        assert st.fetchone('SELECT build, plan, ok FROM planner_shipped') == {'build': 'b', 'plan': 'p', 'ok': True}

        # backfill: keys written as plain records / blobs before the tables existed move in on the next connect
        st.q("INSERT INTO records (ns, path, data) VALUES ('planner', 'history/old.json', %s)", (json.dumps({'id': 'old', 'versions': [{'v': 1}]}),))
        st.q("INSERT INTO keys (ns, path, kind, rev, etag, at, actor, size, content_type, deleted, entries, table_name) VALUES ('planner', 'history/old.json', 'record', 4, 'e4', 't', 'x', 1, 'application/json', false, 0, '')")
        st.q("INSERT INTO blobs (sha, bytes, size, at) VALUES ('s1', %s, 3, 't')", (b'abc',))
        st.q("INSERT INTO keys (ns, path, kind, rev, etag, at, actor, size, content_type, deleted, entries, table_name, blob_sha) VALUES ('console', 'framework/plan/media/b.jpg', 'blob', 2, 'e2', 't', 'x', 3, 'image/jpeg', false, 0, '', 's1')")
        st.backfill()
        rep = c.get('/v1/_meta/tables', headers=H()).json()['backfill']
        assert rep['moved'] == {'planner_history': 1, 'plan_media': 1} and rep['failed'] == [], rep
        assert st.fetchone("SELECT COUNT(*) AS n FROM records WHERE path='history/old.json'")['n'] == 0
        r = c.get('/v1/planner/history/old.json', headers=H())
        assert r.json() == {'id': 'old', 'versions': [{'v': 1}]}, r.json()
        assert r.headers['etag'] in ('e4', '"e4"'), r.headers
        assert c.get('/v1/console/framework/plan/media/b.jpg', headers=H()).content == b'abc'
        again = st.backfill()   # idempotent: nothing left to move
        assert again['checked'] == 0 and again['moved'] == {}


def test_catalog_tables():
    """s4.3: the feature catalog (a map document), the libraries index and the project rules are rows; tracker is a view."""
    with PgEnv() as c:
        st = c.app.state.store
        status = {'f.a': {'status': 'built', 'wave': 1, 'module': 'kernel'}, 'f.b': {'status': 'planned', 'wave': 2, 'module': {'web': 'x'}, 'notes': 'n'}}
        libs = {'$axf': 'libraries@1', 'generatedAt': 't', 'items': [{'$axf': 'library@1', 'id': 'lib.a', 'name': 'A', 'manifestKey': 'a', 'features': ['f.a']}]}
        rules = json.loads((REPO / 'framework/schemas/project-rules.json').read_text())
        for url, doc in {'/v1/console/framework/catalog/status.json': status, '/v1/console/framework/plan/profiles/all/framework/catalog/status.json': {'f.a': status['f.a']},
                         '/v1/console/framework/catalog/libraries.json': libs, '/v1/console/framework/schemas/project-rules.json': rules}.items():
            assert c.put(url, content=json.dumps(doc), headers=J(**{'if-none-match': '*'})).status_code == 200, url
            assert c.get(url, headers=H()).json() == json.loads(canonical(doc)), url
        assert st.fetchone('SELECT COUNT(*) AS n FROM catalog_features')['n'] == 3
        assert st.fetchone("SELECT status, wave, module, extra FROM catalog_features WHERE path='framework/catalog/status.json' AND rid='f.b'") == {'status': 'planned', 'wave': 2, 'module': None, 'extra': {'module': {'web': 'x'}}}
        assert st.fetchone("SELECT id, notes FROM tracker WHERE path='framework/catalog/status.json' AND id='f.b'") == {'id': 'f.b', 'notes': 'n'}
        assert st.fetchone('SELECT name, manifest_key FROM catalog_libraries') == {'name': 'A', 'manifest_key': 'a'}
        assert st.fetchone("SELECT COUNT(*) AS n FROM project_rules WHERE list='rules'")['n'] == len(rules['rules'])
        # one feature changes: one row is rewritten, the document reads back
        status2 = {**status, 'f.a': {**status['f.a'], 'status': 'partial'}}
        before = {r['rid']: r['doc_hash'] for r in st.fetchall("SELECT rid, doc_hash FROM catalog_features WHERE path='framework/catalog/status.json'")}
        et = c.get('/v1/console/framework/catalog/status.json', headers=H()).headers['etag']
        assert c.put('/v1/console/framework/catalog/status.json', content=json.dumps(status2), headers=J(**{'if-match': et})).status_code == 200
        after = {r['rid']: r['doc_hash'] for r in st.fetchall("SELECT rid, doc_hash FROM catalog_features WHERE path='framework/catalog/status.json'")}
        assert before['f.b'] == after['f.b'] and before['f.a'] != after['f.a']
        assert c.get('/v1/console/framework/catalog/status.json', headers=H()).json() == status2


def test_session_and_change_tables():
    """s4.6: an archived session is a sessions row with its prompts in session_messages; a change is a codebase_changes row."""
    with PgEnv() as c:
        st = c.app.state.store
        sess = {'$axf': 'session-archive@1', 'id': 'cc-1', 'source': 'claude-code', 'sessionId': '1', 'project': 'amberx-axf', 'title': 'Hi', 'startedAt': 't0',
                'minutes': 2, 'user': 'Brett', 'system': {'host': 'vps'}, 'totals': {'prompts': 2},
                'prompts': [{'i': 0, 'at': 't1', 'kind': 'prompt', 'text': 'do it', 'model': 'opus', 'costUsd': 0.5, 'costEstimated': True, 'tools': {'Bash': 1}, 'files': ['a']},
                            {'i': 1, 'at': 't2', 'kind': 'prompt', 'text': 'more', 'costUsd': 1}]}
        url = '/v1/sessions/archive/2026/11/cc-1.json'
        assert c.put(url, content=json.dumps(sess), headers=J(**{'if-none-match': '*'})).status_code == 200
        assert c.get(url, headers=H()).json() == json.loads(canonical(sess))
        assert st.fetchone('SELECT id, title, "user", minutes, extra FROM sessions') == {'id': 'cc-1', 'title': 'Hi', 'user': 'Brett', 'minutes': 2.0, 'extra': {'system': {'host': 'vps'}, 'totals': {'prompts': 2}}}
        assert [(r['rid'], r['text'], r['cost_usd']) for r in st.fetchall('SELECT rid, text, cost_usd FROM session_messages ORDER BY pos')] == [('0', 'do it', 0.5), ('1', 'more', 1.0)]
        assert st.fetchone("SELECT COUNT(*) AS n FROM store_heads WHERE ns='sessions'")['n'] == 0
        c.put('/v1/sessions/archive/2026/11/odd.json', content='{"prompts":"none"}', headers=J(**{'if-none-match': '*'}))
        assert c.get('/v1/sessions/archive/2026/11/odd.json', headers=H()).json() == {'prompts': 'none'}
        et = c.get(url, headers=H()).headers['etag']
        assert c.delete(url, headers=H(**{'if-match': et})).status_code == 200
        assert st.fetchone("SELECT COUNT(*) AS n FROM session_messages WHERE path='archive/2026/11/cc-1.json'")['n'] == 0
        chg = {'$axf': 'change-log@1', 'id': 'chg-1', 'kind': 'fix', 'title': 'T', 'state': 'done', 'createdAt': 't', 'progress': 1, 'steps': [], 'result': {'state': 'ok'}}
        assert c.put('/v1/changes/2026/11/chg-1.json', content=json.dumps(chg), headers=J(**{'if-none-match': '*'})).status_code == 200
        assert c.get('/v1/changes/2026/11/chg-1.json', headers=H()).json() == json.loads(canonical(chg))
        assert st.fetchone('SELECT id, kind, progress, extra FROM codebase_changes') == {'id': 'chg-1', 'kind': 'fix', 'progress': 1.0, 'extra': {'steps': [], 'result': {'state': 'ok'}}}


# ── SQLite mirrors ───────────────────────────────────────────────────────────────────────────────────────────────────

def _ledger_like(path: Path, n: int = 3) -> None:
    db = sqlite3.connect(path)
    db.executescript("""
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE features (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, edit_count INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL DEFAULT 1, doc TEXT NOT NULL);
      CREATE TABLE feature_history (feature_id TEXT NOT NULL, rev INTEGER NOT NULL, at TEXT NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (feature_id, rev));
      CREATE TABLE runs (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, report TEXT NOT NULL);
      CREATE VIRTUAL TABLE fts USING fts5(text, session_id UNINDEXED);
    """)
    db.execute("INSERT INTO meta VALUES ('schema_version', '3')")
    for i in range(n):
        db.execute('INSERT INTO features VALUES (?, ?, ?, ?, ?, ?)', (f'f{i}', f'Feature {i}', 'live', i, 1, json.dumps({'id': f'f{i}', 'name': f'Feature {i}', 'tags': ['a']})))
    db.execute("INSERT INTO feature_history VALUES ('f0', 1, 't', '{\"old\":true}')")
    db.execute("INSERT INTO runs (at, report) VALUES ('t', 'r')")
    db.execute("INSERT INTO fts VALUES ('hello', 's1')")
    db.commit()
    db.close()


def test_sqlite_upload_becomes_rows():
    with PgEnv() as c:
        st = c.app.state.store
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / 'ledger.sqlite'
            _ledger_like(f)
            body = f.read_bytes()
        r = c.put('/v1/plugins/shipped-features/ledger.sqlite', content=body, headers=H(**{'content-type': 'application/vnd.sqlite3', 'if-none-match': '*'})).json()
        assert r['kind'] == 'blob' and r['rev'] == 1
        assert c.get('/v1/plugins/shipped-features/ledger.sqlite', headers=H()).content == body, 'the console still reads the file back (sqliteHydrate)'
        rows = st.fetchall('SELECT id, name, status, edit_count, doc FROM ledger_features ORDER BY id')
        assert [(x['id'], x['edit_count']) for x in rows] == [('f0', 0), ('f1', 1), ('f2', 2)] and rows[0]['doc'] == {'id': 'f0', 'name': 'Feature 0', 'tags': ['a']}, 'doc is JSONB'
        assert st.fetchone('SELECT COUNT(*) AS n FROM ledger_feature_history')['n'] == 1
        assert st.fetchone("SELECT value FROM ledger_meta WHERE key='schema_version'")['value'] == '3'
        assert not [t for t in st.table_names() if t.startswith('ledger_fts')], 'virtual tables and their shadows are not data'
        run = st.fetchone('SELECT prefix, source, ok, tables FROM mirror_runs ORDER BY id DESC LIMIT 1')
        assert run['ok'] and run['tables']['features']['rows'] == 3 and run['source'] == 'plugins/shipped-features/ledger.sqlite'
        # a second upload is a full refresh: rows gone from the file are gone from the table
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / 'ledger.sqlite'
            _ledger_like(f, n=2)
            body2 = f.read_bytes()
        c.put('/v1/plugins/shipped-features/ledger.sqlite', content=body2, headers=H(**{'content-type': 'application/vnd.sqlite3', 'if-match': r['etag']}))
        assert st.fetchone('SELECT COUNT(*) AS n FROM ledger_features')['n'] == 2
        assert c.get('/v1/plugins/shipped-features/ledger.sqlite:history', headers=H()).json()['revs'] == [], 'big mirrored files keep no history copies: the rows are the history'
        tables = c.get('/v1/_meta/tables', headers=H()).json()
        assert {t['name'] for t in tables['tables'] if t['group'] == 'mirror'} >= {'ledger_features', 'ledger_meta', 'ledger_runs'}
        assert tables['mirrors'][0]['prefix'] == 'ledger' and tables['mirrors'][0]['tables']['features']['rows'] == 2
        # an unmapped SQLite blob is just a blob
        c.put('/v1/plugins/other/x.sqlite', content=body, headers=H(**{'content-type': 'application/vnd.sqlite3', 'if-none-match': '*'}))
        assert not [t for t in st.table_names() if t.startswith('other_')]


def test_mirror_sync_from_mounted_file():
    """The Chat viewer db is bigger than a blob may be: mirror_sync.py / POST /v1/_meta/tables/sync read the mounted file."""
    import mirror_sync
    with PgEnv() as c:
        st = c.app.state.store
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / 'chat-viewer').mkdir()
            f = Path(d) / 'chat-viewer' / 'chats.db'
            db = sqlite3.connect(f)
            db.executescript("""
              CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, message_count INTEGER NOT NULL DEFAULT 0, meta TEXT NOT NULL DEFAULT '{}');
              CREATE TABLE messages (session_id TEXT NOT NULL, seq INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY (session_id, seq));
              CREATE TABLE cursors (path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime REAL NOT NULL, offset INTEGER NOT NULL);
              CREATE VIRTUAL TABLE fts USING fts5(text, session_id UNINDEXED, seq UNINDEXED);
            """)
            db.execute("INSERT INTO sessions VALUES ('s1', 'Hello', 2, '{}')")
            db.executemany('INSERT INTO messages VALUES (?, ?, ?, ?)', [('s1', 1, 'user', 'hi'), ('s1', 2, 'assistant', 'hello')])
            db.execute("INSERT INTO cursors VALUES ('/x', 10, 1.5, 3)")
            db.execute("INSERT INTO messages VALUES ('s1', 3, 'user', 'mixed type')")
            db.execute("INSERT INTO cursors VALUES ('/y', 'not a number', 2.5, 0)")  # SQLite lets a text into an INTEGER column
            db.commit()
            db.close()
            os.environ['AXF_DATA_MIRROR_DIR'] = d
            os.environ['AXF_DATA_DSN'] = DSN
            os.environ['AXF_DATA_PG_SCHEMA'] = st.schema
            try:
                assert code(c.post('/v1/_meta/tables/sync', json={'source': 'plugins/nope/x.db'}, headers=H())) == 'invalid_body'
                assert code(c.post('/v1/_meta/tables/sync', json={'source': 'plugins/chat-viewer/chats.db'}, headers=H('console'))) == 'forbidden'
                job = c.post('/v1/_meta/tables/sync', json={'source': 'plugins/chat-viewer/chats.db'}, headers=H()).json()
                assert job['state'] in ('running', 'done'), job
                for _ in range(200):
                    if main._mirror_job['state'] != 'running':
                        break
                    time.sleep(0.05)
                assert main._mirror_job['state'] == 'done', main._mirror_job
                assert st.fetchone('SELECT COUNT(*) AS n FROM chats_messages')['n'] == 3
                assert st.fetchone("SELECT size FROM chats_cursors WHERE path='/y'")['size'] == 'not a number', 'a column SQLite typed loosely falls back to text, nothing lost'
                # the CLI does the same (used by the nightly cron)
                rc = mirror_sync.main(['--all', '--dir', d, '--dsn', DSN, '--schema', st.schema])
                assert rc == 0
                assert st.fetchone('SELECT COUNT(*) AS n FROM mirror_runs WHERE ok')['n'] >= 2
                assert mirror_sync.main(['plugins/nope/x.db', '--dir', d, '--dsn', DSN, '--schema', st.schema]) == 2
            finally:
                for k in ('AXF_DATA_MIRROR_DIR', 'AXF_DATA_DSN', 'AXF_DATA_PG_SCHEMA'):
                    os.environ.pop(k, None)


# ── migration + the staged engine move ──────────────────────────────────────────────────────────────────────────────

def _seed_sqlite(data: Path) -> Store:
    st = Store(data)
    c = Caller('svc:console')
    st.put('builds', 'store.json', json.dumps({'$axf': 'builds@1', 'rev': 2, 'builds': [{'id': 'b1', 'title': 'One', 'status': 'queued', 'steps': [{'id': 's1', 'done': False}]}]}).encode(), 'application/json', c, create=True)
    st.put('builds', 'store.json', json.dumps({'$axf': 'builds@1', 'rev': 3, 'builds': [{'id': 'b1', 'title': 'One', 'status': 'running', 'steps': [{'id': 's1', 'done': True}]}]}).encode(), 'application/json', c, if_match='1')
    st.append('builds', 'journal/2026-11', [{'rev': 2, 'action': 'edit'}, {'rev': 3, 'action': 'step'}], c, idempotency_key='i1')
    st.put('notes', 'handoffs/a.md', b'# A\n', 'text/markdown', c, create=True)
    st.put('ui-review', 'shots/a.png', b'\x89PNG', 'image/png', c, create=True)
    st.put('settings', 'apps/x.json', b'{"a":1}', 'application/json', c, create=True)
    st.put('planner', 'plans/p.json', b'{"$axf":"plan@1","id":"p","title":"P","status":"idea"}', 'application/json', c, create=True)
    st.put('plugins', 'claude-settings/settings.json', b'{"k":1}', 'application/json', c, create=True)
    st.put('plugins', 'claude-settings/gone.json', b'{"k":2}', 'application/json', c, create=True)
    st.delete('plugins', 'claude-settings/gone.json', c, if_match='1')
    st.snapshot(['builds'], Caller('svc:cli'))
    return st


def test_migrate_sqlite_to_postgres():
    import migrate_pg
    with tempfile.TemporaryDirectory() as d:
        data = Path(d) / 'data'
        src = _seed_sqlite(data)
        schema = schema_name()
        from pg import PgStore
        pg = PgStore(DSN, data, schema=schema)
        try:
            n = migrate_pg.copy(src, pg, log=lambda *a: None)
            assert n['keys'] == src.db.execute('SELECT COUNT(*) FROM keys').fetchone()[0] and n['journalLines'] == 2 and n['changes'] >= 10
            v = migrate_pg.verify(src, pg)
            assert v['ok'], v['problems']
            assert v['counts']['sqlite'] == v['counts']['postgres'] and all(m['equal'] for m in v['manifests'].values())
            # same revs, etags, history and feed on both sides; bodies in their tables
            assert pg._row('builds', 'store.json')['etag'] == src._row('builds', 'store.json')['etag']
            assert pg._row('builds', 'store.json')['rev'] == 2 and pg._row('plugins', 'claude-settings/gone.json')['deleted'] is True
            assert pg.fetchone('SELECT COUNT(*) AS n FROM builds')['n'] == 1 and pg.fetchone("SELECT status FROM builds")['status'] == 'running'
            assert pg.journal.history('builds', 'store.json')['revs'][1]['rev'] == 1
            assert pg.changes(0)['cursor'] == src.changes(0)['cursor']
            assert pg.read('builds', 'journal/2026-11')['entries'][1]['entry'] == {'rev': 3, 'action': 'step'}
            assert pg.fetchone("SELECT value FROM idem WHERE k LIKE '%#i1'")['value']['first'] == 1
            assert json.loads(pg.get('builds', 'store.json')[1]) == json.loads(src.get('builds', 'store.json')[1])
            # a later write on one side is caught by verify
            src.put('notes', 'handoffs/b.md', b'x', 'text/markdown', Caller('svc:cli'), create=True)
            v2 = migrate_pg.verify(src, pg)
            assert not v2['ok'] and any('notes' in p for p in v2['problems'])
            # the CLI: refuses a non-empty target without --replace, then copies again cleanly (no backup here: pg_dump-less host)
            os.environ['AXF_DATA_PG_SCHEMA'] = schema
            try:
                assert migrate_pg.main(['--data', str(data), '--dsn', DSN, '--schema', schema, '--no-backup', '--json']) == 2
                assert migrate_pg.main(['--data', str(data), '--dsn', DSN, '--schema', schema, '--no-backup', '--replace', '--json']) == 0
                assert migrate_pg.main(['--data', str(data), '--dsn', DSN, '--schema', schema, '--verify']) == 0
                assert migrate_pg.main(['--data', str(Path(d) / 'nowhere'), '--dsn', DSN, '--schema', schema]) == 1
            finally:
                os.environ.pop('AXF_DATA_PG_SCHEMA', None)
        finally:
            PgStore(DSN, data, schema=schema).drop_everything()


def test_engine_shadow_then_cutover():
    import engine
    import migrate_pg
    with tempfile.TemporaryDirectory() as d:
        data = Path(d) / 'data'
        src = _seed_sqlite(data)
        schema = schema_name()
        from pg import PgStore
        try:
            # no DSN → SQLite; DSN + fresh volume → Postgres; DSN + an existing SQLite store → the staged engine
            assert isinstance(engine.open_store(Path(d) / 'empty'), Store)
            fresh = engine.open_store(Path(d) / 'fresh', dsn=DSN, schema=schema)
            assert fresh.engine == 'postgres' and json.loads((Path(d) / 'fresh' / 'engine.json').read_text())['mode'] == 'postgres'
            fresh.drop_everything()
            pg = PgStore(DSN, data, schema=schema)
            migrate_pg.copy(src, pg, log=lambda *a: None)
            st = engine.open_store(data, dsn=DSN, schema=schema)
            assert isinstance(st, engine.EngineStore) and st.mode == 'shadow'
            c = pg_make_client(Path(d), store=st)
            try:
                e = c.get('/v1/_meta/engine', headers=H()).json()
                assert e['mode'] == 'shadow' and e['countsEqual'] and e['drift'] == 0 and e['next'] == 'cut-over'
                assert c.get('/v1/health').json()['engine'] == {'kind': 'sqlite', 'mode': 'shadow', 'drift': 0, 'since': e['since']}
                # writes land on both sides with the same rev / etag
                r = c.put('/v1/builds/store.json', content=json.dumps({'$axf': 'builds@1', 'rev': 4, 'builds': []}), headers=J(**{'if-match': '2'})).json()
                a = c.post('/v1/builds/journal/2026-11:append', json={'entries': [{'rev': 4}]}, headers=H()).json()
                assert r['rev'] == 3 and a['first'] == 3
                assert st.pg._row('builds', 'store.json')['etag'] == r['etag'] and st.sqlite._row('builds', 'store.json')['etag'] == r['etag']
                assert st.pg._row('builds', 'journal/2026-11')['entries'] == 3
                d1 = c.delete('/v1/notes/handoffs/a.md', headers=H(**{'if-match': '1'})).json()
                assert d1['deleted'] and st.pg._row('notes', 'handoffs/a.md')['deleted'] is True
                # a restore goes through the engine too
                assert c.post('/v1/builds/store.json:restore', json={'rev': 1}, headers=H()).json()['rev'] == 4
                assert st.pg._row('builds', 'store.json')['rev'] == 4
                assert c.get('/v1/_meta/engine', headers=H()).json()['drift'] == 0
                # a mismatch on the mirror is drift, never an error for the caller
                st.pg.put('builds', 'drifted.json', b'{"x":1}', 'application/json', Caller('svc:test'), create=True)
                ok = c.put('/v1/builds/drifted.json', content='{"x":2}', headers=J(**{'if-none-match': '*'}))
                assert ok.status_code == 200
                e = c.get('/v1/_meta/engine', headers=H()).json()
                assert e['drift'] == 1 and e['drift_tail'][0]['kind'] == 'write-failed' and 'exists' in e['drift_tail'][0]['error']
                assert code(c.post('/v1/_meta/engine', json={'mode': 'postgres'}, headers=H())) == 'invalid_body', 'cut-over with drift needs acceptDrift'
                assert code(c.post('/v1/_meta/engine', json={'mode': 'postgres'}, headers=H('console'))) == 'forbidden'
                assert code(c.post('/v1/_meta/engine', json={'mode': 'nope'}, headers=H())) == 'invalid_body'
                # cut over with the drift read and accepted
                e = c.post('/v1/_meta/engine', json={'mode': 'postgres', 'acceptDrift': True}, headers=H()).json()
                assert e['mode'] == 'postgres' and e['next'] == 'done' and e['drift'] == 0, 'a move starts a fresh drift count'
                # roll back to shadow, back to sqlite (always allowed); sqlite → postgres directly is not
                assert c.post('/v1/_meta/engine', json={'mode': 'shadow'}, headers=H()).json()['mode'] == 'shadow'
                assert c.post('/v1/_meta/engine', json={'mode': 'sqlite'}, headers=H()).json()['mode'] == 'sqlite'
                assert code(c.post('/v1/_meta/engine', json={'mode': 'postgres'}, headers=H())) == 'invalid_body'
                # shadow needs equal counts on both sides
                st.pg.put('builds', 'only-on-postgres.json', b'{}', 'application/json', Caller('svc:test'), create=True)
                r = c.post('/v1/_meta/engine', json={'mode': 'shadow'}, headers=H())
                assert code(r) == 'invalid_body' and 'counts differ' in r.json()['message']
                st.pg.delete('builds', 'only-on-postgres.json', Caller('svc:test'), force=True)
                assert c.post('/v1/_meta/engine', json={'mode': 'shadow'}, headers=H()).json()['mode'] == 'shadow'
                e = c.post('/v1/_meta/engine', json={'mode': 'postgres'}, headers=H()).json()
                assert e['mode'] == 'postgres' and e['next'] == 'done'
                assert json.loads((data / 'engine.json').read_text())['mode'] == 'postgres'
                # reads now come from Postgres: a write lands there only, SQLite stays as it was
                c.put('/v1/builds/after.json', content='{}', headers=J(**{'if-none-match': '*'}))
                assert st.pg._row('builds', 'after.json') and not st.sqlite._row('builds', 'after.json')
                assert c.get('/v1/health').json()['engine']['kind'] == 'postgres'
                assert c.get('/v1/_meta/tables', headers=H()).json()['engine'] == 'postgres'
                # roll back to shadow, then the same process restarted keeps the mode from engine.json
                assert c.post('/v1/_meta/engine', json={'mode': 'shadow'}, headers=H()).json()['mode'] == 'shadow'
                st2 = engine.open_store(data, dsn=DSN, schema=schema)
                assert st2.mode == 'shadow'
            finally:
                st.pg.drop_everything()
        finally:
            try:
                PgStore(DSN, data, schema=schema).drop_everything()
            except Exception:  # noqa: BLE001
                pass


# ── pg_dump backups ─────────────────────────────────────────────────────────────────────────────────────────────────

def test_backup_pg_dump():
    import shutil
    import backup
    if not (shutil.which('pg_dump') or os.environ.get('AXF_DATA_PG_TOOLS')):
        print('    (pg_dump not here and AXF_DATA_PG_TOOLS unset: backup test skipped)')
        return
    with PgEnv() as c:
        st = c.app.state.store
        os.environ['AXF_DATA_DSN'] = DSN
        os.environ['AXF_DATA_PG_SCHEMA'] = st.schema
        try:
            c.put('/v1/builds/store.json', content='{"a":1}', headers=J(**{'if-none-match': '*'}))
            c.post('/v1/builds/journal/2026-11:append', json={'entries': [{'x': 1}, {'x': 2}]}, headers=H())
            c.put('/v1/ui-review/shots/a.png', content=b'png', headers=H(**{'content-type': 'image/png', 'if-none-match': '*'}))
            out = Path(st.dir).parent / 'backups'
            dsn = st.dsn + ('&' if '?' in st.dsn else '?') + f'options=-csearch_path%3D{st.schema}'
            r = backup.run(st.dir, out, dsn=dsn, schema=st.schema)
            assert r['verify']['ok'], r['verify']
            assert r['engine'] == 'postgres' and r['counts'] == {'builds': 2, 'ui-review': 1} and r['tables']['keys'] == 3 and r['tables']['journal'] == 2
            assert json.loads((out / 'last.json').read_text())['verify']['ok'] is True
            # a write after the backup is explained by the feed; a key lost without one is not
            c.put('/v1/builds/b.json', content='{}', headers=J(**{'if-none-match': '*'}))
            v = backup.verify(out / r['file'], st.dir, dsn=dsn)
            assert v['ok'] and v['diffs'] == [{'ns': 'builds', 'backup': 2, 'live': 3, 'explained': True}]
            st.q("DELETE FROM keys WHERE ns='ui-review'")
            v = backup.verify(out / r['file'], st.dir, dsn=dsn)
            assert not v['ok'] and 'ui-review' in v['problems'][0]
            # restore needs --force over a live store, then puts the rows back
            try:
                backup.restore(out / r['file'], st.dir, dsn=dsn)
                raise AssertionError('restore over a live store needs --force')
            except SystemExit:
                pass
            rr = backup.restore(out / r['file'], st.dir, force=True, dsn=dsn)
            assert rr['ok'] and rr['counts'] == r['counts'], rr
            st.db.close()
            assert json.loads(st.get('builds', 'store.json')[1]) == {'a': 1} and st.get('ui-review', 'shots/a.png')[1] == b'png'
        finally:
            os.environ.pop('AXF_DATA_DSN', None)
            os.environ.pop('AXF_DATA_PG_SCHEMA', None)


def test_node_contract_live_on_postgres():
    """framework/spec/check-data-store.mjs --http against a server running on Postgres."""
    import shutil
    import socket
    import subprocess
    check = REPO / 'framework/spec/check-data-store.mjs'
    if not shutil.which('node') or not check.is_file():
        return
    schema = schema_name()
    with tempfile.TemporaryDirectory() as d:
        tf = Path(d) / 'tokens.json'
        tf.write_text(json.dumps({'tokens': [{'id': 'a', 'sub': 'svc:cli', 'sha256': __import__('hashlib').sha256(b'live').hexdigest(), 'grants': {'*': ['admin']}}]}))
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            port = s.getsockname()[1]
        env = {**os.environ, 'AXF_DATA_DIR': str(Path(d) / 'data'), 'AXF_DATA_TOKENS_FILE': str(tf), 'AXF_DATA_NO_APP': '0', 'AXF_DATA_DSN': DSN, 'AXF_DATA_PG_SCHEMA': schema}
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
            from pg import PgStore
            PgStore(DSN, Path(d) / 'data', schema=schema).drop_everything()


if __name__ == '__main__':
    if not DSN:
        print('axf-data on Postgres: skipped (AXF_DATA_TEST_DSN unset)')
        sys.exit(0)
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
    print(f'axf-data on Postgres: {"all ok" if not fails else f"{fails} failed"}')
    sys.exit(1 if fails else 0)
