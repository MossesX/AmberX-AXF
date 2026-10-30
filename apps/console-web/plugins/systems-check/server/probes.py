"""Live probes: each key and connection tested against its service with one cheap read-only call (Brett, Oct 30 2026:
the console's GITHUB_TOKEN went dead and nothing told him).

Every probe is a plain function of its inputs and a `fetch` (url, headers, method, body) -> (status, headers, text), so
the self-test runs them against fake services (ok, 401, missing scope, expiring, unreachable). A probe answers a
`Probe` dict: status ok | warn | error | unknown, a plain summary, details, and `unreachable` when the service never
answered (the health monitor holds that amber until it has lasted a while, so one network blip doesn't page Brett).
Secrets go only into request headers: never into a summary, a detail or a log line.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from datetime import datetime, timezone
from typing import Any, Callable

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import http as axf_http

Fetch = Callable[..., tuple[int, dict[str, str], str]]
Probe = dict[str, Any]
GH = "https://api.github.com"
WEEK = 7 * 86400


def fetch(url: str, headers: dict[str, str] | None = None, method: str = "GET", body: bytes | None = None, timeout: float = 8, max_bytes: int = 64_000) -> tuple[int, dict[str, str], str]:
    """One probe request (axf_server.http): https only, no redirects followed, capped read. Network trouble → (0, {}, why)."""
    try:
        r = axf_http.request(method, url, headers={"user-agent": "axf-console-health", **(headers or {})}, body=body, timeout=timeout, max_bytes=max_bytes, truncate=True)
    except axf_http.HttpError as e:
        return 0, {}, str(e)[:200]
    return r.status, r.headers, r.text()


def p(status: str, summary: str, **kw: Any) -> Probe:
    return {"status": status, "summary": summary, "details": kw.pop("details", []), **kw}


def unreachable(what: str, code: int, why: str = "") -> Probe:
    return p("error", f"Couldn't reach {what} ({code or 'no answer'}{': ' + why[:80] if why and not code else ''}).", unreachable=True)


def scrub(text: str, *secrets: str) -> str:
    for s in secrets:
        if s:
            text = text.replace(s, "…")
    return text


# ---------------------------------------------------------------- GitHub

# What the console's GitHub helpers need (push banner, auto-merge, branch cleanup, CI downloads, What's new).
GITHUB_CLASSIC_SCOPES = ("repo", "workflow")
GITHUB_FINE_PERMS = (("contents", "Contents: read and write"), ("pull_requests", "Pull requests: read and write"),
                     ("actions", "Actions: read and write"), ("metadata", "Metadata: read"))


def parse_expiry(v: str) -> float | None:
    """GitHub's `github-authentication-token-expiration` header, e.g. "2026-11-05 18:00:00 UTC" or "… -0500"."""
    v = (v or "").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S %Z", "%Y-%m-%d %H:%M:%S %z", "%Y-%m-%d"):
        try:
            d = datetime.strptime(v, fmt)
            return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).timestamp()
        except ValueError:
            continue
    return None


