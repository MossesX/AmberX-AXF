"""Settings interfaces and reset over REST (plugin-settings@1 + settings-reset@1, framework/spec/PLUGIN-SETTINGS.md).

Brett, Nov 17 2026: "Each plugin needs its own settings interface, not the console's. Reset asks in a confirm dialog with
a switch to include assets and a scrollable table of changed assets."

  GET  /api/settings/interfaces/<owner>   owner = console or a plugin (id, folder or name): the resolved interface, its
                                          current values and its changed assets. Read live from the open console (the
                                          same engines the window and the dialog use); with no console open, the
                                          interface from the plugin's own asset file and its server-known settings
                                          (live: false).
  POST /api/settings/reset                {scope, includeAssets?, dryRun?, confirm?}: dryRun returns the plan (the
                                          changed-assets table) and a confirm token; the reset itself runs only with
                                          that token (destructive: confirm first, on every surface).

Both go through the console-commands@1 relay as the console actions settings.interface / settings.reset.plan /
settings.reset, so REST, MCP (settings_interface_get / settings_reset), the CLI (axf settings …) and voice reach the
same code.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

HERE = Path(__file__).resolve().parent
PLUGINS_DIR = HERE.parent / "plugins"
CONFIRM_TTL_S = 600
SCOPE = re.compile(r"^(console|app|(plugin:)?[A-Za-z0-9][A-Za-z0-9._-]{0,127})$")
OWNER = "owner"


def _salt() -> bytes:
    return (os.environ.get("AXF_TOKEN") or "axf-settings-reset").encode()


def confirm_token(scope: str, include_assets: bool, now: float | None = None) -> str:
    """A short-lived token bound to this exact reset (scope + switch), the same two-step flow as every destructive call."""
    t = int((now or time.time()) // 60)
    msg = f"settings.reset|{scope}|{int(include_assets)}|{t}".encode()
    return f"{t}.{hmac.new(_salt(), msg, hashlib.sha256).hexdigest()[:24]}"


def confirm_valid(token: Any, scope: str, include_assets: bool, now: float | None = None) -> bool:
    if not isinstance(token, str) or "." not in token:
        return False
    t, _, _sig = token.partition(".")
    if not t.isdigit():
        return False
    minute = int(t)
    cur = int((now or time.time()) // 60)
    if cur - minute > CONFIRM_TTL_S // 60 or minute > cur:
        return False
    return hmac.compare_digest(token, confirm_token(scope, include_assets, minute * 60))


def scope_of(raw: Any) -> str | None:
    """`console` / `app` → console; `plugin:<id>` or a bare plugin id / folder → `plugin:<id>` (the console resolves names)."""
    s = str(raw if raw is not None else "console").strip()
    if not s or s in ("console", "app"):
        return "console"
    if not SCOPE.match(s):
        return None
    return s if s.startswith("plugin:") else f"plugin:{s}"


def request_errors(b: dict[str, Any]) -> list[str]:
    """The 400s (resetRequestErrors in core/engines/settings-reset.ts)."""
    errors = []
    if scope_of(b.get("scope", "console")) is None:
        errors.append('scope must be "console" or a plugin id ("plugin:<id>")')
    for k in ("includeAssets", "dryRun"):
        if k in b and not isinstance(b[k], bool):
            errors.append(f"{k} must be true or false")
    return errors


def _commands() -> Any:
    try:
        import plugin_services
        return plugin_services.get("console-commands@1")
    except Exception:  # noqa: BLE001 — tests run without the console
        return None


def ask_console(action: str, args: list[str], by: str, audience: str = OWNER, confirm: Any = None) -> dict[str, Any]:
    """Run a console action in the open console; → {ok, result?, message}. No console → ok False, code unavailable."""
    svc = _commands()
    if svc is None:
        return {"ok": False, "code": "unavailable", "message": "console commands are off (the console-commands plugin)"}
    cmd: dict[str, Any] = {"$axf": "control@1", "target": "console.actions", "op": "act", "path": action, "action": "run", "input": {"args": args}}
    if confirm is not None:
        cmd["confirm"] = confirm
    r = svc.run(cmd, ["*"], by, audience)
    got = next((d for d in r.get("delivered") or [] if d.get("ok")), None)
    if not r.get("ok") or got is None:
        return {"ok": False, "code": str(r.get("code") or "unavailable"), "message": str(r.get("message") or (r.get("delivered") or [{}])[0].get("message") or "no console answered")}
    return {"ok": True, "result": got.get("result"), "message": got.get("message", "")}


def _plugin(ref: str) -> tuple[str, Path, dict[str, Any]] | None:
    low = ref.lower().removeprefix("plugin:")
    for pj in sorted(PLUGINS_DIR.glob("*/plugin.json")):
        try:
            m = json.loads(pj.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        pid = str(m.get("id") or "")
        if low in (pid.lower(), pj.parent.name.lower(), pid.rsplit(".", 1)[-1].lower(), str(m.get("name") or "").lower()):
            return pid, pj.parent, m
    return None


def plugin_manifests() -> list[tuple[Path, dict[str, Any]]]:
    out = []
    for pj in sorted(PLUGINS_DIR.glob("*/plugin.json")):
        try:
            out.append((pj.parent, json.loads(pj.read_text(encoding="utf-8"))))
        except (OSError, ValueError):
            continue
    return out


def plugin_slug(pid: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", pid.lower()).strip("-")[:40]
    return s or "plugin"


def offline_interface(owner: str) -> dict[str, Any] | None:
    """The interface without a console: the plugin's own settings/plugin-<slug> asset file (or that it has none yet)."""
    if owner in ("console", "app"):
        return {"$axf": "settings-interface@1", "owner": "app", "id": "console", "source": "asset", "opens": "view:settings", "live": False}
    p = _plugin(owner)
    if p is None:
        return None
    pid, folder, m = p
    sid = f"plugin-{plugin_slug(pid)}"
    f = folder / "assets" / "settings" / f"{sid}.json"
    data = None
    if f.exists():
        try:
            data = json.loads(f.read_text(encoding="utf-8")).get("data")
        except (OSError, ValueError):
            data = None
    return {"$axf": "settings-interface@1", "owner": f"plugin:{pid}", "folder": folder.name, "id": sid, "source": "asset" if data else "generated",
            "interface": data, "settingsInterface": m.get("settingsInterface"), "opens": f"settings:plugin/{pid}", "live": False}


