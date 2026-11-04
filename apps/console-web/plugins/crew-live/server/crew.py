"""Crew core (pure Python, no FastAPI, so the self-test runs anywhere): who is working right now and on what.

A *run* is one headless Claude Code session (deploy/claude-headless.sh, tmux session ``axf-<name>``). Everything here is
read from files and git, never from a model (zero tokens):

  sessions   the live headless sessions: the capability ``axf.headless@1`` (the Terminal plugin's tmux list and
             headless-meter@1 files on the VPS) when it is there, else the worktrees' stream logs
  streams    ``<worktree>/<name>.jsonl``: the raw ``--output-format stream-json`` events (tool calls, usage, result)
  builds     the builds store (builds@1, ``_claude/builds/store.json``): build, steps done / now / next, PR
  roster     the agent swarm's crew (capability ``axf.swarm-roster@1``): names, avatars, pay, status
  git        the worktree vs the build's base (merge-base with origin/main): files created / modified / deleted, diffs

Paths the launcher wrote on the host (``/root/axf-builds/…``, ``/opt/axf/…``) are mapped into the console container
(``/hostfs/axf-builds/…``, ``/axf/…``); ``AXF_CREW_PATHS`` overrides the map (``host=local,host=local``).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any, Callable

PLUGIN = Path(__file__).resolve().parents[1]
ROOT = PLUGIN.parents[3]
PRICING_FILE = ROOT / "framework" / "schemas" / "model-pricing.json"  # model-pricing@1, shared with the meters

RECENT_IDLE = 2 * 3600.0   # s: finished runs stay listed this long
STUCK_AFTER = 600.0      # s: a run without a result that has been silent this long is stuck
RECENT_TOOLS = 25          # tool calls kept per run
STREAM_TAIL = 4 * 1024 * 1024  # bytes of a stream read at most (the newest part)
DIFF_MAX = 400_000         # characters of one file's diff
FILES_MAX = 300
SESSION = re.compile(r"^axf-[A-Za-z0-9._-]{1,100}$")
REL_PATH = re.compile(r"^(?!/)(?!.*(?:^|/)\.\.(?:/|$))[^\0]{1,400}$")
_SECRET = re.compile(r"(ghp_|gho_|ghs_|github_pat_|sk-ant-|xox[bp]-)[A-Za-z0-9_\-]{6,}|Bearer\s+[A-Za-z0-9._\-]{12,}")
STATUSES = ("working", "waiting", "stuck", "idle")

RUNNER: Callable[..., Any] = subprocess.run  # replaced by the self-test


# ------------------------------------------------------------------ helpers

def redact(s: Any, limit: int = 400) -> str:
    t = s if isinstance(s, str) else ("" if s is None else json.dumps(s, ensure_ascii=False)[: limit + 1])
    t = _SECRET.sub("[removed]", t)
    return t if len(t) <= limit else t[: limit - 1] + "…"


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


def path_map() -> list[tuple[str, str]]:
    raw = os.environ.get("AXF_CREW_PATHS")
    if raw is not None:
        pairs = [p.split("=", 1) for p in raw.split(",") if "=" in p]
        return [(a.rstrip("/"), b.rstrip("/")) for a, b in pairs]
    out = []
    if Path("/hostfs/axf-builds").is_dir():
        out.append(("/root/axf-builds", "/hostfs/axf-builds"))
    if Path("/axf/.git").exists() and not Path("/opt/axf/.git").exists():
        out.append(("/opt/axf", "/axf"))
    return out


def local_path(p: str) -> str:
    """A host path as this process sees it (the console container mounts the build worktrees elsewhere)."""
    for host, here in path_map():
        if p == host or p.startswith(host + "/"):
            return here + p[len(host):]
    return p


# ------------------------------------------------------------------ prices

_prices: tuple[float, dict[str, dict[str, float]]] | None = None


def prices() -> dict[str, dict[str, float]]:
    global _prices
    try:
        m = PRICING_FILE.stat().st_mtime
    except OSError:
        m = -1.0
    if _prices is None or _prices[0] != m:
        try:
            table = json.loads(PRICING_FILE.read_text("utf-8")).get("models") or {}
        except (OSError, ValueError):
            table = {}
        _prices = (m, table)
    return _prices[1]


def model_key(model: Any) -> str:
    s = str(model or "").lower()
    for k in ("fable", "opus", "sonnet", "haiku"):
        if k in s:
            return k
    return ""


def usage_tokens(u: Any) -> dict[str, int]:
    u = u if isinstance(u, dict) else {}
    return {"input": int(u.get("input_tokens") or 0), "output": int(u.get("output_tokens") or 0),
            "cacheRead": int(u.get("cache_read_input_tokens") or 0), "cacheWrite": int(u.get("cache_creation_input_tokens") or 0)}


def cost_of(tokens: dict[str, int], model: str) -> float:
    p = prices().get(model_key(model)) or {}
    return sum(tokens.get(k, 0) * float(p.get(k) or 0) for k in ("input", "output", "cacheRead", "cacheWrite")) / 1_000_000


# ------------------------------------------------------------------ the stream

def describe_tool(name: str, inp: Any) -> str:
    """One plain-English line for a tool call, from its name and input only (no model)."""
    i = inp if isinstance(inp, dict) else {}
    f = str(i.get("file_path") or i.get("path") or i.get("notebook_path") or "")
    short = f.split("/")[-1] if f else ""
    if name in ("Edit", "MultiEdit"):
        return f"Editing {short}" if short else "Editing a file"
    if name == "Write":
        return f"Writing {short}" if short else "Writing a file"
    if name == "Read":
        return f"Reading {short}" if short else "Reading a file"
    if name == "NotebookEdit":
        return f"Editing notebook {short}"
    if name == "Bash":
        d = str(i.get("description") or "").strip()
        return d[:1].upper() + d[1:] if d else f"Running {redact(str(i.get('command') or '').split(chr(10))[0], 80)}"
    if name == "Grep":
        return f"Searching the code for {redact(i.get('pattern'), 60)}"
    if name == "Glob":
        return f"Looking for files {redact(i.get('pattern'), 60)}"
    if name in ("WebFetch", "WebSearch"):
        return f"Looking up {redact(i.get('url') or i.get('query'), 80)}"
    if name in ("Task", "Agent"):
        return f"Handing off: {redact(i.get('description'), 80)}"
    if name.startswith("mcp__"):
        return f"Calling {name.split('__')[-1].replace('_', ' ')}"
    return f"Using {name}"


def tool_target(name: str, inp: Any) -> str:
    i = inp if isinstance(inp, dict) else {}
    if name == "Bash":
        return redact(str(i.get("command") or ""), 300)
    return redact(str(i.get("file_path") or i.get("path") or i.get("pattern") or i.get("url") or i.get("query") or ""), 300)


def read_stream(path: Path, tail: int = STREAM_TAIL) -> dict[str, Any]:
    """Fold a stream-json log into: model, tokens and cost (once per message id, last usage wins), the final result,
    the recent tool calls with the cost of the turn that made them, the last text and the time of the last event."""
    out: dict[str, Any] = {"model": "", "tokens": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}, "costUsd": 0.0,
                           "exactCost": False, "result": None, "tools": [], "text": "", "lastEventAt": None, "startedAt": None,
                           "toolRunning": False, "turns": 0, "sessionId": ""}
    try:
        st = path.stat()
        with path.open("rb") as fh:
            if st.st_size > tail:
                fh.seek(st.st_size - tail)
                fh.readline()
            raw = fh.read()
    except OSError:
        return out
    out["lastEventAt"] = st.st_mtime
    msgs: dict[str, tuple[str, dict[str, int]]] = {}
    pending: dict[str, dict[str, Any]] = {}
    tools: list[dict[str, Any]] = []
    for ln in raw.splitlines():
        try:
            e = json.loads(ln)
        except ValueError:
            continue
        if not isinstance(e, dict):
            continue
        t = e.get("type")
        if t == "system" and e.get("subtype") == "init":
            out["model"] = str(e.get("model") or out["model"])
            out["sessionId"] = str(e.get("session_id") or "")
        elif t == "assistant":
            m = e.get("message") if isinstance(e.get("message"), dict) else {}
            mid = str(m.get("id") or len(msgs))
            model = str(m.get("model") or out["model"])
            out["model"] = model or out["model"]
            msgs[mid] = (model, usage_tokens(m.get("usage")))
            for c in m.get("content") or []:
                if not isinstance(c, dict):
                    continue
                if c.get("type") == "tool_use":
                    name = str(c.get("name") or "")
                    rec = {"id": str(c.get("id") or ""), "tool": name, "what": describe_tool(name, c.get("input")),
                           "target": tool_target(name, c.get("input")), "msg": mid, "state": "running", "costUsd": 0.0}
                    tools.append(rec)
                    pending[rec["id"]] = rec
                elif c.get("type") == "text" and str(c.get("text") or "").strip():
                    out["text"] = redact(str(c["text"]).strip(), 600)
        elif t == "user":
            m = e.get("message") if isinstance(e.get("message"), dict) else {}
            for c in m.get("content") or [] if isinstance(m.get("content"), list) else []:
                if isinstance(c, dict) and c.get("type") == "tool_result":
                    rec = pending.pop(str(c.get("tool_use_id") or ""), None)
                    if rec:
                        rec["state"] = "failed" if c.get("is_error") else "done"
        elif t == "result":
            out["result"] = {"subtype": e.get("subtype"), "isError": bool(e.get("is_error")), "costUsd": e.get("total_cost_usd"),
                             "turns": e.get("num_turns"), "durationMs": e.get("duration_ms")}
    total = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}
    cost = 0.0
    per_msg: dict[str, float] = {}
    for mid, (model, tk) in msgs.items():
        for k in total:
            total[k] += tk[k]
        c = cost_of(tk, model)
        per_msg[mid] = c
        cost += c
    out["tokens"] = total
    out["turns"] = len(msgs)
    res = out["result"]
    if res and isinstance(res.get("costUsd"), (int, float)):
        out["costUsd"], out["exactCost"] = round(float(res["costUsd"]), 4), True
    else:
        out["costUsd"] = round(cost, 4)
    out["toolRunning"] = bool(pending) and not res
    out["tools"] = _cost_tools(tools, per_msg)[-RECENT_TOOLS:][::-1]
    return out


def _cost_tools(tools: list[dict[str, Any]], per_msg: dict[str, float]) -> list[dict[str, Any]]:
    """Each tool call gets the cost of the assistant turn that asked for it, split between that turn's calls."""
    n: dict[str, int] = {}
    for r in tools:
        n[r["msg"]] = n.get(r["msg"], 0) + 1
    out = []
    for r in tools:
        mid = r["msg"]
        out.append({k: v for k, v in r.items() if k != "msg"} | {"costUsd": round(per_msg.get(mid, 0.0) / n[mid], 4)})
    return out


