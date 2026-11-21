"""Is Brett's approval default applied on axHub? A systems-check item (axf.health@1), read-only.

  vps-approval-default   amber while axHub still holds more than VPS shell commands on the veto countdown (Brett,
                         Nov 12 and Nov 21 2026: "It's only supposed to be for writes on the VPS."), or while staged
                         approval rule edits wait for his Save.

Nothing here changes axHub's policy: only Brett's own click does (Builds → VPS Configuration → Approval rules), so the
item has no Fix button, only the exact steps. The answer is approval-rules@1 (approval-rules.mjs status), which only
reads. Pure functions here (server/test_routes.py drives them); routes.py registers the check and runs the CLI.
"""
from __future__ import annotations

from typing import Any, Callable

CAPABILITY = "axf.health@1"
OWNER = "gate"
CHECK_ID = "vps-approval-default"
WHERE = "Builds → VPS Configuration → Approval rules"
STEPS = [
    f"Open {WHERE} in the console, signed in as Brett (deep link: console_show view:gate/tab:gate.tabs=approvals).",
    "Press Apply the default and confirm. It is sent from Brett's own browser session to axHub; a session, MCP, the CLI and voice cannot do it.",
    "After it: only vps run and launch, the console terminal run and Vinny command run hold on the veto countdown. Model upgrades keep their confirm, deletes keep their approval.",
    "See what is there now (changes nothing): axf gate approvals",
]


def check(view: dict[str, Any]) -> dict[str, Any]:
    """The verdict from one approval-rules@1 answer."""
    if not view or view.get("ok") is False:
        return {"status": "unknown", "summary": f"The approval rules can't be read: {str((view or {}).get('message') or 'no answer')[:200]}", "unreachable": True}
    if not view.get("available"):
        return {"status": "warn", "summary": f"The approval rules can't be shown, so the veto countdown can't be narrowed to VPS shell commands: {str(view.get('message') or 'axHub did not answer')[:200]}",
                "details": ["It needs axHub's policy API with match-pattern rules (axHub decisions 119 and 121) deployed on the live hub."]}
    pending = int(view.get("pending") or 0)
    draft = view.get("draft") or {}
    if not (view.get("default") or {}).get("applied"):
        held = sum(int((s.get("counts") or {}).get("veto") or 0) for s in view.get("services") or [] if s.get("service") in ("axf-console", "vps"))
        return {"status": "warn", "summary": f"The veto countdown still holds more than VPS shell commands: {held} console and VPS tools wait on it. Waiting for Brett to apply the default.",
                "details": STEPS}
    if pending:
        who = f" by {draft.get('by')}" if draft.get("by") else ""
        return {"status": "warn", "summary": f"Approval rule edits for {pending} service{'s' if pending != 1 else ''} are staged{who} and wait for Brett's Save.",
                "details": [f"Open {WHERE}: Save sends them to axHub, Discard draft drops them.", STEPS[3]]}
    return {"status": "ok", "summary": "Only VPS shell commands hold on the veto countdown; everything else in the console runs at once."}


def ensure(services: Any, read: Callable[[], dict[str, Any]]) -> bool:
    """Register the check once the systems check provides axf.health@1 (call again until it lands)."""
    reg = services.get(CAPABILITY) if services is not None else None
    if reg is None:
        return False
    try:
        reg.register({"id": CHECK_ID, "label": "Veto countdown only on VPS shell commands", "service": "axhub", "order": 33, "interval": 900,
                      "push": False,  # a standing decision of Brett's, not an incident
                      "run": lambda: check(read()),
                      "breaks": "Screen opens, overlays and other console calls wait out the veto countdown before they run.",
                      "instructions": STEPS}, OWNER)
    except Exception:  # noqa: BLE001 — the plugin works without its check
        return False
    return True
