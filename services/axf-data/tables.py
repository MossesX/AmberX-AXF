"""Domain tables for the Postgres engine (pg.py): the documents the console keeps become rows.

A data-store@1 key is still the unit the API speaks (one record, one etag); what changes is the storage. Three shapes:

  DocTable     a document whose arrays are rows: the builds store (`builds` + `build_steps` + `build_notes`), UI Review
               items (`ui_review_items`), the console-control inventory (`control_targets` + `control_tabs`). The fields
               that are not rows (rev, rules, groups, counts…) sit in `store_heads`; each row lifts the columns worth
               querying and keeps the rest in `extra` (JSONB) so the document comes back exactly as it went in.
               A list with a `key` (the builds list: `id`) is keyed by that field: a build is one row for its whole life
               (`rid` = its id, `pos` keeps the array order), its steps and notes are child rows under its id, and the
               row can be locked and rewritten on its own (`patch`, data-patch@1) without touching the other builds.
  RecordTable  one row per key: settings documents (`settings`), planner items (`planner_items`).
  KeyRowTable  one row per key for every other JSON object of a namespace (plugin_docs, console_docs, build_docs…): an
               item kept as its own key is read, written and deleted on its own.
  ItemsTable   families of documents (one per agent, chat, profile…) whose lists are rows of one table.
  NotesTable   Brett's notes: Markdown text in a `notes` row instead of an opaque blob.

Every shape reads, writes and removes one item on its own (`get_row` / `put_row` / `delete_row`; over the API a keyed
DocTable list takes data-patch@1 `{ key, item }` / `{ key, delete: true }`): no caller writes a whole document for one
change. The plugin, console and build documents are registered under "the plugin documents" below.
  mirror       a SQLite file the console uploads (blob-sqlite: the Shipped features ledger, the Chat viewer db) is
               exploded into `<prefix>_<table>` rows, one PG table per SQLite table, full refresh, counts checked.

Lifted columns are typed. A value that does not fit its column's type (a PR number stored as "" in one build and 705 in
another) stays in `extra`, and the column is NULL: nothing is coerced, nothing is lost.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import tempfile
from dataclasses import dataclass, field
from typing import Any

from psycopg import errors as pg_errors
from psycopg.types.json import Jsonb

from store import canonical, sha

# ── column lifting ────────────────────────────────────────────────────────────────────────────────────────────────────

PG_TYPES = {'text': 'TEXT', 'int': 'BIGINT', 'bool': 'BOOLEAN', 'num': 'DOUBLE PRECISION'}


@dataclass(frozen=True)
class Col:
    name: str          # column
    key: str = ''      # JSON key (default: the column name)
    type: str = 'text'

    @property
    def json_key(self) -> str:
        return self.key or self.name

    def fits(self, v: Any) -> bool:
        if self.type == 'text':
            return isinstance(v, str)
        if self.type == 'bool':
            return isinstance(v, bool)
        if self.type == 'int':
            return isinstance(v, int) and not isinstance(v, bool) and -(2 ** 63) <= v < 2 ** 63
        if self.type == 'num':
            return isinstance(v, (int, float)) and not isinstance(v, bool)
        return False


def lift(doc: dict, cols: list[Col]) -> tuple[dict, dict]:
    """(column values, extra): a column is NULL and the value stays in extra when it does not fit."""
    vals, extra = {}, dict(doc)
    for c in cols:
        v = doc.get(c.json_key, _MISSING)
        if v is not _MISSING and c.fits(v):
            vals[c.name] = v
            extra.pop(c.json_key)
        else:
            vals[c.name] = None
    return vals, extra


def unlift(row: dict, cols: list[Col], extra: dict | None) -> dict:
    doc = dict(extra or {})
    for c in cols:
        if row.get(c.name) is not None:
            doc[c.json_key] = row[c.name]
    return doc


_MISSING = object()


def _ddl_cols(cols: list[Col]) -> str:
    return ''.join(f', "{c.name}" {PG_TYPES[c.type]}' for c in cols)


# ── the column sets ──────────────────────────────────────────────────────────────────────────────────────────────────

BUILD_COLS = [Col('id'), Col('title'), Col('status'), Col('category'), Col('kind'), Col('source'), Col('branch'), Col('pr'),
              Col('priority'), Col('created_at', 'createdAt'), Col('updated_at', 'updatedAt'), Col('built_at', 'builtAt'),
              Col('deleted', type='bool'), Col('hidden', type='bool'), Col('rev', type='int'), Col('ord', 'order', 'int')]
STEP_COLS = [Col('id'), Col('uid'), Col('title'), Col('text'), Col('phase'), Col('model'), Col('agent'), Col('grp', 'group'),
             Col('done', type='bool'), Col('skip', type='bool'), Col('done_at', 'doneAt'), Col('estimate', type='int'),
             Col('created_at', 'createdAt'), Col('updated_at', 'updatedAt'), Col('rev', type='int')]
UI_COLS = [Col('id'), Col('kind'), Col('name'), Col('app'), Col('screen'), Col('grp', 'group'), Col('sect', 'section'), Col('status'),
           Col('build'), Col('branch'), Col('viewport'), Col('source'), Col('submitted_by', 'submittedBy'),
           Col('created_at', 'createdAt'), Col('updated_at', 'updatedAt')]
CTRL_COLS = [Col('address'), Col('id'), Col('label'), Col('icon'), Col('plugin'), Col('source'), Col('nav'), Col('view'),
             Col('parent'), Col('kind'), Col('sect', 'section'), Col('file'), Col('line', type='int'), Col('dynamic', type='bool')]
TAB_COLS = [Col('address'), Col('value'), Col('label')]
SETTINGS_COLS = [Col('schema', '$axf')]
PLAN_COLS = [Col('schema', '$axf'), Col('id'), Col('title'), Col('status'), Col('priority'), Col('category'), Col('profile'),
             Col('project'), Col('owner'), Col('target_date', 'targetDate'), Col('created_by', 'createdBy'),
             Col('created_at', 'createdAt'), Col('updated_at', 'updatedAt'), Col('version', type='int')]


@dataclass(frozen=True)
class ListSpec:
    table: str
    cols: list[Col]
    section: str = ''                      # rows of several lists share one table (control_targets)
    child: tuple[str, str, list[Col]] | None = None   # (json key, table, cols): one child list, rows keyed by position
    key: str = ''                          # the item field that names a row (builds: `id`): rows keyed by it, patchable
    children: tuple = ()                   # (json key, table, cols)…: child lists of a keyed row (steps, notes)
    map: bool = False                      # the value is a map `id → object`, not an array: rows keyed by the map key

    @property
    def kids(self) -> tuple:
        return tuple(self.children) + ((self.child,) if self.child else ())

    @property
    def keyed(self) -> bool:
        return bool(self.key or self.map)

    @property
    def parent_col(self) -> str:
        return 'parent_rid' if self.keyed else 'parent_pos'

    def fits(self, v: Any) -> bool:
        if self.map:
            return isinstance(v, dict) and all(isinstance(i, dict) for i in v.values())
        return isinstance(v, list) and all(isinstance(i, dict) for i in v)


ROOT = ''            # a DocTable list under this name: the document itself is the array (a JSON list of objects)


TABLES_VERSION = 4   # meta.tables_version: 2 = keyed rows (rid) for lists with a key, children_lifted JSONB, build_notes;
                     # 3 = ItemsTable / MediaTable: plan, profiles, projects, plan media, Plan Studio (backfilled on connect)
                     # 4 = map lists, root-list documents, row delete in data-patch@1, single-row get/put/delete; one table
                     #     per plugin (plugin_<folder>) and a row per key for every other plugin / console document


def item_key(item: Any, spec: ListSpec) -> str | None:
    """The key of an item of a keyed list: its `spec.key` field, a non-empty string or a whole number (a PR number)."""
    v = item.get(spec.key) if isinstance(item, dict) and spec.key else None
    if isinstance(v, str) and v:
        return v
    return str(v) if isinstance(v, int) and not isinstance(v, bool) else None


def _rid(item: dict, spec: ListSpec, pos: int) -> str:
    return item_key(item, spec) or f'#{pos}'


# ── DocTable ─────────────────────────────────────────────────────────────────────────────────────────────────────────

class DocTable:
    def __init__(self, name: str, ns: str, path: str, lists: dict[str, ListSpec], holds: str):
        self.name, self.ns, self.path, self.lists, self.holds = name, ns, path, lists, holds

    def match(self, ns: str, path: str, kind: str, content_type: str, body: bytes) -> bool:
        return kind == 'record' and ns == self.ns and path == self.path

    def _head(self, cur, ns: str, path: str, head, lifted: list) -> None:
        cur.execute('INSERT INTO store_heads (ns, path, head, lists) VALUES (%s, %s, %s, %s) ON CONFLICT (ns, path) DO UPDATE SET head=EXCLUDED.head, lists=EXCLUDED.lists',
                    (ns, path, Jsonb(head, dumps=canonical), Jsonb(lifted)))

    def write(self, cur, ns: str, path: str, body: bytes) -> None:
        doc = json.loads(body.decode('utf-8'))
        root = self.lists.get(ROOT)
        if root and root.fits(doc) and not root.map:
            for key, spec in self.lists.items():
                self._write_list(cur, spec, doc if key == ROOT else [])
            self._head(cur, ns, path, {}, [ROOT])
            return
        if not isinstance(doc, dict):
            self._head(cur, ns, path, doc, [])
            self._clear_rows(cur)
            return
        head, lifted = dict(doc), []
        for key, spec in self.lists.items():
            items = doc.get(key, _MISSING) if key != ROOT else _MISSING
            if items is not _MISSING and spec.fits(items):
                lifted.append(key)
                head.pop(key)
                if spec.map:
                    self._write_list(cur, spec, list(items.values()), list(items.keys()))
                else:
                    self._write_list(cur, spec, items)
            else:
                self._write_list(cur, spec, [])
        self._head(cur, ns, path, head, lifted)

    # ── rows ──
    def _write_kids(self, cur, spec: ListSpec, parent, item: dict, extra: dict) -> dict | None:
        """Child rows of one item (steps, notes…): replaced whole. Returns which child keys were lifted (None: no children)."""
        if not spec.kids:
            return None
        lifted: dict = {}
        for ckey, ctable, ccols in spec.kids:
            kids = item.get(ckey, _MISSING)
            cur.execute(f'DELETE FROM "{ctable}" WHERE section=%s AND {spec.parent_col}=%s', (spec.section, parent))
            if isinstance(kids, list) and all(isinstance(k, dict) for k in kids):
                lifted[ckey] = True
                extra.pop(ckey, None)
                names = ', '.join(f'"{c.name}"' for c in ccols)
                rows = []
                for cpos, kid in enumerate(kids):
                    cv, cx = lift(kid, ccols)
                    rows.append((spec.section, parent, cpos, *[cv[c.name] for c in ccols], Jsonb(cx, dumps=canonical)))
                if rows:
                    cur.executemany(f'INSERT INTO "{ctable}" (section, {spec.parent_col}, pos{", " + names if names else ""}, extra) VALUES (%s, %s, %s{", %s" * len(ccols)}, %s)', rows)
            elif kids is not _MISSING:
                lifted[ckey] = False
        return lifted or None

    def _upsert_row(self, cur, spec: ListSpec, pos: int, item: dict, h: str, rid: str = '') -> None:
        vals, extra = lift(item, spec.cols)
        parent = (rid or _rid(item, spec, pos)) if spec.keyed else pos
        lifted = self._write_kids(cur, spec, parent, item, extra)
        names = ', '.join(f'"{c.name}"' for c in spec.cols)
        sets = ', '.join(f'"{c.name}"=EXCLUDED."{c.name}"' for c in spec.cols)
        if spec.keyed:
            cur.execute(f'INSERT INTO "{spec.table}" (section, rid, pos{", " + names if names else ""}, extra, doc_hash, children_lifted) VALUES (%s, %s, %s{", %s" * len(spec.cols)}, %s, %s, %s) '
                        f'ON CONFLICT (section, rid) DO UPDATE SET pos=EXCLUDED.pos, {sets + ", " if sets else ""}extra=EXCLUDED.extra, doc_hash=EXCLUDED.doc_hash, children_lifted=EXCLUDED.children_lifted',
                        (spec.section, parent, pos, *[vals[c.name] for c in spec.cols], Jsonb(extra, dumps=canonical), h, Jsonb(lifted) if lifted is not None else None))
        else:
            cur.execute(f'INSERT INTO "{spec.table}" (section, pos{", " + names if names else ""}, extra, doc_hash, children_lifted) VALUES (%s, %s{", %s" * len(spec.cols)}, %s, %s, %s) '
                        f'ON CONFLICT (section, pos) DO UPDATE SET {sets + ", " if sets else ""}extra=EXCLUDED.extra, doc_hash=EXCLUDED.doc_hash, children_lifted=EXCLUDED.children_lifted',
                        (spec.section, pos, *[vals[c.name] for c in spec.cols], Jsonb(extra, dumps=canonical), h, Jsonb(lifted) if lifted is not None else None))

    def _write_list(self, cur, spec: ListSpec, items: list[dict], rids: list[str] | None = None) -> None:
        if spec.keyed:
            cur.execute(f'SELECT rid, pos, doc_hash FROM "{spec.table}" WHERE section=%s', (spec.section,))
            have = {r['rid']: (r['pos'], r['doc_hash']) for r in cur.fetchall()}
            seen = set()
            for pos, item in enumerate(items):
                rid = rids[pos] if rids is not None else _rid(item, spec, pos)
                if rid in seen:                     # a repeated key: the later copy is kept by position, like an unkeyed row
                    rid = f'#{pos}'
                seen.add(rid)
                h = sha(canonical(item).encode('utf-8'))[:32]
                if have.get(rid) == (pos, h):
                    continue
                if rid in have and have[rid][1] == h:
                    cur.execute(f'UPDATE "{spec.table}" SET pos=%s WHERE section=%s AND rid=%s', (pos, spec.section, rid))
                    continue
                self._upsert_row(cur, spec, pos, item, h, rid)
            gone = [rid for rid in have if rid not in seen]
            if gone:
                for _ckey, ctable, _ccols in spec.kids:
                    cur.execute(f'DELETE FROM "{ctable}" WHERE section=%s AND parent_rid = ANY(%s)', (spec.section, gone))
                cur.execute(f'DELETE FROM "{spec.table}" WHERE section=%s AND rid = ANY(%s)', (spec.section, gone))
            return
        cur.execute(f'SELECT pos, doc_hash FROM "{spec.table}" WHERE section=%s', (spec.section,))
        have = {r['pos']: r['doc_hash'] for r in cur.fetchall()}
        for pos, item in enumerate(items):
            h = sha(canonical(item).encode('utf-8'))[:32]
            if have.get(pos) == h:
                continue
            self._upsert_row(cur, spec, pos, item, h)
        for _ckey, ctable, _ccols in spec.kids:
            cur.execute(f'DELETE FROM "{ctable}" WHERE section=%s AND parent_pos >= %s', (spec.section, len(items)))
        cur.execute(f'DELETE FROM "{spec.table}" WHERE section=%s AND pos >= %s', (spec.section, len(items)))

    def read(self, cur, ns: str, path: str) -> bytes | None:
        cur.execute('SELECT head, lists FROM store_heads WHERE ns=%s AND path=%s', (ns, path))
        r = cur.fetchone()
        if not r:
            return None
        doc = r['head']
        if not isinstance(doc, dict):
            return canonical(doc).encode('utf-8')
        if ROOT in r['lists']:
            return canonical(self._read_list(cur, self.lists[ROOT])).encode('utf-8')
        for key in r['lists']:
            spec = self.lists[key]
            doc[key] = dict(self._read_rows(cur, spec)) if spec.map else self._read_list(cur, spec)
        return canonical(doc).encode('utf-8')

    def _read_list(self, cur, spec: ListSpec) -> list[dict]:
        return [item for _rid_or_pos, item in self._read_rows(cur, spec)]

    def _read_rows(self, cur, spec: ListSpec) -> list[tuple]:
        """(rid or pos, item) of every row of a list, in order."""
        kids: dict[str, dict] = {}
        for ckey, ctable, ccols in spec.kids:
            cur.execute(f'SELECT * FROM "{ctable}" WHERE section=%s ORDER BY {spec.parent_col}, pos', (spec.section,))
            for row in cur.fetchall():
                kids.setdefault(ckey, {}).setdefault(row[spec.parent_col], []).append(unlift(row, ccols, row['extra']))
        cur.execute(f'SELECT * FROM "{spec.table}" WHERE section=%s ORDER BY pos', (spec.section,))
        out = []
        for row in cur.fetchall():
            item = unlift(row, spec.cols, row['extra'])
            lifted = row.get('children_lifted') or {}
            parent = row['rid'] if spec.keyed else row['pos']
            for ckey, _ctable, _ccols in spec.kids:
                if lifted.get(ckey):
                    item[ckey] = kids.get(ckey, {}).get(parent, [])
            out.append((parent, item))
        return out

    def _clear_rows(self, cur) -> None:
        for spec in self.lists.values():
            for _ckey, ctable, _ccols in spec.kids:
                cur.execute(f'DELETE FROM "{ctable}" WHERE section=%s', (spec.section,))
            cur.execute(f'DELETE FROM "{spec.table}" WHERE section=%s', (spec.section,))

    def delete(self, cur, ns: str, path: str) -> None:
        self._clear_rows(cur)
        cur.execute('DELETE FROM store_heads WHERE ns=%s AND path=%s', (ns, path))

    # ── patch (data-patch@1): some rows of a keyed list, the head, in one transaction, the other rows untouched ──
    def patchable(self) -> dict[str, ListSpec]:
        return {k: s for k, s in self.lists.items() if s.keyed}

    def lock_rows(self, cur, spec: ListSpec, rids: list[str]) -> dict[str, dict]:
        """`SELECT … FOR UPDATE` on the named rows: the row-level lock. Returns rid → { pos, rev } of the rows that exist."""
        if not rids:
            return {}
        has_rev = any(c.name == 'rev' for c in spec.cols)
        cur.execute(f'SELECT rid, pos{", rev" if has_rev else ""}, extra FROM "{spec.table}" WHERE section=%s AND rid = ANY(%s) FOR UPDATE', (spec.section, rids))
        out = {}
        for r in cur.fetchall():
            rev = r['rev'] if has_rev else None
            if rev is None and isinstance(r.get('extra'), dict):
                rev = r['extra'].get('rev')
            out[r['rid']] = {'pos': r['pos'], 'rev': rev}
        return out

    def patch(self, cur, ns: str, path: str, head: dict | None, lists: dict[str, list[dict]]) -> dict:
        """Apply checked changes (check_patch first, under lock_rows). Returns { applied, added, head }."""
        cur.execute('SELECT head, lists FROM store_heads WHERE ns=%s AND path=%s FOR UPDATE', (ns, path))
        r = cur.fetchone()
        if not r or not isinstance(r['head'], dict):
            raise ValueError('patch needs a document with lists')
        cur_head, lifted = dict(r['head']), list(r['lists'])
        applied = added = removed = 0
        for lkey, changes in lists.items():
            spec = self.lists[lkey]
            if (lkey == ROOT) != (ROOT in lifted) and (cur_head or lifted):
                raise ValueError('this record is a list: patch its root list' if ROOT in lifted else 'this record is an object: it has no root list to patch')
            if lkey not in lifted:
                lifted.append(lkey)
                cur_head.pop(lkey, None)
            cur.execute(f'SELECT COALESCE(MAX(pos), -1) AS m FROM "{spec.table}" WHERE section=%s', (spec.section,))
            nxt = cur.fetchone()['m'] + 1
            for ch in changes:
                rid = ch['key']
                if ch.get('delete'):
                    for _ckey, ctable, _ccols in spec.kids:
                        cur.execute(f'DELETE FROM "{ctable}" WHERE section=%s AND parent_rid=%s', (spec.section, rid))
                    cur.execute(f'DELETE FROM "{spec.table}" WHERE section=%s AND rid=%s', (spec.section, rid))
                    removed += cur.rowcount
                    applied += 1
                    continue
                item = ch['item']
                cur.execute(f'SELECT pos FROM "{spec.table}" WHERE section=%s AND rid=%s', (spec.section, rid))
                row = cur.fetchone()
                pos = row['pos'] if row else nxt
                if not row:
                    nxt += 1
                    added += 1
                self._upsert_row(cur, spec, pos, item, sha(canonical(item).encode('utf-8'))[:32], rid)
                applied += 1
        if head and ROOT not in lifted:
            for k, v in head.items():
                if k in self.lists:
                    continue
                cur_head[k] = v
        self._head(cur, ns, path, cur_head, lifted)
        return {'applied': applied, 'added': added, 'removed': removed, 'head': cur_head}

    # ── one row (the unit every caller reads and writes: never the whole document for one change) ──
    def row_ids(self, cur, lkey: str) -> list[str]:
        spec = self._keyed(lkey)
        cur.execute(f'SELECT rid FROM "{spec.table}" WHERE section=%s ORDER BY pos', (spec.section,))
        return [r['rid'] for r in cur.fetchall()]

    def get_row(self, cur, lkey: str, rid: str) -> dict | None:
        """One item of a keyed list (or map) by its key: one row and its child rows, nothing else is read."""
        spec = self._keyed(lkey)
        cur.execute(f'SELECT * FROM "{spec.table}" WHERE section=%s AND rid=%s', (spec.section, rid))
        row = cur.fetchone()
        if not row:
            return None
        item = unlift(row, spec.cols, row['extra'])
        lifted = row.get('children_lifted') or {}
        for ckey, ctable, ccols in spec.kids:
            if lifted.get(ckey):
                cur.execute(f'SELECT * FROM "{ctable}" WHERE section=%s AND parent_rid=%s ORDER BY pos', (spec.section, rid))
                item[ckey] = [unlift(k, ccols, k['extra']) for k in cur.fetchall()]
        return item

    def put_row(self, cur, ns: str, path: str, lkey: str, item: dict, rid: str = '') -> dict:
        """Insert or replace one item (a new one goes last). The document need not exist yet: its head is made empty.
        Cursor level: the caller (the engine) moves the key's rev and etag, as PgStore.patch does."""
        spec = self._keyed(lkey)
        rid = rid or _rid(item, spec, -1)
        if not isinstance(item, dict) or not rid or rid == '#-1':
            raise ValueError(f'{lkey}: a row needs an object and a key ({spec.key or "the map key"})')
        self._ensure_head(cur, ns, path, lkey)
        return self.patch(cur, ns, path, None, {lkey: [{'key': rid, 'item': item}]})

    def delete_row(self, cur, ns: str, path: str, lkey: str, rid: str) -> bool:
        self._keyed(lkey)
        cur.execute('SELECT 1 FROM store_heads WHERE ns=%s AND path=%s', (ns, path))
        if not cur.fetchone():
            return False
        return bool(self.patch(cur, ns, path, None, {lkey: [{'key': rid, 'delete': True}]})['removed'])

    def _keyed(self, lkey: str) -> ListSpec:
        spec = self.lists.get(lkey)
        if not spec or not spec.keyed:
            raise ValueError(f'{lkey!r} is not a keyed list of {self.name} ({", ".join(repr(k) for k in self.patchable()) or "none"})')
        return spec

    def _ensure_head(self, cur, ns: str, path: str, lkey: str) -> None:
        cur.execute('SELECT head FROM store_heads WHERE ns=%s AND path=%s', (ns, path))
        r = cur.fetchone()
        if r and isinstance(r['head'], dict):
            return
        if r:
            self._clear_rows(cur)
        self._head(cur, ns, path, {}, [ROOT] if lkey == ROOT else [])

    def ddl(self) -> str:
        out = []
        for spec in self.lists.values():
            if spec.keyed:
                out.append(f'CREATE TABLE IF NOT EXISTS "{spec.table}" (section TEXT NOT NULL, rid TEXT NOT NULL, pos INTEGER NOT NULL{_ddl_cols(spec.cols)}, '
                           f'extra JSONB NOT NULL DEFAULT \'{{}}\', doc_hash TEXT NOT NULL, children_lifted JSONB, PRIMARY KEY (section, rid));')
                out.append(f'CREATE INDEX IF NOT EXISTS "{spec.table}_pos" ON "{spec.table}" (section, pos);')
            else:
                out.append(f'CREATE TABLE IF NOT EXISTS "{spec.table}" (section TEXT NOT NULL, pos INTEGER NOT NULL{_ddl_cols(spec.cols)}, '
                           f'extra JSONB NOT NULL DEFAULT \'{{}}\', doc_hash TEXT NOT NULL, children_lifted JSONB, PRIMARY KEY (section, pos));')
            for _ckey, ctable, ccols in spec.kids:
                pcol = f'{spec.parent_col} {"TEXT" if spec.keyed else "INTEGER"} NOT NULL'
                out.append(f'CREATE TABLE IF NOT EXISTS "{ctable}" (section TEXT NOT NULL, {pcol}, pos INTEGER NOT NULL{_ddl_cols(ccols)}, '
                           f'extra JSONB NOT NULL DEFAULT \'{{}}\', PRIMARY KEY (section, {spec.parent_col}, pos));')
        return '\n'.join(out)


