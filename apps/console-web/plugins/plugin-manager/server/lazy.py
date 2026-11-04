"""Plugin lazy loader config (plugin-lazy@1): stored here, applied by the console's loader (src/pluginLoader.tsx).

Same normalizer as src/lazyEngine.ts `normalizeLazyConfig` (defaults, clamps, core plugins never off); the web loader
normalizes again, so a hand-edited file can't break startup. The open console reports its live table to `report`.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

FOLDER_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
MODES = ("start", "open", "off")
PLUGINS_DIR = Path(__file__).resolve().parents[2]


def _core_plugins() -> dict[str, str]:
    """Core plugins declare themselves (`lazy.core` in their own plugin.json): never named here (plugin-lifecycle@1)."""
    out: dict[str, str] = {}
    for f in sorted(PLUGINS_DIR.glob("*/plugin.json")):
        try:
            mode = (json.loads(f.read_text()).get("lazy") or {}).get("core")
        except (OSError, ValueError, AttributeError):
            continue
        if mode in ("start", "open"):
            out[f.parent.name] = mode
    return out


CORE = _core_plugins()
DEFAULTS: dict[str, Any] = {
    "$axf": "plugin-lazy@1",
    "preloadCount": 5,
    "pins": [],
    "bannersFirst": True,
    "order": [],
    "idle": {"on": True, "count": 5},
    "cache": {"size": 15, "offline": True, "offlineMb": 25},
    "modes": {},
}


def _int(v: Any, lo: int, hi: int, d: int) -> int:
    if isinstance(v, bool):
        return d
    try:
        n = float(v)
    except (TypeError, ValueError):
        return d
    if n != n:  # NaN
        return d
    return int(min(hi, max(lo, round(n))))


def _folders(v: Any) -> list[str]:
    out: list[str] = []
    for x in v if isinstance(v, list) else []:
        if isinstance(x, str) and FOLDER_RE.match(x) and x not in out:
            out.append(x)
    return out


def _bool(v: Any, d: bool) -> bool:
    return v if isinstance(v, bool) else d


def normalize(raw: Any) -> dict[str, Any]:
    r = raw if isinstance(raw, dict) else {}
    idle = r.get("idle") if isinstance(r.get("idle"), dict) else {}
    cache = r.get("cache") if isinstance(r.get("cache"), dict) else {}
    modes: dict[str, str] = {}
    for k, v in (r.get("modes") or {}).items() if isinstance(r.get("modes"), dict) else []:
        if not FOLDER_RE.match(str(k)) or v not in MODES or (v == "off" and k in CORE):
            continue
        modes[k] = v
    d = DEFAULTS
    return {
        "$axf": "plugin-lazy@1",
        "preloadCount": _int(r.get("preloadCount"), 0, 50, d["preloadCount"]),
        "pins": _folders(r.get("pins")),
        "bannersFirst": _bool(r.get("bannersFirst"), d["bannersFirst"]),
        "order": _folders(r.get("order")),
        "idle": {"on": _bool(idle.get("on"), d["idle"]["on"]), "count": _int(idle.get("count"), 0, 100, d["idle"]["count"])},
        "cache": {"size": _int(cache.get("size"), 1, 200, d["cache"]["size"]), "offline": _bool(cache.get("offline"), d["cache"]["offline"]),
                  "offlineMb": _int(cache.get("offlineMb"), 1, 500, d["cache"]["offlineMb"])},
        "modes": modes,
    }


def merge(cfg: dict[str, Any], patch: Any) -> dict[str, Any]:
    """A partial change on top of the stored config (nested idle / cache / modes merge; lists replace)."""
    out = json.loads(json.dumps(cfg))
    for k, v in (patch if isinstance(patch, dict) else {}).items():
        if k in ("idle", "cache", "modes") and isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = {**out[k], **v}
        else:
            out[k] = v
    return normalize(out)


class Store:
    def __init__(self, data_dir: Path):
        self.dir = data_dir
        self.file = data_dir / "lazy.json"
        self.report_file = data_dir / "lazy-report.json"

    def get(self) -> dict[str, Any]:
        try:
            return normalize(json.loads(self.file.read_text()))
        except (OSError, ValueError):
            return normalize({})

    def put(self, cfg: dict[str, Any]) -> dict[str, Any]:
        cfg = normalize(cfg)
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self.file.with_suffix(".tmp")
        tmp.write_text(json.dumps(cfg, indent=2) + "\n")
        tmp.replace(self.file)
        return cfg

    def reset(self) -> dict[str, Any]:
        self.file.unlink(missing_ok=True)
        return self.get()

    def report(self) -> dict[str, Any] | None:
        try:
            return json.loads(self.report_file.read_text())
        except (OSError, ValueError):
            return None

    def save_report(self, body: Any) -> None:
        if not isinstance(body, dict) or not isinstance(body.get("plugins"), list):
            raise ValueError("report needs a plugins list")
        rows = [r for r in body["plugins"][:500] if isinstance(r, dict) and FOLDER_RE.match(str(r.get("folder", "")))]
        keep = {"at": str(body.get("at", ""))[:40], "startup": body.get("startup") if isinstance(body.get("startup"), dict) else None,
                "bootMs": body.get("bootMs") if isinstance(body.get("bootMs"), (int, float)) else None, "plugins": rows}
        self.dir.mkdir(parents=True, exist_ok=True)
        self.report_file.write_text(json.dumps(keep) + "\n")
