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
  POST start           {key, dryRun?} "Start build now" (orchestrate.mjs plans it: dependency closure, queue reorder,
                       overlap guard, model, branch, brief), then asks axHub `vps.run` to launch headless Claude Code on the
                       VPS. Needs Brett's approval on the hub: the job waits for it (retries 15 s × 10, then every minute,
                       up to 30 min), the approval link + an alert go out at once. dryRun returns the plan only.
  GET  jobs            the start jobs (state, approval link, command, plan, verify result)
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
import uuid
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
RECENT_S = 10 * 60  # finished items older than this aren't news for the tracker
ACTIVE = ("queued", "running", "waiting")
KEEP = ("id", "source", "kind", "title", "detail", "state", "progress", "startedAt", "updatedAt", "finishedAt", "url", "by", "steps")
HUB_APPROVALS = "https://axhub.amberxai.com/auth/admin/approvals"
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


def _hub_call() -> Callable[..., dict[str, Any]]:
    """axHub's `call` meta-tool over MCP (AXHUB_URL + AXHUB_TOKEN, the console's Keys); tests replace it."""
    import axf_framework  # noqa: F401 — framework/python on sys.path
    return _call_hub


def _call_hub(tool: str, arguments: dict[str, Any], confirmation_id: str | None = None, timeout: float = 120) -> dict[str, Any]:
    from axf_server import http as axf_http
    url = (os.environ.get("AXHUB_URL") or "https://axhub.amberxai.com").rstrip("/").removesuffix("/mcp")
    tok = os.environ.get("AXHUB_TOKEN", "")
    if not tok:
        raise RuntimeError("Add the axHub token first (Keys needed → axHub connection).")
    if not url.startswith("https://"):
        raise RuntimeError("The axHub address must be https.")
    sid = None

    def rpc(method: str, params: dict[str, Any]) -> dict[str, Any]:
        nonlocal sid
        h = {"authorization": f"Bearer {tok}", "content-type": "application/json", "accept": "application/json, text/event-stream"}
        if sid:
            h["mcp-session-id"] = sid
        r = axf_http.request("POST", f"{url}/mcp", headers=h, body=json.dumps({"jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": method, "params": params}).encode(),
                             timeout=timeout + 30, max_bytes=2_000_000, truncate=True)
        if not r.ok:
            raise RuntimeError(f"axHub answered {r.status}")
        sid = r.headers.get("mcp-session-id") or sid
        raw = r.text()
        if "text/event-stream" in r.headers.get("content-type", ""):
            msgs = [json.loads(x[5:].strip()) for x in raw.splitlines() if x.startswith("data:") and x[5:].strip()]
            msg = next((m for m in reversed(msgs) if "result" in m or "error" in m), {})
        else:
            msg = json.loads(raw or "{}")
        if "error" in msg:
            raise RuntimeError(str(msg["error"].get("message", "axHub error"))[:300])
        return msg.get("result") or {}

    rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "axf-build-manager", "version": "1"}})
    args: dict[str, Any] = {"tool": tool, "arguments": arguments, "timeout_seconds": int(timeout)}
    if confirmation_id:
        args["confirmation_id"] = confirmation_id
    res = rpc("tools/call", {"name": "call", "arguments": args})
    text = "\n".join(c.get("text", "") for c in res.get("content", []) if isinstance(c, dict))
    if res.get("isError"):
        try:
            err = json.loads(text).get("error", {})
        except ValueError:
            err = {"message": text}
        if err.get("code") == "confirmation_required":
            return {"confirm": str((err.get("details") or {}).get("confirmationId", ""))}
        raise RuntimeError(str(err.get("message") or text)[:400])
    return {"ok": text}


def retry_delays() -> list[float]:
    """Brett's rule (Oct 21 2026): retry an approval every 15 s ten times, then every minute (until it expires, 30 min)."""
    return [15.0] * 10 + [60.0] * 28


