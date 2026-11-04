"""The Chat viewer's store: one SQLite file (chats.db) in the plugin's data folder on the console's data volume.

Why SQLite: full-text search over every message (FTS5, ships with Python's sqlite3), cheap appends for continued
sessions (a Claude Code session grows by a few lines per sync; a JSON file per session would be rewritten whole),
transactions so a sync cut off half way leaves the last good copy, and one file to back up. Nothing here is in git.

Tables:
    sessions   one row per session@1 (no messages), its version, last change, seen flag
    messages   (session_id, seq) → role, kind, text, at, tool_name
    versions   every version: hash, count, change (new | continued | changed); a 'changed' version keeps the messages
               it replaced (a 'continued' one doesn't need to: they are the first messageCount messages of the next)
    fts        FTS5 over message text (seq ≥ 0) and the title (seq = -1)
    cursors    incremental sync state per source file (size, mtime, byte offset, small extras)
    runs       the last sync reports ("check for updates")

Everything written goes through redact() first (session@1 rule), whatever the source.
"""
from __future__ import annotations

import json
import re
import sqlite3
import threading
from pathlib import Path
from typing import Any

from . import schema as S

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT NOT NULL, started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  project TEXT NOT NULL DEFAULT '', hash TEXT NOT NULL, message_count INTEGER NOT NULL DEFAULT 0,
  via TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '',
  cwd TEXT NOT NULL DEFAULT '', host TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1, change TEXT NOT NULL DEFAULT 'new', changed_at TEXT NOT NULL DEFAULT '',
  seen INTEGER NOT NULL DEFAULT 0, ingested_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sessions_updated ON sessions(updated_at);
