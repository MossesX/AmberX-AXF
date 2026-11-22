"""Stale-row watchdog: REST routes and the systems check item (stale-row@1).

Brett, Nov 16 2026: "I want a server fucking watchdog on the VPS to do that." The watchdog itself is watchdog.mjs
(cron axf-build-watchdog on the VPS host, every minute, each watch when due); this module is the console's side of it, and every route
runs the same CLI the MCP tools (plugin-commands), `axf watchdog` and the voice actions run:

    GET  /api/plugins/build-orchestrator/watchdog            status: settings, last run, last runs, the cleanup log
    GET  /api/plugins/build-orchestrator/watchdog/log        the cleanup log (?limit, ?kind, ?action, ?build)
    POST /api/plugins/build-orchestrator/watchdog/run        run now (applies; body {force?})
    POST /api/plugins/build-orchestrator/watchdog/dry-run    decide only, change nothing: the plan
    PUT  /api/plugins/build-orchestrator/watchdog/settings   change settings ({key: value, ...})

Health (axf.health@1): red when the last run failed or is older than 3 intervals while the watchdog is on, with an
Auto fix that reinstalls the cron on the VPS and reruns the watchdog.
"""
from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Request

import plugin_services

HERE = Path(__file__).resolve().parent.parent
CLI = HERE / "watchdog" / "rows.mjs"
ROOT = HERE.parents[2]
HEALTH_CAP = "axf.health@1"
HEALTH_ID = "orchestrator-watchdog"
SETTINGS_SCHEMA = json.loads((HERE / "watchdog" / "settings.json").read_text())["settings"]
LOG_KINDS = {"pending", "queued", "building", "merge-queue", "ui-review"}  # axf-not-plugin:ui-review (the stale-row@1 row kind)
LOG_ACTIONS = {"keep", "complete", "remove"}
FIX_COMMAND = ("cd /opt/axf && node apps/console-web/plugins/build-orchestrator/watchdog.mjs install-cron --force"
               " && node apps/console-web/plugins/build-orchestrator/watchdog.mjs run --force --by autofix")


def cli(*args: str, timeout: int = 300) -> Any:
    """Run watchdog.mjs with --json; the parsed answer, or an HTTPException with the CLI's own words."""
    env = {**os.environ, "AXF_WATCHDOG_IN_CONSOLE": "1"}
    try:
        p = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=timeout, env=env)
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "the watchdog took too long") from None
    try:
        return json.loads(p.stdout)
    except json.JSONDecodeError:
        msg = (p.stderr or p.stdout or "no output").strip()[-400:]
        raise HTTPException(400 if p.returncode == 2 else 500, msg) from None


def _age_min(iso: str) -> float:
    try:
        return (datetime.now(timezone.utc) - datetime.fromisoformat(iso.replace("Z", "+00:00"))).total_seconds() / 60
    except (ValueError, AttributeError):
        return float("inf")


def health_probe(status: dict[str, Any] | None = None) -> dict[str, Any]:
    """Red: the watchdog is on and its last run failed, or no run for 3 intervals. Off = ok (says so)."""
    try:
        st = status if status is not None else cli("status", timeout=30)
    except HTTPException as e:
        return {"status": "error", "summary": f"The watchdog's status can't be read: {e.detail}", "details": []}
    s = st.get("settings") or {}
    last = st.get("last") or {}
    every = int(s.get("intervalMin") or 5)
    if not s.get("enabled", True):
        return {"status": "ok", "summary": "The stale-row watchdog is off (Settings → Plugins → Build orchestrator → Watchdog).", "details": []}
    if not last:
        return {"status": "error", "summary": "The stale-row watchdog has never run on the VPS: stale rows stay on the builds lists.",
                "details": ["Cron axf-build-watchdog runs it every minute, each watch when due; Auto fix installs it and runs it once."]}
    age = _age_min(str(last.get("at") or ""))
    if not last.get("ok"):
        return {"status": "error", "summary": f"The stale-row watchdog's last run failed ({str(last.get('error') or '?')[:160]}).",
                "details": [f"Last run {last.get('at')}", "Auto fix reruns it; `node apps/console-web/plugins/build-orchestrator/watchdog.mjs run` on the VPS shows the error."]}
    if age > 3 * every:
        return {"status": "error", "summary": f"The stale-row watchdog hasn't run for {int(age)} min (every {every} min): stale rows pile up again.",
                "details": [f"Last run {last.get('at')}", "The cron axf-build-watchdog is missing or failing on the VPS; Auto fix reinstalls it and runs it once."]}
    return {"status": "ok", "summary": f"The stale-row watchdog ran {int(age)} min ago: {last.get('cleaned', 0)} cleaned, {last.get('planned', 0)} found.", "details": []}


