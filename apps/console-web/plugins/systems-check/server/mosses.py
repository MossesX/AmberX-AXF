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


# ---------------------------------------------------------------- Auto fix for everything else (Oct 23 2026)
# Brett: every check gets a fix. A check with no fixed command is handed to Mosses as a background task: he gets the
# check's details and works it out, running each command on the VPS through his axhub_call (Brett approves each one on
# the hub). If he can't (no model, no axHub, no Mosses) the job fails with exactly what's missing.
import threading  # noqa: E402
import time  # noqa: E402
from typing import Callable  # noqa: E402

TASK_PROMPT = """Fix this AXF Dev Console systems check on Brett's VPS. Don't ask him questions: do it.

Check: {title} (id {id}, service {service}, status {status})
What it says: {summary}
{details}{instructions}{command}
How to work:
- Run commands on the VPS only with axhub_call: tool "vps.run", arguments {{"command": "...", "timeout_seconds": 600}}, and a one-line reason. Each one waits for Brett's approval on axHub; keep each command small and clear.
- Read first (cat, ls, systemctl status, docker ps…), then fix with the smallest change. Never print secrets, never delete data, volumes or containers, never push to main.
- When you're done, run: bash /opt/axf/deploy/console-doctor.sh --report
- End with 2-4 short lines: what you ran, whether it's fixed, and if something truly needs Brett himself (a sign-in in a browser, a key only he has), exactly what he has to do."""


def task_prompt(c: dict[str, Any]) -> str:
    det = "".join(f"- {d}\n" for d in (c.get("details") or [])[:12])
    ins = "".join(f"- {d}\n" for d in (c.get("instructions") or [])[:12])
    fix = c.get("fix") or {}
    return TASK_PROMPT.format(id=c.get("id"), title=c.get("title"), service=c.get("service"), status=c.get("status"), summary=c.get("summary", ""),
                              details=f"Details:\n{det}" if det else "", instructions=f"How it's fixed by hand:\n{ins}" if ins else "",
                              command=f"Known fix command: {fix['command']}\n" if fix.get("type") == "host" and fix.get("command") else "")


def task_ready() -> tuple[bool, str]:
    ok, why = ready()
    if not ok:
        return ok, why
    if not hasattr(agents(), "run_task"):
        return False, "Update the agent manager: this version can't take tasks yet (needs the Oct 23 2026 build)."
    if plugin_services.get("axf.llm@1") is None:
        return False, "Mosses needs a model: install the AI assistant and add a provider (Settings → Plugins → AI assistant)."
    return True, ""


class Tasks:
    """One background Mosses task per check: asking → working → done / failed, then the check runs again."""

    def __init__(self, recheck: Callable[[str], Any], run: Callable[[str, str], dict[str, Any]] | None = None) -> None:
        self.recheck = recheck
        self.run_fn = run
        self.jobs: dict[str, dict[str, Any]] = {}
        self.lock = threading.RLock()

    def get(self, cid: str) -> dict[str, Any] | None:
        with self.lock:
            j = self.jobs.get(cid)
            return dict(j) if j else None

    def all(self) -> list[dict[str, Any]]:
        with self.lock:
            return [dict(j) for j in self.jobs.values()]

    def _set(self, cid: str, **kw: Any) -> None:
        with self.lock:
            self.jobs[cid].update(kw, updatedAt=time.time())

    def start(self, check: dict[str, Any]) -> dict[str, Any]:
        cid = str(check.get("id") or "")
        if not self.run_fn:
            ok, why = task_ready()
            if not ok:
                raise HubError(why)
        with self.lock:
            cur = self.jobs.get(cid)
            if cur and cur["state"] in ("asking", "working"):
                return dict(cur)
            self.jobs[cid] = {"id": cid, "state": "asking", "message": "Handed to Mosses…", "reply": "", "title": check.get("title") or cid,
                              "startedAt": time.time()}
        threading.Thread(target=self._run, args=(cid, task_prompt(check)), daemon=True).start()
        return self.get(cid) or {}

    def _run(self, cid: str, prompt: str) -> None:
        self._set(cid, state="working", message="Mosses is on it: approve his commands on axHub as they come in.")
        try:
            r = self.run_fn(MOSSES, prompt) if self.run_fn else agents().run_task(MOSSES, prompt)
            reply = str(r.get("text") or "").strip()
            ran = sum(1 for t in r.get("tools") or [] if isinstance(t, dict) and t.get("name") == TOOL)
            self._set(cid, state="done", reply=reply[-4000:], message=(reply.splitlines()[-1] if reply else "Mosses finished.")[:300], commands=ran)
        except Exception as e:  # noqa: BLE001
            self._set(cid, state="failed", message=f"Mosses couldn't finish: {str(e)[:250]}")
        try:
            self.recheck(cid)
        except Exception:  # noqa: BLE001
            pass
