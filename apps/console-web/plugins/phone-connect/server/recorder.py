"""Audio Output Recorder (moved in whole from the old output-recorder plugin): the phone records what it plays in
30-minute parts named '<session> - <date> - partN', uploads them to axHub (hub data folder `output-recorder/`, project
amberx-recordings, one group per session), and the console transcribes each part (transcripts.py, local faster-whisper).

Rules that came with it:
- start is a straight approval (phone.recorder_start, policy confirm, NEVER_AUTO): no veto countdown, never by itself,
  no auto-approval rule covers it. Without an approval id the start goes to axHub, which asks Brett; with one (he already
  approved on axHub) it is queued for the phone directly.
- The mic is the opt-in switch `recorderMic` (off by default; only Brett's own click turns it on). `mic` is never sent
  on start, so the phone follows the switch.
- Android's capture consent is asked on every start, on the phone.

Capability axf.phone-recorder@1 (plugin_services): start(session_name, group, note, reason) · stop() · status().
"""
from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from typing import Any

from . import commands as Q
from . import core as C
from . import devices as D
from . import hub
from . import settings as S
from . import store
from . import transcripts as T

HEALTH_ID = "session-transcripts"
ROUND_S = 90.0
PART_MINUTES = 30
_wake = threading.Event()
_lock = threading.Lock()


def recorder_dir() -> Path:
    return store.data_dir() / "recorder"


def hub_root() -> Path:
    exact = os.environ.get("AXF_RECORDINGS_ROOT")
    if exact:
        return Path(exact)
    try:
        import console_context as cx
        root = cx.persist_root()
    except Exception:  # noqa: BLE001
        root = None
    return root.parent if root else Path("/projects")


def base() -> Path:
    return T.folder(hub_root(), os.environ.get("AXF_RECORDINGS_PROJECT") or T.DEFAULT_PROJECT)


def part_name(session: str, date: str, n: int) -> str:
    """'<session> - <date> - partN', the name every part carries on the phone and on axHub."""
    return f"{session.strip()[:C.SESSION_NAME_MAX]} - {date} - part{n}"


# ------------------------------------------------------------------ session start / stop / status

def start(session_name: str, group: str = "", note: str = "", reason: dict[str, str] | None = None, approval_id: str = "",
          who: str = "console", via: str = "console") -> dict[str, Any]:
    """Ask for a recording. Straight approval: axHub asks Brett unless approval_id says he already said yes."""
    args: dict[str, Any] = {"session_name": session_name}
    if group:
        args["group"] = group[:C.SESSION_NAME_MAX]
    if note:
        args["note"] = note[:C.TEXT_MAX]
    errs = C.args_errors("phone.recorder_start", args)
    if errs:
        raise C.PhoneError("validation", errs[0])
    if approval_id:
        return {"state": "queued", **Q.enqueue("phone.recorder_start", args, who, via, approval_id=approval_id)}
    why = reason or {"title": f"Record: {session_name}"[:120],
                     "description": "Start the phone's Audio Output Recorder. Approve, then allow Android's capture prompt on the phone. "
                                    "What the phone plays is recorded in 30-minute parts and transcribed; the mic follows your own switch."}
    try:
        r = hub.tool("phone.recorder_start", args, why)
    except hub.HubError as e:
        raise C.PhoneError("unavailable", str(e)) from None
    return {"state": "asked", **r}


def stop(who: str = "console", via: str = "console") -> dict[str, Any]:
    dev = D.current()
    if dev and dev["online"]:
        return {"state": "queued", **Q.enqueue("phone.recorder_stop", {}, who, via)}
    try:
        return {"state": "sent", **hub.tool("phone.recorder_stop", {})}
    except hub.HubError as e:
        raise C.PhoneError("offline", f"The phone isn't reachable: {e}") from None


def status() -> dict[str, Any]:
    """What the phone last reported (heartbeat capability state recorder@1), the mic switch and the transcripts."""
    dev = D.current()
    rec = ((dev or {}).get("capabilityState") or {}).get("recorder@1") or {}
    return {"device": (dev or {}).get("deviceId", ""), "online": bool(dev and dev["online"]), "presence": dev["presence"] if dev else "not paired",
            "running": bool(rec.get("running")), "since": rec.get("since", ""), "session": rec.get("session", ""), "group": rec.get("group", ""),
            "part": rec.get("part", 0), "parts": rec.get("parts", []), "queue": rec.get("queue", 0), "mic": S.get()["recorderMic"],
            "partMinutes": PART_MINUTES, "transcripts": transcripts_status()}


# ------------------------------------------------------------------ the transcription hook