# ------------------------------------------------------------------ builds and the roster

def store_builds(store_file: Path) -> dict[str, dict[str, Any]]:
    try:
        s = json.loads(store_file.read_text("utf-8"))
    except (OSError, ValueError):
        return {}
    return {b["id"]: b for b in s.get("builds") or [] if isinstance(b, dict) and b.get("id") and not b.get("deleted")}


def build_progress(b: dict[str, Any] | None, started: float | None) -> dict[str, Any] | None:
    """Steps as done / now / next, the current one with the time it started (the previous step's tick, else the run)."""
    if not b:
        return None
    steps = [s for s in b.get("steps") or [] if isinstance(s, dict) and not s.get("skip")]
    now_i = next((i for i, s in enumerate(steps) if not s.get("done")), None)
    rows = []
    for i, s in enumerate(steps):
        state = "done" if s.get("done") else "now" if i == now_i else "next"
        rows.append({"id": s.get("id"), "text": redact(s.get("title") or s.get("text") or "", 300), "model": s.get("model") or "", "state": state,
                     "doneAt": s.get("doneAt") or ""})
    step_started = None
    if now_i is not None:
        prev = [parse_ts(s.get("doneAt")) for s in steps[:now_i] if s.get("doneAt")]
        prev = [p for p in prev if p]
        step_started = max(prev) if prev else started
        if started and step_started and step_started < started:
            step_started = started
    pr = str(b.get("pr") or "")
    return {"id": b["id"], "title": redact(b.get("title") or b["id"], 200), "status": b.get("status") or "", "branch": b.get("branch") or "",
            "pr": pr, "prUrl": pr if pr.startswith("http") else (f"https://github.com/MossesX/AmberX-AXF/pull/{pr.lstrip('#')}" if pr.lstrip("#").isdigit() else ""),
            "steps": rows, "done": sum(1 for r in rows if r["state"] == "done"), "total": len(rows),
            "now": next((r for r in rows if r["state"] == "now"), None), "stepStartedAt": iso(step_started),
            "waitingApproval": any(isinstance(u, dict) and (u.get("status") in ("", None, "pending", "requested")) for u in b.get("upgradeRequests") or []),
            "detail": str(b.get("detail") or "")}


