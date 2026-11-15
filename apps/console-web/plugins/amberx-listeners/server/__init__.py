"""AmberX listeners (server part, listener@1). Mounted at /api/plugins/amberx-listeners/.

Every read and write goes through the plugin's Node core (listeners.mjs → core.mjs), so the console page, the MCP tools
(plugin-commands@1: amberx-listeners_*), the CLI and this share one implementation and one place on the hub:
devices in /projects/amberx-axf/_data/listeners/devices (what the phones publish), policies in the AmberX settings
document /projects/_shared/_data/settings/apps/amberx-droid.json (what lib-hubsync mirrors onto every device).

  GET  devices               every AmberX device with its listeners (state words, who has the mic, last error, policy)
  GET  policies              every listener's policy as the hub holds it
  GET  registry              the listener registry (ids, labels, kinds, defaults)
  GET  state                 devices + policies + registry at once
  POST policy {id, policy}   set a listener's policy (any of on, pauseOnCall, pauseForOtherApps, sound, retries,
                             backoffMs, maxBackoffMs, cooldownMs); every phone follows on its next settings refresh
  POST restart {id}          ask every phone to restart a listener (a synced restart request)

Hub admins and the console token (the console's wall); a plain hub user gets 403 from the console itself.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
CLI = Path(__file__).resolve().parents[1] / "listeners.mjs"
ROOT = Path(__file__).resolve().parents[5]
STATUS = {"invalid": 400, "not_found": 404, "unavailable": 503}
MAX_BODY = 16 * 1024


def cli(*args: str, timeout: int = 30) -> dict[str, Any]:
    try:
        p = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "code": "unavailable", "message": f"amberx-listeners could not run: {str(e)[:200]}"}
    lines = p.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "code": "unexpected", "message": p.stderr.strip()[-400:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "code": "unexpected", "message": (p.stderr or p.stdout).strip()[-400:]}


def answer(r: dict[str, Any]) -> JSONResponse:
    return JSONResponse(r, status_code=200 if r.get("ok") else STATUS.get(str(r.get("code")), 500))


def _who(request: Request) -> str:
    u = getattr(request.state, "axf_user", None)
    name = getattr(u, "name", None) or (u.get("name") if isinstance(u, dict) else None)
    return f"console:{str(name)[:40]}" if name and name != "console-token" else "console"


async def _body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > MAX_BODY:
        return {}
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


@router.get("/devices")
async def devices() -> JSONResponse:
    return answer(await run_in_threadpool(cli, "devices"))


@router.get("/policies")
async def policies() -> JSONResponse:
    return answer(await run_in_threadpool(cli, "policies"))


@router.get("/registry")
async def registry() -> JSONResponse:
    return answer(await run_in_threadpool(cli, "registry"))


@router.get("/state")
async def state() -> JSONResponse:
    d = await run_in_threadpool(cli, "devices")
    if not d.get("ok"):
        return answer(d)
    p = await run_in_threadpool(cli, "policies")
    r = await run_in_threadpool(cli, "registry")
    return answer({"ok": True, "live": d.get("live"), "devices": d.get("devices") or [], "policies": p.get("policies") or {}, "registry": r.get("listeners") or [], "updatedAt": p.get("updatedAt"), "updatedBy": p.get("updatedBy")})


@router.post("/policy")
async def policy(request: Request) -> JSONResponse:
    body = await _body(request)
    lid = body.get("id")
    patch = body.get("policy")
    if not isinstance(lid, str) or not isinstance(patch, dict) or not patch:
        return answer({"ok": False, "code": "invalid", "message": "send { id, policy: { field: value } }"})
    pairs = [f"{k}={json.dumps(v) if isinstance(v, bool) else v}" for k, v in patch.items() if isinstance(k, str) and isinstance(v, (bool, int, float, str))]
    if not pairs:
        return answer({"ok": False, "code": "invalid", "message": "policy values are booleans, numbers or strings"})
    return answer(await run_in_threadpool(cli, "set", lid, *pairs, "--by", _who(request)))


@router.post("/restart")
async def restart(request: Request) -> JSONResponse:
    body = await _body(request)
    lid = body.get("id")
    if not isinstance(lid, str):
        return answer({"ok": False, "code": "invalid", "message": "send { id }"})
    return answer(await run_in_threadpool(cli, "restart", lid, "--by", _who(request)))
