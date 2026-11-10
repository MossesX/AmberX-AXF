"""Activity Monitor engine (activity-event@1): the event shape, plain-English sentences, chains, filters, tabs and rules.

Pure functions plus one file-backed store, so the routes, the capability service and the self-test share one code path.

An event (every field optional except what ``normalize`` fills in):

    id        stable id (a source's own id makes a re-read a no-op)
    at        epoch ms
    app       which app it came from: console, axhub, amberx, walkthrough-studio … (per-app tabs)
    source    who reported it: console-ui, plugin-command, axhub, orchestrator, builds, session, syscheck, rule, …
    kind      click | action | command | axhub | approval | veto | agent | crew | orchestrator | build | session
              | error | fix | rule | system
    severity  debug | info | success | warning | error
    actor     who did it ("Joey", "the orchestrator", "You")
    verb      what they did, past tense ("sent", "asked", "rejected", "ran")
    object    what it was about ("the login fix", "a file download")
    target    to whom ("the orchestrator", "Patches")
    via       the channel ("axHub")
    result    what came of it: done | failed | approved | rejected | vetoed | queued | fixed | waiting | …
    reason    why (a rejection reason, an error message)
    sentence  the plain-English line; written from the fields above when not given
    chain     the request this belongs to: every event with the same chain is one tree
    parent    the event this one followed (the tree's edges); the chain's first event has none
    ref       what it touched: {type, id, label, action (console action spec), url, retry (console action spec)}
    fixNote   the Automatic fixes / Codebase changes entry about the fix ({id, label})
    raw       the original record, shown folded under the sentence
"""
from __future__ import annotations

import json
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Iterable

KINDS = ("click", "action", "command", "axhub", "approval", "veto", "agent", "crew", "orchestrator", "build",
         "session", "error", "fix", "rule", "system")
SEVERITIES = ("debug", "info", "success", "warning", "error")
SEV_RANK = {s: i for i, s in enumerate(SEVERITIES)}
FIXED_TABS = ("all", "errors", "approvals", "agents", "builds", "axhub")
TAB_LABELS = {"all": "All", "errors": "Errors", "approvals": "Approvals", "agents": "Agents", "builds": "Builds", "axhub": "axHub"}
RESULT_OK = {"done", "ok", "success", "succeeded", "approved", "accepted", "fixed", "merged", "passed", "sent", "queued", "launched"}
RESULT_BAD = {"failed", "error", "rejected", "vetoed", "denied", "refused", "cancelled", "timeout"}
RULE_DO = ("notify", "fix", "route", "action", "note")
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9:._@/-]{0,159}$")
TEXT_MAX = 600
RAW_MAX = 16_000

DEFAULT_SETTINGS: dict[str, Any] = {
    # colour per kind: a theme colour token name (never a literal), applied as var(--fx-<name>)
    "colors": {"click": "muted", "action": "accent", "command": "accent", "axhub": "info", "approval": "warning",
               "veto": "danger", "agent": "accent", "crew": "accent", "orchestrator": "info", "build": "info",
               "session": "muted", "error": "danger", "fix": "success", "rule": "warning", "system": "muted"},
    "density": "comfortable",          # compact | comfortable | roomy
    "hide": ["debug"],                 # kinds or severities hidden by default
    "captureClicks": True,             # log every tap in the console
    "captureActions": True,            # log every console action (menus, shortcuts, toolbar)
    "captureErrors": True,             # log uncaught errors in the console page
    "collect": True,                   # read the builds store, axHub runs, activity feed, changes and any service log
    "appTabs": True,                   # one tab per app seen in the log
    "follow": True,                    # live follow: new events scroll in
    "pollMs": 2000,
    "keep": 20000,                     # events kept on disk
    "view": "tree",                    # tree (chains) | flat
}
COLOR_TOKENS = ("accent", "info", "success", "warning", "danger", "muted", "text", "focus")


def now_ms() -> int:
    return int(time.time() * 1000)


