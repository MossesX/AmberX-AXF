"""Where a moved console part runs today (host-service-mode@1, framework/spec/HOST-SERVICES.md → Migration).

The console's copy of a loop calls ``container_runs(id)`` at the top of every pass and skips the pass when the service
is in ``host`` mode (the host runner does the work); in ``container`` and ``shadow`` it runs as before. Twin of
framework/cli/host-mode.mjs. The mode file is <shared data>/host-services/mode.json; AXF_HOST_MODE_FILE overrides it.
A missing or unreadable file is ``container``: nothing has moved.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(os.environ.get("AXF_ROOT") or Path(__file__).resolve().parents[3])
MODES = ("container", "shadow", "host")


def _persist_root() -> Path:
    exact = os.environ.get("AXF_DATA_DIR")
    if exact is not None:
        return Path(exact) if exact and exact != "off" else ROOT / "_data"
    legacy = os.environ.get("AXF_PERSIST_DIR")
    if legacy:
        return Path(legacy) / os.environ.get("AXF_PERSIST_REPO", "amberx-axf")
    projects = Path(os.environ.get("AXHUB_PROJECTS_DIR") or "/projects")
    if projects.is_dir():
        return projects / "amberx-axf" / "_data"
    return ROOT / "_data"


def mode_file() -> Path:
    v = os.environ.get("AXF_HOST_MODE_FILE")
    return Path(v) if v else _persist_root() / "host-services" / "mode.json"


def host_mode(service_id: str) -> str:
    """container | shadow | host for one service."""
    try:
        doc = json.loads(mode_file().read_text())
        m = ((doc.get("services") or {}).get(service_id) or {}).get("mode")
        return m if m in MODES else "container"
    except Exception:
        return "container"


def container_runs(service_id: str) -> bool:
    """Should the console's copy do its work now? False only when the service runs on the host."""
    return host_mode(service_id) != "host"


def modes() -> dict:
    """Every service's mode (for status lines and the Plugin Manager)."""
    try:
        doc = json.loads(mode_file().read_text())
        return {k: (v or {}).get("mode", "container") for k, v in (doc.get("services") or {}).items()}
    except Exception:
        return {}
