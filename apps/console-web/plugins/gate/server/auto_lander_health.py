"""The server lander on the systems check (axf.health@1; lander@1, deploy/lander/run.mjs; auto-lander@1 before Nov 19 2026).

  gate-auto-lander   red when the auto-lander gave up on a build (attempts reached maxAttempts: what broke, since when,
                     the last attempt's log) or when its service stopped ticking (no tick for SERVICE_DOWN_MIN minutes);
                     amber while it is paused for more than PAUSED_H hours. Fix = "Reset and fix now": every escalated
                     build's attempts are reset and a fix session starts on the next tick (auto-lander.mjs fix <build>).

The phone push is the runner's own (deploy/auto-lander/escalate.mjs: one alert per escalated build, type
gate.auto-lander-escalated in notify.json), so this item is registered with push off: one push, never two.
Pure functions here (test_auto_lander.py drives them); routes.py registers the check and runs the CLI.
"""
from __future__ import annotations

import time
from datetime import datetime
from typing import Any, Callable

CAPABILITY = "axf.health@1"
OWNER = "gate"
CHECK_ID = "gate-auto-lander"
SERVICE_DOWN_MIN = 5
PAUSED_H = 12
KIND_WORD = {"clash": "merging main in", "red-ci": "fixing red CI", "land": "landing"}


def _ms(iso: str) -> float:
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp() * 1000
    except ValueError:
        return 0.0


def _when(iso: str) -> str:
    return str(iso or "").replace("T", " ")[:16] + " UTC" if iso else "an unknown time"


def check(st: dict[str, Any], now_ms: float) -> dict[str, Any]:
    """The verdict from one `auto-lander.mjs status --json` answer."""
    if not st or st.get("ok") is False:
        return {"status": "unknown", "summary": f"The auto-lander's status can't be read: {str((st or {}).get('message') or 'no answer')[:200]}", "unreachable": True}
    svc = st.get("service") or {}
    esc = st.get("escalations") or []
    if esc:
        first = esc[0]
        details = []
        for e in esc[:8]:
            last = " · ".join([x for x in str(e.get("log") or "").split("\n") if x.strip()][-2:])[:300]
            details.append(f"{e.get('build')}{' (#' + str(e['pr']) + ')' if e.get('pr') else ''}: {KIND_WORD.get(e.get('kind'), e.get('kind'))} failed "
                           f"{e.get('attempts')} times since {_when(e.get('since', ''))}. {e.get('why') or ''}{' Last attempt: ' + last if last else ''}".strip())
        more = f" and {len(esc) - 1} more" if len(esc) > 1 else ""
        return {"status": "error", "summary": f"The auto-lander gave up on {first.get('build')}{more}: {KIND_WORD.get(first.get('kind'), first.get('kind'))} "
                                              f"failed {first.get('attempts')} times since {_when(first.get('since', ''))}. Press Fix to reset and start a fix session.",
                "details": details, "link": f"view:gate/tab:gate.tabs=auto-lander/row:{first.get('build')}"}
    last = _ms(svc.get("lastTick", ""))
    if not last or now_ms - last > SERVICE_DOWN_MIN * 60000:
        since = _when(svc.get("lastTick", "")) if last else "it was installed"
        return {"status": "error", "summary": f"The auto-lander service hasn't ticked since {since}: nothing is fixed or landed by itself.",
                "details": ["On the VPS: systemctl status axf-lander.timer; journalctl -u axf-lander -n 50",
                            "Install or repair: sudo bash /opt/axf/deploy/install-console.sh (it installs the timer)"]}
    if svc.get("paused") and _ms(svc.get("pausedAt", "")) and now_ms - _ms(svc["pausedAt"]) > PAUSED_H * 3600000:
        return {"status": "warn", "summary": f"The auto-lander has been paused since {_when(svc.get('pausedAt', ''))} by {svc.get('pausedBy') or 'someone'}: nothing is fixed or landed by itself."}
    failing = st.get("failing") or []
    if failing:
        f = failing[0]
        more = f" and {len(failing) - 1} more" if len(failing) > 1 else ""
        return {"status": "warn", "summary": f"{f.get('build')}{more} failed {f.get('attempt')} times landing ({f.get('kind')}): {str(f.get('why') or '')[:160]} "
                                             "The lander keeps retrying by itself; nobody needs to act.",
                "details": [f"{x.get('build')}{' (#' + str(x['pr']) + ')' if x.get('pr') else ''}: attempt {x.get('attempt')}, {x.get('kind')}: {str(x.get('why') or '')[:200]}" for x in failing[:8]]}
    n = len(st.get("builds") or [])
    return {"status": "ok", "summary": f"The auto-lander is {'paused' if svc.get('paused') else 'running'}; {n} build{'' if n == 1 else 's'} tracked{', working on ' + st['current'] if st.get('current') else ''}."}


def fix_all(st: dict[str, Any], fix: Callable[[str], dict[str, Any]]) -> dict[str, Any]:
    """Reset and fix now: every escalated build. Answers the auto-fix shape {state, message}."""
    builds = [e.get("build") for e in (st.get("escalations") or []) if e.get("build")]
    if not builds:
        return {"state": "done", "message": "Nothing escalated: nothing to reset."}
    bad = [b for b in builds if not (fix(b) or {}).get("ok")]
    if bad:
        return {"state": "failed", "message": f"Couldn't reset {', '.join(bad)}."}
    return {"state": "started", "message": f"Reset {', '.join(builds)}: a fix session starts on the next tick (within a minute).", "waitS": 90}


def ensure(services: Any, status: Callable[[], dict[str, Any]], fix: Callable[[str], dict[str, Any]]) -> bool:
    """Register the check once the systems check provides axf.health@1 (call again until it lands)."""
    reg = services.get(CAPABILITY) if services is not None else None
    if reg is None:
        return False
    try:
        reg.register({"id": CHECK_ID, "label": "The auto-lander fixes and lands builds", "service": "github", "order": 31, "interval": 60,
                      "push": False,  # the runner pushes once per escalated build itself (notify.json gate.auto-lander-escalated)
                      "run": lambda: check(status(), time.time() * 1000),
                      "breaks": "Builds the server couldn't fix stop: their PRs don't land until someone looks.",
                      "autoFix": {"label": "Reset and fix now", "mode": "ask", "run": lambda: fix_all(status(), fix)},
                      "instructions": ["Press Fix (Reset and fix now): the attempts are reset and a fix session starts on the next tick.",
                                       "Or open Builds → VPS Configuration → Auto-lander, read the attempt log, and Retry one build.",
                                       "CLI: node deploy/lander/run.mjs status · fix <build>; MCP gate-auto-lander_retry."]}, OWNER)
    except Exception:  # noqa: BLE001 — the plugin works without its check
        return False
    return True
