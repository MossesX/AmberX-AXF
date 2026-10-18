"""The AI routine: checks Mosses works out by reading the codebase, saved so they run without AI later.

When "Use AI for the systems check" is on (needs the AI assistant + the Mosses agent), the plugin hands Mosses a
digest of the codebase (plugins and what they need, deploy scripts, env variables the server reads, the console's
status notes, the checks that already exist) and asks for extra checks in a fixed, declarative format. They're
validated, run, and saved as `routine.json` (check-routine@1). With AI off, the saved routine still runs, exactly as
written, with no model. Nothing an AI writes is ever executed as code: only these check kinds exist.

  env      {name}                      the variable is set in the console's environment (presence only; value never read)
  file     {path, mode?}               a file or folder exists (repo-relative, or under the shared data folder)
  json     {path, key}                 a JSON file has a key (dot path)
  service  {name}                      a capability service is provided (e.g. axf.containers@1)
  plugin   {folder}                    a console plugin is loaded and enabled
  http     {url, expect?}              an https URL on a public host answers with an expected status (default 2xx/3xx)
"""
from __future__ import annotations

import ipaddress
import json
import os
import re
import socket
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

import console_context as cx
import plugin_services

from . import store

KINDS = ("env", "file", "json", "service", "plugin", "http")
SEVERITIES = ("error", "warn", "info")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{1,63}$")
Check = dict[str, Any]


# ---------------------------------------------------------------- validation

def _rel_ok(p: str) -> bool:
    return bool(p) and not p.startswith(("/", "~")) and ".." not in Path(p).parts and len(p) < 300


def validate(raw: Any) -> tuple[list[dict[str, Any]], list[str]]:
    """Keep only well-formed checks; return (checks, problems)."""
    out: list[dict[str, Any]] = []
    problems: list[str] = []
    seen: set[str] = set()
    for i, c in enumerate(raw if isinstance(raw, list) else []):
        if not isinstance(c, dict):
            problems.append(f"#{i}: not an object")
            continue
        cid = str(c.get("id") or "").strip().lower()
        kind = c.get("kind")
        p = c.get("params") if isinstance(c.get("params"), dict) else {}
        why = ""
        if not ID_RE.match(cid) or cid in seen:
            why = "bad or duplicate id"
        elif kind not in KINDS:
            why = f"unknown kind {kind!r}"
        elif kind == "env" and not re.match(r"^[A-Z][A-Z0-9_]{1,63}$", str(p.get("name", ""))):
            why = "env name"
        elif kind in ("file", "json") and not _rel_ok(str(p.get("path", ""))):
            why = "path must be relative inside the repo"
        elif kind == "json" and not re.match(r"^[A-Za-z0-9_$.-]{1,120}$", str(p.get("key", ""))):
            why = "json key"
        elif kind == "service" and not re.match(r"^[a-z][a-z0-9.-]{1,60}@\d+$", str(p.get("name", ""))):
            why = "service name"
        elif kind == "plugin" and not re.match(r"^[a-z0-9][a-z0-9-]{0,62}$", str(p.get("folder", ""))):
            why = "plugin folder"
        elif kind == "http" and not re.match(r"^https://[A-Za-z0-9.-]+(:\d+)?(/[^\s]*)?$", str(p.get("url", ""))):
            why = "http checks are https URLs only"
        if why:
            problems.append(f"{cid or '#' + str(i)}: {why}")
            continue
        seen.add(cid)
        out.append({"id": cid, "kind": kind, "params": {k: v for k, v in p.items() if k in ("name", "path", "mode", "key", "folder", "url", "expect")},
                    "title": str(c.get("title") or cid)[:120], "service": str(c.get("service") or "routine")[:30],
                    "severity": c.get("severity") if c.get("severity") in SEVERITIES else "warn",
                    "why": str(c.get("why") or "")[:300], "instructions": [str(x)[:300] for x in (c.get("instructions") or [])][:5]})
        if len(out) >= 60:
            break
    return out, problems


# ---------------------------------------------------------------- running (no AI involved)

def _public_ips(host: str, port: int = 443) -> list[str]:
    """Every address the host resolves to, or [] when any of them isn't a public address."""
    try:
        ips = [sa[0] for _fam, *_rest, sa in socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)]
        return ips if ips and all(ipaddress.ip_address(ip).is_global for ip in ips) else []
    except (OSError, ValueError):
        return []


