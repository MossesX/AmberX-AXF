"""Merge watch (merge-watch@1) over REST: every merge to main sent to Shipped features, its state and its controls.

Mounted under /api/plugins/shipped-features (the plugin's router includes this one). One Node implementation behind
every surface: framework/cli/merge-watch.mjs (the CLI `axf merge-watch`, MCP plugin commands and voice call the same).

    GET  /merge-watch                    state: on/off, last sha, counts, pending / failed, last send, alert, where
    GET  /merge-watch/list?state=&since= the merges it saw (newest first): sha, PR, build, state, tries, error, manifest
    POST /merge-watch/send      {sha, force?, dry?}   send one merge now (force: again even when sent)
    POST /merge-watch/retry     {shas?}               failed merges back to pending and sent now (all when none named)
    POST /merge-watch/backfill  {since, dry?}         every merge since the date with no manifest (dry: list only)
    POST /merge-watch/switch    {enabled}             on / off (off: ticks do nothing; the state is kept)
    POST /merge-watch/tick      {dry?}                one tick now (what the cron and the landing paths run)

No panel inside Shipped features (Brett, Nov 16 07:14): the Gate & rules plugin's 'Send Shipped features' rule shows
these (console_show view:gate/tab:gate.tabs=build-rules, row shipped-features).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

router = APIRouter()
ROOT = Path(__file__).resolve().parents[5]
CLI = ROOT / "framework" / "cli" / "merge-watch.mjs"
SHA = re.compile(r"^[0-9a-fA-F]{7,40}$")
STATES = ("pending", "sent", "failed", "skipped")
DEEP_LINK = {"console_show": "view:gate/tab:gate.tabs=build-rules", "row": "shipped-features", "href": "#/gate"}


def _run(*args: str, timeout: int = 300) -> dict[str, Any]:
    env = {**os.environ, "AXF_ACTOR": os.environ.get("AXF_ACTOR", "console")}
    try:
        p = subprocess.run(["node", str(CLI), *args, "--json"], cwd=str(ROOT), capture_output=True, text=True, timeout=timeout, env=env)
    except subprocess.TimeoutExpired as e:
        raise HTTPException(504, f"merge-watch {args[0]} took longer than {timeout} s") from e
    try:
        body = json.loads(p.stdout.strip().splitlines()[-1]) if p.stdout.strip() else {}
    except ValueError:
        body = {}
    if p.returncode == 3 or body.get("locked"):
        raise HTTPException(409, "another merge-watch tick is running; try again in a minute")
    if p.returncode == 2:
        raise HTTPException(400, body.get("error") or (p.stderr.strip().splitlines() or ["bad input"])[-1][:400])
    if not body:
        raise HTTPException(500, (p.stderr.strip().splitlines() or [f"merge-watch {args[0]} failed"])[-1][:400])
    return body  # ok: false (a send that failed) is an answer, not an error: the caller sees which merge and why


@router.get("/merge-watch")
def state() -> dict[str, Any]:
    """On/off, last sha, counts, pending / failed, last send, the alert, where the state lives, the deep link."""
    return {**_run("status", timeout=60), "link": DEEP_LINK}


@router.get("/merge-watch/list")
def entries(state: str = "", since: str = "") -> dict[str, Any]:
    if state and state not in STATES:
        raise HTTPException(400, f"state is one of {', '.join(STATES)}")
    if since and not re.match(r"^\d{4}-\d{2}-\d{2}", since):
        raise HTTPException(400, "since is a date (YYYY-MM-DD)")
    return _run("list", *(["--state", state] if state else []), *(["--since", since[:25]] if since else []), timeout=60)


@router.post("/merge-watch/send")
def send(body: dict[str, Any]) -> dict[str, Any]:
    sha = str(body.get("sha") or "").strip()
    if not SHA.match(sha):
        raise HTTPException(400, "sha is a commit sha on main (7-40 hex)")
    return _run("send", sha, *(["--force"] if body.get("force") else []), *(["--dry"] if body.get("dry") else []), timeout=300)


@router.post("/merge-watch/retry")
def retry(body: dict[str, Any] | None = None) -> dict[str, Any]:
    shas = [str(s).strip() for s in ((body or {}).get("shas") or []) if SHA.match(str(s).strip())][:100]
    return _run("retry", *shas, timeout=900)


@router.post("/merge-watch/backfill")
def backfill(body: dict[str, Any]) -> dict[str, Any]:
    since = str(body.get("since") or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}", since):
        raise HTTPException(400, "since is a date (YYYY-MM-DD)")
    return _run("backfill", "--since", since[:25], *(["--dry"] if body.get("dry") else []), timeout=1800)


@router.post("/merge-watch/switch")
def switch(body: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(body.get("enabled"), bool):
        raise HTTPException(400, "enabled is true or false")
    return _run("on" if body["enabled"] else "off", timeout=30)


@router.post("/merge-watch/tick")
def tick(body: dict[str, Any] | None = None) -> dict[str, Any]:
    return _run("tick", *(["--dry"] if (body or {}).get("dry") else []), timeout=600)