AGENT_LINE = re.compile(r"(?:assigned\s+)?agent\s*[:=]\s*\**\s*([A-Za-z][\w' -]{1,40}?)\s*\**\s*(?:[.,;(\n]|$)", re.I)


def resolve_agent(names: list[str], roster: list[dict[str, Any]], detail: str = "") -> dict[str, Any] | None:
    """The crew member a run belongs to: a tag or session name that is an agent id or name (axf-<agent>-<job> from the
    job router), else the build's "Agent: <name>" line."""
    by_id = {str(a.get("id")).lower(): a for a in roster}
    by_name = {}
    for a in roster:
        nm = str(a.get("name") or "").lower()
        if nm:
            by_name[nm] = a
            for w in nm.split():
                by_name.setdefault(w, a)
    for n in names:
        n = str(n or "").lower()
        if not n:
            continue
        if n in by_id:
            return by_id[n]
        head = n.split("-")[0]
        if head in by_id and len(n.split("-")) > 1 and n.split("-", 1)[1] not in by_id:
            return by_id[head]
    for m in AGENT_LINE.finditer(detail or ""):
        cand = m.group(1).strip().lower()
        if cand in by_name:
            return by_name[cand]
        for w in cand.split():
            if w in by_name and w not in ("the", "agent"):
                return by_name[w]
    return None


