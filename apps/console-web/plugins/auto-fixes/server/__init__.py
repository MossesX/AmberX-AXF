"""Auto-fixes plugin, server part. Mounted at /api/plugins/auto-fixes/ (console token on every route).

Every call that failed and is being fixed (retry-ladder@1, framework/core/retry-ladder.mjs): what failed, which fix on
the ladder it is trying now, attempts so far, and the ones that gave up after the whole ladder with what is missing.
The ledger is axf_server.retry's folder (one file per job), written by the console's MCP server, the builds store and
any other runner; this plugin only reads it, plus its own data folder.

  GET  state                       {display, count, retrying, gaveUp, rows[]}   (the banner, the widget and the view)
  GET  jobs/{id}                   one job with every attempt and its "Automatic fixes" log text
  GET  say                         {text}: the spoken answer to "what's failing"
  GET  settings · POST settings {display: banner|widget|off}   how it shows (live in every open console)
  POST dismiss {id}                hide a job that gave up

AmberX: each job gets one note in the AmberX list "Automatic fixes" (made on first use), rewritten as attempts come in;
a job that stops (gave up, or a permanent error nobody saw) gets one AmberX FYI note. Both go through capability
control@1 (amberx.items / amberx.lists). Jobs written by other processes are picked up by a sweep every 20 s.
Provides auto-fixes@1: changed(job), fyi(job) (the console's MCP server calls them as jobs move).
"""
from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import axf_framework  # noqa: F401 — framework/python on sys.path
import plugin_services
from axf_server import retry, storage

FOLDER = "auto-fixes"
ROOT = Path(__file__).resolve().parents[5]
DATA = Path(os.environ.get("AXF_AUTO_FIXES_DATA_DIR") or (ROOT / ".axf-console" / "plugins" / FOLDER))
LIST_NAME = "Automatic fixes"
DISPLAYS = ("banner", "widget", "off")
SWEEP_S = 20.0

router = APIRouter()
_lock = threading.RLock()


def _runner() -> retry.Runner:
    return retry.Runner(retry.default_dir())


def _settings() -> dict[str, Any]:
    s = storage.read_json(DATA / "settings.json", {})
    return {"display": s.get("display") if s.get("display") in DISPLAYS else "banner"}


def _sent() -> dict[str, Any]:
    return storage.read_json(DATA / "delivered.json", {"notes": {}, "fyi": {}, "list": ""})


def state() -> dict[str, Any]:
    return {"ok": True, **_settings(), **retry.view(_runner().jobs())}


def log_text(job: dict[str, Any]) -> str:
    lines = [f"{job['title']} [{job['status']}] {retry.step_text(job)}"]
    lines += [f"{a['n']}. {a['at'][:19].replace('T', ' ')} {retry.log_line(job, a)}{' → worked' if a.get('ok') else ''}" for a in job["attempts"]]
    if job.get("missing"):
        lines.append("Missing: " + "; ".join(job["missing"]))
    return "\n".join(lines)


def say() -> str:
    v = retry.view(_runner().jobs())
    if not v["count"]:
        return "Nothing is failing right now."
    open_rows = [r for r in v["rows"] if r["status"] in ("retrying", "gave-up")][:5]
    parts = [f"{r['title']}: {r['now']}" + (f", missing {'; '.join(r['missing'])}" if r["status"] == "gave-up" and r["missing"] else "") for r in open_rows]
    return f"{v['retrying']} call{'s' if v['retrying'] != 1 else ''} being fixed, {v['gaveUp']} gave up. " + ". ".join(parts) + "."


# ---------------------------------------------------------------------- AmberX delivery (control@1)

def _control(command: dict[str, Any]) -> dict[str, Any] | None:
    svc = plugin_services.get("control@1")
    if svc is None:
        return None
    r = svc.run(command, ["*"], "auto-fixes")
    return r if isinstance(r, dict) and r.get("ok", True) else None


def _list_id(sent: dict[str, Any]) -> str:
    if sent.get("list"):
        return str(sent["list"])
    r = _control({"op": "list", "target": "amberx.lists", "select": {"q": LIST_NAME}})
    hit = next((x for x in (r or {}).get("items", []) if x.get("name") == LIST_NAME), None)
    if hit is None:
        made = _control({"op": "add", "target": "amberx.lists", "value": {"name": LIST_NAME}})
        hit = (made or {}).get("item")
    sent["list"] = str((hit or {}).get("id") or "")
    return sent["list"]


