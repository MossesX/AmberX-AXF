"""Sessions nav (terminal-sessions-nav, Nov 3 2026): the model behind the Terminal's left rail.

Brett: "give the Terminal a collapsible navigation menu on the left listing live sessions, including each session I'm
doing with Claude, so I can mirror it and jump in". Sections:

- **My sessions**: Brett's own Claude Code / shell sessions in tmux, on the VPS and in the console's container (any
  tmux session that isn't a headless run), plus his claude.ai chat / voice sessions (Amber). claude.ai has no live API
  for a transcript, so a chat is mirrored from what reaches the console: its `console_session_note` lines and the
  console MCP tools it calls (through axHub). Each chat is a *feed*, grouped by the session name it gives.
- **Agents**: headless builds (tmux axf-…, deploy/claude-headless.sh) with the agent, model, live cost and status the
  headless meters already carry.
- **Connections**: where a new tab can open (the existing connection list).
- **Recent**: sessions that ended (tmux gone, a chat quiet for FEED_IDLE_S), newest first.

Feeds are kept in the plugin's data folder (feeds.json, last MAX_FEEDS sessions × MAX_LINES lines). A line never holds
a secret: tool arguments are summarised with secret-looking keys dropped, values cut short. Zero tokens: nothing here
calls a model. Served as capability `axf.session-feed@1` (note / record_call / feeds) so the console's MCP server can
post into it without knowing this folder.
"""
from __future__ import annotations

import json
import re
import threading
import time
from typing import Any, Callable

from . import sessions, store

FEED_IDLE_S = 30 * 60  # a chat with no line for 30 min moves to Recent
MAX_FEEDS = 60
MAX_LINES = 200
MAX_RECENT = 30
SESSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@ -]{0,79}$")
SECRET_KEY = re.compile(r"(token|secret|password|passwd|key|auth|cookie|credential|bearer)", re.I)
SOURCES = ("claude-ai-text", "claude-ai-voice", "claude-code", "headless", "agent", "mcp", "other")

_lock = threading.Lock()
_feeds: dict[str, dict[str, Any]] | None = None
_seen: dict[str, dict[str, Any]] = {}  # tmux sessions seen live: when one is gone it moves to Recent
_recent: list[dict[str, Any]] = []
_listeners: set[Callable[[], None]] = set()


def _now_ms() -> int:
    return int(time.time() * 1000)


def _path():
    return store.data_dir() / "feeds.json"


def _load() -> dict[str, dict[str, Any]]:
    global _feeds
    if _feeds is None:
        try:
            raw = json.loads(_path().read_text())
            _feeds = {k: v for k, v in (raw.get("feeds") or {}).items() if isinstance(v, dict)}
        except (OSError, ValueError):
            _feeds = {}
    return _feeds


def _save() -> None:
    f = _load()
    keep = dict(sorted(f.items(), key=lambda kv: kv[1].get("lastAt", 0))[-MAX_FEEDS:])
    f.clear()
    f.update(keep)
    try:
        store._write(_path(), {"$axf": "session-feeds@1", "feeds": f})  # atomic, 0600 (axf_server.storage)
    except OSError:
        pass  # the feed still works for this run


def on_change(f: Callable[[], None]) -> Callable[[], None]:
    """Call `f` whenever a feed gets a line (the nav websocket pushes at once instead of on its next tick)."""
    _listeners.add(f)
    return lambda: _listeners.discard(f)


def _emit() -> None:
    for f in list(_listeners):
        try:
            f()
        except Exception:  # noqa: BLE001 — a closed socket's listener
            pass


def feed_id(session: str) -> str:
    return "chat:" + re.sub(r"-{2,}", "-", re.sub(r"[^A-Za-z0-9._:@-]+", "-", session.strip()))[:80]


def _clip(v: Any, n: int) -> str:
    t = re.sub(r"\s+", " ", str(v if v is not None else "")).strip()
    return t if len(t) <= n else t[: n - 1] + "…"


