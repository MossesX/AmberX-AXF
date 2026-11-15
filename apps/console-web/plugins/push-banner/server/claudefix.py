"""Claude on failure for the push banner (Oct 22 2026): a Pull main in that hits conflicts, or a Merge that GitHub refuses
(conflicts, failed CI, a GitHub error), is handed to headless Claude Code on the VPS when the setting is on.

Setting `claudeOnFail` (off). Vinny's mapped command runs first when he has one (no model). Otherwise the job is filed as
a build with the Build orchestrator (capability ``axf.build-dispatch@1``) straight into its Queue, priority High (Brett,
Nov 9 2026: "only one way to start builds … the orchestrator"). Its dispatcher starts the session; the brief opens with
the setup (one clone per repo in `/root/axf-fixes/repos/<owner>-<name>`, a worktree on the entry's branch) and the
session works there. This module never runs a launcher or asks axHub `vps.run` for a Claude session.

What the session may run: setting `claudeShell` off (default) = file edits plus git only (fetch, merge, status, diff,
log, add, commit, and a push of HEAD to that one branch); on = any shell command. It never pushes to the default
branch, never force-pushes and never merges the PR: the banner's Merge stays Brett's.

One session per entry at a time; an entry isn't handed over again within COOLDOWN_S of the last launch.
"""
from __future__ import annotations

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
HELPER = "/opt/axf/deploy/claude-headless.sh"  # the console's own checkout on the VPS


DISPATCH = "axf.build-dispatch@1"
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
             f"- Repository: {t['repo']} (the setup above makes a worktree of it, on branch `{t['branch']}`)",
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


def setup(t: dict[str, Any]) -> str:
    """The brief's first section: where the session works (the orchestrator starts it in its own build worktree)."""
    repo, branch = t["repo"], t["branch"]
    if not REPO_RE.match(repo) or not all(BRANCH_RE.match(b) for b in [branch, t["base"], *(t.get("rest") or [])]) or t["base"] in (t.get("rest") or []):
        raise HubError("odd repo or branch name: not handed over")
    clone = f"{WORK_ROOT}/repos/{repo.replace('/', '-')}"
    work = f"{WORK_ROOT}/{repo.replace('/', '-')}--{re.sub(r'[^A-Za-z0-9._-]', '-', branch)[:80]}"
    return "\n".join([
        "## Setup (run first, then work only in that folder)", "```",
        f"mkdir -p {sq(WORK_ROOT + '/repos')}",
        f"[ -d {sq(clone)} ] || git clone -q {sq('https://github.com/' + repo + '.git')} {sq(clone)}",
        f"git -C {sq(clone)} fetch -q origin && git -C {sq(clone)} worktree prune",
        f"if [ -d {sq(work)} ]; then git -C {sq(work)} checkout -q -B {sq(branch)} {sq('origin/' + branch)}; "
        f"else git -C {sq(clone)} worktree add -q -B {sq(branch)} {sq(work)} {sq('origin/' + branch)}; fi",
        f"cd {sq(work)}", "```",
        "Do no work in the orchestrator's own build folder: it only hosts this session. Tick the build's steps there when done.", ""])


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


class Launches:
    """One headless Claude Code session per failing entry: ask the hub, wait for the approval, report on the entry."""

    def __init__(self, settings: Callable[[], dict[str, Any]], changes: Callable[[], Any] = lambda: plugin_services.get(CHANGES),
                 vinny_svc: Callable[[], Any] = vinny, sleep: Callable[[float], None] = time.sleep,
                 dispatch: Callable[[], Any] = lambda: plugin_services.get(DISPATCH)) -> None:
        self.vinny_svc = vinny_svc
        self.sleep = sleep
        self.settings = settings
        self.dispatch = dispatch
        self.changes = changes
        self.jobs: dict[str, dict[str, Any]] = {}
        self.lock = threading.RLock()  # maybe_launch reads a job back (get) while it holds the lock

    def get(self, key: str) -> dict[str, Any] | None:
        with self.lock:
            j = self.jobs.get(key)
            return {k: v for k, v in j.items() if k != "command"} if j else None

    def all(self) -> list[dict[str, Any]]:
        """Every hand-over; a launched one carries `fixed` = how it went (running / done / failed): the orchestrator build's
        status when it went to the Queue, else its change-log entry's (Vinny), so the banner knows when to try the pull again."""
        with self.lock:
            out = [{k: v for k, v in j.items() if k != "command"} for j in self.jobs.values()]
        svc = plugin_services.get(CHANGES)
        disp = self.dispatch()
        for j in out:
            if j["state"] == "launched" and j.get("build") and disp is not None:
                try:
                    st = str((disp.build(j["build"]) or {}).get("status") or "")
                except Exception:  # noqa: BLE001
                    st = ""
                j["fixed"] = "done" if st in ("built", "complete") else "failed" if st in ("failed", "archived") else "running"
                continue
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
            self.jobs[key] = {"key": key, "state": "asking", "message": "Handing it over: Vinny's mapped command first, else the Build orchestrator's Queue…", "changeId": "",
                              "startedAt": time.time(), "title": t.get("title") or t["branch"], "repo": t["repo"], "branch": t["branch"],
                              "failure": str(t.get("failure", ""))[:300]}
        t = {**t, "shell": bool(s.get("claudeShell"))}
        change_id = self._open_entry(t)
        try:
            setup(t)
        except HubError as e:
            self._fail(key, change_id, str(e))
            return self.get(key)
        self._set(key, changeId=change_id, rest=list(t.get("rest") or []))
        threading.Thread(target=self._chain, args=(key, change_id, t), daemon=True).start()
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
                          "steps": [{"text": "Vinny first, else the Build orchestrator's Queue", "state": "running"},
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

    def _chain(self, key: str, change_id: str, t: dict[str, Any]) -> None:
        """Vinny's mapped command for this failure first (no model); if he has none or it fails, the orchestrator's Queue."""
        if self._vinny(key, change_id, t):
            return
        self._dispatch(key, change_id, t)

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
        self._set(key, state="asking", message=f"Vinny's “{run.get('name')}” didn't work; sending it to the Build orchestrator…")
        return False

    def _dispatch(self, key: str, change_id: str, t: dict[str, Any]) -> None:
        """File the fix with the Build orchestrator, straight into its Queue (High). Its dispatcher starts it."""
        svc = self.dispatch()
        if svc is None:
            self._fail(key, change_id, "The Build orchestrator is off: fixes start only from its Queue (Settings → Plugins → Build orchestrator).")
            return
        what = f"#{t['number']}" if t.get("number") else t["branch"]
        title = f"Fix {t['repo'].split('/')[-1]} {what}: {t['action']} failed"[:200]
        try:
            r = svc.request(title, f"{setup(t)}\n{brief(t)}"[:8000], by="push-banner", source="push-banner", priority="P1", queue=True)
        except Exception as e:  # noqa: BLE001 — the orchestrator's own refusal
            self._fail(key, change_id, f"The orchestrator did not take it: {getattr(e, 'detail', None) or e}"[:300])
            return
        bid = str(r.get("id") or "")
        self._set(key, state="launched", build=bid, message=f"In the Build orchestrator's Queue as {bid}: it starts the fix when a slot is free.")
        self._update(change_id, {"doing": f"Queued with the Build orchestrator as {bid}"})
