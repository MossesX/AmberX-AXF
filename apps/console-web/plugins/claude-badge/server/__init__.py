"""Claude badge — server part. Mounted at /api/plugins/claude-badge/ (console token, 404 when disabled).

POST /test runs one tiny request through the AI assistant's model service (axf.llm@1) and says whether AI answers and
which model did; GET /status returns the last result (kept in the plugin's data folder, no reply text, no keys).
Nothing here names another plugin: no service = "AI unavailable".
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter

import console_context as cx
import plugin_services

router = APIRouter()
_lock = threading.Lock()
PROMPT = "Connection check from the AmberX console. Reply with one word: OK."


def data_dir() -> Path:
    return Path(os.environ.get("AXF_CLAUDE_BADGE_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "claude-badge"))


def pretty_model(model: str) -> str:
    """claude-opus-5-5 → Claude Opus 5.5; claude-sonnet-5-5-20261001 → Claude Sonnet 5.5; anything else as given."""
    m = re.match(r"^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$", (model or "").strip().lower())
    if m:
        fam, major, minor = m.groups()
        return f"Claude {fam.capitalize()} {major}{'.' + minor if minor else ''}"
    m = re.match(r"^claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)", (model or "").strip().lower())  # older claude-3-5-sonnet style
    if m:
        major, minor, fam = m.groups()
        return f"Claude {fam.capitalize()} {major}{'.' + minor if minor else ''}"
    return (model or "").strip()[:60]


def _save(res: dict[str, Any]) -> None:
    p = data_dir() / "status.json"
    with _lock:
        p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        tmp = p.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(res, f)
        os.replace(tmp, p)


def run_test() -> dict[str, Any]:
    started = time.time()
    llm = plugin_services.get("axf.llm@1")
    res: dict[str, Any] = {"at": int(started * 1000), "ok": False, "model": "", "name": "", "provider": "", "ms": 0, "error": ""}
    if not llm:
        res["error"] = "The AI assistant isn't installed or enabled"
    else:
        try:
            out = llm.complete([{"role": "user", "content": PROMPT}], params={"temperature": 0, "max_tokens": 16})
            text = str(out.get("text") or "").strip()
            res.update(ok=bool(text), model=str(out.get("model") or ""), provider=str(out.get("profile") or ""), error="" if text else "the model answered with nothing")
        except Exception as e:  # noqa: BLE001
            res["error"] = (str(e).strip("'\"") or e.__class__.__name__)[:300]
    res["ms"] = int((time.time() - started) * 1000)
    res["name"] = pretty_model(res["model"]) if res["ok"] else ""
    res["claude"] = res["name"].startswith("Claude")
    _save(res)
    cx.log("system", f"AI connection: {'ok, ' + (res['name'] or 'model unknown') if res['ok'] else 'unavailable (' + res['error'][:120] + ')'}", "ok" if res["ok"] else "warn")
    return res


@router.post("/test")
def test() -> dict[str, Any]:
    return run_test()


@router.get("/status")
def status() -> dict[str, Any]:
    try:
        return {"last": json.loads((data_dir() / "status.json").read_text("utf-8"))}
    except (OSError, ValueError):
        return {"last": None}