def _s(v: Any, n: int = TEXT_MAX) -> str:
    return str(v).strip()[:n] if v is not None else ""


# ------------------------------------------------------------------------------------------------ sentences

def sentence(e: dict[str, Any]) -> str:
    """The event in plain English: who did what, to whom, through what, and what came of it.

    'Joey sent the login fix to the orchestrator, which rejected it: no tests.'
    'Molly asked Patches through axHub to download a file. Done.'
    """
    actor, verb, obj, target, via = (_s(e.get(k), 160) for k in ("actor", "verb", "object", "target", "via"))
    result, reason = _s(e.get("result"), 40).lower(), _s(e.get("reason"), 300)
    if not (actor and verb):
        base = _s(e.get("sentence")) or _s(e.get("title")) or obj or (f"{actor} {verb}".strip() if actor or verb else "")
        if not base:
            return ""
        tail = _result_tail(result, reason, base) if result or reason else ""
        return _end(base + tail)
    through = f" through {via}" if via else ""
    if verb in ("asked", "told", "reached out to") and target:
        # 'Molly asked Patches through axHub to download a file.'
        out = f"{actor} {verb} {target}{through}" + (f" to {obj}" if obj else "")
    else:
        # 'Joey sent the login fix to the orchestrator.'  'The orchestrator rejected Joey's build.'
        out = f"{actor} {verb}" + (f" {obj}" if obj else "") + (f" to {target}" if target else "") + through
    if result or reason:
        out += _result_tail(result, reason, out, who=bool(target))
    return _end(out)


def _result_tail(result: str, reason: str, base: str, who: bool = False) -> str:
    why = f": {reason}" if reason else ""
    if result in ("rejected", "approved", "vetoed", "accepted", "denied", "refused", "queued", "fixed") and who:
        return f", which {result} it{why}"
    if result in RESULT_BAD:
        return f". It {'failed' if result in ('failed', 'error', 'timeout') else 'was ' + result}{why}"
    if result in RESULT_OK:
        return f". {result.capitalize() if result not in ('ok', 'success', 'succeeded') else 'Done'}{why}"
    if result:
        return f" ({result}){why}"
    return f": {reason}" if reason and reason not in base else ""


def _end(s: str) -> str:
    s = re.sub(r"\s+", " ", s).strip()
    first = s.split(" ", 1)[0] if s else ""
    if first and first.islower() and first not in ("axhub", "npm", "git", "pnpm", "node"):
        s = s[0].upper() + s[1:]
    return s if not s or s[-1] in ".!?" else s + "."


# ------------------------------------------------------------------------------------------------ normalize

def severity_of(e: dict[str, Any]) -> str:
    sev = _s(e.get("severity"), 12).lower()
    if sev in SEV_RANK:
        return sev
    if sev in ("warn",):
        return "warning"
    if sev in ("danger", "critical", "fatal"):
        return "error"
    kind, result = e.get("kind"), _s(e.get("result"), 40).lower()
    if kind == "error" or result in ("failed", "error", "timeout"):
        return "error"
    if kind == "veto" or result in ("rejected", "vetoed", "denied", "refused"):
        return "warning"
    if result in ("done", "fixed", "approved", "merged", "passed", "succeeded", "success"):
        return "success"
    if kind == "click":
        return "debug"
    return "info"