def get_interface(owner: str, by: str, audience: str = OWNER) -> tuple[int, dict[str, Any]]:
    o = scope_of(owner)
    if o is None:
        return 400, {"ok": False, "code": "invalid", "message": "owner must be console or a plugin id"}
    if o.startswith("plugin:") and _plugin(o) is None:
        return 404, {"ok": False, "code": "not_found", "message": f"no plugin {owner}"}
    if o.startswith("plugin:"):
        o = f"plugin:{_plugin(o)[0]}"  # type: ignore[index]
    r = ask_console("settings.interface", [o], by, audience)
    if r["ok"] and isinstance(r.get("result"), dict):
        return 200, {"ok": True, **r["result"], "live": True}
    off = offline_interface(o)
    return 200, {"ok": True, **(off or {}), "consoleMessage": r.get("message")}


def reset(b: dict[str, Any], by: str, audience: str = OWNER) -> tuple[int, dict[str, Any]]:
    errors = request_errors(b)
    if errors:
        return 400, {"ok": False, "code": "invalid", "message": "; ".join(errors), "errors": errors}
    scope = scope_of(b.get("scope", "console")) or "console"
    if scope.startswith("plugin:"):
        p = _plugin(scope)
        if p is None:
            return 404, {"ok": False, "code": "not_found", "message": f"no plugin {scope[7:]}"}
        scope = f"plugin:{p[0]}"
    assets = b.get("includeAssets") is True
    plan = ask_console("settings.reset.plan", [scope, "assets" if assets else ""], by, audience)
    if not plan["ok"]:
        return 503, {"ok": False, "code": "unavailable", "message": f"no open console could plan the reset: {plan['message']}"}
    if b.get("dryRun") is True or not confirm_valid(b.get("confirm"), scope, assets):
        body = {"ok": b.get("dryRun") is True, "dryRun": True, "scope": scope, "includeAssets": assets, "plan": plan.get("result"),
                "confirm": confirm_token(scope, assets), "ttlS": CONFIRM_TTL_S}
        if b.get("dryRun") is True:
            return 200, body
        return 428, {**body, "code": "confirmation_required", "message": "a reset clears settings; show the plan, then send the same request with this confirm token"}
    # destructive: the console's own guard wants its confirm too; this token already proved the caller confirmed
    run = ask_console("settings.reset", [scope, "assets" if assets else ""], by, audience, confirm=_console_confirm(scope, assets, by, audience))
    return (200 if run["ok"] else 502), {"ok": run["ok"], "scope": scope, "includeAssets": assets, "plan": plan.get("result"), "message": run["message"], "undo": "settings.reset.undo"}


def _console_confirm(scope: str, assets: bool, by: str, audience: str) -> Any:
    """The console relay's own confirm token for settings.reset (it answers confirmation_required with one)."""
    svc = _commands()
    if svc is None:
        return None
    first = svc.run({"$axf": "control@1", "target": "console.actions", "op": "act", "path": "settings.reset", "action": "run", "input": {"args": [scope, "assets" if assets else ""]}}, ["*"], by, audience)
    return (first.get("data") or {}).get("confirm") or first.get("confirm")


def _who(request: Request) -> tuple[str, str]:
    user = getattr(request.state, "axf_user", None)
    if user is None:
        return OWNER, "console"
    name = str(getattr(user, "name", "") or "console")
    return (OWNER if getattr(user, "admin", False) else f"user:{name}"), name


def router_for(auth: Any) -> APIRouter:
    r = APIRouter(prefix="/api/settings", dependencies=[Depends(auth)])

    @r.get("/interfaces/{owner}")
    async def interface(request: Request, owner: str) -> JSONResponse:
        audience, name = _who(request)
        status, body = await run_in_threadpool(get_interface, owner, name, audience)
        return JSONResponse(body, status_code=status)

    @r.post("/reset")
    async def reset_route(request: Request) -> JSONResponse:
        try:
            b = await request.json()
        except Exception:  # noqa: BLE001
            b = {}
        if not isinstance(b, dict):
            b = {}
        audience, name = _who(request)
        status, body = await run_in_threadpool(reset, b, str(b.get("by") or name)[:80], audience)
        return JSONResponse(body, status_code=status)

    return r
