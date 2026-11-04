"""Server part of the Maintenance plugin (maintenance@1). Mounted at /api/plugins/maintenance/.

The console adds the console-token check (every method) and the 404 while the plugin is off. The measuring and the
removing are done on the VPS host by ``engine/maint.py`` (cron, installed by ``deploy/host.sh``), which writes its
snapshot and every job's preview to this plugin's data folder (the repo checkout is mounted in the console at /axf).
Without the host part the console still shows disk, memory, swap and load (the container sees the host's), and says the
rest needs the host part.

Every clean-up run goes through axHub: the console writes the plan (what will be removed, with a fingerprint) and sends
ONE held ``vps.run`` call; Brett approves it on axHub (or his phone), axHub runs the engine on the VPS, and the engine
re-checks every item before removing it. Nothing here deletes anything.

Routes: GET status · GET summary · GET snapshot · GET jobs · POST preview · POST run · GET runs · GET/PUT settings ·
POST check. Registers the systems check row ``maintenance-server-health`` ("Server health", with Auto fix = the safe
clean-up) on axf.health@1, raises console alerts (phone push from error up) at the disk levels and when swap stays
nearly full, and sends the nightly safe clean-up when that setting is on (off by default).
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import console_context as cx
import plugin_services

from . import hub

PLUGIN_DIR = Path(__file__).resolve().parents[1]
FOLDER = PLUGIN_DIR.name

def _load_engine() -> Any:
    """The plugin's own engine (engine/maint.py), loaded under a private name so it can't clash with another module."""
    import importlib.util
    name = "axf_plugin_maintenance_engine"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, PLUGIN_DIR / "engine" / "maint.py")
    mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    sys.modules[name] = mod
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


maint = _load_engine()

router = APIRouter()
HEALTH_CAP = "axf.health@1"
HEALTH_ID = "maintenance-server-health"
ALERT_SOURCE = "maintenance"
DISK_KEY, SWAP_KEY = "maintenance:disk", "maintenance:swap"
HOST_ROOT = os.environ.get("AXF_MAINT_HOST_ROOT", "/opt/axf")  # the same checkout, as the VPS host sees it
STALE_S = 30 * 60   # a host snapshot older than this counts as "not reporting"
TICK_S = 60
PENDING_S = 2 * 3600  # a held run with no result after this long counts as dropped (denied / expired)
_lock = threading.RLock()


def data_dir() -> Path:
    d = Path(os.environ.get("AXF_MAINT_DATA_DIR") or Path(cx.ROOT) / ".axf-console" / "plugins" / FOLDER)
    d.mkdir(parents=True, exist_ok=True)
    return d


def settings() -> dict[str, Any]:
    return maint.load_settings(data_dir())


def _state() -> dict[str, Any]:
    return maint.read_json(data_dir() / "state.json", {}) or {}


def _set_state(**kw: Any) -> dict[str, Any]:
    with _lock:
        s = {**_state(), **kw}
        maint.write_json(data_dir() / "state.json", s)
        return s


# ------------------------------------------------------------------ snapshot

def _age_s(snap: dict[str, Any]) -> float | None:
    try:
        import datetime as dt
        return time.time() - dt.datetime.fromisoformat(str(snap.get("at", "")).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def snapshot() -> dict[str, Any]:
    """The host's latest snapshot, with live disk/memory/swap/load over it; a reduced one when the host part is silent."""
    snap = maint.read_json(data_dir() / "snapshot.json")
    live = maint.basic(str(cx.ROOT))
    if isinstance(snap, dict) and snap.get("$axf") == maint.SCHEMA:
        age = _age_s(snap)
        snap = {**snap, "ageS": int(age) if age is not None else None, "hostPart": True, "stale": age is None or age > STALE_S}
        snap.update({k: live[k] for k in ("memory", "swap", "load") if live.get(k)})
        if live["disk"].get("pct") is not None and snap.get("stale"):
            snap["disk"] = live["disk"]
        return snap
    return {"$axf": maint.SCHEMA, "at": maint.now_iso(), "source": "console", "hostPart": False, "stale": False, **live,
            "docker": {"available": False}, "candidates": {}, "builds": {"count": 0, "size": 0, "items": []}, "biggest": [],
            "note": "The host part isn't reporting yet: run deploy/install-console.sh on the VPS (it installs the maintenance "
                    "cron from plugins/maintenance/deploy/host.sh). Until then only disk, memory, swap and load show."}