# ── data-patch@1: the shape both engines accept, checked once, applied to rows (pg.py) or to the document (store.py) ──

def check_patch(body: Any, table: DocTable | None) -> dict:
    """Validate a patch body: { head?: {…}, lists: { <list>: [ { key, ifRev?, item } | { key, ifRev?, delete: true } ] },
    journal?: { path, entry, idem? } }. A change with `delete: true` removes that one row (absent already: nothing happens)."""
    if not isinstance(body, dict):
        raise ValueError('a patch is an object')
    if table is None or not table.patchable():
        raise ValueError('this record has no keyed list to patch (the builds store has: builds)')
    head = body.get('head')
    if head is not None and not isinstance(head, dict):
        raise ValueError('head must be an object')
    lists = body.get('lists') or {}
    if not isinstance(lists, dict) or not lists and not head:
        raise ValueError('lists must map a list name to its changes (or pass head)')
    if head and ROOT in table.lists:
        raise ValueError('this record is a list: it has no head fields to set')
    out_lists: dict[str, list[dict]] = {}
    for lkey, changes in lists.items():
        spec = table.patchable().get(lkey)
        if not spec:
            raise ValueError(f'{lkey} is not a keyed list of this record ({", ".join(table.patchable()) or "none"})')
        if not isinstance(changes, list):
            raise ValueError(f'{lkey}: changes must be a list')
        seen = set()
        out = []
        for ch in changes:
            drop = isinstance(ch, dict) and ch.get('delete') is True
            if not isinstance(ch, dict) or not isinstance(ch.get('key'), str) or not ch['key'] or (not drop and not isinstance(ch.get('item'), dict)) or (drop and ch.get('item') is not None):
                raise ValueError(f'{lkey}: each change is {{ key, ifRev?, item }} or {{ key, ifRev?, delete: true }}')
            if ch['key'] in seen:
                raise ValueError(f'{lkey}: {ch["key"]} is changed twice')
            seen.add(ch['key'])
            if not drop and not spec.map and item_key(ch['item'], spec) != ch['key']:
                raise ValueError(f'{lkey}: item.{spec.key} must equal key ({ch["key"]})')
            if_rev = ch.get('ifRev', _MISSING)
            if if_rev is not _MISSING and if_rev is not None and not (isinstance(if_rev, int) and not isinstance(if_rev, bool)):
                raise ValueError(f'{lkey}: ifRev is a whole number, null (must not exist) or absent (no check)')
            out.append({'key': ch['key'], 'ifRev': if_rev, 'delete': True} if drop else {'key': ch['key'], 'ifRev': if_rev, 'item': ch['item']})
        out_lists[lkey] = out
    journal = body.get('journal')
    if journal is not None:
        if not isinstance(journal, dict) or not isinstance(journal.get('path'), str) or not journal['path'] or 'entry' not in journal:
            raise ValueError('journal is { path, entry, idem? }')
    return {'head': head, 'lists': out_lists, 'journal': journal}


