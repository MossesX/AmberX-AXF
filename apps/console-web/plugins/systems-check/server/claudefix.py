"""Claude on failure (Oct 22 2026): when a systems check fix fails, hand the check to headless Claude Code on the VPS.

Setting `claudeOnFail` (off by default). Any failed fix starts it: a VPS Auto fix that ran and failed, a server-side fix
that failed or left the check failing, or an item Fix all marks failed. A fix Brett *rejected* on the hub never does.

One way to start builds (Brett, Nov 9 2026: "It has to be the orchestrator"): the fix is filed as a build with the
Build orchestrator (capability ``axf.build-dispatch@1``) straight into its Queue, priority High. Its dispatcher picks the
account and model and starts it in the build's own worktree; this module never runs a launcher or asks axHub `vps.run`.
The job record keeps the build id, and the change-log entry opened here says where it went.

Setting `claudeShell` (off by default) decides what the session may do: off = read and edit files only (it reports the
commands it would run); on = it may also run shell commands on the VPS (as root). Never merges or pushes to main.

One session per check at a time, and a check isn't handed over again within COOLDOWN_S of the last launch.
"""
from __future__ import annotations

import re
import threading
import time
from typing import Any, Callable

import plugin_services

CHANGES = "axf.changes@1"
COOLDOWN_S = 6 * 3600
DISPATCH = "axf.build-dispatch@1"
_ID = re.compile(r"^[a-z0-9][a-z0-9:._-]{0,80}$")
_CHG = re.compile(r"^chg-\d{8}-[0-9a-f]{6,16}$")


def sq(s: str) -> str:
    """Shell-safe single-quoted string."""
    return "'" + str(s).replace("'", "'\\''") + "'"


def branch_for(cid: str) -> str:
    return "fix/syscheck-" + re.sub(r"[^a-z0-9._-]", "-", cid.lower())[:60]


def brief(check: dict[str, Any], failure: str, shell: bool) -> str:
    """What the headless session is asked to do. Data from the check only: no keys, no tokens."""
    lines = [
        f"# Fix a failing AXF Dev Console systems check: {check.get('title') or check.get('id')}",
        "",
        "The console's systems check reported this, and its automatic fix failed. Fix the cause, then re-check.",
        "",
        f"- Check id: `{check.get('id')}` (service {check.get('service', '?')}, status {check.get('status', '?')})",
        f"- What it says: {check.get('summary', '')}",
        f"- How the fix failed: {failure or 'unknown'}",
    ]
    if check.get("details"):
        lines += ["", "Details:", *[f"- {d}" for d in check["details"][:12]]]
    if check.get("instructions"):
        lines += ["", "How it's fixed by hand:", *[f"- {d}" for d in check["instructions"][:12]]]
    fix = check.get("fix") or {}
    if fix.get("type") == "host" and fix.get("command"):
        lines += ["", f"Its fix command on the VPS: `{fix['command']}`"]
    lines += ["", "Rules:",
              "- Fix only this check. Change nothing unrelated; never delete data, volumes, containers or other people's files.",
              "- Never print, copy or commit secrets (tokens, keys, .env files, .axf-console/).",
              "- Code changes go on this build's branch only: commit and push the branch, never main, never merge.",
              "- When done, refresh the host report: `bash /opt/axf/deploy/console-doctor.sh --report`.",
              "- Record steps and the result on your change-log entry (the hooks do most of it; `changes.mjs step|result last …`)."]
    if shell:
        lines.append("- You may run shell commands on the VPS (you run as root): prefer the smallest, reversible change.")
    else:
        lines.append("- You can read and edit files but not run commands: end with the exact commands Brett should run, in order.")
    return "\n".join(lines)