def autofix(vps: Callable[[str], Any] | None) -> dict[str, Any]:
    """Reinstall the cron on the host (through the registry's VPS runner when there is one) and rerun the watchdog."""
    if callable(vps):
        return vps(FIX_COMMAND)
    try:
        r = cli("run", "--force", "--by", "autofix")
        return {"state": "done" if r.get("ok") else "failed", "message": "watchdog rerun in the console" + ("" if r.get("ok") else f": {r.get('error')}")}
    except HTTPException as e:
        return {"state": "failed", "message": str(e.detail)[:300]}


_health_done = False


def ensure_health(owner: str) -> bool:
    global _health_done
    if _health_done:
        return True
    reg = plugin_services.get(HEALTH_CAP)
    if reg is None:
        return False
    vps = getattr(reg, "vps_run", None)
    try:
        reg.register({"id": HEALTH_ID, "label": "Stale-row watchdog runs", "service": "console", "order": 57, "severity": "error",
                      "run": lambda: health_probe(), "interval": 300,
                      "breaks": "Builds whose PR merged or closed stay in Pending / Queue / Building, the merge queue and UI Review.",
                      "instructions": [f"On the VPS: {FIX_COMMAND}", "Settings → Plugins → Build orchestrator → Watchdog shows the last runs and the Cleanups log."],
                      "autoFix": {"label": "Reinstall the watchdog cron and run it", "run": lambda: autofix(vps)}}, owner)
    except Exception:  # noqa: BLE001 — the watchdog works without its health item
        return False
    _health_done = True
    return True


def _settings_patch(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict) or not body:
        raise HTTPException(400, "send {setting: value, ...}")
    out = {}
    for k, v in body.items():
        if k not in SETTINGS_SCHEMA:
            raise HTTPException(400, f"no watchdog setting {k!r}")
        out[k] = v
    return out


def router_for(owner: str, actor: Callable[[Request], str]) -> APIRouter:
    r = APIRouter()

    @r.get("/watchdog")
    def watchdog_status(log: int = 20) -> dict[str, Any]:
        ensure_health(owner)
        st = cli("status", timeout=30)
        st["log"] = cli("log", "--limit", str(max(0, min(int(log), 500))), timeout=30).get("records", []) if log else []
        return st

    @r.get("/watchdog/log")
    def watchdog_log(limit: int = 100, kind: str = "", action: str = "", build: str = "") -> dict[str, Any]:
        args = ["log", "--limit", str(max(1, min(int(limit), 2000)))]
        if kind:
            if kind not in LOG_KINDS:
                raise HTTPException(400, "bad kind")
            args += ["--kind", kind]
        if action:
            if action not in LOG_ACTIONS:
                raise HTTPException(400, "bad action")
            args += ["--action", action]
        if build:
            args += ["--build", build[:120]]
        return cli(*args, timeout=30)

    def by_of(request: Request) -> str:
        who = actor(request)
        return f"console:{who}" if who else "api"

    @r.post("/watchdog/run")
    async def watchdog_run(request: Request) -> dict[str, Any]:
        body = await _json(request)
        return cli("run", "--by", by_of(request), *(["--force"] if body.get("force") else []))

    @r.post("/watchdog/dry-run")
    def watchdog_dry_run(request: Request) -> dict[str, Any]:
        return cli("run", "--dry-run", "--force", "--by", by_of(request))

    @r.put("/watchdog/settings")
    async def watchdog_settings(request: Request) -> dict[str, Any]:
        patch = _settings_patch(await _json(request))
        out: dict[str, Any] = {}
        for k, v in patch.items():
            out = cli("set", k, json.dumps(v) if not isinstance(v, str) else v, "--by", by_of(request), timeout=30)
        return {"ok": True, "settings": out}

    return r


async def _json(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > 64 * 1024:
        raise HTTPException(413, "body too large")
    if not raw.strip():
        return {}
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(400, "body is not JSON") from None
    return d if isinstance(d, dict) else {}