def item_rev(cur: dict | None) -> int | None:
    """A stored item's rev for the ifRev check: an item without a whole-number rev counts as rev 1 (builds@1 reads it so)."""
    if cur is None:
        return None
    v = cur.get('rev')
    return v if isinstance(v, int) and not isinstance(v, bool) and v > 0 else 1


def rev_conflicts(changes: list[dict], have: dict[str, dict]) -> list[dict]:
    """Which changes fail their ifRev: have = key → { rev } of the rows that exist (lock_rows / the document)."""
    out = []
    for ch in changes:
        if_rev = ch.get('ifRev', _MISSING)
        if if_rev is _MISSING:
            continue
        cur = have.get(ch['key'])
        if if_rev is None:
            if cur is not None:
                out.append({'key': ch['key'], 'ifRev': None, 'rev': item_rev(cur)})
        elif cur is None or item_rev(cur) != if_rev:
            out.append({'key': ch['key'], 'ifRev': if_rev, 'rev': item_rev(cur)})
    return out


def apply_patch_doc(doc: dict, table: DocTable, head: dict | None, lists: dict[str, list[dict]]) -> dict:
    """The document-level twin of DocTable.patch (the SQLite engine, tests): same result, same order rules."""
    out = dict(doc)
    for lkey, changes in lists.items():
        spec = table.lists[lkey]
        if spec.map:
            rows = dict(out[lkey]) if isinstance(out.get(lkey), dict) else {}
            for ch in changes:
                if ch.get('delete'):
                    rows.pop(ch['key'], None)
                else:
                    rows[ch['key']] = ch['item']
            out[lkey] = rows
            continue
        items = list(out.get(lkey) or []) if isinstance(out.get(lkey), list) else []
        gone = {ch['key'] for ch in changes if ch.get('delete')}
        if gone:
            items = [it for it in items if item_key(it, spec) not in gone]
            changes = [ch for ch in changes if not ch.get('delete')]
        index: dict[str, int] = {}
        for i, it in enumerate(items):
            if item_key(it, spec) is not None:
                index.setdefault(item_key(it, spec), i)
        for ch in changes:
            i = index.get(ch['key'])
            if i is None:
                index[ch['key']] = len(items)
                items.append(ch['item'])
            else:
                items[i] = ch['item']
        out[lkey] = items
    for k, v in (head or {}).items():
        if k not in table.lists:
            out[k] = v
    return out


def doc_revs(doc: dict, lkey: str, spec: ListSpec, keys: list[str]) -> dict[str, dict]:
    """key → { rev } for the named items of a document's list (the document twin of lock_rows)."""
    want = set(keys)
    out: dict[str, dict] = {}
    items = doc.get(lkey) if isinstance(doc, dict) else None
    if spec.map:
        return {k: {'rev': v.get('rev')} for k, v in (items if isinstance(items, dict) else {}).items() if k in want and isinstance(v, dict)}
    for it in items if isinstance(items, list) else []:
        k = item_key(it, spec)
        if k in want and k not in out:
            out[k] = {'rev': it.get('rev')}
    return out


# ── RecordTable ──────────────────────────────────────────────────────────────────────────────────────────────────────

class RecordTable:
    def __init__(self, name: str, ns: str, cols: list[Col], holds: str, path_re: str = ''):
        self.name, self.ns, self.cols, self.holds = name, ns, cols, holds
        self.path_re = re.compile(path_re) if path_re else None

    def match(self, ns: str, path: str, kind: str, content_type: str, body: bytes) -> bool:
        if kind != 'record' or ns != self.ns or (self.path_re and not self.path_re.match(path)):
            return False
        return body.startswith(b'{')

    def write(self, cur, ns: str, path: str, body: bytes) -> None:
        doc = json.loads(body.decode('utf-8'))
        vals, extra = lift(doc, self.cols)
        names = ', '.join(f'"{c.name}"' for c in self.cols)
        sets = ', '.join(f'"{c.name}"=EXCLUDED."{c.name}"' for c in self.cols)
        cur.execute(f'INSERT INTO "{self.name}" (ns, path{", " + names if names else ""}, extra) VALUES (%s, %s{", %s" * len(self.cols)}, %s) '
                    f'ON CONFLICT (ns, path) DO UPDATE SET {sets + ", " if sets else ""}extra=EXCLUDED.extra',
                    (ns, path, *[vals[c.name] for c in self.cols], Jsonb(extra, dumps=canonical)))

    def read(self, cur, ns: str, path: str) -> bytes | None:
        cur.execute(f'SELECT * FROM "{self.name}" WHERE ns=%s AND path=%s', (ns, path))
        r = cur.fetchone()
        return canonical(unlift(r, self.cols, r['extra'])).encode('utf-8') if r else None

    def delete(self, cur, ns: str, path: str) -> None:
        cur.execute(f'DELETE FROM "{self.name}" WHERE ns=%s AND path=%s', (ns, path))

    def ddl(self) -> str:
        return (f'CREATE TABLE IF NOT EXISTS "{self.name}" (ns TEXT NOT NULL, path TEXT NOT NULL{_ddl_cols(self.cols)}, '
                f'extra JSONB NOT NULL DEFAULT \'{{}}\', PRIMARY KEY (ns, path));')


class KeyRowTable(RecordTable):
    """One row per key for every JSON object of a namespace that no table before it in TABLES claims: an item kept as
    its own key (`<folder>/<collection>/<id>.json`) is one row, read, written and deleted on its own through the plain
    GET / PUT / DELETE of that key. `folder` and `item` are generated from the path (the plugin folder, the file's stem).
    A body jsonb cannot hold (\\u0000) is left to `records`, which keeps the exact bytes."""

    def match(self, ns: str, path: str, kind: str, content_type: str, body: bytes) -> bool:
        return super().match(ns, path, kind, content_type, body) and b'\\u0000' not in body

    def get_row(self, cur, ns: str, path: str) -> dict | None:
        body = self.read(cur, ns, path)
        return json.loads(body) if body is not None else None

    def put_row(self, cur, ns: str, path: str, item: dict) -> None:
        self.write(cur, ns, path, canonical(item).encode('utf-8'))

    def delete_row(self, cur, ns: str, path: str) -> bool:
        self.delete(cur, ns, path)
        return bool(cur.rowcount)

    def ddl(self) -> str:
        return (f'CREATE TABLE IF NOT EXISTS "{self.name}" (ns TEXT NOT NULL, path TEXT NOT NULL{_ddl_cols(self.cols)}, '
                f'extra JSONB NOT NULL DEFAULT \'{{}}\', '
                "folder TEXT GENERATED ALWAYS AS (split_part(path, '/', 1)) STORED, "
                "item TEXT GENERATED ALWAYS AS (regexp_replace(regexp_replace(path, '^.*/', ''), '\\.json$', '')) STORED, "
                'PRIMARY KEY (ns, path));\n'
                f'CREATE INDEX IF NOT EXISTS "{self.name}_folder" ON "{self.name}" (ns, folder);')


# ── NotesTable ───────────────────────────────────────────────────────────────────────────────────────────────────────

class NotesTable:
    name, ns, holds = 'notes', 'notes', "Brett's notes: one row per note, Markdown text (notes/<folder>/<name>.md)"

    def match(self, ns: str, path: str, kind: str, content_type: str, body: bytes) -> bool:
        if kind != 'blob' or ns != self.ns or b'\x00' in body:
            return False
        if not (content_type.startswith('text/') or content_type in ('application/octet-stream', '')):
            return False
        try:
            body.decode('utf-8')
        except UnicodeDecodeError:
            return False
        return True

    def write(self, cur, ns: str, path: str, body: bytes) -> None:
        folder, _, name = path.rpartition('/')
        cur.execute('INSERT INTO notes (path, folder, name, text, size) VALUES (%s, %s, %s, %s, %s) ON CONFLICT (path) DO UPDATE SET folder=EXCLUDED.folder, name=EXCLUDED.name, text=EXCLUDED.text, size=EXCLUDED.size',
                    (path, folder, name, body.decode('utf-8'), len(body)))

    def read(self, cur, ns: str, path: str) -> bytes | None:
        cur.execute('SELECT text FROM notes WHERE path=%s', (path,))
        r = cur.fetchone()
        return r['text'].encode('utf-8') if r else None

    def delete(self, cur, ns: str, path: str) -> None:
        cur.execute('DELETE FROM notes WHERE path=%s', (path,))

    def ddl(self) -> str:
        return 'CREATE TABLE IF NOT EXISTS notes (path TEXT PRIMARY KEY, folder TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, size BIGINT NOT NULL);'


# ── ItemsTable ───────────────────────────────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ItemList:
    """One list of a document that becomes rows: `key` names the row (rid, for queries and lookups), `scalar` lists
    (strings, numbers) keep each value in the `value` column. The list named `*` is the document itself read as a map
    (id → object, like the feature catalog): every top-level entry whose value is an object is a row, rid = its key."""
    key: str = ''
    scalar: bool = False


MAP, MAP_KEY = '*', '\x00rid'


def _scalar(v: Any) -> bool:
    return v is None or isinstance(v, (str, int, float, bool))