def _public_host(host: str) -> bool:
    return bool(_public_ips(host))


def _https_status(url: str) -> int:
    """GET over https to the address that was checked (no second DNS lookup, so no rebinding), certificate checked for
    the host name, redirects not followed (a 3xx is the answer)."""
    import http.client
    import ssl
    u = urllib.parse.urlparse(url)
    host, port = u.hostname or "", u.port or 443
    ips = _public_ips(host, port)
    if not ips:
        raise PermissionError("not a public host")
    ctx = ssl.create_default_context()
    sock = socket.create_connection((ips[0], port), timeout=8)
    try:
        tls = ctx.wrap_socket(sock, server_hostname=host)
    except Exception:
        sock.close()
        raise
    conn = http.client.HTTPSConnection(host, port, timeout=8, context=ctx)
    conn.sock = tls
    try:
        conn.request("GET", (u.path or "/") + (f"?{u.query}" if u.query else ""), headers={"user-agent": "axf-console-syscheck", "host": u.netloc})
        return conn.getresponse().status
    finally:
        conn.close()


def run_one(d: dict[str, Any], item: Callable[..., Check]) -> Check:
    p, kind, sev = d["params"], d["kind"], d["severity"]
    ok, summary = False, ""
    try:
        if kind == "env":
            v = os.environ.get(p["name"], "")
            ok = bool(v)  # presence only: matching a pattern against a secret's value would leak it bit by bit
            summary = f"{p['name']} is set" if ok else f"{p['name']} isn't set"
        elif kind in ("file", "json"):
            base = cx.persist_root()
            path = next((b / p["path"] for b in ([base] if base else []) + [cx.ROOT] if (b / p["path"]).exists()), None)
            if not path:
                summary = f"{p['path']} is missing"
            elif kind == "file":
                ok = True
                if p.get("mode"):
                    mode = oct(path.stat().st_mode & 0o777)[2:]
                    ok = mode == str(p["mode"]).lstrip("0o").zfill(3)
                    summary = f"{p['path']} is mode {mode}" + ("" if ok else f" (expected {p['mode']})")
                else:
                    summary = f"{p['path']} exists"
            else:
                cur: Any = json.loads(path.read_text("utf-8"))
                for part in str(p["key"]).split("."):
                    cur = cur.get(part) if isinstance(cur, dict) else None
                ok = cur is not None
                summary = f"{p['path']} has {p['key']}" if ok else f"{p['path']} has no {p['key']}"
        elif kind == "service":
            ok = plugin_services.get(p["name"]) is not None
            summary = f"{p['name']} is provided" if ok else f"nothing provides {p['name']}"
        elif kind == "plugin":
            info = cx.PLUGINS.get(p["folder"])
            ok = bool(info) and info.get("server") in ("loaded", "none") and not info.get("error") and cx.plugin_enabled(p["folder"])
            summary = f"{p['folder']} is loaded and enabled" if ok else f"{p['folder']} isn't installed, loaded or enabled"
        elif kind == "http":
            u = urllib.parse.urlparse(p["url"])
            if not _public_host(u.hostname or ""):
                summary = "refused: not a public host"
            else:
                code = _https_status(p["url"])
                exp = p.get("expect")
                ok = code in exp if isinstance(exp, list) else 200 <= code < 400
                summary = f"HTTP {code}"
    except Exception as e:  # noqa: BLE001
        summary = f"couldn't run: {str(e)[:160]}"
    status = "ok" if ok else {"error": "error", "warn": "warn", "info": "info"}[sev]
    return item(f"routine:{d['id']}", d["service"] if d["service"] in store.SERVICE_IDS else "routine", d["title"], status, summary,
                details=[x for x in [d.get("why"), f"{kind} {json.dumps(p)}"] if x], instructions=d.get("instructions") or [], order=90)


def run_saved(item: Callable[..., Check]) -> list[Check]:
    r = store.routine()
    return [run_one(d, item) for d in r.get("checks", [])] if r else []


# ---------------------------------------------------------------- generating with AI (Mosses)

