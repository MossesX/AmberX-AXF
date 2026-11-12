"""Web browser (server part): open any website in an embedded browser pane in the console (and Molly, which hosts it).

Brett (Nov 10 2026): "I need to be able to tell you to go to any website and open the web browser with the recorder in
AmberX, or in a plugin somewhere." AmberX's Web plugin answers "go to <site>" on the phone; this is the "plugin
somewhere": the same open from the console page, REST, MCP (plugin commands), the CLI (`axf web-browser open --url …`)
and Claude sessions. Only http(s) pages open; every open and close is appended to the audit log in the data folder.

  GET  state                         {current, recent}: what the pane shows now and the last opens
  POST open   {url, show?, record?, by?, reason?}   validate + log + show it in the pane (show: bring the console to it)
  POST close  {by?, reason?}         clear the pane (logged)
  GET  log?limit=50                  the audit log, newest first

`record` is noted on the entry: recording runs on the phone (AmberX's recorder); the pane only remembers it was asked.
Capability web-browser@1: plugin_services.get("web-browser@1").open(url, by=…) / .state().
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from fastapi import APIRouter, HTTPException, Request

import plugin_services

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
ROOT = Path(__file__).resolve().parents[5]
MAX_URL = 2000
RECENT = 30
LOG_MAX_READ = 500
_lock = threading.Lock()
HOST_RE = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$")
SCHEME_RE = re.compile(r"^[a-z][a-z0-9+.-]*:", re.I)


def data_dir() -> Path:
    return Path(os.environ.get("AXF_WEB_BROWSER_DIR") or (ROOT / ".axf-console" / "plugins" / FOLDER))


def clean_url(raw: Any) -> str:
    """A typed address or URL → an http(s) URL, or ValueError with a message for people. Never javascript:, file:,
    data:, intent: or any other scheme; no user name or password in it."""
    s = str(raw or "").strip()
    if not s:
        raise ValueError("url is required.")
    if len(s) > MAX_URL:
        raise ValueError("url is too long.")
    if any(c.isspace() or ord(c) < 32 for c in s):
        raise ValueError("url can't contain spaces.")
    if SCHEME_RE.match(s) and not re.match(r"^https?://", s, re.I) and not re.match(r"^[a-z0-9.-]+:\d+(/|$)", s, re.I):
        raise ValueError("Only web pages (http or https) can be opened.")
    if not re.match(r"^https?://", s, re.I):
        s = f"https://{s}"
    u = urlsplit(s)
    if u.scheme.lower() not in ("http", "https"):
        raise ValueError("Only web pages (http or https) can be opened.")
    if u.username or u.password:
        raise ValueError("url can't carry a user name or password.")
    host = (u.hostname or "").lower()
    if not host or not HOST_RE.match(host) or "." not in host and host != "localhost":
        raise ValueError("url needs a real host name.")
    try:
        port = u.port
    except ValueError:
        raise ValueError("url has a bad port.") from None
    netloc = host + (f":{port}" if port else "")
    return urlunsplit((u.scheme.lower(), netloc, u.path or "/", u.query, u.fragment))


def _state_file() -> Path:
    return data_dir() / "state.json"


def _audit_file() -> Path:
    return data_dir() / "audit.jsonl"


def _read_state() -> dict[str, Any]:
    try:
        s = json.loads(_state_file().read_text())
        return s if isinstance(s, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _write_state(s: dict[str, Any]) -> None:
    data_dir().mkdir(parents=True, exist_ok=True)
    tmp = _state_file().with_suffix(".tmp")
    tmp.write_text(json.dumps(s, indent=1))
    tmp.replace(_state_file())


def _audit(entry: dict[str, Any]) -> None:
    data_dir().mkdir(parents=True, exist_ok=True)
    with _audit_file().open("a") as f:
        f.write(json.dumps(entry) + "\n")


def _iso(t: float | None = None) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() if t is None else t))


def _reason(r: Any) -> dict[str, str] | None:
    if isinstance(r, dict) and (r.get("title") or r.get("description")):
        return {"title": str(r.get("title") or "")[:200], "description": str(r.get("description") or "")[:1000]}
    return None


def state() -> dict[str, Any]:
    s = _read_state()
    return {"current": s.get("current"), "recent": (s.get("recent") or [])[:RECENT], "rev": int(s.get("rev") or 0)}


def open_url(url: Any, by: str = "", record: bool = False, reason: Any = None, via: str = "api") -> dict[str, Any]:
    clean = clean_url(url)
    entry: dict[str, Any] = {"at": _iso(), "op": "open", "url": clean, "host": urlsplit(clean).hostname, "record": bool(record), "via": via[:40], "by": str(by or "")[:120]}
    if (r := _reason(reason)):
        entry["reason"] = r
    with _lock:
        s = _read_state()
        recent = [e for e in (s.get("recent") or []) if e.get("url") != clean]
        s.update(current=entry, recent=[entry, *recent][:RECENT], rev=int(s.get("rev") or 0) + 1)
        _write_state(s)
        _audit(entry)
    return {"ok": True, **entry, "rev": s["rev"]}


def close(by: str = "", reason: Any = None, via: str = "api") -> dict[str, Any]:
    with _lock:
        s = _read_state()
        was = (s.get("current") or {}).get("url")
        s.update(current=None, rev=int(s.get("rev") or 0) + 1)
        _write_state(s)
        entry: dict[str, Any] = {"at": _iso(), "op": "close", "url": was, "via": via[:40], "by": str(by or "")[:120]}
        if (r := _reason(reason)):
            entry["reason"] = r
        _audit(entry)
    return {"ok": True, "closed": was, "rev": s["rev"]}


def log(limit: int = 50) -> list[dict[str, Any]]:
    try:
        lines = _audit_file().read_text().splitlines()
    except OSError:
        return []
    out: list[dict[str, Any]] = []
    for line in reversed(lines[-LOG_MAX_READ:]):
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
        if len(out) >= max(1, min(int(limit), LOG_MAX_READ)):
            break
    return out


def _show_in_console(by: str) -> dict[str, Any] | None:
    """Bring Brett's open console to the pane (console-commands@1), when that plugin is there."""
    cc = plugin_services.get("console-commands@1")
    if not cc:
        return None
    cmd = {"op": "act", "target": "console.actions", "path": "web-browser.show", "action": "run", "input": {"args": []}}
    try:
        r = cc.run(cmd, by=by or "web-browser", wait=5)
    except TypeError:
        r = cc.run(cmd, by=by or "web-browser")
    except Exception as e:  # the open itself stands; only showing it failed
        return {"ok": False, "message": str(e)[:200]}
    return {"ok": bool(r.get("ok")), "how": (r.get("delivery") or {}).get("how"), "message": r.get("message")}