def levels(snap: dict[str, Any], s: dict[str, Any] | None = None) -> dict[str, Any]:
    s = s or settings()
    st = _state()
    swap_pct = (snap.get("swap") or {}).get("pct")
    since = st.get("swapHighSince")
    swap_alert = bool(since) and swap_pct is not None and swap_pct >= s["swapFullPct"] and time.time() - since >= s["swapMinutes"] * 60
    return {"disk": maint.disk_level((snap.get("disk") or {}).get("pct"), s), "swapFull": swap_alert,
            "swapHighSince": since, "thresholds": {k: s[k] for k in ("diskWarnPct", "diskHighPct", "diskCriticalPct", "swapFullPct", "swapMinutes")}}


def reclaimable(snap: dict[str, Any], jobs: list[str] | None = None) -> int:
    c = snap.get("candidates") or {}
    return sum((c.get(j) or {}).get("bytes") or 0 for j in (jobs or list(c)))


def summary(snap: dict[str, Any] | None = None) -> dict[str, Any]:
    snap = snap or snapshot()
    d, m, sw, ld = snap.get("disk") or {}, snap.get("memory") or {}, snap.get("swap") or {}, snap.get("load") or {}
    lv = levels(snap)
    gb = lambda v: round(v / maint.GB, 1) if isinstance(v, (int, float)) else None  # noqa: E731
    return {
        "level": lv["disk"], "swapFull": lv["swapFull"], "hostPart": snap.get("hostPart", False), "stale": snap.get("stale", False),
        "disk": {"pct": d.get("pct"), "usedGb": gb(d.get("used")), "freeGb": gb(d.get("free")), "totalGb": gb(d.get("total")), "max": 100},
        "memory": {"pct": m.get("pct"), "usedGb": gb(m.get("used")), "totalGb": gb(m.get("total")), "max": 100},
        "swap": {"pct": sw.get("pct"), "usedGb": gb(sw.get("used")), "totalGb": gb(sw.get("total")), "max": 100},
        "load": {"1": ld.get("1"), "5": ld.get("5"), "15": ld.get("15"), "cpus": ld.get("cpus")},
        "reclaimableGb": gb(reclaimable(snap)), "safeReclaimableGb": gb(reclaimable(snap, maint.SAFE_JOBS)),
        "at": snap.get("at"),
    }


# ------------------------------------------------------------------ runs

def _runs_dir(kind: str) -> Path:
    d = data_dir() / kind
    d.mkdir(parents=True, exist_ok=True)
    return d


def _held() -> dict[str, Any]:
    return maint.read_json(data_dir() / "held.json", {}) or {}


def run_state(p: dict[str, Any], held: dict[str, Any] | None = None) -> dict[str, Any]:
    held = held if held is not None else _held()
    res = maint.read_json(_runs_dir("runs") / f"{p['id']}.json")
    h = held.get(p["id"]) or {}
    age = _age_s(p) or 0
    if isinstance(res, dict):
        state = "done" if res.get("ok") else "partial"
    elif h.get("error"):
        state = "failed"
    elif age > PENDING_S:
        state = "dropped"
    else:
        state = "waiting"
    return {"id": p["id"], "at": p.get("at"), "by": p.get("by"), "kind": p.get("kind"), "jobs": p.get("jobs"), "count": p.get("count"),
            "bytes": p.get("bytes"), "state": state, "hub": h, **({"result": {k: res.get(k) for k in ("at", "ok", "done", "skipped", "failed", "freed", "diskAfter", "results")}} if isinstance(res, dict) else {})}


def list_runs(limit: int = 30) -> list[dict[str, Any]]:
    held = _held()
    plans = []
    for f in sorted(_runs_dir("plans").glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True)[:limit]:
        p = maint.read_json(f)
        if isinstance(p, dict) and p.get("id"):
            plans.append(run_state(p, held))
    return plans


def _describe(p: dict[str, Any]) -> str:
    parts = []
    for j in p["jobs"]:
        items = [i for i in p["items"] if i["job"] == j]
        if items:
            parts.append(f"{maint.JOBS[j]['label']}: {len(items)} ({maint.human(sum(i.get('size') or 0 for i in items))})")
    head = "; ".join(parts) or "nothing"
    sample = ", ".join(i["ref"].rsplit("/", 1)[-1][:40] for i in p["items"][:6])
    return (f"Removes {head}. Total about {maint.human(p['bytes'])}. Examples: {sample}. The engine re-checks every item on the VPS and "
            f"leaves anything that is now in use or changed. Never running containers, volumes or app data. Plan {p['id']} ({p['sha']}).")


