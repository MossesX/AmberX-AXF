"""Conversation RAG, server part. Mounted at /api/plugins/conversation-rag/ (every route is a plugin command too:
REST, MCP, CLI and voice the same, plugin-commands@1 auto).

  GET  status                  what is indexed (sessions, chunks, by source, ledger size, last run, settings)
  POST reindex                 read what is new now ({full: true} = start again from nothing)
  GET  search                  q, limit, source, since, until, build, session → ranked chunks with snippets
  GET  find-session            q → sessions ranked by match ("which session did we talk about X")
  GET  context                 q → a ready-to-paste context pack for an agent (top chunks + matching ledger lines)
  GET  sessions / session/{id} the sessions and one session's chunks
  GET  ledger                  kind, q, hidden → the rules ledger
  POST ledger/add              {text, kind} a rule Brett states directly (pinned)
  POST ledger/{id}             {pinned, hidden, kind, text}
  POST import                  a claude.ai export (conversations.json) as the body
  GET/POST settings            ai, includeHeadless, briefLedger, briefMaxChars, minScore, everyMinutes

The ledger is published after every run to the shared ledger file (conversation-ledger@1) that framework/cli/rules-brief.mjs
reads, so every rules brief (the orchestrator's dispatches, every headless run) carries the standing rules.
"""
from __future__ import annotations

import json
import os
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
DEFAULTS: dict[str, Any] = {"ai": False, "includeHeadless": False, "briefLedger": True, "briefMaxChars": 1800, "minScore": 3.0, "everyMinutes": 10}
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
            _idx = R.Index(data_dir() / "conversations.db")
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
    cur["everyMinutes"] = max(1, min(int(cur["everyMinutes"]), 1440))
    data_dir().mkdir(parents=True, exist_ok=True)
    (data_dir() / "settings.json").write_text(json.dumps(cur, indent=1))
    publish()
    return cur


def brief_entries(idx: R.Index, st: dict[str, Any]) -> list[dict[str, Any]]:
    """What goes into every brief: pinned/manual first, then rules and decisions over the score floor, newest first."""
    rules = idx.ledger(kind="rule", min_score=st["minScore"], limit=60)
    decisions = idx.ledger(kind="decision", min_score=st["minScore"], limit=30)
    newest = sorted(rules + decisions, key=lambda e: str(e["at"] or ""), reverse=True)
    return sorted(newest, key=lambda e: not e["pinned"])  # stable: pinned first, each part newest first


def publish() -> dict[str, Any]:
    """Write the shared ledger file every rules brief reads (conversation-ledger@1)."""
    st = settings()
    idx = index()
    entries = brief_entries(idx, st)
    text = R.brief_text(entries, st["briefMaxChars"]) if st["briefLedger"] else ""
    doc = {"$axf": R.LEDGER_FORMAT, "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "enabled": bool(st["briefLedger"]), "briefText": text,
           "entries": [{k: e[k] for k in ("id", "kind", "text", "at", "session", "source", "builds", "pinned")} for e in entries[:80]]}
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
    if full:
        with idx.lock:
            idx.db.executescript("DELETE FROM chunks; DELETE FROM sessions; DELETE FROM cursors; INSERT INTO fts(fts) VALUES('rebuild');"
                                 "DELETE FROM ledger WHERE manual=0 AND pinned=0 AND hidden=0;")
            idx.db.commit()
    known = S.known_builds(cx.ROOT)
    rep = {"claudeCode": S.sync_claude_code(idx, S.claude_dirs(), known, include_headless=st["includeHeadless"]),
           "claudeAi": S.sync_imports(idx, data_dir() / "imports", known),
           "recordings": S.sync_transcripts(idx, plugin_services.get("axf.session-transcripts@1"), known)}
    rep["published"] = publish()
    _last = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "seconds": round(time.time() - started, 2), **rep}
    return _last


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
    hits = index().search(q, limit=max(1, min(limit, 100)), source=source, since=since, until=until, build=build, session=session)
    return {"ok": True, "q": q, "hits": hits, "count": len(hits)}


