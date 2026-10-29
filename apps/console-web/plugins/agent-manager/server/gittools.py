"""Build agents' git tools (Oct 28 2026, Brett: "How do I get Mosses to build using the git repo").

A build agent (Settings → Plugins → Agent manager → Safety → build agents; Mosses by default) edits, builds, tests and
commits in the console's own AmberX-AXF checkout (`/axf`) with the CLI's Edit / Write / Bash. Two things need the
GitHub token, which never reaches the model or Bash, so the console runs them itself:

  repo_git_push  {branch}                    push a local branch to origin (never main/master/site/go-pass)
  repo_open_pr   {branch, title, body?, base?}  open a pull request for a pushed branch (base main)

Merging stays Brett's: a PR is merged only through his merge approval on axHub (push banner, CI must be green).
Needs GITHUB_TOKEN (contents + pull requests write on the repo) and AXF_GITHUB_REPO (default MossesX/AmberX-AXF).
Both are dangerous builtins: only agents allowed dangerous tools *and* listed as build agents get them.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
from typing import Any

from . import store, toolkit

BRANCH_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._/-]{0,120}\Z")
PROTECTED = {"main", "master", "site", "go-pass", "HEAD"}
NAMES = ("repo_git_push", "repo_open_pr")

GUIDE = """## Build mode (Mosses builds in the repo)
You work in the console's own AmberX-AXF git checkout (your working folder) with Edit, Write and Bash, no approval needed.
- The live console runs from this checkout and auto-updates it from main. Don't switch its branch: build in a worktree,
  `git fetch origin main && git worktree add .mosses/<branch> -b <branch> origin/main`, then work and commit there.
- Run the checks the change needs (tsc, tests, `node framework/cli/axf.mjs validate …`) before you push.
- Push with repo_git_push {branch} and open the PR with repo_open_pr {branch, title, body}; you have no GitHub token
  in Bash. Never push main. Merging is Brett's: say the PR is ready and he gets a merge approval.
- Clean up with `git worktree remove .mosses/<branch>` once it's pushed.
- No secrets in files, commits or chat."""

SPECS = {
    "repo_git_push": {"description": "Push a local branch of the AmberX-AXF checkout to GitHub (origin). Never main/master. The console adds the credentials.",
                      "parameters": {"type": "object", "properties": {"branch": {"type": "string", "description": "Local branch name, e.g. claude/my-fix"}}, "required": ["branch"]}},
    "repo_open_pr": {"description": "Open a pull request on GitHub for a pushed branch (base main by default). Returns its number and link. Merging is Brett's.",
                     "parameters": {"type": "object", "properties": {"branch": {"type": "string"}, "title": {"type": "string"}, "body": {"type": "string"},
                                                                     "base": {"type": "string", "description": "Default main"}}, "required": ["branch", "title"]}},
}


def root() -> str:
    return str(store.ROOT)


def repo() -> str:
    return os.environ.get("AXF_GITHUB_REPO", "MossesX/AmberX-AXF")


def _token() -> str:
    t = os.environ.get("GITHUB_TOKEN", "")
    if not t:
        raise RuntimeError("GITHUB_TOKEN isn't set on the console, so it can't push or open PRs.")
    return t


def _redact(text: str, tok: str) -> str:
    return text.replace(tok, "***") if tok else text


def _branch(a: dict[str, Any]) -> str:
    b = str(a.get("branch") or "").strip()
    if not BRANCH_RE.match(b) or ".." in b or b.endswith((".lock", "/")) or b in PROTECTED or b.split("/")[-1] in PROTECTED:
        raise ValueError(f"not a branch I can push: {b!r} (main, master, site and go-pass are never pushed)")
    return b


def push(a: dict[str, Any], ctx: dict[str, Any]) -> str:
    b = _branch(a)
    tok = _token()
    r = root()
    have = subprocess.run(["git", "-C", r, "rev-parse", "--verify", "--quiet", f"refs/heads/{b}"], capture_output=True, text=True, timeout=30)
    if have.returncode != 0:
        return json.dumps({"status": "error", "message": f"there's no local branch {b} in the checkout"})
    d = tempfile.mkdtemp(prefix="axf-askpass-")
    try:
        os.chmod(d, 0o700)
        helper = os.path.join(d, "askpass.sh")
        with open(helper, "w", encoding="utf-8") as f:
            f.write('#!/bin/sh\ncase "$1" in *sername*) echo x-access-token ;; *) printf %s "$AXF_PUSH_TOKEN" ;; esac\n')
        os.chmod(helper, 0o700)
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": d, "GIT_ASKPASS": helper, "GIT_TERMINAL_PROMPT": "0", "AXF_PUSH_TOKEN": tok}
        url = f"https://github.com/{repo()}.git"
        p = subprocess.run(["git", "-C", r, "-c", "credential.helper=", "push", url, f"refs/heads/{b}:refs/heads/{b}"],
                           capture_output=True, text=True, timeout=300, env=env)
    finally:
        shutil.rmtree(d, ignore_errors=True)
    out = _redact((p.stdout + p.stderr).strip(), tok)[-4000:]
    return json.dumps({"status": "ok" if p.returncode == 0 else "error", "branch": b, "output": out})


def open_pr(a: dict[str, Any], ctx: dict[str, Any]) -> str:
    b = _branch(a)
    base = str(a.get("base") or "main").strip()
    if not BRANCH_RE.match(base):
        raise ValueError("bad base branch")
    title = str(a.get("title") or "").strip()[:250]
    if not title:
        raise ValueError("a title is needed")
    body = str(a.get("body") or "")[:20000]
    tok = _token()
    req = urllib.request.Request(f"https://api.github.com/repos/{repo()}/pulls", method="POST",
                                 data=json.dumps({"title": title, "head": b, "base": base, "body": body}).encode(),
                                 headers={"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json", "User-Agent": "axf-console",
                                          "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            pr = json.loads(resp.read() or b"{}")
        return json.dumps({"status": "ok", "number": pr.get("number"), "url": pr.get("html_url"), "base": base, "head": b})
    except urllib.error.HTTPError as e:
        msg = _redact(e.read().decode("utf-8", "replace"), tok)[:1500]
        return json.dumps({"status": "error", "http": e.code, "message": msg})


def build_agent(agent_id: str) -> bool:
    """Build mode = listed as a build agent *and* allowed dangerous tools."""
    return agent_id in store.build_agents() and agent_id in store.dangerous_agents()


def records() -> list[dict[str, Any]]:
    return [{"id": f"builtin.{n}", "name": n, "kind": "builtin", "config": {"builtin": n}, "description": SPECS[n]["description"],
             "parameters": SPECS[n]["parameters"]} for n in NAMES]


toolkit.register_builtin("repo_git_push", SPECS["repo_git_push"], push, dangerous=True)
toolkit.register_builtin("repo_open_pr", SPECS["repo_open_pr"], open_pr, dangerous=True)
