"""Conversation RAG engine: chunks, local embeddings, the SQLite index, search and the rules ledger. Pure stdlib.

Brett (Nov 10 2026): "You better make some type of RAG database for this conversation."

Every conversation with Brett (session recordings transcribed on the VPS, Claude Code chats, claude.ai exports) is cut
into chunks of a few turns, tagged (date, topics, build ids) and stored in one SQLite file in the plugin's data folder:

    chunks    one row per chunk: source, session, time, speakers, text, tags, a 256-dim local embedding
    fts       FTS5 (porter) over the chunk text: the candidates and their BM25 score
    sessions  one row per session: source, title, first/last time, chunk count
    cursors   incremental ingest state per source item (size/mtime/offset), so a re-run reads only what is new
    ledger    standing rules, decisions and requests pulled out of Brett's own words (pin / hide / edit by API)

Embeddings are local and free: signed feature hashing of word stems, word pairs and character trigrams into 256 floats
(L2-normalised). Search = FTS5 candidates reranked by cosine + BM25 + a small recency term; a query with no FTS hit
falls back to a prefix search, so typos and half words still find something. No model, no key, no tokens.
"""
from __future__ import annotations

import array
import hashlib
import json
import math
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Iterable

DIM = 256
CHUNK_CHARS = 900
LEDGER_FORMAT = "conversation-ledger@1"
WORD = re.compile(r"[a-z0-9][a-z0-9'_-]*")
STOP = frozenset("""a an and are as at be been but by can could did do does doing don't for from had has have he her his how i i'm
if in into is it it's its just let's like me my no not now of on or our out so some than that that's the their them then there these
they this to too up us was we were what when where which who why will with would you your yeah ok okay um uh right well
gonna want get got make go one all any also""".split())
SECRET = re.compile(r"(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?i:(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*)\S{6,})")

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, source TEXT, title TEXT, first_at TEXT, last_at TEXT, chunks INTEGER DEFAULT 0, link TEXT DEFAULT '', meta TEXT DEFAULT '{}');
CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, session TEXT, source TEXT, seq INTEGER, at TEXT, day TEXT, speakers TEXT, text TEXT,
  topics TEXT, builds TEXT, offset_s REAL DEFAULT -1, offsets TEXT DEFAULT '', vec BLOB, UNIQUE(session, seq));
CREATE INDEX IF NOT EXISTS chunks_day ON chunks(day);
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(text, content='chunks', content_rowid='id', tokenize='porter unicode61');
CREATE TABLE IF NOT EXISTS cursors (key TEXT PRIMARY KEY, size INTEGER, mtime REAL, pos INTEGER, extra TEXT DEFAULT '{}');
CREATE TABLE IF NOT EXISTS ledger (id TEXT PRIMARY KEY, kind TEXT, text TEXT, quote TEXT, at TEXT, session TEXT, source TEXT, builds TEXT,
  score REAL, pinned INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0, manual INTEGER DEFAULT 0, edited TEXT DEFAULT '');