def initials(name: str) -> str:
    ws = [w for w in re.split(r"[\s_-]+", name or "") if w]
    return "".join(w[0].upper() for w in ws[:2]) or "?"


def agent_view(a: dict[str, Any] | None, fallback: str) -> dict[str, Any]:
    if not a:
        return {"id": "", "name": fallback, "role": "", "avatar": None, "initials": initials(fallback), "known": False}
    return {"id": a.get("id"), "name": a.get("name") or a.get("id"), "role": a.get("role") or "", "avatar": a.get("avatar"),
            "initials": initials(str(a.get("name") or a.get("id"))), "known": True, "salary": a.get("salary"), "status": a.get("status") or "",
            "catchphrase": a.get("catchphrase") or ""}


# ------------------------------------------------------------------ git

def git_env(worktree: str) -> tuple[list[str], dict[str, str]] | None:
    """git argv prefix + env for a worktree as this process sees it (its .git file may name a host path)."""
    wt = Path(local_path(worktree))
    g = wt / ".git"
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    if g.is_file():
        try:
            line = g.read_text("utf-8").strip()
        except OSError:
            return None
        if not line.startswith("gitdir:"):
            return None
        env["GIT_DIR"] = local_path(line[7:].strip())
        env["GIT_WORK_TREE"] = str(wt)
    elif not g.is_dir():
        return None
    return ["git", "-C", str(wt), "-c", "safe.directory=*", "-c", "core.quotepath=off", "--no-optional-locks"], env


