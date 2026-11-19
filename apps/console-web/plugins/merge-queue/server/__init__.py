"""Merge queue (merge-queue@2): the read-only view of the builds store. Mounted at /api/plugins/merge-queue/.

One read, no writes: GET queue answers what `node apps/console-web/plugins/merge-queue/queue.mjs --json` prints (every
build waiting to land, live status from the builds store). The plugin keeps no state and offers no actions.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()
HERE = Path(__file__).resolve().parent.parent
ROOT = HERE.parents[2].parent
CLI = HERE / "queue.mjs"


def read_queue(timeout: int = 60) -> dict[str, Any]:
    """The queue from the Node reader: {ok, $axf, at, landing, rows} or {ok: False, message}."""
    try:
        p = subprocess.run(["node", str(CLI), "--json"], cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "message": f"the merge queue could not be read: {str(e)[:200]}"}
    if p.returncode != 0:
        return {"ok": False, "message": (p.stderr or p.stdout).strip()[-400:] or f"exit {p.returncode}"}
    try:
        return {"ok": True, **json.loads(p.stdout)}
    except json.JSONDecodeError:
        return {"ok": False, "message": p.stdout.strip()[-400:]}


@router.get("/queue")
def queue() -> JSONResponse:
    """Every build waiting to land, with its live status, PRs and steps (read-only)."""
    r = read_queue()
    return JSONResponse(r, status_code=200 if r.get("ok") else 503)
