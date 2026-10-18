"""Systems check: everything the console and its features need, checked every time the console loads.

  GET  /api/system/check[?force=1]    every check (cached 60 s unless forced)
  POST /api/system/check/{id}         re-run one check (used after a fix and by "Fix all")
  POST /api/system/secret             {key, value}  save a credential, then re-test it
  POST /api/system/secret/clear       {key}
  POST /api/system/fix/{id}           run a check's automatic fix (only checks that have one)

All routes need the console token. Credentials are kept server-side only, in <repo>/.axf-console/secrets.env
(0600, git-ignored, separate from the env file install-console.sh rewrites). They are loaded into this process's
environment so every feature (and every subprocess) sees them, and are never sent back to the browser: the API only
says whether each one is set. Checks of the VPS host itself (mosh, the Claude CLI, cron, Docker…) come from
deploy/console-doctor.sh, which writes <repo>/.axf-console/host-check.json; the container can't look at the host.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import socket
import stat
import subprocess
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

# ---------------------------------------------------------------- credential store

KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")


class CredStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def read(self) -> dict[str, str]:
        out: dict[str, str] = {}
        try:
            for line in self.path.read_text().splitlines():
                if "=" in line and not line.lstrip().startswith("#"):
                    k, v = line.split("=", 1)
                    if KEY_RE.match(k.strip()):
                        out[k.strip()] = v.strip()
        except OSError:
            pass
        return out

    def write(self, values: dict[str, str]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write("# AXF Dev Console credentials (saved from the systems check). Never commit this file.\n")
            for k in sorted(values):
                f.write(f"{k}={values[k]}\n")
        os.chmod(tmp, 0o600)
        tmp.replace(self.path)

    def set(self, key: str, value: str) -> None:
        vals = self.read()
        vals[key] = value
        self.write(vals)
        os.environ[key] = value

    def clear(self, key: str) -> None:
        vals = self.read()
        vals.pop(key, None)
        self.write(vals)
        os.environ.pop(key, None)

    def load_into_env(self) -> None:
        for k, v in self.read().items():
            if v:
                os.environ[k] = v


# What can be stored. `secret` values are masked everywhere; `pattern` is a light format check (never a guarantee).
CREDENTIALS: dict[str, dict[str, Any]] = {
    "GITHUB_TOKEN": {"label": "GitHub token", "secret": True, "pattern": r"^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$",
                     "placeholder": "github_pat_… or ghp_…", "help": "Fine-grained token for MossesX/AmberX-AXF: Contents read/write, Actions read."},
    "ANTHROPIC_API_KEY": {"label": "Anthropic API key", "secret": True, "pattern": r"^sk-ant-[A-Za-z0-9_\-]{20,}$",
                          "placeholder": "sk-ant-…", "help": "From console.anthropic.com → API keys. Used by API-key features and claude-pick's API mode."},
    "HOSTINGER_API_TOKEN": {"label": "Hostinger API token", "secret": True, "pattern": r"^[A-Za-z0-9_\-\.]{20,}$",
                            "placeholder": "token from hPanel", "help": "hPanel → Profile → API → New token."},
    "COOLIFY_URL": {"label": "Coolify URL", "secret": False, "pattern": r"^https?://[^\s/]+(:\d+)?/?$",
                    "placeholder": "https://coolify.amberxai.com", "help": "The address of your Coolify dashboard."},
    "COOLIFY_TOKEN": {"label": "Coolify API token", "secret": True, "pattern": r"^\S{10,}$",
                      "placeholder": "token from Coolify", "help": "Coolify → Keys & Tokens → API tokens (root or write permission)."},
    "AXHUB_URL": {"label": "axHub URL", "secret": False, "pattern": r"^https?://[^\s/]+(:\d+)?/?$",
                  "placeholder": "https://axhub.amberxai.com", "help": "Where your axHub runs."},
    "AXHUB_TOKEN": {"label": "axHub token", "secret": True, "pattern": r"^\S{10,}$",
                    "placeholder": "axHub access token", "help": "axHub → Clients → token for the Dev Console."},
}

DOCS = {
    "github_pat": "https://github.com/settings/personal-access-tokens/new",
    "github_pat_docs": "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens",
    "anthropic_keys": "https://console.anthropic.com/settings/keys",
    "anthropic_docs": "https://docs.claude.com/en/api/overview",
    "claude_code": "https://code.claude.com/docs/en/setup",
    "claude_hooks": "https://code.claude.com/docs/en/hooks",
    "hostinger_api": "https://developers.hostinger.com/",
    "coolify_api": "https://coolify.io/docs/api-reference/authorization",
    "mosh": "https://mosh.org/#getting",
    "ufw": "https://help.ubuntu.com/community/UFW",
}

SERVICES = [
    {"id": "console", "label": "Dev Console", "icon": "shield", "description": "The console's own token, credential file and plugins."},
    {"id": "github", "label": "GitHub", "icon": "branch", "description": "Repo access, CI downloads and publishing settings to every clone."},
    {"id": "claude", "label": "Anthropic & Claude", "icon": "sparkles", "description": "API key, Claude Code on the VPS, sign-in, rules sync and the session check-in."},
    {"id": "vps", "label": "VPS & mosh", "icon": "monitor", "description": "The server the console runs on: mosh, firewall, Docker, auto-update."},
    {"id": "hostinger", "label": "Hostinger", "icon": "cloud", "description": "Hostinger API for VPS and DNS management."},
    {"id": "coolify", "label": "Coolify", "icon": "box", "description": "The deploy platform in front of every app."},
    {"id": "axhub", "label": "axHub", "icon": "zap", "description": "The connector hub: shared data, Claude files, MCP proxy."},
    {"id": "data", "label": "AmberX data", "icon": "folder", "description": "Repo, project manifest, shared data folder, Claude files."},
]

HOST_SCRIPT = "bash /opt/axf/deploy/console-doctor.sh"


def _http(url: str, headers: dict[str, str] | None = None, method: str = "GET", body: bytes | None = None, timeout: float = 7) -> tuple[int, dict[str, str], str]:
    req = urllib.request.Request(url, data=body, method=method, headers={"user-agent": "axf-console-syscheck", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read(4000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in (e.headers or {}).items()}, ""
    except Exception as e:  # noqa: BLE001 — network trouble is a result, not a crash
        return 0, {}, str(e)[:200]


# ---------------------------------------------------------------- checks

Check = dict[str, Any]


class SysCheck:
    def __init__(self, root: Path, token_fn: Callable[[], str], persist_root: Callable[[], Path | None], plugins: dict[str, dict[str, Any]],
                 log: Callable[..., None], github_repo: str) -> None:
        self.root = root
        self.token_fn = token_fn
        self.persist_root = persist_root
        self.plugins = plugins
        self.log = log
        self.repo = github_repo
        self.store = CredStore(root / ".axf-console" / "secrets.env")
        self.store.load_into_env()
        self.host_file = root / ".axf-console" / "host-check.json"
        self._cache: tuple[float, list[Check]] | None = None
        self.checks: dict[str, Callable[[], Check]] = {
            "console-token": self.c_console_token,
            "credentials-file": self.c_credentials_file,
            "plugins": self.c_plugins,
            "github-token": self.c_github_token,
            "github-repo": self.c_github_repo,
            "anthropic-key": self.c_anthropic_key,
            "hostinger-token": self.c_hostinger,
            "coolify": self.c_coolify,
            "axhub": self.c_axhub,
            "repo-clone": self.c_repo_clone,
            "manifest": self.c_manifest,
            "shared-data": self.c_shared_data,
            "claude-files": self.c_claude_files,
            "host-report": self.c_host_report,
        }
        for hid, meta in HOST_CHECKS.items():
            self.checks[hid] = (lambda h=hid: self.c_host(h))
        self.fixes: dict[str, Callable[[], str]] = {
            "credentials-file": self.f_credentials_file,
            "shared-data": self.f_shared_data,
            "claude-files": self.f_claude_files,
        }

    # -------------------------------------------------------- helpers

    def item(self, cid: str, service: str, title: str, status: str, summary: str, *, details: list[str] | None = None, fix: dict[str, Any] | None = None,
             instructions: list[str] | None = None, links: list[dict[str, str]] | None = None, depends: list[str] | None = None, order: int = 50) -> Check:
        if fix is None and cid in self.fixes and status in ("error", "warn"):
            fix = {"type": "action", "label": "Fix automatically"}
        return {"id": cid, "service": service, "title": title, "status": status, "summary": summary, "details": details or [], "fix": fix,
                "instructions": instructions or [], "links": links or [], "dependsOn": depends or [], "order": order, "autoFix": cid in self.fixes}

    def secret_fix(self, *keys: str) -> dict[str, Any]:
        return {"type": "secrets", "fields": [{"key": k, "label": CREDENTIALS[k]["label"], "secret": CREDENTIALS[k]["secret"], "placeholder": CREDENTIALS[k]["placeholder"],
                                              "help": CREDENTIALS[k]["help"], "set": bool(os.environ.get(k)),
                                              "value": os.environ.get(k, "") if not CREDENTIALS[k]["secret"] else ""} for k in keys]}

    # -------------------------------------------------------- console

    def c_console_token(self) -> Check:
        ok = bool(self.token_fn())
        return self.item("console-token", "console", "Console token (AXF_TOKEN)", "ok" if ok else "error",
                         "Set: the API, /mcp and plugin routes require it." if ok else "Not set: anyone who can reach the console can change the repo and see its data.",
                         instructions=["On the VPS: AXF_TOKEN=$(openssl rand -hex 16) bash /opt/axf/deploy/install-console.sh", "Then paste it in Settings → Account & security → Console token."],
                         fix=None if ok else {"type": "host", "command": "AXF_TOKEN=$(openssl rand -hex 16) bash /opt/axf/deploy/install-console.sh"}, order=1)

    def c_credentials_file(self) -> Check:
        p = self.store.path
        if not p.exists():
            return self.item("credentials-file", "console", "Credential file", "info", "No credentials saved yet; it is created (owner-only) when you save the first one.", order=2)
        mode = stat.S_IMODE(p.stat().st_mode)
        ok = mode & 0o077 == 0
        return self.item("credentials-file", "console", "Credential file", "ok" if ok else "error",
                         f"{p.relative_to(self.root)} is owner-only (0600)." if ok else f"{p.relative_to(self.root)} is readable by other users (mode {oct(mode)}).",
                         instructions=[] if ok else [f"chmod 600 /opt/axf/{p.relative_to(self.root)}"], order=2)

    def c_plugins(self) -> Check:
        broken = [f"{k}: {v.get('error')}" for k, v in self.plugins.items() if v.get("error")]
        return self.item("plugins", "console", "Console plugins", "error" if broken else "ok",
                         f"{len(broken)} plugin(s) failed to load." if broken else f"{len(self.plugins)} plugin(s) loaded.", details=broken,
                         instructions=["Open Settings → Plugins for the error, or check the console log (docker logs axf-console)."] if broken else [], order=3)

    # -------------------------------------------------------- GitHub

    def c_github_token(self) -> Check:
        tok = os.environ.get("GITHUB_TOKEN", "")
        base = dict(fix=self.secret_fix("GITHUB_TOKEN"), links=[{"label": "Create a fine-grained token", "url": DOCS["github_pat"]}, {"label": "GitHub docs: personal access tokens", "url": DOCS["github_pat_docs"]}],
                    instructions=["github.com → Settings → Developer settings → Fine-grained tokens → Generate new token.", "Repository access: only MossesX/AmberX-AXF.",
                                  "Permissions: Contents → Read and write, Actions → Read, Metadata → Read.", "Paste it here; it is saved on the server only."], order=10)
        if not tok:
            return self.item("github-token", "github", "GitHub token", "warn", "Not set: CI downloads (APK, Maven) and publishing settings to every clone won't work.", **base)
        code, hdr, _ = _http(f"https://api.github.com/repos/{self.repo}", {"authorization": f"Bearer {tok}", "accept": "application/vnd.github+json"})
        if code == 200:
            scopes = hdr.get("x-oauth-scopes")
            note = f"classic token, scopes: {scopes}" if scopes else "fine-grained token (write access is confirmed on its first push)"
            return self.item("github-token", "github", "GitHub token", "ok", f"Valid and can read {self.repo}; {note}.", **base)
        if code in (401, 403):
            return self.item("github-token", "github", "GitHub token", "error", f"GitHub refused it ({code}): expired, revoked or missing access to {self.repo}.", **base)
        if code == 404:
            return self.item("github-token", "github", "GitHub token", "error", f"The token can't see {self.repo} (404): add the repo to the token's access.", **base)
        return self.item("github-token", "github", "GitHub token", "unknown", f"Couldn't reach GitHub ({code or 'network'}).", **base)

    def c_github_repo(self) -> Check:
        r = subprocess.run(["git", "-c", "safe.directory=*", "-C", str(self.root), "remote", "get-url", "origin"], capture_output=True, text=True, timeout=10)
        url = re.sub(r"//[^@/]+@", "//", r.stdout.strip())
        ok = self.repo.lower() in url.lower()
        return self.item("github-repo", "github", "Repo origin", "ok" if ok else "warn", f"origin → {url or 'none'}" + ("" if ok else f" (expected {self.repo})"), depends=["repo-clone"], order=11)

    # -------------------------------------------------------- Anthropic / Claude

    def c_anthropic_key(self) -> Check:
        key = os.environ.get("ANTHROPIC_API_KEY", "")
        base = dict(fix=self.secret_fix("ANTHROPIC_API_KEY"), links=[{"label": "Anthropic Console → API keys", "url": DOCS["anthropic_keys"]}, {"label": "API docs", "url": DOCS["anthropic_docs"]}],
                    instructions=["console.anthropic.com → Settings → API keys → Create key.", "Paste it here. Claude Code on the VPS keeps its own copy in ~/.anthropic-key (claude-pick --set-key)."], order=20)
        if not key:
            return self.item("anthropic-key", "claude", "Anthropic API key", "warn", "Not set: API-key features can't run (Claude plan sign-in on the VPS is separate).", **base)
        code, _, _ = _http("https://api.anthropic.com/v1/models", {"x-api-key": key, "anthropic-version": "2023-06-01"})
        if code == 200:
            return self.item("anthropic-key", "claude", "Anthropic API key", "ok", "Valid: the Anthropic API accepted it.", **base)
        if code in (401, 403):
            return self.item("anthropic-key", "claude", "Anthropic API key", "error", f"Rejected by the Anthropic API ({code}).", **base)
        return self.item("anthropic-key", "claude", "Anthropic API key", "unknown", f"Couldn't reach the Anthropic API ({code or 'network'}).", **base)

    # -------------------------------------------------------- Hostinger / Coolify / axHub

    def c_hostinger(self) -> Check:
        tok = os.environ.get("HOSTINGER_API_TOKEN", "")
        base = dict(fix=self.secret_fix("HOSTINGER_API_TOKEN"), links=[{"label": "Hostinger API", "url": DOCS["hostinger_api"]}],
                    instructions=["hPanel → your profile → API → Generate token.", "Paste it here."], order=40)
        if not tok:
            return self.item("hostinger-token", "hostinger", "Hostinger API token", "warn", "Not set: VPS and DNS management from the console won't work.", **base)
        code, _, _ = _http("https://developers.hostinger.com/api/vps/v1/virtual-machines", {"authorization": f"Bearer {tok}", "accept": "application/json"})
        st = "ok" if code == 200 else "error" if code in (401, 403) else "unknown"
        return self.item("hostinger-token", "hostinger", "Hostinger API token", st, {"ok": "Valid: Hostinger listed your VPS.", "error": f"Hostinger refused it ({code})."}.get(st, f"Couldn't reach Hostinger ({code or 'network'})."), **base)

    def c_coolify(self) -> Check:
        url = os.environ.get("COOLIFY_URL", "").rstrip("/")
        tok = os.environ.get("COOLIFY_TOKEN", "")
        base = dict(fix=self.secret_fix("COOLIFY_URL", "COOLIFY_TOKEN"), links=[{"label": "Coolify API: authorization", "url": DOCS["coolify_api"]}],
                    instructions=["Coolify → Keys & Tokens → API tokens → Create (root or read+write).", "Enter your Coolify address and the token."], order=50)
        if not url or not tok:
            return self.item("coolify", "coolify", "Coolify API", "warn", "Not set: deploys and app status from the console won't work.", **base)
        code, _, body = _http(f"{url}/api/v1/version", {"authorization": f"Bearer {tok}"})
        st = "ok" if code == 200 else "error" if code in (401, 403) else "unknown"
        return self.item("coolify", "coolify", "Coolify API", st, {"ok": f"Connected (Coolify {body.strip()[:20]}).", "error": f"Coolify refused the token ({code})."}.get(st, f"Couldn't reach {url} ({code or 'network'})."), **base)

    def c_axhub(self) -> Check:
        url = (os.environ.get("AXHUB_URL") or "https://axhub.amberxai.com").rstrip("/")
        tok = os.environ.get("AXHUB_TOKEN", "")
        base = dict(fix=self.secret_fix("AXHUB_URL", "AXHUB_TOKEN"), instructions=["axHub → Clients → create a token for the Dev Console.", "Enter the hub address (default https://axhub.amberxai.com) and the token."], order=60)
        if not tok:
            return self.item("axhub", "axhub", "axHub connection", "warn", "No axHub token: the console can't call the hub (shared data still works through the mounted volume).", **base)
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "axf-console", "version": "1"}}}).encode()
        code, _, _ = _http(f"{url}/mcp", {"authorization": f"Bearer {tok}", "content-type": "application/json", "accept": "application/json, text/event-stream"}, "POST", body)
        st = "ok" if code == 200 else "error" if code in (401, 403) else "unknown"
        return self.item("axhub", "axhub", "axHub connection", st, {"ok": f"Connected to {url}/mcp.", "error": f"axHub refused the token ({code})."}.get(st, f"Couldn't reach {url} ({code or 'network'})."), **base)

    # -------------------------------------------------------- AmberX data

    def c_repo_clone(self) -> Check:
        if not (self.root / ".git").exists():
            return self.item("repo-clone", "data", "Repo clone", "error", f"{self.root} is not a git clone.", instructions=["On the VPS: bash /opt/axf/deploy/install-console.sh"], order=70)
        head = subprocess.run(["git", "-c", "safe.directory=*", "-C", str(self.root), "log", "-1", "--format=%h %cr"], capture_output=True, text=True, timeout=10).stdout.strip()
        return self.item("repo-clone", "data", "Repo clone", "ok", f"{self.root} at {head or '?'} (auto-updates every 5 minutes).", order=70)

    def c_manifest(self) -> Check:
        r = subprocess.run(["node", str(self.root / "framework/cli/project.mjs"), "validate", "."], cwd=self.root, capture_output=True, text=True, timeout=30)
        ok = r.returncode == 0
        lines = [l for l in (r.stdout + r.stderr).splitlines() if l.strip()][-6:]
        return self.item("manifest", "data", "Project manifest", "ok" if ok else "error", "project.manifest.json is valid." if ok else "project.manifest.json fails validation: the build engine refuses to work on this project.",
                         details=lines if not ok else [], instructions=[] if ok else ["Open Standards → Projects to see each problem.", "Or run: node framework/cli/project.mjs validate ."], depends=["repo-clone"], order=71)

    def _shared_paths(self) -> list[str]:
        try:
            return json.loads((self.root / "project.manifest.json").read_text()).get("data", {}).get("shared", [])
        except Exception:  # noqa: BLE001
            return []

    def c_shared_data(self) -> Check:
        root = self.persist_root()
        if not root:
            return self.item("shared-data", "data", "Shared data folder", "warn", "Shared data is read from the repo: the hub's /projects volume isn't mounted, so console edits are only snapshots.",
                             instructions=["Add the axhub-projects volume to axHub (axHub repo deploy/coolify.md §5b).", "Then on the VPS: bash /opt/axf/deploy/install-console.sh"],
                             fix={"type": "host", "command": "bash /opt/axf/deploy/install-console.sh"}, depends=["manifest"], order=72)
        missing = [p for p in self._shared_paths() if not (root / p).exists()]
        writable = os.access(root, os.W_OK)
        if not writable:
            return self.item("shared-data", "data", "Shared data folder", "error", f"{root} isn't writable by the console.", instructions=[f"On the VPS: fix the volume's permissions (install-console.sh sets uid 1000 + group-writable)."], depends=["manifest"], order=72)
        if missing:
            return self.item("shared-data", "data", "Shared data folder", "warn", f"{len(missing)} shared file(s) not on the hub yet.", details=missing,
                             instructions=["Fix automatically copies the repo's snapshot to the hub (files the hub already has are kept)."], depends=["manifest"], order=72)
        return self.item("shared-data", "data", "Shared data folder", "ok", f"{root}: all {len(self._shared_paths())} shared paths present.", depends=["manifest"], order=72)

    def c_claude_files(self) -> Check:
        need = ["_claude/rules", "_claude/memory", "_claude/instructions", "_claude/shared"]
        missing = [p for p in need if not (self.root / p).is_dir()]
        return self.item("claude-files", "data", "Claude files (_claude/)", "ok" if not missing else "warn",
                         "Rules, memory and instructions are present." if not missing else f"Missing: {', '.join(missing)}", depends=["repo-clone"], order=73)

    # -------------------------------------------------------- VPS host (via deploy/console-doctor.sh)

    def host_report(self) -> dict[str, Any] | None:
        try:
            return json.loads(self.host_file.read_text())
        except Exception:  # noqa: BLE001
            return None

    def c_host_report(self) -> Check:
        rep = self.host_report()
        base = dict(fix={"type": "host", "command": HOST_SCRIPT}, instructions=["Open mosh/ssh to the VPS and run the console setup script; it checks the host, fixes what you approve and reports back here.", f"On the VPS: {HOST_SCRIPT}",
                                                                                  "install-console.sh also schedules it every 15 minutes in report-only mode."], order=30)
        if not rep:
            return self.item("host-report", "vps", "VPS host report", "warn", "The VPS host hasn't reported yet, so mosh, Claude Code and cron can't be checked.", **base)
        age = time.time() - float(rep.get("at", 0))
        if age > 86400:
            return self.item("host-report", "vps", "VPS host report", "warn", f"Last host report is {int(age // 3600)} hours old.", **base)
        return self.item("host-report", "vps", "VPS host report", "ok", f"Host {rep.get('host', '?')} reported {int(age // 60)} minute(s) ago.", **base)

    def c_host(self, hid: str) -> Check:
        meta = HOST_CHECKS[hid]
        rep = self.host_report() or {}
        r = (rep.get("checks") or {}).get(hid)
        common = dict(fix={"type": "host", "command": f"{HOST_SCRIPT} --fix {hid}"}, instructions=meta["instructions"], links=meta.get("links", []), depends=["host-report"], order=meta["order"])
        if not r:
            return self.item(hid, meta["service"], meta["title"], "unknown", "Not reported yet: run the console setup script on the VPS.", **common)
        st = r.get("status") if r.get("status") in ("ok", "warn", "error", "info") else "unknown"
        return self.item(hid, meta["service"], meta["title"], st, str(r.get("summary", ""))[:300], **common)

    # -------------------------------------------------------- fixes (safe, server-side only)

    def f_credentials_file(self) -> str:
        if self.store.path.exists():
            os.chmod(self.store.path, 0o600)
        return "set the credential file to owner-only (0600)"

    def f_shared_data(self) -> str:
        root = self.persist_root()
        if not root:
            raise HTTPException(400, "no shared data folder is mounted here; run deploy/install-console.sh on the VPS")
        r = subprocess.run(["node", str(self.root / "framework/cli/persist.mjs"), "push"], cwd=self.root, capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            raise HTTPException(500, (r.stderr or r.stdout).strip()[-300:])
        return "copied the repo's snapshot to the hub (existing hub files kept)"

    def f_claude_files(self) -> str:
        for p in ["_claude/rules", "_claude/memory", "_claude/instructions", "_claude/shared"]:
            (self.root / p).mkdir(parents=True, exist_ok=True)
        return "created the missing _claude/ folders (claude-sync fills them from the hub)"

    # -------------------------------------------------------- run

    def run_one(self, cid: str) -> Check:
        fn = self.checks.get(cid)
        if not fn:
            raise HTTPException(404, f"no check {cid}")
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 — a broken check is reported, never fatal
            return self.item(cid, "console", cid, "unknown", f"The check itself failed: {str(e)[:200]}")

    def run_all(self, force: bool = False) -> list[Check]:
        if self._cache and not force and time.time() - self._cache[0] < 60:
            return self._cache[1]
        with ThreadPoolExecutor(max_workers=8) as ex:
            out = list(ex.map(self.run_one, list(self.checks)))
        out.sort(key=lambda c: (c["order"], c["id"]))
        self._cache = (time.time(), out)
        return out


# VPS-host checks reported by deploy/console-doctor.sh (ids must match the script).
HOST_CHECKS: dict[str, dict[str, Any]] = {
    "host-mosh": {"service": "vps", "title": "mosh server", "order": 31, "instructions": ["sudo apt-get install -y mosh"], "links": [{"label": "mosh: getting started", "url": DOCS["mosh"]}]},
    "host-mosh-ports": {"service": "vps", "title": "Firewall: mosh UDP ports", "order": 32, "instructions": ["sudo ufw allow 60000:61000/udp", "Also allow UDP 60000-61000 in hPanel → VPS → Firewall if you use Hostinger's firewall."], "links": [{"label": "UFW guide", "url": DOCS["ufw"]}]},
    "host-docker": {"service": "vps", "title": "Docker + console container", "order": 33, "instructions": ["docker ps --filter name=axf-console", "If it isn't running: bash /opt/axf/deploy/install-console.sh"]},
    "host-update-cron": {"service": "vps", "title": "Console auto-update (cron)", "order": 34, "instructions": ["bash /opt/axf/deploy/install-console.sh (installs /etc/cron.d/axf-console)"]},
    "host-claude-cli": {"service": "claude", "title": "Claude Code on the VPS", "order": 21, "instructions": ["curl -fsSL https://claude.ai/install.sh | bash   (or: npm install -g @anthropic-ai/claude-code)"], "links": [{"label": "Claude Code setup", "url": DOCS["claude_code"]}]},
    "host-claude-login": {"service": "claude", "title": "Claude sign-in on the VPS", "order": 22, "instructions": ["Run claude, then /login, and sign in with your Claude plan (or save an API key: claude-pick --set-key)."], "links": [{"label": "Claude Code setup", "url": DOCS["claude_code"]}]},
    "host-claude-pick": {"service": "claude", "title": "claude-pick launcher (model + sign-in choice)", "order": 23, "instructions": ["bash /opt/axf/deploy/claude-pick.sh --install"]},
    "host-claude-sync": {"service": "claude", "title": "claude-sync (rules + memory from the hub)", "order": 24, "instructions": ["git clone https://github.com/MossesX/axHub ~/axHub", "node ~/axHub/clients/claude-code/claude-sync.mjs install"]},
    "host-session-checkin": {"service": "claude", "title": "Session check-in on the VPS", "order": 25, "instructions": ["node /opt/axf/apps/console-web/plugins/session-checkin/install.mjs   (choose: every folder on this device)", "Or install it for every clone from Settings → Plugins → Session check-in."], "links": [{"label": "Claude Code hooks", "url": DOCS["claude_hooks"]}]},
    "host-anthropic-keyfile": {"service": "claude", "title": "API key file (~/.anthropic-key)", "order": 26, "instructions": ["claude-pick --set-key (stores it owner-only)", "chmod 600 ~/.anthropic-key"]},
    "host-git-auth": {"service": "github", "title": "GitHub access from the VPS", "order": 12, "instructions": ["git -C /opt/axf fetch   (should work without a password prompt)", "If it fails: gh auth login, or store a token with git's credential helper."]},
    "host-axhub-volume": {"service": "axhub", "title": "axhub-projects volume", "order": 61, "instructions": ["Coolify → axHub → Persistent Storage: add a volume named axhub-projects mounted at /projects (axHub repo deploy/coolify.md §5b), then redeploy axHub.", "Then on the VPS: bash /opt/axf/deploy/install-console.sh"]},
}


# ---------------------------------------------------------------- routes

class SecretReq(BaseModel):
    key: str = Field(pattern=r"^[A-Z][A-Z0-9_]{1,63}$")
    value: str = Field(min_length=1, max_length=500)


class ClearReq(BaseModel):
    key: str = Field(pattern=r"^[A-Z][A-Z0-9_]{1,63}$")


def router_for(sc: SysCheck, auth: Callable[..., None]) -> APIRouter:
    r = APIRouter(prefix="/api/system", dependencies=[Depends(auth)])

    def related(key: str) -> list[str]:
        return {"GITHUB_TOKEN": ["github-token"], "ANTHROPIC_API_KEY": ["anthropic-key"], "HOSTINGER_API_TOKEN": ["hostinger-token"],
                "COOLIFY_URL": ["coolify"], "COOLIFY_TOKEN": ["coolify"], "AXHUB_URL": ["axhub"], "AXHUB_TOKEN": ["axhub"]}.get(key, [])

    @r.get("/check")
    def check(force: bool = False) -> dict[str, Any]:
        items = sc.run_all(force)
        return {"at": int(time.time() * 1000), "services": SERVICES, "checks": items, "hostScript": HOST_SCRIPT,
                "counts": {s: sum(1 for c in items if c["status"] == s) for s in ("ok", "warn", "error", "info", "unknown")}}

    @r.post("/check/{cid}")
    def check_one(cid: str) -> dict[str, Any]:
        c = sc.run_one(cid)
        sc._cache = None  # noqa: SLF001
        return c

    @r.post("/secret")
    def set_secret(req: SecretReq) -> dict[str, Any]:
        meta = CREDENTIALS.get(req.key)
        if not meta:
            raise HTTPException(400, f"{req.key} isn't a credential the console stores")
        value = req.value.strip()
        if "\n" in value or "\r" in value or not re.match(meta["pattern"], value):
            raise HTTPException(400, f"That doesn't look right for {meta['label']} (expected: {meta['placeholder']}).")
        sc.store.set(req.key, value.rstrip("/") if not meta["secret"] else value)
        sc._cache = None  # noqa: SLF001
        sc.log("system", f"{meta['label']} saved (server-side, owner-only)", "ok")
        return {"ok": True, "key": req.key, "checks": [sc.run_one(c) for c in related(req.key)]}

    @r.post("/secret/clear")
    def clear_secret(req: ClearReq) -> dict[str, Any]:
        if req.key not in CREDENTIALS:
            raise HTTPException(400, "unknown credential")
        sc.store.clear(req.key)
        sc._cache = None  # noqa: SLF001
        sc.log("system", f"{CREDENTIALS[req.key]['label']} removed", "warn")
        return {"ok": True, "checks": [sc.run_one(c) for c in related(req.key)]}

    @r.post("/fix/{cid}")
    def fix(cid: str) -> dict[str, Any]:
        fn = sc.fixes.get(cid)
        if not fn:
            raise HTTPException(400, "this check has no automatic fix")
        msg = fn()
        sc._cache = None  # noqa: SLF001
        sc.log("system", f"{cid}: {msg}", "ok")
        return {"ok": True, "message": msg, "check": sc.run_one(cid)}

    return r
