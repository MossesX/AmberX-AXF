"""The sandbox's shield: what the sandbox may read, and where it may write (pure rules, no I/O).

The sandbox never changes real data. Three rules make that true, and each one is checked here, not trusted to the UI:

1. **GitHub is read-only.** Every GitHub call goes through axHub's `github` service, and only the operations in
   `GITHUB_OPS` exist: each maps to one fixed read-only hub tool (`READ_TOOLS`) with arguments built here from checked
   values. There is no way to name a hub tool from the browser, so a write tool (create issue, comment, PR …) can't be
   reached even by a crafted request; axHub's own policy (writes need Brett's approval) is a second wall behind this.
2. **Only allowed repositories.** The admin picks which repositories the sandbox shows (`repos` in the config).
3. **Files only in the sandbox.** A person's editable files live in their own workspace folder inside the plugin's
   data folder. Paths are plain relative names (no `..`, no leading `/` or `.`, no backslashes, no control characters),
   with caps on count and size. Nothing is written anywhere else: not the repo, not shared data, not axHub.
"""
from __future__ import annotations

import base64
import re
from typing import Any, Callable

# ---------------------------------------------------------------- GitHub (through axHub, read-only)

OWNER_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")
REPO_RE = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
REF_RE = re.compile(r"^[A-Za-z0-9._/-]{1,200}$")
STATE_VALUES = ("open", "closed", "all")
MAX_PER_PAGE = 50
MAX_PAGE = 50


class ShieldError(ValueError):
    """A request the sandbox refuses (shown to the person as is)."""


def repo_ok(owner: str, repo: str) -> bool:
    return bool(OWNER_RE.match(owner or "")) and bool(REPO_RE.match(repo or "")) and repo not in (".", "..") and not repo.endswith(".git")


def norm_repo(full: str) -> str | None:
    """'MossesX/AmberX-AXF' → 'mossesx/amberx-axf' (GitHub names are case-insensitive), or None when malformed."""
    if not isinstance(full, str) or full.count("/") != 1:
        return None
    o, r = full.strip().split("/")
    return f"{o.lower()}/{r.lower()}" if repo_ok(o, r) else None


def repo_path_ok(path: str) -> bool:
    """A path inside a repository (for reading): plain segments, no `..`, no leading slash."""
    if path == "":
        return True
    if not isinstance(path, str) or len(path) > 400 or path.startswith("/") or "\\" in path or "\x00" in path:
        return False
    return all(seg not in ("", ".", "..") for seg in path.split("/"))


def _page(args: dict[str, Any]) -> dict[str, int]:
    out: dict[str, int] = {}
    for key, cap in (("per_page", MAX_PER_PAGE), ("page", MAX_PAGE)):
        v = args.get(key)
        if v is None:
            continue
        if not isinstance(v, int) or isinstance(v, bool) or v < 1:
            raise ShieldError(f"{key} must be a positive whole number")
        out[key] = min(v, cap)
    out.setdefault("per_page", 30)
    return out


def _ref(args: dict[str, Any], key: str, out_key: str) -> dict[str, str]:
    v = args.get(key)
    if v in (None, ""):
        return {}
    if not isinstance(v, str) or not REF_RE.match(v) or ".." in v:
        raise ShieldError(f"{key} is not a branch, tag or commit name")
    return {out_key: v}


def _path(args: dict[str, Any]) -> str:
    p = args.get("path", "")
    if not isinstance(p, str) or not repo_path_ok(p):
        raise ShieldError("not a path inside the repository")
    return p


def _number(args: dict[str, Any], key: str) -> int:
    v = args.get(key)
    if not isinstance(v, int) or isinstance(v, bool) or v < 1 or v > 10**10:
        raise ShieldError(f"{key} must be a positive whole number")
    return v


def _state(args: dict[str, Any]) -> dict[str, str]:
    v = args.get("state")
    if v in (None, ""):
        return {}
    if v not in STATE_VALUES:
        raise ShieldError("state must be open, closed or all")
    return {"state": v}


