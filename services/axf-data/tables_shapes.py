"""Generic row shapes for the console's and the plugins' documents (build postgres-part-c-console-state-settings, Nov 19
2026). Used by tables_console.py and tables_plugins.py; registered in tables.py (TABLES), so pg.py sees one registry.

  KvTable          a JSON object → one row per top-level key (or per entry of the object at `map_key`)
  ArrayTable       a JSON array, or one list inside a document (`list_key`), → one row per item, an optional child list
  MapTable         an object of id → object (hub-table@1 chunks) → one row per id
  PathRecordTable  one row per document for one path family of a shared namespace
  TextTable        UTF-8 text blobs (Markdown) → one row per file
  retable()        moves records a newer table claims out of `records` (and text blobs out of `blobs`) into its rows
"""
from __future__ import annotations

import json
import re
from typing import Any

from psycopg.types.json import Jsonb

from store import canonical
from tables import _MISSING, Col, RecordTable, _ddl_cols, lift, unlift  # noqa: F401  (tables imports this module after defining them)


# ── shapes ─────────────────────────────────────────────────────────────────────────────────────────────────────────
#
# Each is one family of rows keyed by (ns, path, …), so one table holds every document of its kind (console_state holds
# state.json, host-check.json, nightly.json…; plugin_settings holds every plugin's settings.json). A body whose shape does
# not fit (an object where a list was expected) is not claimed and stays in `records`: nothing is coerced.

class _PathTable:
    kind = 'record'

    def __init__(self, name: str, ns: str, path_re: str, holds: str, cols: list[Col] | None = None):
        self.name, self.ns, self.holds, self.cols = name, ns, holds, list(cols or [])
        self.path_re = re.compile(path_re)

    def _claims(self, ns: str, path: str, kind: str) -> bool:
        return kind == self.kind and ns == self.ns and bool(self.path_re.match(path))

    def delete(self, cur, ns: str, path: str) -> None:
        cur.execute(f'DELETE FROM "{self.name}" WHERE ns=%s AND path=%s', (ns, path))
        cur.execute('DELETE FROM store_heads WHERE ns=%s AND path=%s', (ns, path))

    def _head(self, cur, ns: str, path: str, head: Any) -> None:
        cur.execute('INSERT INTO store_heads (ns, path, head, lists) VALUES (%s, %s, %s, %s) ON CONFLICT (ns, path) DO UPDATE SET head=EXCLUDED.head, lists=EXCLUDED.lists',
                    (ns, path, Jsonb(head, dumps=canonical), Jsonb([self.name])))

    def _head_of(self, cur, ns: str, path: str):
        cur.execute('SELECT head FROM store_heads WHERE ns=%s AND path=%s', (ns, path))
        r = cur.fetchone()
        return r['head'] if r else _MISSING


class KvTable(_PathTable):
    """A JSON object → one row per top-level key (`key`, `value` JSONB, `pos` keeps the key order). console_state,
    plugin_settings: small single-object documents, each setting queryable on its own. With `map_key` the rows are the
    entries of the object at that key (sections-said: `said` → one row per section) and the other fields go to store_heads."""

    def __init__(self, name: str, ns: str, path_re: str, holds: str, map_key: str = ''):
        super().__init__(name, ns, path_re, holds)
        self.map_key = map_key

    def match(self, ns: str, path: str, kind: str, content_type: str, body: bytes) -> bool:
        return self._claims(ns, path, kind) and body.lstrip().startswith(b'{')

    def write(self, cur, ns: str, path: str, body: bytes) -> None:
        doc = json.loads(body.decode('utf-8'))
        head: dict = {}
        if self.map_key:
            head = dict(doc)
            m = head.pop(self.map_key, _MISSING)
            lifted = isinstance(m, dict)
            if not lifted and m is not _MISSING:
                head[self.map_key] = m
            doc = m if lifted else {}
            head = {'head': head, 'lifted': lifted}
        cur.execute(f'DELETE FROM "{self.name}" WHERE ns=%s AND path=%s', (ns, path))
        rows = [(ns, path, i, k, Jsonb(v, dumps=canonical)) for i, (k, v) in enumerate(doc.items())]
        if rows:
            cur.executemany(f'INSERT INTO "{self.name}" (ns, path, pos, key, value) VALUES (%s, %s, %s, %s, %s)', rows)
        self._head(cur, ns, path, head)

    def read(self, cur, ns: str, path: str) -> bytes | None:
        h = self._head_of(cur, ns, path)
        if h is _MISSING:
            return None
        cur.execute(f'SELECT key, value FROM "{self.name}" WHERE ns=%s AND path=%s ORDER BY pos', (ns, path))
        kv = {r['key']: r['value'] for r in cur.fetchall()}
        if self.map_key:
            return canonical({**h['head'], self.map_key: kv} if h.get('lifted') else h['head']).encode('utf-8')
        return canonical(kv).encode('utf-8')

    def ddl(self) -> str:
        return (f'CREATE TABLE IF NOT EXISTS "{self.name}" (ns TEXT NOT NULL, path TEXT NOT NULL, pos INTEGER NOT NULL, key TEXT NOT NULL, '
                f'value JSONB, PRIMARY KEY (ns, path, key));')