def start_run(jobs: list[str], only: list[str] | None = None, by: str = "console", kind: str = "manual") -> dict[str, Any]:
    """Write the plan and send the one held call. Refuses empty plans and a second run while one is waiting."""
    jobs = [j for j in dict.fromkeys(jobs) if j in maint.JOBS]
    if kind != "manual":
        jobs = [j for j in jobs if maint.JOBS[j]["safe"]]
    if not jobs:
        raise HTTPException(400, f"pick at least one job ({', '.join(maint.JOBS)})")
    snap = snapshot()
    if not snap.get("hostPart"):
        raise HTTPException(409, "The host part isn't reporting, so there is no preview to approve yet.")
    with _lock:
        waiting = [r for r in list_runs(10) if r["state"] == "waiting"]
        if waiting:
            raise HTTPException(409, f"Run {waiting[0]['id']} is still waiting for your approval on axHub. Approve or deny it first.")
        run_id = f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
        p = maint.make_plan(run_id, jobs, snap.get("candidates") or {}, only=only, by=by, kind=kind)
        if not p["items"]:
            raise HTTPException(409, "Nothing to remove for those jobs right now.")
        maint.write_json(_runs_dir("plans") / f"{run_id}.json", p)
        command = f"python3 {HOST_ROOT}/apps/console-web/plugins/{FOLDER}/engine/maint.py run {run_id} --sha {p['sha']}"
        title = f"{'Nightly clean-up' if kind == 'nightly' else 'Server clean-up'}: free about {maint.human(p['bytes'])}"
        try:
            if hub.connected():
                h = hub.hold(command, title, _describe(p))
            else:
                reg = plugin_services.get(HEALTH_CAP)
                vps_run = getattr(reg, "vps_run", None) if reg is not None else None
                if not vps_run:
                    raise hub.HubError("axHub isn't connected (no AXHUB_TOKEN) and the systems check can't reach the VPS")
                r = vps_run(command)
                h = {"via": "axf.health", "state": r.get("state"), "message": r.get("message"), **({"job": r["jobId"]} if r.get("jobId") else {})}
                if r.get("state") == "failed":
                    h["error"] = r.get("message") or "the VPS command failed"
        except hub.HubError as e:
            h = {"error": str(e)}
        held = _held()
        held[run_id] = {**h, "at": maint.now_iso()}
        maint.write_json(data_dir() / "held.json", dict(list(held.items())[-200:]))
        cx.log("maintenance", f"clean-up {run_id} ({', '.join(jobs)}, {p['count']} items, {maint.human(p['bytes'])}) sent to axHub: "
                              f"{'error ' + h['error'] if h.get('error') else 'held for approval'}", "warn" if h.get("error") else "info")
    out = run_state(p)
    if h.get("error"):
        raise HTTPException(502, f"Couldn't send the run to axHub: {h['error']}")
    return out


# ------------------------------------------------------------------ alerts, nightly, health

def _alert(key: str, severity: str, title: str, body: str) -> None:
    cx.raise_alert({"source": ALERT_SOURCE, "key": key, "severity": severity, "title": title, "body": body, "link": "view:maintenance"})