class Launches:
    """One headless Claude Code session per failing check: ask the hub, wait for the approval, report on the entry."""

    def __init__(self, settings: Callable[[], dict[str, Any]], changes: Callable[[], Any] = lambda: plugin_services.get(CHANGES),
                 dispatch: Callable[[], Any] = lambda: plugin_services.get(DISPATCH)) -> None:
        self.settings = settings
        self.dispatch = dispatch
        self.changes = changes
        self.jobs: dict[str, dict[str, Any]] = {}
        self.lock = threading.Lock()

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

    def maybe_launch(self, check: dict[str, Any], failure: str, *, force: bool = False, approved: bool = False) -> dict[str, Any] | None:
        """Start a session for a failed fix when the setting is on. None when it's off, the check is fine, or one was
        started for this check recently (`force` skips the cooldown, never a running session). `approved` = Brett
        approved it in the Fix failed dialog (Oct 28 2026): it starts without the setting; axHub still asks again."""
        s = self.settings()
        cid = str(check.get("id") or "")
        if not (s.get("claudeOnFail") or approved) or not _ID.match(cid) or check.get("status") in ("ok", "info"):
            return None
        with self.lock:
            cur = self.jobs.get(cid)
            if cur and cur["state"] in ("asking", "waiting"):
                return dict(cur)
            if cur and not force and time.time() - float(cur.get("startedAt", 0)) < COOLDOWN_S:
                return dict(cur)
            self.jobs[cid] = {"id": cid, "state": "asking", "message": "Sending it to the Build orchestrator's Queue…", "changeId": "",
                              "confirmationId": None, "startedAt": time.time(), "title": check.get("title") or cid, "failure": failure[:300]}
        shell = bool(s.get("claudeShell"))
        change_id = self._open_entry(check, failure, shell)
        self._set(cid, changeId=change_id)
        self._dispatch(cid, change_id, check, brief(check, failure, shell))
        return self.get(cid)

    def _open_entry(self, check: dict[str, Any], failure: str, shell: bool) -> str:
        """The change-log entry the session reports on: what puts it in the Build manager's building banner."""
        svc = self.changes()
        if not svc:
            return ""
        try:
            e = svc.open({"kind": "fix", "title": f"Fix: {check.get('title') or check.get('id')}"[:160],
                          "asked": f"Systems check fix failed ({failure[:200]}); handed to headless Claude Code on the VPS.",
                          "model": "opus", "repos": ["MossesX/AmberX-AXF"], "status": "queued", "surface": "console-launch",
                          "branch": branch_for(str(check.get("id"))), "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
                          "who": {"where": "console", "host": "console"},
                          "steps": [{"text": "In the Build orchestrator's Queue", "state": "running"},
                                    {"text": f"Fix ({'shell allowed' if shell else 'read + edit only'}): the orchestrator starts it", "state": "queued"},
                                    {"text": "Check again", "state": "queued"}]}, "systems-check")
            return str(e.get("id") or "")
        except Exception:  # noqa: BLE001 — the launch still happens without the log entry
            return ""

    def _update(self, change_id: str, patch: dict[str, Any]) -> None:
        svc = self.changes()
        if svc and change_id:
            try:
                svc.update(change_id, patch)
            except Exception:  # noqa: BLE001
                pass

    def _fail(self, cid: str, change_id: str, msg: str) -> None:
        self._set(cid, state="failed", message=msg)
        self._update(change_id, {"status": "failed", "result": {"state": "failed", "summary": msg[:300]}})

    def _dispatch(self, cid: str, change_id: str, check: dict[str, Any], text: str) -> None:
        """File the fix with the Build orchestrator, straight into its Queue (High). Its dispatcher starts it."""
        svc = self.dispatch()
        if svc is None:
            self._fail(cid, change_id, "The Build orchestrator is off: fixes start only from its Queue (Settings → Plugins → Build orchestrator).")
            return
        title = f"Fix systems check: {check.get('title') or cid}"[:200]
        try:
            r = svc.request(title, text[:8000], by="systems-check", source="systems-check", priority="P1", queue=True)
        except Exception as e:  # noqa: BLE001 — the orchestrator's own refusal
            self._fail(cid, change_id, f"The orchestrator did not take it: {getattr(e, 'detail', None) or e}"[:300])
            return
        bid = str(r.get("id") or "")
        self._set(cid, state="launched", build=bid, message=f"In the Build orchestrator's Queue as {bid}: it starts the fix when a slot is free.")
        self._update(change_id, {"doing": f"Queued with the Build orchestrator as {bid}"})
