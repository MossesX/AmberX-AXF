"""Live sessions: the pure part (claude-live@1). No FastAPI, no plugin services: everything here takes plain data, so
test.py drives it directly.

A *session* is one Claude conversation going on somewhere: a Claude Code terminal, a claude.ai chat or voice call, the
AmberX / Gizmo companion, a headless ``claude -p`` build or an agent-swarm job. Every source is turned into one row:

  {id, kind: human|headless, client, mode: voice|text, account, primary, device, app, title, doing, build, step, model,
   thinking, agent {id, name, title, avatar}, startedAt, lastAt, costUsd, status: live|idle|ended, voice {ok, why},
   recording, watchers [...], source}

Rules (Brett, Nov 4 2026): every session is listed, human and headless, with a badge. Watching the text works for
every session; voice only for a human one whose device runs AmberX. Only the owner watches (helpers see the list).
One agent never runs two live human sessions at once.
"""
from __future__ import annotations

import re
import time
from typing import Any, Iterable

TAG = "claude-live-session@1"
KINDS = ("human", "headless")
CLIENTS = ("code", "chat", "voice", "companion", "headless", "swarm")
HUMAN_CLIENTS = ("code", "chat", "voice", "companion")
LIVE_S = 120  # heard from within this = live
IDLE_S = 30 * 60  # then idle; past this the session counts as ended
WATCHER_TTL_S = 45  # a watcher that stops sending heartbeats is gone after this
ID = re.compile(r"^[A-Za-z0-9._:-]{1,120}$")
PRIMARY = "main"


def _s(v: Any, n: int = 300) -> str:
    return str(v or "")[:n]


def _num(v: Any) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # NaN is no number


