"""Claude on failure (Oct 22 2026): when a systems check fix fails, hand the check to headless Claude Code on the VPS.

Setting `claudeOnFail` (off by default). Any failed fix starts it: a VPS Auto fix that ran and failed, a server-side fix
that failed or left the check failing, or an item Fix all marks failed. A fix Brett *rejected* on the hub never does.

The launch is handed to Mosses (his `axhub_call` tool, mosses.py), who passes it to axHub's `vps.run`, so nothing starts until Brett approves it on the hub (the approval page
shows the whole command, the brief included). The command makes a worktree of the console's clone on branch
`fix/syscheck-<check>`, writes the brief there and starts `claude -p` in the background with the reporting variables
set (`AXF_SURFACE=console-launch`, `AXF_ADOPT_CHANGE=<entry id>`), so the session's Claude Code hooks report onto the
change-log entry opened here: it shows in the Build manager's Live list and its building banner, and in Activity.

Setting `claudeShell` (off by default) decides what the session may do: off = read and edit files only (it reports the
commands it would run); on = it may also run shell commands on the VPS (as root). Never merges or pushes to main.

One session per check at a time, and a check isn't handed over again within COOLDOWN_S of the last launch.
"""
from __future__ import annotations

import base64
import re
import threading
import time
from typing import Any, Callable

import plugin_services

from . import hostfix

CHANGES = "axf.changes@1"
COOLDOWN_S = 6 * 3600
WAIT_S = 30 * 60  # hub approvals expire after 30 minutes
REPO_DIR = "/opt/axf"
WORK_ROOT = "/root/axf-fixes"
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
              "- Code changes go on this worktree's branch only: commit and push the branch, never main, never merge.",
              "- When done, refresh the host report: `bash /opt/axf/deploy/console-doctor.sh --report`.",
              "- Record steps and the result on your change-log entry (the hooks do most of it; `changes.mjs step|result last …`)."]
    if shell:
        lines.append("- You may run shell commands on the VPS (you run as root): prefer the smallest, reversible change.")
    else:
        lines.append("- You can read and edit files but not run commands: end with the exact commands Brett should run, in order.")
    return "\n".join(lines)


def launch_command(text: str, cid: str, change_id: str, shell: bool, model: str = "opus") -> str:
    """The one command axHub's vps.run gets (Brett sees all of it on the approval page). The brief goes in base64 so no
    quoting can break out; the session runs in the background so the hub call returns at once."""
    br = branch_for(cid)
    work = f"{WORK_ROOT}/{br.replace('/', '-')}"
    b64 = base64.b64encode(text.encode()).decode()
    adopt = f" AXF_ADOPT_CHANGE={change_id}" if _CHG.match(change_id or "") else ""
    m = model if model in ("fable", "opus", "sonnet") else "opus"
    perms = "--permission-mode acceptEdits" + (" --allowedTools Bash" if shell else "")
    return "; ".join([
        "set -e",
        f"mkdir -p {sq(WORK_ROOT)}",
        f"git -C {sq(REPO_DIR)} fetch -q origin",
        f"if [ ! -d {sq(work)} ]; then git -C {sq(REPO_DIR)} worktree add -q -B {sq(br)} {sq(work)} origin/main; fi",
        f"cd {sq(work)}",
        f"echo {sq(b64)} | base64 -d > .axf-brief.md",
        f"export AXF_SURFACE=console-launch AXF_MODEL={m}{adopt} AXF_CLAUDE_AUTH=${{AXF_CLAUDE_AUTH:-plan}}",
        f'nohup claude -p --model {m} {perms} "$(cat .axf-brief.md)" > .axf-fix.log 2>&1 &',
        'echo "started pid $! in $(pwd)"',
    ])


MAX_COMMAND = 3400  # axHub's ssh run refuses commands over 3500 characters (approvals must stay readable)


def fitted_command(check: dict[str, Any], failure: str, cid: str, change_id: str, shell: bool) -> str:
    """launch_command with the brief trimmed until the whole command fits the hub's limit: details first, then the
    hand-fix steps, then the summary and failure text."""
    c = dict(check)
    for _ in range(60):
        cmd = launch_command(brief(c, failure, shell), cid, change_id, shell)
        if len(cmd) <= MAX_COMMAND:
            return cmd
        if c.get("details"):
            c["details"] = c["details"][:-1]
        elif c.get("instructions"):
            c["instructions"] = c["instructions"][:-1]
        else:
            c["summary"] = str(c.get("summary", ""))[:-200]
            failure = failure[:-100]
    raise hostfix.HubError("The brief is too long to send through axHub.")


