"""Gate & rules on the systems check (axf.health@1, optional) and its alerts (notify.json types gate.*).

  gate-lander   red when the lander is stuck: a PR has been landing for more than STUCK_MIN minutes, or the last run
                ended in an error; amber while it is paused for more than PAUSED_H hours or switched off. The lander's
                state comes from the plugin's own `lander_status` (the same record as GET lander and lander_status).
  gate-build-slots   amber when steps in parallel (pipeline setting) is above the host cap (the VPS hard build limit):
                the extra steps wait. Only Brett raises the host cap, so the item carries his exact steps.
Alerts (raised by the server part): `gate:lander-paused` while the lander is paused; `gate:pr-held:<pr>:<rule>` once per
PR and rule when a waiting PR fails a gate rule and needs a fix; both resolve by themselves.
Pure functions here (test_routes.py drives them); the server part registers and calls them.
"""
from __future__ import annotations

import time
from datetime import datetime
from typing import Any, Callable

CAPABILITY = "axf.health@1"
OWNER = "gate"
CHECK_ID = "gate-lander"
STUCK_MIN = 90
PAUSED_H = 12
SOURCE = "gate"
PAUSED_KEY = "gate:lander-paused"
HELD_PREFIX = "gate:pr-held:"


SLOTS_CHECK_ID = "gate-build-slots"


def slots_check(slots: dict[str, Any]) -> dict[str, Any]:
    """The verdict from one build-slots answer (GET build-slots): amber when more steps are allowed than the host runs."""
    steps, cap = slots.get("stepsInParallel") or {}, slots.get("hostCap") or {}
    if not steps.get("available") or not cap.get("available"):
        return {"status": "ok", "summary": "Steps in parallel or the host cap can't be read right now; nothing to compare."}
    if steps["value"] <= cap["value"]:
        return {"status": "ok", "summary": f"Steps in parallel is {steps['value']}, the host cap is {cap['value']}."}
    return {"status": "warn", "summary": f"Steps in parallel is {steps['value']} but the host cap is {cap['value']}: at most {cap['value']} run at once.",
            "details": [f"Brett: Settings → Plugins → Gate → Builds at once → Host cap → {steps['value']} → Save (your own signed-in console).",
                        "Or lower Steps in parallel there to match the host cap."]}


def ensure_slots(services: Any, read: Callable[[], dict[str, Any]]) -> bool:
    """Register the build-slots check once the systems check provides axf.health@1."""
    reg = services.get(CAPABILITY) if services is not None else None
    if reg is None:
        return False
    try:
        reg.register({"id": SLOTS_CHECK_ID, "label": "Steps in parallel fit under the host cap", "service": "builds", "order": 57, "severity": "warn",
                      "run": lambda: slots_check(read()),
                      "breaks": "Steps beyond the host cap wait for a free place, so a build runs fewer steps at once than its setting says.",
                      "instructions": ["Brett only: Settings → Plugins → Gate → Builds at once → raise Host cap to the Steps in parallel number → Save, from your own signed-in console.",
                                       "Anyone: lower Steps in parallel there (or `pipeline.mjs set stepsInParallel=<n>`) to the host cap."]}, OWNER)
    except Exception:  # noqa: BLE001 — the plugin works without its check
        return False
    return True


def _ms(iso: str) -> float:
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp() * 1000
    except ValueError:
        return 0.0


def _ago(ms: float, now_ms: float) -> str:
    m = max(0, int((now_ms - ms) / 60000))
    return f"{m} min" if m < 120 else f"{m // 60} h"


def lander_check(st: dict[str, Any], now_ms: float) -> dict[str, Any]:
    """The verdict from one lander_status answer."""
    if not st.get("ok"):
        return {"status": "error", "summary": f"The gate can't read the lander: {str(st.get('message') or 'no answer')[:200]}"}
    landing = st.get("landing") or None
    if landing and _ms(landing.get("since", "")) and now_ms - _ms(landing["since"]) > STUCK_MIN * 60000:
        return {"status": "error", "summary": f"The lander is stuck: #{landing.get('pr')} has been landing for {_ago(_ms(landing['since']), now_ms)}.",
                "details": [f"#{landing.get('pr')} {landing.get('title') or landing.get('build') or ''}".strip()]}
    last = st.get("lastRun") or {}
    if st.get("status") == "error" or last.get("result") == "error":
        return {"status": "error", "summary": f"The lander's last run failed: {str(last.get('error') or st.get('error') or last.get('reasonText') or 'no reason given')[:200]}"}
    pause = st.get("pause") or {}
    if st.get("paused") and _ms(pause.get("at", "")) and now_ms - _ms(pause["at"]) > PAUSED_H * 3600000:
        return {"status": "warn", "summary": f"The auto-lander has been paused for {_ago(_ms(pause['at']), now_ms)}{': ' + pause['why'] if pause.get('why') else ''}. Nothing lands until it is resumed."}
    if st.get("status") == "off":
        return {"status": "warn", "summary": "The auto-lander is switched off: finished builds don't land."}
    mode = "merge queue" if st.get("mergeQueue") else "one at a time"
    return {"status": "ok", "summary": f"The auto-lander is {st.get('status', 'idle')} ({mode}); {int((st.get('counts') or {}).get('waiting', 0))} waiting."}


def held_alerts(waiting: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One alert per waiting PR that fails a gate rule and needs a fix (not one that only waits)."""
    out = []
    for w in waiting:
        g = w.get("gate") or {}
        if not g or g.get("pass") or g.get("held") or not w.get("rule"):
            continue
        out.append({"source": SOURCE, "key": f"{HELD_PREFIX}{w['pr']}:{w['rule']}", "severity": "warning",
                    "title": f"#{w['pr']} is held by the {w['rule']} rule"[:160], "body": str(w.get("reason") or (g.get("reasons") or [""])[0])[:400],
                    "link": "view:gate/tab:gate.tabs=auto-lander"})
    return out


def paused_alert(st: dict[str, Any]) -> dict[str, Any] | None:
    if not st.get("paused"):
        return None
    p = st.get("pause") or {}
    return {"source": SOURCE, "key": PAUSED_KEY, "severity": "warning", "title": "The auto-lander is paused",
            "body": f"Paused by {p.get('by') or 'someone'}{': ' + p['why'] if p.get('why') else ''}. Nothing new lands until it is resumed.",
            "link": "view:gate/tab:gate.tabs=auto-lander"}


def ensure(services: Any, status: Callable[[], dict[str, Any]]) -> bool:
    """Register the check once the systems check provides axf.health@1 (plugins load in any order: call again until it lands)."""
    reg = services.get(CAPABILITY) if services is not None else None
    if reg is None:
        return False
    try:
        reg.register({"id": CHECK_ID, "label": "The auto-lander is landing PRs", "service": "github", "order": 30,
                      "run": lambda: lander_check(status(), time.time() * 1000),
                      "breaks": "Finished builds stop landing on main: the line grows and nothing merges.",
                      "instructions": ["Open Builds → Gate & rules → Auto-lander (or `axf gate lander status`) and read why.",
                                       "Paused: press Resume (`axf gate lander resume`). Stuck on one PR: Land now another, or hold the stuck one in the push banner's merge queue.",
                                       "A red last run: the reason is in the Last runs grid; the lander tries again next round."]}, OWNER)
    except Exception:  # noqa: BLE001 — the plugin works without its check
        return False
    return True