# op → (hub tool, argument builder). Builders get the checked owner/repo and the raw args, and return only the
# fields they recognise; anything else the browser sends is dropped. The hub tools are all read-only (GET).
Builder = Callable[[str, str, dict[str, Any]], dict[str, Any]]
GITHUB_OPS: dict[str, tuple[str, Builder]] = {
    "repo": ("repos/get", lambda o, r, a: {"owner": o, "repo": r}),
    "contents": ("repos/get-content", lambda o, r, a: {"owner": o, "repo": r, "path": _path(a), **_ref(a, "ref", "ref")}),
    "branches": ("repos/list-branches", lambda o, r, a: {"owner": o, "repo": r, **_page(a)}),
    "commits": ("repos/list-commits", lambda o, r, a: {"owner": o, "repo": r, **_ref(a, "ref", "sha"), **({"path": _path(a)} if a.get("path") else {}), **_page(a)}),
    "commit": ("repos/get-commit", lambda o, r, a: {"owner": o, "repo": r, **_ref(a, "ref", "ref")} if a.get("ref") else _missing("ref")),
    "pulls": ("pulls/list", lambda o, r, a: {"owner": o, "repo": r, **_state(a), **_page(a)}),
    "pull": ("pulls/get", lambda o, r, a: {"owner": o, "repo": r, "pull_number": _number(a, "number")}),
    "pull-files": ("pulls/list-files", lambda o, r, a: {"owner": o, "repo": r, "pull_number": _number(a, "number"), **_page(a)}),
    "issues": ("issues/list-for-repo", lambda o, r, a: {"owner": o, "repo": r, **_state(a), **_page(a)}),
    "issue": ("issues/get", lambda o, r, a: {"owner": o, "repo": r, "issue_number": _number(a, "number")}),
    "runs": ("actions/list-workflow-runs-for-repo", lambda o, r, a: {"owner": o, "repo": r, **_ref(a, "branch", "branch"), **_page(a)}),
    "run-jobs": ("actions/list-jobs-for-workflow-run", lambda o, r, a: {"owner": o, "repo": r, "run_id": _number(a, "runId")}),
    "releases": ("repos/list-releases", lambda o, r, a: {"owner": o, "repo": r, **_page(a)}),
    "tags": ("repos/list-tags", lambda o, r, a: {"owner": o, "repo": r, **_page(a)}),
}


def _missing(key: str) -> dict[str, Any]:
    raise ShieldError(f"{key} is required")


# Every hub tool the sandbox can ever send. A test checks it matches GITHUB_OPS and that no name is a write verb.
READ_TOOLS: frozenset[str] = frozenset(t for t, _ in GITHUB_OPS.values())
WRITE_WORDS = ("create", "update", "delete", "remove", "add", "set", "lock", "unlock", "pin", "merge", "approve",
               "dismiss", "reprioritize", "dispatch", "rerun", "cancel", "upload", "replace", "transfer", "put", "edit")


def github_call(op: str, owner: str, repo: str, args: dict[str, Any], allowed: set[str]) -> tuple[str, dict[str, Any]]:
    """The one hub call a sandbox GitHub request turns into: (qualified tool, arguments). Raises ShieldError."""
    if op not in GITHUB_OPS:
        raise ShieldError("the sandbox can't do that on GitHub (read-only)")
    if not repo_ok(owner, repo):
        raise ShieldError("not a repository name")
    if f"{owner.lower()}/{repo.lower()}" not in allowed:
        raise ShieldError("that repository isn't open in the sandbox (the admin picks them in Sandbox management)")
    tool, build = GITHUB_OPS[op]
    if tool not in READ_TOOLS:  # can't happen; kept so a future edit can't slip a write tool past the table
        raise ShieldError("not a read-only tool")
    return f"github.{tool}", build(owner, repo, args if isinstance(args, dict) else {})


def decode_content(item: dict[str, Any], max_bytes: int) -> tuple[str, bool]:
    """A get-content file answer → (text, is_text). Binary or oversized files come back as ("", False)."""
    if item.get("encoding") != "base64" or not isinstance(item.get("content"), str):
        return "", False
    try:
        raw = base64.b64decode(item["content"], validate=False)
    except (ValueError, TypeError):
        return "", False
    if len(raw) > max_bytes or b"\x00" in raw[:8000]:
        return "", False
    try:
        return raw.decode("utf-8"), True
    except UnicodeDecodeError:
        return "", False


