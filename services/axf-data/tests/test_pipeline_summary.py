#!/usr/bin/env python3
"""Pipeline status on Postgres: one build's row read and changed by id (nothing else written), and the summary every
status caller reads (counts by status, the one Queued build, the running builds with slot and account), computed in SQL.

    AXF_DATA_TEST_DSN=postgresql://postgres:pw@127.0.0.1:5432/postgres python3 services/axf-data/tests/test_pipeline_summary.py
    (each test runs in its own schema and drops it; nothing else in the database is touched)

Without AXF_DATA_TEST_DSN the file prints "skipped" and exits 0.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
os.environ['AXF_DATA_NO_APP'] = '1'
os.environ['AXF_DATA_BACKFILL'] = '0'
DSN = os.environ.get('AXF_DATA_TEST_DSN', '')

import tables as T  # noqa: E402
from store import Caller, canonical  # noqa: E402

WHO = Caller(by='test')

STEP = {'title': '', 'done': False, 'skip': False}
DOC = {'$axf': 'builds@1', 'rev': 7, 'updatedAt': 't0', 'rules': {}, 'meta': {}, 'drafts': {}, 'builds': [
    {'id': 'draft', 'title': 'Draft', 'status': 'pending', 'rev': 1, 'updatedAt': '2026-11-20T00:00:00.000Z', 'steps': [], 'notes': []},
    {'id': 'later', 'title': 'Queued later', 'status': 'queued', 'rev': 2, 'priority': 'high', 'updatedAt': '2026-11-21T00:00:00.000Z',
     'pipeline': {'queuedAt': '2026-11-21T09:00:00.000Z', 'model': 'Opus'}, 'steps': [{**STEP, 'id': 's1'}], 'notes': []},
    {'id': 'first', 'title': 'Queued first', 'status': 'queued', 'rev': 4, 'updatedAt': '2026-11-21T00:00:00.000Z',
     'pipeline': {'queuedAt': '2026-11-21T08:00:00.000Z', 'model': 'Fable'}, 'steps': [], 'notes': []},
    {'id': 'old-run', 'title': 'One session', 'status': 'running', 'rev': 3, 'updatedAt': '2026-11-22T00:00:00.000Z',
     'pipeline': {'slot': 'slot-1', 'account': 'w-max', 'session': 'axf-old-run', 'model': 'Fable', 'launchedAt': '2026-11-22T01:00:00.000Z'},
     'steps': [{**STEP, 'id': 's1', 'model': 'Fable'}], 'notes': [{'at': 't', 'text': 'launched'}]},
    {'id': 'p2-run', 'title': 'Steps in slots', 'status': 'building', 'flow': 'pipeline-2', 'rev': 9, 'updatedAt': '2026-11-23T00:00:00.000Z',
     'steps': [{**STEP, 'id': 's1', 'model': 'Opus', 'status': 'completed', 'done': True, 'slot': 'slot-2', 'account': 'w-pro', 'tmux': 'axf-p2-run--s1'},
               {**STEP, 'id': 's2', 'model': 'Fable', 'status': 'building', 'slot': 'slot-3', 'account': 'w-max', 'tmux': 'axf-p2-run--s2'},
               {**STEP, 'id': 's3', 'model': 'Opus', 'status': 'sending', 'slot': '', 'account': 'w-pro'},
               {**STEP, 'id': 's4', 'model': 'Opus', 'status': 'ready'}], 'notes': []},
    {'id': 'done', 'title': 'Landed', 'status': 'landed', 'rev': 5, 'updatedAt': '2026-11-19T00:00:00.000Z', 'steps': [], 'notes': []},
    {'id': 'gone', 'title': 'Deleted', 'status': 'running', 'deleted': True, 'rev': 1, 'pipeline': {'slot': 'slot-9', 'account': 'x'}, 'steps': [], 'notes': []},
]}


class Env:
    def __enter__(self):
        from pg import PgStore
        self.tmp = tempfile.TemporaryDirectory()
        self.st = PgStore(DSN, Path(self.tmp.name) / 'data', schema='t_' + uuid.uuid4().hex[:12])
        self.st.put('builds', 'store.json', json.dumps(DOC).encode(), 'application/json', WHO, create=True)
        return self.st

    def __exit__(self, *a):
        try:
            self.st.drop_everything()
        finally:
            self.tmp.cleanup()


def stored(st) -> dict:
    """The document assembled from the rows (not the engine's cached body)."""
    with st.tx() as cur:
        return json.loads(T.BUILDS.read(cur, 'builds', 'store.json'))


def test_build_row_reads_one_build():
    with Env() as st:
        with st.tx() as cur:
            for b in DOC['builds']:
                assert T.build_row(cur, b['id']) == json.loads(canonical(b)), b['id']
            assert T.build_row(cur, 'nope') is None
            assert T.build_row(cur, 'old-run', lock=True)['pipeline']['slot'] == 'slot-1'


def test_single_row_update_touches_one_row():
    with Env() as st:
        before = {r['rid']: r for r in st.fetchall('SELECT rid, pos, doc_hash, xmin::text AS xmin FROM builds')}
        steps_before = {(r['parent_rid'], r['pos']): r['xmin'] for r in st.fetchall('SELECT parent_rid, pos, xmin::text AS xmin FROM build_steps')}
        head_before = st.fetchone("SELECT head FROM store_heads WHERE ns='builds' AND path='store.json'")['head']
        with st.tx() as cur:
            out = T.build_update(cur, 'draft', {'status': 'queued', 'rev': 2, 'updatedAt': '2026-11-24T00:00:00.000Z', 'pipeline': {'queuedAt': '2026-11-24T00:00:00.000Z'}}, if_rev=1)
        want = {**DOC['builds'][0], 'status': 'queued', 'rev': 2, 'updatedAt': '2026-11-24T00:00:00.000Z', 'pipeline': {'queuedAt': '2026-11-24T00:00:00.000Z'}}
        assert out == want
        after = {r['rid']: r for r in st.fetchall('SELECT rid, pos, doc_hash, xmin::text AS xmin FROM builds')}
        assert [k for k in after if after[k] != before[k]] == ['draft'], 'only the changed build row is written'
        assert after['draft']['pos'] == before['draft']['pos']
        assert {(r['parent_rid'], r['pos']): r['xmin'] for r in st.fetchall('SELECT parent_rid, pos, xmin::text AS xmin FROM build_steps')} == steps_before, 'no step row is written'
        assert st.fetchone("SELECT head FROM store_heads WHERE ns='builds' AND path='store.json'")['head'] == head_before, 'the head is not written'
        row = st.fetchone("SELECT status, rev, updated_at, extra, children_lifted FROM builds WHERE rid='draft'")
        assert (row['status'], row['rev'], row['updated_at']) == ('queued', 2, '2026-11-24T00:00:00.000Z'), 'the lifted columns move with the item'
        assert row['extra'] == {'pipeline': {'queuedAt': '2026-11-24T00:00:00.000Z'}} and row['children_lifted'] == {'steps': True, 'notes': True}
        # the document read back is the old one with that build changed; a whole-store put of it rewrites nothing (same hash)
        doc = stored(st)
        assert doc == json.loads(canonical({**DOC, 'builds': [want, *DOC['builds'][1:]]}))
        from store import sha
        assert after['draft']['doc_hash'] == sha(canonical(want).encode('utf-8'))[:32]
        # a stale rev is refused and nothing is written; a missing build is a KeyError; the id cannot change
        for bad, exc in (({'if_rev': 1}, T.RowConflict), ({'build': 'nope'}, KeyError)):
            try:
                with st.tx() as cur:
                    T.build_update(cur, bad.get('build', 'draft'), {'status': 'pending'}, if_rev=bad.get('if_rev', 2))
                raise AssertionError(f'{exc.__name__} expected')
            except exc as e:
                if exc is T.RowConflict:
                    assert (e.key, e.have, e.expected) == ('draft', 2, 1)
        try:
            with st.tx() as cur:
                T.build_update(cur, 'draft', {'id': 'other'})
            raise AssertionError('ValueError expected')
        except ValueError:
            pass
        assert stored(st) == doc
        # drop removes a key; a value that does not fit its column stays in extra
        with st.tx() as cur:
            out = T.build_update(cur, 'draft', {'pr': 705, 'branch': 'claude/x'}, drop=['pipeline'])
        assert 'pipeline' not in out and out['pr'] == 705
        row = st.fetchone("SELECT pr, branch, extra FROM builds WHERE rid='draft'")
        assert row['pr'] is None and row['branch'] == 'claude/x' and row['extra'] == {'pr': 705}
        with st.tx() as cur:
            assert T.build_row(cur, 'draft') == out
        # steps named in the update are rewritten, for that build only
        other = st.fetchall("SELECT parent_rid, pos, xmin::text AS xmin FROM build_steps WHERE parent_rid <> 'old-run'")
        with st.tx() as cur:
            out = T.build_update(cur, 'old-run', {'steps': [{**STEP, 'id': 's1', 'model': 'Fable', 'done': True}, {**STEP, 'id': 's2'}]})
        assert [s['id'] for s in out['steps']] == ['s1', 's2'] and out['notes'] == [{'at': 't', 'text': 'launched'}]
        assert st.fetchall("SELECT id, done FROM build_steps WHERE parent_rid='old-run' ORDER BY pos") == [{'id': 's1', 'done': True}, {'id': 's2', 'done': False}]
        assert st.fetchall("SELECT parent_rid, pos, xmin::text AS xmin FROM build_steps WHERE parent_rid <> 'old-run'") == other
        assert st.fetchone("SELECT COUNT(*) AS n FROM build_notes WHERE parent_rid='old-run'")['n'] == 1
        with st.tx() as cur:
            assert T.build_row(cur, 'old-run') == json.loads(canonical(out))


def test_update_locks_only_its_row():
    import threading
    import psycopg
    from psycopg.rows import dict_row
    from pg import _dsn_with_schema
    with Env() as st:
        other = psycopg.connect(_dsn_with_schema(st.dsn, st.schema), row_factory=dict_row)
        try:
            other.execute("SELECT 1 FROM builds WHERE section='builds' AND rid='first' FOR UPDATE")
            done = {}

            def go():
                with st.tx() as cur:
                    done['status'] = T.build_update(cur, 'later', {'status': 'pending'})['status']

            t = threading.Thread(target=go)
            t.start()
            t.join(timeout=5)
            assert done.get('status') == 'pending', 'updating one build waited on the lock of another'
        finally:
            other.rollback()
            other.close()


def test_summary_shape():
    with Env() as st:
        with st.tx() as cur:
            s = T.pipeline_summary(cur)
        assert set(s) == {'$axf', 'counts', 'total', 'queued', 'running', 'updatedAt'} and s['$axf'] == 'pipeline-summary@1'
        assert s['counts'] == {'pending': 1, 'queued': 2, 'running': 1, 'building': 1, 'landed': 1}, 'deleted builds are not counted'
        assert s['total'] == 6 == sum(s['counts'].values())
        assert s['queued'] == {'id': 'first', 'title': 'Queued first', 'status': 'queued', 'rev': 4, 'priority': None, 'queuedAt': '2026-11-21T08:00:00.000Z', 'model': 'Fable'}
        assert s['running'] == [
            {'id': 'old-run', 'title': 'One session', 'status': 'running', 'rev': 3, 'slot': 'slot-1', 'account': 'w-max', 'session': 'axf-old-run',
             'model': 'Fable', 'launchedAt': '2026-11-22T01:00:00.000Z', 'steps': []},
            {'id': 'p2-run', 'title': 'Steps in slots', 'status': 'building', 'rev': 9, 'slot': None, 'account': None, 'session': None, 'model': None, 'launchedAt': None,
             'steps': [{'id': 's2', 'status': 'building', 'model': 'Fable', 'slot': 'slot-3', 'account': 'w-max', 'session': 'axf-p2-run--s2'},
                       {'id': 's3', 'status': 'sending', 'model': 'Opus', 'slot': None, 'account': 'w-pro', 'session': None}]}]
        assert s['updatedAt'] == '2026-11-23T00:00:00.000Z'
        assert len(canonical(s)) < 2000, 'the summary stays small'
        # a status change of one row shows in the next summary: the queue moves up, the slot is freed
        with st.tx() as cur:
            T.build_update(cur, 'first', {'status': 'running', 'rev': 5, 'updatedAt': '2026-11-25T00:00:00.000Z',
                                          'pipeline': {'slot': 'slot-4', 'account': 'w-pro', 'session': 'axf-first', 'model': 'Fable'}}, if_rev=4)
            T.build_update(cur, 'old-run', {'status': 'pending', 'pipeline': {}})
            T.build_update(cur, 'later', {'status': 'pending'}, drop=['pipeline'])
            s = T.pipeline_summary(cur)
        assert s['counts'] == {'pending': 3, 'running': 1, 'building': 1, 'landed': 1} and s['queued'] is None
        assert [(r['id'], r['slot'], r['account']) for r in s['running']] == [('first', 'slot-4', 'w-pro'), ('p2-run', None, None)]
        assert s['updatedAt'] == '2026-11-25T00:00:00.000Z'
        # a build whose own status is not a running one still shows while one of its steps runs
        with st.tx() as cur:
            T.build_update(cur, 'p2-run', {'status': 'failed'})
            assert [r['id'] for r in T.pipeline_summary(cur)['running']] == ['first', 'p2-run']


def test_summary_of_an_empty_store():
    with Env() as st:
        st.put('builds', 'store.json', json.dumps({**DOC, 'builds': []}).encode(), 'application/json', WHO, if_match=st.get('builds', 'store.json')[0]['etag'])
        with st.tx() as cur:
            assert T.pipeline_summary(cur) == {'$axf': 'pipeline-summary@1', 'counts': {}, 'total': 0, 'queued': None, 'running': [], 'updatedAt': ''}


if __name__ == '__main__':
    if not DSN:
        print('axf-data pipeline summary: skipped (AXF_DATA_TEST_DSN unset)')
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
    print(f'axf-data pipeline summary: {"all ok" if not fails else f"{fails} failed"}')
    sys.exit(1 if fails else 0)
