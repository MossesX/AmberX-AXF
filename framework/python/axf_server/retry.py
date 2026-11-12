"""retry-ladder@1 for Python servers: failed calls retried DIFFERENT ways until they work, on the server, whoever called.

Twin of framework/core/retry-ladder.mjs (the reference engine; same results, checked against
framework/spec/fixtures/retry-ladder.json by `node framework/spec/check-retry-ladder.mjs`, which runs this module too).
Used by the Dev Console's API (console commands, MCP) and baked into axHub's job runner.

- **Engine:** `classify(err)` → a failure kind; each kind has a ladder of fixes (`KINDS`), each tried once, in order;
  `on_failure` / `on_success` / `fix_unavailable` move a job record (retry-job@1) along. Ladder done → `gave-up` with one
  FYI text (`fyi_text`): what failed, what was tried, what is missing. Permanent errors → `failed` at once.
- **Runner:** `Runner(dir, fixes=…)`. `run(title, call, …)` blocks; `submit(…)` runs the same thing on a daemon thread
  and returns the job at once, so the retry carries on when the caller's session, HTTP request or MCP call goes away.
  Every change is written to `<dir>/jobs/<id>.json` (0600) and passed to `on_change(job)`; a stopped job with an FYI
  goes to `on_fyi(job)` once. The Auto-fixes plugin reads the folder (one file per job, so writers never share a file).
- **Fixes:** a fix is `fixes[fix_id](ctx, job) -> None` and may change `ctx` (the call's arguments: `timeout`, `route`,
  `to`, …). `wait` / `retry` / `backoff` only wait; `longer-timeout` triples `ctx["timeout"]`. A fix with no handler here,
  or one that raises, is recorded as missing and the ladder moves on.
"""
from __future__ import annotations

import copy
import json
import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from . import storage

FORMAT = "retry-job@1"
MAX_ATTEMPTS = 16

FIXES: dict[str, dict[str, Any]] = {
    "wait": {"label": "waiting for the lock", "done": "waited for the lock", "delayMs": 2000},
    "clear-stale-lock": {"label": "clearing stale lock", "done": "cleared a stale lock"},
    "restart-store-writer": {"label": "restarting the store writer", "done": "restarted the store writer"},
    "retry": {"label": "retrying", "done": "retried", "delayMs": 1000},
    "wake-console": {"label": "waking the console via AmberX", "done": "asked AmberX to open the console"},
    "other-console": {"label": "sending to another open console", "done": "sent to another open console"},
    "queue-next-console": {"label": "queueing for the next console that opens", "done": "queued for the next console"},
    "refresh-token": {"label": "refreshing the token", "done": "refreshed the token"},
    "next-subscription": {"label": "switching to the next working subscription", "done": "switched subscription"},
    "api-key": {"label": "switching to an API key", "done": "switched to an API key"},
    "backoff": {"label": "backing off", "done": "backed off", "delayMs": 5000},
    "other-route": {"label": "retrying on another account or route", "done": "retried on another account or route"},
    "longer-timeout": {"label": "retrying with a longer timeout", "done": "retried with a longer timeout"},
    "background-job": {"label": "running it as a background job", "done": "ran it as a background job"},
    "reload-state": {"label": "reloading state from the server", "done": "reloaded state from the server"},
    "health-check": {"label": "health-checking the service", "done": "health-checked the service"},
    "restart-container": {"label": "restarting the container via Coolify", "done": "restarted the container via Coolify"},
    "internal-address": {"label": "retrying via the internal address", "done": "retried via the internal address"},
    "reread-schema": {"label": "re-reading the tool schema and fixing the arguments", "done": "re-read the schema and fixed the arguments"},
}