"""


def redact(text: str) -> str:
    return SECRET.sub("[redacted]", text or "")


def words(text: str) -> list[str]:
    return WORD.findall((text or "").lower())


def stem(w: str) -> str:
    for suf in ("ings", "ing", "edly", "ed", "ies", "es", "s", "ly"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)] + ("y" if suf == "ies" else "")
    return w


def _h(s: str) -> tuple[int, float]:
    d = hashlib.blake2b(s.encode(), digest_size=8).digest()
    n = int.from_bytes(d, "little")
    return n % DIM, 1.0 if (n >> 40) & 1 else -1.0


def embed(text: str) -> list[float]:
    """Local embedding: hashed stems (weight 1), word pairs (0.7), char trigrams of each stem (0.3). L2-normalised."""
    v = [0.0] * DIM
    ws = [stem(w) for w in words(text) if w not in STOP]
    for i, w in enumerate(ws):
        k, s = _h("w:" + w); v[k] += s
        if i:
            k, s = _h("p:" + ws[i - 1] + " " + w); v[k] += 0.7 * s
        g = f"#{w}#"
        for j in range(len(g) - 2):
            k, s = _h("c:" + g[j:j + 3]); v[k] += 0.3 * s
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def pack(v: list[float]) -> bytes:
    return array.array("f", v).tobytes()


def unpack(b: bytes) -> array.array:
    a = array.array("f"); a.frombytes(b or b""); return a


def cosine(a: Iterable[float], b: Iterable[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def topics(text: str, n: int = 6) -> list[str]:
    counts: dict[str, int] = {}
    for w in words(text):
        if w in STOP or len(w) < 4 or w.isdigit():
            continue
        counts[w] = counts.get(w, 0) + 1
    return [w for w, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:n]]


def find_builds(text: str, known: Iterable[str]) -> list[str]:
    t = (text or "").lower()
    return sorted({b for b in known if len(b) >= 8 and b in t})[:8]


# ------------------------------------------------------------------------------------------------- chunking
def chunk_turns(turns: list[dict[str, Any]], size: int = CHUNK_CHARS) -> list[dict[str, Any]]:
    """Turns ({role, text, at, offset?}) → chunks of whole turns up to ~size chars; a long turn is split on sentences.
    The last turn of a chunk opens the next one (one-turn overlap) unless it is itself long."""
    pieces: list[dict[str, Any]] = []
    for t in turns:
        text = redact(str(t.get("text") or "")).strip()
        if not text:
            continue
        if len(text) <= size:
            pieces.append({**t, "text": text}); continue
        buf = ""
        for s in re.split(r"(?<=[.!?\n])\s+", text):
            if buf and len(buf) + len(s) > size:
                pieces.append({**t, "text": buf.strip()}); buf = ""
            buf += s + " "
            while len(buf) > size * 1.5:
                pieces.append({**t, "text": buf[:size].strip()}); buf = buf[size:]
        if buf.strip():
            pieces.append({**t, "text": buf.strip()})
    out: list[dict[str, Any]] = []
    cur: list[dict[str, Any]] = []
    for p in pieces:
        if cur and sum(len(x["text"]) for x in cur) + len(p["text"]) > size:
            out.append(_chunk(cur))
            cur = [cur[-1]] if len(cur[-1]["text"]) < size // 3 else []
        cur.append(p)
    if cur:
        out.append(_chunk(cur))
    return out


def _chunk(turns: list[dict[str, Any]]) -> dict[str, Any]:
    text = "\n".join(f"{t.get('role') or 'speaker'}: {t['text'].replace(chr(10), ' ') if t.get('offset') is not None else t['text']}" for t in turns)
    offs = [float(t["offset"]) if t.get("offset") is not None else -1.0 for t in turns]
    return {"text": text, "at": str(turns[0].get("at") or ""), "speakers": sorted({str(t.get("role") or "speaker") for t in turns}), "offset": offs[0] if offs else -1.0,
            "offsets": offs if any(o >= 0 for o in offs) else []}


# ------------------------------------------------------------------------------------------------- the rules ledger
RULE_PATTERNS = [
    ("rule", 3.0, re.compile(r"\b(always|never|from now on|going forward|no more|stop (?:doing|using)|don't ever|do not ever)\b", re.I)),
    ("rule", 2.0, re.compile(r"\b(must|has to|have to|needs? to|should always|make sure|rule|every time|each time)\b", re.I)),
    ("decision", 2.5, re.compile(r"\b(we(?:'ll| will) go with|let's go with|decided|decision|i choose|use (?:the )?\w+ instead|switch(?:ed)? to|set it to)\b", re.I)),
    ("request", 1.5, re.compile(r"\b(i want|i need|build|add|make (?:a|an|some|it)|can you|please|you better)\b", re.I)),
]
NOISE = re.compile(r"^(?:ok|okay|yes|no|thanks|thank you|cool|great|yep|sure)\b[.!]?$", re.I)


def sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text or "") if 12 <= len(s.strip()) <= 400]


def extract(text: str) -> list[dict[str, Any]]:
    """Brett's words → candidate ledger entries {kind, text, score}. One per sentence, the strongest pattern wins."""
    out = []
    for s in sentences(redact(text)):
        if NOISE.match(s) or s.endswith("?") and not re.search(r"\b(can you|could you)\b", s, re.I):
            continue
        best = None
        for kind, w, rx in RULE_PATTERNS:
            if rx.search(s) and (best is None or w > best[1]):
                best = (kind, w)
        if best:
            score = best[1] + min(len(s), 200) / 400.0
            out.append({"kind": best[0], "text": s, "score": round(score, 2)})
    return out


def ledger_id(text: str) -> str:
    return hashlib.sha1(" ".join(words(text)).encode()).hexdigest()[:12]


