"""Chat viewer — server part. Mounted at /api/plugins/chat-viewer/ (console token, 404 while disabled); AmberX reaches it
through its console forwarder (/api/console/plugins/chat-viewer/, hub admins).

Every session we have (claude.ai text + voice chats, Claude Code sessions, headless build sessions) as session@1 in one
SQLite store (store.py says why SQLite) in the plugin's data folder; audio exports on the hub.

    GET    /status                       counts, last check, sources (found or not), TTS state
    POST   /sync                         check for updates now: new / continued / changed / unchanged per source
    GET    /sessions[?source=]           the list (no messages)
    GET    /sessions/{id}                one session with messages + versions
    POST   /sessions/{id}/seen           clears its new / updated badge   (POST /seen-all: every badge)
    DELETE /sessions/{id}                forget it (the next sync brings a live source back)
    GET    /sessions/{id}/versions/{v}   the messages that version had
    GET    /sessions/{id}/export?format=md|txt|json
    GET    /search?q=&source=            full-text hits (snippets marked \x02 … \x03), jump to seq
    POST   /import?name=                 body = the claude.ai data export zip or conversations.json (raw bytes)
    GET    /settings · PUT /settings     sources, timer, audio defaults
    GET    /tts                          engines, Piper voices (catalog + installed), which keys are set, jobs
    POST   /tts/setup  {voices}          install Piper + voices in the background
    PUT    /tts/keys/{provider} {key} · DELETE /tts/keys/{provider}
    POST   /audio {sessionId, from?, to?, engine?, voices?, pauseMs?, format?}   → job
    GET    /jobs/{id} · GET /audio[?sessionId=] · GET /audio/file/{name} · DELETE /audio/file/{name}

Sources: never claude.ai with Brett's login — its chats come from his data export upload or from the hub drop folder
(<hub data>/sessions/claude-ai/<uuid>.json, written by claude.ai sessions through axhub.memory_write when he says
"sync my chats"). A timer re-checks every `intervalMin` minutes (AXF_CHAT_VIEWER_TIMER=off stops it).
"""
from __future__ import annotations

import json
import os
import threading
import time
import zipfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import FileResponse, Response

import console_context as cx

from . import audio as A
from . import ingest
from . import schema as S
from .store import Store

router = APIRouter()
FOLDER = "chat-viewer"
MAX_UPLOAD = 1024 * 1024 * 1024  # 1 GB export zip

DEFAULTS: dict[str, Any] = {
    "intervalMin": 10,
    "claudeDirs": [
        {"path": "/root/.claude/projects", "label": "root"},
        {"path": "/home/axfbuild/.claude/projects", "label": "axfbuild"},
        {"path": "/hostfs/claude/root", "label": "root"},
        {"path": "/hostfs/claude/axfbuild", "label": "axfbuild"},
    ],
    "logGlobs": ["/root/axf-builds/*/*.log", "/home/axfbuild/wt-*/*.log", "/hostfs/axf-builds/*/*.log", "/hostfs/axfbuild-wt/*/*.log"],
    "hubDrop": "",  # '' = <hub data>/sessions/claude-ai
    "audio": {"engine": "piper", "pauseMs": 450, "format": "mp3",
              "voices": {"piper": {"user": "en_US-ryan-medium", "assistant": "en_US-amy-medium"},
                         "openai": {"user": "onyx", "assistant": "nova"},
                         "elevenlabs": {"user": "", "assistant": ""}}},
}


def data_dir() -> Path:
    return Path(os.environ.get("AXF_CHAT_VIEWER_DIR") or (cx.ROOT / ".axf-console" / "plugins" / FOLDER))


def hub_data() -> Path | None:
    """This project's shared data on the hub (/projects/amberx-axf/_data), or None when it isn't mounted here."""
    exact = os.environ.get("AXF_CHAT_VIEWER_HUB") or os.environ.get("AXF_DATA_DIR")
    if exact is not None:
        return Path(exact) if exact and exact != "off" else None
    p = Path(os.environ.get("AXHUB_PROJECTS_DIR") or "/projects") / "amberx-axf" / "_data"
    return p if p.is_dir() else None


def hub_drop_dir(cfg: dict[str, Any]) -> Path | None:
    if cfg.get("hubDrop"):
        return Path(cfg["hubDrop"])
    h = hub_data()
    return h / "sessions" / "claude-ai" if h else None


