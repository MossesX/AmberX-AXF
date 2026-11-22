"""Is `main` protected on GitHub? A systems-check item (axf.health@1), read-only.

  gate-main-protection   amber while the ruleset "main: green PRs only" (deploy/branch-protection.mjs) is not on GitHub
                         or is switched off: CI gating then lives only in the lander, and a hand merge or any token
                         with write access can put red code on main (audit finding L2-09, Nov 21 2026).

Nothing here changes repository settings: applying the ruleset is Brett's decision, so the item has no Fix button,
only the exact steps. The answer comes from `node deploy/branch-protection.mjs show --json`, which only reads.
Pure functions here (test_auto_lander.py drives them); routes.py registers the check and runs the CLI.
"""
from __future__ import annotations

from typing import Any, Callable

CAPABILITY = "axf.health@1"
OWNER = "gate"
CHECK_ID = "gate-main-protection"
STEPS = [
    "See the exact ruleset and what GitHub has now (changes nothing): node deploy/branch-protection.mjs show",
    "1. Make the status snapshot's deploy key, the ruleset's only bypass: node deploy/branch-protection.mjs status-key --yes",
    "2. Turn it on: node deploy/branch-protection.mjs apply --yes",
    "It needs a token that can manage repository settings: AXF_GITHUB_ADMIN_TOKEN (Administration: read and write).",
    "Emergency path afterwards: node deploy/branch-protection.mjs off --yes --why \"<reason>\", merge, then apply again. The lander records a hand merge by itself.",
]


def check(show: dict[str, Any]) -> dict[str, Any]:
    """The verdict from one `branch-protection.mjs show --json` answer."""
    if not show or show.get("ok") is False:
        return {"status": "unknown", "summary": f"Branch protection can't be read: {str((show or {}).get('message') or 'no answer')[:200]}", "unreachable": True}
    if show.get("error"):
        return {"status": "unknown", "summary": f"GitHub did not say whether main is protected: {str(show['error'])[:200]}", "unreachable": True, "details": STEPS[:1]}
    cur = show.get("current")
    want = [c.get("context") for r in (show.get("ruleset") or {}).get("rules", []) if r.get("type") == "required_status_checks"
            for c in (r.get("parameters") or {}).get("required_status_checks", [])]
    if not cur:
        return {"status": "warn", "summary": "main is not protected on GitHub: a hand merge or any token with write access can put red code on main. "
                                             "Waiting for Brett to turn the ruleset on.",
                "details": [f"Recommended: pull requests only, {len(want)} required checks, branch up to date before merging, no force pushes, deploy-key-only bypass."] + STEPS}
    if cur.get("enforcement") != "active":
        return {"status": "warn", "summary": f"The main ruleset is on GitHub but switched off (enforcement: {cur.get('enforcement') or 'unknown'}): main is not protected.",
                "details": ["Turn it on again: node deploy/branch-protection.mjs apply --yes"] + STEPS[:1]}
    have = [c.get("context") for r in cur.get("rules") or [] if r.get("type") == "required_status_checks"
            for c in (r.get("parameters") or {}).get("required_status_checks", [])]
    lost = [c for c in want if c not in have]
    if lost:
        return {"status": "warn", "summary": f"main is protected, but {len(lost)} required check(s) of the repo's ruleset are not on GitHub: {', '.join(lost)[:200]}.",
                "details": ["Bring GitHub in line: node deploy/branch-protection.mjs apply --yes"] + STEPS[:1]}
    return {"status": "ok", "summary": f"main only takes green, up-to-date pull requests ({len(have)} required checks)."}


def ensure(services: Any, show: Callable[[], dict[str, Any]]) -> bool:
    """Register the check once the systems check provides axf.health@1 (call again until it lands)."""
    reg = services.get(CAPABILITY) if services is not None else None
    if reg is None:
        return False
    try:
        reg.register({"id": CHECK_ID, "label": "main only takes green pull requests", "service": "github", "order": 32, "interval": 3600,
                      "push": False,  # a standing decision, not an incident
                      "run": lambda: check(show()),
                      "breaks": "Red code can reach main without CI; the builds store then disagrees with GitHub.",
                      "instructions": STEPS}, OWNER)
    except Exception:  # noqa: BLE001 — the plugin works without its check
        return False
    return True