def retry_delays() -> list[float]:
    """Approval retries: the first 10 every 15 seconds, then every minute (shared rule, Oct 21 2026)."""
    return [15.0] * 10 + [60.0] * 40


class Launches:
    """One headless Claude Code session per failing check: ask the hub, wait for the approval, report on the entry."""

    def __init__(self, settings: Callable[[], dict[str, Any]], call: Callable[..., dict[str, Any]] = hostfix.call_hub,
                 delays: Callable[[], list[float]] = retry_delays, changes: Callable[[], Any] = lambda: plugin_services.get(CHANGES)) -> None:
        self.settings = settings
        self.call = call
        self.delays = delays
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

    def maybe_launch(self, check: dict[str, Any], failure: str, *, force: bool = False) -> dict[str, Any] | None:
        """Start a session for a failed fix when the setting is on. None when it's off, the check is fine, or one was
        started for this check recently (`force` skips the cooldown, never a running session)."""
        s = self.settings()
        cid = str(check.get("id") or "")
        if not s.get("claudeOnFail") or not _ID.match(cid) or check.get("status") in ("ok", "info"):
            return None
        with self.lock:
            cur = self.jobs.get(cid)
            if cur and cur["state"] in ("asking", "waiting"):
                return dict(cur)
            if cur and not force and time.time() - float(cur.get("startedAt", 0)) < COOLDOWN_S:
                return dict(cur)
            self.jobs[cid] = {"id": cid, "state": "asking", "message": "Handing it to Mosses, who asks axHub to start Claude Code on the VPS…", "changeId": "",
                              "confirmationId": None, "startedAt": time.time(), "title": check.get("title") or cid, "failure": failure[:300]}
        shell = bool(s.get("claudeShell"))
        change_id = self._open_entry(check, failure, shell)
        try:
            cmd = fitted_command(check, failure, cid, change_id, shell)
        except hostfix.HubError as e:
            self._fail(cid, change_id, str(e))
            return self.get(cid)
        self._set(cid, changeId=change_id, command=cmd, branch=branch_for(cid))
        threading.Thread(target=self._run, args=(cid, cmd, change_id), daemon=True).start()
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
                          "steps": [{"text": "Approve on axHub", "state": "running"},
                                    {"text": f"Fix ({'shell allowed' if shell else 'read + edit only'}): headless Claude Code on the VPS", "state": "queued"},
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

    def _run(self, cid: str, cmd: str, change_id: str) -> None:
        args = {"command": cmd, "timeout_seconds": 120}
        try:
            r = self.call("vps.run", args, None, 180)
            if "confirm" in r:
                conf = r["confirm"]
                self._set(cid, state="waiting", confirmationId=conf, message="Approve it on axHub (it shows the whole command and brief).")
                self._update(change_id, {"doing": "Waiting for approval on axHub"})
                deadline = time.time() + WAIT_S
                waits = iter(self.delays())
                while "confirm" in r:
                    if time.time() > deadline:
                        self._fail(cid, change_id, "The approval expired."); return
                    time.sleep(next(waits, 60.0))
                    try:
                        r = self.call("vps.run", args, conf, 180)
                    except hostfix.HubError as e:
                        m = str(e).lower()
                        self._fail(cid, change_id, "Rejected on the hub." if "reject" in m else "The approval expired." if "expired" in m else str(e)); return
            out = r.get("ok", "")
            if not re.search(r"^exit 0\b", out, re.M):
                self._fail(cid, change_id, "Couldn't start Claude Code on the VPS: " + (out.strip().splitlines()[-1] if out.strip() else "no output")[:200]); return
            self._set(cid, state="launched", message="Claude Code is working on it on the VPS: follow it in the building banner.")
            self._update(change_id, {"status": "running", "doing": "Launched on the VPS (headless Claude Code)",
                                     "lastSeenAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())})
        except hostfix.HubError as e:
            self._fail(cid, change_id, str(e))
        except Exception as e:  # noqa: BLE001
            self._fail(cid, change_id, f"Launch stopped ({type(e).__name__}).")
