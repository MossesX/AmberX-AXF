"""Server part of VPS Settings (vps-settings@1). Mounted at /api/plugins/vps-settings/.

The console's view of the settings the VPS itself enforces (Brett, Nov 9 2026: "I need a console plugin to manage the VPS
settings."). Every read and change goes through framework/cli/vps-settings.mjs, so the host launchers
(deploy/claude-headless.sh, framework/cli/dispatch-gate.mjs, agent-slots) and the console share one store (the hub's shared
data, mounted here at /projects). The first setting is the orchestrator-only rule; the refused-jobs log sits beside it.

Routes: GET state · GET settings · PUT settings · GET refused · POST refused/clear.
Switching the orchestrator-only rule off is Brett's own click in the console (403 for a session, MCP or voice): a session
must not be able to switch off the guard that holds sessions back. On the VPS host, `vps-settings.mjs set` does it too.
A watcher raises a console alert (key vps-refused:<build>) for each refusal that sent a phone notice, which is what AmberX
shows on the phone. Capability axf.vps-settings@1: state() and settings() for other plugins.
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import console_context as cx
import plugin_services

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
SELF = "axf.vps-settings@1"
ROOT = Path(__file__).resolve().parents[5]  # the repo root (/axf in the console image)
CLI = ROOT / "framework" / "cli" / "vps-settings.mjs"
AGENT_HEADERS = ("x-axhub-session", "x-axhub-source")
OWNER_ONLY_OFF = {"orchestratorOnly"}  # settings that only Brett's own click may switch off
WATCH_S = 20


def _run(*args: str, timeout: int = 20) -> tuple[int, str, str]:
    p = subprocess.run(["node", str(CLI), *args], cwd=str(ROOT), capture_output=True, text=True, timeout=timeout)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def _json(*args: str) -> dict[str, Any]:
    try:
        code, out, err = _run(*args, "--json")
    except (OSError, subprocess.TimeoutExpired) as e:
        raise HTTPException(500, f"{type(e).__name__}: {e}"[:400]) from e
    if code == 2:
        raise HTTPException(400, err.removeprefix("vps-settings: ")[-400:] or "refused")
    if code != 0 or not out:
        raise HTTPException(500, (err or "no answer")[-400:])
    return json.loads(out.splitlines()[-1])


def brett_click(request: Request) -> str:
    """The signed-in hub admin's name when this request is Brett's own click in the console, else ''."""
    c = getattr(request.state, "axf_user", None)
    if c is None or getattr(c, "via", "token") != "session" or not getattr(c, "admin", False):
        return ""
    for h in AGENT_HEADERS:
        v = (request.headers.get(h) or "").strip()
        if v and v != "console":
            return ""
    return str(getattr(c, "name", "") or "")[:120]


def _who(request: Request) -> str:
    for h in AGENT_HEADERS:
        v = (request.headers.get(h) or "").strip()
        if v and v != "console":
            return v[:80]
    return brett_click(request) or "console"


def _off(v: Any) -> bool:
    return v is False or str(v).strip().lower() in ("false", "off", "0", "no")


def settings() -> dict[str, Any]:
    return _json("get")


def refused(limit: int = 50) -> list[dict[str, Any]]:
    return _json("refused", "--limit", str(max(1, min(1000, int(limit)))))["refused"]


def state() -> dict[str, Any]:
    """Everything the screen shows: the settings and the last 50 lines of the refused-jobs log, with counts."""
    s = settings()
    rows = refused(50)
    day = time.time() - 86400
    recent = [r for r in rows if r.get("outcome") == "refused" and _epoch(r.get("at")) >= day]
    return {"ok": True, "settings": s["settings"], "values": s["values"], "refused": rows,
            "counts": {"refused24h": len(recent), "shown": len(rows)}, "deepLink": f"settings:{FOLDER}"}


def _epoch(iso: Any) -> float:
    try:
        from datetime import datetime
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


@router.get("/state")
def get_state() -> dict[str, Any]:
    return state()


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return settings()


@router.put("/settings")
async def put_settings(request: Request) -> dict[str, Any]:
    """{key: value…}: orchestratorOnly, notifyRefused, notifyEveryMin, refusedLogMax. Switching orchestratorOnly off is
    Brett's own click (403 otherwise); turning it on is open to every caller."""
    try:
        body = await request.json()
    except ValueError as e:
        raise HTTPException(400, "send a JSON object") from e
    if not isinstance(body, dict) or not body:
        raise HTTPException(400, "send a JSON object of settings")
    for k in OWNER_ONLY_OFF:
        if k in body and _off(body[k]) and not brett_click(request):
            raise HTTPException(403, "switching the orchestrator-only rule off is Brett's own click in the console "
                                     "(or `node framework/cli/vps-settings.mjs set orchestratorOnly=off` on the VPS host)")
    pairs = [f"{k}={'true' if v is True else 'false' if v is False else v}" for k, v in body.items()]
    return _json("set", *pairs, "--by", _who(request))


@router.get("/refused")
def get_refused(limit: int = 50) -> dict[str, Any]:
    return {"ok": True, "refused": refused(limit)}


@router.post("/refused/clear")
def clear_refused(request: Request) -> dict[str, Any]:
    return _json("clear-refused", "--by", _who(request))


# ---------------- phone notice: a console alert per noticed refusal (AmberX shows console alerts)

_seen: set[str] = set()


def raise_alerts(rows: list[dict[str, Any]], raise_alert: Any = None) -> int:
    """New refusals that sent a phone notice → one console alert each (keyed per build, so repeats update it)."""
    raise_alert = raise_alert or cx.raise_alert
    n = 0
    for r in reversed(rows):
        rid = str(r.get("id") or "")
        if not rid or rid in _seen:
            continue
        _seen.add(rid)
        if r.get("outcome") != "refused" or not r.get("notified"):
            continue
        what = r.get("build") or r.get("name") or "a job"
        try:
            raise_alert({"source": "vps-settings", "severity": "warning", "title": f"VPS refused a job: {what}"[:160],
                         "body": str(r.get("why") or "")[:300] or None, "key": f"vps-refused:{what}", "link": f"settings:{FOLDER}"})
            n += 1
        except Exception:  # noqa: BLE001 — an alert never breaks the log
            pass
    return n


def _watch() -> None:
    try:  # what is already in the log at start is not new
        _seen.update(str(r.get("id") or "") for r in refused(200))
    except Exception:  # noqa: BLE001
        pass
    while True:
        time.sleep(WATCH_S)
        try:
            raise_alerts(refused(50))
        except Exception:  # noqa: BLE001 — try again next round
            pass


if os.environ.get("AXF_VPS_SETTINGS_WATCH", "on") != "off":
    threading.Thread(target=_watch, name="vps-settings-watch", daemon=True).start()


class Service:
    """axf.vps-settings@1"""
    version = 1

    def state(self) -> dict[str, Any]:
        return state()

    def settings(self) -> dict[str, Any]:
        return settings()


plugin_services.provide(SELF, Service(), FOLDER)
