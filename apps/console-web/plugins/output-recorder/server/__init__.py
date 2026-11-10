"""Audio Output Recorder, server part: the automatic transcripts (transcripts.py). Mounted at /api/plugins/output-recorder/.

  GET  status   the worker: on/off, what's waiting, the last one done, what failed
  POST run      look now instead of at the next round

The recording itself stays on the phone and the hub; the transcripts are written beside the recordings on the hub, so
AmberX and the console read them the same way. Setting: Claude setting `recording.transcribe`. A missing engine or a
failed chunk shows on the systems check (health@1).
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter

import console_context as cx
import plugin_services

from . import transcripts as T

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
HEALTH_ID = "session-transcripts"
ROUND_S = 90.0
_wake = threading.Event()
_lock = threading.Lock()
_health_done = False


def data_dir() -> Path:
    return Path(os.environ.get("AXF_OUTPUT_RECORDER_DIR") or (cx.ROOT / ".axf-console" / "plugins" / FOLDER))


def hub_root() -> Path:
    exact = os.environ.get("AXF_RECORDINGS_ROOT")
    if exact:
        return Path(exact)
    root = cx.persist_root()
    return root.parent if root else Path("/projects")


def base() -> Path:
    return T.folder(hub_root(), os.environ.get("AXF_RECORDINGS_PROJECT") or T.DEFAULT_PROJECT)


def _state_file() -> Path:
    return data_dir() / "transcribe.json"


def load_state() -> dict[str, Any]:
    return T.read_json(_state_file()) or {"failed": {}}


def save_state(st: dict[str, Any]) -> None:
    data_dir().mkdir(parents=True, exist_ok=True)
    tmp = _state_file().with_suffix(".tmp")
    tmp.write_text(json.dumps(st))
    os.replace(tmp, _state_file())


def enabled() -> bool:
    svc = plugin_services.get("axf.claude-settings@1")
    if svc is None:
        return True
    try:
        return next((s.get("value") for s in svc.get().get("settings") or [] if s.get("key") == "recording.transcribe"), True) is not False
    except Exception:  # noqa: BLE001 — default on
        return True


def tick() -> str:
    """One round: at most one chunk."""
    if not enabled():
        return "off"
    if not T.available():
        return "no-engine"
    with _lock:
        st = load_state()
        r = T.run_once(base(), st, data_dir() / "models")
        save_state(st)
    return r


def _loop() -> None:
    while True:
        r = ""
        try:
            if cx.plugin_enabled(FOLDER):
                r = tick()
        except Exception as e:  # noqa: BLE001 — the worker never takes the console down
            cx.log("output-recorder", f"transcripts: {str(e)[:200]}", "warn")
        if r != "done":  # a backlog runs straight on, one at a time
            _wake.wait(ROUND_S)
            _wake.clear()
        else:
            time.sleep(2)


@router.get("/status")
def status() -> dict[str, Any]:
    st = load_state()
    return {"on": enabled(), "engine": T.available(), "model": T.MODEL, "waiting": len(T.pending(base(), st.get("failed") or {})), "last": st.get("last"),
            "note": st.get("note", ""), "failed": [{"id": k, **v} for k, v in (st.get("failed") or {}).items()][:20]}


@router.post("/run")
def run_now() -> dict[str, Any]:
    _wake.set()
    return {"ok": True}


def health_probe() -> dict[str, Any]:
    st = status()
    if not st["on"]:
        return {"status": "ok", "summary": "Transcripts are switched off (Settings → Plugins → Claude)."}
    if not st["engine"]:
        return {"status": "error", "summary": "The transcription engine isn't installed, so session recordings aren't being transcribed.",
                "details": ["faster-whisper is missing from the console image: redeploy it."]}
    dead = [f for f in st["failed"] if int(f.get("tries", 0)) >= T.MAX_TRIES]
    if dead:
        return {"status": "warn", "summary": f"{len(dead)} recording part(s) couldn't be transcribed.", "details": [f"{f.get('name') or f['id']}: {f.get('error', '')}" for f in dead[:10]]}
    return {"status": "ok", "summary": f"Transcripts running: {st['waiting']} part(s) waiting."}


def ensure_health() -> bool:
    global _health_done
    if _health_done:
        return True
    reg = plugin_services.get("axf.health@1")
    if reg is None:
        return False
    try:
        reg.register({"id": HEALTH_ID, "label": "Session transcripts", "service": "console", "order": 63, "severity": "warn", "run": health_probe,
                      "breaks": "Session recordings stay on axHub without a transcript, so they can't be searched.",
                      "instructions": ["Open Audio Output Recorder to see which recordings have a transcript.",
                                       "`GET /api/plugins/output-recorder/status` says what is waiting and what failed; POST `run` looks again now."]}, FOLDER)
    except Exception:  # noqa: BLE001 — recording works without its health item
        return False
    _health_done = True
    return True


def _register_later(tries: int = 12) -> None:
    if not ensure_health() and tries > 1:
        t = threading.Timer(5.0, _register_later, args=(tries - 1,))
        t.daemon = True
        t.start()


if not os.environ.get("AXF_OUTPUT_RECORDER_NO_WORKER"):
    threading.Thread(target=_loop, name="output-recorder-transcripts", daemon=True).start()
    _register_later()