KINDS: dict[str, dict[str, Any]] = {
    "store-locked": {"label": "store locked", "ladder": ["wait", "clear-stale-lock", "restart-store-writer"]},
    "console-asleep": {"label": "console asleep", "ladder": ["retry", "wake-console", "other-console", "queue-next-console"]},
    "auth": {"label": "login or account limit", "ladder": ["refresh-token", "next-subscription", "api-key"]},
    "rate-limit": {"label": "rate limit or server error", "ladder": ["backoff", "other-route"]},
    "timeout": {"label": "timeout", "ladder": ["longer-timeout", "background-job"]},
    "stale-state": {"label": "stale state", "ladder": ["reload-state", "retry"]},
    "service-down": {"label": "service down", "ladder": ["health-check", "restart-container", "retry"]},
    "network": {"label": "network", "ladder": ["retry", "internal-address"]},
    "validation": {"label": "bad arguments", "ladder": ["reread-schema"]},
    "permanent": {"label": "permanent error", "ladder": []},
}


def _has(s: str, *words: str) -> bool:
    return any(w in s for w in words)


def classify(err: Any) -> str:
    """The failure kind of {code?, status?, message?} (or a string, or an exception). Same rules and order as the JS."""
    if isinstance(err, BaseException):
        err = {"code": getattr(err, "code", "") or type(err).__name__, "status": getattr(err, "status", 0), "message": str(err)}
    e: dict[str, Any] = {"message": err} if isinstance(err, str) else (err or {})
    code = str(e.get("code") or "").lower()
    try:
        status = int(e.get("status") or 0)
    except (TypeError, ValueError):
        status = 0
    msg = f"{code} {e.get('message') or ''}".lower()
    if code == "store_locked" or _has(msg, "store is locked", "store locked", "storelocked", "database is locked", ".lock)"):
        return "store-locked"
    if _has(code, "no_console", "console_asleep", "console_offline", "not_delivered") or _has(msg, "no console open", "console is asleep", "console asleep", "no open console", "console disconnected"):
        return "console-asleep"
    if status == 429 or _has(code, "rate_limit", "rate_limited") or _has(msg, "rate limit", "too many requests", "overloaded"):
        return "rate-limit"
    if status == 401 or _has(code, "unauthorized", "token_expired", "auth", "quota", "usage_limit") or _has(msg, "token expired", "expired token", "invalid token", "login expired", "not logged in", "usage limit", "account limit", "credit balance"):
        return "auth"
    if status in (408, 504) or _has(code, "timeout", "timed_out", "etimedout") or _has(msg, "timed out", "timeout"):
        return "timeout"
    if _has(code, "enotfound", "eai_again", "econnreset", "ehostunreach", "enetunreach") or _has(msg, "enotfound", "eai_again", "econnreset", "getaddrinfo", "name resolution", "network is unreachable", "socket hang up", "name or service not known"):
        return "network"
    if status in (502, 503) or _has(code, "econnrefused", "service_down", "unavailable") or _has(msg, "econnrefused", "connection refused", "service unavailable", "bad gateway"):
        return "service-down"
    if status == 409 or _has(code, "stale", "conflict", "rev_mismatch") or _has(msg, "stale", "out of date", "rev mismatch", "changed since"):
        return "stale-state"
    if status >= 500:
        return "rate-limit"
    if status == 422 or _has(code, "validation", "invalid_args", "invalid_params") or _has(msg, "validation error", "invalid arguments", "missing required"):
        return "validation"
    return "permanent"


def transient(err: Any) -> bool:
    return classify(err) != "permanent"


def _message(err: Any) -> str:
    if isinstance(err, str):
        m = err
    elif isinstance(err, BaseException):
        m = str(err) or type(err).__name__
    else:
        m = str((err or {}).get("message") or (err or {}).get("code") or "failed")
    return m[:300]


def new_job(id: str, title: str, source: str = "", now: str = "") -> dict[str, Any]:
    return {"$axf": FORMAT, "id": id, "title": str(title), "source": str(source), "status": "retrying", "kind": "", "error": "",
            "attempts": [], "tried": {}, "missing": [], "createdAt": now, "updatedAt": now}


def next_fix(job: dict[str, Any], kind: str) -> str | None:
    tried = (job.get("tried") or {}).get(kind) or []
    return next((f for f in KINDS.get(kind, {}).get("ladder", []) if f not in tried), None)