class ItemsTable:
    """Documents (any key whose path matches) whose lists are rows of one table: (ns, path, list, pos) → lifted columns,
    `rid` (the item's key), `value` (scalar lists), `extra` (the rest of the item). The fields that are not rows sit in
    `store_heads`. A list that does not have the expected shape stays in the head: the document always reads back as it
    went in. Rows are rewritten only where their hash changed (a 500-item plan with one edit writes one row)."""

    def __init__(self, name: str, ns: str, path_re: str, lists: dict[str, ItemList], cols: list[Col], holds: str):
        self.name, self.ns, self.lists, self.cols, self.holds = name, ns, lists, cols, holds
        self.rows = name                    # the table the list items go to (HeadItemsTable: a second table)
        self.path_re = re.compile(path_re)

    # the head (every field that is not a row): store_heads here, a row of its own table in HeadItemsTable
    def _put_head(self, cur, ns: str, path: str, head: Any, lifted: list) -> None:
        cur.execute('INSERT INTO store_heads (ns, path, head, lists) VALUES (%s, %s, %s, %s) ON CONFLICT (ns, path) DO UPDATE SET head=EXCLUDED.head, lists=EXCLUDED.lists',
                    (ns, path, Jsonb(head, dumps=canonical), Jsonb(lifted)))

    def _get_head(self, cur, ns: str, path: str) -> dict | None:
        cur.execute('SELECT head, lists FROM store_heads WHERE ns=%s AND path=%s', (ns, path))
        return cur.fetchone()

    def _del_head(self, cur, ns: str, path: str) -> None:
        cur.execute('DELETE FROM store_heads WHERE ns=%s AND path=%s', (ns, path))

    def match(self, ns: str, path: str, kind: str, content_type: str, body: bytes) -> bool:
        return kind == 'record' and ns == self.ns and bool(self.path_re.match(path)) and body.startswith(b'{')

    def _fits(self, spec: ItemList, items: Any) -> bool:
        if not isinstance(items, list):
            return False
        return all(_scalar(i) for i in items) if spec.scalar else all(isinstance(i, dict) for i in items)

    def _rid(self, spec: ItemList, item: Any) -> str | None:
        if isinstance(item, dict) and MAP_KEY in item:
            return item[MAP_KEY]
        v = item.get(spec.key) if spec.key and isinstance(item, dict) else (item if spec.scalar else None)
        if isinstance(v, bool) or v is None:
            return None
        return str(v) if isinstance(v, (str, int)) else None

    def write(self, cur, ns: str, path: str, body: bytes) -> None:
        doc = json.loads(body.decode('utf-8'))
        head, lifted = (dict(doc), []) if isinstance(doc, dict) else (doc, [])
        for lkey, spec in self.lists.items():
            if lkey == MAP:
                entries = sorted(k for k, v in doc.items() if isinstance(v, dict)) if isinstance(doc, dict) else []
                for k in entries:
                    head.pop(k)
                lifted.append(MAP)
                self._write_rows(cur, ns, path, MAP, spec, [{**doc[k], MAP_KEY: k} for k in entries])
                continue
            items = doc.get(lkey, _MISSING) if isinstance(doc, dict) else _MISSING
            if items is not _MISSING and self._fits(spec, items):
                lifted.append(lkey)
                head.pop(lkey)
                self._write_rows(cur, ns, path, lkey, spec, items)
            else:
                cur.execute(f'DELETE FROM "{self.rows}" WHERE ns=%s AND path=%s AND list=%s', (ns, path, lkey))
        self._put_head(cur, ns, path, head, lifted)

    def _write_rows(self, cur, ns: str, path: str, lkey: str, spec: ItemList, items: list) -> None:
        cur.execute(f'SELECT pos, doc_hash FROM "{self.rows}" WHERE ns=%s AND path=%s AND list=%s', (ns, path, lkey))
        have = {r['pos']: r['doc_hash'] for r in cur.fetchall()}
        names = ''.join(f', "{c.name}"' for c in self.cols)
        sets = ''.join(f', "{c.name}"=EXCLUDED."{c.name}"' for c in self.cols)
        rows = []
        for pos, item in enumerate(items):
            rid = self._rid(spec, item)
            if isinstance(item, dict) and MAP_KEY in item:
                item = {k: v for k, v in item.items() if k != MAP_KEY}
            h = sha(canonical([rid, item] if lkey == MAP else item).encode('utf-8'))[:32]
            if have.get(pos) == h:
                continue
            if spec.scalar:
                vals, extra, value = {c.name: None for c in self.cols}, {}, Jsonb(item, dumps=canonical)
            else:
                vals, extra = lift(item, self.cols)
                value = None
            rows.append((ns, path, lkey, pos, rid, value, *[vals[c.name] for c in self.cols], Jsonb(extra, dumps=canonical), h))
        if rows:
            cur.executemany(f'INSERT INTO "{self.rows}" (ns, path, list, pos, rid, value{names}, extra, doc_hash) VALUES (%s, %s, %s, %s, %s, %s{", %s" * len(self.cols)}, %s, %s) '
                            f'ON CONFLICT (ns, path, list, pos) DO UPDATE SET rid=EXCLUDED.rid, value=EXCLUDED.value{sets}, extra=EXCLUDED.extra, doc_hash=EXCLUDED.doc_hash', rows)
        cur.execute(f'DELETE FROM "{self.rows}" WHERE ns=%s AND path=%s AND list=%s AND pos >= %s', (ns, path, lkey, len(items)))

    def read(self, cur, ns: str, path: str) -> bytes | None:
        r = self._get_head(cur, ns, path)
        if not r:
            return None
        doc = r['head']
        if not isinstance(doc, dict):
            return canonical(doc).encode('utf-8')
        for lkey in r['lists']:
            spec = self.lists.get(lkey, ItemList())
            cur.execute(f'SELECT * FROM "{self.rows}" WHERE ns=%s AND path=%s AND list=%s ORDER BY pos', (ns, path, lkey))
            if lkey == MAP:
                for row in cur.fetchall():
                    doc[row['rid']] = unlift(row, self.cols, row['extra'])
                continue
            doc[lkey] = [row['value'] if spec.scalar else unlift(row, self.cols, row['extra']) for row in cur.fetchall()]
        return canonical(doc).encode('utf-8')

    def delete(self, cur, ns: str, path: str) -> None:
        cur.execute(f'DELETE FROM "{self.rows}" WHERE ns=%s AND path=%s', (ns, path))
        self._del_head(cur, ns, path)

    # ── one row (by the item's key): the other rows of the document are not read or written ──
    def get_row(self, cur, ns: str, path: str, lkey: str, rid: str) -> Any:
        spec = self.lists[lkey]
        cur.execute(f'SELECT * FROM "{self.rows}" WHERE ns=%s AND path=%s AND list=%s AND rid=%s ORDER BY pos LIMIT 1', (ns, path, lkey, rid))
        row = cur.fetchone()
        if not row:
            return None
        return row['value'] if spec.scalar else unlift(row, self.cols, row['extra'])

    def put_row(self, cur, ns: str, path: str, lkey: str, item: Any, rid: str = '') -> dict:
        """Insert or replace one item (a new one goes last); the document need not exist yet. Cursor level: the caller
        (the engine) moves the key's rev and etag."""
        spec = self.lists[lkey]
        if not (_scalar(item) if spec.scalar else isinstance(item, dict)):
            raise ValueError(f'{lkey}: a row is {"a value" if spec.scalar else "an object"}')
        rid = rid or self._rid(spec, item) or ''
        if not rid:
            raise ValueError(f'{lkey}: a row needs a key ({spec.key or "the map key"})')
        head = self._get_head(cur, ns, path)
        if not head or not isinstance(head['head'], dict):
            self._put_head(cur, ns, path, {}, [lkey])
        elif lkey not in head['lists']:
            self._put_head(cur, ns, path, {k: v for k, v in head['head'].items() if k != lkey}, [*head['lists'], lkey])
        cur.execute(f'SELECT pos FROM "{self.rows}" WHERE ns=%s AND path=%s AND list=%s AND rid=%s ORDER BY pos LIMIT 1 FOR UPDATE', (ns, path, lkey, rid))
        row = cur.fetchone()
        if row:
            pos = row['pos']
        else:
            cur.execute(f'SELECT COALESCE(MAX(pos), -1) + 1 AS n FROM "{self.rows}" WHERE ns=%s AND path=%s AND list=%s', (ns, path, lkey))
            pos = cur.fetchone()['n']
        h = sha(canonical([rid, item] if lkey == MAP else item).encode('utf-8'))[:32]
        if spec.scalar:
            vals, extra, value = {c.name: None for c in self.cols}, {}, Jsonb(item, dumps=canonical)
        else:
            vals, extra = lift(item, self.cols)
            value = None
        names = ''.join(f', "{c.name}"' for c in self.cols)
        sets = ''.join(f', "{c.name}"=EXCLUDED."{c.name}"' for c in self.cols)
        cur.execute(f'INSERT INTO "{self.rows}" (ns, path, list, pos, rid, value{names}, extra, doc_hash) VALUES (%s, %s, %s, %s, %s, %s{", %s" * len(self.cols)}, %s, %s) '
                    f'ON CONFLICT (ns, path, list, pos) DO UPDATE SET rid=EXCLUDED.rid, value=EXCLUDED.value{sets}, extra=EXCLUDED.extra, doc_hash=EXCLUDED.doc_hash',
                    (ns, path, lkey, pos, rid, value, *[vals[c.name] for c in self.cols], Jsonb(extra, dumps=canonical), h))
        return {'applied': 1, 'added': 0 if row else 1, 'removed': 0}

    def delete_row(self, cur, ns: str, path: str, lkey: str, rid: str) -> bool:
        self.lists[lkey]  # noqa: B018 - an unknown list is a KeyError, like get_row
        cur.execute(f'DELETE FROM "{self.rows}" WHERE ns=%s AND path=%s AND list=%s AND rid=%s', (ns, path, lkey, rid))
        return bool(cur.rowcount)

    def counts(self, doc: Any) -> dict[str, int]:
        """list → the rows a document gives this table (the backfill / verify check)."""
        out = {}
        for lkey, spec in self.lists.items():
            if lkey == MAP:
                out[MAP] = sum(1 for v in doc.values() if isinstance(v, dict)) if isinstance(doc, dict) else 0
                continue
            items = doc.get(lkey) if isinstance(doc, dict) else None
            if self._fits(spec, items):
                out[lkey] = len(items)
        return out

    def ddl(self) -> str:
        return (f'CREATE TABLE IF NOT EXISTS "{self.rows}" (ns TEXT NOT NULL, path TEXT NOT NULL, list TEXT NOT NULL, pos INTEGER NOT NULL, rid TEXT, value JSONB{_ddl_cols(self.cols)}, '
                f'extra JSONB NOT NULL DEFAULT \'{{}}\', doc_hash TEXT NOT NULL, PRIMARY KEY (ns, path, list, pos));\n'
                f'CREATE INDEX IF NOT EXISTS "{self.rows}_rid" ON "{self.rows}" (rid);')


class HeadItemsTable(ItemsTable):
    """An ItemsTable whose document head is a row of its own table (lifted columns + extra) instead of a store_heads
    entry: one row per document in `name` (sessions), one row per list item in `rows` (session_messages)."""

    def __init__(self, name: str, ns: str, path_re: str, head_cols: list[Col], rows: str, lists: dict[str, ItemList], cols: list[Col], holds: str):
        super().__init__(name, ns, path_re, lists, cols, holds)
        self.rows, self.head_cols = rows, head_cols

    def _put_head(self, cur, ns: str, path: str, head: Any, lifted: list) -> None:
        vals, extra = lift(head, self.head_cols) if isinstance(head, dict) else ({c.name: None for c in self.head_cols}, {'\x00head': head})
        names = ''.join(f', "{c.name}"' for c in self.head_cols)
        sets = ''.join(f', "{c.name}"=EXCLUDED."{c.name}"' for c in self.head_cols)
        cur.execute(f'INSERT INTO "{self.name}" (ns, path{names}, extra, lists) VALUES (%s, %s{", %s" * len(self.head_cols)}, %s, %s) '
                    f'ON CONFLICT (ns, path) DO UPDATE SET extra=EXCLUDED.extra, lists=EXCLUDED.lists{sets}',
                    (ns, path, *[vals[c.name] for c in self.head_cols], Jsonb(extra, dumps=canonical), Jsonb(lifted)))

    def _get_head(self, cur, ns: str, path: str) -> dict | None:
        cur.execute(f'SELECT * FROM "{self.name}" WHERE ns=%s AND path=%s', (ns, path))
        r = cur.fetchone()
        if not r:
            return None
        if '\x00head' in (r['extra'] or {}):
            return {'head': r['extra']['\x00head'], 'lists': []}
        return {'head': unlift(r, self.head_cols, r['extra']), 'lists': r['lists']}

    def _del_head(self, cur, ns: str, path: str) -> None:
        cur.execute(f'DELETE FROM "{self.name}" WHERE ns=%s AND path=%s', (ns, path))

    def ddl(self) -> str:
        return (super().ddl() + '\n' + f'CREATE TABLE IF NOT EXISTS "{self.name}" (ns TEXT NOT NULL, path TEXT NOT NULL{_ddl_cols(self.head_cols)}, '
                f'extra JSONB NOT NULL DEFAULT \'{{}}\', lists JSONB NOT NULL DEFAULT \'[]\', PRIMARY KEY (ns, path));')


