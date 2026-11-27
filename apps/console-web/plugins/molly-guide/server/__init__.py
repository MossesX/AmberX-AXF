"""Gizmo guide's server part (walkthrough@1, Oct 28 2026; Nov 13 2026: asks Gizmo, Molly is no longer an agent). Mounted at /api/plugins/molly-guide/ (console token required).

    POST /ask           {task, app?, page?} → {text, walkthrough?, tools, ms}
                        One task for Gizmo through the capability service axf.agents@1 (run_task: her tools, memory, and
                        every VPS command approved by Brett on axHub). A ```walkthrough``` block in his answer is taken
                        out, checked, kept, and returned; the rest is the spoken answer.
    GET  /walkthroughs  ?after=<seq> → {walkthroughs[]}  newest first (the console window polls it; AmberX's voice
                        commands reach Gizmo through /ask; the console opens such a walkthrough by itself only with its opt-in switch on).


Data: `walkthroughs.json` (last WALK_KEEP) in this plugin's own data folder; nothing else is written.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

import plugin_services
from fastapi import APIRouter, HTTPException

import data_store

router = APIRouter()
ROOT = Path(os.environ.get("AXF_ROOT", Path(__file__).resolve().parents[5])).resolve()
DATA = Path(os.environ.get("AXF_MOLLY_GUIDE_DIR", ROOT / ".axf-console" / "plugins" / "molly-guide"))
# Nov 3 2026 decision: Gizmo replaced agent Molly. The old add-on is only a fallback while Gizmo is switched off.
AGENTS = ("gizmo", "molly")
WALK_KEEP = 20
_lock = threading.Lock()
_WALK_RE = re.compile(r"```walkthrough\s*(\{.*?\})\s*```", re.S)
_ACTION = re.compile(r"[a-z][a-z0-9._-]*(:[^\s<>\"'`]{0,160})?")
_BAD_SCHEME = re.compile(r"(javascript|data|vbscript|file|https?):", re.I)


def clean_walkthrough(raw: Any) -> dict[str, Any] | None:
    """Same rules as web/walkthrough.ts cleanWalkthrough: no scripts, no links, no markup, 1–20 steps."""
    if not isinstance(raw, dict) or not isinstance(raw.get("steps"), list):
        return None
    steps = []
    for st in raw["steps"][:20]:
        if not isinstance(st, dict):
            continue
        say = str(st.get("say") or "").strip()[:600]
        do = str(st.get("do") or "").strip()[:200]
        target = str(st.get("target") or "").strip()[:200]
        if do and (_BAD_SCHEME.match(do) or not _ACTION.fullmatch(do)):
            do = ""
        if any(c in target for c in "<>{}`") or target.lower().startswith("javascript"):
            target = ""
        if say:
            steps.append({"say": say, "do": do, "target": target})
    if not steps:
        return None
    wid = re.sub(r"[^a-z0-9-]+", "-", str(raw.get("id") or "walkthrough").lower()).strip("-")[:60] or "walkthrough"
    return {"$axf": "walkthrough@1", "id": wid, "title": str(raw.get("title") or "Walkthrough").strip()[:120], "app": str(raw.get("app") or "console")[:40], "steps": steps}


def split_walkthrough(text: str) -> tuple[str, dict[str, Any] | None]:
    m = _WALK_RE.search(text or "")
    if not m:
        return text, None
    try:
        wt = clean_walkthrough(json.loads(m.group(1)))
    except Exception:  # noqa: BLE001 — a broken block is just text
        return text, None
    return (text[:m.start()] + text[m.end():]).strip(), wt


def _file() -> Path:
    return DATA / "walkthroughs.json"


def _read() -> list[dict[str, Any]]:
    cur = data_store.read_json(_file(), [])
    return [x for x in cur if isinstance(x, dict)] if isinstance(cur, list) else []


def save_walkthrough(wt: dict[str, Any], source: str) -> dict[str, Any]:
    with _lock:
        cur = _read()
        rec = {**wt, "at": int(time.time() * 1000), "source": source[:40], "seq": max((int(x.get("seq", 0)) for x in cur), default=0) + 1}
        data_store.write_json(_file(), ([rec] + cur)[:WALK_KEEP], indent=1, mode=0o644)
        return rec


def pick_agent(svc: Any) -> str | None:
    """The agent that answers: Gizmo, else the old Molly add-on if it is still installed; None when neither is."""
    for a in AGENTS:
        if svc.get_agent(a) is not None:
            return a
    return None


@router.get("/walkthroughs")
def walkthroughs(after: int = 0) -> dict[str, Any]:
    return {"walkthroughs": [w for w in _read() if int(w.get("seq", 0)) > after]}


@router.post("/ask")
def ask(body: dict[str, Any]) -> dict[str, Any]:
    task = str(body.get("task") or "").strip()
    if not task:
        raise HTTPException(400, "task is required")
    app = re.sub(r"[^a-z0-9-]", "", str(body.get("app") or "console").lower())[:40] or "console"
    page = re.sub(r"[^\w.:-]", "", str(body.get("page") or ""))[:80]
    svc = plugin_services.get("axf.agents@1")
    if svc is None:
        raise HTTPException(503, "The Agent manager isn't on, so Gizmo can't answer.")
    agent = pick_agent(svc)
    if agent is None:
        raise HTTPException(503, "Gizmo isn't installed or is switched off (Agent manager → Add-ons → Gizmo).")
    try:
        r = svc.run_task(agent, f"[from {app}{', page ' + page if page else ''}] {task[:4000]}")
    except Exception as e:  # noqa: BLE001 — the model or a tool failed: say so plainly
        raise HTTPException(502, f"Gizmo couldn't finish: {str(e)[:300]}") from None
    text, wt = split_walkthrough(str(r.get("text", "")))
    out: dict[str, Any] = {"text": text or (wt["title"] if wt else ""), "tools": r.get("tools") or [], "ms": r.get("ms")}
    if wt:
        out["walkthrough"] = save_walkthrough(wt, app)
    return out
