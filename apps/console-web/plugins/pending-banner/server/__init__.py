"""Pending banner — server part. Mounted at /api/plugins/pending-banner/ (console token on every method, 404 while the
plugin is off). Every build waiting in Pending, and the moves Brett makes on them, without opening the orchestrator.

    GET  /list                          every Pending build: title, what it does (plain words), priority, steps done /
                                        total, why it is in Pending (fell back from a run, sign-in failure, new), and the
                                        actions it offers. {rows, count, at}
    POST /queue    {ids: [...] | all}   Pending → Queue (all = every Pending build: "Send all to Queue")
    POST /hold     {ids: [...]}         Pending → Queue, on hold (keeps its place; the dispatcher skips it until released)
    POST /archive  {ids: [...]}         Pending → Archive

Every change goes through the orchestrator's dispatcher CLI (build-orchestrator/pipeline.mjs), so the banner, the
orchestrator's Pending tab, the CLI and MCP share one set of rules and one store. Many ids at once: each one is checked
on its own and one refused build never stops the others ({done, refused}).

When a build lands in Pending (new, or fallen back from a run) a background check raises one alert per build
(source `pending-banner`, key `pending-banner:landed:<id>`, notify type `pending.landed`), which the alert hub pushes
to AmberX under the Notifications panel's rules; it resolves by itself once the build leaves Pending. The first check
after a fresh install only records what is already there, so an install never buzzes the phone with the whole list.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import console_context as cx

router = APIRouter()

PLUGIN_DIR = Path(__file__).resolve().parents[1]
ROOT = PLUGIN_DIR.parents[3]  # the repo root (plugins/<folder> → plugins → console-web → apps → root)
PIPELINE = ROOT / "apps" / "console-web" / "plugins" / "build-orchestrator" / "pipeline.mjs"
ALERT_SOURCE = "pending-banner"
ALERT_PREFIX = "pending-banner:landed:"
ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$")
MAX_IDS = 200
CHECK_S = 60
CACHE_S = 5
AGENT_HEADERS = ("x-axhub-session", "x-axhub-source")
# Notes the orchestrator writes when a build goes (back) to Pending: the latest one says why it is there.
FALLBACK_NOTE = re.compile(r"(back to pending|back in pending|held in pending|in pending|returned|fell back|stopped early|ran out|usage limit|session ended|paused|no live session)", re.I)


def data_dir() -> Path:
    return Path(os.environ.get("AXF_PENDING_BANNER_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "pending-banner"))


def store_file() -> Path:
    return Path(os.environ.get("AXF_BUILDS_STORE") or (ROOT / "_claude" / "builds" / "store.json"))


def _text(v: Any, n: int = 300) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()[:n]


def who(request: Request) -> str:
    """Who moved it, for the build's note: the signed-in hub user's name on a click, else the caller's source header
    (MCP, voice, CLI), else 'console'."""
    c = getattr(request.state, "axf_user", None)
    name = str(getattr(c, "name", "") or "") if c is not None and getattr(c, "via", "token") == "session" else ""
    for h in AGENT_HEADERS:
        v = (request.headers.get(h) or "").strip()
        if v and v != "console":
            return _text(f"{name + ' via ' if name else ''}{v}", 80)
    return _text(name or "console", 80)


def pipeline(*args: str) -> dict[str, Any]:
    """Run the dispatcher CLI with --json; raise an HTTP error with its plain message when it refuses."""
    env = {k: v for k, v in os.environ.items() if k not in ("AXF_APPROVER", "AXF_APPROVER_VIA")}
    proc = subprocess.run(["node", str(PIPELINE), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=120, env=env)
    out = proc.stdout.strip().splitlines()
    try:
        res = json.loads(out[-1]) if out else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        res = {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}
    if not res.get("ok"):
        err = str(res.get("error") or "pipeline failed")
        raise HTTPException(404 if "no build" in err else 400, err[:400])
    return res


def _store_builds() -> dict[str, dict[str, Any]]:
    try:
        data = json.loads(store_file().read_text())
    except (OSError, ValueError):
        return {}
    return {str(b.get("id")): b for b in data.get("builds", []) if isinstance(b, dict) and b.get("id")}


def what_it_does(row: dict[str, Any], build: dict[str, Any]) -> str:
    """One plain line: Brett's own words when the build has them, else the first sentence of its detail, else the next step."""
    said = _text(row.get("said") or (build.get("origin") or {}).get("said"), 240)
    if said:
        return said
    detail = _text(build.get("detail"), 600)
    if detail:
        first = re.split(r"(?<=[.!?])\s", detail, maxsplit=1)[0]
        return first[:240]
    return _text(row.get("nextStep"), 240)