def tick(now: float | None = None) -> dict[str, Any]:
    """One monitor pass: swap tracking, alerts at the disk levels and full swap, the nightly run."""
    now = time.time() if now is None else now
    s = settings()
    snap = snapshot()
    st = _state()
    since, swap_alert = maint.swap_state((snap.get("swap") or {}).get("pct"), st.get("swapHighSince"), now, s)
    lvl = maint.disk_level((snap.get("disk") or {}).get("pct"), s)
    d = snap.get("disk") or {}
    sev = {"warning": "warning", "error": "error", "critical": "critical"}
    prev = st.get("diskLevel")
    if lvl in sev and lvl != prev:  # once per level change: a repeat would only bump the count
        if prev in sev and maint.LEVEL_RANK[lvl] < maint.LEVEL_RANK[prev]:
            cx.resolve_alerts([DISK_KEY])  # better but still high: show the lower level, not the old worst one
        free = maint.human(d.get("free"))
        _alert(DISK_KEY, sev[lvl], f"VPS disk {d.get('pct')}% full", f"{free} free. Safe clean-up could free about "
               f"{maint.human(reclaimable(snap, maint.SAFE_JOBS))}. Open Maintenance to preview it, or use Auto fix on Server health.")
    elif lvl == "ok" and prev in sev:
        if (d.get("pct") or 0) < s["diskWarnPct"] - 2:  # 2 points of hysteresis
            cx.resolve_alerts([DISK_KEY])
        else:
            lvl = prev  # still near the line: keep the alert open
    if swap_alert and not st.get("swapAlert"):
        sw = snap.get("swap") or {}
        _alert(SWAP_KEY, "error", f"VPS swap {sw.get('pct')}% full for {int((now - since) / 60)} min",
               "Memory is short: builds and containers slow down. Lower the agent cap or stop idle containers.")
    elif not swap_alert and st.get("swapAlert"):
        cx.resolve_alerts([SWAP_KEY])
    nightly = None
    lt = time.localtime(now)
    today = time.strftime("%Y-%m-%d", lt)
    if s["nightly"] and lt.tm_hour == s["nightlyHour"] and st.get("lastNightly") != today and snap.get("hostPart") and not snap.get("stale"):
        _set_state(lastNightly=today)
        jobs = [j for j in s["nightlyJobs"] if maint.JOBS[j]["safe"]]
        if reclaimable(snap, jobs) > 0 or any((snap.get("candidates") or {}).get(j, {}).get("count") for j in jobs):
            try:
                nightly = start_run(jobs, by="nightly", kind="nightly")
            except HTTPException as e:
                nightly = {"error": e.detail}
                cx.log("maintenance", f"nightly clean-up not sent: {e.detail}", "warn")
    _set_state(swapHighSince=since, swapAlert=swap_alert, diskLevel=lvl, lastTick=maint.now_iso(now))
    ensure_health()
    return {"disk": lvl, "swapFull": swap_alert, **({"nightly": nightly} if nightly else {})}


def health_probe() -> dict[str, Any]:
    snap = snapshot()
    lv = levels(snap)
    d = snap.get("disk") or {}
    details = [f"Disk {d.get('pct')}% ({maint.human(d.get('free'))} free), memory {(snap.get('memory') or {}).get('pct')}%, "
               f"swap {(snap.get('swap') or {}).get('pct') or 0}%."]
    if not snap.get("hostPart"):
        details.append("The host part isn't installed, so Docker, worktrees, logs and /tmp aren't measured.")
    elif snap.get("stale"):
        details.append(f"The host snapshot is {int((snap.get('ageS') or 0) / 60)} min old.")
    if lv["disk"] in ("error", "critical"):
        return {"status": "error", "summary": f"The VPS disk is {d.get('pct')}% full.", "details": details}
    problems = []
    if lv["disk"] == "warning":
        problems.append(f"the disk is {d.get('pct')}% full")
    if lv["swapFull"]:
        problems.append("swap has been nearly full for a while")
    if snap.get("hostPart") and snap.get("stale"):
        problems.append("the host snapshot is old")
    if problems:
        return {"status": "warn", "summary": "Server health: " + "; ".join(problems) + ".", "details": details}
    return {"status": "ok", "summary": f"Disk {d.get('pct')}%, memory {(snap.get('memory') or {}).get('pct')}%, swap fine.", "details": details}


def autofix() -> dict[str, Any]:
    """Auto fix for Server health: the safe clean-up, as one held call on axHub (runs only once approved)."""
    try:
        r = start_run(maint.SAFE_JOBS, by="auto-fix", kind="autofix")
    except HTTPException as e:
        return {"state": "failed", "message": str(e.detail)}
    return {"state": "started", "message": f"Safe clean-up ({maint.human(r.get('bytes'))}) is waiting for your approval on axHub.",
            "waitS": 30 * 60, **({"jobId": r["hub"]["job"]} if (r.get("hub") or {}).get("job") else {}), "link": "view:maintenance"}


_health_done = False


def ensure_health() -> bool:
    global _health_done
    if _health_done:
        return True
    reg = plugin_services.get(HEALTH_CAP)
    if reg is None:
        return False
    try:
        reg.register({"id": HEALTH_ID, "label": "Server health", "service": "vps", "order": 37, "interval": 5 * 60,
                      "run": health_probe,
                      "breaks": "When the disk fills up, builds, Docker pulls, databases and the console itself start failing.",
                      "links": [{"label": "Open Maintenance", "href": "view:maintenance"}],
                      "instructions": ["Maintenance → preview a clean-up, then approve it on axHub.",
                                       "Auto fix sends the safe clean-up (dangling images and build cache, old logs, /tmp leftovers, stuck Created containers) for approval."],
                      "autoFix": {"label": "Run the safe clean-up", "run": autofix}}, FOLDER)
    except Exception:  # noqa: BLE001 — the plugin works without its row
        return False
    _health_done = True
    return True


