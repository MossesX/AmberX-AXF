"""Claude on failure for the push banner (Oct 22 2026): a Pull main in that hits conflicts, or a Merge that GitHub refuses
(conflicts, failed CI, a GitHub error), is handed to headless Claude Code on the VPS when the setting is on.

Setting `claudeOnFail` (off). The launch is handed to Mosses (his `axhub_call` tool), who passes it to axHub's
`vps.run`, so nothing starts until Brett approves it on
the hub (the approval page shows the whole command, brief included). The command keeps one clone per repo in
`/root/axf-fixes/repos/<owner>-<name>` (git's own credentials on the VPS), makes a worktree on the entry's branch and
starts `claude -p` there in the background with the reporting variables set (`AXF_SURFACE=console-launch`,
`AXF_ADOPT_CHANGE=<entry id>`), so its hooks report onto the change-log entry opened here: it shows in the Build
manager's Live list and building banner.

What the session may run: setting `claudeShell` off (default) = file edits plus git only (fetch, merge, status, diff,
log, add, commit, and a push of HEAD to that one branch); on = any shell command. It never pushes to the default
branch, never force-pushes and never merges the PR: the banner's Merge stays Brett's.

One session per entry at a time; an entry isn't handed over again within COOLDOWN_S of the last launch.
"""
from __future__ import annotations

import base64
import gzip
import json
import os
import re
import threading
import time
from typing import Any, Callable

import plugin_services

CHANGES = "axf.changes@1"
COOLDOWN_S = 6 * 3600
WAIT_S = 30 * 60  # hub approvals expire after 30 minutes
WORK_ROOT = "/root/axf-fixes"
MAX_COMMAND = 6800  # axHub's ssh run refuses commands over 7000 characters (doubled Oct 23 2026, axHub needs the matching change)
REPO_RE = re.compile(r"[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}\Z")
BRANCH_RE = re.compile(r"(?!.*\.\.)(?!/)(?!-)(?!.*//)[A-Za-z0-9._/-]{1,200}\Z")
_CHG = re.compile(r"^chg-\d{8}-[0-9a-f]{6,16}$")


class HubError(Exception):
    pass


def sq(s: str) -> str:
    """Shell-safe single-quoted string."""
    return "'" + str(s).replace("'", "'\\''") + "'"


def entry_key(repo: str, number: int | None, branch: str) -> str:
    return f"{repo}:#{number}" if number else f"{repo}:{branch}"


def brief(t: dict[str, Any]) -> str:
    """What the session is asked to do. Data from GitHub and the failure only: no tokens."""
    what = f"pull request #{t['number']} ({t.get('title') or t['branch']})" if t.get("number") else f"branch {t['branch']}"
    lines = [f"# Fix {what} in {t['repo']} so it can reach {t['base']}", "",
             f"The Dev Console's push banner tried to {t['action']} and it failed: {t['failure'] or 'unknown'}.", "",
             f"- Repository: {t['repo']} (this folder is a worktree of it, on branch `{t['branch']}`)",
             f"- Base branch: `{t['base']}`"]
    if t.get("number"):
        lines.append(f"- Pull request: #{t['number']} {t.get('url') or ''}".rstrip())
    lines += ["", "What to do:",
              f"1. `git fetch origin`, then `git merge origin/{t['base']}` into `{t['branch']}`." if t["kind"] == "conflict"
              else f"1. Find why it can't merge (conflicts with `{t['base']}`, or failing CI on the head commit) and fix that on `{t['branch']}`.",
              "2. Resolve every conflict keeping both sides' intent; when unsure which side wins, keep both and say so in the commit.",
              "3. Run the repo's own fast checks for what you touched (its CLAUDE.md lists them).",
              f"4. Commit, then `git push origin HEAD:{t['branch']}`. CI runs again on the PR by itself.",
              "", "Rules:",
              f"- Push only to `{t['branch']}`. Never push to `{t['base']}` or any other branch, never force-push, never merge the PR.",
              "- Never print, copy or commit secrets (tokens, keys, .env files, .axf-console/).",
              "- If a conflict needs a decision only Brett can make, stop and say exactly what and why in your final message.",
              "- Record steps and the result on your change-log entry (the hooks do most of it)."]
    rest = [b for b in t.get("rest") or [] if b != t["branch"]]
    if rest:  # Pull all stopped at this one: the session finishes it (Brett, Oct 23 2026)
        lines[len(lines) - 6:len(lines) - 6] = [  # before "Rules:"
            "", f"Then finish the banner's Pull all: pull `{t['base']}` into each of these branches too, one at a time:",
            *[f"- `{b}`" for b in rest],
            f"For each: `git checkout -B <branch> origin/<branch>`, `git merge origin/{t['base']}`, resolve, run the checks, "
            f"`git push origin HEAD:<branch>`. If one can't be fixed, skip it, keep going, and list it at the end."]
        lines.append(f"- Pushes may also go to those branches (each only to itself); the base-branch and force rules hold for all of them.")
    if not t.get("shell"):
        lines.append("- You can edit files and run git only; list any other command Brett should run at the end.")
    return "\n".join(lines)


