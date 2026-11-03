"""Server part of the Claude plugin (claude-settings@1). Mounted at /api/plugins/claude-settings/.

Every read and write goes through the plugin's Node CLI (claude-settings.mjs → core.mjs), so the console, the MCP tools
and the CLI share one store (the hub's /projects/_shared/_data/claude/settings.json) and one set of rules.

  GET  settings              every setting with its value, who may change it and a plain description (+ No wait state)
  GET  settings/{key}        one setting
  PUT  settings              { values: { key: value } }: owner-only settings change only from Brett's signed-in session
  GET  registry              the open registry (groups + settings)

No wait: when Brett's own click turns it on (or changes its duration / Include irreversible while on), the server asks
the control@1 capability (token-control) for an all-scope veto pass with the approval of this same request; off revokes
it at once. A clock (every 60 s) renews an "until I turn it off" pass, and turns No wait off at night or when its pass
ended (revoked from the banner, expired).
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import plugin_services

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
CLI = Path(__file__).resolve().parents[1] / "claude-settings.mjs"
ROOT = Path(__file__).resolve().parents[5]  # the repo root
STATUS = {"invalid": 400, "denied": 403, "not_found": 404, "unavailable": 503}
TICK_S = 60


def cli(*args: str, stdin: dict[str, Any] | None = None, timeout: int = 30) -> dict[str, Any]:
    try:
        p = subprocess.run(["node", str(CLI), *args, "--json"], input=json.dumps(stdin) if stdin is not None else None,
                           cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "code": "unavailable", "message": f"claude-settings could not run: {str(e)[:200]}"}
    lines = p.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "code": "unexpected", "message": p.stderr.strip()[-400:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "code": "unexpected", "message": (p.stderr or p.stdout).strip()[-400:]}


def answer(r: dict[str, Any]) -> JSONResponse:
    return JSONResponse(r, status_code=200 if r.get("ok") else STATUS.get(str(r.get("code")), 500))


def control() -> Any:
    return plugin_services.get("control@1")


def pass_state() -> dict[str, Any]:
    """The all-scope pass now: { active, remainingMs, ended, text } (ended = how the latest one ended, when none is on)."""
    c = control()
    if c is None:
        return {"active": False, "remainingMs": 0, "ended": None, "text": "Token control is off: No wait can't make a pass."}
    r = c.run({"op": "list", "target": "pass.scopes"}, ["*"], "claude-settings")
    row = next((x for x in r.get("items") or [] if x.get("id") == "all"), {})
    active = row.get("active")
    if active:
        return {"active": True, "remainingMs": int(active.get("remainingMs") or 0), "expiresAt": active.get("expiresAt"), "ended": None,
                "include_irreversible": bool(active.get("include_irreversible")), "approvedBy": active.get("approvedBy"), "text": row.get("text", "")}
    last = next((p for p in r.get("recent") or [] if p and p.get("scope") == "all" and p.get("state") in ("expired", "revoked")), None)
    return {"active": False, "remainingMs": 0, "ended": last.get("state") if last else None, "text": row.get("text", "")}


def with_pass(v: dict[str, Any]) -> dict[str, Any]:
    if v.get("ok"):
        v["noWait"] = pass_state()
    return v


@router.get("/settings")
def get_all() -> JSONResponse:
    return answer(with_pass(cli("get")))


@router.get("/registry")
def registry() -> JSONResponse:
    return answer(cli("registry"))


@router.get("/settings/{key}")
def get_one(key: str) -> JSONResponse:
    return answer(cli("get", key))


@router.put("/settings")
async def put(request: Request) -> JSONResponse:
    """Change settings. Owner-only ones need Brett's signed-in console session (the same test token-control uses for
    veto passes); a console token, an MCP call or a session changes only the others."""
    try:
        body = await request.json()
    except ValueError:
        body = {}
    values = body.get("values") if isinstance(body, dict) else None
    if not isinstance(values, dict) or not values:
        return answer({"ok": False, "code": "invalid", "message": "send { values: { key: value } }"})
    c = control()
    owner = c.owner(request) if c is not None and hasattr(c, "owner") else None
    user = getattr(request.state, "axf_user", None)
    by = str(getattr(user, "name", "") or "console")
    before = cli("get")
    r = cli("owner-set", stdin={"patch": values, "owner": owner, "by": by})
    if not r.get("ok"):
        return answer(r)
    action = r.get("pass")
    if action:
        p = apply_pass(request, action, r.get("passInput") or {})
        r["passResult"] = p
        if action == "grant" and not p.get("ok", False):
            # the pass didn't come on: put No wait back so the switch never says on without a pass behind it
            cli("system-off", "noWait.enabled", "the No wait pass could not be granted")
            r["ok"] = False
            r["code"] = p.get("code", "unavailable")
            r["message"] = f"No wait stayed off: {p.get('message', 'the pass could not be granted')}"
            return answer(with_pass(r))
        if action == "grant" and (p.get("approval") or {}).get("required"):
            # not Brett's own session after all: the request waits for him, the switch goes back off until he approves
            cli("system-off", "noWait.enabled", "waiting for Brett's approval of the pass")
    r.pop("view", None)
    out = with_pass(cli("get"))
    out["changed"] = r.get("changed", [])
    out["passResult"] = r.get("passResult")
    out["before"] = before.get("updatedAt")
    return answer(out)


def apply_pass(request: Request, action: str, inp: dict[str, Any]) -> dict[str, Any]:
    c = control()
    if c is None or not hasattr(c, "owner_pass"):
        return {"ok": False, "code": "unavailable", "message": "Token control (control@1 veto passes) is off or too old"}
    if action == "grant":
        return c.owner_pass(request, "grant", "all", {k: v for k, v in inp.items() if v not in (None, False)}, reason="Claude settings: No wait on")
    return c.owner_pass(request, "revoke", "all", {}, reason="Claude settings: No wait off")


def tick() -> dict[str, Any]:
    """One beat of the No wait clock: renew an until-off pass, or switch No wait off (night, pass ended)."""
    c = control()
    if c is None:
        return {"action": "none", "why": "control@1 off"}
    t = cli("tick", stdin={"pass": pass_state(), "timeZone": os.environ.get("AXF_TIMEZONE", "America/New_York")})
    if not t.get("ok"):
        return t
    if t.get("action") == "renew" and hasattr(c, "renew_pass"):
        r = c.renew_pass("all", {"minutes": t.get("minutes", 240), **({"include_irreversible": True} if t.get("include_irreversible") else {})}, "Claude settings: No wait (until off), renewed")
        if not r.get("ok"):
            cli("system-off", "noWait.enabled", f"renewal refused: {r.get('message', '')}"[:200])
    elif t.get("action") == "off":
        cli("system-off", "noWait.enabled", str(t.get("why") or "off"))
        if t.get("revoke"):
            c.run({"op": "act", "target": "pass.scopes", "path": "all", "action": "revoke", "input": {}, "by": "claude-settings (night)"}, ["*"], "claude-settings")
    return t


def _clock() -> None:
    while True:
        time.sleep(TICK_S)
        try:
            if plugin_services.get("axf.claude-settings@1") is not None:  # None while the plugin is turned off
                tick()
        except Exception:  # noqa: BLE001 — the clock never takes the console down
            pass


class ClaudeSettings:
    """axf.claude-settings@1 for other plugins: get() → every setting (claude-settings@1 view)."""

    def get(self) -> dict[str, Any]:
        return cli("get")


plugin_services.provide("axf.claude-settings@1", ClaudeSettings(), FOLDER)

if not os.environ.get("AXF_CLAUDE_SETTINGS_NO_CLOCK"):
    threading.Thread(target=_clock, name="claude-settings-clock", daemon=True).start()