async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
    except Exception:
        return {}
    return b if isinstance(b, dict) else {}


@router.get("/state")
def browser_state() -> dict[str, Any]:
    """What the browser pane shows now and the last pages opened."""
    return state()


@router.post("/open")
async def open_website(request: Request) -> dict[str, Any]:
    """Open a website (http or https, any host) in the console's browser pane; logged. Body: {url, show?, record?, by?, reason?}."""
    b = await _body(request)
    try:
        r = open_url(b.get("url"), by=str(b.get("by") or ""), record=b.get("record") is True, reason=b.get("reason"), via=str(b.get("via") or "api"))
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    if b.get("show") is not False:
        from fastapi.concurrency import run_in_threadpool
        r["shown"] = await run_in_threadpool(_show_in_console, str(b.get("by") or ""))
    return r


@router.post("/close")
async def close_website(request: Request) -> dict[str, Any]:
    """Clear the browser pane; logged. Body: {by?, reason?}."""
    b = await _body(request)
    return close(by=str(b.get("by") or ""), reason=b.get("reason"), via=str(b.get("via") or "api"))


@router.get("/log")
def audit_log(limit: int = 50) -> dict[str, Any]:
    """The audit log of every open and close, newest first."""
    return {"entries": log(limit)}


class Service:
    """web-browser@1."""

    def open(self, url: str, by: str = "", record: bool = False, reason: Any = None) -> dict[str, Any]:
        return open_url(url, by=by, record=record, reason=reason, via="service")

    def close(self, by: str = "") -> dict[str, Any]:
        return close(by=by, via="service")

    def state(self) -> dict[str, Any]:
        return state()


plugin_services.provide("web-browser@1", Service(), FOLDER)
