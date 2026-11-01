"""Server part of the agent cap (agent-slots@1). Mounted at /api/plugins/agent-slots/.

The console adds the console-token check (every method) and the 404 while disabled. Every read and change goes through
framework/cli/agent-slots.mjs, so the VPS launcher (deploy/claude-headless.sh), the swarm and the console share one store
and one set of rules (the store is in the hub's shared data, mounted in this container at /projects). Nothing here
starts a session: the queue starts itself on the VPS when a slot frees.

Routes: GET status · GET/PUT settings · POST queue/{id}/up · POST queue/{id}/cancel.
Capability axf.agent-slots@1: status() for other plugins. Registers the systems-check item `agent-slots-memory` on
axf.health@1 (memory guard tripping often, swap in use for long).
"""
from __future__ import annotations

import json
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import plugin_services

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
SELF = "axf.agent-slots@1"
HEALTH_CAP = "axf.health@1"
HEALTH_ID = "agent-slots-memory"
ROOT = Path(__file__).resolve().parents[5]  # the repo root (/axf in the console image)
CLI = ROOT / "framework" / "cli" / "agent-slots.mjs"
ID = re.compile(r"^[A-Za-z0-9-]{1,80}$")
SETTING_KEYS = {"maxAgents", "maxHeavy", "minFreeGb", "closeFinishedAfterSec", "pollSec", "priorityRules", "guardWarnTrips", "swapWarnMb", "swapWarnMin"}
CACHE_S = 3
_cache: dict[str, Any] = {"at": 0.0, "value": None}
_lock = threading.Lock()


def _run(*args: str, timeout: int = 20) -> tuple[int, str, str]:
    p = subprocess.run(["node", str(CLI), *args], cwd=str(ROOT), capture_output=True, text=True, timeout=timeout)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def status(fresh: bool = False) -> dict[str, Any]:
    """The cap, what holds a slot, the queue, the heavy lock, memory (cached 3 s: the banner polls every 4 s)."""
    with _lock:
        if not fresh and _cache["value"] is not None and time.time() - _cache["at"] < CACHE_S:
            return _cache["value"]
        try:
            code, out, err = _run("status", "--json", "--no-sweep")
            value = json.loads(out) if code == 0 and out else {"error": (err or "no answer")[-400:]}
        except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
            value = {"error": f"{type(e).__name__}: {e}"[:400]}
        _cache.update(at=time.time(), value=value)
        return value


def health_probe(s: dict[str, Any] | None = None, now_ms: float | None = None) -> dict[str, Any]:
    """Systems check: warn when the memory guard held starts often in the last hour, or swap stayed in use for long."""
    s = s if s is not None else status(fresh=True)
    if s.get("error"):
        return {"status": "unknown", "summary": f"Couldn't read the agent cap: {s['error']}", "details": [], "unreachable": True}
    cfg = s.get("settings") or {}
    now_ms = now_ms if now_ms is not None else time.time() * 1000
    trips = int((s.get("guard") or {}).get("tripsLastHour") or 0)
    since = (s.get("swap") or {}).get("since")
    swap_min = (now_ms - since) / 60000 if isinstance(since, (int, float)) else 0
    mem = s.get("memory") or {}
    details = [f"Slots {s.get('used', 0)}/{s.get('cap', '?')}, {s.get('queued', 0)} queued; {mem.get('availGb', '?')} GB free (floor {mem.get('floorGb', '?')} GB)."]
    problems = []
    if trips >= int(cfg.get("guardWarnTrips") or 5):
        problems.append(f"the memory guard held new sessions {trips} times in the last hour")
    if swap_min >= int(cfg.get("swapWarnMin") or 30):
        problems.append(f"swap has been in use for {int(swap_min)} min ({(s.get('swap') or {}).get('mb', 0)} MB)")
    if problems:
        return {"status": "warn", "summary": "The VPS is short of memory: " + "; ".join(problems) + ".", "details": details + [
            "Lower Max running agents or Max heavy steps (Settings → Plugins → Agent cap), or stop idle containers."]}
    return {"status": "ok", "summary": f"Memory fine: slots {s.get('used', 0)}/{s.get('cap', '?')}, {mem.get('availGb', '?')} GB free.", "details": details}


_health_done = False


def ensure_health() -> bool:
    """Registers the memory item on the systems check once it provides axf.health@1 (plugins load in any order)."""
    global _health_done
    if _health_done:
        return True
    reg = plugin_services.get(HEALTH_CAP)
    if reg is None:
        return False
    try:
        reg.register({"id": HEALTH_ID, "label": "VPS memory for headless agents", "service": "vps", "order": 60, "severity": "warn",
                      "run": lambda: health_probe(),
                      "breaks": "New headless sessions and builds wait in the queue while memory is short; running ones slow down in swap.",
                      "instructions": ["Settings → Plugins → Agent cap: lower Max running agents / Max heavy steps, or raise the memory floor.",
                                       "On the VPS: `node framework/cli/agent-slots.mjs status` shows what holds the slots."]}, FOLDER)
    except Exception:  # noqa: BLE001 — the cap works without its health item
        return False
    _health_done = True
    return True


@router.get("/status")
def get_status() -> dict[str, Any]:
    ensure_health()
    return status()


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    code, out, err = _run("settings", "--json")
    if code != 0:
        raise HTTPException(500, err[-400:] or "couldn't read the settings")
    return json.loads(out)


@router.put("/settings")
async def put_settings(request: Request) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "send a JSON object")
    patch = {k: v for k, v in body.items() if k in SETTING_KEYS}
    if not patch:
        raise HTTPException(400, f"nothing to save (keys: {', '.join(sorted(SETTING_KEYS))})")
    code, out, err = _run("set", "--json", json.dumps(patch))
    if code != 0:
        raise HTTPException(400, err[-400:] or "refused")
    _cache["value"] = None
    return json.loads(out.splitlines()[-1])


def _queue_action(action: str, qid: str) -> dict[str, Any]:
    if not ID.match(qid):
        raise HTTPException(400, "bad queue id")
    args = (action, qid, "--by", "console") if action == "cancel" else (action, qid)
    code, out, err = _run(*args)
    if code != 0:
        raise HTTPException(409, (err or out)[-400:].removeprefix("agent-slots: "))
    _cache["value"] = None
    return {"ok": True, "message": out, "status": status(fresh=True)}


@router.post("/queue/{qid}/up")
def queue_up(qid: str) -> dict[str, Any]:
    return _queue_action("up", qid)


@router.post("/queue/{qid}/cancel")
def queue_cancel(qid: str) -> dict[str, Any]:
    return _queue_action("cancel", qid)


class Service:
    """axf.agent-slots@1"""
    version = 1

    def status(self) -> dict[str, Any]:
        return status()


plugin_services.provide(SELF, Service(), FOLDER)
ensure_health()
