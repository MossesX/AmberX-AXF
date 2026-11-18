"""Held PRs on the systems check (axf.health@1; gate-rules@1 lander-state@1 heldSince / holdReason / reviewFlag).

  held-prs   lists every PR the lander truly holds (state held, kicked or paused) with the PR, its build, the reason and how
             long it has been held. Red once any of them is older than the gate setting heldAlertMin (Settings → Plugins →
             Gate → Held PR alert after; default 60 min); pushed once to the AmberX app by the health monitor (push on).
             Fix = Land now: the PR goes to the front of the merge queue with an override note (POST /api/plugins/gate/land-now,
             a two-step confirm; never a direct merge). The item's fix carries one row per PR (type `prs`) with its console-control
             address `grid:held-prs/row:<n>` and the action `gate.land-now:<n>`; the item's Auto fix (mode ask) lands the oldest.

Build auto-lander-never-wait-missing-ui-review (Nov 18 2026). Brett: "If it recorded the test of the pipeline and didn't
merge it on its own, then the test failed." Pure functions here (test_held_prs.py drives them); routes.py registers the
check and runs the gate CLI (`gate.mjs api held_prs`, `gate.mjs api land_now`).
"""
from __future__ import annotations

from typing import Any, Callable

CAPABILITY = "axf.health@1"
OWNER = "gate"
CHECK_ID = "held-prs"
LINK = "view:gate/tab:gate.tabs=auto-lander"
ROW = "grid:held-prs/row:{pr}"  # console-control@1: the item is row:held-prs, each PR a row under grid:held-prs (the grammar has no `pr` segment)


def _dur(minutes: Any) -> str:
    m = max(0, int(minutes or 0))
    if m < 120:
        return f"{m} min"
    if m < 48 * 60:
        return f"{m // 60} h {m % 60:02d}"
    return f"{m // 1440} d"


def _when(iso: str) -> str:
    return str(iso or "").replace("T", " ")[:16] + " UTC" if iso else "an unknown time"


def _line(x: dict[str, Any]) -> str:
    who = f"#{x.get('pr')}" + (f" {x.get('build')}" if x.get("build") else "")
    flag = f" · UI Review {x['reviewFlag']}" if x.get("reviewFlag") else ""
    return f"{who}: held {_dur(x.get('heldMin'))} since {_when(x.get('heldSince', ''))} ({x.get('state')}){flag} — {x.get('holdReason') or x.get('reason') or 'no reason recorded'}"[:300]


def fix_rows(over: list[dict[str, Any]]) -> dict[str, Any]:
    """The item's fix: one Land now row per PR past the limit (the systems check draws a button per row)."""
    return {"type": "prs", "label": "Land now", "items": [
        {"pr": x.get("pr"), "build": x.get("build") or "", "title": x.get("title") or "", "state": x.get("state") or "held", "heldMin": int(x.get("heldMin") or 0), "heldSince": x.get("heldSince") or "",
         "reason": (x.get("holdReason") or x.get("reason") or "")[:300], "reviewFlag": x.get("reviewFlag") or "",
         "action": f"gate.land-now:{x.get('pr')}", "target": ROW.format(pr=x.get("pr")), "route": "POST /api/plugins/gate/land-now", "cli": f"axf gate land-now {x.get('pr')}"}
        for x in over]}


def check(resp: dict[str, Any]) -> dict[str, Any]:
    """The verdict from one `gate.mjs api held_prs` answer (held-prs@1)."""
    if not resp or resp.get("ok") is False:
        return {"status": "unknown", "summary": f"The held PRs can't be read: {str((resp or {}).get('message') or 'no answer')[:200]}", "unreachable": True}
    items = [x for x in (resp.get("items") or []) if isinstance(x, dict)]
    limit = int(resp.get("limitMin") or 60)
    over = sorted([x for x in items if x.get("over")], key=lambda x: -int(x.get("heldMin") or 0))
    if not over:
        n = len(items)
        return {"status": "ok", "summary": f"{n} PR{'' if n == 1 else 's'} held by the lander, none older than {limit} min." if n else f"Nothing is held by the lander (alert after {limit} min).",
                "details": [_line(x) for x in items[:12]], "link": LINK}
    first = over[0]
    more = f" and {len(over) - 1} more" if len(over) > 1 else ""
    summary = (f"#{first.get('pr')}{' (' + str(first.get('build')) + ')' if first.get('build') else ''} has been held {_dur(first.get('heldMin'))}{more}, longer than "
               f"the {limit} min limit: {str(first.get('holdReason') or first.get('reason') or 'no reason recorded')[:160]} Press Land now to put it at the front of the merge queue.")
    return {"status": "error", "summary": summary[:400], "details": [_line(x) for x in over[:12]], "link": LINK, "fix": fix_rows(over),
            "breaks": "A finished build sits unmerged: nothing it shipped reaches main or the live console until it lands."}


def land_oldest(resp: dict[str, Any], land: Callable[[int, str], dict[str, Any]], by: str = "systems-check") -> dict[str, Any]:
    """The item's Auto fix (mode ask): Land now for the PR held longest past the limit. Answers the auto-fix shape {state, message}."""
    v = check(resp)
    over = (v.get("fix") or {}).get("items") or []
    if not over:
        return {"state": "done", "message": "Nothing is held past the limit: nothing to land."}
    pr = int(over[0]["pr"])
    r = land(pr, by) or {}
    if r.get("ok"):
        return {"state": "started", "message": f"#{pr} is at the front of the merge queue (override noted); it lands once its run is green.", "waitS": 120, "link": ROW.format(pr=pr)}
    return {"state": "failed", "message": f"Couldn't land #{pr} now: {str(r.get('message') or 'the lander refused')[:200]}"}


def ensure(services: Any, held: Callable[[], dict[str, Any]], land: Callable[[int, str], dict[str, Any]]) -> bool:
    """Register the check once the systems check provides axf.health@1 (call again until it lands)."""
    reg = services.get(CAPABILITY) if services is not None else None
    if reg is None:
        return False
    try:
        reg.register({"id": CHECK_ID, "label": "PRs the lander holds", "service": "github", "order": 32, "interval": 120,
                      "run": lambda: check(held()),
                      "breaks": "A finished build sits unmerged: nothing it shipped reaches main or the live console until it lands.",
                      "autoFix": {"label": "Land now (held longest)", "mode": "ask", "run": lambda: land_oldest(held(), land)},
                      "instructions": ["Press Land now on a PR: it goes to the front of the merge queue with an override note (it still passes every rule; never a direct merge).",
                                       "Or open Builds → Gate & rules → Auto-lander to see why each one is held; a UI Review that holds is approved in UI Review.",
                                       "CLI: axf gate held-prs · axf gate land-now <pr>; REST GET /api/plugins/gate/held-prs · POST /api/plugins/gate/land-now; MCP gate_held_prs · gate_land_now; voice: land 816 now.",
                                       "The limit is Settings → Plugins → Gate → Held PR alert after (axf gate settings set heldAlertMin 90)."]}, OWNER)
    except Exception:  # noqa: BLE001 — the plugin works without its check
        return False
    return True