# ── MediaTable ───────────────────────────────────────────────────────────────────────────────────────────────────────

class MediaTable:
    """Binary media: the bytes in `blobs` (content-addressed, like every blob), one metadata row per file here."""
    keeps_blob = True

    def __init__(self, name: str, ns: str, path_re: str, holds: str):
        self.name, self.ns, self.holds = name, ns, holds
        self.path_re = re.compile(path_re)

    def match(self, ns: str, path: str, kind: str, content_type: str, body: bytes) -> bool:
        return kind == 'blob' and ns == self.ns and bool(self.path_re.match(path))

    def write_meta(self, cur, ns: str, path: str, digest: str, size: int, content_type: str, at: str) -> None:
        name = path.rpartition('/')[2]
        ext = name.rpartition('.')[2].lower() if '.' in name else ''
        cur.execute(f'INSERT INTO "{self.name}" (ns, path, name, ext, sha, size, content_type, at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s) '
                    'ON CONFLICT (ns, path) DO UPDATE SET name=EXCLUDED.name, ext=EXCLUDED.ext, sha=EXCLUDED.sha, size=EXCLUDED.size, content_type=EXCLUDED.content_type, at=EXCLUDED.at',
                    (ns, path, name, ext, digest, size, content_type, at))

    def read(self, cur, ns: str, path: str) -> bytes | None:
        cur.execute(f'SELECT b.bytes FROM "{self.name}" m JOIN blobs b ON b.sha = m.sha WHERE m.ns=%s AND m.path=%s', (ns, path))
        r = cur.fetchone()
        return bytes(r['bytes']) if r else None

    def delete(self, cur, ns: str, path: str) -> None:
        cur.execute(f'DELETE FROM "{self.name}" WHERE ns=%s AND path=%s', (ns, path))

    def ddl(self) -> str:
        return (f'CREATE TABLE IF NOT EXISTS "{self.name}" (ns TEXT NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL, ext TEXT NOT NULL, sha TEXT NOT NULL, '
                f'size BIGINT NOT NULL, content_type TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (ns, path));')


# ── the registry ─────────────────────────────────────────────────────────────────────────────────────────────────────

NOTE_COLS = [Col('at'), Col('text')]
# plan@1 features (framework/plan/plan.json and each profile's copy): one row per feature
PLAN_ITEM_COLS = [Col('id'), Col('title'), Col('area'), Col('kind'), Col('status'), Col('priority'), Col('wave'), Col('grp', 'group'),
                  Col('epic'), Col('parent'), Col('model'), Col('source')]
PROFILE_COLS = [Col('id'), Col('name'), Col('description'), Col('created_at', 'createdAt'), Col('updated_at', 'updatedAt')]
PLAN_PROJECT_COLS = [Col('id'), Col('name'), Col('description'), Col('profile'), Col('status'), Col('created_at', 'createdAt'), Col('updated_at', 'updatedAt')]
PROJECT_COLS = [Col('schema', '$manifest'), Col('name'), Col('display_name', 'displayName'), Col('kind'), Col('status'), Col('version'),
                Col('description'), Col('created')]
HISTORY_COLS = [Col('v', type='int'), Col('at'), Col('by'), Col('kind'), Col('note')]
PLANNER_NODE_COLS = [Col('id'), Col('title'), Col('kind'), Col('parent'), Col('status'), Col('name'), Col('created_at', 'createdAt'), Col('updated_at', 'updatedAt')]
_PLAN_DOC = r'^framework/plan/(profiles/[^/]+/framework/plan/)?'
PLAN_ITEMS = ItemsTable('plan_items', 'console', _PLAN_DOC + r'plan\.json$', {'features': ItemList('id'), 'statuses': ItemList(scalar=True)}, PLAN_ITEM_COLS,
                        'the plan (plan@1, framework/plan/plan.json and each profile copy): one row per feature, the statuses list as value rows')
PLAN_PROFILES = ItemsTable('plan_profiles', 'console', r'^framework/plan/profiles\.json$', {'profiles': ItemList('id')}, PROFILE_COLS,
                           'build profiles (build-profiles@1, framework/plan/profiles.json): one row per profile')
PLAN_PROJECTS = ItemsTable('plan_projects', 'console', r'^framework/plan/projects\.json$', {'projects': ItemList('id')}, PLAN_PROJECT_COLS,
                           'the plan project list (projects@1, framework/plan/projects.json): one row per project')
PROJECTS = RecordTable('projects', 'console', PROJECT_COLS, 'project manifests (project-manifest@1): one row per project (this repo and every /projects/<name>)',
                       r'^(project\.manifest\.json|projects/[^/]+/project\.manifest\.json)$')
PLAN_MEDIA = MediaTable('plan_media', 'console', r'^framework/plan/media/.+$', 'plan media (framework/plan/media): one row per file, the bytes in blobs')
PLANNER_HISTORY = ItemsTable('planner_history', 'planner', r'^(projects/[^/]+/)?history/[^/]+\.json$', {'versions': ItemList('v')}, HISTORY_COLS,
                             'Plan Studio history (plan-history@1): one row per saved version of a plan, the plan snapshot in extra')
PLANNER_CATEGORIES = ItemsTable('planner_categories', 'planner', r'^(projects/[^/]+/)?categories\.json$', {'paths': ItemList(scalar=True)}, [],
                                'Plan Studio categories (plan-categories@1): one row per category path')
PLANNER_LISTS = ItemsTable('planner_lists', 'planner', r'^(projects/[^/]+/)?(deleted|catalog-seen|blueprints)\.json$',
                           {'ids': ItemList(scalar=True), 'keys': ItemList(scalar=True), 'items': ItemList('id')}, [Col('id'), Col('name'), Col('description')],
                           'Plan Studio lists: deleted plan ids, catalog items seen, blueprints (one row per entry)')
PLANNER_TREE = ItemsTable('planner_tree', 'planner', r'^v2/tree\.json$', {'items': ItemList('id'), 'trash': ItemList('id')}, PLANNER_NODE_COLS,
                          'Plan Studio 2 tree (plan-tree@1): one row per node, trashed nodes in list trash')
BUILDS = DocTable('builds', 'builds', 'store.json',
                  {'builds': ListSpec('builds', BUILD_COLS, 'builds', key='id', children=(('steps', 'build_steps', STEP_COLS), ('notes', 'build_notes', NOTE_COLS)))},
                  'the builds store (builds@1): one row per build keyed by its id, steps in build_steps, notes in build_notes, the rest of the document in store_heads')
UI_REVIEW = DocTable('ui_review_items', 'ui-review', 'items.json', {'items': ListSpec('ui_review_items', UI_COLS, 'items')},
                     'UI Review items (ui-review-item@1): one row per item; groups and pack decisions in store_heads')
CONTROL = DocTable('control_targets', 'console', 'control/inventory.json',
                   {k: ListSpec('control_targets', CTRL_COLS, k, ('tabs', 'control_tabs', TAB_COLS) if k == 'tabGroups' else None)
                    for k in ('views', 'nav', 'tabGroups', 'settingsTabs', 'settings', 'functions', 'buttons', 'plugins')},
                   'the API / control registry (console-control-inventory@1): one row per target, generated from each plugin, never hand-edited')
SETTINGS = RecordTable('settings', 'settings', SETTINGS_COLS, 'settings documents (hub-settings@1 and friends): one row per document')
PLANNER = RecordTable('planner_items', 'planner', PLAN_COLS, 'planner items (plan@1): one row per plan', r'^(plans|projects/[^/]+/plans)/[^/]+\.json$')
NOTES = NotesTable()
# agent-slots@1 (s4.1): the VPS-wide session and heavy-step slots; one row per entry, the list it is in is its section
SLOT_COLS = [Col('id'), Col('name'), Col('kind'), Col('priority'), Col('build'), Col('state'), Col('host'), Col('pid', type='int'),
             Col('session'), Col('cwd'), Col('by'), Col('seq', type='int'), Col('enqueued_at', 'enqueuedAt'), Col('started_at', 'startedAt')]
AGENT_SLOTS = DocTable('agent_slots', 'console', 'agent-slots/state.json',
                       {k: ListSpec('agent_slots', SLOT_COLS, k, key='id') for k in ('running', 'queue', 'heavy', 'done')},
                       'agent slots (agent-slots@1): one row per running, waiting, heavy or recently done entry (section = its list); seq, guard trips, swap and hosts in store_heads')

# s4.3: the feature catalog (status.json, id → { status, wave, module, notes }), the libraries index, the project rules
CATALOG_FEATURES = ItemsTable('catalog_features', 'console', r'^framework/(plan/profiles/[^/]+/framework/)?catalog/status\.json$',
                              {MAP: ItemList()}, [Col('status'), Col('wave', type='int'), Col('module'), Col('notes'), Col('note')],
                              'the feature catalog (framework/catalog/status.json and each profile copy): one row per feature, rid = its id; the tracker is a view over it')
CATALOG_LIBRARIES = ItemsTable('catalog_libraries', 'console', r'^framework/(plan/profiles/[^/]+/framework/)?catalog/libraries\.json$', {'items': ItemList('id')},
                               [Col('schema', '$axf'), Col('id'), Col('module'), Col('name'), Col('description'), Col('manifest_key', 'manifestKey')],
                               'the libraries index (libraries@1, framework/catalog/libraries.json): one row per library')
PROJECT_RULES = ItemsTable('project_rules', 'console', r'^framework/(plan/profiles/[^/]+/framework/)?schemas/project-rules\.json$', {'rules': ItemList('id'), 'knownKeys': ItemList(scalar=True)},
                           [Col('id'), Col('title'), Col('description'), Col('severity'), Col('locked', type='bool')],
                           'project manifest rules (project-rules@1): one row per rule, the known manifest keys as value rows; ops and vocabulary in store_heads')

# s4.6: the session archive (session-archive@1: one row per session, one per prompt) and the codebase change log
SESSION_COLS = [Col('schema', '$axf'), Col('id'), Col('source'), Col('session_id', 'sessionId'), Col('project'), Col('title'), Col('started_at', 'startedAt'),
                Col('ended_at', 'endedAt'), Col('minutes', type='num'), Col('user'), Col('cost_source', 'costSource'), Col('ingested_at', 'ingestedAt')]
MESSAGE_COLS = [Col('i', type='int'), Col('at'), Col('kind'), Col('text'), Col('model'), Col('cost_usd', 'costUsd', 'num'), Col('cost_estimated', 'costEstimated', 'bool'),
                Col('seconds', type='num'), Col('commands', type='int'), Col('output')]
CHANGE_COLS = [Col('schema', '$axf'), Col('id'), Col('kind'), Col('title'), Col('asked'), Col('model'), Col('state'), Col('status'), Col('surface'),
               Col('created_at', 'createdAt'), Col('updated_at', 'updatedAt'), Col('started_at', 'startedAt'), Col('finished_at', 'finishedAt'), Col('progress', type='num')]
SESSIONS = HeadItemsTable('sessions', 'sessions', r'^archive/.+\.json$', SESSION_COLS, 'session_messages', {'prompts': ItemList('i')}, MESSAGE_COLS,
                          'the session archive (session-archive@1, sessions/archive/<yyyy>/<mm>/<id>.json): one row per session; its prompts in session_messages')
CODEBASE_CHANGES = RecordTable('codebase_changes', 'changes', CHANGE_COLS, 'the codebase change log (change-log@1, changes/<yyyy>/<mm>/<id>.json): one row per change',
                               r'^\d{4}/\d{2}/[^/]+\.json$')


