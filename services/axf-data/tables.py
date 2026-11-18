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
  NotesTable   Brett's notes: Markdown text in a `notes` row instead of an opaque blob.
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

    @property
    def kids(self) -> tuple:
        return tuple(self.children) + ((self.child,) if self.child else ())

    @property
    def parent_col(self) -> str:
        return 'parent_rid' if self.key else 'parent_pos'


TABLES_VERSION = 2   # meta.tables_version: 2 = keyed rows (rid) for lists with a key, children_lifted JSONB, build_notes


def _rid(item: dict, spec: ListSpec, pos: int) -> str:
    v = item.get(spec.key)
    return v if isinstance(v, str) and v else f'#{pos}'


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
        if not isinstance(doc, dict):
            self._head(cur, ns, path, doc, [])
            self._clear_rows(cur)
            return
        head, lifted = dict(doc), []
        for key, spec in self.lists.items():
            items = doc.get(key, _MISSING)
            if isinstance(items, list) and all(isinstance(i, dict) for i in items):
                lifted.append(key)
                head.pop(key)
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
        parent = (rid or _rid(item, spec, pos)) if spec.key else pos
        lifted = self._write_kids(cur, spec, parent, item, extra)
        names = ', '.join(f'"{c.name}"' for c in spec.cols)
        sets = ', '.join(f'"{c.name}"=EXCLUDED."{c.name}"' for c in spec.cols)
        if spec.key:
            cur.execute(f'INSERT INTO "{spec.table}" (section, rid, pos{", " + names if names else ""}, extra, doc_hash, children_lifted) VALUES (%s, %s, %s{", %s" * len(spec.cols)}, %s, %s, %s) '
                        f'ON CONFLICT (section, rid) DO UPDATE SET pos=EXCLUDED.pos, {sets + ", " if sets else ""}extra=EXCLUDED.extra, doc_hash=EXCLUDED.doc_hash, children_lifted=EXCLUDED.children_lifted',
                        (spec.section, parent, pos, *[vals[c.name] for c in spec.cols], Jsonb(extra, dumps=canonical), h, Jsonb(lifted) if lifted is not None else None))
        else:
            cur.execute(f'INSERT INTO "{spec.table}" (section, pos{", " + names if names else ""}, extra, doc_hash, children_lifted) VALUES (%s, %s{", %s" * len(spec.cols)}, %s, %s, %s) '
                        f'ON CONFLICT (section, pos) DO UPDATE SET {sets + ", " if sets else ""}extra=EXCLUDED.extra, doc_hash=EXCLUDED.doc_hash, children_lifted=EXCLUDED.children_lifted',
                        (spec.section, pos, *[vals[c.name] for c in spec.cols], Jsonb(extra, dumps=canonical), h, Jsonb(lifted) if lifted is not None else None))

    def _write_list(self, cur, spec: ListSpec, items: list[dict]) -> None:
        if spec.key:
            cur.execute(f'SELECT rid, pos, doc_hash FROM "{spec.table}" WHERE section=%s', (spec.section,))
            have = {r['rid']: (r['pos'], r['doc_hash']) for r in cur.fetchall()}
            seen = set()
            for pos, item in enumerate(items):
                rid = _rid(item, spec, pos)
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
        for key in r['lists']:
            doc[key] = self._read_list(cur, self.lists[key])
        return canonical(doc).encode('utf-8')

    def _read_list(self, cur, spec: ListSpec) -> list[dict]:
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
            parent = row['rid'] if spec.key else row['pos']
            for ckey, _ctable, _ccols in spec.kids:
                if lifted.get(ckey):
                    item[ckey] = kids.get(ckey, {}).get(parent, [])
            out.append(item)
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
        return {k: s for k, s in self.lists.items() if s.key}

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
        applied = added = 0
        for lkey, changes in lists.items():
            spec = self.lists[lkey]
            if lkey not in lifted:
                lifted.append(lkey)
                cur_head.pop(lkey, None)
            cur.execute(f'SELECT COALESCE(MAX(pos), -1) AS m FROM "{spec.table}" WHERE section=%s', (spec.section,))
            nxt = cur.fetchone()['m'] + 1
            for ch in changes:
                item = ch['item']
                rid = ch['key']
                cur.execute(f'SELECT pos FROM "{spec.table}" WHERE section=%s AND rid=%s', (spec.section, rid))
                row = cur.fetchone()
                pos = row['pos'] if row else nxt
                if not row:
                    nxt += 1
                    added += 1
                self._upsert_row(cur, spec, pos, item, sha(canonical(item).encode('utf-8'))[:32])
                applied += 1
        if head:
            for k, v in head.items():
                if k in self.lists:
                    continue
                cur_head[k] = v
        self._head(cur, ns, path, cur_head, lifted)
        return {'applied': applied, 'added': added, 'head': cur_head}

    def ddl(self) -> str:
        out = []
        for spec in self.lists.values():
            if spec.key:
                out.append(f'CREATE TABLE IF NOT EXISTS "{spec.table}" (section TEXT NOT NULL, rid TEXT NOT NULL, pos INTEGER NOT NULL{_ddl_cols(spec.cols)}, '
                           f'extra JSONB NOT NULL DEFAULT \'{{}}\', doc_hash TEXT NOT NULL, children_lifted JSONB, PRIMARY KEY (section, rid));')
                out.append(f'CREATE INDEX IF NOT EXISTS "{spec.table}_pos" ON "{spec.table}" (section, pos);')
            else:
                out.append(f'CREATE TABLE IF NOT EXISTS "{spec.table}" (section TEXT NOT NULL, pos INTEGER NOT NULL{_ddl_cols(spec.cols)}, '
                           f'extra JSONB NOT NULL DEFAULT \'{{}}\', doc_hash TEXT NOT NULL, children_lifted JSONB, PRIMARY KEY (section, pos));')
            for _ckey, ctable, ccols in spec.kids:
                pcol = f'{spec.parent_col} {"TEXT" if spec.key else "INTEGER"} NOT NULL'
                out.append(f'CREATE TABLE IF NOT EXISTS "{ctable}" (section TEXT NOT NULL, {pcol}, pos INTEGER NOT NULL{_ddl_cols(ccols)}, '
                           f'extra JSONB NOT NULL DEFAULT \'{{}}\', PRIMARY KEY (section, {spec.parent_col}, pos));')
        return '\n'.join(out)


