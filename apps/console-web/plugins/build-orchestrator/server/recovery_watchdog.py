"""Build watchdog (build-watchdog@1) on the console: its systems check items and the calls the routes make.

Brett, Nov 13 2026: "if anything stops working, the server/orchestrator fixes it automatically with no one asking ...
Never wait for Brett to notice." The watchdog itself runs on the VPS host (watchdog.mjs, cron axf-watchdog every
minute). The console only reads what the host wrote (build-watchdog.json in the pipeline folder: last pass, last scan,
recent fixes) and hands passes it is asked for to the host (AXF_WATCHDOG_HOST=request: the next cron minute runs them).

Systems check (axf.health@1):
  build-watchdog          "Build watchdog": red when the watchdog is on and its last pass is older than 3 minutes (the cron
                          is gone or failing). Auto fix (on by default): reinstall the cron and run one pass, on the VPS
                          through axHub vps.run as a veto call (directly when the console runs on the host).
  build-watchdog-gave-up  "Builds the watchdog gave up on": red while a build it gave up on (past Max retries, or every
                          account tried) waits in Pending. Fix (requeue, ask first: Brett decides) puts them back in the
                          Queue with a fresh retry count.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

import plugin_services

HERE = Path(__file__).resolve().parent
WATCHDOG = HERE.parent / "recovery-watchdog.mjs"
ROOT = WATCHDOG.parents[3]
FOLDER = WATCHDOG.parent.name
HEALTH_CAP = "axf.health@1"
CHECK_ID = "build-watchdog"
GAVE_UP_ID = "build-watchdog-gave-up"
HOST_DIR = os.environ.get("AXF_WATCHDOG_HOST_DIR", "/opt/axf")  # the console's checkout on the VPS host


def run_cli(*args: str, timeout: int = 120, actor: str = "") -> dict[str, Any]:
    """watchdog.mjs <args> --json → its JSON (or {ok: False, error})."""
    env = dict(os.environ)
    if actor:
        env["AXF_ACTOR"] = actor
    try:
        proc = subprocess.run(["node", str(WATCHDOG), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=timeout, env=env)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "error": str(e)[:300]}
    try:
        res = json.loads(proc.stdout) if proc.stdout.strip() else {"ok": False, "error": (proc.stderr.strip() or "no output")[-400:]}
    except json.JSONDecodeError:
        res = {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-400:]}
    if isinstance(res, dict) and "ok" not in res:
        res["ok"] = proc.returncode == 0
    return res


def on_host() -> bool:
    """True when this process can run passes itself (the VPS host), False in the console container."""
    return os.environ.get("AXF_WATCHDOG_HOST") != "request"


def health_probe(st: dict[str, Any] | None = None) -> dict[str, Any]:
    s = st if st is not None else run_cli("status")
    if not s.get("ok", True) and "settings" not in s:
        return {"status": "unknown", "summary": f"Couldn't read the watchdog's status: {s.get('error', '?')}"}
    settings = s.get("settings") or {}
    if not settings.get("enabled", True):
        return {"status": "warn", "summary": "The build watchdog is switched off: builds marked running with no live session stay stuck until someone notices.",
                "details": ["Settings → Plugins → Build orchestrator → Watchdog: switch it on."]}
    age = f" ({s['ageMin']} min ago)" if s.get("ageMin") is not None else ""
    details = [f"Last pass {s.get('lastPass') or 'never'}{age}, {s.get('passes', 0)} passes; cron {'installed' if (s.get('cron') or {}).get('installed') else 'not seen from here'}."]
    if s.get("stale"):
        return {"status": "error", "summary": f"The build watchdog hasn't run {'for ' + str(s.get('ageMin')) + ' min' if s.get('ageMin') is not None else 'yet'}: killed or failed builds stay marked running and nobody requeues them.",
                "details": details + ["On the VPS: `node /opt/axf/apps/console-web/plugins/build-orchestrator/recovery-watchdog.mjs install-cron --dir /opt/axf`, then `… watchdog.mjs run`."]}
    scan = s.get("lastScan") or {}
    stuck = [b for b in scan.get("builds", []) if b.get("stuck")]
    return {"status": "ok", "summary": f"Watchdog ran {s.get('ageMin')} min ago: {len(scan.get('builds', []))} running, {len(stuck)} stuck, {len(s.get('recent') or [])} recent fixes.", "details": details}


def gave_up_probe(st: dict[str, Any] | None = None) -> dict[str, Any]:
    s = st if st is not None else run_cli("status")
    gave = s.get("gaveUp") or []
    if not gave:
        return {"status": "ok", "summary": "No build is waiting on you after the watchdog gave up."}
    return {"status": "error", "summary": f"The watchdog gave up on {len(gave)} build{'s' if len(gave) != 1 else ''}: {', '.join(g['id'] for g in gave[:4])}{'…' if len(gave) > 4 else ''}. They sit in Pending until requeued.",
            "details": [f"{g['id']}: {g.get('note') or g.get('cause')} (since {g.get('at')})" for g in gave[:10]]
            + ["Fix (requeue) puts them back in the Queue with a fresh retry count; or open Build orchestrator → Watchdog."],
            "link": "build-orchestrator.focus:watchdog"}


def _reinstall(reg: Any) -> dict[str, Any]:
    if on_host():
        a = run_cli("install-cron", "--dir", str(ROOT))
        b = run_cli("run", timeout=300)
        ok = a.get("ok") and b.get("ok", True) is not False
        return {"state": "done" if ok else "failed", "message": "Cron reinstalled and one pass run." if ok else f"Failed: {a.get('error') or b.get('error') or '?'}"}
    w = f"{HOST_DIR}/apps/console-web/plugins/build-orchestrator/recovery-watchdog.mjs"
    cmd = f"cd {HOST_DIR} && node {w} install-cron --dir {HOST_DIR} && node {w} run"
    if getattr(reg, "vps_run", None):
        return reg.vps_run(cmd)
    run_cli("request", actor="systems-check")  # axf-not-plugin:systems-check (actor name)
    return {"state": "failed", "message": f"Can't reach the VPS from here (no axHub vps.run). Run on the VPS: {cmd}"}


def _requeue() -> dict[str, Any]:
    r = run_cli("requeue", actor="systems-check")  # axf-not-plugin:systems-check (actor name)
    if not r.get("ok"):
        return {"state": "failed", "message": str(r.get("error") or r.get("failed") or "requeue failed")[:300]}
    return {"state": "done", "message": f"Back in the Queue: {', '.join(r.get('requeued') or []) or 'nothing to requeue'}."}


_done = False


def ensure_health() -> bool:
    """Register both items once the systems check provides axf.health@1 (plugins load in any order)."""
    global _done
    if _done:
        return True
    reg = plugin_services.get(HEALTH_CAP)
    if reg is None:
        return False
    try:
        reg.register({"id": CHECK_ID, "label": "Build watchdog", "service": "vps", "order": 57, "severity": "error", "interval": 120,
                      "run": lambda: health_probe(),
                      "breaks": "Builds killed (exit 143) or failed (exit 1) stay marked running, their slots stay taken and nothing requeues or retries them.",
                      "fix": {"type": "action", "label": "Reinstall the cron and run a pass"},
                      "autoFix": {"label": "Reinstall the watchdog cron and run one pass", "run": lambda: _reinstall(reg)},
                      "links": [{"label": "Watchdog", "url": "build-orchestrator.focus:watchdog"}],
                      "instructions": ["On the VPS: `node /opt/axf/apps/console-web/plugins/build-orchestrator/recovery-watchdog.mjs status`.",
                                       "Settings → Plugins → Build orchestrator → Watchdog: on/off, interval, retries."]}, FOLDER)
        reg.register({"id": GAVE_UP_ID, "label": "Builds the watchdog gave up on", "service": "console", "order": 58, "severity": "error", "interval": 120,
                      "run": lambda: gave_up_probe(),
                      "breaks": "These builds stopped after repeated crashes (or every Claude account was tried) and wait in Pending for you.",
                      "fix": {"type": "action", "label": "Requeue"},
                      "autoFix": {"label": "Requeue them with a fresh retry count", "run": _requeue, "mode": "ask"},
                      "links": [{"label": "Watchdog", "url": "build-orchestrator.focus:watchdog"}],
                      "instructions": ["Requeue puts each back in the Queue; the watchdog counts its retries from zero again.",
                                       "Read the build's recoveries first (Build orchestrator → the build → Recoveries) if it keeps failing on the same step."]}, FOLDER)
    except Exception:  # noqa: BLE001 — the orchestrator works without its health items
        return False
    _done = True
    return True