class Jobs:
    """One start job per build: plan → open its change entry → ask axHub → wait for approval → launched → (verify)."""

    def __init__(self) -> None:
        self.jobs: dict[str, dict[str, Any]] = {}
        self.lock = threading.Lock()
        self.call: Callable[..., dict[str, Any]] | None = None  # tests inject a fake axHub
        self.sleep: Callable[[float], None] = time.sleep
        self.alert: Callable[[dict[str, Any]], None] = lambda a: _alert(a)

    def get(self, key: str) -> dict[str, Any] | None:
        with self.lock:
            j = self.jobs.get(key)
            return json.loads(json.dumps(j)) if j else None

    def all(self) -> list[dict[str, Any]]:
        with self.lock:
            return [json.loads(json.dumps(j)) for j in self.jobs.values()]

    def _set(self, key: str, **kw: Any) -> None:
        with self.lock:
            self.jobs[key].update(kw, updatedAt=int(time.time() * 1000))

    def start(self, key: str, plan: dict[str, Any], change_id: str, command: str) -> dict[str, Any]:
        with self.lock:
            cur = self.jobs.get(key)
            if cur and cur["state"] in ("asking", "waiting", "launching"):
                return json.loads(json.dumps(cur))
            self.jobs[key] = {"key": key, "state": "asking", "message": "Asking axHub to start it on the VPS…", "confirmationId": None, "approvalUrl": "",
                              "changeId": change_id, "command": command, "plan": {k: plan.get(k) for k in ("model", "branch", "areas", "deps", "order")},
                              "startedAt": int(time.time() * 1000), "attempts": 0, "output": ""}
        threading.Thread(target=self._run, args=(key, command, change_id), daemon=True).start()
        return self.get(key) or {}

    def _run(self, key: str, command: str, change_id: str) -> None:
        call = self.call or _hub_call()
        args = {"command": command, "timeout_seconds": 120}
        try:
            r = call("vps.run", args)
            if "confirm" in r:
                conf = r["confirm"]
                link = f"{HUB_APPROVALS}/{conf}" if re.match(r"^[0-9A-Za-z-]{8,64}$", conf or "") else HUB_APPROVALS
                self._set(key, state="waiting", confirmationId=conf, approvalUrl=link, message="Approve it on axHub (the approval page shows the whole command).")
                self.alert({"title": f"Approve: start build {key}", "link": link, "key": key})
                _update_change(change_id, {"status": "queued", "activity": "Waiting for Brett's approval on axHub"})
                for i, d in enumerate(retry_delays()):
                    self.sleep(d)
                    self._set(key, attempts=i + 1)
                    try:
                        r = call("vps.run", args, conf)
                    except Exception as e:  # noqa: BLE001
                        m = str(e).lower()
                        state = "rejected" if "reject" in m else "expired" if "expired" in m else "failed"
                        self._set(key, state=state, message="Rejected on axHub." if state == "rejected" else "The approval expired." if state == "expired" else str(e)[:300])
                        _finish_change(change_id, "cancelled" if state != "failed" else "failed", f"Not started: {state}.")
                        return
                    if "confirm" not in r:
                        break
                else:
                    self._set(key, state="expired", message="The approval expired.")
                    _finish_change(change_id, "cancelled", "Not started: the approval expired.")
                    return
            out = str(r.get("ok", ""))
            ok = "started pid" in out or re.search(r"^exit 0\b", out, re.M) is not None
            self._set(key, state="launched" if ok else "failed", output=out[-2000:],
                      message="Running on the VPS: it reports itself in Live." if ok else "The VPS command failed: see the output.")
            if ok:
                _update_change(change_id, {"status": "running", "activity": "Launched on the VPS (headless Claude Code)"})
            else:
                _finish_change(change_id, "failed", "Launch failed on the VPS.")
        except Exception as e:  # noqa: BLE001
            self._set(key, state="failed", message=str(e)[:300])
            _finish_change(change_id, "failed", f"Not started: {str(e)[:200]}")


JOBS = Jobs()


def _alert(a: dict[str, Any]) -> None:
    """An alert (bell + phone) with the approval link: the console's alert hub when it's there."""
    try:
        import main  # noqa: PLC0415 — the console core (only inside the console process)
        hub = getattr(main, "ALERTS", None)
        if hub:
            hub.raise_alert({"source": "build-manager", "severity": "warning", "title": a["title"][:120], "body": "Start build now is waiting for your approval on axHub.",
                             "key": f"build-manager:start:{a['key']}"[:120], "link": a["link"]})
    except Exception:  # noqa: BLE001 — an alert failing never stops the start
        pass


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
    root = Path(cx.persist_root() or cx.ROOT)

    def rd(rel: str, d: Any) -> Any:
        for base in (root, Path(cx.ROOT)):
            try:
                return json.loads((base / rel).read_text())
            except (OSError, ValueError):
                continue
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
    if cur and cur["state"] in ("asking", "waiting", "launching") and not dry:
        return {"ok": True, "job": cur, "existing": True}
    planned = await asyncio.to_thread(_node, "web/plan-cli.mjs", {**_inputs(), "key": key})
    if not planned.get("ok"):
        return {"ok": False, "plan": planned, "refuse": planned.get("refuse"), "wait": planned.get("wait")}
    if dry:
        return {"ok": True, "dryRun": True, "plan": planned}
    if planned.get("order"):
        _engine("build-reorder", order=planned["order"], by="build-manager:start")
    svc = plugin_services.get(CHANGES)
    change_id = ""
    if svc:
        row = planned.get("row") or {}
        e = svc.open({"kind": "build", "title": str(row.get("title") or key)[:160], "asked": "Started from the Build manager (Start build now).", "model": planned["model"],
                      "repos": ["MossesX/AmberX-AXF"], "status": "queued", "surface": "console-launch", "buildRef": {"kind": key.split(":", 1)[0], "id": key.split(":", 1)[1]},
                      "branch": planned["branch"], "areas": planned["areas"][:40], "estimate": planned.get("estimate") or {},
                      "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()), "who": {"where": "console", "host": "console"},
                      "steps": [{"text": "Approve on axHub", "state": "running"}, {"text": "Build (headless Claude Code on the VPS)", "state": "queued"},
                                {"text": "Verify nothing broke", "state": "queued"}]}, "build-manager")
        change_id = e.get("id", "")
    command = (await asyncio.to_thread(_node, "web/plan-cli.mjs", {"command": {"brief": planned["brief"], "branch": planned["branch"], "model": planned["model"], "changeId": change_id}})).get("command", "")
    if not command:
        raise HTTPException(500, "no launch command")
    job = JOBS.start(key, planned, change_id, command)
    return {"ok": True, "job": job, "plan": planned}


@router.get("/jobs")
def jobs() -> dict[str, Any]:
    return {"items": JOBS.all()}


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