# ── the plugin documents (build emergency-remove-every-leftover-js, s1): every JSON data file a plugin, the framework
# CLIs, deploy/ or the console server still wrote beside the database gets rows here. Three shapes:
#
#   plugin_doc()      a document at one key whose lists (or `id → object` maps) are rows of the plugin's own table
#                     `plugin_<folder>`: (section = `<document>#<list>`, rid = the item's id). One item is read with
#                     DocTable.get_row and written or removed with data-patch@1 (`{ key, item }` / `{ key, delete: true }`),
#                     so a change locks and rewrites one row.
#   ItemsTable        a family of documents (one per agent, profile, user…) whose lists are rows; get_row / put_row /
#                     delete_row by the item's id.
#   KeyRowTable       everything else under `plugins/` and `console/`: one row per key. A plugin that keeps each item as
#                     its own key (`plugins/<folder>/<collection>/<id>.json`) reads, writes and deletes that one row
#                     with the plain GET / PUT / DELETE of the key; no new table is needed for a new collection.
#
# The pipeline status file (builds/orchestrator.json and every copy of it) is not here: build
# pipeline-fixes-drop-7-mb-status-file removes it. No table below matches a key named orchestrator.json.
ITEM_COLS = [Col('schema', '$axf'), Col('id'), Col('name'), Col('title'), Col('kind'), Col('status'), Col('state'), Col('agent'), Col('build'),
             Col('at'), Col('created_at', 'createdAt'), Col('updated_at', 'updatedAt')]
MAP_ROWS = '\x00map'   # plugin_doc: this list is a map `id → object`
PLUGIN_TABLES: dict[str, str] = {}   # physical table → the plugin folder whose items it holds


def plugin_table(folder: str) -> str:
    return 'plugin_' + _IDENT_RE.sub('_', folder.lower())


def plugin_doc(folder: str, doc: str, lists: dict[str, str], holds: str, ns: str = 'plugins', path: str = '') -> DocTable:
    """The DocTable of one plugin document: `lists` maps a list name (ROOT: the document is the array) to the item field
    that keys its rows, or MAP_ROWS for a map. Every list of every document of a plugin shares `plugin_<folder>`."""
    table = plugin_table(folder)
    PLUGIN_TABLES[table] = folder
    stem = _IDENT_RE.sub('_', doc.lower().removesuffix('.json'))
    specs = {k: ListSpec(table, ITEM_COLS, f'{doc}#{k}', key='' if key == MAP_ROWS else key, map=key == MAP_ROWS) for k, key in lists.items()}
    return DocTable(f'{table}__{stem}', ns, path or f'{folder}/{doc}', specs, holds)


_IDENT_RE = re.compile(r'[^a-z0-9]+')

PLUGIN_DOCS: list = [
    # plugin dataDir documents (.axf-console/plugins/<folder>/… → plugins/<folder>/…)
    plugin_doc('agent-manager', 'hub-runs.json', {ROOT: 'id'}, 'agent hub runs: one row per run (command, exit, output)'),
    plugin_doc('agent-manager', 'addons.json', {'items': MAP_ROWS}, 'installed agent add-ons: one row per add-on'),
    plugin_doc('agent-manager', 'runs.json', {ROOT: 'id', 'runs': 'id', 'items': 'id'}, 'agent tool runs: one row per run'),
    *(plugin_doc('agent-manager', f'{n}.json', {'items': MAP_ROWS}, f'agent {n}: one row per entry')
      for n in ('agents', 'lingo', 'personas', 'skills', 'tools', 'training', 'workflows')),
    plugin_doc('agent-voice', 'store.json', {'profiles': MAP_ROWS, 'pronunciations': 'id'}, 'agent voice profiles (one row per agent) and pronunciations'),
    plugin_doc('build-orchestrator', 'merge-review.json', {'items': 'id'}, 'merge review: one row per reviewed build'),
    plugin_doc('build-orchestrator', 'watchdog/github-etags.json', {'entries': MAP_ROWS}, 'watchdog GitHub cache: one row per request'),
    plugin_doc('build-orchestrator', 'dup-check/checks.json', {'checks': MAP_ROWS}, 'duplicate checks: one row per checked build', ns='builds', path='dup-check/dup-check/checks.json'),
    plugin_doc('claude-accounts', 'workers.json', {'rules': 'id', 'perAccount': MAP_ROWS, 'api': MAP_ROWS}, 'Claude worker rules, per-account and API settings: one row each'),
    plugin_doc('claude-accounts', 'worker-state.json', {'usage': MAP_ROWS, 'claims': MAP_ROWS, 'limits': MAP_ROWS}, 'Claude worker usage, claims and limits: one row per account'),
    plugin_doc('claude-accounts', 'orgs.json', {'orgs': MAP_ROWS}, 'Claude organisations: one row per org'),
    plugin_doc('claude-badge', 'usage.json', {'accounts': 'name'}, 'Claude usage badge: one row per account'),
    plugin_doc('claude-handoff', 'index.json', {'runs': 'id'}, 'handoff runs index: one row per run', ns='console', path='shared/handoff/index.json'),
    plugin_doc('claude-session', 'agent-pick.json', {'sessions': 'id'}, 'Claude sessions and the agent each works as: one row per session; settings and personas in store_heads'),
    plugin_doc('console-terminal', 'feeds.json', {'feeds': MAP_ROWS}, 'terminal session feeds (mirrored chat / voice sessions): one row per feed'),
    plugin_doc('console-terminal', 'settings.json', {'claudeProfiles': 'id'}, 'terminal settings: one row per Claude profile; the rest in store_heads'),
    plugin_doc('ai-assistant', 'config.json', {'prompts': 'id'}, 'assistant config: one row per saved prompt; the rest in store_heads'),
    plugin_doc('ai-assistant', 'usage.json', {'days': MAP_ROWS}, 'assistant usage: one row per day'),
    plugin_doc('feature-matrix', 'reports.json', {'reports': 'id'}, 'feature matrix reports: one row per report'),
    plugin_doc('glossary-index', 'catalog.json', {'entries': 'id'}, 'the glossary catalog: one row per entry'),
    plugin_doc('glossary-index', 'changes.json', {ROOT: 'at'}, 'glossary change log: one row per change'),
    plugin_doc('molly-guide', 'walkthroughs.json', {ROOT: 'id'}, 'Molly guide walkthroughs: one row per walkthrough'),
    plugin_doc('plugin-manager', 'lazy-report.json', {'plugins': 'folder'}, 'plugin load report: one row per plugin folder'),
    plugin_doc('push-banner', 'landing-line.json', {'entries': 'id', 'history': 'id'}, 'the landing line: one row per entry and per landed entry'),
    plugin_doc('push-banner', 'merge-queue.json', {'waiting': 'pr', 'merged': 'pr', 'kicked': 'pr'}, 'the merge queue: one row per waiting, merged and kicked PR (rid = the PR number)'),
    plugin_doc('push-banner', 'merge-queue-control.json', {'kicked': MAP_ROWS, 'removed': MAP_ROWS}, 'merge queue control: one row per kicked and removed PR'),
    plugin_doc('push-banner', 'land-control.json', {'holds': MAP_ROWS, 'after': MAP_ROWS, 'off': MAP_ROWS}, 'landing control: one row per hold'),
    plugin_doc('push-banner', 'land.json', {'items': 'id'}, 'the landing list: one row per build waiting to land; switches and order in store_heads'),
    plugin_doc('push-banner', 'done.json', {'items': 'key'}, 'push banner done items: one row per item'),
    plugin_doc('push-banner', 'failed.json', {'items': 'key'}, 'push banner failed items: one row per item'),
    plugin_doc('systems-check', 'routine.json', {'checks': 'id'}, 'the systems check routine: one row per check'),
    plugin_doc('systems-check', 'health-state.json', {'checks': MAP_ROWS}, 'systems check state: one row per check; the fix log in store_heads'),
    plugin_doc('todo-manager', 'store.json', {'lists': 'id', 'entries': 'id', 'types': MAP_ROWS}, 'to-dos: one row per list, entry and entry type'),
    plugin_doc('token-control', 'passes.json', {'passes': 'id'}, 'token passes: one row per pass'),
    plugin_doc('whats-shipped', 'feed.json', {'items': 'id'}, "the What's shipped feed: one row per shipped item"),
    plugin_doc('ui-review', 'screenshots/index.json', {'shots': 'id', 'groups': 'id'}, 'UI Review screenshots: one row per shot and per group', ns='ui-review', path='screenshots/index.json'),
    plugin_doc('agent-swarm', 'state.json', {'agents': MAP_ROWS, 'messages': 'id'}, 'the crew: one row per agent and per chat message; rules, chat settings and notices in store_heads'),
    plugin_doc('agent-swarm', 'runs.json', {'runs': 'jobId'}, 'crew runs (swarm-run@1): one row per run, rid = its jobId'),
    # the builds namespace (_claude/builds/… and the hub's pipeline area → builds/…) and phone/
    plugin_doc('build-orchestrator', 'advice.json', {'builds': MAP_ROWS}, 'build advice: one row per build', ns='builds', path='advice.json'),
    plugin_doc('build-orchestrator', 'origins.json', {'origins': MAP_ROWS}, 'build origins (the prompt each build came from): one row per build', ns='builds', path='origins.json'),
    plugin_doc('build-orchestrator', 'bugs.json', {'bugs': 'id'}, 'bugs: one row per bug; settings in store_heads', ns='builds', path='bugs.json'),
    plugin_doc('build-orchestrator', 'matrices.json', {'matrices': 'id'}, 'build matrices: one row per matrix', ns='builds', path='matrices.json'),
    plugin_doc('build-orchestrator', 'build-rules/seed.json', {'rules': 'id'}, 'the build rules seed: one row per rule', ns='builds', path='build-rules/seed.json'),
    plugin_doc('build-orchestrator', 'pipeline/dispatch.json', {'tokens': MAP_ROWS}, 'pipeline dispatch tokens: one row per token', ns='builds', path='pipeline/dispatch.json'),
    plugin_doc('build-orchestrator', 'pipeline/merge-banner.json', {'posted': MAP_ROWS}, 'merge banner: one row per posted banner', ns='builds', path='pipeline/merge-banner.json'),
    plugin_doc('build-orchestrator', 'pipeline/routes.json', {'requests': 'id', 'pins': MAP_ROWS}, 'pipeline routes: one row per route request and pin', ns='builds', path='pipeline/routes.json'),
    plugin_doc('build-orchestrator', 'pipeline/accounts-host.json', {'rows': 'name'}, 'pipeline accounts as the host sees them: one row per account', ns='builds', path='pipeline/accounts-host.json'),
    plugin_doc('phone-connect', 'aliases.json', {'aliases': 'from', 'callers': 'file'}, 'phone aliases: one row per alias and per caller', ns='phone', path='aliases.json'),
    # hub documents (/projects/amberx-axf/_data/<area>/… → console/<area>/…)
    plugin_doc('agent-swarm', 'chats/index.json', {'chats': 'id'}, 'crew chats index: one row per chat', ns='console', path='agent-swarm/chats/index.json'),
    plugin_doc('agent-swarm', 'chats/mentions.json', {'mentions': 'id'}, 'crew mentions: one row per mention', ns='console', path='agent-swarm/chats/mentions.json'),
    plugin_doc('auto-lander', 'state.json', {'builds': 'build'}, 'the auto-lander: one row per build it is landing; policy and queue order in store_heads', ns='console', path='auto-lander/state.json'),
    plugin_doc('build-rules', 'store.json', {'rules': 'id'}, 'build rules (build-rules@1): one row per rule', ns='console', path='build-rules/store.json'),
    plugin_doc('host-services', 'states.json', {ROOT: 'id'}, 'host services: one row per service (mode, status, restarts)', ns='console', path='host-services/states.json'),
]
# families of documents (one per agent, profile, user, chunk): the lists are rows, an item is reached by its id
AGENT_MEMORY = ItemsTable('plugin_agent_memory', 'plugins', r'^agent-manager/memory/[^/]+\.json$', {'items': ItemList('id')},
                          [Col('id'), Col('kind'), Col('source'), Col('text'), Col('job_id', 'jobId'), Col('created_at', 'createdAt'), Col('last_used', 'lastUsed'), Col('hits', type='int')],
                          'agent memory (plugins/agent-manager/memory/<agent>.json): one row per memory item')
FEATURE_MATRICES = ItemsTable('plugin_feature_matrices', 'plugins', r'^feature-matrix/matrices/[^/]+\.json$', {'matrices': ItemList('id')},
                              [Col('id'), Col('title'), Col('profile'), Col('ref'), Col('version', type='int'), Col('created_at', 'createdAt'), Col('updated_at', 'updatedAt')],
                              'feature matrices (plugins/feature-matrix/matrices/<profile>.json): one row per matrix')
