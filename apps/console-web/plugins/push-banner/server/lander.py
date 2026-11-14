"""The server lander (Nov 13 2026, build "Server: every failed merge alerts Brett immediately and retries by itself until
merged"). Every merge attempt goes through `Lander.attempt`, whoever asks: the console's Merge button (POST /merge),
auto-merge, Claude sessions (merge-pr.sh → POST /merge), the CLI (land/lander.mjs) and MCP (plugin commands). The merge
itself is still `Pushes.merge` (head pinned, 0 behind, CI green, UI Review not holding, the merge queue for AmberX-AXF).

On a failure the lander:
  1. raises a phone alert at once (key `merge:<repo>#<n>`, severity error, notify type `merge.failed`, pushed to AmberX):
     what failed, why, who asked, and what it tries next;
  2. keeps the PR on its retry ladder (`round`, every auto-merge round, 3 minutes): it looks at the PR on GitHub and climbs
       pull   - the PR is behind its base: pull the base in (GitHub update-branch, head pinned)
       resolve- conflicts, or CI still red after a re-run: hand the branch to Claude Code (the banner's Repair hand-over)
       rerun  - CI failed on the head: re-run the failed jobs once (a flake)
       merge  - everything green: try the merge again (through `attempt`, so a failure is counted and told)
     Each rung runs a bounded number of times per head commit; a new head (a fix was pushed) resets the counts.
     Every attempt is logged here (lander.json) and sent as an FYI (key `merge-fyi:<repo>#<n>`, info, never buzzes);
  3. stops only when the PR merged (alert resolved, one FYI) or every rung is used up: then one error alert says exactly
     what is missing. Things only Brett can give (UI Review approval, a draft marked ready) are `blocked`: told once,
     watched each round, and the ladder carries on by itself when they clear.

The ladder's decisions are the pure functions `classify` and `plan` (tested in test_lander.py without GitHub).
"""
from __future__ import annotations

import threading
import time
from typing import Any, Callable

from fastapi import HTTPException

LANDER_FILE = "lander.json"
SCHEMA = "merge-lander@1"
ALERT_SOURCE = "push-banner"
FAIL_TYPE, FYI_TYPE = "merge.failed", "merge.retry"
VIAS = ("console", "auto-merge", "claude", "cli", "mcp", "github", "voice", "queue", "retry")
# per head commit: how often each rung may run before the ladder says it is out of ways
LIMITS = {"pull": 2, "rerun": 1, "resolve": 1, "merge": 3}
WAIT_CI_S = 90 * 60          # CI that never finishes on one head: stuck after this long
RESOLVE_WAIT_S = 3 * 3600    # a Claude hand-over gets this long to push a fix before the ladder gives up on that head
ATTEMPTS_KEEP = 40
ITEMS_MAX = 200
DONE_KEEP_S = 3 * 24 * 3600
TEXT_MAX = 300


def _t(v: Any, n: int = TEXT_MAX) -> str:
    return str(v if v is not None else "")[:n]


def key_of(repo: str, number: int) -> str:
    return f"{repo}#{number}"


# ------------------------------------------------------------------------------------------------ pure: classify + plan

def classify(status: int, detail: Any) -> dict[str, Any]:
    """What a refused merge means: {kind, retry}. retry False = not a merge failure at all (bad input: nothing to retry)."""
    d = _t(detail).lower()
    if status == 400 or status == 403:
        return {"kind": "request", "retry": False}
    for needle, kind in (("isn't open", "closed"), ("draft", "draft"), ("held by ui review", "held"), ("behind", "behind"),
                         ("conflict", "conflict"), ("ci failed", "ci-failed"), ("ci is still running", "ci-running"),
                         ("no ci result", "ci-none"), ("ci isn't green", "ci-failed"), ("still working out", "ci-running"),
                         ("couldn't say", "github")):
        if needle in d:
            return {"kind": kind, "retry": True}
    return {"kind": "github", "retry": True}


