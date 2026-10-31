"""Run store for the session browser (pure Python, no FastAPI, so the self-test runs anywhere).

Three kinds of file are read, merged by Claude Code session id into one *run* each:

  transcripts  Claude Code's own session files, ``~/.claude/projects/<slug>/<session id>.jsonl``: every regular
               session and every headless ``claude -p`` run on this machine (prompts, replies, tool calls, usage).
  streams      ``--output-format stream-json`` logs written by deploy/claude-headless.sh (``<log>.jsonl``) and the
               agent-swarm runner: the same events plus the final ``result`` (exact total cost, turns, duration).
  reports      agent-run@1 JSON reports from the agent-swarm runner (agent, build, job, model, budget, status, pid,
               what changed); see the plugin README for the shape.

Files are parsed incrementally (only appended lines are read again), so polling the store every few seconds is cheap.
Whole event lists (for the Context / Tools / Conversation tabs) are parsed on demand and kept in a small LRU.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Iterable

PLUGIN = Path(__file__).resolve().parents[1]
ROOT = PLUGIN.parents[3]
PRICING_FILE = ROOT / "framework" / "schemas" / "model-pricing.json"  # model-pricing@1, shared with the changes hooks
# Models model-pricing@1 doesn't list yet (USD per million tokens). Used only when the shared file has no entry.
FALLBACK_PRICES = {"haiku": {"input": 1, "output": 5, "cacheRead": 0.1, "cacheWrite": 1.25}}
RUNNING_WINDOW = 120.0   # seconds: a run without a result that wrote within this window counts as running
TEXT_MAX = 20000         # characters kept per event text (the rest is cut with a marker)
RUN_ID = re.compile(r"^[\w.-]{1,100}$")
_SECRET = re.compile(r"(ghp_|gho_|ghs_|github_pat_|sk-ant-|xox[bp]-)[A-Za-z0-9_\-]{6,}|Bearer\s+[A-Za-z0-9._\-]{12,}")

STATUSES = ("running", "done", "failed", "killed-budget", "killed", "stopped", "ended")


# ------------------------------------------------------------------ helpers

def redact(s: Any, limit: int = TEXT_MAX) -> str:
    t = s if isinstance(s, str) else ("" if s is None else json.dumps(s, ensure_ascii=False)[: limit + 1])
    t = _SECRET.sub("[removed]", t)
    return t if len(t) <= limit else f"{t[:limit]}\n… [{len(t) - limit} more characters]"


def _clip_input(v: Any, depth: int = 0) -> Any:
    """Tool input for display: strings cut, secrets removed, nesting bounded."""
    if depth > 4:
        return None
    if isinstance(v, dict):
        return {str(k)[:80]: _clip_input(x, depth + 1) for k, x in list(v.items())[:40]}
    if isinstance(v, list):
        return [_clip_input(x, depth + 1) for x in v[:60]]
    if isinstance(v, str):
        return redact(v, 8000)
    return v if isinstance(v, (int, float, bool)) or v is None else str(v)[:200]


def parse_ts(v: Any) -> float | None:
    if isinstance(v, (int, float)):
        return float(v) / (1000.0 if v > 1e12 else 1.0)
    if not isinstance(v, str) or not v:
        return None
    try:
        from datetime import datetime
        return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def iso(t: float | None) -> str | None:
    if t is None:
        return None
    from datetime import datetime, timezone
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


# ------------------------------------------------------------------ prices

_prices: tuple[float, dict[str, dict[str, float]]] | None = None


def prices() -> dict[str, dict[str, float]]:
    global _prices
    try:
        m = PRICING_FILE.stat().st_mtime
    except OSError:
        m = -1.0
    if _prices is None or _prices[0] != m:
        table = dict(FALLBACK_PRICES)
        try:
            table.update(json.loads(PRICING_FILE.read_text("utf-8")).get("models") or {})
        except (OSError, ValueError):
            pass
        _prices = (m, table)
    return _prices[1]


def model_key(model: Any) -> str:
    """claude-opus-5-5 → opus; '' when it isn't a priced model family."""
    s = str(model or "").lower()
    for k in ("fable", "opus", "sonnet", "haiku"):
        if k in s:
            return k
    return ""