TODO_PROJECTS = ItemsTable('plugin_todo_projects', 'plugins', r'^todo-manager/projects/[^/]+/store\.json$', {'lists': ItemList('id'), 'entries': ItemList('id')},
                           [Col('id'), Col('title'), Col('kind'), Col('status'), Col('priority'), Col('list_id', 'listId'), Col('parent_id', 'parentId'), Col('created_at', 'createdAt'), Col('updated_at', 'updatedAt')],
                           'to-dos of each project (plugins/todo-manager/projects/<project>/store.json): one row per list and entry')
AGENT_COMMANDS = ItemsTable('agent_commands', 'console', r'^agents/[^/]+/commands\.json$', {'commands': ItemList('id')},
                            [Col('id'), Col('name'), Col('kind'), Col('command'), Col('repo'), Col('enabled', type='bool'), Col('updated_at', 'updatedAt')],
                            'agent commands (console/agents/<agent>/commands.json): one row per command')
HOME_CARDS = ItemsTable('home_cards', 'console', r'^home-cards/[^/]+\.json$', {'cards': ItemList('id'), 'order': ItemList(scalar=True), 'hidden': ItemList(scalar=True), 'dismissed': ItemList(scalar=True)},
                        [Col('id'), Col('title'), Col('icon'), Col('size'), Col('source'), Col('card_path', 'path')],
                        'home cards (console/home-cards/<user>.json): one row per card, the order / hidden / dismissed ids as value rows')
CLIENT_TABLE_ROWS = ItemsTable('client_table_rows', 'console', r'^(amberx-notes|companion|listeners|walkthrough)/.+/rows-\d+\.json$', {MAP: ItemList()},
                               [Col('schema', '$axf'), Col('id'), Col('name'), Col('title'), Col('parent'), Col('created_at', 'createdAt'), Col('updated_at', 'updatedAt')],
                               'app tables synced by the clients (notes, companion chats, listeners, walkthrough voice): one row per item of each rows-<n>.json chunk, rid = its id')
PHONE_ITEMS = RecordTable('phone_items', 'phone', [Col('schema', '$axf'), Col('id'), Col('device_id', 'deviceId'), Col('code'), Col('name'), Col('command'), Col('status'), Col('state'),
                                                   Col('at'), Col('updated_at', 'updatedAt')],
                          'phone connect (phone-device@1, phone-command@1, pairings): one row per device, command and pairing', r'^(devices|commands|pairings)/[^/]+\.json$')
CREW_CHATS = ItemsTable('crew_chat_messages', 'console', r'^agent-swarm/chats/[^/]+\.json$', {'messages': ItemList('id')},
                        [Col('id'), Col('at'), Col('sender', 'from'), Col('sender_name', 'fromName'), Col('kind'), Col('text'), Col('job_id', 'jobId')],
                        'crew chats (console/agent-swarm/chats/<chat>.json): one row per message; title and agents in store_heads')
AI_CONVERSATIONS = ItemsTable('plugin_ai_messages', 'plugins', r'^ai-assistant/conversations/[^/]+\.json$', {'messages': ItemList('id')},
                              [Col('id'), Col('role'), Col('content'), Col('created_at', 'createdAt', 'num')],
                              'assistant conversations (plugins/ai-assistant/conversations/<id>.json): one row per message')
AI_SESSIONS = ItemsTable('plugin_ai_events', 'plugins', r'^ai-assistant/sessions/[^/]+\.json$', {'events': ItemList('seq')},
                         [Col('seq', type='int'), Col('at', type='num'), Col('kind')],
                         'assistant sessions (plugins/ai-assistant/sessions/<id>.json): one row per event, rid = its seq')
COMMAND_CATALOGS = ItemsTable('plugin_command_catalog', 'plugins', r'^console-commands/catalog-[^/]+\.json$', {'items': ItemList('id')},
                              [Col('id'), Col('icon'), Col('kind'), Col('label'), Col('detail')],
                              'the command catalog of each user (plugins/console-commands/catalog-<user>.json): one row per command')
GH_CACHE = ItemsTable('plugin_push_banner_gh_cache', 'plugins', r'^push-banner/gh-cache\.json$', {MAP: ItemList()}, [Col('at', type='num'), Col('etag')],
                      'the GitHub response cache (plugins/push-banner/gh-cache.json): one row per request path, the response in extra')
PLUGIN_MAPS = ItemsTable('plugin_maps', 'plugins', r'^(maintenance/held|claude-accounts/seen)\.json$', {MAP: ItemList()}, [Col('at'), Col('job'), Col('held', type='bool')],
                         'plugin documents that are a map id → object (maintenance holds, Claude accounts seen): one row per entry')
BUILD_PROFILE_MATRICES = ItemsTable('build_profile_matrices', 'builds', r'^profiles/[^/]+/matrices\.json$', {'matrices': ItemList('id')},
                                    [Col('id'), Col('title'), Col('profile'), Col('ref'), Col('version', type='int'), Col('created_at', 'createdAt'), Col('updated_at', 'updatedAt')],
                                    'build matrices of each profile (builds/profiles/<profile>/matrices.json): one row per matrix')
MAINT_PLANS = ItemsTable('plugin_maintenance_plan_items', 'plugins', r'^maintenance/plans/[^/]+\.json$', {'items': ItemList('id')},
                         [Col('id'), Col('kind'), Col('job'), Col('ref'), Col('why'), Col('size', type='num'), Col('status')],
                         'maintenance plans (plugins/maintenance/plans/<plan>.json): one row per thing the plan would clean up')
PROFILE_CLEANUPS = ItemsTable('plugin_maintenance_profile_cleanups', 'plugins', r'^maintenance/profile-cleanup/plans/[^/]+\.json$', {'profiles': ItemList('id')},
                              [Col('id'), Col('name'), Col('base'), Col('archived', type='bool'), Col('finished', type='bool')],
                              'profile clean-up plans (plugins/maintenance/profile-cleanup/plans/<plan>.json): one row per profile')
ACCESS_BATCHES = ItemsTable('plugin_container_access_items', 'plugins', r'^container-access/batches/[^/]+\.json$', {'items': ItemList('id')},
                            [Col('id'), Col('kind'), Col('container'), Col('item_path', 'path'), Col('status'), Col('reason')],
                            'container access batches (plugins/container-access/batches/<batch>.json): one row per change in the batch')
PIPELINE_ACCOUNTS = ItemsTable('pipeline_accounts', 'builds', r'^pipeline/accounts\.json$', {MAP: ItemList()}, [],
                               'pipeline accounts (builds/pipeline/accounts.json, a map name → account): one row per account')
# items kept one per key outside plugins/ and console/: shipped build reports, report data, pipeline state, UI Review
# option assets and predictions, the session archive inbox. Never orchestrator.json (the pipeline status file).
_NOT_STATUS = r'(?!(.*/)?orchestrator\.json$)'
BUILD_KEY_ROWS = KeyRowTable('build_docs', 'builds', ITEM_COLS, 'build data kept one item per key (builds/shipped/<build>.json, reports, pipeline state, rules, profiles): one row per key',
                             '^' + _NOT_STATUS + r'(shipped|reports|pipeline|build-rules|profiles|dup-check)/.+\.json$')
UI_REVIEW_KEY_ROWS = KeyRowTable('ui_review_docs', 'ui-review', ITEM_COLS, 'UI Review option assets and predictions (ui-review/option-assets/…, predictions/…): one row per key',
                                 r'^(option-assets|predictions)/.+\.json$')
SESSION_INBOX = KeyRowTable('session_inbox', 'sessions', ITEM_COLS, 'the session archive inbox (sessions/archive-inbox/<id>.json): one row per dropped session', r'^archive-inbox/.+\.json$')
# every other JSON object under plugins/ and console/: one row per key (last in TABLES: a table above claims its own keys)
PLUGIN_KEY_ROWS = KeyRowTable('plugin_docs', 'plugins', ITEM_COLS, 'plugin data with no table of its own (plugins/<folder>/…): one row per key; an item kept as its own key is one row', '^' + _NOT_STATUS + r'[a-z0-9][a-z0-9-]*/.+\.json$')
CONSOLE_KEY_ROWS = KeyRowTable('console_docs', 'console', ITEM_COLS, 'console, framework and deploy data with no table of its own (console/…): one row per key', '^' + _NOT_STATUS + r'.+\.json$')
PLUGIN_FAMILIES: list = [AGENT_MEMORY, FEATURE_MATRICES, TODO_PROJECTS, AGENT_COMMANDS, HOME_CARDS, CLIENT_TABLE_ROWS, PHONE_ITEMS, CREW_CHATS, AI_CONVERSATIONS,
                         AI_SESSIONS, COMMAND_CATALOGS, GH_CACHE, PLUGIN_MAPS, MAINT_PLANS, PROFILE_CLEANUPS, ACCESS_BATCHES, BUILD_PROFILE_MATRICES, PIPELINE_ACCOUNTS]
KEY_ROWS: list = [BUILD_KEY_ROWS, UI_REVIEW_KEY_ROWS, SESSION_INBOX, PLUGIN_KEY_ROWS, CONSOLE_KEY_ROWS]

TABLES: list = [BUILDS, UI_REVIEW, CONTROL, SETTINGS, PLANNER, NOTES, AGENT_SLOTS, CATALOG_FEATURES, CATALOG_LIBRARIES, PROJECT_RULES, SESSIONS, CODEBASE_CHANGES,
                 PLAN_ITEMS, PLAN_PROFILES, PLAN_PROJECTS, PROJECTS, PLAN_MEDIA, PLANNER_HISTORY, PLANNER_CATEGORIES, PLANNER_LISTS, PLANNER_TREE,
                 *PLUGIN_DOCS, *PLUGIN_FAMILIES, *KEY_ROWS]
_BY_NAME = {t.name: t for t in TABLES}
assert len(_BY_NAME) == len(TABLES), 'two tables share a name'
# Tables a key already stored elsewhere (records, blobs) moves into on connect (PgStore._backfill): the ones added after
# the first copy. A table joins this list the release it is added; the backfill is idempotent and checks every key.
BACKFILL = {*(t.name for t in PLUGIN_DOCS), *(t.name for t in PLUGIN_FAMILIES), *(t.name for t in KEY_ROWS), 'agent_slots', 'sessions', 'codebase_changes', 'catalog_features', 'catalog_libraries', 'project_rules', 'plan_items', 'plan_profiles', 'plan_projects', 'projects', 'plan_media', 'planner_history', 'planner_categories', 'planner_lists', 'planner_tree'}

HOLDS = {
    'keys': 'every key: kind, rev, etag, when, who, size, content type, tombstone, which table holds its body',
    'records': 'records no domain table claims (JSONB)',
    'blobs': 'blob bytes, content-addressed',
    'journal': 'every journal line (entry JSONB + the stored line); append-only by trigger',
    'history': 'earlier revs of records and blobs (restore)',
    'changes': 'the change feed (watch, since)',
    'idem': 'idempotent appends',
    'meta': 'engine state (feed floor)',
    'store_heads': 'the fields of a decomposed document that are not rows',
    'build_steps': 'steps of each build (one row per step, under the build id)',
    'build_notes': 'notes of each build (one row per note: at, text, under the build id)',
    'control_tabs': 'tabs of each tab group in the control registry',
    'mirror_runs': 'each SQLite mirror run: source, tables, row counts, result',
    'session_messages': 'prompts of each archived session (one row per prompt, under the session key)',
    'tracker': 'view: the feature tracker (tracker@1 status board) over catalog_features; tracker.json is generated from it, not stored',
    'planner_shipped': 'view: the Plan Studio shipped log (journal planner/shipped-log), one row per line',
}

# Run before SCHEMA_SQL on a database made by an earlier version (pg.py PgStore._connect): the builds rows move from
# position-keyed (section, pos) to id-keyed (section, rid) with steps and notes under the id, and every list table gets
# `children_lifted` (JSONB, one flag per child list) in place of the single `child_lifted` flag. Idempotent.
MIGRATE_V2_SQL = """
DO $$
BEGIN
  IF to_regclass('builds') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'builds' AND column_name = 'rid') THEN
    ALTER TABLE builds RENAME TO builds_v1;
    ALTER TABLE build_steps RENAME TO build_steps_v1;
  END IF;
END $$;
"""
MIGRATE_V2_LISTS = ['ui_review_items', 'control_targets']