def deliver(job: dict[str, Any]) -> None:
    """The job's "Automatic fixes" note (added or rewritten) and, once, its FYI. Never raises."""
    if not job.get("attempts") and not job.get("fyi"):
        return
    try:
        with _lock:
            sent = _sent()
            stamp = f"{job['status']}:{len(job['attempts'])}:{len(job.get('missing') or [])}"
            note = sent["notes"].get(job["id"]) or {}
            if note.get("stamp") != stamp and job.get("attempts"):
                lst = _list_id(sent)
                value = {"kind": "note", "title": f"Auto-fix: {job['title']}", "text": log_text(job), "tags": ["auto-fix"], **({"list": lst} if lst else {})}
                r = _control({"op": "set", "target": "amberx.items", "path": note["id"], "value": {"text": value["text"]}}) if note.get("id") else None
                if r is None:
                    r = _control({"op": "add", "target": "amberx.items", "value": value})
                if r is not None:
                    sent["notes"][job["id"]] = {"id": (r.get("item") or {}).get("id", note.get("id", "")), "stamp": stamp}
            if job.get("fyi") and job["id"] not in sent["fyi"] and job["status"] in ("gave-up", "failed"):
                r = _control({"op": "add", "target": "amberx.items", "value": {"kind": "note", "title": f"FYI: {job['title']} {'gave up' if job['status'] == 'gave-up' else 'failed'}",
                                                                                "text": job["fyi"], "priority": 2, "tags": ["fyi", "auto-fix"]}})
                if r is not None:
                    sent["fyi"][job["id"]] = (r.get("item") or {}).get("id", "")
            storage.write_json(DATA / "delivered.json", sent)
    except Exception:  # noqa: BLE001 — delivery is best-effort; the sweep tries again
        pass


class AutoFixes:
    """auto-fixes@1: told about every job change by runners in this process."""

    def changed(self, job: dict[str, Any]) -> None:
        threading.Thread(target=deliver, args=(job,), daemon=True).start()

    def fyi(self, job: dict[str, Any]) -> None:
        threading.Thread(target=deliver, args=(job,), daemon=True).start()

    def state(self) -> dict[str, Any]:
        return state()


def _sweep() -> None:
    while True:
        time.sleep(SWEEP_S)
        if plugin_services.get("auto-fixes@1") is None:
            continue  # plugin switched off
        try:
            sent = _sent()
            for j in _runner().jobs():
                stamp = f"{j['status']}:{len(j['attempts'])}:{len(j.get('missing') or [])}"
                if (j.get("attempts") and (sent["notes"].get(j["id"]) or {}).get("stamp") != stamp) or (j.get("fyi") and j["id"] not in sent["fyi"]):
                    deliver(j)
            _runner().prune()
        except Exception:  # noqa: BLE001
            pass


plugin_services.provide("auto-fixes@1", AutoFixes(), folder=FOLDER)
threading.Thread(target=_sweep, name="auto-fixes-sweep", daemon=True).start()


# ---------------------------------------------------------------------- routes

@router.get("/state")
def get_state() -> dict[str, Any]:
    """Every call being fixed and every one that gave up: count, what each is trying now, attempts, what is missing."""
    return state()


@router.get("/jobs/{id}")
def get_job(id: str) -> dict[str, Any]:
    """One job: every attempt (which fix, step n of m, the error) and its Automatic fixes log text."""
    j = _runner().get(id)
    if j is None:
        raise HTTPException(404, f"no auto-fix job {id}")
    return {"ok": True, "job": j, "log": log_text(j), "amberxNote": (_sent()["notes"].get(id) or {}).get("id", "")}


@router.get("/say")
def get_say() -> dict[str, Any]:
    """What's failing, as one spoken answer (AmberX voice: "what's failing")."""
    return {"ok": True, "text": say()}


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    """How it shows: display = banner (a strip across the top), widget (a badge on the banner bar) or off."""
    return {"ok": True, **_settings()}


class SettingsIn(BaseModel):
    display: Literal["banner", "widget", "off"]


@router.post("/settings")
def set_settings(body: SettingsIn) -> dict[str, Any]:
    """Show it as its own banner, as a banner widget, or not at all. Every open console switches live."""
    storage.write_json(DATA / "settings.json", {"display": body.display})
    return {"ok": True, **_settings()}


class DismissIn(BaseModel):
    id: str


@router.post("/dismiss")
def dismiss(body: DismissIn) -> dict[str, Any]:
    """Hide a job from the list (it stays in the ledger as dismissed)."""
    if not _runner().dismiss(body.id):
        raise HTTPException(404, f"no auto-fix job {body.id}")
    return {"ok": True, **state()}
