"""Build manager (server part). Mounted at /api/plugins/build-manager/ (console token on every route, 404 when off,
never on the console MCP).

  GET  live            what's in progress right now, from the activity feed (capability ``axf.activity@1``, looked up at
                       request time, so this works with or without the Activity plugin and never names it):
                       {available, items: [activity@1 items: running ones + the ones that finished in the last few minutes]}
  GET  changes         the build log (capability ``axf.changes@1``: every change-log@1 entry from every session on every
                       machine, with build stats) → {available, stamp, items: [summaries]}. `?since=<stamp>` answers
                       {same: true} when nothing changed (cheap polling).
  GET  events          server-sent events: `changed` {stamp} whenever the build log changes (checked every 2 s on the
                       shared folder, which every surface writes through axHub), plus a heartbeat; the browser refetches.
  POST start           {key, dryRun?} "Send to queue" (orchestrate.mjs plans it: dependency closure, queue reorder,
                       overlap guard, model, brief), then files it with the Build orchestrator (capability
                       ``axf.build-dispatch@1``) straight into its Queue. The orchestrator's dispatcher is the only thing
                       that starts builds (Brett, Nov 9 2026); the Build manager only tracks them. dryRun returns the plan only.
  GET  jobs            the start jobs (state, approval link, command, plan, verify result)
  POST abandon        {changeId} the trash can on a stuck live build (no word for 10 min, or running 30+ min): the build
                       log (axf.changes@1) finishes it as failed (stalled) and closes it on every device
  POST verify          {changeId} run the repo's checks for the areas a finished build touched + its branch's CI (via
                       lib-github), and mark the entry verified / broken (never merges)

The build list itself (pending list, build queue, plan) comes from the console's own read routes and is merged in the
browser by web/merge.mjs; the Live and Built views come from web/history.mjs over `changes`.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

import console_context as cx
import plugin_services

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
HERE = Path(__file__).resolve().parents[1]
ACTIVITY = "axf.activity@1"
CHANGES = "axf.changes@1"
DISPATCH = "axf.build-dispatch@1"
RECENT_S = 10 * 60  # finished items older than this aren't news for the tracker
ACTIVE = ("queued", "running", "waiting")
KEEP = ("id", "source", "kind", "title", "detail", "state", "progress", "startedAt", "updatedAt", "finishedAt", "url", "by", "steps")
_KEY = re.compile(r"^(pending|queue|plan):[A-Za-z0-9._-]{1,120}$")
_CID = re.compile(r"^chg-\d{8}-[0-9a-f]{6,16}$")


def _clean(it: Any) -> dict[str, Any] | None:
    if not isinstance(it, dict) or not it.get("id") or not it.get("title"):
        return None
    return {k: it[k] for k in KEEP if k in it}


@router.get("/live")
def live() -> dict[str, Any]:
    svc = plugin_services.get(ACTIVITY)
    if svc is None:
        return {"available": False, "items": [], "checkedAt": int(time.time() * 1000)}
    try:
        raw = svc.items() or []
    except Exception as e:  # noqa: BLE001 — the feed failing must not break the build list
        return {"available": True, "items": [], "error": str(e)[:160], "checkedAt": int(time.time() * 1000)}
    now = time.time() * 1000
    out = []
    for it in raw:
        c = _clean(it)
        if not c:
            continue
        if c.get("state") not in ACTIVE and now - float(c.get("finishedAt") or c.get("updatedAt") or 0) > RECENT_S * 1000:
            continue
        out.append(c)
    return {"available": True, "items": out[:100], "checkedAt": int(now)}


# ---------------------------------------------------------------- the build log (every session, through axHub)

def _changes_svc() -> Any | None:
    svc = plugin_services.get(CHANGES)
    return svc if svc is not None and hasattr(svc, "summaries") else None


def _stamp(svc: Any) -> str:
    try:
        return str(svc.stamp())
    except Exception:  # noqa: BLE001
        return ""


@router.get("/changes")
def changes(since: str = "") -> dict[str, Any]:
    svc = _changes_svc()
    if svc is None:
        return {"available": False, "items": [], "stamp": ""}
    stamp = _stamp(svc)
    if since and since == stamp:
        return {"available": True, "same": True, "stamp": stamp}
    try:
        items = svc.summaries()
    except Exception as e:  # noqa: BLE001
        return {"available": True, "items": [], "stamp": stamp, "error": str(e)[:160]}
    return {"available": True, "items": items[:2000], "stamp": stamp, "checkedAt": int(time.time() * 1000)}


EVENT_EVERY_S = 2.0
EVENT_BEAT_S = 20.0
EVENT_MAX_S = 30 * 60  # the browser reconnects after this


@router.get("/events")
async def events(request: Request) -> StreamingResponse:
    """Real time: the build log changes when any session (any machine, through axHub) writes an entry; this notices
    within ~2 s and tells the browser, which refetches `changes`. (axHub's /data-events watches single documents, not
    a folder, so the console watches the shared folder it mounts instead.)"""
    svc = _changes_svc()

    async def gen():
        last = _stamp(svc) if svc else ""
        yield f"retry: 3000\nevent: ready\ndata: {json.dumps({'stamp': last, 'available': svc is not None})}\n\n"
        start = beat = time.monotonic()
        while time.monotonic() - start < EVENT_MAX_S:
            if await request.is_disconnected():
                return
            await asyncio.sleep(EVENT_EVERY_S)
            s = _changes_svc()
            cur = await asyncio.to_thread(_stamp, s) if s else ""
            if cur != last:
                last = cur
                yield f"event: changed\ndata: {json.dumps({'stamp': cur})}\n\n"
            elif time.monotonic() - beat > EVENT_BEAT_S:
                beat = time.monotonic()
                yield f": hb {int(time.time())}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------- Start build now

def _node(script: str, payload: dict[str, Any], timeout: int = 60) -> dict[str, Any]:
    p = subprocess.run(["node", str(HERE / script)], input=json.dumps(payload), capture_output=True, text=True, timeout=timeout, cwd=str(cx.ROOT))
    try:
        return json.loads(p.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise HTTPException(500, f"planner failed: {(p.stderr or p.stdout)[-300:]}") from None


def _engine(op: str, **args: Any) -> dict[str, Any]:
    p = subprocess.run(["node", str(Path(cx.ROOT) / "framework/cli/engine-rpc.mjs"), json.dumps({"op": op, **args})], capture_output=True, text=True,
                       timeout=60, cwd=str(cx.ROOT))
    try:
        return json.loads(p.stdout)
    except ValueError:
        return {"ok": False, "error": (p.stderr or "no output")[-300:]}


class Jobs:
    """What Start did per build, for the page: sent to the orchestrator's Queue (its build id). The Build manager never
    launches anything (Brett, Nov 9 2026): the orchestrator's dispatcher starts every build."""

    def __init__(self) -> None:
        self.jobs: dict[str, dict[str, Any]] = {}
        self.lock = threading.Lock()

    def get(self, key: str) -> dict[str, Any] | None:
        with self.lock:
            j = self.jobs.get(key)
            return json.loads(json.dumps(j)) if j else None

    def all(self) -> list[dict[str, Any]]:
        with self.lock:
            return [json.loads(json.dumps(j)) for j in self.jobs.values()]

    def queued(self, key: str, plan: dict[str, Any], build_id: str) -> dict[str, Any]:
        with self.lock:
            self.jobs[key] = {"key": key, "state": "queued", "build": build_id,
                              "message": f"In the orchestrator's Queue as {build_id}: the dispatcher starts it when a slot and an account are free.",
                              "plan": {k: plan.get(k) for k in ("model", "branch", "areas", "deps", "order")}, "startedAt": int(time.time() * 1000)}
        return self.get(key) or {}