def _git(worktree: str, *args: str, timeout: int = 20) -> str | None:
    ge = git_env(worktree)
    if not ge:
        return None
    try:
        r = RUNNER([*ge[0], *args], capture_output=True, text=True, timeout=timeout, env=ge[1], stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout if r.returncode == 0 else None


def base_of(worktree: str) -> str:
    for ref in ("origin/main", "main"):
        b = _git(worktree, "merge-base", "HEAD", ref)
        if b and b.strip():
            return b.strip()
    return "HEAD"


KIND = {"A": "created", "M": "modified", "D": "deleted", "R": "renamed", "C": "created", "T": "modified"}


def changed_files(worktree: str, since: float | None = None) -> dict[str, Any]:
    """Files this build changed vs its base: committed + staged + unstaged (git diff <base>) and new untracked files
    (only ones made after the run started, so leftovers in a reused worktree don't count)."""
    base = base_of(worktree)
    out = _git(worktree, "diff", "--name-status", "-M", base)
    if out is None:
        return {"ok": False, "base": "", "files": []}
    files: dict[str, dict[str, Any]] = {}
    for ln in out.splitlines():
        p = ln.split("\t")
        if len(p) < 2:
            continue
        k = KIND.get(p[0][:1], "modified")
        files[p[-1]] = {"path": p[-1], "kind": k, **({"from": p[1]} if k == "renamed" and len(p) > 2 else {})}
    stat = _git(worktree, "diff", "--numstat", "-M", base) or ""
    for ln in stat.splitlines():
        p = ln.split("\t")
        if len(p) >= 3 and p[-1] in files:
            files[p[-1]]["added"] = int(p[0]) if p[0].isdigit() else 0
            files[p[-1]]["removed"] = int(p[1]) if p[1].isdigit() else 0
    wt = Path(local_path(worktree))
    for p in (_git(worktree, "ls-files", "--others", "--exclude-standard") or "").splitlines()[:5000]:
        if p in files:
            continue
        try:
            m = (wt / p).stat().st_mtime
        except OSError:
            continue
        if since is not None and m < since:
            continue
        files[p] = {"path": p, "kind": "created", "untracked": True}
    for f in files.values():
        try:
            f["changedAt"] = iso((wt / f["path"]).stat().st_mtime)
        except OSError:
            f["changedAt"] = None
    items = sorted(files.values(), key=lambda f: f.get("changedAt") or "", reverse=True)[:FILES_MAX]
    return {"ok": True, "base": base, "files": items, "count": len(files)}


def file_diff(worktree: str, rel: str) -> dict[str, Any]:
    """One file's change vs the build's base as a unified diff (an untracked new file is shown all added)."""
    if not REL_PATH.match(rel or ""):
        raise ValueError("not a path in the worktree")
    wt = Path(local_path(worktree)).resolve()
    f = (wt / rel).resolve()
    if not str(f).startswith(str(wt) + os.sep):
        raise ValueError("not a path in the worktree")
    base = base_of(worktree)
    d = _git(worktree, "diff", "-M", "--no-color", base, "--", rel)
    if d is None:
        raise ValueError("git can't read this worktree")
    if re.search(r"^Binary files .* differ$", d, re.M):
        return {"path": rel, "base": base, "diff": "", "hunks": [], "binary": True}
    if not d.strip() and f.is_file():
        tracked = _git(worktree, "ls-files", "--", rel)
        if not (tracked or "").strip():
            try:
                raw = f.read_bytes()[:DIFF_MAX]
            except OSError:
                raw = b""
            if b"\0" in raw[:8192]:
                return {"path": rel, "base": base, "diff": "", "hunks": [], "binary": True}
            body = raw.decode("utf-8", errors="replace")
            lines = body.splitlines()
            d = f"--- /dev/null\n+++ b/{rel}\n@@ -0,0 +1,{len(lines)} @@\n" + "".join(f"+{x}\n" for x in lines)
    d = redact(d, DIFF_MAX)
    return {"path": rel, "base": base, "diff": d, "hunks": parse_hunks(d)}


HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$")


def parse_hunks(diff: str) -> list[dict[str, Any]]:
    """Unified diff → hunks of typed lines (add / del / ctx) with their old and new line numbers."""
    hunks: list[dict[str, Any]] = []
    cur: dict[str, Any] | None = None
    o = n = 0
    for ln in diff.splitlines():
        m = HUNK.match(ln)
        if m:
            o, n = int(m.group(1)), int(m.group(3))
            cur = {"header": ln, "context": m.group(5).strip(), "lines": [], "added": 0, "removed": 0}
            hunks.append(cur)
            continue
        if cur is None or ln.startswith("\\"):
            continue
        if ln.startswith("+"):
            cur["lines"].append({"t": "add", "n": n, "text": ln[1:]})
            cur["added"] += 1
            n += 1
        elif ln.startswith("-"):
            cur["lines"].append({"t": "del", "o": o, "text": ln[1:]})
            cur["removed"] += 1
            o += 1
        else:
            cur["lines"].append({"t": "ctx", "o": o, "n": n, "text": ln[1:] if ln.startswith(" ") else ln})
            o += 1
            n += 1
    return hunks


# ------------------------------------------------------------------ runs

def status_of(run: dict[str, Any], now: float) -> str:
    if run.get("ended"):
        return "idle"
    if (run.get("build") or {}).get("waitingApproval"):
        return "waiting"
    last = run.get("lastEventTs")
    if last is not None and run.get("live") is None and now - last > RECENT_IDLE:
        return "idle"  # nobody can say its tmux is still up, and it has been silent for hours: it stopped
    return "stuck" if last is not None and now - last > STUCK_AFTER else "working"


def plain_now(run: dict[str, Any]) -> str:
    """What the agent is doing right now, in plain English, from its newest tool call or step (never summarised by a model)."""
    tools = run.get("tools") or []
    st = run.get("status")
    if st == "waiting":
        return "Waiting for Brett to approve a model switch"
    if st == "idle":
        return "Finished" if not (run.get("result") or {}).get("isError") else "Stopped with an error"
    if tools:
        t = tools[0]
        return t["what"] + ("" if t["state"] == "running" else " (done)") if st != "stuck" else f"No activity for a while after: {t['what']}"
    step = ((run.get("build") or {}).get("now") or {}).get("text")
    return f"Working on: {step}" if step else "Starting up"


def make_run(session: dict[str, Any], meter: dict[str, Any] | None, builds: dict[str, dict[str, Any]], roster: list[dict[str, Any]], now: float) -> dict[str, Any]:
    name = str(session.get("name") or "")
    short = name[4:] if name.startswith("axf-") else name
    cwd = str(session.get("cwd") or (meter or {}).get("cwd") or "")
    stream_file = Path(local_path(cwd)) / f"{short}.jsonl" if cwd else None
    s = read_stream(stream_file) if stream_file else read_stream(Path("/nonexistent"))
    started = parse_ts((meter or {}).get("startedAt")) or (session.get("createdAt") or 0) / 1000.0 or _made_at(cwd)
    bid = next((x for x in (short, Path(cwd).name if cwd else "", re.sub(r"-\d+$", "", short)) if x in builds), "")
    b = builds.get(bid)
    prog = build_progress(b, started)
    tag = str(session.get("agent") or (meter or {}).get("agent") or "")
    agent = resolve_agent([tag, short], roster, (b or {}).get("detail") or "")
    m = meter or {}
    tokens = m.get("tokens") if isinstance(m.get("tokens"), dict) else s["tokens"]
    cost = float(m["costUsd"]) if isinstance(m.get("costUsd"), (int, float)) else s["costUsd"]
    last = max([x for x in (parse_ts(m.get("lastEventAt")), s["lastEventAt"]) if x] or [0]) or None
    model = str(m.get("model") or s["model"] or session.get("model") or "")
    run = {
        "id": name, "session": name, "name": short, "cwd": cwd, "agent": agent_view(agent, tag or short),
        "model": model, "modelKey": model_key(model) or model_key(session.get("model")),
        "startedAt": iso(started), "lastEventAt": iso(last),
        "costUsd": round(cost, 4), "costExact": bool(m.get("costEstimated") is False or s["exactCost"]),
        "tokens": tokens, "tokensTotal": sum(int(v or 0) for v in tokens.values()),
        "turns": m.get("turns") or s["turns"], "toolRunning": bool(m.get("toolRunning", s["toolRunning"])),
        "ended": bool(m.get("ended")) or bool(s["result"]) or session.get("live") is False,
        "result": s["result"], "tools": s["tools"], "lastText": s["text"], "build": prog,
        "sessionId": s["sessionId"], "attached": session.get("attached") or 0, "live": session.get("live"), "lastEventTs": last,
    }
    run["status"] = status_of(run, now)
    run["now"] = plain_now(run)
    run.pop("lastEventTs", None)
    return run


def _made_at(cwd: str) -> float | None:
    """When a worktree was made (its .git file): the start of a run nobody tagged with a start time."""
    try:
        return (Path(local_path(cwd)) / ".git").stat().st_mtime if cwd else None
    except OSError:
        return None


def discover_sessions(builds_root: str, now: float, within: float = 24 * 3600) -> list[dict[str, Any]]:
    """Without the Terminal's tmux list: every worktree under the builds folder whose stream log was written lately."""
    out = []
    root = Path(local_path(builds_root))
    try:
        dirs = [d for d in root.iterdir() if d.is_dir()]
    except OSError:
        return out
    for d in dirs:
        f = d / f"{d.name}.jsonl"
        try:
            m = f.stat().st_mtime
        except OSError:
            continue
        if now - m > within:
            continue
        out.append({"name": f"axf-{d.name}", "cwd": f"{builds_root.rstrip('/')}/{d.name}", "agent": "", "model": "", "createdAt": 0, "live": None})
    return out


def snapshot(sessions: list[dict[str, Any]], meters: dict[str, Any], builds: dict[str, dict[str, Any]], roster: list[dict[str, Any]],
             now: float | None = None, spend_today: float = 0.0) -> dict[str, Any]:
    """The whole Crew view: runs (working first), the crew members with no run (off the clock) and the totals."""
    now = time.time() if now is None else now
    every = [make_run(s, meters.get(s.get("name")), builds, roster, now) for s in sessions if SESSION.match(str(s.get("name") or ""))]
    today = (iso(now) or "")[:10]
    spent_today = sum(r["costUsd"] for r in every if (r["lastEventAt"] or "")[:10] == today)
    runs = [r for r in every if r["status"] != "idle" or now - (parse_ts(r["lastEventAt"]) or 0) <= RECENT_IDLE]
    order = {k: i for i, k in enumerate(STATUSES)}
    runs.sort(key=lambda r: (order.get(r["status"], 9), r["startedAt"] or ""))
    busy = {r["agent"]["id"] for r in runs if r["agent"]["id"] and r["status"] != "idle"}
    off = [agent_view(a, str(a.get("id"))) for a in roster if a.get("id") not in busy and a.get("status") not in ("fired", "quit")]
    working = [r for r in runs if r["status"] != "idle"]
    # every build whose detail names a crew member ("Agent: Ping Paulie"): avatars on build rows, steps, reviews
    build_agents = {}
    for bid, b in builds.items():
        a = resolve_agent([], roster, str(b.get("detail") or ""))
        if a:
            build_agents[bid] = a.get("id")
    for r in every:
        if r["agent"]["known"] and r["build"]:
            build_agents[r["build"]["id"]] = r["agent"]["id"]
    return {
        "$axf": "crew@1", "now": iso(now), "runs": runs, "offTheClock": off, "buildAgents": build_agents,
        "totals": {"working": len(working), "runs": len(runs), "costRunningUsd": round(sum(r["costUsd"] for r in working), 4),
                   "costTodayUsd": round(spend_today + spent_today, 4), "runsToday": sum(1 for r in every if (r["lastEventAt"] or "")[:10] == today)},
    }
