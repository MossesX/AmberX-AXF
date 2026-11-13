"""GitHub client — scratch git work (DESIGN.md §6): what the GitHub API cannot do.

One bare mirror per repo in <dataDir>/work/<owner>__<name>.git and a throwaway worktree per job. Auth through
lib-github's git_env (an Authorization header in GIT_CONFIG_* env: never argv, never a URL, never on disk); every
message is scrubbed of the token. Builds files (the store, journal, origins, orchestrator) merge with the
`builds-live.mjs merge-driver`, so a clash only in those heals by itself.

Rules: pushes go to the PR's own head branch or a `queue/group-*` batch branch only; never to the default branch or a
protected branch; the only forced push is `--force-with-lease=<branch>:<sha we saw>` for a rebase.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Callable

from axf_server import github

DRIVER = "axf-builds"


class GitError(Exception):
    pass


class Work:
    def __init__(self, root: Callable[[], Path], token: Callable[[], str], repo_root: Path) -> None:
        self.root = root
        self.token = token
        self.repo_root = repo_root

    # ---------------------------------------------------------------- plumbing
    def env(self) -> dict[str, str]:
        import os
        return {**os.environ, **github.git_env(self.token() or ""), "GIT_AUTHOR_NAME": "AXF console", "GIT_AUTHOR_EMAIL": "console@amberx.invalid",
                "GIT_COMMITTER_NAME": "AXF console", "GIT_COMMITTER_EMAIL": "console@amberx.invalid", "GIT_EDITOR": "true"}

    def git(self, args: list[str], cwd: Path | None = None, check: bool = True, timeout: int = 300) -> subprocess.CompletedProcess[str]:
        driver = f'node "{self.repo_root / "framework" / "cli" / "builds-live.mjs"}" merge-driver %O %A %B %P'
        cmd = ["git", "-c", f"merge.{DRIVER}.driver={driver}", "-c", f"merge.{DRIVER}.name=AXF builds store", *args]
        try:
            r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=self.env())
        except subprocess.TimeoutExpired:
            raise GitError(f"git {args[0]} timed out") from None
        if check and r.returncode != 0:
            raise GitError(self.scrub(f"git {args[0]}: {(r.stderr or r.stdout).strip()[-600:]}"))
        return r

    def scrub(self, s: str) -> str:
        return github.scrub(s, [self.token() or ""])

    def mirror(self, repo: str) -> Path:
        """The repo's bare mirror, fetched now (every branch, pruned)."""
        if not github.valid_repo(repo):
            raise GitError("odd repo name")
        d = self.root() / "work" / f"{repo.replace('/', '__')}.git"
        url = f"{github.GIT_BASE}/{repo}.git"
        if not (d / "HEAD").exists():
            d.parent.mkdir(parents=True, exist_ok=True)
            self.git(["clone", "--bare", "--quiet", url, str(d)], timeout=900)
        self.git(["fetch", "--quiet", "--prune", "origin", "+refs/heads/*:refs/heads/*"], cwd=d, timeout=600)
        return d

    def worktree(self, mirror: Path, ref: str) -> Path:
        tmp = Path(tempfile.mkdtemp(prefix="gh-client-", dir=str(self.root() / "work")))
        wt = tmp / "wt"
        self.git(["worktree", "add", "--quiet", "--detach", str(wt), ref], cwd=mirror)
        return wt

    def drop(self, mirror: Path, wt: Path) -> None:
        self.git(["worktree", "remove", "--force", str(wt)], cwd=mirror, check=False)
        shutil.rmtree(wt.parent, ignore_errors=True)
        self.git(["worktree", "prune"], cwd=mirror, check=False)

    def sha(self, wt: Path, ref: str = "HEAD") -> str:
        return self.git(["rev-parse", ref], cwd=wt).stdout.strip()

    def conflicts(self, wt: Path) -> list[str]:
        return [f for f in self.git(["diff", "--name-only", "--diff-filter=U"], cwd=wt, check=False).stdout.splitlines() if f]

    def merge(self, wt: Path, ref: str, message: str) -> list[str]:
        """Merge `ref` into the worktree's HEAD. [] = merged (a commit made); else the conflicting files, left in place."""
        r = self.git(["merge", "--no-ff", "--no-edit", "-m", message, ref], cwd=wt, check=False)
        if r.returncode == 0:
            return []
        files = self.conflicts(wt)
        if not files:
            raise GitError(self.scrub(f"merge: {(r.stderr or r.stdout).strip()[-400:]}"))
        return files

    def abort(self, wt: Path) -> None:
        self.git(["merge", "--abort"], cwd=wt, check=False)

    def push(self, wt: Path, branch: str, *, lease: str = "", protected: set[str] | None = None, default: str = "main") -> str:
        if branch == default or branch in (protected or set()) or not re.fullmatch(r"[A-Za-z0-9._/-]{1,200}", branch):
            raise GitError(f"refused: never push to {branch}")
        args = ["push", "--quiet", "origin", f"HEAD:refs/heads/{branch}"]
        if lease:
            args.insert(1, f"--force-with-lease=refs/heads/{branch}:{lease}")
        self.git(args, cwd=wt, timeout=600)
        return self.sha(wt)

    # ---------------------------------------------------------------- what jobs do
    def update_from_base(self, repo: str, head: str, base: str, default: str) -> dict[str, Any]:
        """Merge base into head (builds files heal by themselves); push. {ok, sha} or {ok: False, conflicts}."""
        m = self.mirror(repo)
        wt = self.worktree(m, f"refs/heads/{head}")
        try:
            left = self.merge(wt, f"refs/heads/{base}", f"Merge {base} into {head}")
            if left:
                self.abort(wt)
                return {"ok": False, "conflicts": left}
            return {"ok": True, "sha": self.push(wt, head, default=default)}
        finally:
            self.drop(m, wt)

    def rebase(self, repo: str, head: str, base: str, default: str) -> dict[str, Any]:
        m = self.mirror(repo)
        wt = self.worktree(m, f"refs/heads/{head}")
        try:
            seen = self.sha(wt)
            r = self.git(["rebase", f"refs/heads/{base}"], cwd=wt, check=False, timeout=600)
            if r.returncode != 0:
                files = self.conflicts(wt)
                self.git(["rebase", "--abort"], cwd=wt, check=False)
                return {"ok": False, "conflicts": files or ["(rebase failed)"], "why": self.scrub((r.stderr or r.stdout)[-300:])}
            return {"ok": True, "sha": self.push(wt, head, lease=seen, default=default), "was": seen}
        finally:
            self.drop(m, wt)

    def build_batch(self, repo: str, base: str, branch: str, members: list[dict[str, Any]], *, default: str,
                    keep_existing: bool = False, on_member: Callable[[dict[str, Any], str, str], None] | None = None) -> dict[str, Any]:
        """Make `branch` = base + every member's head merged in order (main pulled into each by construction).
        A member that clashes with the ones before it stops the build there: the branch is pushed with what merged
        so far and the clash is returned for Claude (or a person) to resolve on the branch; a retry carries on.
        keep_existing: start from the batch branch as it is (a retry after a fix), merging base again and the
        members not in it yet."""
        m = self.mirror(repo)
        start = f"refs/heads/{branch}" if keep_existing and self.git(["rev-parse", "--verify", "--quiet", f"refs/heads/{branch}"], cwd=m, check=False).returncode == 0 else f"refs/heads/{base}"
        wt = self.worktree(m, start)
        merged: list[int] = []
        try:
            if start != f"refs/heads/{base}":
                left = self.merge(wt, f"refs/heads/{base}", f"Merge {base} into {branch}")
                if left:
                    self.abort(wt)
                    return {"ok": False, "merged": [], "conflict": {"member": 0, "files": left, "with": base}, "sha": self.sha(wt)}
            for mem in members:
                ref = f"refs/heads/{mem['head']}"
                if self.git(["rev-parse", "--verify", "--quiet", ref], cwd=m, check=False).returncode != 0:
                    if on_member:
                        on_member(mem, "failed", f"its branch {mem['head']} is gone")
                    return {"ok": False, "merged": merged, "missing": mem["number"], "sha": self.sha(wt)}
                if self.git(["merge-base", "--is-ancestor", ref, "HEAD"], cwd=wt, check=False).returncode == 0:
                    merged.append(mem["number"])
                    if on_member:
                        on_member(mem, "ok", "already in the batch")
                    continue
                left = self.merge(wt, ref, f"Batch {branch}: merge #{mem['number']} {mem.get('title', '')[:80]}")
                if left:
                    self.abort(wt)
                    sha = self.push(wt, branch, default=default, lease=self._remote_sha(m, branch)) if merged or keep_existing else ""
                    if on_member:
                        on_member(mem, "failed", f"clashes with the batch in {', '.join(left)[:300]}")
                    return {"ok": False, "merged": merged, "conflict": {"member": mem["number"], "files": left, "with": "batch"}, "sha": sha}
                merged.append(mem["number"])
                if on_member:
                    on_member(mem, "ok", "merged into the batch")
            sha = self.push(wt, branch, default=default, lease=self._remote_sha(m, branch))
            return {"ok": True, "merged": merged, "sha": sha}
        finally:
            self.drop(m, wt)

    def _remote_sha(self, mirror: Path, branch: str) -> str:
        """The batch branch's current SHA (lease for rebuilding it) or '' when it does not exist yet (plain push)."""
        r = self.git(["rev-parse", "--verify", "--quiet", f"refs/heads/{branch}"], cwd=mirror, check=False)
        return r.stdout.strip() if r.returncode == 0 else ""