# ------------------------------------------------------------------------------------------------- the store
class Index:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(str(self.path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(SCHEMA)

    def close(self) -> None:
        self.db.close()

    # cursors
    def cursor(self, key: str) -> dict[str, Any] | None:
        r = self.db.execute("SELECT * FROM cursors WHERE key=?", (key,)).fetchone()
        return {**dict(r), "extra": json.loads(r["extra"] or "{}")} if r else None

    def set_cursor(self, key: str, size: int, mtime: float, pos: int, extra: dict[str, Any] | None = None) -> None:
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO cursors VALUES (?,?,?,?,?)", (key, size, mtime, pos, json.dumps(extra or {})))
            self.db.commit()

    # writing
    def drop_session(self, sid: str) -> None:
        with self.lock:
            for r in self.db.execute("SELECT id, text FROM chunks WHERE session=?", (sid,)).fetchall():
                self.db.execute("INSERT INTO fts(fts, rowid, text) VALUES('delete', ?, ?)", (r["id"], r["text"]))
            self.db.execute("DELETE FROM chunks WHERE session=?", (sid,))
            self.db.execute("DELETE FROM sessions WHERE id=?", (sid,))
            self.db.commit()

    def add(self, session: dict[str, Any], turns: list[dict[str, Any]], known_builds: Iterable[str] = (), brett_roles: tuple[str, ...] = ("brett",)) -> int:
        """Append turns to a session (new chunks get the next seq numbers). Brett's turns feed the ledger. → chunks added."""
        sid = str(session["id"])
        known = list(known_builds)
        chunks = chunk_turns(turns)
        with self.lock:
            row = self.db.execute("SELECT chunks, first_at FROM sessions WHERE id=?", (sid,)).fetchone()
            seq = int(row["chunks"]) if row else 0
            first = (row["first_at"] if row else "") or ""
            last = ""
            for c in chunks:
                at = c["at"] or session.get("at") or ""
                cur = self.db.execute("INSERT OR REPLACE INTO chunks (session, source, seq, at, day, speakers, text, topics, builds, offset_s, offsets, vec) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                                      (sid, session.get("source", ""), seq, at, at[:10], ",".join(c["speakers"]), c["text"], ",".join(topics(c["text"])),
                                       ",".join(find_builds(c["text"], known)), c["offset"], ",".join(f"{o:g}" for o in c["offsets"]), pack(embed(c["text"]))))
                self.db.execute("INSERT INTO fts(rowid, text) VALUES (?, ?)", (cur.lastrowid, c["text"]))
                seq += 1
                first = min(first, at) if first and at else (first or at)
                last = max(last, at)
            meta = json.dumps(session.get("meta") or {})
            self.db.execute("INSERT INTO sessions (id, source, title, first_at, last_at, chunks, link, meta) VALUES (?,?,?,?,?,?,?,?) "
                            "ON CONFLICT(id) DO UPDATE SET title=excluded.title, first_at=excluded.first_at, last_at=MAX(sessions.last_at, excluded.last_at), chunks=excluded.chunks, link=excluded.link, meta=excluded.meta",
                            (sid, session.get("source", ""), str(session.get("title") or sid)[:200], first, last or first, seq, session.get("link", ""), meta))
            for t in turns:
                if str(t.get("role") or "").lower() in brett_roles or t.get("brett"):
                    self._ledger_from(t, session, known)
            self.db.commit()
        return len(chunks)

    def _ledger_from(self, turn: dict[str, Any], session: dict[str, Any], known: list[str]) -> None:
        for e in extract(str(turn.get("text") or "")):
            lid = ledger_id(e["text"])
            builds = ",".join(find_builds(str(turn.get("text") or ""), known))
            self.db.execute("INSERT INTO ledger (id, kind, text, quote, at, session, source, builds, score) VALUES (?,?,?,?,?,?,?,?,?) "
                            "ON CONFLICT(id) DO UPDATE SET at=MAX(ledger.at, excluded.at), score=MAX(ledger.score, excluded.score)",
                            (lid, e["kind"], e["text"], e["text"], str(turn.get("at") or session.get("at") or ""), str(session["id"]), session.get("source", ""), builds, e["score"]))

    # reading
    def stats(self) -> dict[str, Any]:
        q = lambda sql: self.db.execute(sql).fetchone()[0]  # noqa: E731
        by = {r[0]: r[1] for r in self.db.execute("SELECT source, COUNT(*) FROM sessions GROUP BY source")}
        return {"sessions": q("SELECT COUNT(*) FROM sessions"), "chunks": q("SELECT COUNT(*) FROM chunks"), "bySource": by,
                "ledger": q("SELECT COUNT(*) FROM ledger WHERE hidden=0"), "newest": q("SELECT MAX(last_at) FROM sessions") or "", "bytes": self.path.stat().st_size if self.path.exists() else 0}

    def sessions(self, source: str = "", limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        sql = "SELECT * FROM sessions" + (" WHERE source=?" if source else "") + " ORDER BY last_at DESC LIMIT ? OFFSET ?"
        args = ((source,) if source else ()) + (limit, offset)
        return [{**dict(r), "meta": json.loads(r["meta"] or "{}")} for r in self.db.execute(sql, args)]

    def session(self, sid: str) -> dict[str, Any] | None:
        r = self.db.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
        if not r:
            return None
        chunks = [self._chunk_out(c) for c in self.db.execute("SELECT * FROM chunks WHERE session=? ORDER BY seq", (sid,))]
        return {**dict(r), "meta": json.loads(r["meta"] or "{}"), "chunkList": chunks}

    @staticmethod
    def _chunk_out(c: sqlite3.Row) -> dict[str, Any]:
        return {"id": c["id"], "session": c["session"], "source": c["source"], "seq": c["seq"], "at": c["at"], "speakers": [s for s in (c["speakers"] or "").split(",") if s],
                "text": c["text"], "topics": [s for s in (c["topics"] or "").split(",") if s], "builds": [s for s in (c["builds"] or "").split(",") if s], "offset": c["offset_s"]}

    def search(self, query: str, *, limit: int = 20, source: str = "", since: str = "", until: str = "", build: str = "", session: str = "") -> list[dict[str, Any]]:
        terms = [w for w in words(query) if w not in STOP] or words(query)
        if not terms:
            return []
        filt, args = [], []
        for col, val, op in (("c.source", source, "="), ("c.day", since[:10], ">="), ("c.day", until[:10], "<="), ("c.session", session, "=")):
            if val:
                filt.append(f"{col} {op} ?"); args.append(val)
        if build:
            filt.append("(',' || c.builds || ',') LIKE ?"); args.append(f"%,{build},%")
        where = (" AND " + " AND ".join(filt)) if filt else ""
        rows: list[sqlite3.Row] = []
        for match in (" OR ".join(f'"{t}"' for t in terms), " OR ".join(f'"{t[:max(3, len(t) - 2)]}"*' for t in terms)):
            try:
                rows = self.db.execute(f"SELECT c.*, bm25(fts) AS rank FROM fts JOIN chunks c ON c.id = fts.rowid WHERE fts MATCH ?{where} ORDER BY rank LIMIT 300", (match, *args)).fetchall()
            except sqlite3.OperationalError:
                rows = []
            if rows:
                break
        if not rows:
            return []
        qv = embed(query)
        ranks = [-float(r["rank"]) for r in rows]
        top = max(ranks) or 1.0
        newest = max((r["at"] or "") for r in rows)
        phrase = " ".join(words(query))
        scored = []
        for r, bm in zip(rows, ranks):
            cos = cosine(qv, unpack(r["vec"]))
            rec = 0.05 if (r["at"] or "")[:7] == newest[:7] else 0.0
            exact = 0.15 if phrase and phrase in " ".join(words(r["text"])) else 0.0
            scored.append((0.55 * max(cos, 0.0) + 0.45 * (bm / top) + rec + exact, r))
        scored.sort(key=lambda x: -x[0])
        out = []
        for s, r in scored[:limit]:
            c = self._chunk_out(r)
            c["score"] = round(s, 4)
            c["snippet"] = snippet(r["text"], terms)
            c["offset"] = line_offset(r["text"], r["offsets"] or "", terms, c["offset"])
            out.append(c)
        return out

    def find_session(self, query: str, limit: int = 10, **kw: Any) -> list[dict[str, Any]]:
        """Sessions ranked by their summed hit scores ("which session did we talk about X")."""
        best: dict[str, dict[str, Any]] = {}
        for h in self.search(query, limit=200, **kw):
            b = best.setdefault(h["session"], {"session": h["session"], "score": 0.0, "hits": 0, "top": h})
            b["score"] += h["score"]; b["hits"] += 1
        out = sorted(best.values(), key=lambda b: -b["score"])[:limit]
        for b in out:
            s = self.db.execute("SELECT title, source, first_at, last_at, link FROM sessions WHERE id=?", (b["session"],)).fetchone()
            b.update(dict(s) if s else {}); b["score"] = round(b["score"], 4)
        return out

    # the ledger
    def ledger(self, *, kind: str = "", include_hidden: bool = False, query: str = "", limit: int = 200, min_score: float = 0.0) -> list[dict[str, Any]]:
        filt, args = [], []
        if kind:
            filt.append("kind = ?"); args.append(kind)
        if not include_hidden:
            filt.append("hidden = 0")
        if min_score:
            filt.append("(score >= ? OR pinned = 1 OR manual = 1)"); args.append(min_score)
        sql = "SELECT * FROM ledger" + (" WHERE " + " AND ".join(filt) if filt else "") + " ORDER BY pinned DESC, at DESC LIMIT ?"
        rows = [dict(r) for r in self.db.execute(sql, (*args, limit * (5 if query else 1)))]
        if query:
            qv = embed(query)
            rows = sorted(rows, key=lambda r: -cosine(qv, embed(r["text"])))[:limit]
        for r in rows:
            r["builds"] = [b for b in (r["builds"] or "").split(",") if b]; r["pinned"] = bool(r["pinned"]); r["hidden"] = bool(r["hidden"]); r["manual"] = bool(r["manual"])
        return rows

    def ledger_set(self, lid: str, **patch: Any) -> dict[str, Any] | None:
        with self.lock:
            r = self.db.execute("SELECT * FROM ledger WHERE id=?", (lid,)).fetchone()
            if not r:
                return None
            sets, args = [], []
            for k in ("kind", "text", "pinned", "hidden"):
                if k in patch and patch[k] is not None:
                    v = patch[k]
                    if k == "kind" and v not in ("rule", "decision", "request"):
                        raise ValueError("kind is rule, decision or request")
                    sets.append(f"{k}=?"); args.append(int(bool(v)) if k in ("pinned", "hidden") else str(v)[:400])
            if sets:
                sets.append("edited=?"); args.append(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
                self.db.execute(f"UPDATE ledger SET {', '.join(sets)} WHERE id=?", (*args, lid)); self.db.commit()
        return self.ledger_get(lid)

    def ledger_get(self, lid: str) -> dict[str, Any] | None:
        r = self.db.execute("SELECT * FROM ledger WHERE id=?", (lid,)).fetchone()
        if not r:
            return None
        d = dict(r)
        d["builds"] = [b for b in (d["builds"] or "").split(",") if b]
        for k in ("pinned", "hidden", "manual"):
            d[k] = bool(d[k])
        return d

    def ledger_add(self, text: str, kind: str = "rule", at: str = "", builds: Iterable[str] = ()) -> dict[str, Any]:
        if kind not in ("rule", "decision", "request"):
            raise ValueError("kind is rule, decision or request")
        text = redact(text).strip()[:400]
        if len(text) < 4:
            raise ValueError("say the rule in a few words")
        lid = ledger_id(text)
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO ledger (id, kind, text, quote, at, session, source, builds, score, pinned, hidden, manual) VALUES (?,?,?,?,?,?,?,?,?,1,0,1)",
                            (lid, kind, text, text, at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "", "manual", ",".join(builds), 9.0))
            self.db.commit()
        return self.ledger_get(lid) or {}


def snippet(text: str, terms: list[str], width: int = 240) -> str:
    low = text.lower()
    pos = min((p for p in (low.find(t) for t in terms) if p >= 0), default=0)
    start = max(0, pos - width // 3)
    s = text[start:start + width]
    return ("…" if start else "") + s.replace("\n", " ") + ("…" if start + width < len(text) else "")


def line_offset(text: str, offsets: str, terms: list[str], default: float) -> float:
    """The offset (seconds into the recording) of the first line of a chunk that holds a query term."""
    offs = [float(x) for x in offsets.split(",") if x]
    if not offs:
        return default
    for i, line in enumerate(text.lower().split("\n")[:len(offs)]):
        if any(t in line for t in terms) and offs[i] >= 0:
            return offs[i]
    return default


def brief_text(entries: list[dict[str, Any]], max_chars: int = 1800) -> str:
    """The ledger block every rules brief carries: pinned first, then the newest rules and decisions, one line each."""
    lines, used = [], 0
    for e in entries:
        line = f"- {e['text'].rstrip('.')} ({e['kind']}, {str(e.get('at') or '')[:10] or 'undated'})"
        if used + len(line) + 1 > max_chars:
            break
        lines.append(line); used += len(line) + 1
    if not lines:
        return ""
    return "### From Brett's conversations (rules ledger)\n" + "\n".join(lines)