def usage_tokens(u: Any) -> dict[str, int]:
    u = u if isinstance(u, dict) else {}
    cc = u.get("cache_creation") if isinstance(u.get("cache_creation"), dict) else {}
    one_h = int(cc.get("ephemeral_1h_input_tokens") or 0)
    write = int(u.get("cache_creation_input_tokens") or 0)
    return {
        "input": int(u.get("input_tokens") or 0), "output": int(u.get("output_tokens") or 0),
        "cacheRead": int(u.get("cache_read_input_tokens") or 0), "cacheWrite": max(0, write - one_h), "cacheWrite1h": one_h,
    }


def tokens_total(t: dict[str, int]) -> int:
    return sum(int(t.get(k) or 0) for k in ("input", "output", "cacheRead", "cacheWrite", "cacheWrite1h"))


def cost(tokens: dict[str, int], model: Any) -> float | None:
    """USD for one turn's tokens on a model (1 h cache writes at 2× input, as Anthropic bills them); None = unpriced."""
    p = prices().get(model_key(model))
    if not p:
        return None
    m = 1_000_000.0
    return (tokens.get("input", 0) * p.get("input", 0) + tokens.get("output", 0) * p.get("output", 0)
            + tokens.get("cacheRead", 0) * p.get("cacheRead", 0) + tokens.get("cacheWrite", 0) * p.get("cacheWrite", 0)
            + tokens.get("cacheWrite1h", 0) * 2 * p.get("input", 0)) / m


def add_tokens(a: dict[str, int], b: dict[str, int]) -> None:
    for k, v in b.items():
        a[k] = a.get(k, 0) + int(v or 0)


# ------------------------------------------------------------------ events