CREATE TABLE IF NOT EXISTS messages (
  session_id TEXT NOT NULL, seq INTEGER NOT NULL, role TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT '', tool_name TEXT NOT NULL DEFAULT '', PRIMARY KEY (session_id, seq)
);
CREATE TABLE IF NOT EXISTS versions (
  session_id TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL, updated_at TEXT NOT NULL,
  message_count INTEGER NOT NULL, change TEXT NOT NULL, messages TEXT, saved_at TEXT NOT NULL,
  PRIMARY KEY (session_id, version)
);
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(text, session_id UNINDEXED, seq UNINDEXED, tokenize='unicode61');
CREATE TABLE IF NOT EXISTS cursors (path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime REAL NOT NULL, offset INTEGER NOT NULL, session_id TEXT NOT NULL DEFAULT '', extra TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, report TEXT NOT NULL);
"""

META_FIELDS = ("via", "origin", "model", "branch", "cwd", "host")


def _msg(m: dict[str, Any]) -> dict[str, Any]:
    """A clean, redacted session@1 message."""
    out = {"role": m["role"], "text": S.redact(str(m.get("text") or ""))[: S.REGISTRY["maxText"]], "at": m.get("at") or "", "kind": m["kind"]}
    if m.get("toolName"):
        out["toolName"] = str(m["toolName"])[:80]
    return out


class Store:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self.db = sqlite3.connect(str(self.path), check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.executescript(SCHEMA_SQL)
        try:
            self.path.chmod(0o600)
        except OSError:
            pass

    def close(self) -> None:
        with self._lock:
            self.db.close()

    # ------------------------------------------------------------------ writes

    def upsert(self, s: dict[str, Any], *, append: bool = False) -> str:
        """Store one session. Returns new | continued | changed | unchanged.

        append=False: `s["messages"]` is the whole session (exports, hub drops, build logs); a longer copy whose
        first messages hash to the stored hash is a continuation, anything else a change (the old copy is kept).
        append=True: `s["messages"]` are only the messages after the stored ones (Claude Code incremental sync).
        """
        msgs = [_msg(m) for m in s.get("messages") or []]
        title = S.redact(str(s.get("title") or "").strip())[: S.REGISTRY["maxTitle"]] or "Untitled session"
        now = S.now_iso()
        with self._lock:
            cur = self.db.execute("SELECT * FROM sessions WHERE id=?", (s["id"],)).fetchone()
            self.db.execute("BEGIN")
            try:
                change = self._upsert(cur, s, msgs, title, now, append)
                self.db.execute("COMMIT")
            except Exception:
                self.db.execute("ROLLBACK")
                raise
            return change

    def _upsert(self, cur: sqlite3.Row | None, s: dict[str, Any], msgs: list[dict[str, Any]], title: str, now: str, append: bool) -> str:
        sid = s["id"]
        meta = {k: str(s.get(k) or "")[:300] for k in META_FIELDS}
        extra = json.dumps(s.get("meta") or {})[:20000]
        if cur is None:
            h = S.chain_hash(msgs)
            self.db.execute(
                "INSERT INTO sessions (id, source, title, started_at, updated_at, project, hash, message_count, via, origin, model, branch, cwd, host, meta, version, change, changed_at, seen, ingested_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'new',?,0,?)",
                (sid, s["source"], title, s.get("startedAt") or now, s.get("updatedAt") or now, s.get("project") or "", h, len(msgs), *meta.values(), extra, now, now),
            )
            self._insert_messages(sid, 0, msgs)
            self._fts_title(sid, title)
            self._version(sid, 1, h, s.get("updatedAt") or now, len(msgs), "new", None, now)
            return "new"
        old_count, old_hash = cur["message_count"], cur["hash"]
        if append:
            if not msgs and title == cur["title"]:
                return "unchanged"
            new_hash = S.chain_hash(msgs, old_hash)
            change, keep = "continued", None
            self._insert_messages(sid, old_count, msgs)
            total = old_count + len(msgs)
        else:
            new_hash = S.chain_hash(msgs)
            if new_hash == old_hash and title == cur["title"]:
                return "unchanged"
            if new_hash == old_hash:  # same messages, renamed
                self.db.execute("UPDATE sessions SET title=? WHERE id=?", (title, sid))
                self._fts_title(sid, title)
                return "unchanged"
            if len(msgs) > old_count and S.chain_hash(msgs[:old_count]) == old_hash:
                change, keep = "continued", None
                self._insert_messages(sid, old_count, msgs[old_count:])
            else:
                change, keep = "changed", self.messages(sid)
                self.db.execute("DELETE FROM messages WHERE session_id=?", (sid,))
                self.db.execute("DELETE FROM fts WHERE session_id=? AND seq>=0", (sid,))
                self._insert_messages(sid, 0, msgs)
            total = len(msgs)
        version = cur["version"] + 1
        if keep is not None:  # the copy being replaced stays readable (and restorable) as the previous version
            self.db.execute("UPDATE versions SET messages=? WHERE session_id=? AND version=?", (json.dumps(keep), sid, cur["version"]))
        upd = s.get("updatedAt") or now
        started = min(x for x in (cur["started_at"], s.get("startedAt") or cur["started_at"]) if x)
        self.db.execute(
            "UPDATE sessions SET title=?, updated_at=?, started_at=?, hash=?, message_count=?, version=?, change=?, changed_at=?, seen=0, ingested_at=?,"
            " project=CASE WHEN ?<>'' THEN ? ELSE project END, model=CASE WHEN ?<>'' THEN ? ELSE model END, branch=CASE WHEN ?<>'' THEN ? ELSE branch END, cwd=CASE WHEN ?<>'' THEN ? ELSE cwd END"
            " WHERE id=?",
            (title, max(upd, cur["updated_at"]), started, new_hash, total, version, change, now, now,
             s.get("project") or "", s.get("project") or "", meta["model"], meta["model"], meta["branch"], meta["branch"], meta["cwd"], meta["cwd"], sid),
        )
        if title != cur["title"]:
            self._fts_title(sid, title)
        self._version(sid, version, new_hash, upd, total, change, None, now)
        return change

    def _insert_messages(self, sid: str, start: int, msgs: list[dict[str, Any]]) -> None:
        rows = [(sid, start + i, m["role"], m["kind"], m["text"], m["at"], m.get("toolName", "")) for i, m in enumerate(msgs)]
        self.db.executemany("INSERT OR REPLACE INTO messages (session_id, seq, role, kind, text, at, tool_name) VALUES (?,?,?,?,?,?,?)", rows)
        self.db.executemany("INSERT INTO fts (text, session_id, seq) VALUES (?,?,?)", [(r[4], sid, r[1]) for r in rows if r[4]])

    def _fts_title(self, sid: str, title: str) -> None:
        self.db.execute("DELETE FROM fts WHERE session_id=? AND seq=-1", (sid,))
        self.db.execute("INSERT INTO fts (text, session_id, seq) VALUES (?,?,-1)", (title, sid))

    def _version(self, sid: str, v: int, h: str, upd: str, count: int, change: str, msgs: list | None, now: str) -> None:
        self.db.execute("INSERT OR REPLACE INTO versions (session_id, version, hash, updated_at, message_count, change, messages, saved_at) VALUES (?,?,?,?,?,?,?,?)",
                        (sid, v, h, upd, count, change, json.dumps(msgs) if msgs is not None else None, now))

    def mark_seen(self, sid: str) -> bool:
        with self._lock:
            return self.db.execute("UPDATE sessions SET seen=1 WHERE id=?", (sid,)).rowcount > 0

    def mark_all_seen(self) -> int:
        with self._lock:
            return self.db.execute("UPDATE sessions SET seen=1 WHERE seen=0").rowcount

    def delete(self, sid: str) -> bool:
        with self._lock:
            self.db.execute("BEGIN")
            n = self.db.execute("DELETE FROM sessions WHERE id=?", (sid,)).rowcount
            for t in ("messages", "versions", "fts"):
                self.db.execute(f"DELETE FROM {t} WHERE session_id=?", (sid,))  # noqa: S608 — fixed table names
            self.db.execute("UPDATE cursors SET offset=0, size=-1 WHERE session_id=?", (sid,))
            self.db.execute("COMMIT")
            return n > 0

    # ------------------------------------------------------------------ reads

    def row(self, sid: str) -> dict[str, Any] | None:
        r = self.db.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
        return _row(r) if r else None

    def list(self, *, source: str = "", limit: int = 5000) -> list[dict[str, Any]]:
        q, args = "SELECT * FROM sessions", []
        if source:
            q, args = q + " WHERE source=?", [source]
        q += " ORDER BY updated_at DESC LIMIT ?"
        return [_row(r) for r in self.db.execute(q, (*args, limit)).fetchall()]

    def messages(self, sid: str, start: int = 0, end: int | None = None) -> list[dict[str, Any]]:
        rows = self.db.execute("SELECT * FROM messages WHERE session_id=? AND seq>=? AND seq<? ORDER BY seq", (sid, start, end if end is not None else 1 << 62)).fetchall()
        out = []
        for r in rows:
            m = {"role": r["role"], "text": r["text"], "at": r["at"], "kind": r["kind"]}
            if r["tool_name"]:
                m["toolName"] = r["tool_name"]
            out.append(m)
        return out

    def versions(self, sid: str) -> list[dict[str, Any]]:
        rows = self.db.execute("SELECT version, hash, updated_at, message_count, change, messages IS NOT NULL AS kept, saved_at FROM versions WHERE session_id=? ORDER BY version", (sid,)).fetchall()
        return [{"version": r["version"], "hash": r["hash"], "updatedAt": r["updated_at"], "messageCount": r["message_count"], "change": r["change"], "kept": bool(r["kept"]), "savedAt": r["saved_at"]} for r in rows]

    def version_messages(self, sid: str, version: int) -> list[dict[str, Any]] | None:
        """The messages a version had: its kept copy, else the first messageCount of the next kept copy or the current."""
        rows = self.db.execute("SELECT version, message_count, messages FROM versions WHERE session_id=? AND version>=? ORDER BY version", (sid, version)).fetchall()
        if not rows or rows[0]["version"] != version:
            return None
        count = rows[0]["message_count"]
        for r in rows:
            if r["messages"] is not None:
                return json.loads(r["messages"])[:count]
        return self.messages(sid, 0, count)

    def session(self, sid: str) -> dict[str, Any] | None:
        """The full session@1 document (what export and the hub-drop schema use)."""
        r = self.row(sid)
        if not r:
            return None
        doc = {"$axf": S.TAG, "id": r["id"], "source": r["source"], "title": r["title"], "startedAt": r["startedAt"], "updatedAt": r["updatedAt"],
               "project": r["project"], "messages": self.messages(sid), "hash": r["hash"] or "0" * 64,
               "versions": [{k: v[k] for k in ("version", "hash", "updatedAt", "messageCount", "change")} for v in self.versions(sid)]}
        for k in META_FIELDS:
            if r.get(k):
                doc[k] = r[k]
        if r.get("meta"):
            doc["meta"] = r["meta"]
        return doc

    def search(self, q: str, *, limit: int = 100, source: str = "") -> list[dict[str, Any]]:
        terms = re.findall(r"\w+", q or "", re.UNICODE)[:12]
        if not terms:
            return []
        match = " ".join(f'"{t}"' for t in terms[:-1]) + (" " if len(terms) > 1 else "") + f'"{terms[-1]}"*'
        sql = ("SELECT fts.session_id AS sid, fts.seq AS seq, snippet(fts, 0, char(2), char(3), '…', 14) AS snip, s.title AS title, s.source AS source, s.updated_at AS updated"
               " FROM fts JOIN sessions s ON s.id = fts.session_id WHERE fts MATCH ?")
        args: list[Any] = [match]
        if source:
            sql += " AND s.source=?"
            args.append(source)
        sql += " ORDER BY bm25(fts) LIMIT ?"
        args.append(limit)
        with self._lock:
            try:
                rows = self.db.execute(sql, args).fetchall()
            except sqlite3.OperationalError:
                return []
        return [{"sessionId": r["sid"], "seq": r["seq"], "snippet": r["snip"], "title": r["title"], "source": r["source"], "updatedAt": r["updated"]} for r in rows]

    def counts(self) -> dict[str, Any]:
        by = {r[0]: r[1] for r in self.db.execute("SELECT source, COUNT(*) FROM sessions GROUP BY source")}
        msgs = self.db.execute("SELECT COALESCE(SUM(message_count),0) FROM sessions").fetchone()[0]
        unseen = self.db.execute("SELECT COUNT(*) FROM sessions WHERE seen=0").fetchone()[0]
        return {"sessions": sum(by.values()), "messages": msgs, "unseen": unseen, "bySource": by}

    # ------------------------------------------------------------------ cursors + runs

    def cursor(self, path: str) -> dict[str, Any] | None:
        r = self.db.execute("SELECT * FROM cursors WHERE path=?", (path,)).fetchone()
        return {"size": r["size"], "mtime": r["mtime"], "offset": r["offset"], "sessionId": r["session_id"], "extra": json.loads(r["extra"] or "{}")} if r else None

    def set_cursor(self, path: str, size: int, mtime: float, offset: int, sid: str, extra: dict[str, Any] | None = None) -> None:
        with self._lock:
            self.db.execute("INSERT OR REPLACE INTO cursors (path, size, mtime, offset, session_id, extra) VALUES (?,?,?,?,?,?)", (path, size, mtime, offset, sid, json.dumps(extra or {})))

    def add_run(self, report: dict[str, Any]) -> None:
        with self._lock:
            self.db.execute("INSERT INTO runs (at, report) VALUES (?,?)", (report.get("at") or S.now_iso(), json.dumps(report)))
            self.db.execute("DELETE FROM runs WHERE id NOT IN (SELECT id FROM runs ORDER BY id DESC LIMIT 50)")

    def runs(self, n: int = 10) -> list[dict[str, Any]]:
        return [json.loads(r[0]) for r in self.db.execute("SELECT report FROM runs ORDER BY id DESC LIMIT ?", (n,))]


def _row(r: sqlite3.Row) -> dict[str, Any]:
    return {"id": r["id"], "source": r["source"], "title": r["title"], "startedAt": r["started_at"], "updatedAt": r["updated_at"], "project": r["project"],
            "hash": r["hash"], "messageCount": r["message_count"], "via": r["via"], "origin": r["origin"], "model": r["model"], "branch": r["branch"],
            "cwd": r["cwd"], "host": r["host"], "meta": json.loads(r["meta"] or "{}"), "version": r["version"], "change": r["change"],
            "changedAt": r["changed_at"], "seen": bool(r["seen"]), "ingestedAt": r["ingested_at"]}