def _loop() -> None:
    time.sleep(15)
    while True:
        try:
            tick()
        except Exception as e:  # noqa: BLE001 — the monitor never dies
            cx.log("maintenance", f"monitor: {type(e).__name__}: {e}"[:300], "warn")
        time.sleep(TICK_S)


# ------------------------------------------------------------------ routes

async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(400, "send a JSON object") from None
    if not isinstance(b, dict):
        raise HTTPException(400, "send a JSON object")
    return b


def _jobs_of(b: dict[str, Any]) -> list[str]:
    jobs = b.get("jobs")
    if isinstance(jobs, str):
        jobs = [j for j in re.split(r"[,\s]+", jobs) if j]
    if not isinstance(jobs, list) or not all(isinstance(j, str) for j in jobs):
        raise HTTPException(400, "jobs: a list of job ids")
    bad = [j for j in jobs if j not in maint.JOBS]
    if bad:
        raise HTTPException(400, f"unknown job(s) {', '.join(bad)}; jobs are {', '.join(maint.JOBS)}")
    return jobs


@router.get("/status")
def get_status() -> dict[str, Any]:
    ensure_health()
    snap = snapshot()
    runs = list_runs(5)
    return {"summary": summary(snap), "levels": levels(snap), "settings": settings(), "hostPart": snap.get("hostPart"),
            "stale": snap.get("stale"), "note": snap.get("note"), "lastRun": runs[0] if runs else None, "hub": hub.connected()}


@router.get("/summary")
def get_summary() -> dict[str, Any]:
    return summary()


@router.get("/snapshot")
def get_snapshot() -> dict[str, Any]:
    snap = snapshot()
    return {**snap, "candidates": {j: {k: v for k, v in c.items() if k != "items"} | {"items": c.get("items", [])[:200]}
                                   for j, c in (snap.get("candidates") or {}).items()}}


@router.get("/jobs")
def get_jobs() -> dict[str, Any]:
    snap = snapshot()
    c = snap.get("candidates") or {}
    return {"jobs": [{**j, "count": (c.get(j["id"]) or {}).get("count"), "bytes": (c.get(j["id"]) or {}).get("bytes"),
                      "error": (c.get(j["id"]) or {}).get("error")} for j in maint.job_catalog()], "hostPart": snap.get("hostPart"), "at": snap.get("at")}


@router.post("/preview")
async def post_preview(request: Request) -> dict[str, Any]:
    b = await _body(request)
    jobs = _jobs_of(b)
    snap = snapshot()
    c = snap.get("candidates") or {}
    out = {j: {"label": maint.JOBS[j]["label"], "safe": maint.JOBS[j]["safe"], "what": maint.JOBS[j]["what"],
               "items": (c.get(j) or {}).get("items", []), "kept": (c.get(j) or {}).get("kept", []),
               "count": (c.get(j) or {}).get("count", 0), "bytes": (c.get(j) or {}).get("bytes", 0), "error": (c.get(j) or {}).get("error")} for j in jobs}
    return {"jobs": out, "count": sum(v["count"] for v in out.values()), "bytes": sum(v["bytes"] for v in out.values()),
            "at": snap.get("at"), "hostPart": snap.get("hostPart"), "stale": snap.get("stale")}


@router.post("/run")
async def post_run(request: Request) -> dict[str, Any]:
    b = await _body(request)
    only = b.get("items")
    if only is not None and (not isinstance(only, list) or not all(isinstance(x, str) for x in only)):
        raise HTTPException(400, "items: a list of item ids from the preview")
    return start_run(_jobs_of(b), only=only, by=str(b.get("by") or "console")[:40])


@router.get("/runs")
def get_runs() -> dict[str, Any]:
    return {"runs": list_runs()}


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return {"settings": settings(), "defaults": maint.DEFAULTS, "safeJobs": maint.SAFE_JOBS}


@router.put("/settings")
async def put_settings(request: Request) -> dict[str, Any]:
    b = await _body(request)
    patch = {k: v for k, v in b.items() if k in maint.DEFAULTS}
    if not patch:
        raise HTTPException(400, f"nothing to save (keys: {', '.join(maint.DEFAULTS)})")
    with _lock:
        merged = maint.normalize_settings({**settings(), **patch})
        maint.write_json(data_dir() / "settings.json", merged)
    return {"settings": merged}


@router.post("/check")
def post_check() -> dict[str, Any]:
    return tick()


if os.environ.get("AXF_MAINT_NO_MONITOR") != "1":
    threading.Thread(target=_loop, name="maintenance-monitor", daemon=True).start()
ensure_health()
