"""Molly guide's server part (walkthrough@1, Oct 28 2026). Mounted at /api/plugins/molly-guide/ (console token required).

    POST /ask           {task, app?, page?} → {text, walkthrough?, tools, ms}
                        One task for Molly through the capability service axf.agents@1 (run_task: her tools, memory, and
                        every VPS command approved by Brett on axHub). A ```walkthrough``` block in her answer is taken
                        out, checked, kept, and returned; the rest is the spoken answer.
    GET  /walkthroughs  ?after=<seq> → {walkthroughs[]}  newest first (the console window polls it; AmberX's voice
                        commands reach Molly through /ask, so a walkthrough she makes for AmberX opens in the console).

    POST /amberx-walkthrough/rerecord   → {state, message}  re-record AmberX's walkthrough video: one veto call (vps.run
                        through Vinny, axf.vinny@1) that starts apps/amberx-droid/walkthrough/rebuild.sh on the VPS in the
                        background; Brett can Deny it during the countdown. The button is in Settings → Plugins → Molly guide.
    GET  /amberx-walkthrough/rerecord   → the last request's {state, message, at}

Data: `walkthroughs.json` (last WALK_KEEP) in this plugin's own data folder; nothing else is written.
"""
from __future__ import annotations

import base64
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


# Re-recording AmberX's walkthrough video (Nov 1 2026): the recorder runs on the VPS (docker), so the console asks for it
# through axHub as a veto call; the script itself is apps/amberx-droid/walkthrough/rebuild.sh in the VPS checkout.
VPS_CHECKOUT = os.environ.get("AXF_VPS_CHECKOUT", "/opt/axf")
RERECORD_COMMAND = (f"cd {VPS_CHECKOUT} && mkdir -p /opt/amberx-walkthrough-rec && "
                    "nohup bash apps/amberx-droid/walkthrough/rebuild.sh > /opt/amberx-walkthrough-rec/rebuild.log 2>&1 &")
RERECORD_REASON = "Re-record the AmberX walkthrough video"
_rerecord: dict[str, Any] = {"state": "idle", "message": "", "at": 0}
_WT_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


def rerecord_command(walkthrough: str = "amberx-app", voice_only: bool = False, overrides: dict[str, Any] | None = None) -> tuple[str, str]:
    """The VPS command and the veto notice's title for one walkthrough. Voice edits (walkthrough-voice@1, checked by AmberX's
    server) ride along base64-encoded, so nothing in them can reach the shell; VOICE_ONLY re-voices and re-cuts without
    re-recording (minutes instead of the full run)."""
    if not _WT_ID.match(walkthrough):
        raise HTTPException(400, "bad walkthrough id")
    if walkthrough == "amberx-app" and not voice_only and not overrides:
        return RERECORD_COMMAND, RERECORD_REASON
    env = f"WALKTHROUGH={walkthrough}"
    if voice_only:
        env += " VOICE_ONLY=1"
    if overrides:
        raw = json.dumps(overrides, separators=(",", ":"))
        if len(raw) > 64 * 1024:
            raise HTTPException(413, "too many edits for one re-voice (64 KB at most)")
        env += " VOICE_OVERRIDES_B64=" + base64.b64encode(raw.encode()).decode()
    log = f"/opt/amberx-walkthrough-rec/rebuild-{walkthrough}.log"
    cmd = (f"cd {VPS_CHECKOUT} && mkdir -p /opt/amberx-walkthrough-rec && "
           f"{env} nohup bash apps/amberx-droid/walkthrough/rebuild.sh > {log} 2>&1 &")
    what = "Re-voice" if voice_only else "Re-record"
    return cmd, f"{what} the {'AmberX' if walkthrough == 'amberx-app' else walkthrough} walkthrough video"


def _send_rerecord(svc: Any, command: str = RERECORD_COMMAND, reason: str = RERECORD_REASON) -> None:
    try:
        r = svc.call("vps.run", {"command": command}, reason=reason)
        msg = ("Sent to axHub: it runs when the countdown ends unless you deny it. The new video is live in AmberX about "
               "15 minutes later.") if r.get("confirm") or r.get("ok") is not None else str(r)[:300]
        _rerecord.update(state="sent", message=msg, at=time.time())
    except Exception as e:  # noqa: BLE001 — say what went wrong, plainly
        _rerecord.update(state="failed", message=f"axHub didn't take it: {str(e)[:300]}", at=time.time())


@router.get("/amberx-walkthrough/rerecord")
def rerecord_status() -> dict[str, Any]:
    return dict(_rerecord)


@router.post("/amberx-walkthrough/rerecord")
def rerecord(body: dict[str, Any] | None = None) -> dict[str, Any]:
    b = body or {}
    command, reason = rerecord_command(str(b.get("walkthrough") or "amberx-app"), b.get("voiceOnly") is True,
                                       b.get("overrides") if isinstance(b.get("overrides"), dict) else None)
    svc = plugin_services.get("axf.vinny@1")
    if svc is None:
        raise HTTPException(503, "Re-recording goes through Vinny: switch the Agent manager on.")
    ok, why = svc.ready()
    if not ok:
        raise HTTPException(503, f"Vinny can't send it to axHub: {why}")
    if _rerecord["state"] == "sending" and time.time() - _rerecord["at"] < 120:
        return dict(_rerecord)
    _rerecord.update(state="sending", message="Sending it to axHub…", at=time.time())
    threading.Thread(target=_send_rerecord, args=(svc, command, reason), daemon=True).start()
    return dict(_rerecord)


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
