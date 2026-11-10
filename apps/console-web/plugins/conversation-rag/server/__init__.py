"""Conversation RAG, server part. Mounted at /api/plugins/conversation-rag/ (every route is a plugin command too:
REST, MCP, CLI and voice the same, plugin-commands@1 auto).

  GET  status                  what is indexed (sessions, entries, by source, last run, settings)
  POST reindex                 read what is new now ({full: true} = start again from nothing)
  GET  search                  q, limit, … → matching entries (passages too only with the `passages` setting on)
  GET  find-session            q → sessions ranked by their matching entries ("which session did we talk about X")
  GET  context                 q → the matching `entry: value` lines for an agent (never passages)
  GET  sessions / session/{id} the sessions (title, dates, link) and one session's entries
  GET  ledger                  kind, q, hidden → the two-field entries
  POST ledger/add              {entry, value, kind} (or {text}, distilled by the plain rules); pinned
  POST ledger/{id}             {entry, value, kind, pinned, hidden}
  POST import                  a claude.ai export (conversations.json) as the body
  GET/POST settings            ai, passages, includeHeadless, briefLedger, briefMaxEntries, briefMaxChars, minScore, everyMinutes

Brett (Nov 10 2026): "I don't need the whole entire session quoted and plugged in, that costs me a shitload of money.
Just a brief summary of what you don't do. A two field RAG format, an entry and a value, that's it."
So the store keeps two-field entries (entry = the rule, mistake or decision in a few words; value = one line: what not
to do and what to do instead). Whole-session passages are not stored unless `passages` is on (off by default) and are
never put into a brief or context pack. The entries are published to the shared ledger file (conversation-ledger@1);
framework/cli/rules-brief.mjs puts only the entries that match the task (plus pinned ones) into each brief.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

import console_context as cx
import plugin_services

from . import rag as R
from . import sources as S

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
SERVICE = "axf.conversation-search@1"
DEFAULTS: dict[str, Any] = {"ai": False, "passages": False, "includeHeadless": False, "briefLedger": True, "briefMaxEntries": 12, "briefMaxChars": 1200,
                            "minScore": 3.0, "everyMinutes": 10}
AI_BATCH = 20  # entries the model may tidy per run (one short sentence each), only with the `ai` switch on
_idx: R.Index | None = None
_lock = threading.Lock()
_last: dict[str, Any] = {}
_wake = threading.Event()


def data_dir() -> Path:
    return Path(os.environ.get("AXF_CONVERSATION_RAG_DIR") or (cx.ROOT / ".axf-console" / "plugins" / FOLDER))


def ledger_file() -> Path:
    """Same rule as framework/cli/rules-brief.mjs ledgerFile()."""
    if os.environ.get("AXF_CONVERSATION_LEDGER_FILE"):
        return Path(os.environ["AXF_CONVERSATION_LEDGER_FILE"])
    projects = Path(os.environ.get("AXHUB_PROJECTS_DIR") or "/projects")
    return projects / "_shared" / "_data" / "claude" / "conversation-ledger.json" if projects.exists() else cx.ROOT / ".axf-console" / "conversation-ledger.json"


def index() -> R.Index:
    global _idx
    with _lock:
        if _idx is None:
            _idx = R.Index(data_dir() / "conversations.db", passages=settings()["passages"])
        return _idx


def settings() -> dict[str, Any]:
    try:
        saved = json.loads((data_dir() / "settings.json").read_text())
    except (OSError, ValueError):
        saved = {}
    out = dict(DEFAULTS)
    for k, v in DEFAULTS.items():
        got = saved.get(k) if isinstance(saved, dict) else None
        if isinstance(v, bool):
            if isinstance(got, bool):
                out[k] = got
        elif isinstance(got, (int, float)) and not isinstance(got, bool):
            out[k] = type(v)(got)
    return out


def save_settings(patch: dict[str, Any]) -> dict[str, Any]:
    cur = settings()
    for k, v in (patch or {}).items():
        if k not in DEFAULTS:
            raise HTTPException(400, f"unknown setting {k}")
        want = type(DEFAULTS[k])
        if want is float and isinstance(v, int) and not isinstance(v, bool):
            v = float(v)
        if not isinstance(v, want) or (want is int and isinstance(v, bool)):
            raise HTTPException(400, f"{k} must be {want.__name__}")
        cur[k] = v
    cur["briefMaxChars"] = max(0, min(int(cur["briefMaxChars"]), 6000))
    cur["briefMaxEntries"] = max(0, min(int(cur["briefMaxEntries"]), 60))
    cur["everyMinutes"] = max(1, min(int(cur["everyMinutes"]), 1440))
    data_dir().mkdir(parents=True, exist_ok=True)
    (data_dir() / "settings.json").write_text(json.dumps(cur, indent=1))
    index().passages = bool(cur["passages"])
    if not cur["passages"]:
        index().purge_passages()
    publish()
    return cur


def brief_entries(idx: R.Index, st: dict[str, Any]) -> list[dict[str, Any]]:
    """The entries a brief may pick from: pinned/manual first, then mistakes, rules and decisions over the score floor,
    newest first. Which of them a brief carries is decided per task (matching), in rules-brief.mjs."""
    picked = [e for k, n in (("mistake", 80), ("rule", 120), ("decision", 60)) for e in idx.ledger(kind=k, min_score=st["minScore"], limit=n)]
    newest = sorted(picked, key=lambda e: str(e["at"] or ""), reverse=True)
    return sorted(newest, key=lambda e: not e["pinned"])  # stable: pinned first, each part newest first


def publish() -> dict[str, Any]:
    """Write the shared ledger file every rules brief reads (conversation-ledger@1)."""
    st = settings()
    idx = index()
    entries = brief_entries(idx, st)
    pinned = [e for e in entries if e["pinned"]]
    # briefText: the pinned entries only (what a launch with no task text gets). entries: two fields each (+ pinned).
    text = R.brief_text(pinned[:st["briefMaxEntries"]], st["briefMaxChars"]) if st["briefLedger"] else ""
    doc = {"$axf": R.LEDGER_FORMAT, "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "enabled": bool(st["briefLedger"]), "briefText": text,
           "maxEntries": st["briefMaxEntries"], "maxChars": st["briefMaxChars"],
           "entries": [{"entry": e["entry"], "value": e["value"], **({"pinned": True} if e["pinned"] else {})} for e in entries[:300]]}
    f = ledger_file()
    try:
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_suffix(f".tmp-{os.getpid()}")
        tmp.write_text(json.dumps(doc, indent=1))
        os.replace(tmp, f)
    except OSError as e:
        return {"ok": False, "file": str(f), "error": str(e)}
    return {"ok": True, "file": str(f), "entries": len(doc["entries"]), "chars": len(text)}


def run(full: bool = False) -> dict[str, Any]:
    global _last
    started = time.time()
    idx = index()
    st = settings()
    idx.passages = bool(st["passages"])
    if not idx.passages:
        idx.purge_passages()
    if full:
        with idx.lock:
            idx.db.executescript("DELETE FROM chunks; DELETE FROM sessions; DELETE FROM cursors; INSERT INTO fts(fts) VALUES('rebuild');"
                                 "DELETE FROM ledger WHERE manual=0 AND pinned=0 AND hidden=0;")
            idx.db.commit()
    known = S.known_builds(cx.ROOT)
    rep = {"claudeCode": S.sync_claude_code(idx, S.claude_dirs(), known, include_headless=st["includeHeadless"]),
           "claudeAi": S.sync_imports(idx, data_dir() / "imports", known),
           "recordings": S.sync_transcripts(idx, plugin_services.get("axf.session-transcripts@1"), known)}
    rep["distilled"] = distill(idx, st)
    rep["published"] = publish()
    _last = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "seconds": round(time.time() - started, 2), **rep}
    return _last


def distill(idx: R.Index, st: dict[str, Any]) -> dict[str, Any]:
    """With the `ai` switch on and a model service installed: tidy up to AI_BATCH auto entries into a better
    entry/value pair. The model sees one sentence per entry, never a session. Off = plain rules only, zero tokens."""
    llm = plugin_services.get("axf.llm@1") if st["ai"] else None
    if llm is None:
        return {"ai": False, "entries": 0}
    rows = idx.db.execute("SELECT id, kind, text FROM ledger WHERE manual=0 AND hidden=0 AND edited='' AND kind IN ('mistake','rule','decision') "
                          "AND score >= ? ORDER BY at DESC LIMIT ?", (st["minScore"], AI_BATCH)).fetchall()
    if not rows:
        return {"ai": True, "entries": 0}
    ask = "\n".join(f"{i + 1}. [{r['kind']}] {r['text']}" for i, r in enumerate(rows))
    try:
        r = llm.complete([{"role": "user", "content": ask}], system=(
            "Each numbered line is something Brett said to Claude. Return only a JSON array, one object per line, in order: "
            f'{{"entry": "<the rule, mistake or decision in at most {R.ENTRY_CHARS} chars>", "value": "<one line, at most {R.VALUE_CHARS} chars: what Claude must not do and what to do instead>"}}.'))
        got = json.loads(re.search(r"\[.*\]", str(r.get("text") or ""), re.S).group(0))  # type: ignore[union-attr]
    except Exception as e:  # noqa: BLE001 — the plain-rules entries stand
        return {"ai": True, "entries": 0, "error": str(e)[:200]}
    n = 0
    stamp = "ai:" + time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with idx.lock:
        for row, g in zip(rows, got if isinstance(got, list) else []):
            e, v = str((g or {}).get("entry") or "").strip(), str((g or {}).get("value") or "").strip()
            if len(e) >= 2 and len(v) >= 4:
                idx.db.execute("UPDATE ledger SET entry=?, value=?, edited=? WHERE id=?", (R._cut(R.redact(e), R.ENTRY_CHARS), R._cut(R.redact(v), R.VALUE_CHARS), stamp, row["id"]))
                n += 1
        idx.db.commit()
    return {"ai": True, "entries": n}


def _loop() -> None:
    time.sleep(20)
    while True:
        try:
            run()
        except Exception as e:  # noqa: BLE001 — keep the loop alive; the error shows in status
            global _last
            _last = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "error": str(e)[:300]}
        more = bool((_last.get("claudeCode") or {}).get("more"))
        _wake.wait(15.0 if more else settings()["everyMinutes"] * 60.0)  # catching up: next slice soon
        _wake.clear()


# --------------------------------------------------------------------------------------------- routes
@router.get("/status")
def status() -> dict[str, Any]:
    return {"ok": True, **index().stats(), "lastRun": _last, "settings": settings(), "ledgerFile": str(ledger_file()), "transcripts": plugin_services.get("axf.session-transcripts@1") is not None}


@router.post("/reindex")
def reindex(body: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"ok": True, **run(full=bool((body or {}).get("full")))}


@router.get("/search")
def search(q: str, limit: int = 20, source: str = "", since: str = "", until: str = "", build: str = "", session: str = "") -> dict[str, Any]:
    idx = index()
    entries = [e for e in idx.ledger(query=q, limit=max(1, min(limit, 100))) if _keep(e, source, since, until, build, session)]
    hits = idx.search(q, limit=max(1, min(limit, 100)), source=source, since=since, until=until, build=build, session=session) if idx.passages else []
    return {"ok": True, "q": q, "entries": entries, "hits": hits, "count": len(entries) + len(hits), "passages": idx.passages}


def _keep(e: dict[str, Any], source: str = "", since: str = "", until: str = "", build: str = "", session: str = "") -> bool:
    at = str(e.get("at") or "")[:10]
    return ((not source or e.get("source") == source) and (not since or at >= since[:10]) and (not until or at <= until[:10])
            and (not build or build in (e.get("builds") or [])) and (not session or e.get("session") == session))


@router.get("/find-session")
def find_session(q: str, limit: int = 10, source: str = "", since: str = "", until: str = "") -> dict[str, Any]:
    idx = index()
    if idx.passages:
        return {"ok": True, "q": q, "sessions": idx.find_session(q, limit=max(1, min(limit, 50)), source=source, since=since, until=until)}
    best: dict[str, dict[str, Any]] = {}
    for e in idx.ledger(query=q, limit=500):
        if e.get("session") and _keep(e, source, since, until):
            b = best.setdefault(e["session"], {"session": e["session"], "score": 0.0, "hits": 0, "top": e})
            b["score"] += e["match"]; b["hits"] += 1
    out = sorted(best.values(), key=lambda b: -b["score"])[:max(1, min(limit, 50))]
    for b in out:
        s = idx.db.execute("SELECT title, source, first_at, last_at, link FROM sessions WHERE id=?", (b["session"],)).fetchone()
        b.update(dict(s) if s else {})
    return {"ok": True, "q": q, "sessions": out}


@router.get("/context")
def context(q: str, limit: int = 8, build: str = "") -> dict[str, Any]:
    """What an agent pastes into its prompt: only the `entry: value` lines that match q (never passages). With the `ai`
    setting on and a model service installed, also a short answer drawn only from those lines."""
    st = settings()
    entries = [e for e in index().ledger(query=q, min_score=st["minScore"], limit=max(1, min(limit, 30))) if _keep(e, build=build)]
    text = R.brief_text(entries, st["briefMaxChars"] or 1200)
    out: dict[str, Any] = {"ok": True, "q": q, "text": text, "entries": [{"entry": e["entry"], "value": e["value"]} for e in entries], "answer": None}
    llm = plugin_services.get("axf.llm@1") if st["ai"] else None
    if llm is not None and text:
        try:
            r = llm.complete([{"role": "user", "content": f"{text}\n\nQuestion: {q}\nAnswer in one or two plain sentences from the lines above only."}],
                             system="You answer from Brett's standing notes only. Say when they don't cover it.")
            out["answer"] = str(r.get("text") or "")[:600]
        except Exception as e:  # noqa: BLE001 — the plain lines still stand
            out["answerError"] = str(e)[:200]
    return out


@router.get("/sessions")
def sessions(source: str = "", limit: int = 100, offset: int = 0) -> dict[str, Any]:
    return {"ok": True, "sessions": index().sessions(source=source, limit=max(1, min(limit, 500)), offset=max(0, offset))}


@router.get("/session/{sid}")
def session(sid: str) -> dict[str, Any]:
    idx = index()
    s = idx.session(sid)
    if not s:
        raise HTTPException(404, "no such session")
    entries = [e for e in idx.ledger(limit=1000) if e.get("session") == sid]
    return {"ok": True, "session": {**s, "entries": [{"id": e["id"], "kind": e["kind"], "entry": e["entry"], "value": e["value"], "at": e["at"]} for e in entries]}}


@router.get("/ledger")
def ledger(kind: str = "", q: str = "", hidden: bool = False, limit: int = 200) -> dict[str, Any]:
    st = settings()
    return {"ok": True, "entries": index().ledger(kind=kind, query=q, include_hidden=hidden, limit=max(1, min(limit, 1000))),
            "briefText": R.brief_text([e for e in brief_entries(index(), st) if e["pinned"]][:st["briefMaxEntries"]], st["briefMaxChars"]) if st["briefLedger"] else ""}


@router.post("/ledger/add")
def ledger_add(body: dict[str, Any]) -> dict[str, Any]:
    try:
        e = index().ledger_add(entry=str(body.get("entry") or ""), value=str(body.get("value") or ""), kind=str(body.get("kind") or "rule"),
                               builds=[str(b) for b in body.get("builds") or []], text=str(body.get("text") or ""))
    except ValueError as err:
        raise HTTPException(400, str(err)) from err
    publish()
    return {"ok": True, "entry": e}


@router.post("/ledger/{lid}")
def ledger_set(lid: str, body: dict[str, Any]) -> dict[str, Any]:
    try:
        e = index().ledger_set(lid, **{k: body.get(k) for k in ("kind", "entry", "value", "pinned", "hidden")})
    except ValueError as err:
        raise HTTPException(400, str(err)) from err
    if e is None:
        raise HTTPException(404, "no such ledger entry")
    publish()
    return {"ok": True, "entry": e}


@router.post("/import")
def import_export(body: Any) -> dict[str, Any]:
    rep = S.import_claude_ai(index(), body, S.known_builds(cx.ROOT))
    if not rep["conversations"]:
        raise HTTPException(400, "send a claude.ai export (conversations.json) as the body")
    publish()
    return {"ok": True, **rep}


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return {"ok": True, "settings": settings()}


@router.post("/settings")
def post_settings(body: dict[str, Any]) -> dict[str, Any]:
    out = save_settings(body)
    _wake.set()
    return {"ok": True, "settings": out}


class SearchService:
    """axf.conversation-search@1: Search everything and other plugins ask here, never by folder name."""
    version = 1

    def search(self, q: str, limit: int = 20, **kw: Any) -> list[dict[str, Any]]:
        r = search(q, limit=limit, **kw)
        return r["entries"] + r["hits"]

    def find_session(self, q: str, limit: int = 10) -> list[dict[str, Any]]:
        return find_session(q, limit=limit)["sessions"]

    def ledger(self, kind: str = "", q: str = "") -> list[dict[str, Any]]:
        return index().ledger(kind=kind, query=q)

    def context(self, q: str, limit: int = 6) -> dict[str, Any]:
        return context(q, limit)


plugin_services.provide(SERVICE, SearchService(), FOLDER)

if not os.environ.get("AXF_CONVERSATION_RAG_NO_WORKER"):
    threading.Thread(target=_loop, name="conversation-rag", daemon=True).start()