def migrate_v2(conn) -> dict:
    """Finish the move after SCHEMA_SQL made the new tables: rows of builds_v1 (+ build_steps_v1) are rewritten keyed by id."""
    out = {'builds': 0, 'lists': []}
    cur = conn.cursor()
    for t in MIGRATE_V2_LISTS:
        cur.execute("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = %s AND column_name = 'child_lifted'", (t,))
        if cur.fetchone():
            cur.execute(f'ALTER TABLE "{t}" ADD COLUMN IF NOT EXISTS children_lifted JSONB')
            ckey = next((s.child[0] for s in CONTROL.lists.values() if s.table == t and s.child), 'items')
            cur.execute(f'UPDATE "{t}" SET children_lifted = jsonb_build_object(%s::text, child_lifted) WHERE children_lifted IS NULL AND child_lifted IS NOT NULL', (ckey,))
            cur.execute(f'ALTER TABLE "{t}" DROP COLUMN child_lifted')
            out['lists'].append(t)
    cur.execute("SELECT to_regclass('builds_v1') AS t")
    if cur.fetchone()['t'] is None:
        return out
    spec = BUILDS.lists['builds']
    old_step_cols = STEP_COLS
    cur.execute('SELECT * FROM build_steps_v1 ORDER BY parent_pos, pos')
    steps: dict[int, list[dict]] = {}
    for row in cur.fetchall():
        steps.setdefault(row['parent_pos'], []).append(unlift(row, old_step_cols, row['extra']))
    cur.execute('SELECT * FROM builds_v1 ORDER BY pos')
    items = []
    for row in cur.fetchall():
        item = unlift(row, BUILD_COLS, row['extra'])
        if row.get('child_lifted'):
            item['steps'] = steps.get(row['pos'], [])
        items.append(item)
    BUILDS._write_list(cur, spec, items)  # noqa: SLF001 (same module family)
    cur.execute('DROP TABLE build_steps_v1')
    cur.execute('DROP TABLE builds_v1')
    out['builds'] = len(items)
    return out


SCHEMA_SQL = '\n'.join(t.ddl() for t in TABLES) + """
CREATE TABLE IF NOT EXISTS store_heads (ns TEXT NOT NULL, path TEXT NOT NULL, head JSONB NOT NULL, lists JSONB NOT NULL, PRIMARY KEY (ns, path));
CREATE TABLE IF NOT EXISTS mirror_runs (id BIGSERIAL PRIMARY KEY, prefix TEXT NOT NULL, source TEXT NOT NULL, at TEXT NOT NULL, tables JSONB NOT NULL, ok BOOLEAN NOT NULL, error TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS builds_status ON builds (status);
CREATE INDEX IF NOT EXISTS build_steps_parent ON build_steps (section, parent_rid);
CREATE INDEX IF NOT EXISTS build_notes_parent ON build_notes (section, parent_rid);
CREATE INDEX IF NOT EXISTS ui_review_items_id ON ui_review_items (id);
CREATE INDEX IF NOT EXISTS ui_review_items_status ON ui_review_items (status);
CREATE INDEX IF NOT EXISTS control_targets_address ON control_targets (address);
CREATE INDEX IF NOT EXISTS planner_items_status ON planner_items (status);
CREATE OR REPLACE VIEW build_journal AS
  SELECT ns, path, seq, at, actor, entry->>'action' AS action, entry->>'note' AS note, entry->>'by' AS who, (entry->>'rev') AS store_rev, entry->'builds' AS builds, entry
  FROM journal WHERE ns = 'builds' AND path LIKE 'journal/%';
CREATE INDEX IF NOT EXISTS plan_items_status ON plan_items (status);
CREATE INDEX IF NOT EXISTS sessions_started ON sessions (started_at);
CREATE INDEX IF NOT EXISTS codebase_changes_created ON codebase_changes (created_at);
CREATE OR REPLACE VIEW tracker AS
  SELECT path, rid AS id, status, wave, module, COALESCE(notes, note) AS notes, extra
  FROM catalog_features WHERE ns = 'console' AND list = '*';
CREATE OR REPLACE VIEW planner_shipped AS
  SELECT seq, at, actor, entry->>'build' AS build, entry->>'plan' AS plan, entry->>'id' AS id, (entry->>'ok')::boolean AS ok,
         entry->>'source' AS source, entry->>'why' AS why, entry
  FROM journal WHERE ns = 'planner' AND path = 'shipped-log';
CREATE OR REPLACE VIEW note_history AS
  SELECT ns, path, seq, at, actor, entry FROM journal WHERE ns = 'notes' AND path LIKE '_history/%';
"""


def table_for(ns: str, path: str, kind: str, content_type: str, body: bytes):
    for t in TABLES:
        if t.match(ns, path, kind, content_type or '', body):
            return t
    return None


def by_name(name: str):
    return _BY_NAME.get(name)


def describe(name: str, mirrors: dict[str, str]) -> str:
    if name in _BY_NAME:
        return _BY_NAME[name].holds
    if name in HOLDS:
        return HOLDS[name]
    if name in PLUGIN_TABLES:
        docs = [t for t in PLUGIN_DOCS if any(s.table == name for s in t.lists.values())]
        return f"{PLUGIN_TABLES[name]}: one row per item, keyed by its id (section = document#list): " + '; '.join(f'{t.ns}/{t.path}' for t in docs)
    for key, prefix in mirrors.items():
        if name.startswith(prefix + '_'):
            return f'table {name[len(prefix) + 1:]} of {key}, mirrored row for row'
    return ''


# ── SQLite mirror ────────────────────────────────────────────────────────────────────────────────────────────────────

DEFAULT_MIRROR = 'plugins/shipped-features/ledger.sqlite=ledger,plugins/chat-viewer/chats.db=chats'
_IDENT = re.compile(r'[^a-z0-9_]')


def mirror_map(env: dict | None = None) -> dict[str, str]:
    """`AXF_DATA_MIRROR`: `<key>=<prefix>,…` — which uploaded SQLite files become rows and under which table prefix."""
    env = env or os.environ
    out = {}
    for part in (env.get('AXF_DATA_MIRROR') or DEFAULT_MIRROR).split(','):
        if '=' in part:
            k, _, p = part.strip().partition('=')
            if k and _IDENT.sub('', p.lower()) == p and p:
                out[k] = p
    return out


def _pg_type(decl: str, col: str) -> str:
    d = (decl or '').upper()
    if col == 'doc':
        return 'JSONB'
    if 'INT' in d:
        return 'BIGINT'
    if any(x in d for x in ('REAL', 'FLOA', 'DOUB')):
        return 'DOUBLE PRECISION'
    if 'BLOB' in d:
        return 'BYTEA'
    return 'TEXT'


def _convert(v: Any, pg: str) -> Any:
    if v is None:
        return None
    if pg == 'JSONB':
        return Jsonb(json.loads(v) if isinstance(v, str) else v)
    if pg == 'TEXT':
        return v if isinstance(v, str) else (v.decode('utf-8', 'replace') if isinstance(v, (bytes, memoryview)) else str(v))
    if pg == 'BIGINT':
        return int(v) if not isinstance(v, (bytes, memoryview)) else int(bytes(v))
    if pg == 'DOUBLE PRECISION':
        return float(v)
    if pg == 'BYTEA':
        return bytes(v) if isinstance(v, (bytes, memoryview)) else str(v).encode('utf-8')
    return v


def _sqlite_tables(db: sqlite3.Connection) -> list[tuple[str, list[dict]]]:
    rows = db.execute("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
    virtual = [n for n, s in rows if (s or '').upper().startswith('CREATE VIRTUAL TABLE')]
    out = []
    for name, _sql in rows:
        if name in virtual or any(name.startswith(v + '_') for v in virtual):
            continue  # full-text indexes and their shadow tables are rebuilt by the plugin, not data
        cols = [{'name': c[1], 'type': c[2], 'pk': c[5]} for c in db.execute(f'PRAGMA table_info("{name}")')]
        out.append((name, cols))
    return out


# Every DDL / TRUNCATE a mirror run takes waits at most this long for a table lock (see _copy_table).
MIRROR_LOCK_TIMEOUT = '5s'


def mirror_sqlite_bytes(cur, prefix: str, body: bytes, source: str, at: str) -> dict:
    with tempfile.NamedTemporaryFile(suffix='.sqlite', delete=False) as f:
        f.write(body)
        tmp = f.name
    try:
        return mirror_sqlite_file(cur, prefix, tmp, source, at)
    finally:
        os.unlink(tmp)


def mirror_sqlite_file(cur, prefix: str, path: str, source: str, at: str) -> dict:
    """Every table of the SQLite file → `<prefix>_<table>` (full refresh under a savepoint, row counts checked)."""
    run = {'$axf': 'data-mirror-run@1', 'prefix': prefix, 'source': source, 'at': at, 'tables': {}, 'ok': True, 'error': ''}
    db = sqlite3.connect(f'file:{path}?mode=ro&immutable=1', uri=True)
    try:
        for name, cols in _sqlite_tables(db):
            target = f'{prefix}_{_IDENT.sub("_", name.lower())}'
            want = db.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
            types = {c['name']: _pg_type(c['type'], c['name']) for c in cols}
            try:
                with cur.connection.transaction():
                    _copy_table(cur, db, name, cols, target, types)
            except pg_errors.LockNotAvailable:
                # a backup (pg_dump) holds the table: not a typing problem, so no text-column retry. That retry's DROP
                # waited on the same lock with no timeout, inside the store's write lock, and stalled every API call
                # for 13 minutes (Nov 20 2026: builds-store patches timed out client-side). The run fails; the next retries.
                raise
            except Exception as e:  # noqa: BLE001 — dynamic typing: retry the table with text columns
                with cur.connection.transaction():
                    cur.execute(f"SET LOCAL lock_timeout = '{MIRROR_LOCK_TIMEOUT}'")
                    cur.execute(f'DROP TABLE IF EXISTS "{target}"')
                    _copy_table(cur, db, name, cols, target, {c['name']: ('BYTEA' if types[c['name']] == 'BYTEA' else 'TEXT') for c in cols})
                run['tables'][name] = {'rows': want, 'note': f'text columns ({type(e).__name__})'}
            cur.execute(f'SELECT COUNT(*) AS n FROM "{target}"')
            got = cur.fetchone()['n']
            run['tables'].setdefault(name, {})['rows'] = got
            if got != want:
                raise RuntimeError(f'{name}: {want} rows in the file, {got} copied')
    except Exception as e:  # noqa: BLE001
        run.update(ok=False, error=f'{type(e).__name__}: {e}'[:300])
    finally:
        db.close()
    cur.execute('INSERT INTO mirror_runs (prefix, source, at, tables, ok, error) VALUES (%s, %s, %s, %s, %s, %s)', (prefix, source, at, Jsonb(run['tables']), run['ok'], run['error']))
    if not run['ok']:
        raise RuntimeError(run['error'])
    return run


def _copy_table(cur, db: sqlite3.Connection, name: str, cols: list[dict], target: str, types: dict[str, str]) -> None:
    # TRUNCATE / ALTER need an exclusive lock; a pg_dump (backup) holds a share lock for many minutes. The mirror runs
    # inside the store's write lock, so waiting would stall every API call (Nov 19 2026: a backup + a ledger mirror held
    # axf-data for 10 min). Give up after a few seconds instead: the run fails, is logged, and the next upload retries.
    cur.execute(f"SET LOCAL lock_timeout = '{MIRROR_LOCK_TIMEOUT}'")
    pk = [c['name'] for c in sorted((c for c in cols if c['pk']), key=lambda c: c['pk'])]
    ddl = ', '.join(f'"{c["name"]}" {types[c["name"]]}' for c in cols)
    cur.execute(f'CREATE TABLE IF NOT EXISTS "{target}" ({ddl}{", PRIMARY KEY (" + ", ".join(chr(34) + p + chr(34) for p in pk) + ")" if pk else ""})')
    for c in cols:
        cur.execute(f'ALTER TABLE "{target}" ADD COLUMN IF NOT EXISTS "{c["name"]}" {types[c["name"]]}')
    cur.execute(f'TRUNCATE "{target}"')
    names = ', '.join(f'"{c["name"]}"' for c in cols)
    order = [c['name'] for c in cols]
    with cur.copy(f'COPY "{target}" ({names}) FROM STDIN') as cp:
        for row in db.execute(f'SELECT {", ".join(chr(34) + n + chr(34) for n in order)} FROM "{name}"'):
            cp.write_row(tuple(_convert(v, types[n]) for v, n in zip(row, order)))


def mirror_runs(st) -> list[dict]:
    """The newest run per prefix (data-tables@1 → mirrors)."""
    rows = st.fetchall('SELECT DISTINCT ON (prefix) prefix, source, at, tables, ok, error FROM mirror_runs ORDER BY prefix, id DESC')
    return [{'prefix': r['prefix'], 'source': r['source'], 'at': r['at'], 'tables': r['tables'], 'ok': r['ok'], 'error': r['error']} for r in rows]
