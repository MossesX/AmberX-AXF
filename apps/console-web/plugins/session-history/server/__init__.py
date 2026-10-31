"""Session browser (server part). Mounted at /api/plugins/session-history/ (console token on every route, 404 while
the plugin is off, never on the console MCP).

  GET  runs?since=<stamp>     every run (Claude Code sessions, headless runs, agent-swarm runs), newest first:
                              {stamp, changed, runs}; with ``since`` equal to the current stamp only {stamp, changed:false},
                              so the browser can poll it every few seconds for the live grid
  GET  runs/{id}              one run
  GET  runs/{id}/did          what it built: plain-English summary + one line per commit / uncommitted edits (item, what
                              was wrong, files with before / after), GitHub links, its Codebase changes entries (through
                              ``axf.changes@1``, never by folder) and its Session check-in record (session-log@1 archive)
  GET  runs/{id}/events?tab=context|tools|conversation&offset=&limit=
                              the expanded row's tabs (see ``tabs.py``), paged
  GET  runs/{id}/tail?offset=  watch: the run's new events since a byte offset of its live file (-1 = the last few)
  POST runs/{id}/kill         {confirm: <id>} stop a running headless / agent run (see ``kill.py`` for how the process
                              is found; never a guess), recorded in killed.json
  GET  config / PUT config    the folders read (transcripts, streams, reports) and limits

The reading itself is in ``runs.py`` (pure, tested without FastAPI). The store keeps a ``killed.json`` in the plugin's
data folder and nothing else; the files it reads are never written.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import plugin_services

from . import did as D
from . import kill as K
from . import runs as R
from . import tabs as T

router = APIRouter()
FOLDER = "session-history"


def data_dir() -> Path:
    return Path(os.environ.get("AXF_SESSION_HISTORY_DIR") or (R.ROOT / ".axf-console" / "plugins" / FOLDER))


def _load_config() -> dict[str, Any]:
    try:
        c = json.loads((data_dir() / "config.json").read_text("utf-8"))
        return c if isinstance(c, dict) else {}
    except (OSError, ValueError):
        return {}


STORE = R.Store(data_dir(), _load_config())


def _check(rid: str) -> str:
    if not R.RUN_ID.match(rid):
        raise HTTPException(400, "not a run id")
    return rid


def _get(rid: str) -> dict[str, Any]:
    run = STORE.run(_check(rid))
    if run is None:
        raise HTTPException(404, "no such run")
    return run


@router.get("/runs")
def list_runs(since: str = "") -> dict[str, Any]:
    rows = STORE.runs()
    stamp = STORE.stamp()
    if since and since == stamp:
        return {"stamp": stamp, "changed": False}
    return {"stamp": stamp, "changed": True, "runs": [R.public(r) for r in rows]}


@router.get("/runs/{rid}")
def get_run(rid: str) -> dict[str, Any]:
    return {"run": R.public(_get(rid))}


CHANGES = "axf.changes@1"


def _changes_for(run: dict[str, Any]) -> list[dict[str, Any]]:
    svc = plugin_services.get(CHANGES)
    if not svc or not run.get("branch"):
        return []
    try:
        rows = [c for c in svc.summaries() if c.get("branch") == run["branch"]]
    except Exception:  # noqa: BLE001 — a broken log never breaks the browser
        return []
    return [{k: c.get(k) for k in ("id", "title", "state", "createdAt", "model")} for c in rows[:10]]


def _archive_roots() -> list[Path]:
    roots = [Path("/projects/amberx-axf/_data/sessions"), R.ROOT / "sessions"]
    if Path("/opt/axf/sessions").is_dir():
        roots.append(Path("/opt/axf/sessions"))
    return [r for r in dict.fromkeys(roots) if r.is_dir()]


def _checkin_for(rid: str) -> dict[str, Any] | None:
    """The run's session-log@1 record (Session check-in archive), matched by Claude session id; read-only."""
    for root in _archive_roots():
        for f in sorted(root.glob("*/*/*.json"), reverse=True)[:3000]:
            try:
                rec = json.loads(f.read_text("utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(rec, dict) and rec.get("$axf") == "session-log@1" and rec.get("claudeSessionId") == rid:
                loc = rec.get("location") if isinstance(rec.get("location"), dict) else {}
                proj = rec.get("project") if isinstance(rec.get("project"), dict) else {}
                return {"id": rec.get("id"), "startedAt": rec.get("startedAt"), "location": loc.get("answer") or loc.get("detected"),
                        "project": proj.get("answer") or proj.get("detected"), "estimate": rec.get("estimate")}
    return None


@router.get("/runs/{rid}/did")
def get_did(rid: str) -> dict[str, Any]:
    run = _get(rid)
    out = D.what_it_did(run, STORE.events(run))
    return {**out, "changes": _changes_for(run), "checkin": _checkin_for(rid)}


@router.get("/runs/{rid}/events")
def get_events(rid: str, tab: str = "context", offset: int = 0, limit: int = 100) -> dict[str, Any]:
    if tab not in T.TABS:
        raise HTTPException(400, f"tab is one of {', '.join(T.TABS)}")
    run = _get(rid)
    return T.page(STORE.events(run), tab, offset, limit)


@router.get("/runs/{rid}/tail")
def get_tail(rid: str, offset: int = -1) -> dict[str, Any]:
    run = _get(rid)
    path = K.live_file(run)
    if not path:
        raise HTTPException(404, "this run has no live file")
    return {**K.tail(path, offset), "status": run["status"], "usd": run.get("usd"), "tokensTotal": run.get("tokensTotal")}


@router.post("/runs/{rid}/kill")
async def post_kill(rid: str, request: Request) -> dict[str, Any]:
    run = _get(rid)
    try:
        body = await request.json()
    except ValueError:
        body = {}
    if not isinstance(body, dict) or body.get("confirm") != rid:
        raise HTTPException(400, "confirm with the run id")
    if run["kind"] == "session":
        raise HTTPException(400, "only headless and agent runs can be stopped from here")
    if run["status"] != "running":
        raise HTTPException(409, f"the run isn't running ({run['status']})")
    target = K.find_target(run)
    if target.get("error"):
        raise HTTPException(409, target["error"])
    res = K.kill(target)
    if not res.get("ok"):
        raise HTTPException(500, res.get("error") or "could not stop it")
    by = str(request.headers.get("x-axf-user") or "console")
    how = f"{target['how']} {target.get('pid') or target.get('tmux')}"
    STORE.mark_killed(rid, by, how)
    STORE.scan()
    return {"ok": True, "how": how, "run": R.public(STORE.run(rid) or run)}


def _clean_config(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise HTTPException(400, "expected an object")
    out: dict[str, Any] = {}
    for k in ("transcripts", "streams", "reports"):
        if k in body:
            v = body[k]
            if not isinstance(v, list) or len(v) > 20 or not all(isinstance(x, str) and 0 < len(x) <= 400 and (x.startswith(("/", "~"))) for x in v):
                raise HTTPException(400, f"{k}: a list of up to 20 absolute (or ~) folder paths")
            out[k] = v
    if "maxRuns" in body:
        n = body["maxRuns"]
        if not isinstance(n, int) or not 10 <= n <= 20000:
            raise HTTPException(400, "maxRuns: 10 … 20000")
        out["maxRuns"] = n
    return out


@router.get("/config")
def get_config() -> dict[str, Any]:
    return {"config": {k: STORE.config.get(k) for k in ("transcripts", "streams", "reports", "maxRuns")}, "defaults": R.DEFAULT_CONFIG,
            "dataDir": str(data_dir())}


@router.put("/config")
async def put_config(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(400, "expected JSON") from None
    clean = _clean_config(body)
    saved = {**_load_config(), **clean}
    d = data_dir()
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / "config.json.tmp"
    tmp.write_text(json.dumps(saved, indent=1), "utf-8")
    os.replace(tmp, d / "config.json")
    STORE.config = {**R.DEFAULT_CONFIG, **saved}
    STORE.scan()
    return get_config()
