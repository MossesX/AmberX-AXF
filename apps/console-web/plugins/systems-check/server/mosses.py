"""Every Auto fix goes through Mosses (Brett, Oct 22 2026): he's the agent with root and build permission, so the systems
check never calls axHub itself. Fixed commands (VPS Auto fix) and the "Claude on failure" launch are handed to Mosses's
`axhub_call` tool through the agents capability (`axf.agents@1` → run_tool), and he passes them on to axHub, where
`vps.run` still waits for Brett's approval. No agent manager, no Mosses, or Mosses not allowed dangerous tools in
Settings → Safety = no Auto fix (it says which).

call(tool, arguments, confirmation_id, timeout) → {"ok": text} | {"confirm": id}, else HubError (hostfix's), so the
VPS Auto fix jobs and their approval pop-up work as before.
"""
from __future__ import annotations

import json
from typing import Any

import plugin_services

from .derive import MOSSES
from .hostfix import HubError

AGENTS = "axf.agents@1"
TOOL = "axhub_call"


def agents() -> Any:
    return plugin_services.get(AGENTS)


def ready() -> tuple[bool, str]:
    """Can Mosses take an Auto fix right now? (False, why) otherwise."""
    svc = agents()
    if svc is None:
        return False, "Auto fix goes through Mosses: install the agent manager with Mosses (the “coder” add-on)."
    a = svc.get_agent(MOSSES)
    if not a:
        return False, "Auto fix goes through Mosses: install him (Agent manager → Add-on agents → coder)."
    if not any(t.get("name") == TOOL for t in a.get("tools") or []):
        return False, ("Mosses can't reach axHub yet: allow him dangerous tools in Settings → Plugins → Agent manager → Safety, "
                       "and update his add-on to 2.1 or later.")
    return True, ""


def call(tool: str, arguments: dict[str, Any], confirmation_id: str | None = None, timeout: float = 600) -> dict[str, Any]:
    ok, why = ready()
    if not ok:
        raise HubError(why)
    args: dict[str, Any] = {"tool": tool, "arguments": {**arguments, "timeout_seconds": int(arguments.get("timeout_seconds") or timeout)},
                            "wait": False, "reason": "Systems check Auto fix"}
    if confirmation_id:
        args["confirmation_id"] = confirmation_id
    try:
        raw = agents().run_tool(MOSSES, TOOL, args)
    except Exception as e:  # noqa: BLE001 — the agent manager's own refusal (e.g. the tool was switched off meanwhile)
        raise HubError(f"Mosses couldn't take it: {str(e)[:200]}") from None
    try:
        r = json.loads(raw)
    except Exception:  # noqa: BLE001
        raise HubError("Mosses answered something that isn't the axHub result") from None
    if r.get("status") == "confirm" and r.get("confirmationId"):
        return {"confirm": str(r["confirmationId"])}
    if r.get("status") == "ok":
        return {"ok": str(r.get("output", ""))}
    raise HubError(str(r.get("message") or "axHub refused it")[:400])
