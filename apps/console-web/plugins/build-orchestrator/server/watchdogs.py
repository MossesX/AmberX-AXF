"""The build watchdog (build-watchdogs@1) on the console: its routes under /watchdogs and its systems check item.

One watchdog (watchdog.mjs, cron axf-build-watchdog on the VPS host, every minute) hosts every watch: build sessions that
are stuck or were killed, builds standing in one status too long, rows left on a list after their PR merged. This module
is the console's side of all of them at once; every route runs the same CLI that MCP (the watchdogs-* plugin commands),
`axf watchdog …` and the voice actions run.

  GET  /watchdogs                 watchdogs-status@1: on/off, the cron, the last pass, every watch, what was caught lately
  GET  /watchdogs/caught          what was caught, newest first (?watch=&build=&limit=)
  GET  /watchdogs/scan            dry run: what each watch would catch now (?watch=)
  POST /watchdogs/run             one pass now ({watch?, build?}); from the console container the host's cron runs it
  GET  /watchdogs/settings        every setting in one flat map: enabled, alerts, <watch>.<key>, with its schema
  PUT  /watchdogs/settings        change settings ({key: value}); each is checked, unknown keys are refused

Systems check (axf.health@1): build-watchdogs, "Build watchdog runs": red when the watchdog is on and no pass ran for
5 minutes (the cron is gone or failing), amber when a watch cannot load or its last run failed. Auto fix reinstalls the
cron and runs one pass on the VPS (axHub vps.run).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Request

import plugin_services

HERE = Path(__file__).resolve().parent.parent
CLI = HERE / "watchdog.mjs"
ROOT = HERE.parents[2]
HEALTH_CAP = "axf.health@1"
HEALTH_ID = "build-watchdogs"
LINK = "build-orchestrator.focus:watchdog"
HOST_DIR = os.environ.get("AXF_WATCHDOG_HOST_DIR", "/opt/axf")  # the console's checkout on the VPS host
FIX_COMMAND = (f"cd {HOST_DIR} && node apps/console-web/plugins/build-orchestrator/watchdog.mjs install-cron --force"
               " && node apps/console-web/plugins/build-orchestrator/watchdog.mjs run --force --by autofix")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,119}$")
WATCH_RE = re.compile(r"^[a-z][a-z0-9-]{1,30}$")


def on_host() -> bool:
    """True when this process can run passes itself (the VPS host), False in the console container."""
    return os.environ.get("AXF_WATCHDOG_HOST") != "request"


def cli(*args: str, timeout: int = 120, actor: str = "") -> Any:
    """watchdog.mjs <args> --json → the parsed answer, or an HTTPException with the CLI's own words (exit 2 → 400)."""
    env = {**os.environ, "AXF_WATCHDOG_IN_CONSOLE": "1"}
    if actor:
        env["AXF_ACTOR"] = actor
    try:
        p = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=timeout, env=env)
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "the watchdog took too long") from None
    except OSError as e:
        raise HTTPException(500, str(e)[:300]) from None
    try:
        return json.loads(p.stdout)
    except json.JSONDecodeError:
        msg = (p.stderr or p.stdout or "no output").strip()[-400:]
        raise HTTPException(400 if p.returncode == 2 else 500, msg) from None


