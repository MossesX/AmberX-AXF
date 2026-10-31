"""Session browser (server part). Mounted at /api/plugins/session-history/ (console token on every route, 404 while
the plugin is off, never on the console MCP).

  GET  runs?since=<stamp>     every run (Claude Code sessions, headless runs, agent-swarm runs), newest first:
                              {stamp, changed, runs}; with ``since`` equal to the current stamp only {stamp, changed:false},
                              so the browser can poll it every few seconds for the live grid
  GET  runs/{id}              one run
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

from . import runs as R

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