class ArrayTable(_PathTable):
    """A JSON array → one row per item (`pos` keeps the order). Object items lift `cols` and keep the rest in `extra`;
    scalar items (alerts-seen run ids) sit in `value`. A body `{ <listKey>: [...], ... }` is claimed too when `list_key`
    is set: the list becomes rows and the other fields go to store_heads (app catalog)."""

    def __init__(self, name: str, ns: str, path_re: str, holds: str, cols: list[Col] | None = None, list_key: str = '',
                 child: tuple[str, str, list[Col]] | None = None):
        super().__init__(name, ns, path_re, holds, cols)
        self.list_key, self.child = list_key, child

    def match(self, ns: str, path: str, kind: str, content_type: str, body: bytes) -> bool:
        if not self._claims(ns, path, kind):
            return False
        b = body.lstrip()
        return b.startswith(b'{') if self.list_key else b.startswith(b'[')

    def _items(self, doc: Any) -> tuple[list, Any]:
        if self.list_key:
            if not isinstance(doc, dict) or not isinstance(doc.get(self.list_key), list):
                return [], doc
            head = dict(doc)
            return head.pop(self.list_key), head
        return doc, None

    def write(self, cur, ns: str, path: str, body: bytes) -> None:
        doc = json.loads(body.decode('utf-8'))
        items, head = self._items(doc)
        lifted = self.list_key == '' or isinstance(doc, dict) and isinstance(doc.get(self.list_key), list)
        cur.execute(f'DELETE FROM "{self.name}" WHERE ns=%s AND path=%s', (ns, path))
        if self.child:
            cur.execute(f'DELETE FROM "{self.child[1]}" WHERE ns=%s AND path=%s', (ns, path))
        names = ''.join(f', "{c.name}"' for c in self.cols)
        rows, kids = [], []
        for pos, it in enumerate(items):
            if isinstance(it, dict):
                vals, extra = lift(it, self.cols)
                has_kids = False
                if self.child and isinstance(extra.get(self.child[0]), list) and all(isinstance(k, dict) for k in extra[self.child[0]]):
                    for cpos, kid in enumerate(extra.pop(self.child[0])):
                        cv, cx = lift(kid, self.child[2])
                        kids.append((ns, path, pos, cpos, *[cv[c.name] for c in self.child[2]], Jsonb(cx, dumps=canonical)))
                    has_kids = True
                rows.append((ns, path, pos, True, *[vals[c.name] for c in self.cols], Jsonb(extra, dumps=canonical), has_kids))
            else:
                rows.append((ns, path, pos, False, *[None for _ in self.cols], Jsonb(it, dumps=canonical), False))
        if rows:
            cur.executemany(f'INSERT INTO "{self.name}" (ns, path, pos, is_obj{names}, extra, has_kids) VALUES (%s, %s, %s, %s{", %s" * len(self.cols)}, %s, %s)', rows)
        if kids:
            cnames = ''.join(f', "{c.name}"' for c in self.child[2])
            cur.executemany(f'INSERT INTO "{self.child[1]}" (ns, path, parent_pos, pos{cnames}, extra) VALUES (%s, %s, %s, %s{", %s" * len(self.child[2])}, %s)', kids)
        self._head(cur, ns, path, {'head': head, 'lifted': lifted} if self.list_key else {})

    def read(self, cur, ns: str, path: str) -> bytes | None:
        h = self._head_of(cur, ns, path)
        if h is _MISSING:
            return None
        if self.list_key and not h.get('lifted'):
            return canonical(h.get('head')).encode('utf-8')
        kids: dict[int, list] = {}
        if self.child:
            cur.execute(f'SELECT * FROM "{self.child[1]}" WHERE ns=%s AND path=%s ORDER BY parent_pos, pos', (ns, path))
            for r in cur.fetchall():
                kids.setdefault(r['parent_pos'], []).append(unlift(r, self.child[2], r['extra']))
        cur.execute(f'SELECT * FROM "{self.name}" WHERE ns=%s AND path=%s ORDER BY pos', (ns, path))
        items = []
        for r in cur.fetchall():
            if not r['is_obj']:
                items.append(r['extra'])
                continue
            it = unlift(r, self.cols, r['extra'])
            if r['has_kids']:
                it[self.child[0]] = kids.get(r['pos'], [])
            items.append(it)
        if self.list_key:
            return canonical({**h['head'], self.list_key: items}).encode('utf-8')
        return canonical(items).encode('utf-8')

    def delete(self, cur, ns: str, path: str) -> None:
        if self.child:
            cur.execute(f'DELETE FROM "{self.child[1]}" WHERE ns=%s AND path=%s', (ns, path))
        super().delete(cur, ns, path)

    def ddl(self) -> str:
        out = [f'CREATE TABLE IF NOT EXISTS "{self.name}" (ns TEXT NOT NULL, path TEXT NOT NULL, pos INTEGER NOT NULL, is_obj BOOLEAN NOT NULL{_ddl_cols(self.cols)}, '
               f'extra JSONB, has_kids BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY (ns, path, pos));']
        if self.child:
            out.append(f'CREATE TABLE IF NOT EXISTS "{self.child[1]}" (ns TEXT NOT NULL, path TEXT NOT NULL, parent_pos INTEGER NOT NULL, pos INTEGER NOT NULL{_ddl_cols(self.child[2])}, '
                       f'extra JSONB NOT NULL DEFAULT \'{{}}\', PRIMARY KEY (ns, path, parent_pos, pos));')
        return '\n'.join(out)


