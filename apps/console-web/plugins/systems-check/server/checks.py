"""Systems check — the built-in checks (moved from the console core into this plugin).

Everything the console and its features need: the console token, credentials (stored by the core credential store,
server/credentials.py), GitHub, Anthropic, Hostinger, Coolify, axHub, the repo clone, project manifest, shared data,
Claude files, and the VPS host items reported by deploy/console-doctor.sh (<repo>/.axf-console/host-check.json).
Codebase-derived checks (derive.py) and the stored AI routine (routine.py) run next to these.
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
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable


from fastapi import HTTPException  # noqa: E402 — raised by fixes and run_one (was used without an import)
from credentials import CREDENTIALS, CredStore  # noqa: E402,F401 — core module (server/credentials.py)
import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import github, http as axf_http

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
    """One check request (axf_server.http): https only (plain http only to this machine), redirects never followed (the
    keys being checked must not travel to another host; a 3xx is the answer), 4 KB read. Network trouble → (0, {}, why)."""
    try:
        r = axf_http.request(method, url, headers={"user-agent": "axf-console-syscheck", **(headers or {})}, body=body, timeout=timeout, max_bytes=4000, truncate=True)
    except axf_http.HttpError as e:
        return 0, {}, str(e)[:200]
    return r.status, r.headers, r.text() if r.ok else ""


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
        import credentials
        self.store = credentials.STORE or credentials.init(root)
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
            "moshi-key": self.c_moshi_key,
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
        if not github.valid_repo(self.repo):
            return self.item("github-token", "github", "GitHub token", "error", f"AXF_GITHUB_REPO isn't owner/name ({self.repo[:60]!r}).", **base)
        # lib-github: token to api.github.com only, no redirects, 4 KB read, 7 s
        code, hdr = github.GitHubClient(tok, user_agent="axf-console-syscheck").check_token(self.repo, timeout=7)
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
        if not axf_http.target_ok(url):  # the token is never sent over plain http to another machine (axf_server.http)
            return self.item("coolify", "coolify", "Coolify API", "error", f"{url} isn't https: use the https address of your Coolify dashboard so the token isn't sent in the clear.", **base)
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

    def c_moshi_key(self) -> Check:
        """Can Moshi (the phone's mosh/ssh app) sign in to the VPS with a key? The host doctor looks for a key named "moshi"
        in root's authorized_keys. A key pasted here is only saved; the doctor installs it after showing its fingerprint."""
        rep = self.host_report() or {}
        r = (rep.get("checks") or {}).get("host-moshi-key") or {}
        saved = bool(os.environ.get("MOSHI_SSH_PUBKEY"))
        cmd = f"{HOST_SCRIPT} --fix host-moshi-key"
        base = dict(fix=self.secret_fix("MOSHI_SSH_PUBKEY"), depends=["host-report"], order=30,
                    instructions=["In Moshi: Keys → your key → copy the public key, and paste it here.", f"Then on the VPS: {cmd}   (shows the key's fingerprint and asks before adding it)"],
                    links=[{"label": "Moshi", "url": "https://getmoshi.app"}])
        if r.get("status") == "ok":
            return self.item("moshi-key", "vps", "Moshi key", "ok", str(r.get("summary", ""))[:300], **base)
        if not r:
            return self.item("moshi-key", "vps", "Moshi key", "unknown", "The VPS hasn't reported its sign-in keys yet.", **base)
        if saved:
            return self.item("moshi-key", "vps", "Moshi key", "warn", f"Saved here, not on the VPS yet. Run on the VPS: {cmd}", **base)
        return self.item("moshi-key", "vps", "Moshi key", "error", "No Moshi key can sign in to the VPS: paste Moshi's public key.", **base)

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
