"""Systems check item for merge-watch@1: merges to main whose shipped manifest didn't reach Shipped features.

health@1 check `shipped-merge-watch` (registered on axf.health@1 once the systems check provides it):
  green   nothing failed, the watch ran in the last 10 minutes
  amber   a send failed but is still retrying (fewer than 3 tries), or the watch hasn't run for 10+ minutes
  red     3+ failed tries on a merge (what broke, since when, the last error); Auto fix = `merge-watch.mjs retry`
          (every failed merge back to pending and sent now)

The state file is the one framework/cli/merge-watch-files.mjs resolves (same chain: AXF_MERGE_WATCH_DIR, AXF_DATA_DIR,
the hub's /projects/amberx-axf/_data, the repo).
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[5]
REL = Path("_claude") / "builds" / "merge-watch" / "state.json"
CLI = ROOT / "framework" / "cli" / "merge-watch.mjs"
HEALTH_ID = "shipped-merge-watch"
ALERT_AFTER = 3
STALE_MIN = 10
FOLDER = "shipped-features"
_done = False


def state_file() -> Path:
    for key in ("AXF_MERGE_WATCH_DATA", "AXF_MERGE_WATCH_DIR"):
        if os.environ.get(key):
            return Path(os.environ[key]) / "state.json"
    data = os.environ.get("AXF_DATA_DIR")
    if data is not None:
        return (Path(data) if data and data != "off" else ROOT) / REL
    hub = Path("/projects/amberx-axf/_data")
    return (hub if hub.is_dir() else ROOT) / REL


def read_state() -> dict[str, Any] | None:
    try:
        return json.loads(state_file().read_text())
    except (OSError, ValueError):
        return None


def _age_min(at: str) -> float | None:
    try:
        return (datetime.now(timezone.utc) - datetime.fromisoformat(at.replace("Z", "+00:00"))).total_seconds() / 60
    except (ValueError, AttributeError):
        return None


def probe() -> dict[str, Any]:
    s = read_state()
    if not s:
        return {"status": "warning", "summary": "Merge watch hasn't run yet: no merge to main is sent to Shipped features.",
                "details": [f"state: {state_file()}", "Start it: node framework/cli/merge-watch.mjs tick"]}
    entries = list((s.get("entries") or {}).values())
    failed = [e for e in entries if e.get("state") == "failed"]
    bad = sorted([e for e in failed if int(e.get("attempts") or 0) >= ALERT_AFTER], key=lambda e: e.get("at") or "")
    pending = [e for e in entries if e.get("state") == "pending"]
    checked = (s.get("lastSeen") or {}).get("checkedAt") or ""
    age = _age_min(checked)

    def line(e: dict[str, Any]) -> str:
        who = e.get("build") or e.get("guess") or (e.get("subject") or "")[:60]
        pr = f" (#{e['pr']})" if e.get("pr") else ""
        return f"{who}{pr} {str(e.get('sha'))[:9]}: {e.get('attempts')} tries, {str(e.get('error') or '')[:200]}"

    if bad:
        since = min((e.get("seenAt") or e.get("at") or "") for e in bad)
        return {"status": "error",
                "summary": f"{len(bad)} merge(s) to main not sent to Shipped features since {since[:16].replace('T', ' ')} UTC. Auto fix resends them.",
                "details": [line(e) for e in bad[:20]]}
    if failed:
        return {"status": "warning", "summary": f"{len(failed)} Shipped features send(s) failed and will retry.", "details": [line(e) for e in failed[:20]]}
    if age is None or age > STALE_MIN:
        return {"status": "warning", "summary": f"Merge watch last checked main {'never' if age is None else f'{int(age)} min ago'}: new merges aren't being sent.",
                "details": [f"state: {state_file()}", "The cron poll axf-merge-watch runs every minute (deploy/cron/axf-merge-watch)."]}
    return {"status": "ok", "summary": f"Every merge to main is sent to Shipped features ({len(pending)} pending, last check {int(age)} min ago)."}


def resend() -> dict[str, Any]:
    """Auto fix: every failed merge back to pending and sent now (in the background; the next check shows the result)."""
    def run() -> None:
        subprocess.run(["node", str(CLI), "retry", "--json"], cwd=str(ROOT), capture_output=True, timeout=900, check=False)
    threading.Thread(target=run, daemon=True).start()
    return {"state": "started", "message": "Resending the failed merges to Shipped features.", "waitS": 120}


def register(plugin_services: Any) -> bool:
    global _done
    if _done:
        return True
    reg = plugin_services.get("axf.health@1")
    if reg is None:
        return False
    try:
        reg.register({"id": HEALTH_ID, "label": "Merges to main reach Shipped features", "service": "console", "order": 63, "severity": "error",
                      "interval": 120, "run": probe,
                      "breaks": "Shipped features misses merged work: Brett can't see what landed on main.",
                      "autoFix": {"label": "Resend now", "run": resend},
                      "links": [{"label": "Send Shipped features rule", "href": "/plugins/gate?tab=rules&rule=after-merge-send-shipped-features"}],
                      "instructions": ["Auto fix resends every failed merge (merge-watch.mjs retry).",
                                       "By hand on the VPS: node framework/cli/merge-watch.mjs status, then retry or send <sha>."]}, FOLDER)
    except Exception:  # noqa: BLE001 — Shipped features works without its health item
        return False
    _done = True
    return True


def register_later(plugin_services: Any, tries: int = 12) -> None:
    if not register(plugin_services) and tries > 1:
        t = threading.Timer(5.0, register_later, args=(plugin_services, tries - 1))
        t.daemon = True
        t.start()
