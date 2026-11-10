"""Collectors: turn what the rest of the console already records into activity events, without naming any plugin.

Each collector reads one source from where it got to last time (cursors.json) and returns raw event dicts; the caller
normalizes, links and stores them. Sources (all optional, each skipped when absent):

  builds      the builds store (builds@1): every build note is an orchestrator decision (queued, split, launched,
              rejected, handed off, step done …); one chain per build
  hub-runs    capability axf.hub-runs@1: shell runs that went through an approval on axHub (an approval + a run)
  feed        capability axf.activity@1: everything in progress anywhere (headless sessions, GitHub runs, VPS Auto fix
              jobs, reports) as start / finish events; one chain per item
  changes     capability axf.changes@1: fixes in the Automatic fixes / Codebase changes log (the fix notes)
  terminal    the console's own terminal (every API, MCP and plugin line it logs)
  services    any capability service with an ``activity_log(since_ms)`` method returning activity-event@1 dicts: the open
              way for any plugin or app to write here
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Callable

import plugin_services

SELF = "axf.activity-log@1"
FIRST_LOOK_MS = 2 * 86400_000  # the first read reaches back two days
STORE_REL = Path("_claude") / "builds" / "store.json"


def _h(*parts: Any) -> str:
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:12]


def _ms(v: Any) -> int:
    if isinstance(v, (int, float)):
        return int(v if v > 10_000_000_000 else v * 1000)
    if isinstance(v, str) and v:
        try:
            from datetime import datetime
            return int(datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            return 0
    return 0


def builds_store(root: Path) -> Path:
    env = os.environ.get("AXF_BUILDS_STORE")
    if env:
        return Path(env)
    d = os.environ.get("AXF_DATA_DIR")
    return Path(d) / STORE_REL if d and d != "off" else root / STORE_REL


# ------------------------------------------------------------------------------------------------ builds store

_NOTE_RULES: list[tuple[re.Pattern[str], dict[str, str]]] = [
    (re.compile(r"^queued by ([^.]+)", re.I), {"verb": "queued", "result": "queued", "who": "1"}),
    (re.compile(r"^split by", re.I), {"verb": "split", "actor": "The orchestrator"}),
    (re.compile(r"\blaunch", re.I), {"verb": "launched", "actor": "The orchestrator", "result": "launched"}),
    (re.compile(r"\b(reject|veto|refus)", re.I), {"verb": "rejected", "actor": "The orchestrator", "result": "rejected"}),
    (re.compile(r"\b(hand(ed)?[- ]?off|handed|hand over|sent to)\b", re.I), {"verb": "handed off", "actor": "The orchestrator"}),
    (re.compile(r"\b(fail|error|crash|stuck)", re.I), {"verb": "reported a problem with", "actor": "The orchestrator", "result": "failed"}),
    (re.compile(r"\bstep\b.*\bdone\b|\bdone\b", re.I), {"verb": "finished a step of", "actor": "The session", "result": "done"}),
    (re.compile(r"\bqueue", re.I), {"verb": "queued", "actor": "The orchestrator", "result": "queued"}),
]


def note_event(b: dict[str, Any], n: dict[str, Any]) -> dict[str, Any] | None:
    text = str(n.get("text") or "").strip()
    at = _ms(n.get("at"))
    if not text or not at:
        return None
    title = str(b.get("title") or b.get("id"))[:120]
    e: dict[str, Any] = {"id": f"build:{b['id']}:{_h(n.get('at'), text)}", "at": at, "app": "console", "source": "builds",
                         "kind": "orchestrator", "chain": f"build:{b['id']}", "object": f"build “{title}”", "reason": text[:300],
                         "ref": {"type": "build", "id": b["id"], "label": title, "action": f"nav:builds"},
                         "raw": {"build": b["id"], "note": n, "status": b.get("status")}}
    for rx, how in _NOTE_RULES:
        m = rx.search(text)
        if m:
            e["verb"] = how["verb"]
            e["actor"] = m.group(1).strip()[:60] if how.get("who") else how.get("actor", "The orchestrator")
            if how.get("result"):
                e["result"] = how["result"]
            if how["verb"] in ("queued",) and how.get("who"):
                e["target"] = "the orchestrator"
                e["verb"] = "sent"
                e["result"] = "queued"
            break
    else:
        e["sentence"] = f"Build “{title}”: {text}"
    if "rejected" == e.get("result"):
        e["severity"] = "warning"
    return e


def from_builds(root: Path, cur: dict[str, Any], now: int) -> list[dict[str, Any]]:
    f = builds_store(root)
    try:
        st = f.stat()
    except OSError:
        return []
    if cur.get("builds.mtime") == st.st_mtime_ns:
        return []
    since = int(cur.get("builds.at") or now - FIRST_LOOK_MS)
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    builds = data.get("builds") if isinstance(data, dict) else None
    builds = list(builds.values()) if isinstance(builds, dict) else builds or []
    out: list[dict[str, Any]] = []
    top = since
    for b in builds:
        if not isinstance(b, dict) or not b.get("id"):
            continue
        prev = None
        for n in b.get("notes") or []:
            if not isinstance(n, dict):
                continue
            e = note_event(b, n)
            if not e:
                continue
            if prev:
                e["parent"] = prev
            prev = e["id"]
            if e["at"] > since:
                out.append(e)
                top = max(top, e["at"])
    cur["builds.mtime"] = st.st_mtime_ns
    cur["builds.at"] = top
    return out


# ------------------------------------------------------------------------------------------------ axHub runs

def from_hub_runs(cur: dict[str, Any], now: int) -> list[dict[str, Any]]:
    svc = plugin_services.get("axf.hub-runs@1")
    if svc is None:
        return []
    since = int(cur.get("hub.at") or now - FIRST_LOOK_MS)
    out: list[dict[str, Any]] = []
    for r in svc.runs(since) or []:
        if not isinstance(r, dict) or not r.get("id"):
            continue
        at = _ms(r.get("at")) or now
        agent = str(r.get("agent") or "An agent")[:60]
        cmd = str(r.get("command") or r.get("tool") or "")
        short = cmd if len(cmd) <= 80 else cmd[:77] + "…"
        chain = f"hub:{r['id']}"
        ok = r.get("exit") in (0, None)
        approval = {"id": f"hub:{r['id']}:approved", "at": at - 1, "app": "axhub", "source": "axhub", "kind": "approval",
                    "actor": "Brett", "verb": "approved", "object": f"{agent}'s {r.get('tool') or 'command'}", "via": "axHub",
                    "result": "approved", "reason": str(r.get("reason") or "")[:200], "chain": chain,
                    "ref": {"type": "hub-confirmation", "id": str(r.get("confirmationId") or "")}}
        run = {"id": f"hub:{r['id']}", "at": at, "app": "axhub", "source": "axhub", "kind": "axhub", "actor": agent,
               "verb": "ran", "object": f"`{short}`", "target": "the VPS", "via": "axHub",
               "result": "done" if ok else "failed", "reason": "" if ok else f"exit {r.get('exit')}", "chain": chain,
               "parent": approval["id"], "ref": {"type": "hub-run", "id": r["id"], "label": short},
               "raw": {k: r.get(k) for k in ("tool", "command", "exit", "reason", "agent", "confirmationId")} | {"output": str(r.get("output") or "")[-4000:]}}
        if not r.get("confirmationId"):
            run.pop("parent")
            out.append(run)
        else:
            out += [approval, run]
        cur["hub.at"] = max(int(cur.get("hub.at") or 0), at)
    return out


# ------------------------------------------------------------------------------------------------ activity feed

_FEED_KIND = {"session": "session", "claude": "session", "headless": "session", "agent": "agent", "crew": "crew",
              "fix": "fix", "autofix": "fix", "github": "build", "build": "build", "deploy": "build", "push": "build",
              "merge": "build", "approval": "approval"}


def from_feed(cur: dict[str, Any], now: int) -> list[dict[str, Any]]:
    svc = plugin_services.get("axf.activity@1")
    if svc is None:
        return []
    try:
        items = svc.items() or []
    except Exception:  # noqa: BLE001 — a broken feed never stops the log
        return []
    seen: dict[str, str] = cur.setdefault("feed.states", {})
    out: list[dict[str, Any]] = []
    live: set[str] = set()
    for it in items:
        if not isinstance(it, dict) or not it.get("id"):
            continue
        iid, state = str(it["id"]), str(it.get("state") or "running")
        live.add(iid)
        if seen.get(iid) == state:
            continue
        old = seen.get(iid)
        seen[iid] = state
        kind = next((v for k, v in _FEED_KIND.items() if k in str(it.get("kind") or "").lower() or iid.lower().startswith(k)), "system")
        title = str(it.get("title") or iid)[:160]
        at = _ms(it.get("finishedAt")) if state in ("done", "failed", "cancelled") else _ms(it.get("updatedAt"))
        verb = {"running": "started", "waiting": "is waiting on", "held": "is holding", "done": "finished",
                "failed": "failed at", "cancelled": "cancelled"}.get(state, state)
        e = {"id": f"feed:{iid}:{state}:{_h(at)}", "at": at or now, "app": "console", "source": f"feed:{it.get('source') or ''}",
             "kind": kind, "sentence": f"{title}: {verb if state != 'running' or old is None else 'running again'}",
             "result": {"done": "done", "failed": "failed", "cancelled": "cancelled", "waiting": "waiting"}.get(state, ""),
             "reason": str(it.get("detail") or "")[:300] if state == "failed" else "", "chain": f"feed:{iid}",
             "ref": {"type": "activity", "id": iid, "label": title, "url": str(it.get("url") or "")},
             "raw": {k: it.get(k) for k in ("id", "source", "kind", "title", "state", "detail", "url", "steps") if it.get(k) is not None}}
        if old:
            e["parent"] = f"feed:{iid}:{old}"
        out.append(e)
    for gone in [k for k in seen if k not in live]:  # forget items that left the feed (keeps the cursor small)
        seen.pop(gone, None)
    return out


# ------------------------------------------------------------------------------------------------ fix notes

def from_changes(cur: dict[str, Any], now: int) -> list[dict[str, Any]]:
    svc = plugin_services.get("axf.changes@1")
    if svc is None:
        return []
    try:
        stamp = str(svc.stamp())
    except Exception:  # noqa: BLE001
        stamp = ""
    if stamp and cur.get("changes.stamp") == stamp:
        return []
    try:
        rows = svc.summaries() or []
    except Exception:  # noqa: BLE001
        return []
    since = int(cur.get("changes.at") or now - FIRST_LOOK_MS)
    seen: dict[str, str] = cur.setdefault("changes.states", {})
    out: list[dict[str, Any]] = []
    for r in rows[:300]:
        if not isinstance(r, dict) or not r.get("id"):
            continue
        kind = str(r.get("kind") or "").lower()
        if "fix" not in kind:
            continue
        at = _ms(r.get("updatedAt")) or _ms(r.get("createdAt"))
        state = str(r.get("state") or "")
        if at <= since and r["id"] not in seen or seen.get(r["id"]) == state:
            continue
        seen[r["id"]] = state
        title = str(r.get("title") or r["id"])[:160]
        res = {"done": "fixed", "closed": "fixed", "failed": "failed", "abandoned": "failed"}.get(state, "")
        out.append({"id": f"chg:{r['id']}:{state}", "at": at or now, "app": "console", "source": "changes", "kind": "fix",
                    "actor": str(r.get("by") or "Automatic fixes")[:60], "verb": "worked on" if not res else "fixed" if res == "fixed" else "tried to fix",
                    "object": title, "result": res, "reason": str(r.get("asked") or "")[:200] if res == "failed" else "",
                    "chain": f"chg:{r['id']}", "fixNote": {"id": r["id"], "label": title, "action": f"codebase-changes.open:{r['id']}"},
                    "ref": {"type": "change", "id": r["id"], "label": title, "action": f"codebase-changes.open:{r['id']}"}, "raw": r})
    cur["changes.stamp"] = stamp
    cur["changes.at"] = max([since] + [e["at"] for e in out])
    if len(seen) > 600:
        for k in list(seen)[:-400]:
            seen.pop(k, None)
    return out


# ------------------------------------------------------------------------------------------------ console terminal

def from_terminal(lines: Callable[[], list[dict[str, Any]]] | None, cur: dict[str, Any], now: int) -> list[dict[str, Any]]:
    if lines is None:
        return []
    since = int(cur.get("terminal.at") or now - 3600_000)
    out = []
    try:
        rows = lines() or []
    except Exception:  # noqa: BLE001
        return []
    for ln in rows:
        at = int(ln.get("at") or 0) if isinstance(ln, dict) else 0
        if at <= since:
            continue
        ch, lvl, text = str(ln.get("channel") or "console")[:40], str(ln.get("level") or "info"), str(ln.get("text") or "")[:500]
        if not text or ch == "activity-monitor":
            continue
        # MCP / control calls are commands someone ran; every other info line (plugins loading, housekeeping) is debug,
        # hidden until "debug" is switched on in What to show
        cmd = any(k in ch.lower() for k in ("mcp", "control", "command"))
        kind = "error" if lvl == "error" else "command" if cmd else "system"
        sev = {"error": "error", "warn": "warning", "warning": "warning"}.get(lvl, "info" if cmd else "debug")
        out.append({"id": f"term:{at}:{_h(ch, text)}", "at": at, "app": "console", "source": "terminal", "kind": kind,
                    "severity": sev,
                    "sentence": f"{ch}: {text}", "actor": "", "raw": ln})
        since = max(since, at)
    cur["terminal.at"] = since
    return out


# ------------------------------------------------------------------------------------------------ open service hook

def from_services(cur: dict[str, Any], now: int) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for s in plugin_services.available():
        if s["name"] == SELF or not s.get("enabled"):
            continue
        impl = plugin_services.get(s["name"])
        fn = getattr(impl, "activity_log", None)
        if not callable(fn):
            continue
        key = f"svc.{s['name']}"
        since = int(cur.get(key) or now - FIRST_LOOK_MS)
        try:
            rows = fn(since) or []
        except Exception:  # noqa: BLE001
            continue
        for r in rows[:500]:
            if isinstance(r, dict):
                out.append({**r, "source": r.get("source") or s["name"]})
                since = max(since, _ms(r.get("at")))
        cur[key] = since
    return out


def collect_all(root: Path, cur: dict[str, Any], terminal: Callable[[], list[dict[str, Any]]] | None = None) -> list[dict[str, Any]]:
    now = int(time.time() * 1000)
    out: list[dict[str, Any]] = []
    for name, fn in (("builds", lambda: from_builds(root, cur, now)), ("hub", lambda: from_hub_runs(cur, now)),
                     ("feed", lambda: from_feed(cur, now)), ("changes", lambda: from_changes(cur, now)),
                     ("terminal", lambda: from_terminal(terminal, cur, now)), ("services", lambda: from_services(cur, now))):
        try:
            out += fn()
        except Exception as exc:  # noqa: BLE001 — one broken source never stops the others
            cur[f"{name}.error"] = str(exc)[:200]
    return out
