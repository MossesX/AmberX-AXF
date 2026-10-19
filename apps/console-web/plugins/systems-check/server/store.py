"""Systems check — settings, the saved AI routine and What's-new summaries, all inside the plugin's dataDir."""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

import console_context as cx

_lock = threading.RLock()
SERVICE_IDS = {"console", "github", "claude", "vps", "hostinger", "coolify", "axhub", "data", "plugins", "routine"}


def data_dir() -> Path:
    return Path(os.environ.get("AXF_SYSTEMS_CHECK_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "systems-check"))


def _write(p: Path, data: Any) -> None:
    p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = p.with_suffix(p.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
    os.chmod(tmp, 0o600)
    os.replace(tmp, p)


def _read(p: Path, default: Any) -> Any:
    try:
        return json.loads(p.read_text("utf-8"))
    except (OSError, ValueError):
        return default


DEFAULTS: dict[str, Any] = {"$axf": "systems-check-settings@1", "ai": {"systems": False, "whatsnew": False}, "whatsNewBanner": True}


def settings() -> dict[str, Any]:
    raw = _read(data_dir() / "settings.json", {})
    return {**DEFAULTS, **raw, "ai": {**DEFAULTS["ai"], **(raw.get("ai") or {})}}


def save_settings(patch: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        s = settings()
        if isinstance(patch.get("ai"), dict):
            for k in ("systems", "whatsnew"):
                if k in patch["ai"]:
                    s["ai"][k] = bool(patch["ai"][k])
        if "whatsNewBanner" in patch:
            s["whatsNewBanner"] = bool(patch["whatsNewBanner"])
        _write(data_dir() / "settings.json", s)
        return s


def routine() -> dict[str, Any] | None:
    return _read(data_dir() / "routine.json", None)


def save_routine(r: dict[str, Any]) -> None:
    with _lock:
        _write(data_dir() / "routine.json", r)


def clear_routine() -> None:
    (data_dir() / "routine.json").unlink(missing_ok=True)


def summary(key: str) -> dict[str, Any] | None:
    return _read(data_dir() / "whatsnew" / f"{key}.json", None)


def save_summary(key: str, data: dict[str, Any]) -> None:
    d = data_dir() / "whatsnew"
    with _lock:
        _write(d / f"{key}.json", data)
        files = sorted(d.glob("*.json"), key=lambda f: f.stat().st_mtime)
        for f in files[:-200]:  # keep the last 200 summaries
            f.unlink(missing_ok=True)


# What's new: the point everyone last "got" (shared by every viewer; only an admin moves it).
def whats_new_seen() -> dict[str, Any] | None:
    v = _read(data_dir() / "whatsnew-seen.json", None)
    if not isinstance(v, dict) or not isinstance(v.get("sha"), str) or not isinstance(v.get("plugins"), dict):
        return None
    return {"sha": v["sha"], "at": int(v.get("at") or 0), "plugins": {str(k): str(x) for k, x in v["plugins"].items()}, "by": str(v.get("by") or "")}


def save_whats_new_seen(sha: str, plugins: dict[str, str], by: str) -> dict[str, Any]:
    import time
    v = {"$axf": "whats-new-seen@1", "sha": sha, "at": int(time.time() * 1000), "plugins": plugins, "by": by}
    with _lock:
        _write(data_dir() / "whatsnew-seen.json", v)
    return whats_new_seen() or v