def launch_command(t: dict[str, Any], change_id: str, packed: bool = False) -> str:
    """The one command axHub's vps.run gets (Brett sees all of it on the approval page)."""
    repo, branch = t["repo"], t["branch"]
    if not REPO_RE.match(repo) or not all(BRANCH_RE.match(b) for b in [branch, t["base"], *(t.get("rest") or [])]) or t["base"] in (t.get("rest") or []):
        raise HubError("odd repo or branch name: not handed over")
    clone = f"{WORK_ROOT}/repos/{repo.replace('/', '-')}"
    work = f"{WORK_ROOT}/{repo.replace('/', '-')}--{re.sub(r'[^A-Za-z0-9._-]', '-', branch)[:80]}"
    raw = brief(t).encode()
    b64 = base64.b64encode(gzip.compress(raw, mtime=0) if packed else raw).decode()
    adopt = f" AXF_ADOPT_CHANGE={change_id}" if _CHG.match(change_id or "") else ""
    if t.get("shell"):
        tools = "--allowedTools Bash"
    else:  # git only, and a push of HEAD to this one branch
        allowed = ["Bash(git fetch:*)", "Bash(git merge:*)", "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)",
                   "Bash(git add:*)", "Bash(git commit:*)", "Bash(git checkout -- :*)", f"Bash(git push origin HEAD:{branch})"]
        if t.get("rest"):  # switching branches is local; each push still names its one branch
            allowed += ["Bash(git checkout -B:*)", *[f"Bash(git push origin HEAD:{b})" for b in t["rest"]]]
        tools = "--allowedTools " + " ".join(sq(a) for a in allowed)
    return "; ".join([
        "set -e",
        f"mkdir -p {sq(WORK_ROOT + '/repos')}",
        f"if [ ! -d {sq(clone)} ]; then git clone -q {sq('https://github.com/' + repo + '.git')} {sq(clone)}; fi",
        f"git -C {sq(clone)} fetch -q origin",
        f"git -C {sq(clone)} worktree prune",
        f"if [ -d {sq(work)} ]; then git -C {sq(work)} checkout -q -B {sq(branch)} {sq('origin/' + branch)}; "
        f"else git -C {sq(clone)} worktree add -q -B {sq(branch)} {sq(work)} {sq('origin/' + branch)}; fi",
        f"cd {sq(work)}",
        f"echo {sq(b64)} | base64 -d{' | gunzip' if packed else ''} > .axf-brief.md",
        f"export AXF_SURFACE=console-launch AXF_MODEL=opus{adopt} AXF_CLAUDE_AUTH=${{AXF_CLAUDE_AUTH:-plan}}",
        f'nohup claude -p --model opus --permission-mode acceptEdits {tools} "$(cat .axf-brief.md)" > .axf-fix.log 2>&1 &',
        'echo "started pid $! in $(pwd)"',
    ])


def fitted_command(t: dict[str, Any], change_id: str) -> str:
    return fit(t, change_id)[0]