# ── data-patch@1: the shape both engines accept, checked once, applied to rows (pg.py) or to the document (store.py) ──

def check_patch(body: Any, table: DocTable | None) -> dict:
    """Validate a patch body: { head?: {…}, lists: { <list>: [ { key, ifRev?, item } ] }, journal?: { path, entry, idem? } }."""
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
            if not isinstance(ch, dict) or not isinstance(ch.get('key'), str) or not ch['key'] or not isinstance(ch.get('item'), dict):
                raise ValueError(f'{lkey}: each change is {{ key, ifRev?, item }}')
            if ch['key'] in seen:
                raise ValueError(f'{lkey}: {ch["key"]} is changed twice')
            seen.add(ch['key'])
            if ch['item'].get(spec.key) != ch['key']:
                raise ValueError(f'{lkey}: item.{spec.key} must equal key ({ch["key"]})')
            if_rev = ch.get('ifRev', _MISSING)
            if if_rev is not _MISSING and if_rev is not None and not (isinstance(if_rev, int) and not isinstance(if_rev, bool)):
                raise ValueError(f'{lkey}: ifRev is a whole number, null (must not exist) or absent (no check)')
            out.append({'key': ch['key'], 'ifRev': if_rev, 'item': ch['item']})
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
        items = list(out.get(lkey) or []) if isinstance(out.get(lkey), list) else []
        index = {it.get(spec.key): i for i, it in enumerate(items) if isinstance(it, dict) and isinstance(it.get(spec.key), str)}
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
    for it in items if isinstance(items, list) else []:
        if isinstance(it, dict) and it.get(spec.key) in want and it[spec.key] not in out:
            out[it[spec.key]] = {'rev': it.get('rev')}
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


# ── the registry ─────────────────────────────────────────────────────────────────────────────────────────────────────

NOTE_COLS = [Col('at'), Col('text')]
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

TABLES: list = [BUILDS, UI_REVIEW, CONTROL, SETTINGS, PLANNER, NOTES]
_BY_NAME = {t.name: t for t in TABLES}

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
            cur.execute(f'UPDATE "{t}" SET children_lifted = jsonb_build_object(%s, child_lifted) WHERE children_lifted IS NULL AND child_lifted IS NOT NULL', (ckey,))
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
            except Exception as e:  # noqa: BLE001 — dynamic typing: retry the table with text columns
                with cur.connection.transaction():
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