class MapTable(_PathTable):
    """A JSON object of id → object (a hub-table@1 chunk: `rows-<n>.json`) → one row per id, `cols` lifted, the rest in
    `extra`. A chunk with a non-object value is not claimed."""

    def match(self, ns: str, path: str, kind: str, content_type: str, body: bytes) -> bool:
        if not self._claims(ns, path, kind) or not body.lstrip().startswith(b'{'):
            return False
        try:
            doc = json.loads(body.decode('utf-8'))
        except ValueError:
            return False
        return isinstance(doc, dict) and all(isinstance(v, dict) for v in doc.values())

    def write(self, cur, ns: str, path: str, body: bytes) -> None:
        doc = json.loads(body.decode('utf-8'))
        cur.execute(f'DELETE FROM "{self.name}" WHERE ns=%s AND path=%s', (ns, path))
        names = ''.join(f', "{c.name}"' for c in self.cols)
        rows = []
        for pos, (rid, it) in enumerate(doc.items()):
            vals, extra = lift(it, self.cols)
            rows.append((ns, path, rid, pos, *[vals[c.name] for c in self.cols], Jsonb(extra, dumps=canonical)))
        if rows:
            cur.executemany(f'INSERT INTO "{self.name}" (ns, path, rid, pos{names}, extra) VALUES (%s, %s, %s, %s{", %s" * len(self.cols)}, %s)', rows)
        self._head(cur, ns, path, {})

    def read(self, cur, ns: str, path: str) -> bytes | None:
        if self._head_of(cur, ns, path) is _MISSING:
            return None
        cur.execute(f'SELECT * FROM "{self.name}" WHERE ns=%s AND path=%s ORDER BY pos', (ns, path))
        return canonical({r['rid']: unlift(r, self.cols, r['extra']) for r in cur.fetchall()}).encode('utf-8')

    def ddl(self) -> str:
        return (f'CREATE TABLE IF NOT EXISTS "{self.name}" (ns TEXT NOT NULL, path TEXT NOT NULL, rid TEXT NOT NULL, pos INTEGER NOT NULL{_ddl_cols(self.cols)}, '
                f'extra JSONB NOT NULL DEFAULT \'{{}}\', PRIMARY KEY (ns, path, rid));')


class PathRecordTable(RecordTable):
    """RecordTable for one path family inside a shared namespace (console/home-cards/*, console/shared/notifications/*)."""

    def match(self, ns: str, path: str, kind: str, content_type: str, body: bytes) -> bool:
        return kind == 'record' and ns == self.ns and bool(self.path_re and self.path_re.match(path)) and body.lstrip().startswith(b'{')