def to_ms(v: Any) -> int:
    """Epoch ms from ms, seconds or an ISO string (0 when it is none of them)."""
    if isinstance(v, (int, float)) and v > 0:
        return int(v if v > 1e11 else v * 1000)
    if isinstance(v, str) and v:
        from datetime import datetime
        try:
            return int(datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            return 0
    return 0


def classify(raw: dict[str, Any]) -> str:
    """human | headless. Headless: a `claude -p` run (client headless/swarm, surface headless, tmux `axf-…`, an SDK
    entrypoint). Everything else has a person on it."""
    client = _s(raw.get("client"), 20).lower()
    if client in ("headless", "swarm"):
        return "headless"
    if _s(raw.get("surface"), 20).lower() == "headless":
        return "headless"
    if _s(raw.get("name"), 120).startswith("axf-"):
        return "headless"
    if _s(raw.get("entrypoint"), 40).lower().startswith("sdk"):
        return "headless"
    return "human"


def client_of(raw: dict[str, Any], kind: str) -> str:
    c = _s(raw.get("client"), 20).lower()
    if c in CLIENTS:
        return c
    src = _s(raw.get("source"), 40).lower()
    if "voice" in src:
        return "voice"
    if src.startswith("claude-ai") or src == "chat":
        return "chat"
    if kind == "headless":
        return "swarm" if raw.get("job") else "headless"
    return "code"


def _status(last_ms: int, ended: bool, now_ms: int) -> str:
    if ended:
        return "ended"
    age = (now_ms - last_ms) / 1000 if last_ms else 1e9
    return "live" if age <= LIVE_S else "idle" if age <= IDLE_S else "ended"


def agent_view(ref: Any, roster: list[dict[str, Any]]) -> dict[str, Any]:
    """{id, name, title, avatar, known} for an agent id or name, from the crew (initials when nobody matches)."""
    r = _s(ref, 80).strip()
    a = next((x for x in roster if r and r.lower() in (_s(x.get("id")).lower(), _s(x.get("name")).lower())), None)
    if a:
        return {"id": _s(a.get("id"), 80), "name": _s(a.get("name") or a.get("id"), 80), "title": _s(a.get("title") or a.get("role"), 80),
                "avatar": a.get("avatar"), "known": True}
    return {"id": r, "name": r or "Unassigned", "title": "", "avatar": None, "known": False}


def normalize(raw: dict[str, Any], roster: list[dict[str, Any]], now_ms: int) -> dict[str, Any]:
    """One source record (check-in, chat feed, tmux run) → a session row."""
    kind = classify(raw)
    client = client_of(raw, kind)
    mode = "voice" if client == "voice" or _s(raw.get("mode")) == "voice" else "text"
    account = _s(raw.get("account"), 60) or PRIMARY
    started = to_ms(raw.get("startedAt"))
    last = max(to_ms(raw.get("lastAt")), started)
    amberx = raw.get("amberx") is True
    voice = {"ok": False, "why": "Headless sessions have no voice."} if kind == "headless" else \
        {"ok": True, "why": ""} if amberx else {"ok": False, "why": "Voice needs AmberX on that phone."}
    return {
        "$axf": TAG, "id": _s(raw.get("id"), 120), "kind": kind, "client": client, "mode": mode,
        "account": account, "primary": account == PRIMARY, "device": _s(raw.get("device"), 80), "app": _s(raw.get("app"), 60) or APP.get(client, ""),
        "title": _s(raw.get("title"), 200), "doing": _s(raw.get("doing"), 300), "build": _s(raw.get("build"), 80), "step": _s(raw.get("step"), 120),
        "progress": _num(raw.get("progress")), "model": _s(raw.get("model"), 40), "thinking": _s(raw.get("thinking"), 20),
        "agent": agent_view(raw.get("agent"), roster), "startedAt": started, "lastAt": last,
        "costUsd": _num(raw.get("costUsd")), "status": _status(last, raw.get("ended") is True, now_ms),
        "voice": voice, "recording": kind == "human" and raw.get("recording") is not False, "watchers": [],
        "source": _s(raw.get("source"), 40), "url": _s(raw.get("url"), 300),
    }


APP = {"code": "Claude Code", "chat": "claude.ai", "voice": "claude.ai voice", "companion": "AmberX", "headless": "Headless build", "swarm": "Agent swarm"}


def merge(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per id: the newest record wins, blanks are filled from the others (a check-in + a chat feed of the same
    session say different things)."""
    by: dict[str, dict[str, Any]] = {}
    for r in rows:
        if not r.get("id"):
            continue
        old = by.get(r["id"])
        if not old:
            by[r["id"]] = r
            continue
        new, other = (r, old) if r["lastAt"] >= old["lastAt"] else (old, r)
        out = dict(new)
        for k, v in other.items():
            if out.get(k) in ("", None, 0) and v not in ("", None, 0):
                out[k] = v
        if not out["agent"].get("known") and other["agent"].get("known"):
            out["agent"] = other["agent"]
        out["startedAt"] = min(x for x in (new["startedAt"], other["startedAt"]) if x) if (new["startedAt"] or other["startedAt"]) else 0
        by[r["id"]] = out
    order = {"live": 0, "idle": 1, "ended": 2}
    return sorted(by.values(), key=lambda r: (order.get(r["status"], 3), 0 if r["kind"] == "human" else 1, -r["lastAt"]))


def filter_rows(rows: list[dict[str, Any]], kind: str = "", account: str = "", agent: str = "", ended: bool = False, q: str = "") -> list[dict[str, Any]]:
    q = q.strip().lower()
    out = []
    for r in rows:
        if kind in KINDS and r["kind"] != kind:
            continue
        if account and r["account"] != account:
            continue
        if agent and agent.lower() not in (r["agent"]["id"].lower(), r["agent"]["name"].lower()):
            continue
        if not ended and r["status"] == "ended":
            continue
        if q and q not in " ".join(str(r.get(k) or "") for k in ("title", "doing", "build", "device", "app", "account", "model")).lower() + " " + r["agent"]["name"].lower():
            continue
        out.append(r)
    return out


def counts(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Live (not ended) sessions by kind, and the widget's label: '2 human · 4 headless'."""
    on = [r for r in rows if r["status"] != "ended"]
    h = sum(1 for r in on if r["kind"] == "human")
    k = len(on) - h
    label = " · ".join(p for p in (f"{h} human" if h else "", f"{k} headless" if k else "") if p) or "No sessions"
    return {"human": h, "headless": k, "total": len(on), "label": label, "watched": sum(1 for r in on if r["watchers"])}


# ---------------------------------------------------------------- who may watch

def can_watch(viewer: dict[str, Any], row: dict[str, Any], voice: bool = False) -> tuple[bool, str]:
    """(allowed, why not). viewer = {owner: bool, name}. Owner-only; voice only on a human row with AmberX on its device."""
    if not viewer.get("owner"):
        return False, "Only Brett can watch a session (helpers see the list)."
    if voice:
        if row["kind"] != "human":
            return False, "Voice is only for human sessions."
        if not row["voice"]["ok"]:
            return False, row["voice"]["why"]
    return True, ""


def agent_clash(rows: list[dict[str, Any]], agent: str, session: str) -> dict[str, Any] | None:
    """The other live human session this agent already runs (one agent, one live human session), else None."""
    a = agent.lower()
    for r in rows:
        if r["id"] != session and r["kind"] == "human" and r["status"] != "ended" and a and a in (r["agent"]["id"].lower(), r["agent"]["name"].lower()):
            return {"session": r["id"], "title": r["title"], "agent": r["agent"]["name"]}
    return None


def free_agents(rows: list[dict[str, Any]], roster: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Crew agents not on a live human session (what to offer instead on a clash)."""
    busy = {r["agent"]["id"].lower() for r in rows if r["kind"] == "human" and r["status"] != "ended"}
    return [agent_view(a.get("id"), roster) for a in roster if _s(a.get("id")).lower() not in busy and a.get("status") not in ("fired", "quit")]


# ---------------------------------------------------------------- watchers

class Watchers:
    """Who watches what, in memory (a console restart ends every watch; the audit log keeps the history).
    `changes` collects the (session, 'start'|'stop', watcher) transitions the caller acts on (notice, chat line)."""

    def __init__(self, ttl: float = WATCHER_TTL_S) -> None:
        self.ttl = ttl
        self.by: dict[str, dict[str, dict[str, Any]]] = {}

    def start(self, session: str, wid: str, by: str, voice: bool, now: float | None = None) -> bool:
        now = time.time() if now is None else now
        first = not self.active(session, now)
        self.by.setdefault(session, {})[wid] = {"id": wid, "by": by, "voice": voice, "since": now, "seen": now}
        return first

    def beat(self, session: str, wid: str, now: float | None = None) -> bool:
        w = self.by.get(session, {}).get(wid)
        if w:
            w["seen"] = time.time() if now is None else now
        return bool(w)

    def stop(self, session: str, wid: str, now: float | None = None) -> bool:
        """True when this was the last watcher (the notice goes off)."""
        self.by.get(session, {}).pop(wid, None)
        return not self.active(session, now)

    def sweep(self, now: float | None = None) -> list[tuple[str, dict[str, Any]]]:
        """Drop watchers past their ttl; [(session, watcher)] for each session that lost its last one."""
        now = time.time() if now is None else now
        ended = []
        for sid, ws in list(self.by.items()):
            gone = [w for w in ws.values() if now - w["seen"] > self.ttl]
            for w in gone:
                ws.pop(w["id"], None)
            if gone and not ws:
                ended.append((sid, gone[-1]))
            if not ws:
                self.by.pop(sid, None)
        return ended

    def active(self, session: str, now: float | None = None) -> list[dict[str, Any]]:
        now = time.time() if now is None else now
        return [{"by": w["by"], "voice": w["voice"], "since": int(w["since"] * 1000)} for w in self.by.get(session, {}).values() if now - w["seen"] <= self.ttl]


def notice(row: dict[str, Any], watchers: list[dict[str, Any]]) -> dict[str, Any]:
    """What the watched side shows: 'You're being watched' (always while anyone watches a human session) and
    'Recording' (always while it records). Headless sessions show nothing; their watches are only logged."""
    if row["kind"] != "human":
        return {"watched": False, "recording": False, "text": "", "by": []}
    by = sorted({w["by"] for w in watchers})
    parts = []
    if watchers:
        parts.append(f"You're being watched by {', '.join(by)}" + (" (with voice)" if any(w["voice"] for w in watchers) else ""))
    if row.get("recording"):
        parts.append("Recording")
    return {"watched": bool(watchers), "recording": bool(row.get("recording")), "text": " · ".join(parts), "by": by}


def chat_line(row: dict[str, Any], who: str, started: bool) -> str:
    """The Breakroom Sessions line for a watch start / end on a human session."""
    name = row["agent"]["name"] if row["agent"].get("known") else (row["title"] or row["id"])
    where = " · ".join(x for x in (row["app"], row["device"]) if x)
    return f"👀 {who} is watching {name}'s session{f' ({where})' if where else ''}." if started else f"{who} stopped watching {name}'s session."
