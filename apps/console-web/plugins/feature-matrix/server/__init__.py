"""Feature matrix (server part). Mounted at /api/plugins/feature-matrix/ (console token on every route, 404 while off,
never on the console MCP).

  GET  state                 every profile's matrices as one dataset + grid rows + the last Apply reports
  GET  matrix?id=<id>        one matrix + totals ({missing: true} when the build has none yet)
  POST act      {change}     a feature-matrix@1 change: add-item, keep, skip, set-state, edit-item, rename, add, seed
  POST seed     {ref, profile?}   a matrix for a build from the table it lives in (idempotent, only adds)
  POST apply    {matrix}     push the matrix to every table the build lives in, then record its version as applied
  POST import   {profile?}   the draft as the first matrix + a matrix for every open build of the profile

There is NO delete route: items and matrices are never deleted (the contract refuses `remove` / `remove-item` too).
Every read and change runs the plugin's CLI (matrix.mjs --json), so the console, the CLI and other sessions share one
set of rules (the framework's pure cores) and one file per profile. A change-log@1 entry (ref kind `change`) is read
and written through the capability ``axf.changes@1``, looked up at request time, never by plugin folder.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import plugin_services

router = APIRouter()
CLI = Path(__file__).resolve().parent.parent / "matrix.mjs"
ROOT = CLI.parents[3]
MAX_BODY = 256 * 1024
CHANGES = "axf.changes@1"
NEVER = {"remove", "remove-item", "delete", "delete-item"}
_MID = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}:(orchestrator|pending|queue|plan|change):[^\s/\\]{1,120}$")
_CID = re.compile(r"^chg-\d{8}-[0-9a-f]{6,16}$")


def _run(*args: str) -> dict[str, Any]:
    proc = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=60)
    out = proc.stdout.strip().splitlines()
    try:
        res = json.loads(out[-1]) if out else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        res = {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}
    return res


async def _body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise HTTPException(413, "change too large")
    try:
        data = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "not JSON")
    if not isinstance(data, dict):
        raise HTTPException(400, "an object is needed")
    return data


def _change_entry(cid: str) -> dict[str, Any] | None:
    if not _CID.match(cid or ""):
        return None
    svc = plugin_services.get(CHANGES)
    try:
        return svc.get(cid) if svc else None
    except Exception:  # noqa: BLE001 — a broken log never breaks the matrix
        return None


@router.get("/state")
def state() -> dict[str, Any]:
    return _run("state")


@router.get("/matrix")
def matrix(id: str) -> dict[str, Any]:  # noqa: A002 — the query parameter is called id
    if not _MID.match(id):
        raise HTTPException(400, "not a matrix id")
    return _run("get", id)


@router.post("/act")
async def act(request: Request) -> dict[str, Any]:
    change = await _body(request)
    action = change.get("action")
    if not isinstance(action, str):
        raise HTTPException(400, "a change needs an action")
    if action in NEVER:
        raise HTTPException(400, "items and matrices are never deleted: skip them instead")
    return _run("act", json.dumps(change))


@router.post("/seed")
async def seed(request: Request) -> dict[str, Any]:
    data = await _body(request)
    ref = data.get("ref") if isinstance(data.get("ref"), dict) else {}
    arg: dict[str, Any] = {"ref": ref, "profile": data.get("profile") or ""}
    if ref.get("kind") == "change":
        entry = _change_entry(str(ref.get("id") or ""))
        if entry is None:
            return {"ok": False, "error": "that change-log entry isn't available (Codebase changes off or no such entry)"}
        arg["change"] = entry
    return _run("seed", json.dumps(arg))


@router.post("/apply")
async def apply(request: Request) -> dict[str, Any]:
    data = await _body(request)
    mid = str(data.get("matrix") or "")
    if not _MID.match(mid):
        raise HTTPException(400, "not a matrix id")
    arg: dict[str, Any] = {"matrix": mid}
    kind, ref_id = mid.split(":")[1], mid.split(":", 2)[2]
    if kind == "change":
        entry = _change_entry(ref_id)
        if entry is not None:
            arg["change"] = entry
    res = _run("apply", json.dumps(arg))
    target = res.pop("change", None) if isinstance(res, dict) else None
    if res.get("ok") and isinstance(target, dict) and kind == "change":
        svc = plugin_services.get(CHANGES)
        try:
            patch: dict[str, Any] = {"steps": target.get("steps") or []}
            if isinstance(target.get("estimate"), dict):
                patch["estimate"] = target["estimate"]
            if svc:
                svc.update(ref_id, patch)
                res.setdefault("log", []).append(f"change-log entry {ref_id} updated")
        except Exception as e:  # noqa: BLE001
            res.setdefault("log", []).append(f"change-log entry {ref_id} not updated: {str(e)[:160]}")
    return res


@router.post("/import")
async def import_all(request: Request) -> dict[str, Any]:
    data = await _body(request)
    profile = str(data.get("profile") or "")
    if profile and not re.match(r"^[a-z0-9][a-z0-9-]{0,39}$", profile):
        raise HTTPException(400, "not a profile id")
    return _run("import", *([profile] if profile else []))