WHY = {
    "closed": "the PR was closed", "draft": "the PR is a draft", "held": "UI Review holds it",
    "behind": "it is behind main", "conflict": "it has conflicts with main", "ci-failed": "its CI failed",
    "ci-running": "its CI was still running", "ci-none": "it had no CI result", "github": "GitHub refused the merge",
    "kicked": "the merge queue kicked it out", "request": "the request was wrong",
}


def _used(item: dict[str, Any], rung: str) -> int:
    return int((item.get("tries") or {}).get(rung, 0))


def plan(item: dict[str, Any], f: dict[str, Any], now: float) -> dict[str, Any]:
    """The next step for one PR on the ladder, from what GitHub says now (`f`):
        f = {state: open|closed|merged, draft, head, behind (int|None), mergeable (True|False|None), ci: success|failure|
             running|none, failing: [check names], held: ''|state, queued: bool}
    Answers one of
        {"do": "pull"|"resolve"|"rerun"|"merge", "why": …}
        {"wait": …}                                   nothing to do this round (CI running, queued, a hand-over working)
        {"blocked": …, "missing": [...]}              only Brett can move it (told once, watched)
        {"stop": "merged"|"closed"|"stuck", "missing": [...]}"""
    if f.get("state") == "merged":
        return {"stop": "merged", "missing": []}
    if f.get("state") != "open":
        return {"stop": "closed", "missing": ["the PR is closed without merging: reopen it to land it"]}
    if f.get("draft"):
        return {"blocked": "it is a draft", "missing": ["mark the PR ready for review"]}
    if f.get("held"):
        return {"blocked": f"UI Review holds it ({f['held']})", "missing": [f"approve its screenshots in UI Review (now: {f['held']})"]}
    if f.get("queued"):
        return {"wait": "in the merge queue: it lands with the next green batch"}
    resolving = item.get("resolveAt") and now - item["resolveAt"] < RESOLVE_WAIT_S
    behind = f.get("behind")
    if behind is None:
        return {"wait": "GitHub couldn't say whether it is up to date"}
    if f.get("mergeable") is False:
        if resolving:
            return {"wait": "Claude Code is resolving its conflicts"}
        if _used(item, "resolve") < LIMITS["resolve"]:
            return {"do": "resolve", "why": "it has conflicts with main"}
        return {"stop": "stuck", "missing": ["its conflicts with main resolved (Claude Code was handed it and no fix arrived)"]}
    if behind > 0:
        if _used(item, "pull") < LIMITS["pull"]:
            return {"do": "pull", "why": f"{behind} commit(s) behind main"}
        if resolving:
            return {"wait": "Claude Code is bringing it up to date"}
        if _used(item, "resolve") < LIMITS["resolve"]:
            return {"do": "resolve", "why": "pulling main in did not take"}
        return {"stop": "stuck", "missing": [f"main pulled in ({behind} behind; GitHub's update and Claude Code both failed)"]}
    ci = f.get("ci")
    if ci == "running" or f.get("mergeable") is None:
        since = item.get("waitSince") or now
        if now - since > WAIT_CI_S:
            return {"stop": "stuck", "missing": [f"CI to finish on {_t(f.get('head'), 8)} (running for over {WAIT_CI_S // 60} minutes)"]}
        return {"wait": "CI is running on its head" if ci == "running" else "GitHub is working out whether it can merge"}
    if ci == "failure":
        failing = ", ".join(f.get("failing") or []) or "a check"
        if _used(item, "rerun") < LIMITS["rerun"]:
            return {"do": "rerun", "why": f"CI failed ({failing}): re-running the failed jobs once"}
        if resolving:
            return {"wait": "Claude Code is fixing its CI"}
        if _used(item, "resolve") < LIMITS["resolve"]:
            return {"do": "resolve", "why": f"CI still fails after a re-run ({failing})"}
        return {"stop": "stuck", "missing": [f"green CI: {failing} fails on {_t(f.get('head'), 8)} after a re-run and a Claude Code hand-over"]}
    if ci != "success":
        since = item.get("waitSince") or now
        if now - since > WAIT_CI_S:
            return {"stop": "stuck", "missing": [f"a CI run on {_t(f.get('head'), 8)}: none started"]}
        return {"wait": "no CI result on its head yet"}
    if _used(item, "merge") < LIMITS["merge"]:
        return {"do": "merge", "why": "up to date, mergeable and CI green"}
    return {"stop": "stuck", "missing": [f"a merge GitHub accepts: refused {LIMITS['merge']} times on a green head ({_t(item.get('why'), 160)})"]}


