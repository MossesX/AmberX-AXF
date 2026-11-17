"""axf-data health (axf.health@1): reachable, last backup age, last verify result.

Brett, Nov 15 2026: "the console goes down, all the data is still available, all the notes are available, and the
builds keep running." The backup is what makes "still available" true after a disk or volume loss, so a stale or
failed backup turns this item red.

  ok     axf-data answers /v1/health, the newest backup is under 26 h old and its verify passed
  warn   no axf-data configured on this console yet (AXF_DATA_URL unset): nothing to check
  error  axf-data unreachable · no backup · newest backup over 26 h old · verify failed (its problems in the details)

Auto fix (veto calls on the VPS, Brett can deny them on the countdown): unreachable → `docker restart axf-data`;
stale or failed backup → `docker exec axf-data python backup.py run` (backup, verify, prune).
"""
from __future__ import annotations

import calendar
import json
import os
import time
import urllib.error
import urllib.request
from typing import Any, Callable

CHECK_ID = "axf-data"
MAX_AGE_S = 26 * 3600  # daily at 03:17 UTC plus slack
RESTART = "docker restart axf-data"
BACKUP = "docker exec axf-data python backup.py run"
BREAKS = "Console data has no fresh, verified backup (or the data container is down): a lost volume would lose notes, builds and settings."


def _get(path: str, timeout: float = 5.0) -> dict[str, Any]:
    url = os.environ.get("AXF_DATA_URL", "").rstrip("/")
    req = urllib.request.Request(f"{url}{path}", headers={"accept": "application/json"})
    tok = os.environ.get("AXF_DATA_TOKEN", "")
    if tok and not path.startswith("/v1/health"):
        req.add_header("authorization", f"Bearer {tok}")
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (operator-set internal URL)
        return json.loads(r.read())


def _age(iso: str, now: float) -> float | None:
    """Seconds since an ISO UTC stamp (`2026-11-15T03:17:00Z`), None when it doesn't parse."""
    try:
        return now - calendar.timegm(time.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S"))
    except (TypeError, ValueError):
        return None


def judge(health: dict[str, Any] | None, last: dict[str, Any] | None, now: float, err: str = "") -> dict[str, Any]:
    """Pure: the probe answer from /v1/health and /v1/_meta/backup (tests call this directly)."""
    if health is None:
        return {"status": "error", "unreachable": True, "summary": f"axf-data doesn't answer: {err or 'no reply'}.",
                "details": ["Auto fix restarts the container (veto call).", "By hand: docker logs axf-data; docker restart axf-data."]}
    if not last or not last.get("file"):
        return {"status": "error", "summary": "axf-data has no backup yet.",
                "details": ["Auto fix runs one now (veto call).", "By hand: docker exec axf-data python backup.py run"]}
    age = _age(str(last.get("at") or ""), now)
    hours = None if age is None else round(age / 3600, 1)
    v = last.get("verify") or {}
    details = [f"Newest backup {last['file']} ({hours} h old, {round(int(last.get('bytes') or 0) / 1048576, 1)} MB).",
               f"Store cursor {health.get('cursor')}, volume free {round(int((health.get('volume') or {}).get('freeBytes') or 0) / 1073741824, 1)} GB."]
    if not v.get("ok"):
        return {"status": "error", "summary": f"The last axf-data backup failed its check: {'; '.join((v.get('problems') or ['no verify result'])[:2])}.",
                "details": details + [str(p) for p in (v.get("problems") or [])[:6]]}
    if age is None or age > MAX_AGE_S:
        return {"status": "error", "summary": f"The newest axf-data backup is {hours} h old (daily expected).", "details": details}
    return {"status": "ok", "summary": f"axf-data is up; last backup {hours} h ago, verified.", "details": details}


def probe(now: float | None = None) -> dict[str, Any]:
    if not os.environ.get("AXF_DATA_URL"):
        return {"status": "warn", "summary": "axf-data isn't connected to this console yet (AXF_DATA_URL unset).",
                "details": ["Run deploy/install-data.sh on the VPS, then re-run the console installer so it picks up conf/env/console.env."]}
    now = time.time() if now is None else now
    try:
        health = _get("/v1/health")
    except (OSError, ValueError, urllib.error.URLError) as e:
        return judge(None, None, now, str(getattr(e, "reason", e))[:120])
    try:
        last = _get("/v1/_meta/backup").get("last")
    except (OSError, ValueError, urllib.error.URLError):
        last = None
    return judge(health, last, now)


def autofix(vps_run: Callable[[str], dict[str, Any]] | None) -> dict[str, Any]:
    if not callable(vps_run):
        return {"state": "failed", "message": f"No VPS route: run `{BACKUP}` (or `{RESTART}` when it is down) on the VPS."}
    p = probe()
    if p["status"] == "ok":
        return {"state": "done", "message": "axf-data is up and its backup is fresh."}
    return vps_run(RESTART if p.get("unreachable") else BACKUP)


def register(reg: Any, vps_run: Callable[[str], dict[str, Any]] | None, owner: str) -> str:
    return reg.register({"id": CHECK_ID, "label": "Data container backups (axf-data)", "service": "vps", "order": 33, "interval": 15 * 60,
                         "run": probe, "breaks": BREAKS,
                         "instructions": ["Backups run daily at 03:17 UTC into /root/hub/data/axf-data/backups (14 days plus weekly copies).",
                                          f"Back up now: {BACKUP}", f"Restart: {RESTART}",
                                          "Restore: see services/axf-data/backup.py (stop the container first)."],
                         "autoFix": {"label": "Run a backup or restart axf-data", "run": lambda: autofix(vps_run)}}, owner)