def normalize(e: dict[str, Any], *, source: str = "", at: int | None = None) -> dict[str, Any]:
    """A clean activity-event@1 record (ValueError when there's nothing to say)."""
    if not isinstance(e, dict):
        raise ValueError("an event is an object")
    out: dict[str, Any] = {}
    for k in ("app", "source", "kind", "actor", "verb", "object", "target", "via", "result", "reason", "chain", "parent", "title"):
        v = _s(e.get(k), 300 if k in ("reason", "object") else 120)
        if v:
            out[k] = v
    out["source"] = out.get("source") or source or "api"
    out["app"] = (out.get("app") or "console").lower()[:40]
    kind = (out.get("kind") or "").lower()
    out["kind"] = kind if kind in KINDS else "system"
    eid = _s(e.get("id"), 160)
    out["id"] = eid if eid and ID_RE.match(eid) else f"ev-{uuid.uuid4().hex[:16]}"
    try:
        out["at"] = int(e.get("at") or at or now_ms())
    except (TypeError, ValueError):
        out["at"] = at or now_ms()
    if out["at"] < 10_000_000_000:  # seconds → ms
        out["at"] *= 1000
    out["severity"] = severity_of({**e, **out})
    given = _s(e.get("sentence"))
    if given:
        out["sentence"] = _end(given)
    out["sentence"] = sentence({**out, "sentence": given})
    if not out["sentence"]:
        raise ValueError("an event needs a sentence or actor + verb")
    out["chain"] = out.get("chain") or out["id"]
    for k in ("ref", "fixNote"):
        v = e.get(k)
        if isinstance(v, dict):
            out[k] = {kk: _s(vv, 400) for kk, vv in v.items() if isinstance(vv, (str, int, float)) and kk in ("type", "id", "label", "action", "url", "retry", "app")}
    raw = e.get("raw")
    if raw is not None:
        try:
            txt = json.dumps(raw, ensure_ascii=False, default=str)
        except (TypeError, ValueError):
            txt = json.dumps(str(raw))
        out["raw"] = raw if len(txt) <= RAW_MAX else {"truncated": txt[:RAW_MAX]}
    return out


# ------------------------------------------------------------------------------------------------ tabs + filters

def tabs_of(e: dict[str, Any]) -> list[str]:
    kind, sev, src = e.get("kind"), e.get("severity"), e.get("source", "")
    out = ["all"]
    if sev == "error" or kind in ("error", "fix"):
        out.append("errors")
    if kind in ("approval", "veto"):
        out.append("approvals")
    if kind in ("agent", "crew", "session"):
        out.append("agents")
    if kind in ("orchestrator", "build"):
        out.append("builds")
    if kind in ("axhub", "approval", "veto") or src == "axhub" or e.get("via", "").lower() == "axhub" or e.get("app") == "axhub":
        out.append("axhub")
    out.append(f"app:{e.get('app') or 'console'}")
    return out


def _range_start(rng: str, now: int) -> int:
    m = re.fullmatch(r"(\d+)\s*([smhdw])", rng or "")
    if not m:
        return 0
    return now - int(m.group(1)) * {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}[m.group(2)] * 1000


def matches(e: dict[str, Any], f: dict[str, Any], now: int | None = None) -> bool:
    """Filter: tab, q (words, all must appear), kind / severity / app / source / actor (comma lists), min severity,
    since / until (ms), range (15m, 1h, 1d …), chain, hide (kinds or severities)."""
    tab = f.get("tab") or "all"
    if tab not in tabs_of(e):
        return False
    for k in ("kind", "severity", "app", "source", "actor"):
        want = f.get(k)
        if want:
            vals = {x.strip().lower() for x in (want if isinstance(want, list) else str(want).split(",")) if x.strip()}
            if vals and str(e.get(k, "")).lower() not in vals:
                return False
    mn = f.get("minSeverity")
    if mn in SEV_RANK and SEV_RANK.get(e.get("severity", "info"), 1) < SEV_RANK[mn]:
        return False
    hide = f.get("hide") or []
    if hide and (e.get("kind") in hide or e.get("severity") in hide) and tab != "errors":
        return False
    at = int(e.get("at") or 0)
    if f.get("since") and at <= int(f["since"]):
        return False
    if f.get("until") and at > int(f["until"]):
        return False
    start = _range_start(str(f.get("range") or ""), now or now_ms())
    if start and at < start:
        return False
    if f.get("chain") and e.get("chain") != f["chain"]:
        return False
    q = str(f.get("q") or "").strip().lower()
    if q:
        hay = " ".join(str(e.get(k, "")) for k in ("sentence", "actor", "target", "object", "reason", "kind", "app", "source", "id", "chain")).lower()
        if not all(w in hay for w in q.split()):
            return False
    return True