# ------------------------------------------------------------------------------------------------ the lander

class Lander:
    def __init__(self, pushes: Any, read: Callable[[], Any], write: Callable[[Any], None], alert: Callable[[dict[str, Any]], Any],
                 resolve: Callable[[list[str]], Any], log: Callable[[str], Any] = lambda s: None, clock: Callable[[], float] = time.time,
                 queue_repo: str = "", ci_state: Callable[[list[dict[str, Any]]], str] | None = None) -> None:
        self.p, self._read, self._write = pushes, read, write
        self.queue_repo, self._ci_state = queue_repo, ci_state
        self._alert, self._resolve, self._log, self.clock = alert, resolve, log, clock
        self._lock = threading.RLock()

    # ---- store
    def _items(self) -> dict[str, dict[str, Any]]:
        raw = self._read() or {}
        items = raw.get("items") if isinstance(raw, dict) else None
        return {k: v for k, v in items.items() if isinstance(v, dict)} if isinstance(items, dict) else {}

    def _save(self, items: dict[str, dict[str, Any]]) -> None:
        now = self.clock()
        keep = {k: v for k, v in items.items() if v.get("state") in ("retrying", "blocked") or now - float(v.get("lastAt") or 0) < DONE_KEEP_S}
        keep = dict(sorted(keep.items(), key=lambda kv: -float(kv[1].get("lastAt") or 0))[:ITEMS_MAX])
        self._write({"$axf": SCHEMA, "at": int(now * 1000), "items": keep})

    def state(self) -> dict[str, Any]:
        items = sorted(self._items().values(), key=lambda v: -float(v.get("lastAt") or 0))
        counts: dict[str, int] = {}
        for v in items:
            counts[v.get("state", "")] = counts.get(v.get("state", ""), 0) + 1
        return {"$axf": SCHEMA, "items": items, "counts": counts, "limits": LIMITS}

    def _log_attempt(self, it: dict[str, Any], rung: str, ok: bool, text: str, via: str = "retry") -> None:
        it.setdefault("attempts", []).append({"at": int(self.clock() * 1000), "rung": rung, "via": via, "ok": ok, "text": _t(text)})
        it["attempts"] = it["attempts"][-ATTEMPTS_KEEP:]
        it["lastAt"] = self.clock()

    def _fyi(self, it: dict[str, Any], text: str) -> None:
        k = key_of(it["repo"], it["number"])
        self._log(f"merge lander {k}: {text}")
        try:
            self._alert({"source": ALERT_SOURCE, "key": f"merge-fyi:{k}", "severity": "info", "title": f"Merge retry: {k}"[:200],
                         "body": _t(text, 1000), "link": it.get("url") or "view:push-banner", "meta": {"notifyType": FYI_TYPE}})
        except Exception:  # noqa: BLE001 — telling never blocks landing
            pass

    def _fail_alert(self, it: dict[str, Any], title: str, body: str) -> None:
        try:
            self._alert({"source": ALERT_SOURCE, "key": f"merge:{key_of(it['repo'], it['number'])}", "severity": "error", "title": title[:200],
                         "body": _t(body, 1800), "link": it.get("url") or "view:push-banner", "meta": {"notifyType": FAIL_TYPE}})
        except Exception:  # noqa: BLE001
            pass

    # ---- the gate
    def attempt(self, repo: Any, number: Any, via: str = "console", wait_ui: bool = True, confirm: Any = None) -> dict[str, Any]:
        """One merge attempt through Pushes.merge. A refusal that is a real merge failure is alerted at once and put on the
        ladder; the HTTPException is raised again so the caller sees exactly what it saw before."""
        via = via if via in VIAS else "console"
        body = {"repo": repo, "number": number, "confirm": confirm if confirm is not None else f"{repo}#{number}"}
        try:
            res = self.p.merge(body, wait_ui=wait_ui)
        except HTTPException as e:
            c = classify(e.status_code, e.detail)
            if c["retry"] and isinstance(number, int):
                self.failed(repo, number, via, c["kind"], _t(e.detail))
            raise
        if isinstance(number, int):
            self._succeeded(repo, number, via, res)
        return res

    def failed(self, repo: str, number: int, via: str, kind: str, why: str, url: str = "", title: str = "") -> dict[str, Any]:
        """Record a failure (from attempt, or a queue kick) and alert at once."""
        k = key_of(repo, number)
        with self._lock:
            items = self._items()
            it = items.get(k) or {"repo": repo, "number": number, "firstAt": self.clock(), "tries": {}, "attempts": []}
            if url:
                it["url"] = url
            if title:
                it["title"] = _t(title, 160)
            first = it.get("state") not in ("retrying", "blocked")
            if first:
                it["tries"], it["missing"] = {}, []
            it.update({"state": "retrying", "kind": kind, "why": _t(why), "via": via})
            self._log_attempt(it, "merge", False, f"{WHY.get(kind, 'it failed')}: {why}", via)
            items[k] = it
            self._save(items)
        nxt = {"behind": "pull main in", "conflict": "hand the conflicts to Claude Code", "ci-failed": "re-run the failed CI jobs",
               "held": "wait for UI Review", "draft": "wait for it to be marked ready", "closed": "nothing: it is closed"}.get(kind, "try again next round")
        n = sum(1 for a in it["attempts"] if not a["ok"])
        self._fail_alert(it, f"Merge failed: {k}" + (f" ({n} tries)" if n > 1 else ""),
                         f"{WHY.get(kind, 'It failed')} ({via}): {why}\nNext: {nxt}. Retrying by itself every 3 minutes until it merges.")
        return it

    def _succeeded(self, repo: str, number: int, via: str, res: dict[str, Any]) -> None:
        k = key_of(repo, number)
        with self._lock:
            items = self._items()
            it = items.get(k)
            if res.get("queued"):
                if it:
                    it["queuedAt"] = self.clock()
                    self._log_attempt(it, "merge", True, "put in the merge queue", via)
                    self._save(items)
                return
            if not res.get("merged") or not it:
                return
            was = it.get("state") in ("retrying", "blocked")
            it.update({"state": "merged", "missing": [], "mergedAt": self.clock()})
            self._log_attempt(it, "merge", True, "merged", via)
            self._save(items)
        try:
            self._resolve([f"merge:{k}"])
        except Exception:  # noqa: BLE001
            pass
        if was:
            self._fyi(it, f"Merged after {sum(1 for a in it['attempts'] if not a['ok'])} failed attempt(s).")

    # ---- the ladder
    def round(self, facts: Callable[[str, int], dict[str, Any]] | None = None, only: str = "") -> list[dict[str, Any]]:
        """One pass over every PR on the ladder (or just `only`). Never raises."""
        facts = facts or self.facts
        out = []
        for k, it in list(self._items().items()):
            if it.get("state") not in ("retrying", "blocked") or (only and k != only):
                continue
            try:
                out.append(self._step(k, facts(it["repo"], int(it["number"]))))
            except Exception as e:  # noqa: BLE001 — GitHub down: next round
                out.append({"pr": k, "error": _t(e, 200)})
        return out

    def _step(self, k: str, f: dict[str, Any]) -> dict[str, Any]:
        now = self.clock()
        with self._lock:
            items = self._items()
            it = items[k]
            if f.get("head") and it.get("head") and f["head"] != it["head"]:  # a fix was pushed: every rung again
                it["tries"], it["resolveAt"], it["waitSince"] = {}, None, None
                self._log_attempt(it, "head", True, f"new head {f['head'][:8]}: ladder starts again")
            it["head"] = f.get("head") or it.get("head")
            step = plan(it, f, now)
            if "wait" in step:
                it["waitSince"] = it.get("waitSince") or now
            else:
                it["waitSince"] = None
            it["next"] = step.get("why") or step.get("wait") or step.get("blocked") or ""
            if "blocked" in step:
                told = it.get("state") == "blocked" and it.get("missing") == step["missing"]
                it.update({"state": "blocked", "missing": step["missing"]})
                it["lastAt"] = now
                items[k] = it
                self._save(items)
                if not told:
                    self._fail_alert(it, f"Merge blocked: {k}", f"Blocked: {step['blocked']}. Missing: {'; '.join(step['missing'])}. "
                                     "It carries on by itself once that's done.")
                return {"pr": k, "blocked": step["blocked"]}
            if it.get("state") == "blocked":
                it["state"] = "retrying"
            if "stop" in step:
                it["state"] = {"merged": "merged", "closed": "closed"}.get(step["stop"], "stuck")
                it["missing"] = step["missing"]
                self._log_attempt(it, "stop", step["stop"] == "merged", step["stop"] + (": " + "; ".join(step["missing"]) if step["missing"] else ""))
            items[k] = it
            self._save(items)
        if "stop" in step:
            return self._stopped(k, it, step)
        if "wait" in step:
            return {"pr": k, "wait": step["wait"]}
        return self._climb(k, it, step, f)

    def _stopped(self, k: str, it: dict[str, Any], step: dict[str, Any]) -> dict[str, Any]:
        if step["stop"] == "merged":
            try:
                self._resolve([f"merge:{k}"])
            except Exception:  # noqa: BLE001
                pass
            self._fyi(it, "Merged.")
        elif step["stop"] == "closed":
            try:
                self._resolve([f"merge:{k}"])
            except Exception:  # noqa: BLE001
                pass
            self._fyi(it, "Closed without merging: the ladder stopped.")
        else:
            tried = ", ".join(f"{r} x{n}" for r, n in (it.get("tries") or {}).items()) or "nothing"
            self._fail_alert(it, f"Merge stuck: {k}", f"Every way failed (tried: {tried}). Missing: {'; '.join(step['missing'])}. "
                             "POST /api/plugins/push-banner/lander/retry starts the ladder again.")
        return {"pr": k, "stop": step["stop"], "missing": step["missing"]}

    def _climb(self, k: str, it: dict[str, Any], step: dict[str, Any], f: dict[str, Any]) -> dict[str, Any]:
        rung, repo, n = step["do"], it["repo"], int(it["number"])
        ok, text = False, ""
        try:
            if rung == "pull":
                self.p.update({"repo": repo, "number": n, "confirm": k})
                ok, text = True, "pulled main in; waiting for CI on the new head"
            elif rung == "rerun":
                text = self.rerun(repo, f.get("head") or "")
                ok = True
            elif rung == "resolve":
                self.p.claude_fix({"repo": repo, "number": n, "confirm": k, "repair": True})
                ok, text = True, "handed to Claude Code (approve the run on axHub); waiting for its fix"
            else:
                res = self.attempt(repo, n, "retry")
                ok = True
                text = "merged" if res.get("merged") else "put in the merge queue" if res.get("queued") else "GitHub did not merge it"
        except HTTPException as e:
            text = _t(e.detail)
        except Exception as e:  # noqa: BLE001
            text = _t(e)
        with self._lock:
            items = self._items()
            cur = items.get(k, it)
            cur.setdefault("tries", {})[rung] = int(cur["tries"].get(rung, 0)) + 1
            if rung == "resolve" and ok:
                cur["resolveAt"] = self.clock()
            if rung != "merge":  # a merge attempt logs itself (attempt → failed / _succeeded)
                self._log_attempt(cur, rung, ok, f"{step['why']}: {text}")
            items[k] = cur
            self._save(items)
        if rung != "merge" or not ok:
            self._fyi(cur, f"{'Done' if ok else 'Failed'}: {rung} ({step['why']}). {text}")
        return {"pr": k, "do": rung, "ok": ok, "text": text}

    # ---- GitHub reads and the CI re-run (through the push banner's client)
    def facts(self, repo: str, number: int) -> dict[str, Any]:
        from axf_server import github  # the console's lib-github (tests pass their own facts)
        gh = self.p.gh()
        p = gh.get(github.repo_path(repo, "pulls", number))
        if not isinstance(p, dict):
            raise RuntimeError("no such PR")
        head = _t((p.get("head") or {}).get("sha"), 40)
        if p.get("merged") or p.get("merged_at"):
            return {"state": "merged", "head": head}
        if p.get("state") != "open":
            return {"state": "closed", "head": head}
        base = _t((p.get("base") or {}).get("ref"), 200) or "main"
        runs = self.p._checks(gh, repo, head) if head else []
        failing = [_t(r.get("name"), 80) for r in runs if r.get("conclusion") in ("failure", "timed_out", "cancelled", "action_required")][:6]
        queued = False
        try:
            q = self.p.queue() if repo == self.queue_repo else {}
            queued = any(x.get("pr") == number for x in (q.get("items") or []) + (q.get("waiting") or [])) if q.get("on") else False
        except Exception:  # noqa: BLE001
            pass
        return {"state": "open", "draft": p.get("draft") is True, "head": head, "behind": self.p._code_behind(gh, repo, base, head) if head else None,
                "mergeable": p.get("mergeable"), "ci": (self._ci_state(runs) if self._ci_state else "none") if head else "none", "failing": failing,
                "held": self.p.ui_hold(repo, number, _t((p.get("head") or {}).get("ref"), 200)), "queued": queued}

    def rerun(self, repo: str, head: str) -> str:
        """Re-run the failed jobs of every failed workflow run on this head (GitHub Actions)."""
        from axf_server import github  # noqa: PLC0415
        gh = self.p.gh()
        runs = gh.get(github.repo_path(repo, "actions", "runs", query={"head_sha": head, "per_page": 20})) if head else {}
        ids = [r.get("id") for r in (runs.get("workflow_runs") or []) if isinstance(r, dict) and r.get("conclusion") in ("failure", "timed_out", "cancelled")
               and isinstance(r.get("id"), int)] if isinstance(runs, dict) else []
        if not ids:
            raise RuntimeError("no failed workflow run on its head to re-run")
        for i in ids[:5]:
            gh.json("POST", github.repo_path(repo, "actions", "runs", i, "rerun-failed-jobs"), {})
        return f"re-ran the failed jobs of {len(ids[:5])} workflow run(s)"

    # ---- queue kicks (land/merge-queue.mjs writes them into merge-queue.json)
    def ingest_kicks(self, repo: str, kicked: list[dict[str, Any]]) -> int:
        seen = 0
        items = self._items()
        for x in kicked:
            n, at = x.get("pr"), _t(x.get("at"), 40)
            if not isinstance(n, int) or not at:
                continue
            it = items.get(key_of(repo, n)) or {}
            if at in (it.get("kicks") or []):
                continue
            self.failed(repo, n, "queue", "kicked", _t(x.get("why")) or "kicked out of the merge queue", _t(x.get("runUrl")), _t(x.get("title")))
            with self._lock:
                items = self._items()
                cur = items[key_of(repo, n)]
                cur["kicks"] = ([*(cur.get("kicks") or []), at])[-10:]
                self._save(items)
            seen += 1
        return seen

    # ---- commands
    def retry(self, repo: str, number: int) -> dict[str, Any]:
        """Start the ladder again (fresh counts) and run one step now."""
        k = key_of(repo, number)
        with self._lock:
            items = self._items()
            it = items.get(k) or {"repo": repo, "number": number, "firstAt": self.clock(), "attempts": []}
            it.update({"state": "retrying", "tries": {}, "missing": [], "resolveAt": None, "waitSince": None, "head": None})
            self._log_attempt(it, "retry", True, "ladder started again by hand")
            items[k] = it
            self._save(items)
        return {"pr": k, "step": (self.round(only=k) or [{}])[0], "item": self._items().get(k)}

    def forget(self, repo: str, number: int) -> dict[str, Any]:
        k = key_of(repo, number)
        with self._lock:
            items = self._items()
            gone = items.pop(k, None)
            self._save(items)
        try:
            self._resolve([f"merge:{k}", f"merge-fyi:{k}"])
        except Exception:  # noqa: BLE001
            pass
        return {"pr": k, "removed": gone is not None}