def github(token: str, repo: str, f: Fetch = fetch, now: float | None = None) -> Probe:
    """GET /user (is it alive, when does it expire), then what the console's helpers need: classic scopes from
    x-oauth-scopes, or for a fine-grained token one read each of the repo, its pull requests and its Actions runs."""
    now = time.time() if now is None else now
    if not token:
        return p("warn", "Not set: the push banner, auto-merge, branch cleanup and CI downloads can't reach GitHub.", missing=True)
    h = {"authorization": f"Bearer {token}", "accept": "application/vnd.github+json", "x-github-api-version": "2022-11-28"}
    code, hdr, body = f(f"{GH}/user", h)
    if code == 0:
        return unreachable("GitHub", code, body)
    if code in (401, 403):
        return p("error", f"GitHub refused the token ({code}): it's expired or revoked.", dead=True)
    if code != 200:
        return unreachable("GitHub", code)
    try:
        login = str(json.loads(body).get("login") or "")
    except ValueError:
        login = ""
    who = f" as {login}" if login else ""
    exp = parse_expiry(hdr.get("github-authentication-token-expiration", ""))
    missing: list[str] = []
    scopes_hdr = hdr.get("x-oauth-scopes")
    kind = "classic" if scopes_hdr is not None else "fine-grained"
    if scopes_hdr is not None:
        have = {s.strip() for s in scopes_hdr.split(",") if s.strip()}
        missing = [s for s in GITHUB_CLASSIC_SCOPES if s not in have]
    else:
        rc, _, rb = f(f"{GH}/repos/{repo}", h)
        if rc == 0:
            return unreachable("GitHub", rc, rb)
        if rc in (403, 404):
            return p("error", f"The token works{who} but can't see {repo} ({rc}): add the repo to the token.", missing_scope=True,
                     details=["Repository access: only MossesX/AmberX-AXF (or All repositories)."])
        try:
            if not (json.loads(rb).get("permissions") or {}).get("push"):
                missing.append("Contents: read and write")
        except ValueError:
            pass
        for path, label in ((f"/repos/{repo}/pulls?per_page=1&state=all", "Pull requests: read and write"), (f"/repos/{repo}/actions/runs?per_page=1", "Actions: read and write")):
            c2, _, _ = f(f"{GH}{path}", h)
            if c2 in (403, 404):
                missing.append(label)
            elif c2 == 0:
                return unreachable("GitHub", c2)
    details = [f"{kind} token{who}"] + ([f"expires {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime(exp))}"] if exp else ["no expiry date"])
    if exp is not None and exp <= now:
        return p("error", f"The GitHub token expired on {time.strftime('%Y-%m-%d', time.gmtime(exp))}.", dead=True, expiresAt=int(exp * 1000), details=details)
    if missing:
        return p("error", f"The token works{who} but is missing {', '.join(missing)}: the push banner, auto-merge and CI helpers fail on it.",
                 missing_scope=missing, expiresAt=int(exp * 1000) if exp else None, details=details)
    if exp is not None and exp - now <= WEEK:
        days = max(0, int((exp - now) // 86400))
        return p("warn", f"The GitHub token expires {'today' if days == 0 else f'in {days} day' + ('s' if days != 1 else '')} ({time.strftime('%b %d', time.gmtime(exp))}): make a new one before then.",
                 expiring=True, expiresAt=int(exp * 1000), details=details)
    return p("ok", f"Valid{who}, can push, open and merge pull requests and read Actions on {repo} ({kind}).", expiresAt=int(exp * 1000) if exp else None, details=details)


def github_ci_main(token: str, repo: str, f: Fetch = fetch) -> Probe:
    """CI on main: the newest completed run of each workflow on main; any of them failed = red, with its link."""
    if not token:
        return p("unknown", "No GitHub token, so CI on main can't be read.")
    code, _, body = f(f"{GH}/repos/{repo}/actions/runs?branch=main&status=completed&per_page=40",
                      {"authorization": f"Bearer {token}", "accept": "application/vnd.github+json"}, max_bytes=400_000)
    if code == 0:
        return unreachable("GitHub", code, body)
    if code != 200:
        return p("unknown", f"GitHub answered {code} for the Actions runs (see the GitHub token check).")
    try:
        runs = json.loads(body).get("workflow_runs") or []
    except ValueError:
        return p("unknown", "GitHub's Actions answer was cut short.")
    latest: dict[str, dict[str, Any]] = {}
    for r in runs:
        latest.setdefault(str(r.get("path") or r.get("name")), r)
    bad = [r for r in latest.values() if r.get("conclusion") in ("failure", "timed_out", "startup_failure")]
    if bad:
        r = bad[0]
        return p("error", f"{len(bad)} workflow{'s' if len(bad) != 1 else ''} failing on main: {', '.join(str(x.get('name')) for x in bad)}.",
                 details=[f"{x.get('name')}: {x.get('conclusion')} at {str(x.get('head_sha') or '')[:7]} ({x.get('html_url')})" for x in bad],
                 link=str(r.get("html_url") or ""))
    return p("ok", f"The last run of each of {len(latest)} workflow{'s' if len(latest) != 1 else ''} on main passed.")


# ---------------------------------------------------------------- Claude / Anthropic, OpenAI, ElevenLabs

def anthropic_key(key: str, f: Fetch = fetch) -> Probe:
    code, _, body = f("https://api.anthropic.com/v1/models?limit=1", {"x-api-key": key, "anthropic-version": "2023-06-01"})
    if code == 200:
        return p("ok", "Valid: the Anthropic API accepted it.")
    if code in (401, 403):
        return p("error", f"The Anthropic API refused the key ({code}): it's revoked or wrong.", dead=True)
    return unreachable("the Anthropic API", code, body)


def claude_code_token(token: str, f: Fetch = fetch) -> Probe:
    """The Claude subscription (Claude Code OAuth) token: the cheapest authenticated read, listing one model."""
    code, _, body = f("https://api.anthropic.com/v1/models?limit=1", {"authorization": f"Bearer {token}", "anthropic-version": "2023-06-01", "anthropic-beta": "oauth-2025-04-20"})
    if code == 200:
        return p("ok", "Valid: Anthropic accepted the Claude sign-in.")
    if code in (401, 403):
        return p("error", f"Anthropic refused the Claude sign-in ({code}): it expired or was signed out.", dead=True)
    return unreachable("the Anthropic API", code, body)


def openai_key(key: str, f: Fetch = fetch) -> Probe:
    code, _, body = f("https://api.openai.com/v1/models", {"authorization": f"Bearer {key}"})
    if code == 200:
        return p("ok", "Valid: OpenAI accepted it.")
    if code in (401, 403):
        return p("error", f"OpenAI refused the key ({code}).", dead=True)
    return unreachable("OpenAI", code, body)


def elevenlabs_key(key: str, f: Fetch = fetch) -> Probe:
    code, _, body = f("https://api.elevenlabs.io/v1/user", {"xi-api-key": key})
    if code == 200:
        return p("ok", "Valid: ElevenLabs accepted it.")
    if code in (401, 403):
        return p("error", f"ElevenLabs refused the key ({code}).", dead=True)
    return unreachable("ElevenLabs", code, body)


# ---------------------------------------------------------------- push path (ntfy + the console alerts AmberX reads)

def ntfy(server: str, topic: str, token: str, f: Fetch = fetch) -> Probe:
    """ntfy's own access check for the topic (GET /<topic>/auth): reachable, and the token (if any) may use it."""
    if not topic:
        return p("info", "ntfy is off (no topic): phones get alerts through the AmberX app.")
    url = f"{server.rstrip('/')}/{topic}/auth"
    code, _, body = f(url, {"authorization": f"Bearer {token}"} if token else {})
    if code == 200:
        return p("ok", f"ntfy topic {topic} is reachable{' with the saved token' if token else ''}.")
    if code in (401, 403):
        return p("error", f"ntfy refused access to topic {topic} ({code}): the token is wrong or lost access.", dead=True)
    return unreachable("ntfy", code, body)


# ---------------------------------------------------------------- local: git push, disk

def git_push(root: str, run: Callable[..., Any] = subprocess.run) -> Probe:
    """Can the VPS checkout push? `git push --dry-run` signs in to GitHub for a push and stops before sending anything."""
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "true", "SSH_ASKPASS": "true", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes -o ConnectTimeout=10"}
    try:
        r = run(["git", "-c", "safe.directory=*", "-C", root, "push", "--dry-run", "--porcelain", "origin", "HEAD:refs/heads/axf-health-probe"],
                capture_output=True, text=True, timeout=30, env=env)
    except Exception as e:  # noqa: BLE001
        return p("error", f"git couldn't run a push check: {str(e)[:120]}", unreachable=True)
    out = re.sub(r"//[^@/\s]+@", "//", (r.stderr or "") + (r.stdout or ""))
    if r.returncode == 0:
        return p("ok", "The VPS checkout can push to GitHub (dry run).")
    low = out.lower()
    if "could not read username" in low or "terminal prompts disabled" in low:
        return p("error", "The VPS checkout has no GitHub credentials for pushing (git would have to ask for a password).", dead=True,
                 details=[ln for ln in out.splitlines() if ln.strip()][-4:])
    if any(w in low for w in ("authentication failed", "could not read username", "permission denied", "403", "401", "invalid username or password")):
        return p("error", "The VPS checkout can't push: GitHub refused its credentials.", dead=True, details=[ln for ln in out.splitlines() if ln.strip()][-4:])
    if any(w in low for w in ("could not resolve host", "timed out", "connection refused", "unable to access")):
        return p("error", "The VPS checkout couldn't reach GitHub to push.", unreachable=True, details=[ln for ln in out.splitlines() if ln.strip()][-4:])
    return p("warn", "git push --dry-run failed.", details=[ln for ln in out.splitlines() if ln.strip()][-4:])


def disk(path: str = "/", limit: float = 0.85, usage: Callable[[str], Any] = shutil.disk_usage) -> Probe:
    u = usage(path)
    used = (u.total - u.free) / u.total if u.total else 0
    gb = u.free / 1e9
    if used >= limit:
        return p("error", f"Disk is {used:.0%} full ({gb:.1f} GB free): builds, Docker and backups start failing near 100%.", details=[f"{path}: {u.total / 1e9:.0f} GB total"])
    return p("ok", f"Disk {used:.0%} used ({gb:.1f} GB free).")