def _blocks(content: Any) -> list[dict[str, Any]]:
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    return [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []


def _result_text(content: Any) -> str:
    if isinstance(content, list):
        return "\n".join(str(c.get("text", "")) if isinstance(c, dict) else str(c) for c in content)
    return "" if content is None else str(content)


def line_events(obj: Any) -> list[dict[str, Any]]:
    """One JSON line (transcript or stream-json) → display events. Pure; unknown lines give []."""
    if not isinstance(obj, dict):
        return []
    t = obj.get("type")
    at = obj.get("timestamp")
    base = {"at": at if isinstance(at, str) else None, "sidechain": bool(obj.get("isSidechain") or obj.get("parent_tool_use_id"))}
    if t == "system" and obj.get("subtype") == "init":
        return [{**base, "role": "system", "kind": "init", "model": obj.get("model"), "cwd": obj.get("cwd"),
                 "sessionId": obj.get("session_id"), "text": f"model {obj.get('model') or '?'} · {obj.get('cwd') or ''} · {len(obj.get('tools') or [])} tools"}]
    if t == "result":
        return [{**base, "role": "system", "kind": "result", "subtype": obj.get("subtype"), "isError": bool(obj.get("is_error")),
                 "text": redact(obj.get("result") or ""), "totalCostUsd": obj.get("total_cost_usd"), "durationMs": obj.get("duration_ms"),
                 "numTurns": obj.get("num_turns"), "usage": usage_tokens(obj.get("usage")), "sessionId": obj.get("session_id")}]
    if t == "attachment":
        rendered = obj.get("rendered")
        text = "\n".join(str(r.get("content", "")) for r in rendered if isinstance(r, dict)) if isinstance(rendered, list) else ""
        att = obj.get("attachment") if isinstance(obj.get("attachment"), dict) else {}
        return [{**base, "role": "user", "kind": "context", "label": str(att.get("type") or "attachment"), "text": redact(text)}] if text.strip() else []
    if t == "summary":
        return [{**base, "role": "system", "kind": "context", "label": "summary", "text": redact(obj.get("summary") or "")}]
    msg = obj.get("message") if isinstance(obj.get("message"), dict) else None
    if t not in ("user", "assistant") or not msg:
        return []
    out: list[dict[str, Any]] = []
    if t == "assistant":
        mid = msg.get("id") or obj.get("uuid")
        common = {**base, "role": "assistant", "msgId": mid, "model": msg.get("model"), "usage": usage_tokens(msg.get("usage")) if msg.get("usage") else None,
                  "sessionId": obj.get("sessionId") or obj.get("session_id")}
        for b in _blocks(msg.get("content")):
            bt = b.get("type")
            if bt == "text" and str(b.get("text", "")).strip():
                out.append({**common, "kind": "text", "text": redact(b.get("text"))})
            elif bt == "thinking" and str(b.get("thinking", "")).strip():
                out.append({**common, "kind": "thinking", "text": redact(b.get("thinking"))})
            elif bt == "tool_use":
                out.append({**common, "kind": "tool_use", "tool": str(b.get("name") or "?"), "toolId": b.get("id"), "input": _clip_input(b.get("input") or {})})
        if not out and common["usage"]:  # a turn that only carried usage (e.g. redacted thinking): keep its cost
            out.append({**common, "kind": "text", "text": ""})
        return out
    meta = bool(obj.get("isMeta"))
    for b in _blocks(msg.get("content")):
        bt = b.get("type")
        if bt == "tool_result":
            out.append({**base, "role": "user", "kind": "tool_result", "toolId": b.get("tool_use_id"), "isError": bool(b.get("is_error")), "text": redact(_result_text(b.get("content")))})
        elif bt == "text":
            text = str(b.get("text") or "")
            if not text.strip():
                continue
            kind = "context" if meta or text.lstrip().startswith(("<command-", "<local-command", "<system-reminder")) else "prompt"
            out.append({**base, "role": "user", "kind": kind, "label": "meta" if kind == "context" else None, "text": redact(text)})
    return out


def number_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Give every event its index ``n`` and its turn (one turn = one model response; inputs belong to the next turn).
    Usage / cost is put on the first event of each turn only (transcripts repeat it on every block of a message)."""
    turn = -1
    seen: dict[Any, int] = {}
    for n, e in enumerate(events):
        e["n"] = n
        if e.get("role") == "assistant":
            mid = e.get("msgId")
            if mid not in seen:
                turn += 1
                seen[mid] = turn
                if e.get("usage"):
                    e["usd"] = cost(e["usage"], e.get("model"))
            else:
                e["usage"] = None
            e["turn"] = seen[mid]
        else:
            e["turn"] = turn + 1  # flows into the next turn's context
    return events


# ------------------------------------------------------------------ incremental summary per file

class Acc:
    """Aggregates of one file, fed line by line from a byte offset (so a growing file is only read once)."""

    def __init__(self, path: Path, fmt: str) -> None:
        self.path, self.fmt = path, fmt
        self.offset = 0
        self.mtime = 0.0
        self.session_id: str | None = None
        self.first_at: float | None = None
        self.last_at: float | None = None
        self.title = ""
        self.cwd = ""
        self.branch = ""
        self.entrypoint = ""
        self.version = ""
        self.init_model = ""
        self.msg_ids: set[Any] = set()
        self.turns = 0
        self.tools = 0
        self.prompts = 0
        self.models: dict[str, dict[str, Any]] = {}
        self.result: dict[str, Any] | None = None
        self.edits: set[str] = set()

    def feed(self, obj: dict[str, Any]) -> None:
        sid = obj.get("sessionId") or obj.get("session_id")
        if sid and not self.session_id:
            self.session_id = str(sid)
        for k, attr in (("cwd", "cwd"), ("gitBranch", "branch"), ("entrypoint", "entrypoint"), ("version", "version")):
            if isinstance(obj.get(k), str) and obj[k] and not getattr(self, attr):
                setattr(self, attr, obj[k])
        ts = parse_ts(obj.get("timestamp"))
        if ts is not None:
            self.first_at = ts if self.first_at is None else min(self.first_at, ts)
            self.last_at = ts if self.last_at is None else max(self.last_at, ts)
        for e in line_events(obj):
            k = e["kind"]
            if k == "init":
                self.init_model = str(e.get("model") or "")
                self.cwd = self.cwd or str(e.get("cwd") or "")
            elif k == "result":
                self.result = e
            elif k == "prompt" and not e.get("sidechain"):
                self.prompts += 1
                if not self.title:
                    self.title = " ".join(e["text"].split())[:200]
            elif e["role"] == "assistant":
                if k == "tool_use":
                    self.tools += 1
                    fp = (e.get("input") or {}).get("file_path") if isinstance(e.get("input"), dict) else None
                    if e["tool"] in ("Edit", "Write", "MultiEdit", "NotebookEdit") and isinstance(fp, str):
                        self.edits.add(fp[:400])
                mid = e.get("msgId")
                if mid in self.msg_ids:
                    continue
                self.msg_ids.add(mid)
                self.turns += 1
                if e.get("usage"):
                    key = model_key(e.get("model")) or str(e.get("model") or "unknown")
                    m = self.models.setdefault(key, {"model": e.get("model"), "turns": 0, "tokens": {}, "usd": 0.0, "priced": True})
                    m["turns"] += 1
                    add_tokens(m["tokens"], e["usage"])
                    c = cost(e["usage"], e.get("model"))
                    if c is None:
                        m["priced"] = False
                    else:
                        m["usd"] += c

    def refresh(self) -> bool:
        """Read whatever was appended since last time. True when something new was read."""
        try:
            st = self.path.stat()
        except OSError:
            return False
        if st.st_size < self.offset:  # rewritten: start over
            self.__init__(self.path, self.fmt)
        self.mtime = st.st_mtime
        if st.st_size == self.offset:
            return False
        with self.path.open("rb") as f:
            f.seek(self.offset)
            chunk = f.read()
        end = chunk.rfind(b"\n")
        if end < 0:
            return False  # a partial line: wait for the rest
        for raw in chunk[: end + 1].splitlines():
            try:
                obj = json.loads(raw)
            except ValueError:
                continue
            if isinstance(obj, dict):
                self.feed(obj)
        self.offset += end + 1
        return True

    def summary(self) -> dict[str, Any]:
        tokens: dict[str, int] = {}
        usd = 0.0
        priced = True
        for m in self.models.values():
            add_tokens(tokens, m["tokens"])
            usd += m["usd"]
            priced = priced and m["priced"]
        top = max(self.models.values(), key=lambda m: tokens_total(m["tokens"]), default=None)
        return {
            "sessionId": self.session_id, "file": str(self.path), "fmt": self.fmt, "mtime": self.mtime,
            "firstAt": self.first_at, "lastAt": self.last_at or (self.mtime or None), "title": self.title, "cwd": self.cwd, "branch": self.branch,
            "entrypoint": self.entrypoint, "version": self.version, "model": (top or {}).get("model") or self.init_model,
            "turns": self.turns, "tools": self.tools, "prompts": self.prompts, "edits": sorted(self.edits)[:200],
            "tokens": tokens, "usd": usd if self.models else None, "priced": priced,
            "models": {k: {"model": m["model"], "turns": m["turns"], "tokens": dict(m["tokens"]), "usd": m["usd"] if m["priced"] else None} for k, m in self.models.items()},
            "result": self.result,
        }


def read_events(path: Path, offset: int = 0, limit_bytes: int = 64 * 1024 * 1024) -> tuple[list[dict[str, Any]], int]:
    """Events of one file from a byte offset (whole lines only) → (events, next offset). Not numbered."""
    out: list[dict[str, Any]] = []
    with path.open("rb") as f:
        f.seek(offset)
        chunk = f.read(limit_bytes)
    end = chunk.rfind(b"\n")
    if end < 0:
        return out, offset
    for raw in chunk[: end + 1].splitlines():
        try:
            obj = json.loads(raw)
        except ValueError:
            continue
        out.extend(line_events(obj))
    return out, offset + end + 1


def sniff_stream(path: Path) -> str | None:
    """Session id when a .jsonl file is a stream-json log (first JSON line: system init or a session_id event)."""
    try:
        with path.open("rb") as f:
            for _ in range(5):
                raw = f.readline(256 * 1024)
                if not raw:
                    return None
                try:
                    obj = json.loads(raw)
                except ValueError:
                    continue
                if isinstance(obj, dict) and obj.get("session_id") and obj.get("type") in ("system", "assistant", "user", "result"):
                    return str(obj["session_id"])
                return None
    except OSError:
        return None
    return None


# ------------------------------------------------------------------ the store

DEFAULT_CONFIG: dict[str, Any] = {
    "transcripts": ["~/.claude/projects"],
    "streams": [str(ROOT), "~/b"],
    # agent-run@1 files (one run each) and the agent swarm's runs.json (swarm-runs@1) in these folders
    "reports": [str(ROOT / ".axf-console" / "agent-runs"), str(ROOT / ".axf-console" / "plugins" / "agent-swarm")],
    "sessionArchive": "auto",
    "maxRuns": 2000,
}


def _expand(p: str) -> Path:
    return Path(os.path.expandvars(os.path.expanduser(p)))


class Store:
    def __init__(self, data_dir: Path, config: dict[str, Any] | None = None) -> None:
        self.data_dir = data_dir
        self.config = {**DEFAULT_CONFIG, **(config or {})}
        self.accs: dict[str, Acc] = {}
        self.reports: dict[str, tuple[float, dict[str, Any]]] = {}
        self.events_lru: OrderedDict[tuple[str, float, int], list[dict[str, Any]]] = OrderedDict()
        self._stamp = ""
        self._runs: list[dict[str, Any]] = []
        self._scanned = 0.0

    # --- discovery
    def transcript_files(self) -> Iterable[Path]:
        roots = list(self.config.get("transcripts") or [])
        if os.environ.get("CLAUDE_CONFIG_DIR"):
            roots.append(str(Path(os.environ["CLAUDE_CONFIG_DIR"]) / "projects"))
        for r in dict.fromkeys(roots):
            base = _expand(r)
            if base.is_dir():
                yield from base.glob("*/*.jsonl")

    def stream_files(self) -> Iterable[Path]:
        for r in dict.fromkeys(self.config.get("streams") or []):
            base = _expand(r)
            if base.is_dir():
                yield from base.glob("*.jsonl")
                yield from base.glob("*/*.jsonl")

    def report_files(self) -> Iterable[Path]:
        for r in dict.fromkeys(self.config.get("reports") or []):
            base = _expand(r)
            if base.is_dir():
                yield from (f for f in base.glob("*.json") if f.name == "runs.json" or not f.name.startswith(("config", "state", "roster", "killed")))

    # --- reading
    def _acc(self, path: Path, fmt: str) -> Acc:
        key = str(path)
        a = self.accs.get(key)
        if a is None:
            a = self.accs[key] = Acc(path, fmt)
        a.refresh()
        return a

    def _reports(self, path: Path) -> list[dict[str, Any]]:
        """agent-run@1 (one run) or swarm-runs@1 (the agent swarm's runs.json, many) → normalised report records."""
        try:
            m = path.stat().st_mtime
        except OSError:
            return []
        hit = self.reports.get(str(path))
        if hit and hit[0] == m:
            return hit[1]
        try:
            raw = json.loads(path.read_text("utf-8"))
        except (OSError, ValueError):
            raw = None
        if isinstance(raw, dict) and raw.get("$axf") == "agent-run@1":
            recs = [dict(raw)]
        elif isinstance(raw, dict) and raw.get("$axf") == "swarm-runs@1" and isinstance(raw.get("runs"), list):
            recs = [from_swarm(r) for r in raw["runs"][-5000:] if isinstance(r, dict) and r.get("$axf") == "swarm-run@1"]
        else:
            recs = []
        for r in recs:
            r["_file"], r["_mtime"] = str(path), m
        self.reports[str(path)] = (m, recs)
        return recs

    def killed(self) -> dict[str, Any]:
        try:
            return json.loads((self.data_dir / "killed.json").read_text("utf-8"))
        except (OSError, ValueError):
            return {}

    def mark_killed(self, rid: str, by: str, how: str) -> None:
        k = self.killed()
        k[rid] = {"at": iso(time.time()), "by": by[:80], "how": how[:200]}
        self.data_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.data_dir / "killed.json.tmp"
        tmp.write_text(json.dumps(k, indent=1), "utf-8")
        os.replace(tmp, self.data_dir / "killed.json")

    def scan(self, now: float | None = None) -> list[dict[str, Any]]:
        now = time.time() if now is None else now
        sig = hashlib.sha1()
        by_sid: dict[str, dict[str, Any]] = {}

        def slot(sid: str) -> dict[str, Any]:
            return by_sid.setdefault(sid, {"id": sid, "transcript": None, "stream": None, "report": None})

        live_paths = set()
        for p in self.transcript_files():
            live_paths.add(str(p))
            a = self._acc(p, "transcript")
            sig.update(f"{p}:{a.offset}:{a.mtime}".encode())
            s = a.summary()
            sid = s["sessionId"] or p.stem
            if RUN_ID.match(sid):
                slot(sid)["transcript"] = s
        for p in self.stream_files():
            sp = str(p)
            if sp not in self.accs and not sniff_stream(p):
                continue
            live_paths.add(sp)
            a = self._acc(p, "stream")
            sig.update(f"{p}:{a.offset}:{a.mtime}".encode())
            s = a.summary()
            sid = s["sessionId"] or f"stream-{hashlib.sha1(sp.encode()).hexdigest()[:12]}"
            if RUN_ID.match(sid):
                slot(sid)["stream"] = s
        for p in self.report_files():
            recs = self._reports(p)
            if recs:
                sig.update(f"{p}:{recs[0]['_mtime']}:{len(recs)}".encode())
            for r in recs:
                sid = str(r.get("sessionId") or "") or attach(by_sid, r) or f"run-{r.get('id') or p.stem}"
                sid = re.sub(r"[^\w.-]", "_", sid)[:100]
                if RUN_ID.match(sid):
                    slot(sid)["report"] = r
        for gone in set(self.accs) - live_paths:
            self.accs.pop(gone, None)
        k = self.killed()
        sig.update(json.dumps(k, sort_keys=True).encode())
        runs = [merge(v, k.get(v["id"]), now) for v in by_sid.values()]
        runs.sort(key=lambda r: r.get("startedAt") or "", reverse=True)
        runs = runs[: int(self.config.get("maxRuns") or 2000)]
        # running runs change status by the clock alone: put their state in the stamp too
        sig.update(",".join(f"{r['id']}={r['status']}" for r in runs if r["status"] == "running").encode())
        self._stamp = sig.hexdigest()[:16]
        self._runs = runs
        self._scanned = now
        return runs

    def stamp(self) -> str:
        return self._stamp

    def runs(self, max_age: float = 2.0) -> list[dict[str, Any]]:
        if time.time() - self._scanned > max_age:
            self.scan()
        return self._runs

    def run(self, rid: str) -> dict[str, Any] | None:
        for r in self.runs():
            if r["id"] == rid:
                return r
        return None

    def events(self, run: dict[str, Any]) -> list[dict[str, Any]]:
        """Every event of a run, numbered; the transcript is preferred (it has the whole conversation), the stream
        log's ``result`` is added at the end when the transcript has none."""
        files = run.get("files") or {}
        path = files.get("transcript") or files.get("stream")
        if not path:
            return []
        p = Path(path)
        try:
            st = p.stat()
        except OSError:
            return []
        key = (str(p), st.st_mtime, st.st_size)
        hit = self.events_lru.get(key)
        if hit is not None:
            self.events_lru.move_to_end(key)
            return hit
        evs, _ = read_events(p)
        if files.get("stream") and files.get("transcript") and not any(e["kind"] == "result" for e in evs):
            res = (run.get("_result") or None)
            if res:
                evs.append(dict(res))
        evs = number_events(evs)
        self.events_lru[key] = evs
        while len(self.events_lru) > 4:
            self.events_lru.popitem(last=False)
        return evs


def from_swarm(r: dict[str, Any]) -> dict[str, Any]:
    """swarm-run@1 (the agent swarm's runner, runs.json) → the report fields this store reads (agent-run@1 shape)."""
    st, reason = str(r.get("status") or ""), str(r.get("reason") or "")
    status = {"done": "done", "failed": "failed", "blocked": "failed", "error": "failed"}.get(st)
    if st == "killed":
        status = "killed-budget" if ("budget" in reason or "time limit" in reason) else "killed"
    u = r.get("usage") if isinstance(r.get("usage"), dict) else {}
    rep = r.get("report") if isinstance(r.get("report"), dict) else {}
    budget = r.get("budget") if isinstance(r.get("budget"), dict) else {}
    return {
        "$axf": "agent-run@1", "from": "swarm-run@1", "id": f"{r.get('jobId') or '?'}@{r.get('startedAt') or ''}",
        "agent": r.get("agent"), "build": r.get("buildId"), "job": r.get("stepId") or r.get("jobId"), "model": r.get("model"),
        "status": status or "stopped", "reason": reason, "startedAt": r.get("startedAt"), "endedAt": r.get("endedAt"),
        "worktree": r.get("cwd") or "", "costUsd": r.get("reportedCost") if isinstance(r.get("reportedCost"), (int, float)) else None,
        "usage": {k: int(u.get(k) or 0) for k in ("input", "output", "cacheRead", "cacheWrite")},
        "budget": {k: budget[k] for k in ("tokens", "usd", "turns", "maxTurns") if isinstance(budget.get(k), (int, float))} or None,
        "summary": rep.get("summary"), "files": rep.get("files"),
        "changes": [{"item": rep.get("summary"), "files": rep.get("files") or [], "wrong": rep.get("question") or ""}] if rep.get("summary") and rep.get("files") else None,
    }


def attach(by_sid: dict[str, dict[str, Any]], r: dict[str, Any]) -> str:
    """A report without a session id belongs to the transcript / stream that ran in its folder while it ran."""
    cwd = str(r.get("worktree") or "").rstrip("/")
    lo, hi = parse_ts(r.get("startedAt")), parse_ts(r.get("endedAt"))
    if not cwd or lo is None:
        return ""
    for sid, v in by_sid.items():
        if v.get("report"):
            continue
        for part in (v.get("transcript"), v.get("stream")):
            if not part or str(part.get("cwd") or "").rstrip("/") != cwd or part.get("firstAt") is None:
                continue
            if lo - 90 <= part["firstAt"] <= (hi if hi is not None else lo + 86400) + 90:
                return sid
    return ""


def _result_status(res: dict[str, Any]) -> str:
    sub = str(res.get("subtype") or "")
    if "max_turns" in sub or "budget" in sub:
        return "killed-budget"
    return "done" if sub == "success" and not res.get("isError") else "failed"


def _pid_alive(pid: Any) -> bool | None:
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return None
    if pid <= 1:
        return None
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return None
    return True


def merge(v: dict[str, Any], killed: dict[str, Any] | None, now: float) -> dict[str, Any]:
    """The pieces of one session (transcript, stream log, agent report) → one run row."""
    t, s, r = v.get("transcript"), v.get("stream"), v.get("report") or {}
    main = t or s or {}
    res = (s or {}).get("result") or (t or {}).get("result")
    first = min([x for x in ((t or {}).get("firstAt"), (s or {}).get("firstAt"), parse_ts(r.get("startedAt"))) if x is not None], default=None)
    last = max([x for x in ((t or {}).get("lastAt"), (s or {}).get("lastAt"), parse_ts(r.get("endedAt")), r.get("_mtime")) if x is not None], default=None)

    # cost: the result's total (exact, from Anthropic's usage) > the report's > priced usage of every turn
    usage_usd = main.get("usd")
    if res and isinstance(res.get("totalCostUsd"), (int, float)):
        usd, cost_from = float(res["totalCostUsd"]), "result"
    elif isinstance(r.get("costUsd"), (int, float)):
        usd, cost_from = float(r["costUsd"]), "report"
    else:
        usd, cost_from = usage_usd, ("usage" if usage_usd is not None else None)
    tokens = dict(main.get("tokens") or {})
    if not tokens and res and res.get("usage"):
        tokens = dict(res["usage"])
    if not tokens and isinstance(r.get("usage"), dict):
        tokens = {k: int(r["usage"].get(k) or 0) for k in ("input", "output", "cacheRead", "cacheWrite")}

    headless = bool(s) or main.get("entrypoint") in ("sdk-cli", "sdk-ts", "sdk-py") or bool(res)
    swarm = main.get("entrypoint") == "axf-swarm" or "/agent-swarm/worktrees/" in str(main.get("cwd") or "")
    kind = "agent" if (r or swarm) else ("headless" if headless else "session")

    pid = r.get("pid")
    alive = _pid_alive(pid) if pid else None
    if killed:
        status = "killed"
    elif r.get("status") in STATUSES and r.get("status") != "running":
        status = r["status"]
    elif res:
        status = _result_status(res)
    elif alive is False:
        status = "stopped"
    elif alive or (last is not None and now - last < RUNNING_WINDOW):
        status = "running"
    else:
        status = "ended" if kind == "session" else "stopped"

    branch = str(r.get("branch") or main.get("branch") or "")
    build = str(r.get("build") or "")
    job = str(r.get("job") or "")
    if not build and branch.startswith(("claude/", "swarm/")):
        parts = branch.split("/")
        build, job = parts[1], job or ("/".join(parts[2:]) if parts[0] == "swarm" else "")
    duration = None
    if res and isinstance(res.get("durationMs"), (int, float)):
        duration = int(res["durationMs"])
    elif first is not None and last is not None:
        duration = int((last - first) * 1000)
    models = dict(main.get("models") or {})
    title = str(r.get("title") or main.get("title") or "")
    return {
        "id": v["id"], "kind": kind, "title": title or v["id"],
        "agent": str(r.get("agent") or ""), "build": build, "job": job,
        "model": str(r.get("model") or main.get("model") or ""), "status": status,
        "tokens": tokens, "tokensTotal": tokens_total(tokens), "usd": usd, "costFrom": cost_from,
        "usageUsd": usage_usd, "models": models,
        "durationMs": duration, "startedAt": iso(first), "lastAt": iso(last),
        "turns": main.get("turns") or (res or {}).get("numTurns") or 0, "tools": main.get("tools") or 0, "prompts": main.get("prompts") or 0,
        "cwd": str(r.get("worktree") or main.get("cwd") or ""), "branch": branch, "edits": main.get("edits") or [],
        "budget": r.get("budget") if isinstance(r.get("budget"), dict) else None,
        "pid": pid if isinstance(pid, int) else None, "tmux": str(r.get("tmux") or "") or None,
        "pr": r.get("pr") if isinstance(r.get("pr"), str) else None, "commits": [c for c in (r.get("commits") or []) if isinstance(c, str)][:200],
        "report": {k: r.get(k) for k in ("summary", "changes", "reason") if r.get(k)} or None,
        "killed": killed, "resultText": (res or {}).get("text") or "",
        "files": {"transcript": (t or {}).get("file"), "stream": (s or {}).get("file"), "report": r.get("_file")},
        "_result": res,
    }


def public(run: dict[str, Any]) -> dict[str, Any]:
    """A run as the browser sees it (no private keys, result text cut for the list)."""
    out = {k: v for k, v in run.items() if not k.startswith("_")}
    out["resultText"] = redact(out.get("resultText") or "", 2000)
    return out