def summarise_args(args: Any, limit: int = 160) -> str:
    """A short, secret-free line for a tool call's arguments: `key=value` pairs, secret-looking keys dropped. Pure."""
    if not isinstance(args, dict):
        return _clip(args, limit) if args not in (None, "") else ""
    parts = []
    for k, v in args.items():
        if SECRET_KEY.search(str(k)):
            continue
        if isinstance(v, (dict, list)):
            v = json.dumps(v, separators=(",", ":"), default=str)
        parts.append(f"{k}={_clip(v, 48)}")
    return _clip(" ".join(parts), limit)


def _feed(session: str, source: str) -> dict[str, Any]:
    f = _load()
    fid = feed_id(session)
    if fid not in f:
        f[fid] = {"id": fid, "session": session.strip()[:80], "source": source if source in SOURCES else "other", "title": "", "agent": "",
                  "url": "", "model": "", "costUsd": None, "startedAt": _now_ms(), "lastAt": _now_ms(), "items": []}
    return f[fid]


def _push(feed: dict[str, Any], line: dict[str, Any]) -> None:
    feed["items"] = (feed.get("items") or [])[-(MAX_LINES - 1):] + [line]
    feed["lastAt"] = line["at"]


def note(session: str, text: str, *, source: str = "claude-ai-text", agent: str = "", url: str = "", title: str = "", model: str = "",
         cost_usd: float | None = None) -> dict[str, Any]:
    """A Claude session posts what it's saying / doing as one short line into its own mirror feed (console_session_note)."""
    session, text = str(session or "").strip(), str(text or "").strip()
    if not SESSION_RE.match(session):
        raise ValueError("session is the chat's name (letters, digits, spaces . _ : @ -, at most 80)")
    if not text:
        raise ValueError("text is the line to show")
    if url and not re.match(r"^https://(claude\.ai|[A-Za-z0-9.-]+\.amberxai\.com)/", url):
        raise ValueError("url is the chat's https://claude.ai/… link")
    with _lock:
        fd = _feed(session, source)
        for k, v in (("agent", agent), ("url", url), ("title", title), ("model", model)):
            if v:
                fd[k] = _clip(v, 200 if k == "url" else 80)
        if isinstance(cost_usd, (int, float)) and cost_usd >= 0:
            fd["costUsd"] = round(float(cost_usd), 4)
        if source in SOURCES:
            fd["source"] = source
        line = {"at": _now_ms(), "kind": "note", "text": _clip(text, 400)}
        _push(fd, line)
        _save()
    _emit()
    return {"ok": True, "feed": fd["id"], "line": line}


def record_call(caller: str, tool: str, args: Any = None, ok: bool = True, error: str = "", ms: int | None = None) -> None:
    """One console MCP tool call that came in (through axHub or directly): the caller's session gets a line. The caller
    is the X-Axhub-Session the request carried, else the MCP client's name, else "axHub"."""
    if tool == "console_session_note":
        return  # the note itself is the line
    session = str(caller or "").strip() or "axHub"
    if not SESSION_RE.match(session):
        session = "axHub"
    with _lock:
        fd = _feed(session, "mcp")
        line = {"at": _now_ms(), "kind": "call", "tool": _clip(tool, 64), "text": summarise_args(args), "ok": bool(ok)}
        if error:
            line["error"] = _clip(error, 200)
        if ms is not None:
            line["ms"] = int(ms)
        _push(fd, line)
        _save()
    _emit()


def feed(fid: str, since: int = 0) -> dict[str, Any]:
    with _lock:
        f = _load().get(fid)
        if not f:
            raise KeyError("no such session feed")
        return {**f, "items": [x for x in f.get("items") or [] if x.get("at", 0) > since]}


def _chat_item(f: dict[str, Any], now: int) -> dict[str, Any]:
    last = (f.get("items") or [{}])[-1]
    ended = now - int(f.get("lastAt") or 0) > FEED_IDLE_S * 1000
    return {"id": f["id"], "kind": "chat", "name": f["id"], "title": f.get("title") or f["session"], "session": f["session"], "source": f.get("source", "other"),
            "agent": f.get("agent", ""), "model": f.get("model", ""), "costUsd": f.get("costUsd"), "url": f.get("url", ""),
            "startedAt": f.get("startedAt", 0), "lastAt": f.get("lastAt", 0), "endedAt": f.get("lastAt", 0) if ended else None,
            "lines": len(f.get("items") or []), "lastLine": (f"{last.get('tool')}: " if last.get("kind") == "call" else "") + str(last.get("text") or ""),
            "status": "ended" if ended else ("working" if now - int(f.get("lastAt") or 0) < 60_000 else "waiting")}


