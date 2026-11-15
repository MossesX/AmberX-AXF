"""Auto-lander routes (build auto-lander-controls-in-the-gate-plugin, Brett Nov 15 2026: "we need a control for the auto
lander, put it in the plugin we built today where we put the rules for the gate").

The gate's plugin shows and drives the auto-lander; the lander itself is the push banner's (land/land.mjs on the cron,
land/auto-lander.mjs for every control). Everything here goes through the capability `auto-lander@1`, never a folder
import, so either plugin can be removed: without the provider every route answers 503 with the reason.

  GET  auto-lander/status            switch, mode, last run (result, what it is landing, why it is not), line length
  GET  auto-lander/line              the landing line in order (position, PR, build, CI, state, conflict, skipped)
  GET  auto-lander/runs?limit=       the newest runs (auto-lander-run@1)
  GET  auto-lander/cron              the cron's live health (last run age and result)
  POST auto-lander/enabled           {enabled: bool}                  the one On/Off the cron reads
  POST auto-lander/mode              {mode: serial | merge-queue}
  POST auto-lander/line/move         {pr, direction: up | down}
  POST auto-lander/line/skip         {pr, why, confirm: true}         out of the line until unskipped
  POST auto-lander/line/unskip       {pr}
  POST auto-lander/line/land-now     {pr, confirm: true}              Brett's own click: to the head + a run now
"""
from __future__ import annotations

from typing import Any

from fastapi import Body, HTTPException, Request

import plugin_services

from . import brett_click, router

CAP = "auto-lander@1"


def lander() -> Any:
    svc = plugin_services.get(CAP)
    if svc is None:
        raise HTTPException(503, "The auto-lander is not available: the push banner (auto-lander@1) is switched off or not installed.")
    return svc


def _pr(body: Any) -> int:
    pr = body.get("pr") if isinstance(body, dict) else None
    if isinstance(pr, str) and pr.lstrip("#").isdigit():
        pr = int(pr.lstrip("#"))
    if not isinstance(pr, int) or isinstance(pr, bool) or pr <= 0:
        raise HTTPException(400, "send {pr: <PR number>}")
    return pr


@router.get("/auto-lander/status")
def lander_status() -> dict[str, Any]:
    return lander().status()


@router.get("/auto-lander/line")
def lander_line() -> dict[str, Any]:
    return lander().line()


@router.get("/auto-lander/runs")
def lander_runs(limit: int = 50) -> dict[str, Any]:
    return lander().runs(limit)


@router.get("/auto-lander/cron")
def lander_cron() -> dict[str, Any]:
    return lander().cron()


@router.post("/auto-lander/enabled")
def lander_enabled(body: Any = Body(None)) -> dict[str, Any]:
    if not isinstance(body, dict) or not isinstance(body.get("enabled"), bool):
        raise HTTPException(400, "send {enabled: true | false}")
    return lander().set_enabled(body["enabled"])


@router.post("/auto-lander/mode")
def lander_mode(body: Any = Body(None)) -> dict[str, Any]:
    if not isinstance(body, dict) or body.get("mode") not in ("serial", "merge-queue", "queue"):
        raise HTTPException(400, "send {mode: serial | merge-queue}")
    return lander().set_mode(body["mode"])


@router.post("/auto-lander/line/move")
def lander_move(body: Any = Body(None)) -> dict[str, Any]:
    pr = _pr(body)
    d = body.get("direction", "up")
    if d not in ("up", "down"):
        raise HTTPException(400, "direction is up or down")
    return lander().act(f"move-{d}", pr)


@router.post("/auto-lander/line/skip")
def lander_skip(body: Any = Body(None)) -> dict[str, Any]:
    pr = _pr(body)
    why = body.get("why") if isinstance(body.get("why"), str) else ""
    if not why.strip():
        raise HTTPException(400, "skip needs {why: <reason>}")
    return lander().act("skip", pr, why=why, confirm=body.get("confirm") is True)


@router.post("/auto-lander/line/unskip")
def lander_unskip(body: Any = Body(None)) -> dict[str, Any]:
    return lander().act("unskip", _pr(body))


@router.post("/auto-lander/line/land-now")
def lander_land_now(request: Request, body: Any = Body(None)) -> dict[str, Any]:
    pr = _pr(body)
    return lander().act("land-now", pr, confirm=body.get("confirm") is True, owner=brett_click(request))
