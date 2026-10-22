"""Push banner — Merge all / Pull main into all, and the pending merges they leave behind.

    POST /merge-all {confirm: "merge-all"}   queue every open pull request (not a draft, not from a fork, not hidden): pull
                                             its base in when it's behind, wait for CI, merge it once green
    POST /pull-all  {confirm: "pull-all"}    queue every PR and branch behind its base: pull the base in
    POST /queue/remove {key}                 take one entry off the pending list (nothing on GitHub changes)
    GET  /branches                           also carries `queue` (the pending entries) and `fixBrief` (the conflicts to fix)

A worker thread walks the queue every 15 s until it is empty; every step reads GitHub again first and pins the head
commit it acted on, so a step is never repeated on the same commit. **Every merge is approved by Brett on axHub:** a
green, conflict-free PR is merged through axHub's `github.pulls/merge` (a write, so the hub holds it for approval and
shows the PR, its head commit and the merge method); the entry waits as "approval" with the link, the call is retried
with its confirmation id (every 15 s ten times, then every minute) until it runs, is rejected or expires, and a head that
moved meanwhile gets a fresh approval for the new commit. GitHub can't resolve conflicts: an entry with
conflicts waits in the queue as "conflicts" with a ready brief (Copy fix brief) for a Claude session; once a fix lands on
its branch (a new head commit without conflicts) the queue carries on by itself. Nothing here pushes to a base branch:
pulls go through GitHub's update-branch / merges API into the entry's own branch, merges through the PR after CI passed.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from typing import Any, Callable

from fastapi import HTTPException

from axf_server import github, storage

TICK_S = 15
HUB_APPROVALS = "https://axhub.amberxai.com/auth/admin/approvals"
MAX_QUEUE = 80
GIVE_UP_S = 12 * 3600  # an entry still pending after this is marked failed
STATES = ("queued", "checking", "pulling", "conflicts", "ci", "approval", "blocked", "failed")


def fix_brief(entries: list[dict[str, Any]]) -> str:
    """What to paste into a Claude session to fix the conflicts (names were checked before they got here)."""
    lines = [
        "# Fix merge conflicts (Dev Console Push banner: Merge all / Pull main into all)",
        "",
        "Each branch below has conflicts with its base branch. For each one:",
        "",
        "1. `git fetch origin`, `git checkout -B <branch> origin/<branch>`, then `git merge origin/<base>`.",
        "2. Resolve every conflict so both sides' intent survives: read both versions and the code around them. Generated files "
        "(lockfiles, fixtures, tracker.json, baked framework copies under src/axf, axf.lock.json hashes) are regenerated with the "
        "repo's own tooling, never merged by hand.",
        "3. Run the repo's fast checks for what the merge touched (its CLAUDE.md lists them) and fix what the merge broke.",
        "4. Commit the merge and `git push origin <branch>`.",
        "5. If a conflict can't be resolved safely, `git merge --abort`, leave that branch as it was and say why.",
        "",
        "Never push to the base branch, never force-push, never merge the pull request: the Dev Console's Push banner merges "
        "each one itself once its CI is green.",
        "",
        "## Branches",
        "",
    ]
    for e in entries:
        what = f"pull request #{e['number']} ({e.get('title') or e['branch']})" if e.get("number") else "branch without a pull request"
        lines.append(f"- `{e['repo']}`: branch `{e['branch']}` into base `{e['base']}` ({what})")
    return "\n".join(lines) + "\n"


class Batch:
    """The pending merges/pulls (queue.json in the plugin's data folder) and the worker that walks them."""

    def __init__(self, pushes: Any, auto: bool = True, call: Callable[..., dict[str, Any]] | None = None) -> None:
        self.p = pushes
        self.auto = auto  # start the worker thread on enqueue (tests drive step() themselves)
        self.call = call  # axHub's `call` meta-tool; None = the real hub (tests inject a fake)
        self.sleep: Callable[[float], None] = time.sleep
        self._lock = threading.RLock()
        self._worker: threading.Thread | None = None

    # ---- storage
    def _path(self):
        from . import data_dir  # noqa: PLC0415 — the package decides the data folder
        return data_dir() / "queue.json"

    def read(self) -> list[dict[str, Any]]:
        raw = storage.read_json(self._path(), {}) or {}
        items = raw.get("items") if isinstance(raw, dict) else None
        return [i for i in items if isinstance(i, dict) and isinstance(i.get("key"), str)][:MAX_QUEUE] if isinstance(items, list) else []

    def _write(self, items: list[dict[str, Any]]) -> None:
        storage.write_json(self._path(), {"$axf": "push-banner-queue@1", "items": items[:MAX_QUEUE]})

    def view(self) -> dict[str, Any]:
        items = self.read()
        conflicts = [i for i in items if i.get("state") == "conflicts"]
        return {"queue": [{k: i.get(k) for k in ("key", "kind", "repo", "number", "branch", "base", "title", "url", "state", "text", "approvalUrl", "at", "updatedAt")} for i in items],
                "fixBrief": fix_brief(conflicts) if conflicts else ""}

    def _now(self) -> int:
        return int(self.p.clock() * 1000)

    # ---- enqueue
    def merge_all(self, body: Any) -> dict[str, Any]:
        if not isinstance(body, dict) or body.get("confirm") != "merge-all" or set(body) - {"confirm"}:
            raise HTTPException(400, 'confirm with {"confirm": "merge-all"}')
        ans = self.p.branches(force=True)
        done = {d["key"] for d in ans.get("done", [])}
        add, skipped = [], []
        for r in ans.get("repos", []):
            for pr in r.get("pulls", []):
                label = f"{r['repo']}#{pr['number']}"
                key = f"{r['repo']}:#{pr['number']}"
                if pr.get("hidden") or key in done:
                    continue
                if pr.get("fork"):
                    skipped.append(f"{label}: from a fork")
                elif pr.get("draft"):
                    skipped.append(f"{label}: a draft")
                elif not (_valid_branch(pr.get("head")) and _valid_branch(pr.get("base"))):
                    skipped.append(f"{label}: odd branch name")
                else:
                    add.append({"key": key, "kind": "merge", "repo": r["repo"], "number": pr["number"], "branch": pr["head"],
                                "base": pr["base"], "title": pr.get("title", ""), "url": pr.get("url", "")})
        return self._enqueue(add, skipped)

    def pull_all(self, body: Any) -> dict[str, Any]:
        if not isinstance(body, dict) or body.get("confirm") != "pull-all" or set(body) - {"confirm"}:
            raise HTTPException(400, 'confirm with {"confirm": "pull-all"}')
        ans = self.p.branches(force=True)
        done = {d["key"] for d in ans.get("done", [])}
        add: list[dict[str, Any]] = []
        for r in ans.get("repos", []):
            behind = {b["name"] for b in r.get("branches", []) if isinstance(b.get("behind"), int) and b["behind"] > 0}
            for pr in r.get("pulls", []):
                key = f"{r['repo']}:#{pr['number']}"
                if pr.get("hidden") or pr.get("fork") or key in done:
                    continue
                if (pr.get("mergeState") in ("behind", "dirty") or (pr.get("base") == r.get("base") and pr.get("head") in behind)) \
                        and _valid_branch(pr.get("head")) and _valid_branch(pr.get("base")):
                    add.append({"key": key, "kind": "pull", "repo": r["repo"], "number": pr["number"], "branch": pr["head"],
                                "base": pr["base"], "title": pr.get("title", ""), "url": pr.get("url", "")})
            for b in r.get("branches", []):
                key = f"{r['repo']}:{b['name']}"
                if b.get("hidden") or b.get("pr") or b["name"] not in behind or key in done:
                    continue
                add.append({"key": key, "kind": "pull", "repo": r["repo"], "branch": b["name"], "base": r["base"], "title": b["name"], "url": b.get("url", "")})
        return self._enqueue(add, [])

    def _enqueue(self, add: list[dict[str, Any]], skipped: list[str]) -> dict[str, Any]:
        now = self._now()
        with self._lock:
            have = {i["key"]: i for i in self.read()}
            added = 0
            for a in add:
                cur = have.get(a["key"])
                if cur and not (cur["kind"] == "pull" and a["kind"] == "merge") and cur.get("state") not in ("failed", "blocked"):
                    continue  # already pending (a merge also pulls the base in, so it replaces a pull)
                have[a["key"]] = {**a, "state": "queued", "text": "Queued", "at": now, "updatedAt": now}
                added += 1
            self._write(list(have.values()))
        self.p._forget()
        if added:
            self.kick()
        return {"added": added, "skipped": skipped, **self.view()}

    def remove(self, body: Any) -> dict[str, Any]:
        if not isinstance(body, dict) or set(body) - {"key"} or not isinstance(body.get("key"), str):
            raise HTTPException(400, "send {key}")
        with self._lock:
            self._write([i for i in self.read() if i["key"] != body["key"]])
        self.p._forget()
        return self.view()

    # ---- the worker
    def kick(self) -> None:
        """Start the worker if it isn't running (also on server start, when the queue isn't empty)."""
        if not self.auto:
            return
        with self._lock:
            if self._worker and self._worker.is_alive():
                return
            self._worker = threading.Thread(target=self._loop, name="push-banner-batch", daemon=True)
            self._worker.start()

    def _loop(self) -> None:
        while True:
            try:
                left = self.step()
            except Exception:  # noqa: BLE001 — one bad pass never stops the queue
                left = True
            if not left:
                return
            self.sleep(TICK_S)

    def step(self) -> bool:
        """One pass over the queue. Returns whether anything can still move by itself."""
        with self._lock:
            items = self.read()
            if not items:
                return False
            if not (self.p.token() or "").strip():
                return False
            gh = self.p.gh()
            keep: list[dict[str, Any]] = []
            for it in items:
                if it.get("state") in ("failed", "blocked"):
                    keep.append(it)
                    continue
                if self._now() - int(it.get("at") or 0) > GIVE_UP_S * 1000:
                    keep.append({**it, "state": "failed", "text": "Gave up after 12 hours: finish it by hand", "updatedAt": self._now()})
                    continue
                try:
                    nxt = self._advance(gh, it)
                except (github.GitHubError, ValueError) as e:
                    nxt = {**it, "text": f"GitHub: {str(e)[:120]}"}
                if nxt is not None:
                    keep.append({**nxt, "updatedAt": self._now()})
            self._write(keep)
        self.p._forget()
        return any(i.get("state") not in ("failed", "blocked") for i in keep)

    def _done(self, it: dict[str, Any], kind: str, text: str) -> None:
        entry = {"key": it["key"], "kind": kind, "repo": it["repo"], "base": it["base"], "title": it.get("title") or it["branch"], "url": it.get("url", ""), "text": text}
        if it.get("number"):
            entry["number"] = it["number"]
        else:
            entry["branch"] = it["branch"]
        self.p._remember(entry)

    def _conflicts(self, it: dict[str, Any]) -> dict[str, Any]:
        return {**it, "state": "conflicts", "text": f"Has conflicts with {it['base']}: copy the fix brief into a Claude session; it carries on once the fix is pushed"}

    def _advance(self, gh: github.GitHubClient, it: dict[str, Any]) -> dict[str, Any] | None:
        repo, base, branch = it["repo"], it["base"], it["branch"]
        if not it.get("number"):  # a branch without a PR: pull the base in as a merge commit on it
            cmp = gh.get(_compare(repo, base, branch))
            if isinstance(cmp, dict) and cmp.get("behind_by") == 0:
                self._done(it, "pulled", f"{branch} has everything from {base}.")
                return None
            head = str(self.p._head(gh, repo, branch).get("sha") or "")[:40]
            if it.get("state") == "conflicts" and it.get("conflictAt") == head:
                return it  # nothing new on it yet: no point asking GitHub to merge again
            try:
                gh.json("POST", github.repo_path(repo, "merges"), {"base": branch, "head": base, "commit_message": f"Merge {base} into {branch} (Dev Console Push banner)"})
            except github.GitHubError as e:
                if getattr(e, "status", 0) == 409:
                    return {**self._conflicts(it), "conflictAt": head}
                raise
            self._done(it, "pulled", f"Pulled {base} into {branch}.")
            return None

        n = it["number"]
        pr = gh.get(github.repo_path(repo, "pulls", n))
        if not isinstance(pr, dict):
            return {**it, "state": "failed", "text": "GitHub doesn't know this pull request"}
        if pr.get("state") != "open":
            if pr.get("merged") or pr.get("merged_at"):
                self._done(it, "merged", f"#{n} was merged.")
            return None
        if pr.get("draft") is True and it["kind"] == "merge":
            return {**it, "state": "blocked", "text": "It's a draft: mark it ready, then Merge all again"}
        sha = str((pr.get("head") or {}).get("sha") or "")[:40]
        ms, mergeable = pr.get("mergeable_state"), pr.get("mergeable")
        if mergeable is None or ms == "unknown":
            return {**it, "state": "checking", "text": "GitHub is still working out whether it merges"}
        if ms == "dirty" or mergeable is False:
            return self._conflicts(it)
        if ms == "behind":
            if it.get("pulledFor") != sha:
                gh.json("PUT", github.repo_path(repo, "pulls", n, "update-branch"), {"expected_head_sha": sha})
                if it["kind"] == "pull":
                    self._done(it, "pulled", f"Pulled {base} into #{n}.")
                    return None
                return {**it, "state": "pulling", "pulledFor": sha, "text": f"Pulling {base} in"}
            return {**it, "state": "pulling", "text": f"Pulling {base} in"}
        if it["kind"] == "pull":
            self._done(it, "pulled", f"#{n} has everything from {base}.")
            return None
        ci = self.p.ci_of(gh, repo, sha)
        if ci in ("running", "none", "unknown"):
            return {**it, "state": "ci", "text": "Waiting for CI" if ci == "running" else "Waiting for CI to start"}
        if ci == "failure":
            return {**it, "state": "blocked", "text": "Its CI failed: fix it, then Merge all again"}
        return self._ask_merge(it, sha)

    # ---- the merge itself: axHub's github.pulls/merge, which waits for Brett's approval on the hub
    def _ask_merge(self, it: dict[str, Any], sha: str) -> dict[str, Any] | None:
        """Ask axHub to merge (pinned to the head that passed CI); retry the approval until it runs, is refused or expires."""
        n, base = it["number"], it["base"]
        conf = it.get("confirmId") if it.get("approvalFor") == sha else None
        if conf and self._now() < int(it.get("nextTry") or 0):
            return it  # waiting for Brett; not due for another try yet
        owner, name = it["repo"].split("/", 1)
        args = {"owner": owner, "repo": name, "pull_number": n, "body": {"merge_method": "merge", "sha": sha}}
        try:
            r = (self.call or _call_hub)("github.pulls/merge", args, conf)
        except Exception as e:  # noqa: BLE001 — the hub's answer, as text
            m = str(e).lower()
            if conf and ("reject" in m or "denied" in m):
                return {**it, "state": "blocked", "text": "You rejected the merge on axHub", "confirmId": None}
            if conf and "expired" in m:
                return {**it, "state": "queued", "text": "The approval expired: asking again", "confirmId": None, "approvalFor": None}
            if "409" in m or "conflict" in m or ("head" in m and "modified" in m):
                return {**it, "state": "queued", "text": "Its head moved: checking it again", "confirmId": None, "approvalFor": None}
            return {**it, "state": "blocked", "text": f"axHub: {str(e)[:140]}"}
        if "confirm" in r:
            cid = str(r["confirm"])
            link = f"{HUB_APPROVALS}/{cid}" if re.match(r"^[0-9A-Za-z-]{8,64}$", cid) else HUB_APPROVALS
            tries = int(it.get("tries") or 0) + 1 if cid == it.get("confirmId") else 1
            delay = 15_000 if tries <= 10 else 60_000  # Brett's rule: every 15 s ten times, then every minute
            return {**it, "state": "approval", "confirmId": cid, "approvalFor": sha, "approvalUrl": link, "tries": tries,
                    "nextTry": self._now() + delay, "text": f"Waiting for your approval on axHub to merge #{n} into {base}"}
        out = str(r.get("ok", ""))
        if '"merged":true' in out.replace(" ", "") or '"merged": true' in out:
            self._done(it, "merged", f"Merged #{n} into {base} (approved on axHub).")
            return None
        return {**it, "state": "blocked", "text": f"axHub ran it but GitHub didn't merge: {out[:140]}", "confirmId": None}


def _valid_branch(b: Any) -> bool:
    from . import valid_branch  # noqa: PLC0415
    return valid_branch(b)


def _compare(repo: str, base: str, branch: str) -> str:
    from . import compare_path  # noqa: PLC0415
    return compare_path(repo, base, branch)


def _call_hub(tool: str, arguments: dict[str, Any], confirmation_id: str | None = None, timeout: float = 60) -> dict[str, Any]:
    """axHub's `call` meta-tool over MCP (AXHUB_URL + AXHUB_TOKEN, the console's Keys): {"ok": text} or {"confirm": id}."""
    from axf_server import http as axf_http  # noqa: PLC0415
    url = (os.environ.get("AXHUB_URL") or "https://axhub.amberxai.com").rstrip("/").removesuffix("/mcp")
    tok = os.environ.get("AXHUB_TOKEN", "")
    if not tok:
        raise RuntimeError("Add the axHub token first (Keys needed → axHub connection): merges are approved on axHub.")
    if not url.startswith("https://"):
        raise RuntimeError("The axHub address must be https.")
    sid = None

    def rpc(method: str, params: dict[str, Any]) -> dict[str, Any]:
        nonlocal sid
        h = {"authorization": f"Bearer {tok}", "content-type": "application/json", "accept": "application/json, text/event-stream"}
        if sid:
            h["mcp-session-id"] = sid
        r = axf_http.request("POST", f"{url}/mcp", headers=h, body=json.dumps({"jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": method, "params": params}).encode(),
                             timeout=timeout + 30, max_bytes=2_000_000, truncate=True)
        if not r.ok:
            raise RuntimeError(f"axHub answered {r.status}")
        sid = r.headers.get("mcp-session-id") or sid
        raw = r.text()
        if "text/event-stream" in r.headers.get("content-type", ""):
            msgs = [json.loads(x[5:].strip()) for x in raw.splitlines() if x.startswith("data:") and x[5:].strip()]
            msg = next((m for m in reversed(msgs) if "result" in m or "error" in m), {})
        else:
            msg = json.loads(raw or "{}")
        if "error" in msg:
            raise RuntimeError(str(msg["error"].get("message", "axHub error"))[:300])
        return msg.get("result") or {}

    rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "axf-push-banner", "version": "1"}})
    args: dict[str, Any] = {"tool": tool, "arguments": arguments, "timeout_seconds": int(timeout)}
    if confirmation_id:
        args["confirmation_id"] = confirmation_id
    res = rpc("tools/call", {"name": "call", "arguments": args})
    text = "\n".join(c.get("text", "") for c in res.get("content", []) if isinstance(c, dict))
    if res.get("isError"):
        try:
            err = json.loads(text).get("error", {})
        except ValueError:
            err = {"message": text}
        if err.get("code") == "confirmation_required":
            return {"confirm": str((err.get("details") or {}).get("confirmationId", ""))}
        raise RuntimeError(str(err.get("message") or text)[:400])
    return {"ok": text}
