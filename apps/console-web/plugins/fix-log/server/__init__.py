"""Server part of the Fix log plugin (fix-log@1). Mounted at /api/plugins/fix-log/.

Brett, Nov 9 2026: "If something needs to be fixed, you can send me a notification on my phone through AmberX... log it,
and then if you try something, notify me that you're trying this, say what it is. If that fails, say that failed...
just notify me of doing it, not for permission or veto."

Any Claude session (voice, chat, headless) writes one short line per step: found / trying / failed / fixed. Each line is
appended to the Fix log (this plugin's data folder, entries.jsonl) and raised as an informational alert (source
``fix-log``): the console bell and, through the notify registry (notify.json, push on), AmberX. Nothing here asks for
anything: no approval, no veto. A session that floods is still logged, only its notifications pause (setting).

Routes: POST log · GET entries · GET entries/{id} · GET issues · GET summary · GET/PUT settings.
"""
from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import console_context as cx

from . import core

PLUGIN_DIR = Path(__file__).resolve().parents[1]
FOLDER = PLUGIN_DIR.name
_lock = threading.RLock()
router = APIRouter()


def data_dir() -> Path:
    d = Path(os.environ.get("AXF_FIX_LOG_DATA_DIR") or Path(cx.ROOT) / ".axf-console" / "plugins" / FOLDER)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(d: datetime) -> str:
    return d.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _ms(iso: str) -> int:
    try:
        return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return 0


def settings() -> dict[str, Any]:
    try:
        return core.norm_settings(json.loads((data_dir() / "settings.json").read_text()))
    except (OSError, ValueError):
        return core.norm_settings({})


def load() -> list[dict[str, Any]]:
    f = data_dir() / "entries.jsonl"
    out: list[dict[str, Any]] = []
    try:
        for line in f.read_text().splitlines():
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if isinstance(e, dict) and e.get("id") and e.get("outcome") in core.OUTCOMES:
                out.append(e)
    except OSError:
        pass
    return out


def _write_all(entries: list[dict[str, Any]]) -> None:
    f = data_dir() / "entries.jsonl"
    tmp = f.with_suffix(f".tmp-{os.getpid()}")
    tmp.write_text("".join(json.dumps(e, separators=(",", ":")) + "\n" for e in entries))
    tmp.replace(f)


def record(inp: dict[str, Any]) -> dict[str, Any]:
    """Log one entry and notify (bell + AmberX). Raises ValueError with the reason when the entry is refused."""
    why = core.validate(inp)
    if why:
        raise ValueError(why)
    cfg = settings()
    with _lock:
        entries = load()
        now = _now()
        e = core.make_entry(inp, entries, f"fx-{now.strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}", _iso(now))
        muted = core.over_limit(entries, e["session"], int(now.timestamp() * 1000), _ms, cfg["perSessionPer10Min"])
        send = cfg["notify"][e["outcome"]] and not muted
        if send:
            try:
                cx.raise_alert(core.alert_for(e))
                e["notified"] = True
                # the bell keeps only the newest line of an issue: the earlier ones are resolved, never deleted
                earlier = [f"fix-log:{x['id']}" for x in entries if x.get("issue") == e["issue"] and x.get("notified")]
                if earlier:
                    cx.resolve_alerts(earlier)
            except Exception as err:  # noqa: BLE001 - the log line is kept even when the alert hub is down
                cx.log("fix-log", f"alert not sent: {err}", "warn")
        e["muted"] = muted
        entries.append(e)
        keep = cfg["keep"]
        if len(entries) > keep * 1.2:
            _write_all(entries[-keep:])
        else:
            with (data_dir() / "entries.jsonl").open("a") as fh:
                fh.write(json.dumps(e, separators=(",", ":")) + "\n")
    return e


class LogReq(BaseModel):
    text: str = Field(min_length=1, max_length=core.TEXT_MAX * 2)
    outcome: str = Field(pattern="^(found|trying|failed|fixed)$")
    detail: str | None = Field(default=None, max_length=core.DETAIL_MAX * 2)
    session: str | None = Field(default=None, max_length=200)
    agent: str | None = Field(default=None, max_length=120)
    build: str | None = Field(default=None, max_length=200)
    issue: str | None = Field(default=None, max_length=80)


@router.post("/log")
def log_entry(req: LogReq, request: Request) -> dict[str, Any]:
    inp = req.model_dump()
    inp["session"] = inp.get("session") or request.headers.get("x-axhub-session") or request.headers.get("x-axf-session") or ""
    try:
        e = record(inp)
    except ValueError as err:
        raise HTTPException(400, str(err)) from err
    return {"ok": True, "entry": e, "issue": e["issue"], "notified": e["notified"],
            "note": "Logged and sent as an FYI. Pass this issue id with the next line of the same fix."}


def _filters(request: Request) -> dict[str, Any]:
    q = request.query_params
    return {k: q.get(k) for k in ("outcome", "session", "build", "issue", "agent", "since", "q") if q.get(k)}


@router.get("/entries")
def entries(request: Request, limit: int = 200) -> dict[str, Any]:
    f = _filters(request)
    rows = [e for e in load() if core.matches(e, f)]
    limit = max(1, min(2000, limit))
    return {"filters": f, "total": len(rows), "entries": list(reversed(rows))[:limit]}


@router.get("/entries/{entry_id}")
def entry(entry_id: str) -> dict[str, Any]:
    e = next((x for x in load() if x["id"] == entry_id), None)
    if not e:
        raise HTTPException(404, "no such entry")
    return {"entry": e, "thread": [x for x in load() if x["issue"] == e["issue"]]}


@router.get("/issues")
def issues(request: Request, state: str = "") -> dict[str, Any]:
    f = {k: v for k, v in _filters(request).items() if k != "outcome"}
    rows = core.issues([e for e in load() if core.matches(e, f)])
    if state == "open":
        rows = [i for i in rows if i["state"] != "fixed"]
    elif state in core.OUTCOMES:
        rows = [i for i in rows if i["state"] == state]
    return {"issues": rows}


@router.get("/summary")
def summary() -> dict[str, Any]:
    return core.summary(load(), _iso(_now())[:10])


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return settings()


class SettingsReq(BaseModel):
    notify: dict[str, bool] | None = None
    perSessionPer10Min: int | None = None
    keep: int | None = None


@router.put("/settings")
def put_settings(req: SettingsReq) -> dict[str, Any]:
    cur = settings()
    patch = req.model_dump(exclude_none=True)
    if "notify" in patch:
        bad = [k for k in patch["notify"] if k not in core.OUTCOMES]
        if bad:
            raise HTTPException(400, f"notify keys are {', '.join(core.OUTCOMES)}")
        patch["notify"] = {**cur["notify"], **patch["notify"]}
    out = core.norm_settings({**cur, **patch})
    (data_dir() / "settings.json").write_text(json.dumps(out, indent=1) + "\n")
    return out