def health_probe(status: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        s = status if status is not None else cli("status", timeout=30)
    except HTTPException as e:
        return {"status": "unknown", "summary": f"Couldn't read the build watchdog's status: {str(e.detail)[:200]}"}
    if not s.get("enabled", True):
        return {"status": "warn", "summary": "The build watchdog is switched off: stuck sessions, stuck statuses and left-over rows stay until someone notices.",
                "details": ["Settings → Plugins → Build orchestrator → Watchdog: switch it on."]}
    age = s.get("ageMin")
    watches = s.get("watches") or []
    details = [f"Last pass {s.get('lastPass') or 'never'}" + (f" ({age} min ago)" if age is not None else "") + f", {s.get('passes', 0)} passes."]
    details += [f"{w.get('label') or w.get('id')}: {'on' if w.get('enabled') else 'off'}, last run {w.get('lastRun') or 'never'}, caught {w.get('caught', 0)}" for w in watches]
    if s.get("stale"):
        return {"status": "error", "summary": "The build watchdog hasn't run " + (f"for {age} min" if age is not None else "yet") + ": nothing recovers stuck sessions or pushes stuck builds.",
                "details": details + [f"On the VPS: {FIX_COMMAND}"]}
    broken = [w for w in watches if w.get("available") is False or (w.get("enabled") and w.get("lastError"))]
    if broken:
        return {"status": "warn", "summary": "The build watchdog runs, but " + ", ".join(f"{w.get('label') or w.get('id')} failed ({str(w.get('error') or w.get('lastError'))[:120]})" for w in broken) + ".",
                "details": details}
    off = [w.get("label") or w.get("id") for w in watches if not w.get("enabled")]
    caught = len(s.get("caught") or [])
    return {"status": "ok", "summary": f"Ran {age} min ago: {len(watches) - len(off)} of {len(watches)} watches on, {caught} caught lately." + (f" Off: {', '.join(off)}." if off else ""), "details": details}


def autofix(vps: Callable[[str], Any] | None) -> dict[str, Any]:
    """Reinstall the cron and run one pass: on the VPS through the registry's runner, directly when this is the host."""
    if on_host():
        try:
            cli("install-cron", "--force", timeout=30)
            r = cli("run", "--force", "--by", "autofix", timeout=600)
            return {"state": "done", "message": f"Cron reinstalled and one pass run: {len(r.get('catches') or [])} caught."}
        except HTTPException as e:
            return {"state": "failed", "message": str(e.detail)[:300]}
    if callable(vps):
        return vps(FIX_COMMAND)
    try:
        cli("request", "--by", "systems-check", timeout=30)  # axf-not-plugin:systems-check (actor name)
    except HTTPException:
        pass
    return {"state": "failed", "message": f"Can't reach the VPS from here (no axHub vps.run). Run on the VPS: {FIX_COMMAND}"}


_health_done = False


def ensure_health(owner: str) -> bool:
    """Register the item once the systems check provides axf.health@1 (plugins load in any order)."""
    global _health_done
    if _health_done:
        return True
    reg = plugin_services.get(HEALTH_CAP)
    if reg is None:
        return False
    vps = getattr(reg, "vps_run", None)
    try:
        reg.register({"id": HEALTH_ID, "label": "Build watchdog runs", "service": "vps", "order": 56, "severity": "error", "interval": 180,
                      "run": lambda: health_probe(),
                      "breaks": "Stuck or killed build sessions are not recovered, builds standing in landing or fixing are not pushed on, and rows whose PR merged stay on their lists.",
                      "fix": {"type": "action", "label": "Reinstall the cron and run a pass"},
                      "autoFix": {"label": "Reinstall the build watchdog cron and run one pass", "run": lambda: autofix(vps)},
                      "links": [{"label": "Watchdog", "url": LINK}],
                      "instructions": [f"On the VPS: {FIX_COMMAND}", "Settings → Plugins → Build orchestrator → Watchdog shows every watch, its settings and what it caught."]}, owner)
    except Exception:  # noqa: BLE001 — the watchdog works without its health item
        return False
    _health_done = True
    return True


async def _json(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 — an empty body is an empty patch
        return {}
    return body if isinstance(body, dict) else {}


def _watch(v: Any) -> str:
    w = str(v or "").strip()
    if w and not WATCH_RE.match(w):
        raise HTTPException(400, "bad watch id")
    return w


def _build(v: Any) -> str:
    b = str(v or "").strip()
    if b and not ID_RE.match(b):
        raise HTTPException(400, "bad build id")
    return b


def router_for(owner: str, actor: Callable[[Request], str]) -> APIRouter:
    r = APIRouter()

    def by_of(request: Request) -> str:
        who = actor(request)
        return f"console:{who}" if who else "api"

    @r.get("/watchdogs")
    def watchdogs_status() -> dict[str, Any]:
        ensure_health(owner)
        return {**cli("status", timeout=30), "host": on_host()}

    @r.get("/watchdogs/caught")
    def watchdogs_caught(watch: str = "", build: str = "", limit: int = 100) -> dict[str, Any]:
        args = ["caught", "--limit", str(max(1, min(int(limit), 1000)))]
        if _watch(watch):
            args += ["--watch", _watch(watch)]
        if _build(build):
            args += ["--build", _build(build)]
        return cli(*args, timeout=30)

    @r.get("/watchdogs/scan")
    def watchdogs_scan(watch: str = "") -> dict[str, Any]:
        if not on_host():
            st = cli("status", timeout=30)
            return {"ok": True, "source": "host-last-pass", "at": st.get("lastPass") or "", "watches": st.get("watches") or [], "items": [],
                    "note": "The console can't see the VPS's sessions: this is what the host's last pass saw. Run a pass to act on it."}
        return {**cli("scan", *(["--watch", _watch(watch)] if _watch(watch) else []), timeout=300), "ok": True, "source": "live"}

    @r.post("/watchdogs/run")
    async def watchdogs_run(request: Request) -> dict[str, Any]:
        body = await _json(request)
        watch, build, who = _watch(body.get("watch")), _build(body.get("build")), by_of(request)
        extra = [*(["--watch", watch] if watch else []), *(["--build", build] if build else [])]
        if not on_host():
            return {"ok": True, "requested": True, **cli("request", "--by", who, *extra, timeout=30, actor=who)}
        return {"ok": True, "requested": False, **cli("run", "--force", "--by", who, *extra, timeout=600, actor=who)}

    @r.get("/watchdogs/settings")
    def watchdogs_settings() -> dict[str, Any]:
        return cli("settings", timeout=30)

    @r.put("/watchdogs/settings")
    async def watchdogs_settings_set(request: Request) -> dict[str, Any]:
        body = await _json(request)
        if not body:
            raise HTTPException(400, "send {setting: value, ...} (GET watchdogs/settings lists them)")
        who = by_of(request)
        return {"ok": True, **cli("set", "--patch", json.dumps(body), "--by", who, timeout=30, actor=who)}

    return r