def _state_file() -> Path:
    return recorder_dir() / "transcribe.json"


def load_state() -> dict[str, Any]:
    return T.read_json(_state_file()) or {"failed": {}}


def save_state(st: dict[str, Any]) -> None:
    with store.LOCK:
        store.write("recorder/transcribe.json", st)


def transcribe_on() -> bool:
    try:
        import plugin_services
        svc = plugin_services.get("axf.claude-settings@1")
    except Exception:  # noqa: BLE001
        svc = None
    if svc is None:
        return True
    try:
        return next((s.get("value") for s in svc.get().get("settings") or [] if s.get("key") == "recording.transcribe"), True) is not False
    except Exception:  # noqa: BLE001 — default on
        return True


def tick() -> str:
    """One round: at most one part."""
    if not transcribe_on():
        return "off"
    if not T.available():
        return "no-engine"
    with _lock:
        st = load_state()
        r = T.run_once(base(), st, recorder_dir() / "models")
        save_state(st)
    return r


def transcripts_status() -> dict[str, Any]:
    st = load_state()
    try:
        waiting = len(T.pending(base(), st.get("failed") or {}))
    except OSError:
        waiting = 0
    return {"on": transcribe_on(), "engine": T.available(), "model": T.MODEL, "waiting": waiting, "last": st.get("last"),
            "note": st.get("note", ""), "failed": [{"id": k, **v} for k, v in (st.get("failed") or {}).items()][:20]}


def run_now() -> dict[str, Any]:
    _wake.set()
    return {"ok": True}


def _loop(enabled: Any) -> None:
    while True:
        r = ""
        try:
            if enabled():
                r = tick()
        except Exception:  # noqa: BLE001 — the worker never takes the console down
            r = ""
        if r != "done":
            _wake.wait(ROUND_S)
            _wake.clear()
        else:
            time.sleep(2)


def health_probe() -> dict[str, Any]:
    st = transcripts_status()
    if not st["on"]:
        return {"status": "ok", "summary": "Transcripts are switched off (Settings → Plugins → Claude)."}
    if not st["engine"]:
        return {"status": "error", "summary": "The transcription engine isn't installed, so recordings aren't being transcribed.",
                "details": ["faster-whisper is missing from the console image: redeploy it."]}
    dead = [f for f in st["failed"] if int(f.get("tries", 0)) >= T.MAX_TRIES]
    if dead:
        return {"status": "warn", "summary": f"{len(dead)} recording part(s) couldn't be transcribed.",
                "details": [f"{f.get('name') or f['id']}: {f.get('error', '')}" for f in dead[:10]]}
    return {"status": "ok", "summary": f"Transcripts running: {st['waiting']} part(s) waiting."}


class PhoneRecorder:
    """axf.phone-recorder@1: what claude-session (and anyone else) uses, never this folder's name."""

    def start(self, session_name: str, group: str = "", note: str = "", reason: dict[str, str] | None = None) -> dict[str, Any]:
        return start(session_name, group, note, reason, who="phone-recorder@1", via="console")

    def stop(self) -> dict[str, Any]:
        return stop(who="phone-recorder@1")

    def status(self) -> dict[str, Any]:
        return status()


def boot() -> None:
    """Register the capability and the health item, start the transcription worker (console only)."""
    try:
        import console_context as cx
        import plugin_services
    except Exception:  # noqa: BLE001 — tests
        return
    plugin_services.provide("axf.phone-recorder@1", PhoneRecorder(), folder=store.FOLDER)
    if os.environ.get("AXF_PHONE_RECORDER_NO_WORKER"):
        return
    threading.Thread(target=_loop, args=(lambda: cx.plugin_enabled(store.FOLDER),), name="phone-recorder-transcripts", daemon=True).start()

    def register(tries: int = 12) -> None:
        reg = plugin_services.get("axf.health@1")
        if reg is None:
            if tries > 1:
                t = threading.Timer(5.0, register, args=(tries - 1,))
                t.daemon = True
                t.start()
            return
        try:
            reg.register({"id": HEALTH_ID, "label": "Session transcripts", "service": "console", "order": 63, "severity": "warn", "run": health_probe,
                          "breaks": "Session recordings stay on axHub without a transcript, so they can't be searched.",
                          "instructions": ["Open Phone Connect → Recorder to see which recordings have a transcript.",
                                           "`GET /api/plugins/phone-connect/recorder/status` says what is waiting and what failed; POST `recorder/transcripts/run` looks again now."]},
                         store.FOLDER)
        except Exception:  # noqa: BLE001
            pass

    register()