class TextTable(_PathTable):
    """UTF-8 text blobs (Markdown job briefs and reports) → one row per file: `text`, `size`. Binary stays a blob."""
    kind = 'blob'

    def match(self, ns: str, path: str, kind: str, content_type: str, body: bytes) -> bool:
        if not self._claims(ns, path, kind) or b'\x00' in body:
            return False
        try:
            body.decode('utf-8')
        except UnicodeDecodeError:
            return False
        return True

    def write(self, cur, ns: str, path: str, body: bytes) -> None:
        cur.execute(f'INSERT INTO "{self.name}" (ns, path, folder, name, text, size) VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (ns, path) DO UPDATE SET '
                    'folder=EXCLUDED.folder, name=EXCLUDED.name, text=EXCLUDED.text, size=EXCLUDED.size',
                    (ns, path, path.rpartition('/')[0], path.rpartition('/')[2], body.decode('utf-8'), len(body)))

    def read(self, cur, ns: str, path: str) -> bytes | None:
        cur.execute(f'SELECT text FROM "{self.name}" WHERE ns=%s AND path=%s', (ns, path))
        r = cur.fetchone()
        return r['text'].encode('utf-8') if r else None

    def delete(self, cur, ns: str, path: str) -> None:
        cur.execute(f'DELETE FROM "{self.name}" WHERE ns=%s AND path=%s', (ns, path))

    def ddl(self) -> str:
        return (f'CREATE TABLE IF NOT EXISTS "{self.name}" (ns TEXT NOT NULL, path TEXT NOT NULL, folder TEXT NOT NULL, name TEXT NOT NULL, '
                f'text TEXT NOT NULL, size BIGINT NOT NULL, PRIMARY KEY (ns, path));')


def retable(conn, only_ns: tuple[str, ...] | None = None) -> dict:
    """Move records a domain table now claims out of `records` into their rows (a database made before the table existed:
    console/state.json, alerts.json… were copied on Nov 17 as JSONB records). A key moves only when the rows read back
    byte-equal to the stored body, so its etag is unchanged; anything else stays where it is and is counted. Idempotent."""
    out = {'moved': 0, 'kept': 0, 'tables': {}}
    from tables import TABLES, table_for  # the full registry (this module is imported while tables.py is loading)
    names = sorted({t.ns for t in TABLES if not only_ns or t.ns in only_ns})
    cur = conn.cursor()
    cur.execute("SELECT k.ns, k.path, k.content_type, r.data, r.body FROM keys k JOIN records r ON r.ns = k.ns AND r.path = k.path "
                "WHERE k.kind = 'record' AND k.table_name = '' AND NOT k.deleted AND k.ns = ANY(%s)", (names,))
    rows = [dict(r, kind='record') for r in cur.fetchall()]
    blob_ns = sorted({t.ns for t in TABLES if getattr(t, 'kind', '') == 'blob' and (not only_ns or t.ns in only_ns)})
    if blob_ns:  # text blobs a TextTable now claims (job briefs and reports)
        cur.execute("SELECT k.ns, k.path, k.content_type, b.bytes AS body, NULL AS data FROM keys k JOIN blobs b ON b.sha = k.blob_sha "
                    "WHERE k.kind = 'blob' AND k.table_name = '' AND NOT k.deleted AND k.ns = ANY(%s) AND k.size < 4194304", (blob_ns,))
        rows += [dict(r, kind='blob') for r in cur.fetchall()]
    for r in rows:
        body = bytes(r['body']) if r['body'] is not None else canonical(r['data']).encode('utf-8')
        t = table_for(r['ns'], r['path'], r['kind'], r['content_type'] or '', body)
        if not t:
            continue
        try:
            with conn.transaction():
                c2 = conn.cursor()
                t.write(c2, r['ns'], r['path'], body)
                if t.read(c2, r['ns'], r['path']) != body:
                    raise ValueError('rows do not read back equal')
                c2.execute('DELETE FROM records WHERE ns=%s AND path=%s', (r['ns'], r['path']))
                c2.execute('UPDATE keys SET table_name=%s WHERE ns=%s AND path=%s', (t.name, r['ns'], r['path']))
            out['moved'] += 1
            out['tables'][t.name] = out['tables'].get(t.name, 0) + 1
        except Exception:  # noqa: BLE001 — the record stays a record; the next put places it
            out['kept'] += 1
    return out