# ---------------------------------------------------------------- the person's own files

FILE_SEG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._()+@,-]{0,99}$")
MAX_PATH = 240
MAX_DEPTH = 8


def file_path_ok(path: str) -> bool:
    """A workspace path: up to 8 plain segments, each starting with a letter or digit (so no dot files, no `..`)."""
    if not isinstance(path, str) or not path or len(path) > MAX_PATH or path.startswith("/") or path.endswith("/"):
        return False
    if "\\" in path or any(ord(ch) < 32 for ch in path):
        return False
    segs = path.split("/")
    return len(segs) <= MAX_DEPTH and all(FILE_SEG_RE.match(s) and not s.endswith(".") and not s.endswith(" ") for s in segs)


USER_SLUG_RE = re.compile(r"[^a-z0-9._-]+")


def user_slug(name: str) -> str:
    """The workspace folder for a person: their hub name, lower case, safe characters only."""
    s = USER_SLUG_RE.sub("-", (name or "").lower()).strip("-.")[:48]
    return s or "anonymous"


# ---------------------------------------------------------------- config

DEFAULT_REPOS = ["mossesx/amberx-axf", "mossesx/build-pilot", "mossesx/axhub"]
DEFAULT_CONFIG: dict[str, Any] = {
    "enabled": True,          # the sandbox is open
    "openTo": "everyone",     # everyone signed in | "permission" (hub permission console.sandbox) | "admins"
    "repos": DEFAULT_REPOS,   # repositories the GitHub tab may read
    "maxFiles": 200,          # per person
    "maxFileKb": 512,         # per file
    "maxTotalMb": 20,         # per person
}
OPEN_TO = ("everyone", "permission", "admins")
SANDBOX_PERM = "console.sandbox"


def clean_config(raw: Any, base: dict[str, Any] | None = None) -> dict[str, Any]:
    """Merge a config change onto `base`, keeping only known keys with sane values. Raises ShieldError."""
    cfg = dict(base or DEFAULT_CONFIG)
    if not isinstance(raw, dict):
        raise ShieldError("send a JSON object")
    for k, v in raw.items():
        if k == "enabled":
            if not isinstance(v, bool):
                raise ShieldError("enabled is on or off")
            cfg[k] = v
        elif k == "openTo":
            if v not in OPEN_TO:
                raise ShieldError("openTo is everyone, permission or admins")
            cfg[k] = v
        elif k == "repos":
            if not isinstance(v, list) or len(v) > 50:
                raise ShieldError("repos is a list of owner/name (at most 50)")
            out: list[str] = []
            for r in v:
                n = norm_repo(r) if isinstance(r, str) else None
                if not n:
                    raise ShieldError(f"not a repository: {str(r)[:60]}")
                if n not in out:
                    out.append(n)
            cfg[k] = out
        elif k in ("maxFiles", "maxFileKb", "maxTotalMb"):
            lim = {"maxFiles": (1, 2000), "maxFileKb": (1, 4096), "maxTotalMb": (1, 500)}[k]
            if not isinstance(v, int) or isinstance(v, bool) or not lim[0] <= v <= lim[1]:
                raise ShieldError(f"{k} must be between {lim[0]} and {lim[1]}")
            cfg[k] = v
        else:
            raise ShieldError(f"unknown setting {str(k)[:40]}")
    return cfg


def may_use(cfg: dict[str, Any], admin: bool, can: Callable[[str], bool]) -> tuple[bool, str]:
    """May this caller use the sandbox? (yes/no, reason)."""
    if admin:
        return True, ""
    if not cfg.get("enabled", True):
        return False, "The sandbox is switched off."
    who = cfg.get("openTo", "everyone")
    if who == "everyone":
        return True, ""
    if who == "permission" and can(SANDBOX_PERM):
        return True, ""
    return False, "The sandbox isn't open to your account."