def fit(t: dict[str, Any], change_id: str) -> tuple[str, list[str]]:
    """launch_command trimmed until it fits the hub's limit (extra Pull all branches first, then failure and title);
    also the extra branches that made it in."""
    t = {**t, "rest": list(t.get("rest") or [])}
    for _ in range(60):
        cmd = launch_command(t, change_id)
        if len(cmd) > MAX_COMMAND and t["rest"]:  # a Pull all hand-over: gzip the brief before dropping branches
            cmd = launch_command(t, change_id, packed=True)
        if len(cmd) <= MAX_COMMAND:
            return cmd, t["rest"]
        if t.get("rest"):  # drop the last extra branch first: it stays in "Needs main pulled in"
            t["rest"] = t["rest"][:-1]
            continue
        t["failure"] = str(t.get("failure", ""))[:-80]
        t["title"] = str(t.get("title", ""))[:-40]
    raise HubError("The brief is too long to send through axHub.")


# ---------------------------------------------------------------- through Mosses (Brett, Oct 22 2026)
# Every Auto fix goes through Mosses, the agent with root and build permission: the push banner never calls axHub
# itself. His `axhub_call` tool (agent manager, capability axf.agents@1) passes the launch to axHub's vps.run, where it
# still waits for Brett's approval.
AGENTS = "axf.agents@1"
MOSSES = os.environ.get("AXF_MOSSES_AGENT", "coder")  # the Mosses add-on agent's id
TOOL = "axhub_call"


def mosses_ready() -> tuple[bool, str]:
    svc = plugin_services.get(AGENTS)
    a = svc.get_agent(MOSSES) if svc else None
    if not a:
        return False, "Fixes go through Mosses: install the agent manager with Mosses (the “coder” add-on)."
    if not any(t.get("name") == TOOL for t in a.get("tools") or []):
        return False, "Mosses can't reach axHub yet: allow him dangerous tools in Settings → Plugins → Agent manager → Safety, and update his add-on to 2.1 or later."
    return True, ""


VINNY_SVC = "axf.vinny@1"


def vinny() -> Any:
    """Vinny's command book when he takes Auto fixes now (Oct 24 2026: Vinny first, then Mosses, then Claude)."""
    svc = plugin_services.get(VINNY_SVC)
    try:
        return svc if svc is not None and svc.ready()[0] and svc.auto_fix_first() else None
    except Exception:  # noqa: BLE001
        return None


def call_hub(tool: str, arguments: dict[str, Any], confirmation_id: str | None = None, timeout: float = 180) -> dict[str, Any]:
    """axHub's `call`, through Vinny's axhub_call first, else Mosses's: {"ok": text} | {"confirm": id}, else HubError.
    Never falls back once Brett rejected it or the approval expired."""
    v = vinny()
    if v is not None:
        try:
            return v.call(tool, {**arguments, "timeout_seconds": int(arguments.get("timeout_seconds") or timeout)}, confirmation_id, timeout,
                          "Push banner: fix a failed pull or merge")
        except Exception as e:  # noqa: BLE001
            m = str(e).lower()
            if "reject" in m or "expired" in m:
                raise HubError(str(e)[:400]) from None
    ok, why = mosses_ready()
    if not ok:
        raise HubError(why)
    args: dict[str, Any] = {"tool": tool, "arguments": {**arguments, "timeout_seconds": int(arguments.get("timeout_seconds") or timeout)},
                            "wait": False, "reason": "Push banner: fix a failed pull or merge"}
    if confirmation_id:
        args["confirmation_id"] = confirmation_id
    try:
        r = json.loads(plugin_services.get(AGENTS).run_tool(MOSSES, TOOL, args))
    except Exception as e:  # noqa: BLE001 — the agent manager's own refusal, or an answer that isn't JSON
        raise HubError(f"Mosses couldn't take it: {str(e)[:200]}") from None
    if r.get("status") == "confirm" and r.get("confirmationId"):
        return {"confirm": str(r["confirmationId"])}
    if r.get("status") == "ok":
        return {"ok": str(r.get("output", ""))}
    raise HubError(str(r.get("message") or "axHub refused it")[:400])


def retry_delays() -> list[float]:
    """Approval retries: the first 10 every 15 seconds, then every minute (shared rule, Oct 21 2026)."""
    return [15.0] * 10 + [60.0] * 40


