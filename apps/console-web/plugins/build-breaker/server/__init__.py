"""Build Breaker (server part). Mounted at /api/plugins/build-breaker/ (console token on every route, 404 while off).

  GET  asks              every ask on the old list (build-asks@1), read through asks.mjs export --json.
  GET  requests          the requests ledger (request@1): every single thing Brett asked for, with his exact words,
                         status, place in line, agent, PR and cost, plus a summary and a fingerprint (live polling: the
                         page sends ?since=<fingerprint> and gets {same: true} when nothing moved). Records status and
                         queue changes into the ledger's history as it reads.
  GET  requests/summary  counts for the banner and the Home card (open, running, queued, awaiting merge, the newest).
  GET  request?id=…      one request with its family (parent, addenda, what replaced it); id = a request id, a build id
                         or a few words ("where's that thing I asked for").
  POST requests/update   {id, status?, title?, agent?, supersededBy?, note?, pr?, by?}
  POST requests/link     {id, kind, ref, label?, by?}
  POST requests/add      {said, kind?, title?, source?, parent?, link?: "kind:ref", status?, by?}

Every route runs the plugin's CLI (requests.mjs), so the console, the CLI, the MCP tools and other sessions share one
set of rules.
"""
from __future__ import annotations

import json
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body

router = APIRouter()
HERE = Path(__file__).resolve().parent.parent
CLI = HERE / "asks.mjs"
REQUESTS = HERE / "requests.mjs"
ROOT = CLI.parents[4]
_cache: dict[str, Any] = {"at": 0.0, "res": None}
_lock = threading.Lock()
CACHE_S = 8  # a page polling every 20 s, the banner and a Home card share one read


def _node(cli: Path, *args: str, timeout: int = 60) -> dict[str, Any]:
    try:
        proc = subprocess.run(["node", str(cli), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "error": f"could not run {cli.name}: {str(e)[:200]}"}
    lines = proc.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}


def _export(fresh: bool = False) -> dict[str, Any]:
    with _lock:
        if not fresh and _cache["res"] is not None and time.monotonic() - _cache["at"] < CACHE_S:
            return _cache["res"]
        res = _node(REQUESTS, "export", "--record")
        if res.get("ok"):
            _cache.update(at=time.monotonic(), res=res)
        return res


def _changed(res: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        _cache.update(at=0.0, res=None)
    return res


@router.get("/asks")
def asks() -> dict[str, Any]:
    return _node(CLI, "export")


@router.get("/requests")
def requests(since: str = "") -> dict[str, Any]:
    res = _export()
    if since and res.get("ok") and res.get("fingerprint") == since:
        return {"ok": True, "same": True, "fingerprint": since, "summary": res.get("summary")}
    return res


@router.get("/requests/summary")
def requests_summary() -> dict[str, Any]:
    res = _export()
    if not res.get("ok"):
        return res
    reqs = res.get("requests") or []
    open_ = [r for r in reqs if r.get("status") in ("idea", "planned", "queued", "running", "paused", "built")]
    open_.sort(key=lambda r: r.get("updatedAt") or "", reverse=True)
    items = [{"id": r["id"], "title": r.get("title", ""), "status": r.get("status", ""), "queue": f"#{r['queue']['position']}" if r.get("queue") else "",
              "agent": r.get("agent", ""), "updatedAt": r.get("updatedAt", "")} for r in open_[:8]]
    return {"ok": True, **(res.get("summary") or {}), "fingerprint": res.get("fingerprint", ""), "items": items}


@router.get("/request")
def request(id: str = "") -> dict[str, Any]:  # noqa: A002 - the request id
    if not id.strip():
        return {"ok": False, "error": "id is needed"}
    return _node(REQUESTS, "get", *id.split())


def _flags(body: dict[str, Any], keys: dict[str, str]) -> list[str]:
    out: list[str] = []
    for k, flag in keys.items():
        v = body.get(k)
        if isinstance(v, str) and v.strip():
            out += [f"--{flag}", v.strip()]
    return out


@router.post("/requests/update")
def request_update(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    rid = str(body.get("id") or "").strip()
    if not rid:
        return {"ok": False, "error": "id is needed"}
    flags = _flags(body, {"status": "status", "title": "title", "agent": "agent", "supersededBy": "superseded-by", "note": "note", "pr": "pr", "by": "by"})
    return _changed(_node(REQUESTS, "update", rid, *(flags or ["--by", "console"])))


@router.post("/requests/link")
def request_link(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    rid, kind, ref = (str(body.get(k) or "").strip() for k in ("id", "kind", "ref"))
    if not (rid and kind and ref):
        return {"ok": False, "error": "id, kind and ref are needed"}
    return _changed(_node(REQUESTS, "link", rid, kind, ref, *_flags(body, {"label": "label", "by": "by"})))


@router.post("/requests/add")
def request_add(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    if not str(body.get("said") or body.get("title") or "").strip():
        return {"ok": False, "error": "his words (said) or a title are needed"}
    flags = _flags(body, {"said": "said", "kind": "kind", "title": "title", "source": "source", "parent": "parent", "link": "link", "status": "status", "by": "by", "at": "at"})
    return _changed(_node(REQUESTS, "add", *flags))