def _tmux_item(t: dict[str, Any], meter: dict[str, Any] | None = None) -> dict[str, Any]:
    head = t["name"].startswith("axf-")
    m = meter or {}
    return {"id": f"tmux:{t['where']}:{t['name']}", "kind": "headless" if head else "tmux", "name": t["name"], "where": t["where"],
            "title": m.get("agent") or t.get("agent") or t["name"], "agent": m.get("agent") or t.get("agent", ""), "model": m.get("model") or t.get("model", ""),
            "costUsd": m.get("costUsd"), "costEstimated": m.get("costEstimated"), "status": m.get("status") or ("attached" if t.get("attached") else "detached"),
            "startedAt": t.get("createdAt", 0), "attached": t.get("attached", 0), "cwd": t.get("cwd", ""), "tab": t.get("kind") == "tab",
            "attachCmd": sessions.attach_commands(t["name"], t["where"])}


def model(connections: Callable[[], dict[str, Any]] | None = None) -> dict[str, Any]:
    """Everything the rail shows, in one answer. One `tmux ls` on the VPS (cached 8 s, shared with the headless watch),
    one in the console, one meters read for the headless runs (cached 2 s)."""
    now = _now_ms()
    v = sessions.vps_tmux()
    local = sessions.console_tmux(mine=True)
    live_tmux = [*v.get("mine", []), *[x for x in v.get("items", []) if x["name"].startswith("axt-")], *local]
    headless = [x for x in v.get("items", []) if x["name"].startswith("axf-")]
    ms = sessions.meters([h["name"] for h in headless]).get("items", {}) if headless else {}
    mine = [_tmux_item(t) for t in live_tmux]
    agents = [_tmux_item(h, ms.get(h["name"])) for h in headless]
    with _lock:
        chats = [_chat_item(f, now) for f in _load().values()]
        live_ids = {x["id"] for x in mine + agents}
        if v.get("ready"):  # only judge "gone" on a good read (an ssh hiccup must not move everything to Recent)
            for sid, it in list(_seen.items()):
                if sid not in live_ids:
                    _recent.insert(0, {**it, "endedAt": now, "status": "ended"})
                    del _seen[sid]
            del _recent[MAX_RECENT:]
        for it in mine + agents:
            _seen[it["id"]] = it
        recent = [*_recent, *[c for c in chats if c["endedAt"]]]
    recent.sort(key=lambda x: x.get("endedAt") or 0, reverse=True)
    conns = []
    if connections:
        try:
            conns = [{"id": f"conn:{c['id']}", "kind": "connection", "name": c["id"], "title": c["label"], "detail": c.get("detail", ""), "icon": c.get("icon", "terminal"),
                      "via": c["via"], "container": c.get("container"), "ready": c.get("ready", False), "why": c.get("why", ""), "badge": c.get("badge")}
                     for c in connections().get("items", [])]
        except Exception:  # noqa: BLE001 — Docker or the VPS unreachable: the rest still shows
            conns = []
    return {"$axf": "terminal-nav@1", "now": now, "vps": {"ready": bool(v.get("ready")), "why": v.get("why", "")},
            "mine": [*mine, *[c for c in chats if not c["endedAt"]]], "agents": agents, "connections": conns, "recent": recent[:MAX_RECENT]}


def find(name: str, where: str = "") -> dict[str, Any] | None:
    """A live session by tmux name (and where) or feed id, from the last model."""
    for it in _seen.values():
        if it["name"] == name and (not where or it.get("where") == where):
            return it
    return None


class SessionFeed:
    """axf.session-feed@1 — what the console MCP server calls (console_session_note, each tool call)."""

    def note(self, session: str, text: str, **kw: Any) -> dict[str, Any]:
        return note(session, text, **kw)

    def record_call(self, caller: str, tool: str, args: Any = None, ok: bool = True, error: str = "", ms: int | None = None) -> None:
        record_call(caller, tool, args, ok, error, ms)

    def feeds(self) -> list[dict[str, Any]]:
        now = _now_ms()
        with _lock:
            return [_chat_item(f, now) for f in _load().values()]