class Launches:
    """One headless Claude Code session per failing entry: ask the hub, wait for the approval, report on the entry."""

    def __init__(self, settings: Callable[[], dict[str, Any]], call: Callable[..., dict[str, Any]] = call_hub,
                 delays: Callable[[], list[float]] = retry_delays, changes: Callable[[], Any] = lambda: plugin_services.get(CHANGES),
                 vinny_svc: Callable[[], Any] = vinny, sleep: Callable[[float], None] = time.sleep) -> None:
        self.vinny_svc = vinny_svc
        self.sleep = sleep
        self.settings = settings
        self.call = call
        self.delays = delays
        self.changes = changes
        self.jobs: dict[str, dict[str, Any]] = {}
        self.lock = threading.RLock()  # maybe_launch reads a job back (get) while it holds the lock

    def get(self, key: str) -> dict[str, Any] | None:
        with self.lock:
            j = self.jobs.get(key)
            return {k: v for k, v in j.items() if k != "command"} if j else None

    def all(self) -> list[dict[str, Any]]:
        """Every hand-over; a launched one carries `fixed` = its change-log entry's status (running / done / failed), so the
        banner knows when to try the pull again."""
        with self.lock:
            out = [{k: v for k, v in j.items() if k != "command"} for j in self.jobs.values()]
        svc = plugin_services.get(CHANGES)
        for j in out:
            if j["state"] == "launched" and j.get("changeId") and svc is not None:
                try:
                    e = svc.get(j["changeId"]) or {}
                except Exception:  # noqa: BLE001
                    e = {}
                st = e.get("status") or (e.get("result") or {}).get("state")
                j["fixed"] = "done" if st == "done" else "failed" if st in ("failed", "partial", "cancelled") else "running"
        return out

    def _set(self, key: str, **kw: Any) -> None:
        with self.lock:
            self.jobs[key].update(kw, updatedAt=time.time())

    def maybe_launch(self, t: dict[str, Any], *, force: bool = False, by_hand: bool = False) -> dict[str, Any] | None:
        """t = {repo, branch, base, number?, title?, url?, kind: conflict|merge, action, failure}. None when the setting is
        off or the names are odd; the running/recent job when one exists (`force` skips the cooldown, never a running one)."""
        s = self.settings()
        if not (s.get("claudeOnFail") or by_hand) or not REPO_RE.match(str(t.get("repo", ""))) or not BRANCH_RE.match(str(t.get("branch", ""))):
            return None
        key = entry_key(t["repo"], t.get("number"), t["branch"])
        with self.lock:
            cur = self.jobs.get(key)
            if cur and cur["state"] in ("asking", "waiting"):
                return self.get(key)
            if cur and not force and time.time() - float(cur.get("startedAt", 0)) < COOLDOWN_S:
                return self.get(key)
            self.jobs[key] = {"key": key, "state": "asking", "message": "Handing it to Mosses, who asks axHub to start Claude Code on the VPS…", "changeId": "",
                              "startedAt": time.time(), "title": t.get("title") or t["branch"], "repo": t["repo"], "branch": t["branch"],
                              "failure": str(t.get("failure", ""))[:300]}
        t = {**t, "shell": bool(s.get("claudeShell"))}
        change_id = self._open_entry(t)
        try:
            cmd, sent = fit(t, change_id)
        except HubError as e:
            self._fail(key, change_id, str(e))
            return self.get(key)
        self._set(key, changeId=change_id, command=cmd, rest=sent)
        threading.Thread(target=self._chain, args=(key, cmd, change_id, t), daemon=True).start()
        return self.get(key)

    def _open_entry(self, t: dict[str, Any]) -> str:
        svc = self.changes()
        if not svc:
            return ""
        what = f"#{t['number']}" if t.get("number") else t["branch"]
        try:
            e = svc.open({"kind": "fix", "title": f"Fix {t['repo'].split('/')[-1]} {what}: {t['action']} failed"[:160],
                          "asked": f"Push banner: {t['action']} failed ({str(t.get('failure', ''))[:200]}); handed to headless Claude Code on the VPS.",
                          "model": "opus", "repos": [t["repo"]], "status": "queued", "surface": "console-launch", "branch": t["branch"],
                          "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()), "who": {"where": "console", "host": "console"},
                          "steps": [{"text": "Approve on axHub", "state": "running"},
                                    {"text": f"Fix and push {t['branch']} ({'shell allowed' if t.get('shell') else 'edits + git only'})", "state": "queued"},
                                    {"text": "CI runs again on the branch", "state": "queued"}]}, "push-banner")
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

    def _fail(self, key: str, change_id: str, msg: str) -> None:
        self._set(key, state="failed", message=msg)
        self._update(change_id, {"status": "failed", "result": {"state": "failed", "summary": msg[:300]}})

    def _chain(self, key: str, cmd: str, change_id: str, t: dict[str, Any]) -> None:
        """Vinny's mapped command for this failure first (no model); if he has none or it fails, launch Claude."""
        if self._vinny(key, change_id, t):
            return
        self._run(key, cmd, change_id)

    def _vinny(self, key: str, change_id: str, t: dict[str, Any]) -> bool:
        v = self.vinny_svc()
        if v is None:
            return False
        text = f"{t.get('action', '')} failed {t.get('kind', '')} {t.get('failure', '')} {t['repo']} {t['branch']}"
        ctx = {"repo": t["repo"], "branch": t["branch"], **({"number": str(t["number"])} if t.get("number") else {})}
        try:
            run = v.start_fix(key, text, ctx, "push-banner")
        except Exception:  # noqa: BLE001
            return False
        if not run or not run.get("id"):
            return False
        self._set(key, state="waiting", message=f"Vinny is running “{run.get('name')}” first: approve it on axHub.")
        self._update(change_id, {"doing": f"Vinny runs “{run.get('name')}” (no model) before Claude"})
        end = time.time() + WAIT_S + 15 * 60
        while run.get("state") in ("asking", "waiting", "running") and time.time() < end:
            self.sleep(3)
            run = v.get_run(run["id"]) or run
        if run.get("rejected"):
            self._fail(key, change_id, "Rejected on the hub.")
            return True
        if run.get("state") == "done":
            self._set(key, state="launched", message=f"Fixed by Vinny ({run.get('name')}): pulling again.", agent="vinny")
            self._update(change_id, {"status": "done", "doing": f"Vinny ran “{run.get('name')}”",
                                     "result": {"state": "done", "summary": f"Vinny's mapped command “{run.get('name')}” ran (no model)."}})
            return True
        self._set(key, state="asking", message=f"Vinny's “{run.get('name')}” didn't work; handing it to Claude Code…")
        return False

    def _run(self, key: str, cmd: str, change_id: str) -> None:
        args = {"command": cmd, "timeout_seconds": 300}
        try:
            r = self.call("vps.run", args, None, 360)
            if "confirm" in r:
                conf = r["confirm"]
                self._set(key, state="waiting", message="Approve it on axHub (it shows the whole command and brief).")
                self._update(change_id, {"doing": "Waiting for approval on axHub"})
                deadline = time.time() + WAIT_S
                waits = iter(self.delays())
                while "confirm" in r:
                    if time.time() > deadline:
                        self._fail(key, change_id, "The approval expired."); return
                    time.sleep(next(waits, 60.0))
                    try:
                        r = self.call("vps.run", args, conf, 360)
                    except HubError as e:
                        m = str(e).lower()
                        self._fail(key, change_id, "Rejected on the hub." if "reject" in m else "The approval expired." if "expired" in m else str(e)); return
            out = r.get("ok", "")
            if '"status": "started"' in out or not re.search(r"^exit 0\b", out, re.M):
                tail = out.strip().splitlines()[-1] if out.strip() else "no output"
                self._fail(key, change_id, f"Couldn't start Claude Code on the VPS: {tail}"[:300]); return
            self._set(key, state="launched", message="Claude Code is fixing it on the VPS: follow it in the building banner.")
            self._update(change_id, {"status": "running", "doing": "Launched on the VPS (headless Claude Code)",
                                     "lastSeenAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())})
        except HubError as e:
            self._fail(key, change_id, str(e))
        except Exception as e:  # noqa: BLE001
            self._fail(key, change_id, f"Launch stopped ({type(e).__name__}).")