def chains(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Group events into request chains: [{chain, root, events (oldest first, each with depth), at, last, severity,
    count}], newest chain first. Depth follows ``parent``; an unknown parent hangs off the chain's first event."""
    by: dict[str, list[dict[str, Any]]] = {}
    for e in events:
        by.setdefault(e.get("chain") or e["id"], []).append(e)
    out = []
    for cid, evs in by.items():
        evs = sorted(evs, key=lambda x: x.get("at", 0))
        ids = {e["id"]: e for e in evs}
        depth: dict[str, int] = {}

        def d(e: dict[str, Any], seen: frozenset[str] = frozenset()) -> int:
            if e["id"] in depth:
                return depth[e["id"]]
            p = e.get("parent")
            v = 0 if not p or p not in ids or p in seen or p == e["id"] else d(ids[p], seen | {e["id"]}) + 1
            if p and p not in ids and e is not evs[0]:
                v = 1
            depth[e["id"]] = min(v, 8)
            return depth[e["id"]]

        rows = [{**e, "depth": d(e) if e is not evs[0] else 0} for e in evs]
        worst = max(rows, key=lambda x: SEV_RANK.get(x.get("severity", "info"), 1))
        out.append({"chain": cid, "root": rows[0], "events": rows, "at": rows[0].get("at", 0), "last": rows[-1].get("at", 0),
                    "severity": worst.get("severity", "info"), "count": len(rows)})
    return sorted(out, key=lambda c: c["last"], reverse=True)


# ------------------------------------------------------------------------------------------------ rules

def rule_normalize(r: dict[str, Any]) -> dict[str, Any]:
    """A rule: when an event matches ``on`` (kind / severity / app / source / actor / text), do ``do``.
    do.type: notify (an alert in the console + phone through the alert hub) | fix (the event's retry, or a systems check
    fix by id) | route (file a build for an agent through the orchestrator) | action (a console action, run in the open
    console) | note (only log that it matched)."""
    if not isinstance(r, dict):
        raise ValueError("a rule is an object")
    on = r.get("on") if isinstance(r.get("on"), dict) else {}
    on = {k: _s(on.get(k), 200) for k in ("kind", "severity", "minSeverity", "app", "source", "actor", "text") if _s(on.get(k), 200)}
    if not on:
        raise ValueError("a rule needs at least one condition in 'on' (kind, severity, app, source, actor or text)")
    do = r.get("do") if isinstance(r.get("do"), dict) else {}
    typ = _s(do.get("type"), 20) or "note"
    if typ not in RULE_DO:
        raise ValueError(f"do.type must be one of {', '.join(RULE_DO)}")
    do = {"type": typ, **{k: _s(do.get(k), 400) for k in ("target", "message", "action", "agent", "check") if _s(do.get(k), 400)}}
    if typ == "action" and not do.get("action"):
        raise ValueError("an action rule needs do.action (a console action spec, e.g. nav:builds)")
    if typ == "route" and not (do.get("agent") or do.get("target")):
        raise ValueError("a route rule needs do.agent (who gets it)")
    rid = _s(r.get("id"), 60)
    name = _s(r.get("name"), 120) or f"When {describe_on(on)}, {describe_do(do)}"
    cool = r.get("cooldownS", 600)
    try:
        cool = max(0, min(int(cool), 7 * 86400))
    except (TypeError, ValueError):
        cool = 600
    return {"id": rid if rid and ID_RE.match(rid) else f"rule-{uuid.uuid4().hex[:10]}", "name": name, "on": on, "do": do,
            "enabled": r.get("enabled") is not False, "cooldownS": cool, "from": _s(r.get("from"), 160),
            "createdAt": int(r.get("createdAt") or now_ms()), "hits": int(r.get("hits") or 0), "lastHit": int(r.get("lastHit") or 0)}


def describe_on(on: dict[str, Any]) -> str:
    parts = []
    if on.get("severity"):
        parts.append(f"a {on['severity']}")
    if on.get("kind"):
        parts.append(f"{on['kind']} event" if not parts else f"in {on['kind']}")
    if on.get("app"):
        parts.append(f"from {on['app']}")
    if on.get("actor"):
        parts.append(f"by {on['actor']}")
    if on.get("text"):
        parts.append(f'saying "{on["text"]}"')
    return " ".join(parts) or "anything happens"


def describe_do(do: dict[str, Any]) -> str:
    t = do.get("type")
    return {"notify": "notify me", "fix": "run the fix" + (f" {do['check']}" if do.get("check") else ""),
            "route": f"send it to {do.get('agent') or do.get('target')}", "action": f"run {do.get('action')}",
            "note": "note it"}.get(t, "note it")


def rule_matches(rule: dict[str, Any], e: dict[str, Any]) -> bool:
    if not rule.get("enabled") or e.get("kind") == "rule":
        return False
    on = rule.get("on") or {}
    for k in ("kind", "severity", "app", "source"):
        if on.get(k) and str(e.get(k, "")).lower() not in {x.strip().lower() for x in on[k].split(",")}:
            return False
    if on.get("minSeverity") in SEV_RANK and SEV_RANK.get(e.get("severity", "info"), 1) < SEV_RANK[on["minSeverity"]]:
        return False
    if on.get("actor") and on["actor"].lower() not in str(e.get("actor", "")).lower():
        return False
    if on.get("text"):
        hay = " ".join(str(e.get(k, "")) for k in ("sentence", "reason", "object")).lower()
        if on["text"].lower() not in hay:
            return False
    return True


def rule_from_event(e: dict[str, Any], do: dict[str, Any] | None = None) -> dict[str, Any]:
    """The 'Make a rule' starting point: same kind, app and severity, keyed on the most telling words."""
    on: dict[str, Any] = {"kind": e.get("kind", ""), "app": e.get("app", "")}
    if e.get("severity") in ("warning", "error"):
        on["severity"] = e["severity"]
    words = _s(e.get("reason") or e.get("object") or "", 80)
    if words:
        on["text"] = words
    return rule_normalize({"on": on, "do": do or {"type": "notify"}, "from": e.get("id", "")})


# ------------------------------------------------------------------------------------------------ store

class Store:
    """events.jsonl (append, trimmed to `keep`), rules.json, settings.json, cursors.json, all in the data folder."""

    def __init__(self, data: Path) -> None:
        self.data = data
        self.lock = threading.RLock()
        self._cache: list[dict[str, Any]] | None = None
        self._ids: set[str] = set()
        self.rev = 0

    # files
    def _f(self, name: str) -> Path:
        return self.data / name

    def _read_json(self, name: str, default: Any) -> Any:
        try:
            return json.loads(self._f(name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return default

    def _write_json(self, name: str, value: Any) -> None:
        self.data.mkdir(parents=True, exist_ok=True)
        tmp = self._f(name + ".tmp")
        tmp.write_text(json.dumps(value, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.chmod(0o600)
        tmp.replace(self._f(name))

    # events
    def events(self) -> list[dict[str, Any]]:
        with self.lock:
            if self._cache is None:
                out: list[dict[str, Any]] = []
                try:
                    with self._f("events.jsonl").open(encoding="utf-8") as fh:
                        for line in fh:
                            try:
                                e = json.loads(line)
                            except ValueError:
                                continue
                            if isinstance(e, dict) and e.get("id"):
                                out.append(e)
                except OSError:
                    pass
                self._cache = out
                self._ids = {e["id"] for e in out}
            return self._cache

    def has(self, eid: str) -> bool:
        self.events()
        return eid in self._ids

    def add(self, evs: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
        """Append new events (ids already present are skipped). Returns the ones added."""
        with self.lock:
            cur = self.events()
            new = [e for e in evs if e["id"] not in self._ids]
            if not new:
                return []
            self.data.mkdir(parents=True, exist_ok=True)
            f = self._f("events.jsonl")
            with f.open("a", encoding="utf-8") as fh:
                for e in new:
                    fh.write(json.dumps(e, ensure_ascii=False, default=str) + "\n")
                    self._ids.add(e["id"])
            try:
                f.chmod(0o600)
            except OSError:
                pass
            cur.extend(new)
            cur.sort(key=lambda x: x.get("at", 0))
            keep = int(self.settings().get("keep") or DEFAULT_SETTINGS["keep"])
            if len(cur) > keep * 1.2:
                self._rewrite(cur[-keep:])
            self.rev += 1
            return new

    def _rewrite(self, evs: list[dict[str, Any]]) -> None:
        tmp = self._f("events.jsonl.tmp")
        tmp.write_text("".join(json.dumps(e, ensure_ascii=False, default=str) + "\n" for e in evs), encoding="utf-8")
        tmp.chmod(0o600)
        tmp.replace(self._f("events.jsonl"))
        self._cache = list(evs)
        self._ids = {e["id"] for e in evs}

    def clear(self) -> int:
        with self.lock:
            n = len(self.events())
            self._rewrite([])
            self.rev += 1
            return n

    def get(self, eid: str) -> dict[str, Any] | None:
        return next((e for e in reversed(self.events()) if e.get("id") == eid), None)

    def query(self, f: dict[str, Any], limit: int = 500) -> tuple[list[dict[str, Any]], int]:
        now = now_ms()
        hits = [e for e in self.events() if matches(e, f, now)]
        return hits[-max(1, min(int(limit or 500), 5000)):], len(hits)

    # settings
    def settings(self) -> dict[str, Any]:
        s = self._read_json("settings.json", {})
        out = {**DEFAULT_SETTINGS, **{k: v for k, v in (s if isinstance(s, dict) else {}).items() if k in DEFAULT_SETTINGS}}
        out["colors"] = {**DEFAULT_SETTINGS["colors"], **{k: v for k, v in (out.get("colors") or {}).items() if k in KINDS and v in COLOR_TOKENS}}
        return out

    def save_settings(self, patch: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(patch, dict):
            raise ValueError("settings are an object")
        cur = self.settings()
        for k, v in patch.items():
            if k not in DEFAULT_SETTINGS:
                raise ValueError(f"unknown setting: {k}")
            if k == "colors":
                if not isinstance(v, dict) or any(kk not in KINDS or vv not in COLOR_TOKENS for kk, vv in v.items()):
                    raise ValueError(f"colors: kind → one of {', '.join(COLOR_TOKENS)}")
                cur["colors"] = {**cur["colors"], **v}
            elif k == "density":
                if v not in ("compact", "comfortable", "roomy"):
                    raise ValueError("density: compact | comfortable | roomy")
                cur[k] = v
            elif k == "view":
                if v not in ("tree", "flat"):
                    raise ValueError("view: tree | flat")
                cur[k] = v
            elif k == "hide":
                if not isinstance(v, list) or any(x not in KINDS and x not in SEV_RANK for x in v):
                    raise ValueError("hide: a list of kinds or severities")
                cur[k] = v
            elif k in ("pollMs", "keep"):
                lo, hi = (500, 60000) if k == "pollMs" else (500, 200000)
                cur[k] = max(lo, min(int(v), hi))
            else:
                cur[k] = bool(v)
        with self.lock:
            self._write_json("settings.json", cur)
        return cur

    # rules
    def rules(self) -> list[dict[str, Any]]:
        r = self._read_json("rules.json", [])
        return [x for x in r if isinstance(x, dict) and x.get("id")] if isinstance(r, list) else []

    def save_rule(self, r: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            rules = self.rules()
            old = next((x for x in rules if x["id"] == r.get("id")), None)
            rule = rule_normalize({**(old or {}), **r, "on": r.get("on") or (old or {}).get("on"), "do": r.get("do") or (old or {}).get("do")})
            rules = [x for x in rules if x["id"] != rule["id"]] + [rule]
            self._write_json("rules.json", rules)
            return rule

    def delete_rule(self, rid: str) -> bool:
        with self.lock:
            rules = self.rules()
            left = [x for x in rules if x["id"] != rid]
            self._write_json("rules.json", left)
            return len(left) != len(rules)

    def hit_rule(self, rid: str, at: int) -> None:
        with self.lock:
            rules = self.rules()
            for x in rules:
                if x["id"] == rid:
                    x["hits"] = int(x.get("hits") or 0) + 1
                    x["lastHit"] = at
            self._write_json("rules.json", rules)

    # cursors (where each collector got to)
    def cursors(self) -> dict[str, Any]:
        c = self._read_json("cursors.json", {})
        return c if isinstance(c, dict) else {}

    def save_cursors(self, c: dict[str, Any]) -> None:
        with self.lock:
            self._write_json("cursors.json", c)


def stats(events: list[dict[str, Any]], now: int | None = None) -> dict[str, Any]:
    now = now or now_ms()
    day = now - 86400_000
    tabs: dict[str, int] = {}
    apps: set[str] = set()
    last_err = None
    errors = 0
    for e in events:
        apps.add(e.get("app") or "console")
        if e.get("at", 0) >= day:
            for t in tabs_of(e):
                tabs[t] = tabs.get(t, 0) + 1
        if e.get("severity") == "error":
            last_err = e
            if e.get("at", 0) >= day:
                errors += 1
    last = events[-1] if events else None
    return {"total": len(events), "today": tabs.get("all", 0), "errors": errors, "tabs": tabs, "apps": sorted(apps),
            "lastError": {k: last_err.get(k) for k in ("id", "at", "sentence", "app", "chain")} if last_err else None,
            "last": {k: last.get(k) for k in ("id", "at", "sentence", "kind", "severity")} if last else None}


def tab_list(st: dict[str, Any], app_tabs: bool = True) -> list[dict[str, Any]]:
    out = [{"id": t, "label": TAB_LABELS[t], "count": st["tabs"].get(t, 0)} for t in FIXED_TABS]
    if app_tabs:
        out += [{"id": f"app:{a}", "label": a, "count": st["tabs"].get(f"app:{a}", 0)} for a in st["apps"]]
    return out


def export(events: list[dict[str, Any]], fmt: str) -> tuple[str, str]:
    """(body, media type) for jsonl | csv | md | txt."""
    if fmt == "jsonl":
        return "".join(json.dumps(e, ensure_ascii=False, default=str) + "\n" for e in events), "application/x-ndjson"
    stamp = lambda e: time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(int(e.get("at", 0)) / 1000))  # noqa: E731
    if fmt == "csv":
        import csv
        import io
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["at (UTC)", "app", "kind", "severity", "actor", "target", "result", "sentence", "chain", "id"])
        for e in events:
            w.writerow([stamp(e), e.get("app", ""), e.get("kind", ""), e.get("severity", ""), e.get("actor", ""), e.get("target", ""),
                        e.get("result", ""), e.get("sentence", ""), e.get("chain", ""), e.get("id", "")])
        return buf.getvalue(), "text/csv"
    if fmt == "md":
        lines = ["# Activity log", "", "| When (UTC) | App | Kind | What happened |", "|---|---|---|---|"]
        lines += [f"| {stamp(e)} | {e.get('app', '')} | {e.get('kind', '')}/{e.get('severity', '')} | {str(e.get('sentence', '')).replace('|', '/')} |" for e in events]
        return "\n".join(lines) + "\n", "text/markdown"
    return "".join(f"{stamp(e)}  [{e.get('severity', '')}] {e.get('app', '')}/{e.get('kind', '')}  {e.get('sentence', '')}\n" for e in events), "text/plain"