def why_pending(row: dict[str, Any], build: dict[str, Any]) -> dict[str, str]:
    """Why it is in Pending: {kind: fell-back | new, text}. A build that ran before and came back says how (the last run's
    outcome and the orchestrator's latest note on it); one that never ran is new and waits for its first Queue."""
    p = row.get("pipeline") or {}
    last = p.get("lastRun") or None
    notes = [n for n in (build.get("notes") or []) if isinstance(n, dict) and n.get("text")]
    note = next((n for n in reversed(notes) if FALLBACK_NOTE.search(str(n.get("text")))), None)
    done = int((row.get("steps") or {}).get("done") or 0)
    if last or (note and done):
        parts = []
        if last:
            left = int(last.get("stepsLeft") or 0)
            account = _text(last.get("account"), 60)
            on = f" on {account}" if account else ""
            rest = f" with {left} step{'' if left == 1 else 's'} left" if left else ""
            parts.append(f"Last run {last.get('outcome') or 'ended'}{on}{rest}.")
        if note:
            parts.append(_text(note.get("text"), 300))
        return {"kind": "fell-back", "text": " ".join(parts)[:400], "at": str((last or {}).get("at") or (note or {}).get("at") or "")}
    if done:  # it ran before (steps are ticked) but left no run record or note saying how it came back
        total = int((row.get("steps") or {}).get("total") or 0)
        return {"kind": "fell-back", "text": f"Stopped with {done} of {total} steps done; no note on why.", "at": str(row.get("updatedAt") or "")}
    return {"kind": "new", "text": "New: waiting for its first trip to the Queue.", "at": str(row.get("createdAt") or "")}


def shape(row: dict[str, Any], build: dict[str, Any]) -> dict[str, Any]:
    steps = row.get("steps") or {}
    return {
        "id": row.get("id"),
        "title": _text(row.get("title"), 300),
        "what": what_it_does(row, build),
        "priority": _text(row.get("priority"), 20),
        "done": int(steps.get("done") or 0),
        "total": int(steps.get("total") or 0),
        "minutesLeft": int(row.get("minutesLeft") or 0),
        "nextModel": _text(row.get("nextModel"), 20),
        "needsSplit": bool(row.get("needsSplit")),
        "why": why_pending(row, build),
        "createdAt": str(row.get("createdAt") or ""),
        "updatedAt": str(row.get("updatedAt") or ""),
        "actions": ["queue", "hold", "archive", "open"],
    }


_cache: dict[str, Any] = {"at": 0.0, "value": None}
_lock = threading.Lock()


def pending_list(fresh: bool = False) -> dict[str, Any]:
    with _lock:
        if not fresh and _cache["value"] is not None and time.time() - _cache["at"] < CACHE_S:
            return _cache["value"]
    rows = pipeline("tab", "pending").get("rows") or []
    builds = _store_builds()
    out = [shape(r, builds.get(str(r.get("id")), {})) for r in rows if isinstance(r, dict) and r.get("id")]
    value = {"rows": out, "count": len(out), "at": int(time.time() * 1000)}
    with _lock:
        _cache.update(at=time.time(), value=value)
    return value


def _forget() -> None:
    with _lock:
        _cache.update(at=0.0, value=None)


def _ids(body: dict[str, Any], allow_all: bool) -> list[str]:
    if allow_all and body.get("all") is True:
        return [str(r["id"]) for r in pending_list(fresh=True)["rows"]]
    raw = body.get("ids")
    ids = raw if isinstance(raw, list) else [body.get("id")] if body.get("id") else []
    ids = [str(x or "").strip() for x in ids[:MAX_IDS]]
    if not ids:
        raise HTTPException(400, "no build id given (ids: [...]" + (", or all: true)" if allow_all else ")"))
    bad = [x for x in ids if not ID_RE.match(x)]
    if bad:
        raise HTTPException(400, f"bad build id: {bad[0][:80]}")
    return list(dict.fromkeys(ids))


async def _body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > 64 * 1024:
        raise HTTPException(413, "body too large")
    try:
        b = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(400, "body is not JSON")
    if not isinstance(b, dict):
        raise HTTPException(400, "body is a JSON object")
    return b


def _queue(ids: list[str], by: str) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    done: list[dict[str, Any]] = []
    refused: list[dict[str, str]] = []
    for i in ids:
        try:
            pipeline("queue", i, "--by", by)
            done.append({"id": i, "status": "queued", "tab": "queue"})
        except HTTPException as e:
            refused.append({"id": i, "error": str(e.detail)})
    return done, refused


def _result(action: str, done: list[dict[str, Any]], refused: list[dict[str, str]]) -> dict[str, Any]:
    _forget()
    resolve_landed([d["id"] for d in done])
    left = pending_list(fresh=True)["count"]
    line = f"{action}: {len(done)} done" + (f", {len(refused)} refused" if refused else "") + f"; {left} left in Pending"
    return {"ok": True, "action": action, "done": done, "refused": refused, "pending": left, "line": line}