def on_failure(job0: dict[str, Any], err: Any, now: str) -> tuple[dict[str, Any], dict[str, Any] | None]:
    job = copy.deepcopy(job0)
    kind = classify(err)
    message = _message(err)
    job["kind"], job["error"], job["updatedAt"] = kind, message, now
    fix = None if len(job["attempts"]) >= MAX_ATTEMPTS else next_fix(job, kind)
    if not fix:
        job["status"] = "failed" if kind == "permanent" else "gave-up"
        job["fyi"] = fyi_text(job)
        return job, None
    ladder = KINDS[kind]["ladder"]
    job["tried"][kind] = [*(job["tried"].get(kind) or []), fix]
    step = ladder.index(fix) + 1
    job["attempts"].append({"n": len(job["attempts"]) + 1, "at": now, "kind": kind, "fix": fix, "step": step, "of": len(ladder), "ok": False, "error": message})
    job["status"] = "retrying"
    return job, {"fix": fix, "step": step, "of": len(ladder), "delayMs": FIXES[fix].get("delayMs", 0)}


def fix_unavailable(job0: dict[str, Any], fix: str, why: str, now: str) -> dict[str, Any]:
    job = copy.deepcopy(job0)
    a = next((x for x in reversed(job["attempts"]) if x["fix"] == fix), None)
    if a is not None:
        a["note"] = f"not done: {why}"
    line = f"{FIXES.get(fix, {}).get('label', fix)}: {why}"
    if line not in job["missing"]:
        job["missing"].append(line)
    job["updatedAt"] = now
    return job


def on_success(job0: dict[str, Any], now: str) -> dict[str, Any]:
    job = copy.deepcopy(job0)
    if job["attempts"]:
        job["attempts"][-1]["ok"] = True
    job["status"], job["updatedAt"], job["error"] = "fixed", now, ""
    return job


def step_text(job: dict[str, Any]) -> str:
    a = job["attempts"][-1] if job["attempts"] else None
    label = KINDS.get(job["kind"], {}).get("label", job["kind"])
    if job["status"] == "fixed":
        return f"fixed: {FIXES.get(a['fix'], {}).get('done', a['fix'])}" if a else "worked first time"
    if job["status"] == "failed":
        return f"{label}: not retried ({job['error']})"
    if job["status"] == "gave-up":
        n = len(job["attempts"])
        return f"{label}: gave up after {n} fix{'' if n == 1 else 'es'}"
    if not a:
        return "starting"
    return f"{KINDS.get(a['kind'], {}).get('label', a['kind'])}: {FIXES.get(a['fix'], {}).get('label', a['fix'])}, step {a['step']} of {a['of']}"


def fyi_text(job: dict[str, Any]) -> str:
    tried = [FIXES.get(a["fix"], {}).get("done", a["fix"]) for a in job["attempts"]]
    if job["status"] == "failed" or job["kind"] == "permanent":
        head = f"{job['title']} failed: {job['error']}. Not retried (a permanent error)."
    else:
        head = f"{job['title']} still fails after every automatic fix ({KINDS.get(job['kind'], {}).get('label', job['kind'])}): {job['error']}."
    parts = [head, f"Tried: {', '.join(tried)}." if tried else "", f"Missing: {'; '.join(job['missing'])}." if job["missing"] else ""]
    return " ".join(p for p in parts if p)


def log_line(job: dict[str, Any], a: dict[str, Any]) -> str:
    note = f" ({a['note']})" if a.get("note") else ""
    return f"{job['title']}: {KINDS.get(a['kind'], {}).get('label', a['kind'])} ({a['error']}); {FIXES.get(a['fix'], {}).get('label', a['fix'])}, step {a['step']} of {a['of']}{note}"


