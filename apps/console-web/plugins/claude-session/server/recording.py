"""Every session recorded (build ui-review-notify-session-audio, Brett: "automatically audio built in transcriptions
automatic every session"): a session that starts asks AmberX's Audio Output Recorder to start for it, in plain code, so
no session has to remember `amberx.recorder_start`.

What stays as it is:
- `amberx.recorder_start` is a straight approval on axHub (decision #108) and Android asks for capture consent on every
  start: both still happen; this only sends the ask.
- The mic: `mic` is never sent, so the phone follows Brett's own "Record my mic too" switch.
- Headless builds skip it (nobody at the phone). Setting `recording.autoStart` turns it off.

One recorder, one approval: a recording already running or asked for in the last ASK_AGAIN_S is joined instead of asked
for again. The recording's group is the session id, which is how a transcript finds its session.
"""
from __future__ import annotations

import re
import threading
import time
from typing import Any, Callable

import plugin_services

from . import hub

START, STOP, STATUS = "amberx.recorder_start", "amberx.recorder_stop", "amberx.recorder_status"
CLIENTS = ("voice", "chat", "code")
CLIENT_NAME = {"voice": "Voice", "chat": "Chat", "code": "Console"}
ASK_AGAIN_S = 600.0
RECORDING_STATES = ("asked", "joined")

_lock = threading.Lock()
_last_ask = {"at": 0.0, "session": ""}


def setting_on(key: str) -> bool:
    svc = plugin_services.get("axf.claude-settings@1")
    if svc is None:
        return True
    try:
        v = svc.get()
    except Exception:  # noqa: BLE001 — default on: Brett asked for every session
        return True
    return next((s.get("value") for s in v.get("settings") or [] if s.get("key") == key), True) is not False


def wanted(client: str) -> bool:
    return client in CLIENTS and setting_on("recording.autoStart")


def name_of(session: dict[str, Any]) -> str:
    """The name on the recording: what the session is about, else who it is."""
    text = re.sub(r"[\\/:*?\"<>|\x00-\x1f\x7f]", " ", str(session.get("summary") or ""))
    text = re.sub(r"\s+", " ", text).strip()[:80].strip()
    return text or f"{CLIENT_NAME.get(str(session.get('client')), 'Claude')} session"


def start(session: dict[str, Any]) -> dict[str, Any]:
    """Asks the phone for this session → {state, name, group, at, message?}. state: asked | joined | phone-offline | failed."""
    name, group = name_of(session), str(session["id"])[:80]
    base = {"name": name, "group": group, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    try:
        st = hub.tool(STATUS, {})
        if st.get("online") is False:
            return {**base, "state": "phone-offline", "message": "AmberX's phone isn't connected to axHub, so this session isn't recorded"}
        if st.get("running"):
            return {**base, "state": "joined", "name": str(st.get("session") or name)[:80], "group": str(st.get("group") or group)[:80], "message": "the recorder was already running"}
        with _lock:
            now = time.monotonic()
            recent = _last_ask["at"] and now - _last_ask["at"] < ASK_AGAIN_S
            if not recent:
                _last_ask.update(at=now, session=group)
        if recent:
            return {**base, "state": "joined", "group": _last_ask["session"], "message": "a recording was asked for moments ago"}
        reason = {"title": f"Record session: {name}"[:120],
                  "description": "A Claude session started and Record every session is on. Approve, then allow Android's capture prompt on the phone. What the phone plays is recorded and transcribed; the mic follows your own switch."}
        hub.tool(START, {"session_name": name, "group": group, "note": f"{session.get('client')} session {group}"[:500]}, reason)
        return {**base, "state": "asked"}
    except hub.HubError as e:
        with _lock:
            if _last_ask["session"] == group:
                _last_ask.update(at=0.0, session="")
        return {**base, "state": "failed", "message": str(e)[:200]}


def stop(session: dict[str, Any], sessions: list[dict[str, Any]]) -> bool:
    """The session ended: stop the recorder only when it was this session's and nobody else is on it."""
    rec = session.get("recording") or {}
    if rec.get("state") != "asked":
        return False
    others = [s for s in sessions if s.get("id") != session.get("id") and s.get("status") != "ended" and (s.get("recording") or {}).get("state") in RECORDING_STATES
              and (s.get("recording") or {}).get("group") == rec.get("group")]
    if others:
        return False
    try:
        hub.tool(STOP, {})
    except hub.HubError:
        return False  # the recorder keeps its own cap; the notification's Stop still works
    return True


def in_background(fn: Callable[[], Any]) -> None:
    threading.Thread(target=fn, daemon=True).start()