JOBS = Jobs()


def _update_change(cid: str, patch: dict[str, Any]) -> None:
    svc = plugin_services.get(CHANGES)
    if svc and cid:
        try:
            svc.update(cid, patch)
        except Exception:  # noqa: BLE001
            pass


def _finish_change(cid: str, state: str, summary: str) -> None:
    _update_change(cid, {"result": {"state": state, "summary": summary}})


def _inputs() -> dict[str, Any]:
    """What the planner needs: the plan, the queue, the pending list (same data the console reads) and the running entries."""
    def rd(rel: str, d: Any) -> Any:
        """The active build profile's copy (cx.data_path); a profile file not written yet = empty."""
        try:
            return json.loads(Path(cx.data_path(rel)).read_text())
        except (OSError, ValueError):
            return d

    svc = _changes_svc()
    summaries = svc.summaries() if svc else []
    try:
        report = f"node {svc.cli()}" if svc and hasattr(svc, "cli") else ""
    except Exception:  # noqa: BLE001
        report = ""
    return {"plan": rd("framework/plan/plan.json", {"features": []}), "queue": rd("framework/plan/build-queue.json", None),
            "pending": rd("framework/plan/pending.json", {"items": []}), "changes": summaries, "reportCmd": report}


@router.post("/start")
async def start(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(400, "send JSON") from None
    key = str((body or {}).get("key") or "")
    if not _KEY.match(key):
        raise HTTPException(400, "key is pending:<id>, queue:<epic> or plan:<feature>")
    dry = bool(body.get("dryRun"))
    cur = JOBS.get(key)
    if cur and cur["state"] == "queued" and not dry:
        return {"ok": True, "job": cur, "existing": True, "queued": True, "build": cur.get("build")}
    planned = await asyncio.to_thread(_node, "web/plan-cli.mjs", {**_inputs(), "key": key})
    if not planned.get("ok"):
        return {"ok": False, "plan": planned, "refuse": planned.get("refuse"), "wait": planned.get("wait")}
    if dry:
        return {"ok": True, "dryRun": True, "plan": planned}
    if planned.get("order"):
        _engine("build-reorder", order=planned["order"], by="build-manager:start")
    # One way to start builds (Brett, Nov 9 2026: "It has to be the orchestrator … Not the build manager"): Start sends
    # the build to the orchestrator's Queue; the dispatcher picks the account and model and launches it. Nothing here runs
    # the launcher; claude-headless.sh would refuse it anyway without the orchestrator's dispatch token.
    disp = plugin_services.get(DISPATCH)
    if not disp:
        return {"ok": False, "refuse": "The Build orchestrator is off: builds start only from its Queue. Turn it on in Settings → Plugins."}
    row = planned.get("row") or {}
    by = _who(request)
    try:
        r = await asyncio.to_thread(send_to_queue, disp, key, row, str(planned.get("brief") or ""), by)
    except Exception as e:  # noqa: BLE001
        msg = f"The orchestrator did not take it: {getattr(e, 'detail', None) or e}"[:400]
        cx.log("system", f"Build manager: Queue {key} refused ({by}): {msg}", "warn")
        return {"ok": False, "refuse": msg}
    JOBS.queued(key, planned, str(r.get("id") or ""))
    cx.log("system", f"Build manager: {key} → orchestrator {r.get('id')} ({r.get('how')}, {r.get('status')}) by {by}")
    return {"ok": True, "queued": True, "build": r.get("id"), "status": r.get("status"), "how": r.get("how"), "job": JOBS.get(key), "plan": planned}


def _who(request: Request) -> str:
    user = getattr(request.state, "axf_user", None)
    return str(getattr(user, "name", "") or "console")[:80]


def send_to_queue(disp: Any, key: str, row: dict[str, Any], brief: str, by: str) -> dict[str, Any]:
    """Put a row's build in the orchestrator's Queue → {id, status, how}. A row the orchestrator already has (a pending
    build has the same id there) is queued as itself; one it is already running or holding is left alone; only a row
    with no build behind it (a plan feature, a build-queue step) is filed as a new build. Filing a pending build again
    made a second copy and left the one on screen Pending."""
    bid = str(row.get("id") or key.split(":", 1)[1])
    have: dict[str, Any] = {}
    try:
        have = disp.build(bid) or {}
    except Exception as e:  # noqa: BLE001 — not found / not an orchestrator id: no build behind this row
        if getattr(e, "status_code", 404) not in (400, 404):
            raise  # the orchestrator failed: refuse rather than file a possible duplicate
        have = {}
    if have.get("id"):
        status = str(have.get("status") or "")
        if status == "pending" and not have.get("hidden"):
            q = disp.queue(have["id"], by=f"build-manager ({by})")
            return {"id": q.get("id") or have["id"], "status": q.get("status") or "queued", "how": "queued"}
        if status in ("queued", "running"):
            return {"id": have["id"], "status": status, "how": "already"}
        raise ValueError(f"{have['id']} is {status}{' (hidden)' if have.get('hidden') else ''}: only a Pending build can be queued")
    r = disp.request(str(row.get("title") or bid)[:300], brief[:8000], by=f"build-manager ({by})", source="build-manager", queue=True)
    return {"id": r.get("id"), "status": r.get("status"), "how": "filed"}


@router.get("/jobs")
def jobs() -> dict[str, Any]:
    return {"items": JOBS.all()}


@router.post("/abandon")
async def abandon(request: Request) -> dict[str, Any]:
    body = await request.json()
    cid = str((body or {}).get("changeId") or "")
    if not _CID.match(cid):
        raise HTTPException(400, "changeId is a change id")
    svc = plugin_services.get(CHANGES)
    if not svc or not callable(getattr(svc, "abandon", None)):
        raise HTTPException(409, "the build log can't take builds off yet (update the Codebase changes plugin)")
    if not svc.get(cid):
        raise HTTPException(404, "no entry with that id")
    e = await asyncio.to_thread(svc.abandon, cid, "build-manager")
    return {"changeId": cid, "closed": bool(e.get("closed")), "state": (e.get("result") or {}).get("state")}


@router.post("/verify")
async def verify(request: Request) -> dict[str, Any]:
    body = await request.json()
    cid = str((body or {}).get("changeId") or "")
    if not _CID.match(cid):
        raise HTTPException(400, "changeId is a change id")
    svc = plugin_services.get(CHANGES)
    e = svc.get(cid) if svc else None
    if not e:
        raise HTTPException(404, "no entry with that id")
    return await asyncio.to_thread(run_verify, e)


def ci_state(branch: str) -> str:
    """The branch's latest CI run on GitHub (lib-github): pass | fail | running | unknown."""
    if not branch:
        return "unknown"
    try:
        from axf_server.github import GitHubClient, run_state
        gh = GitHubClient(lambda: os.environ.get("GITHUB_TOKEN", ""), user_agent="axf-build-manager")
        if not gh.has_token():
            return "unknown"
        runs = gh.workflow_runs(cx.GITHUB_REPO or "MossesX/AmberX-AXF", branch=branch, per_page=5)
        if not runs:
            return "unknown"
        s = run_state(runs[0].get("status"), runs[0].get("conclusion"))
        return "pass" if s in ("success", "done", "passed") else "fail" if s in ("failure", "failed", "error") else "running" if s in ("queued", "running", "in_progress") else "unknown"
    except Exception:  # noqa: BLE001
        return "unknown"


def run_verify(e: dict[str, Any], runner: Callable[[str], int] | None = None, ci: Callable[[str], str] = ci_state) -> dict[str, Any]:
    """Run the checks for the entry's areas in the console's clone (same commands the brief lists) + its branch's CI.
    Marks the entry verified (all pass) or broken (any fail); CI still running → pending. Never merges anything."""
    plan = _node("web/plan-cli.mjs", {"verifyFor": e.get("areas") or []})
    checks: dict[str, str] = {}
    run = runner or (lambda cmd: subprocess.run(["bash", "-lc", cmd], cwd=str(cx.ROOT), capture_output=True, timeout=900).returncode)
    for c in plan.get("verify", [])[:20]:
        if "npm ci" in c["cmd"] and runner is None and not os.environ.get("AXF_VERIFY_BUILD"):
            checks[c["name"]] = "skip"  # the console image builds itself; CI covers it (set AXF_VERIFY_BUILD=1 to run here)
            continue
        try:
            checks[c["name"]] = "pass" if run(c["cmd"]) == 0 else "fail"
        except Exception:  # noqa: BLE001
            checks[c["name"]] = "fail"
    branch = e.get("branch") or (e.get("result") or {}).get("branch") or ""
    c = ci(branch)
    checks[f"CI ({branch or 'no branch'})"] = {"pass": "pass", "fail": "fail"}.get(c, "skip")
    failed = [k for k, v in checks.items() if v == "fail"]
    state = "broken" if failed else "pending" if c == "running" else "verified"
    summary = f"{len(failed)} check(s) failed: {', '.join(failed)}" if failed else "CI still running" if c == "running" else "All checks passed."
    v = {"state": state, "at": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()), "summary": summary, "checks": checks}
    _update_change(e["id"], {"verify": v})
    return {"ok": True, "verify": v}