def view(all_jobs: list[dict[str, Any]], limit: int = 100) -> dict[str, Any]:
    jobs = [j for j in all_jobs if j.get("status") != "dismissed"]
    rank = {"retrying": 0, "gave-up": 1, "failed": 2, "fixed": 3}
    # newest change first inside each status (a stable two-pass sort = the JS comparator)
    ordered = sorted(sorted(jobs, key=lambda j: str(j.get("updatedAt", "")), reverse=True), key=lambda j: rank.get(j["status"], 9))
    rows = [{"id": j["id"], "title": j["title"], "source": j["source"], "status": j["status"], "kind": j["kind"], "error": j["error"], "now": step_text(j),
             "attempts": len(j["attempts"]), "missing": j["missing"], "updatedAt": j["updatedAt"], "note": j.get("note", "")} for j in ordered[:limit]]
    return {"count": sum(1 for j in jobs if j["status"] in ("retrying", "gave-up")), "retrying": sum(1 for j in jobs if j["status"] == "retrying"),
            "gaveUp": sum(1 for j in jobs if j["status"] == "gave-up"), "rows": rows}


# ---------------------------------------------------------------------- runner (IO)

def _iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def default_dir() -> Path:
    """AXF_RETRY_DIR, else the project's shared data (AXF_DATA_DIR, /projects/<project>/_data) /auto-fixes, else
    <AXF_ROOT>/.axf-console/auto-fixes. The Node runner (framework/cli/retry-runner.mjs) picks the same folder."""
    if os.environ.get("AXF_RETRY_DIR"):
        return Path(os.environ["AXF_RETRY_DIR"])
    d = os.environ.get("AXF_DATA_DIR")
    if d and d != "off":
        return Path(d) / "auto-fixes"
    projects = Path(os.environ.get("AXHUB_PROJECTS_DIR") or "/projects")
    if d is None and projects.is_dir():
        return projects / (os.environ.get("AXF_PROJECT") or "amberx-axf") / "_data" / "auto-fixes"
    return Path(os.environ.get("AXF_ROOT") or Path(__file__).resolve().parents[3]) / ".axf-console" / "auto-fixes"


_ID = re.compile(r"^[a-z0-9-]{4,80}$")
Fix = Callable[[dict[str, Any], dict[str, Any]], Any]


