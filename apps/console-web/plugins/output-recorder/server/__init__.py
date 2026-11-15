"""Audio Output Recorder, server part: moved whole into Phone Connect (capability axf.phone-recorder@1).

Only the old routes are left, answering through the capability until this plugin is removed:
  GET  status   → the phone recorder's transcripts status
  POST run      → look for parts to transcribe now
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter

import plugin_services

router = APIRouter()
MOVED = "The Audio Output Recorder moved into Phone Connect: use /api/plugins/phone-connect/recorder/*."


def _svc() -> Any:
    return plugin_services.get("axf.phone-recorder@1")


@router.get("/status")
def status() -> dict[str, Any]:
    svc = _svc()
    st = svc.status() if svc is not None else {}
    return {**(st.get("transcripts") or {"on": False}), "moved": MOVED}


@router.post("/run")
def run_now() -> dict[str, Any]:
    return {"ok": False, "moved": MOVED}