def _git_head() -> str:
    try:
        return subprocess.run(["git", "-C", str(cx.ROOT), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def digest(existing: list[Check]) -> str:
    """What Mosses gets to read: facts from the codebase, never secrets."""
    from .derive import plugin_manifests
    parts = ["# Console plugins (folder: name — provides / requires / optional / env it reads)"]
    for m in plugin_manifests():
        if m.get("error"):
            continue
        lc = m.get("lifecycle") or {}
        parts.append(f"- {m['folder']}: {m.get('name')} — provides {m.get('provides', [])} / requires {m.get('requires', [])} / optional {m.get('optional', [])} / env {lc.get('env', [])}")
    dep = cx.ROOT / "deploy"
    if dep.is_dir():
        parts.append("# Deploy scripts\n" + ", ".join(sorted(f.name for f in dep.iterdir() if f.is_file())[:60]))
    env_reads: set[str] = set()
    for f in list((cx.ROOT / "apps" / "console-web" / "server").glob("*.py"))[:40]:
        try:
            env_reads.update(re.findall(r"os\.environ(?:\.get)?\(?\[?\"([A-Z][A-Z0-9_]{2,63})\"", f.read_text("utf-8", "ignore")))
        except OSError:
            pass
    parts.append("# Environment variables the console server reads\n" + ", ".join(sorted(env_reads)))
    try:
        claude = (cx.ROOT / "CLAUDE.md").read_text("utf-8", "ignore")
        i = claude.find("## Status")
        parts.append("# Status notes (CLAUDE.md)\n" + claude[i:i + 14000])
    except OSError:
        pass
    parts.append("# Checks that already exist (don't repeat them)\n" + ", ".join(sorted(c["id"] for c in existing)))
    return "\n\n".join(parts)


PROMPT = """You're running the systems check for Brett's AmberX AXF Dev Console. Read the codebase digest below and
propose EXTRA checks that would catch real setup problems the existing checks miss (a credential a plugin needs that
isn't set, a capability a feature depends on, a file a deploy needs, a public endpoint that should answer).

Answer with ONLY a JSON object, no prose:
{"checks": [{"id": "kebab-id", "kind": "env|file|json|service|plugin|http", "params": {...}, "title": "short title",
  "service": "console|github|claude|vps|coolify|axhub|data|plugins|routine", "severity": "error|warn|info",
  "why": "one plain sentence", "instructions": ["how Brett fixes it"]}]}
params per kind: env {name} · file {path (repo-relative), mode?} · json {path, key (dot path)} ·
service {name, e.g. axf.containers@1} · plugin {folder} · http {url (https, public), expect? [codes]}.
At most 25 checks. Never include secret values. Prefer checks that are true when things are set up right."""


def generate(existing: list[Check]) -> dict[str, Any]:
    """Ask Mosses for the routine, validate it, save it. Raises when the AI requirements aren't met."""
    from .derive import MOSSES, requirement_status
    req = requirement_status()
    if not req["ok"]:
        raise PermissionError("AI needs the AI assistant and the Mosses agent installed")
    llm = plugin_services.get("axf.llm@1")
    agent = plugin_services.get("axf.agents@1").get_agent(MOSSES) or {}
    system = (agent.get("system_prompt") or "") + "\n\nFor this task, reply with JSON only (your persona doesn't apply inside JSON)."
    started = time.time()
    out = llm.complete([{"role": "user", "content": PROMPT + "\n\n" + digest(existing)}], system=system,
                       params={"temperature": 0.1, "max_tokens": 6000})
    text = out.get("text") or ""
    m = re.search(r"\{.*\}", text, re.S)
    try:
        raw = json.loads(m.group(0)) if m else {}
    except ValueError:
        raw = {}
    checks, problems = validate(raw.get("checks") if isinstance(raw, dict) else None)
    r = {"$axf": "check-routine@1", "source": "ai", "agent": agent.get("name") or MOSSES, "model": out.get("model"), "profile": out.get("profile"),
         "generatedAt": int(time.time() * 1000), "head": _git_head(), "seconds": round(time.time() - started, 1),
         "checks": checks, "rejected": problems[:40]}
    store.save_routine(r)
    return r


def stale() -> bool:
    """The saved routine was made for another commit (the codebase changed since)."""
    r = store.routine()
    return not r or r.get("head") != _git_head()
