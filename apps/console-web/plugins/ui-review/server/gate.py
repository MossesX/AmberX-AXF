"""UI Review gate switch (ui-review-gate@1; Brett, Nov 13 2026: "UI Review must not be a gate. Add an on/off switch in
UI Review settings, 'UI Review is a merge gate', default OFF").

One value drives both settings: UI Review's `uiReview.gate` is the Claude setting `builds.uiReviewGate`, read and
written through the capability axf.claude-settings@1 (anyone turns it off, only Brett's own console click turns it
on). A copy is kept in this plugin's data folder (gate.json) so the answer stays the same while Claude settings is
turned off; a missing value is off. gate_on() is the one decision every hold in UI Review asks.
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any, Callable

import plugin_services

KEY = "uiReview.gate"
CLAUDE_KEY = "builds.uiReviewGate"
SERVICE = "axf.claude-settings@1"
LABEL = "UI Review is a merge gate"
OFF_LINE = "Off: items are filed for you to look at, PRs never wait."
ON_LINE = "On: a PR whose UI Review is waiting, has changes asked or is rejected waits in the merge queue."
NOT_A_GATE = "filed (not a gate)"
CACHE_S = 10.0

_lock = threading.Lock()
_cache: dict[str, Any] = {"at": 0.0, "on": None, "source": ""}


class GateError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _mirror(data_dir: Callable[[], Path]) -> Path:
    return data_dir() / "gate.json"


def _read_mirror(data_dir: Callable[[], Path]) -> bool:
    try:
        d = json.loads(_mirror(data_dir).read_text())
        return isinstance(d, dict) and d.get("on") is True
    except (OSError, ValueError):
        return False


def _write_mirror(data_dir: Callable[[], Path], on: bool, by: str) -> None:
    p = _mirror(data_dir)
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps({"$axf": "ui-review-gate@1", "on": bool(on), "by": by, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, indent=1))
        tmp.replace(p)
    except OSError:
        pass


def _service() -> Any:
    return plugin_services.get(SERVICE)


def read(data_dir: Callable[[], Path], fresh: bool = False) -> dict[str, Any]:
    """{on, source}: the Claude setting when Claude settings is on, else the copy here; missing = off."""
    with _lock:
        if not fresh and _cache["on"] is not None and time.monotonic() - _cache["at"] < CACHE_S:
            return {"on": _cache["on"], "source": _cache["source"]}
    svc = _service()
    on, source = None, "ui-review"
    if svc is not None:
        try:
            r = svc.get()
            vals = r.get("values") if isinstance(r, dict) else None
            if isinstance(vals, dict):
                on, source = vals.get(CLAUDE_KEY) is True, "claude-settings"
        except Exception:  # noqa: BLE001 — Claude settings unreadable: fall back to the copy here
            on = None
    if on is None:
        on = _read_mirror(data_dir)
    elif on != _read_mirror(data_dir):
        _write_mirror(data_dir, on, "claude-settings")
    with _lock:
        _cache.update(at=time.monotonic(), on=on, source=source)
    return {"on": on, "source": source}


def gate_on(data_dir: Callable[[], Path]) -> bool:
    """The one gate decision: is UI Review a merge gate right now? Default off."""
    return read(data_dir)["on"]


def write(data_dir: Callable[[], Path], on: bool, *, owner: dict | None, by: str) -> dict[str, Any]:
    """Turn the gate on or off. On needs `owner` (Brett's signed-in console session, derived by control@1 from the
    request, never from a body); off is open to everyone. Answers {on, source, changed}."""
    if not isinstance(on, bool):
        raise GateError("invalid", "on must be true or false")
    before = read(data_dir, fresh=True)
    if on and not owner:
        if before["on"]:
            return {**before, "changed": False}
        raise GateError("denied", f"'{LABEL}' is turned on only by Brett, with his own click in the console (Settings → Plugins → UI Review); turning it off is open to everyone")
    svc = _service()
    if svc is not None:
        try:
            r = svc.set({CLAUDE_KEY: on}, by, owner=owner)
        except TypeError:  # an older Claude settings without the owner hand-over
            r = svc.set({CLAUDE_KEY: on}, by)
        if isinstance(r, dict) and r.get("ok") is False:
            raise GateError(str(r.get("code") or "unavailable"), str(r.get("message") or "Claude settings refused the change"))
    _write_mirror(data_dir, on, by)
    with _lock:
        _cache.update(at=0.0, on=None, source="")
    after = read(data_dir, fresh=True)
    return {**after, "changed": after["on"] != before["on"]}


def line(on: bool) -> str:
    return ON_LINE if on else OFF_LINE
