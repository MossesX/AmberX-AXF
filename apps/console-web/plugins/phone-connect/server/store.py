"""Phone Connect's files, all inside its lifecycle dataDir (.axf-console/plugins/phone-connect/). Atomic JSON writes."""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

FOLDER = Path(__file__).resolve().parents[1].name
LOCK = threading.RLock()


def data_dir() -> Path:
    exact = os.environ.get("AXF_PHONE_CONNECT_DIR")
    if exact:
        return Path(exact)
    try:
        import console_context as cx
        root = cx.ROOT
    except Exception:  # noqa: BLE001 — tests run without the console
        root = Path(os.environ.get("AXF_ROOT") or Path(__file__).resolve().parents[5])
    return Path(root) / ".axf-console" / "plugins" / FOLDER


def read(name: str, default: Any) -> Any:
    p = data_dir() / name
    try:
        return json.loads(p.read_text("utf-8"))
    except (OSError, ValueError):
        return default


def write(name: str, doc: Any) -> None:
    p = data_dir() / name
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", "utf-8")
    os.chmod(tmp, 0o600)
    os.replace(tmp, p)