@router.get("/find-session")
def find_session(q: str, limit: int = 10, source: str = "", since: str = "", until: str = "") -> dict[str, Any]:
    return {"ok": True, "q": q, "sessions": index().find_session(q, limit=max(1, min(limit, 50)), source=source, since=since, until=until)}


@router.get("/context")
def context(q: str, limit: int = 6, build: str = "") -> dict[str, Any]:
    """A context pack an agent pastes into its prompt: the best chunks and the ledger lines that match. With the `ai`
    setting on and a model service installed, also a short answer drawn only from those chunks."""
    idx = index()
    hits = idx.search(q, limit=max(1, min(limit, 20)), build=build)
    rules = idx.ledger(query=q, min_score=settings()["minScore"], limit=8)
    parts = [f"[{h['at'][:16]} {h['source']} {h['session']}]\n{h['text']}" for h in hits]
    text = "## Past conversation\n" + "\n\n".join(parts) if parts else ""
    if rules:
        text += ("\n\n" if text else "") + "## Standing rules that match\n" + "\n".join(f"- {r['text']} ({r['kind']}, {r['at'][:10]})" for r in rules)
    out: dict[str, Any] = {"ok": True, "q": q, "text": text, "hits": hits, "rules": rules, "answer": None}
    llm = plugin_services.get("axf.llm@1") if settings()["ai"] else None
    if llm is not None and text:
        try:
            r = llm.complete([{"role": "user", "content": f"{text}\n\nQuestion: {q}\nAnswer in two or three plain sentences from the conversation above only."}],
                             system="You answer from Brett's past conversations only. Say when they don't cover it.")
            out["answer"] = str(r.get("text") or "")[:2000]
        except Exception as e:  # noqa: BLE001 — the plain context pack still stands
            out["answerError"] = str(e)[:200]
    return out


@router.get("/sessions")
def sessions(source: str = "", limit: int = 100, offset: int = 0) -> dict[str, Any]:
    return {"ok": True, "sessions": index().sessions(source=source, limit=max(1, min(limit, 500)), offset=max(0, offset))}


@router.get("/session/{sid}")
def session(sid: str) -> dict[str, Any]:
    s = index().session(sid)
    if not s:
        raise HTTPException(404, "no such session")
    return {"ok": True, "session": s}


@router.get("/ledger")
def ledger(kind: str = "", q: str = "", hidden: bool = False, limit: int = 200) -> dict[str, Any]:
    st = settings()
    return {"ok": True, "entries": index().ledger(kind=kind, query=q, include_hidden=hidden, limit=max(1, min(limit, 1000))),
            "briefText": R.brief_text(brief_entries(index(), st), st["briefMaxChars"]) if st["briefLedger"] else ""}


@router.post("/ledger/add")
def ledger_add(body: dict[str, Any]) -> dict[str, Any]:
    try:
        e = index().ledger_add(str(body.get("text") or ""), str(body.get("kind") or "rule"), builds=[str(b) for b in body.get("builds") or []])
    except ValueError as err:
        raise HTTPException(400, str(err)) from err
    publish()
    return {"ok": True, "entry": e}


@router.post("/ledger/{lid}")
def ledger_set(lid: str, body: dict[str, Any]) -> dict[str, Any]:
    try:
        e = index().ledger_set(lid, **{k: body.get(k) for k in ("kind", "text", "pinned", "hidden")})
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
        return index().search(q, limit=limit, **kw)

    def find_session(self, q: str, limit: int = 10) -> list[dict[str, Any]]:
        return index().find_session(q, limit=limit)

    def ledger(self, kind: str = "", q: str = "") -> list[dict[str, Any]]:
        return index().ledger(kind=kind, query=q)

    def context(self, q: str, limit: int = 6) -> dict[str, Any]:
        return context(q, limit)


plugin_services.provide(SERVICE, SearchService(), FOLDER)

if not os.environ.get("AXF_CONVERSATION_RAG_NO_WORKER"):
    threading.Thread(target=_loop, name="conversation-rag", daemon=True).start()
