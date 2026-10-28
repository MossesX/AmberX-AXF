"""Molly guide's server part (walkthrough@1, Oct 28 2026). Mounted at /api/plugins/molly-guide/ (console token required).

    POST /ask           {task, app?, page?} → {text, walkthrough?, tools, ms}
                        One task for Molly through the capability service axf.agents@1 (run_task: her tools, memory, and
                        every VPS command approved by Brett on axHub). A ```walkthrough``` block in her answer is taken
                        out, checked, kept, and returned; the rest is the spoken answer.
    GET  /walkthroughs  ?after=<seq> → {walkthroughs[]}  newest first (the console window polls it; AmberX's voice
                        commands reach Molly through /ask, so a walkthrough she makes for AmberX opens in the console).

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

router = APIRouter()
ROOT = Path(os.environ.get("AXF_ROOT", Path(__file__).resolve().parents[5])).resolve()
DATA = Path(os.environ.get("AXF_MOLLY_GUIDE_DIR", ROOT / ".axf-console" / "plugins" / "molly-guide"))
AGENT = "molly"
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
    try:
        cur = json.loads(_file().read_text())
        return [x for x in cur if isinstance(x, dict)] if isinstance(cur, list) else []
    except Exception:  # noqa: BLE001
        return []


def save_walkthrough(wt: dict[str, Any], source: str) -> dict[str, Any]:
    with _lock:
        cur = _read()
        rec = {**wt, "at": int(time.time() * 1000), "source": source[:40], "seq": max((int(x.get("seq", 0)) for x in cur), default=0) + 1}
        DATA.mkdir(parents=True, exist_ok=True)
        tmp = _file().with_suffix(".tmp")
        tmp.write_text(json.dumps(([rec] + cur)[:WALK_KEEP], indent=1))
        tmp.replace(_file())
        return rec


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
        raise HTTPException(503, "The Agent manager isn't on, so Molly can't answer.")
    if svc.get_agent(AGENT) is None:
        raise HTTPException(503, "Molly isn't installed or is switched off (Agent manager → Add-ons → Molly).")
    try:
        r = svc.run_task(AGENT, f"[from {app}{', page ' + page if page else ''}] {task[:4000]}")
    except Exception as e:  # noqa: BLE001 — the model or a tool failed: say so plainly
        raise HTTPException(502, f"Molly couldn't finish: {str(e)[:300]}") from None
    text, wt = split_walkthrough(str(r.get("text", "")))
    out: dict[str, Any] = {"text": text or (wt["title"] if wt else ""), "tools": r.get("tools") or [], "ms": r.get("ms")}
    if wt:
        out["walkthrough"] = save_walkthrough(wt, app)
    return out