@router.get("/list")
def get_list(fresh: bool = False) -> dict[str, Any]:
    """Every build in Pending, newest move first as the orchestrator orders them."""
    return pending_list(fresh=fresh)


@router.post("/queue")
async def post_queue(request: Request) -> dict[str, Any]:
    """{ids: [...]} or {all: true}: Pending → Queue. The dispatcher starts each when a slot and an account are free."""
    body = await _body(request)
    done, refused = _queue(_ids(body, allow_all=True), who(request))
    return _result("queue", done, refused)


@router.post("/hold")
async def post_hold(request: Request) -> dict[str, Any]:
    """{ids: [...], why?}: Pending → Queue on hold. It keeps its place; the dispatcher skips it until released."""
    body = await _body(request)
    by = who(request)
    done, refused = _queue(_ids(body, allow_all=False), by)
    if done:
        args = ["hold", *[d["id"] for d in done], "--by", by]
        why = _text(body.get("why"), 300)
        if why:
            args += ["--why", why]
        res = pipeline(*args)
        refused += [{"id": str(r.get("id")), "error": str(r.get("error"))} for r in res.get("refused") or []]
        done = [{**d, "held": True} for d in res.get("done") or []]
    return _result("hold", done, refused)


@router.post("/archive")
async def post_archive(request: Request) -> dict[str, Any]:
    """{ids: [...], why?}: Pending → Archive (restorable from the orchestrator's Archive tab)."""
    body = await _body(request)
    args = ["archive", *_ids(body, allow_all=False), "--by", who(request)]
    why = _text(body.get("why"), 300)
    if why:
        args += ["--why", why]
    res = pipeline(*args)
    return _result("archive", list(res.get("done") or []), [{"id": str(r.get("id")), "error": str(r.get("error"))} for r in res.get("refused") or []])


# ------------------------------------------------------------------ AmberX: a push when a build lands in Pending

def _seen_file() -> Path:
    return data_dir() / "seen.json"


def _load_seen() -> set[str] | None:
    try:
        return set(json.loads(_seen_file().read_text()).get("ids") or [])
    except (OSError, ValueError):
        return None


def _save_seen(ids: set[str]) -> None:
    try:
        data_dir().mkdir(parents=True, exist_ok=True)
        _seen_file().write_text(json.dumps({"ids": sorted(ids), "at": int(time.time())}))
    except OSError:
        pass


def landed_alert(r: dict[str, Any], count: int) -> dict[str, Any]:
    why = r["why"]
    fell = why["kind"] == "fell-back"
    return {
        "source": ALERT_SOURCE,
        "key": ALERT_PREFIX + str(r["id"]),
        "severity": "warning" if fell else "info",
        "title": f"{'Back in Pending' if fell else 'New in Pending'}: {r['title']}"[:160],
        "body": "\n".join(x for x in [r["what"], why["text"] if fell else "", f"Steps {r['done']}/{r['total']}" + (f" · {r['priority']}" if r["priority"] else ""), f"{count} build{'' if count == 1 else 's'} in Pending: queue from the Pending banner."] if x)[:1500],
        "link": f"action:pending-banner.open:{r['id']}",
        "meta": {"kind": "pending", "build": str(r["id"]), "fellBack": fell},
    }


def resolve_landed(ids: list[str]) -> None:
    if ids:
        try:
            cx.resolve_alerts([ALERT_PREFIX + i for i in ids])
        except Exception:  # noqa: BLE001 — the alert hub may be off; the move itself already happened
            pass


def check_landed() -> dict[str, Any]:
    """One pass: alert for every build new in Pending since the last pass, resolve the ones that left."""
    rows = pending_list(fresh=True)["rows"]
    now = {str(r["id"]) for r in rows}
    seen = _load_seen()
    if seen is None:  # first pass after an install: record what is there, alert nothing
        _save_seen(now)
        return {"seeded": len(now), "raised": [], "resolved": []}
    raised = [r for r in rows if str(r["id"]) not in seen]
    for r in raised:
        try:
            cx.raise_alert(landed_alert(r, len(rows)))
        except Exception:  # noqa: BLE001
            pass
    gone = sorted(seen - now)
    resolve_landed(gone)
    _save_seen(now)
    return {"raised": [r["id"] for r in raised], "resolved": gone}


@router.post("/check")
def post_check() -> dict[str, Any]:
    """Run the landed-in-Pending check now (it runs by itself every minute)."""
    return {"ok": True, **check_landed()}


def _loop() -> None:
    while True:
        time.sleep(CHECK_S)
        try:
            check_landed()
        except Exception:  # noqa: BLE001 — a failed pass tries again next minute
            pass


if os.environ.get("AXF_PENDING_BANNER_NO_WATCH") != "1":
    threading.Thread(target=_loop, name="pending-banner-watch", daemon=True).start()