class Runner:
    """Runs calls through the ladder and keeps the ledger. Thread-safe; one file per job."""

    def __init__(self, dir: str | os.PathLike[str] | None = None, *, fixes: dict[str, Fix] | None = None,
                 on_change: Callable[[dict[str, Any]], None] | None = None, on_fyi: Callable[[dict[str, Any]], None] | None = None,
                 sleep: Callable[[float], None] = time.sleep, delay_scale: float = 1.0) -> None:
        self.dir = Path(dir) if dir else default_dir()
        self.fixes = dict(fixes or {})
        self.on_change, self.on_fyi = on_change, on_fyi
        self.sleep, self.delay_scale = sleep, delay_scale
        self._threads: dict[str, threading.Thread] = {}

    # ledger
    def _file(self, id: str) -> Path:
        return self.dir / "jobs" / f"{id}.json"

    def save(self, job: dict[str, Any]) -> None:
        storage.write_json(self._file(job["id"]), job, indent=None)
        if self.on_change:
            try:
                self.on_change(job)
            except Exception:  # noqa: BLE001 — a listener never stops a retry
                pass

    def get(self, id: str) -> dict[str, Any] | None:
        if not _ID.match(id):
            return None
        j = storage.read_json(self._file(id), None)
        return j if isinstance(j, dict) and j.get("$axf") == FORMAT else None

    def jobs(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for f in sorted((self.dir / "jobs").glob("*.json")) if (self.dir / "jobs").is_dir() else []:
            try:
                j = json.loads(f.read_text())
            except (OSError, ValueError):
                continue
            if isinstance(j, dict) and j.get("$axf") == FORMAT:
                out.append(j)
        return out

    # running
    def run(self, title: str, call: Callable[[dict[str, Any]], Any], *, source: str = "", ctx: dict[str, Any] | None = None,
            ok: Callable[[Any], Any] | None = None, id: str = "", fixes: dict[str, Fix] | None = None) -> tuple[dict[str, Any], Any]:
        """Call until it works or the ladder is done. `call(ctx)` returns a result or raises; `ok(result)` returns None for
        success or the error ({code, status, message}) when a returned result is a failure. `fixes` add to (and win over)
        the runner's own handlers for this call. Returns (job, last result)."""
        ctx = ctx if ctx is not None else {}
        handlers = {**self.fixes, **(fixes or {})}
        job = new_job(id or f"{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(3)}", title, source, _iso())
        result: Any = None
        while True:
            err: Any = None
            try:
                result = call(ctx)
                err = ok(result) if ok else None
            except Exception as e:  # noqa: BLE001 — every failure goes through the ladder
                err, result = e, None
            if err is None:
                if job["attempts"]:  # only calls that needed a fix are kept in the ledger
                    job = on_success(job, _iso())
                    self.save(job)
                return job, result
            job, nxt = on_failure(job, err, _iso())
            if nxt is None:
                # a permanent error the caller sees is theirs to handle; once the caller has gone (or never waited) it is logged + FYI'd
                if ctx.get("_detached"):
                    job["detached"] = True
                if job["attempts"] or job["status"] == "gave-up" or job.get("detached"):
                    self.save(job)
                    if self.on_fyi:
                        try:
                            self.on_fyi(job)
                        except Exception:  # noqa: BLE001
                            pass
                return job, result
            self.save(job)
            self._apply(job, nxt, ctx, handlers)

    def _apply(self, job: dict[str, Any], nxt: dict[str, Any], ctx: dict[str, Any], handlers: dict[str, Fix]) -> None:
        fix = nxt["fix"]
        if nxt.get("delayMs"):
            self.sleep(nxt["delayMs"] / 1000 * self.delay_scale)
        handler = handlers.get(fix)
        if handler is None and fix in ("wait", "retry", "backoff"):
            return
        if handler is None and fix == "longer-timeout":
            ctx["timeout"] = float(ctx.get("timeout") or 30) * 3
            return
        if handler is None:
            job.update(fix_unavailable(job, fix, "no automatic fix for this here", _iso()))
            self.save(job)
            return
        try:
            handler(ctx, job)
        except Exception as e:  # noqa: BLE001
            job.update(fix_unavailable(job, fix, str(e)[:200] or type(e).__name__, _iso()))
            self.save(job)

    def submit(self, title: str, call: Callable[[dict[str, Any]], Any], *, source: str = "", ctx: dict[str, Any] | None = None,
               ok: Callable[[Any], Any] | None = None, fixes: dict[str, Fix] | None = None) -> tuple[str, threading.Event, dict[str, Any]]:
        """The same as run() on a daemon thread, independent of the caller: returns (job id, done event, box) at once;
        box["job"], box["result"] are set when it ends. The caller may wait on the event or go away."""
        id = f"{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(3)}"
        done, box = threading.Event(), {}

        def go() -> None:
            try:
                box["job"], box["result"] = self.run(title, call, source=source, ctx=ctx, ok=ok, id=id, fixes=fixes)
            finally:
                done.set()
                self._threads.pop(id, None)

        t = threading.Thread(target=go, name=f"retry-{id}", daemon=True)
        self._threads[id] = t
        t.start()
        return id, done, box

    def prune(self, keep_days: float = 7.0) -> int:
        """Drop fixed/failed jobs older than keep_days (gave-up jobs stay until dismissed)."""
        n, cutoff = 0, time.time() - keep_days * 86400
        for j in self.jobs():
            if j["status"] in ("fixed", "failed", "dismissed") and self._file(j["id"]).stat().st_mtime < cutoff:
                self._file(j["id"]).unlink(missing_ok=True)
                n += 1
        return n

    def dismiss(self, id: str) -> bool:
        j = self.get(id)
        if not j:
            return False
        j["status"], j["updatedAt"] = "dismissed", _iso()
        self.save(j)
        return True