def audio_dir() -> Path:
    h = hub_data()
    return (h / "chat-viewer" / "audio") if h else (data_dir() / "audio")


def _merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in (over or {}).items():
        out[k] = _merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return out


def settings() -> dict[str, Any]:
    try:
        saved = json.loads((data_dir() / "settings.json").read_text())
    except (OSError, ValueError):
        saved = {}
    return _merge(DEFAULTS, saved if isinstance(saved, dict) else {})


def _clean_settings(body: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if "intervalMin" in body:
        out["intervalMin"] = max(0, min(1440, int(body["intervalMin"] or 0)))
    if isinstance(body.get("claudeDirs"), list):
        out["claudeDirs"] = [{"path": str(d.get("path"))[:400], "label": str(d.get("label") or "")[:40]} for d in body["claudeDirs"][:20] if isinstance(d, dict) and str(d.get("path") or "").startswith("/")]
    if isinstance(body.get("logGlobs"), list):
        out["logGlobs"] = [str(g)[:400] for g in body["logGlobs"][:20] if str(g).startswith("/")]
    if "hubDrop" in body:
        out["hubDrop"] = str(body["hubDrop"] or "")[:400] if not body["hubDrop"] or str(body["hubDrop"]).startswith("/") else ""
    if isinstance(body.get("audio"), dict):
        a = body["audio"]
        aud: dict[str, Any] = {}
        if a.get("engine") in A.ENGINES[:3]:
            aud["engine"] = a["engine"]
        if "pauseMs" in a:
            aud["pauseMs"] = max(0, min(5000, int(a["pauseMs"] or 0)))
        if a.get("format") in ("mp3", "wav"):
            aud["format"] = a["format"]
        if isinstance(a.get("voices"), dict):
            aud["voices"] = {e: {r: str((v or {}).get(r) or "")[:80] for r in ("user", "assistant")} for e, v in a["voices"].items() if e in A.ENGINES[:3] and isinstance(v, dict)}
        out["audio"] = aud
    return out


_store: Store | None = None
_store_lock = threading.Lock()
_sync_lock = threading.Lock()
_state: dict[str, Any] = {"syncing": False, "step": "", "last": None}


def store() -> Store:
    global _store
    with _store_lock:
        want = data_dir() / "chats.db"
        if _store is None or _store.path != want:
            want.parent.mkdir(parents=True, exist_ok=True)
            try:
                want.parent.chmod(0o700)
            except OSError:
                pass
            _store = Store(want)
        return _store


audio = A.Audio(data_dir, audio_dir)


def run_sync() -> dict[str, Any]:
    """One check for updates over every live source (exports come in through /import)."""
    if not _sync_lock.acquire(blocking=False):
        with _sync_lock:  # a check is already running: wait for it and answer with its result
            pass
        return _state["last"] or {}
    try:
        _state["syncing"] = True
        t = time.time()
        cfg = settings()
        rep = ingest.sync_all(store(), cfg, hub_drop_dir(cfg), progress=lambda s: _state.__setitem__("step", s))
        rep["took"] = round(time.time() - t, 2)
        store().add_run(rep)
        _state["last"] = rep
        return rep
    finally:
        _state["syncing"], _state["step"] = False, ""
        _sync_lock.release()


def _timer() -> None:
    time.sleep(20)
    while True:
        mins = settings().get("intervalMin") or 0
        if mins:
            try:
                run_sync()
            except Exception as e:  # noqa: BLE001 — a failed run is reported in the next status, never kills the timer
                _state["last"] = {"at": S.now_iso(), "errors": [f"sync failed: {e}"], "new": 0, "continued": 0, "changed": 0, "unchanged": 0}
        time.sleep(max(60, mins * 60 or 300))


if os.environ.get("AXF_CHAT_VIEWER_TIMER", "on") != "off":
    threading.Thread(target=_timer, daemon=True, name="chat-viewer-sync").start()


def _need(sid: str) -> dict[str, Any]:
    r = store().row(sid)
    if not r:
        raise HTTPException(404, f"no session {sid}")
    return r


# ---------------------------------------------------------------------------------------------- routes

@router.get("/status")
def status() -> dict[str, Any]:
    cfg = settings()
    drop = hub_drop_dir(cfg)
    last = _state["last"] or (store().runs(1) or [None])[0]
    return {"counts": store().counts(), "last": last, "syncing": _state["syncing"], "step": _state["step"], "intervalMin": cfg["intervalMin"],
            "sources": {"claudeDirs": ingest.existing_dirs(cfg["claudeDirs"]), "logGlobs": cfg["logGlobs"],
                        "hubDrop": {"path": str(drop) if drop else "", "exists": bool(drop and drop.is_dir())}, "hub": str(hub_data() or "")},
            "audioDir": str(audio_dir()), "tts": {"piper": audio.piper_ready(), "keys": {p: bool(audio.key_for(p)) for p in A.ENV_KEYS}}}


@router.post("/sync")
def sync() -> dict[str, Any]:
    return run_sync()


@router.get("/sessions")
def sessions(source: str = "", limit: int = 5000) -> dict[str, Any]:
    if source and source not in S.SOURCES:
        raise HTTPException(400, f"source must be one of {', '.join(S.SOURCES)}")
    return {"sessions": store().list(source=source, limit=max(1, min(20000, limit))), "counts": store().counts()}


@router.get("/sessions/{sid}")
def session(sid: str) -> dict[str, Any]:
    _need(sid)
    doc = store().session(sid)
    row = store().row(sid)
    return {"session": doc, "row": row, "versions": store().versions(sid), "audio": audio.exports(sid)}


@router.post("/sessions/{sid}/seen")
def seen(sid: str) -> dict[str, Any]:
    _need(sid)
    store().mark_seen(sid)
    return {"ok": True}


@router.post("/seen-all")
def seen_all() -> dict[str, Any]:
    return {"ok": True, "cleared": store().mark_all_seen()}


@router.delete("/sessions/{sid}")
def forget(sid: str) -> dict[str, Any]:
    _need(sid)
    return {"ok": store().delete(sid)}


@router.get("/sessions/{sid}/versions/{version}")
def version(sid: str, version: int) -> dict[str, Any]:
    _need(sid)
    msgs = store().version_messages(sid, version)
    if msgs is None:
        raise HTTPException(404, f"no version {version}")
    return {"version": version, "messages": msgs}


def export_text(doc: dict[str, Any], fmt: str) -> str:
    who = {"user": "Brett", "assistant": "Amber", "tool": "Tool"}
    lines: list[str] = []
    if fmt == "md":
        lines += [f"# {doc['title']}", "", f"- Source: {doc['source']}", f"- Started: {doc['startedAt']}", f"- Updated: {doc['updatedAt']}"]
        if doc.get("project"):
            lines.append(f"- Project: {doc['project']}")
        lines.append("")
        for m in doc["messages"]:
            at = f" · {m['at'][:16].replace('T', ' ')}" if m.get("at") else ""
            if m["role"] == "tool":
                lines += [f"<details><summary>{m.get('toolName') or 'Tool'}{at}</summary>", "", "```", m["text"], "```", "", "</details>", ""]
            else:
                lines += [f"**{who[m['role']]}**{at}", "", m["text"], ""]
    else:
        lines += [doc["title"], "=" * min(80, len(doc["title"])), f"{doc['source']} · {doc['startedAt']} → {doc['updatedAt']}", ""]
        for m in doc["messages"]:
            at = f" [{m['at'][:16].replace('T', ' ')}]" if m.get("at") else ""
            name = f"{who[m['role']]}: {m['toolName']}" if m["role"] == "tool" and m.get("toolName") else who[m["role"]]
            lines += [f"{name}{at}", m["text"], ""]
    return "\n".join(lines)


@router.get("/sessions/{sid}/export")
def export(sid: str, format: str = "md") -> Response:  # noqa: A002 — the query name
    _need(sid)
    doc = store().session(sid)
    assert doc
    base = A._slug(doc["title"])
    if format == "json":
        return Response(json.dumps(doc, indent=1, ensure_ascii=False), media_type="application/json", headers={"content-disposition": f'attachment; filename="{base}.json"'})
    if format not in ("md", "txt"):
        raise HTTPException(400, "format must be md, txt or json")
    return Response(export_text(doc, format), media_type="text/markdown" if format == "md" else "text/plain",
                    headers={"content-disposition": f'attachment; filename="{base}.{format}"'})


@router.get("/search")
def search(q: str = "", source: str = "", limit: int = 100) -> dict[str, Any]:
    return {"q": q, "hits": store().search(q, source=source, limit=max(1, min(500, limit)))}


@router.post("/import")
async def import_file(request: Request, name: str = "") -> dict[str, Any]:
    """The export as the raw request body (application/zip or application/json), streamed to a temp file."""
    tmp = data_dir() / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    dest = tmp / f"upload-{int(time.time() * 1000)}"
    size = 0
    try:
        with open(dest, "wb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise HTTPException(413, "the file is larger than 1 GB")
                f.write(chunk)
        if not size:
            raise HTTPException(400, "no file: send the claude.ai export zip (or conversations.json) as the body")
        try:
            rep = ingest.import_export(store(), dest)
        except (ValueError, OSError, zipfile.BadZipFile) as e:
            raise HTTPException(400, f"that isn't a claude.ai data export: {e}") from None
        rep.update({"at": S.now_iso(), "file": name[:200], "bytes": size, "kind": "import"})
        store().add_run({**rep, "bySource": {"claude-ai": {k: rep.get(k, 0) for k in ("new", "continued", "changed", "unchanged")}}})
        return rep
    finally:
        dest.unlink(missing_ok=True)


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return {"settings": settings(), "defaults": DEFAULTS}


@router.put("/settings")
def put_settings(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        saved = json.loads((data_dir() / "settings.json").read_text())
    except (OSError, ValueError):
        saved = {}
    if body.get("reset"):
        saved = {}
    else:
        saved = _merge(saved, _clean_settings(body))
    p = data_dir() / "settings.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(saved, indent=1))
    tmp.chmod(0o600)
    tmp.replace(p)
    return {"settings": settings()}


@router.get("/tts")
def tts() -> dict[str, Any]:
    return audio.status()


@router.post("/tts/setup")
def tts_setup(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    v = settings()["audio"]["voices"]["piper"]
    voices = body.get("voices") or [v["user"], v["assistant"]]
    try:
        return audio.setup([str(x) for x in voices][:8])
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


@router.put("/tts/keys/{provider}")
def put_key(provider: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    key = str(body.get("key") or "").strip()
    if not key:
        raise HTTPException(400, "key is empty")
    try:
        audio.set_key(provider, key)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    return {"ok": True, "keys": {p: bool(audio.key_for(p)) for p in A.ENV_KEYS}}


@router.delete("/tts/keys/{provider}")
def del_key(provider: str) -> dict[str, Any]:
    try:
        audio.set_key(provider, None)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    return {"ok": True, "keys": {p: bool(audio.key_for(p)) for p in A.ENV_KEYS}}


@router.post("/audio")
def make_audio(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    sid = str(body.get("sessionId") or "")
    _need(sid)
    doc = store().session(sid)
    assert doc
    a = settings()["audio"]
    engine = body.get("engine") or a["engine"]
    voices = {**a["voices"].get(engine, {}), **{k: v for k, v in (body.get("voices") or {}).items() if k in ("user", "assistant") and v}}
    try:
        return audio.render(doc, {"engine": engine, "voices": voices, "from": body.get("from"), "to": body.get("to"),
                                  "pauseMs": body.get("pauseMs", a["pauseMs"]), "format": body.get("format") or a["format"]})
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


@router.get("/jobs/{jid}")
def job(jid: str) -> dict[str, Any]:
    j = audio.jobs.get(jid)
    if not j:
        raise HTTPException(404, "no such job (the console restarted?)")
    return j


@router.get("/audio")
def list_audio(sessionId: str = "") -> dict[str, Any]:  # noqa: N803 — query name
    return {"audio": audio.exports(sessionId), "dir": str(audio_dir())}


@router.get("/audio/file/{name}")
def audio_file(name: str) -> FileResponse:
    p = audio.file(name)
    if not p:
        raise HTTPException(404, "no such audio file")
    media = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".json": "application/json"}[p.suffix]
    return FileResponse(p, media_type=media, filename=p.name)


@router.delete("/audio/file/{name}")
def audio_remove(name: str) -> dict[str, Any]:
    if not audio.remove(name):
        raise HTTPException(404, "no such audio file")
    return {"ok": True}

