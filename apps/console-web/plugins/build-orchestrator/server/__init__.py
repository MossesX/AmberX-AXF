"""Server part of the build orchestrator. Mounted at /api/plugins/build-orchestrator/.

The console adds the console-token check (every method) and the 404 while disabled. Every read and change goes
through the plugin's CLI (orchestrator.mjs --json), so the console, the CLI and other sessions share one set of
rules and one tracker file (_claude/builds/orchestrator.json). Never exposed on the console MCP.

Model upgrades (framework/core/model-switch.mjs, Brett, Nov 3 2026): approving an upgrade (or answering an upgrade
request) counts only as Brett's own click: a browser signed in to axHub as an admin (wall session), with no
X-Axhub-Session / X-Axhub-Source header naming a session, build or agent. Only then does this route hand the CLI
AXF_APPROVER (his hub name) and AXF_APPROVER_VIA=console. The console token alone is not Brett: scripts and Claude
sessions hold it too. Downgrades need nobody.

Live sync (Nov 3 2026, orch-live-sync): the systems check gets the item `builds-live` (axf.health@1): red when store
changes can't reach main (framework/cli/builds-live.mjs keeps them queued), amber when the reconciler
(framework/cli/builds-reconcile.mjs) finds open PRs or claude/* branches that belong to no build, or hasn't run lately.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import plugin_services

router = APIRouter()
CLI = Path(__file__).resolve().parent.parent / "orchestrator.mjs"
ROOT = CLI.parents[3]
MAX_BODY = 256 * 1024
FOLDER = CLI.parent.name
LIVE_CLI = ROOT / "framework" / "cli" / "builds-live.mjs"
HEALTH_CAP = "axf.health@1"
HEALTH_ID = "builds-live"
STUCK_MIN = 15  # store changes waiting this long for main = red
STALE_MIN = 40  # no reconciler report this long (it runs every 10 min) = amber


APPROVER_KEYS = ("AXF_APPROVER", "AXF_APPROVER_VIA")
AGENT_HEADERS = ("x-axhub-session", "x-axhub-source")


def _run(*args: str, approver: str = "") -> dict[str, Any]:
    env = {k: v for k, v in os.environ.items() if k not in APPROVER_KEYS}  # never inherited: only Brett's click sets them
    if approver:
        env.update(AXF_APPROVER=approver, AXF_APPROVER_VIA="console")
    proc = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=60, env=env)
    out = proc.stdout.strip().splitlines()
    try:
        res = json.loads(out[-1]) if out else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        res = {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}
    return res


def brett_click(request: Request) -> str:
    """The signed-in hub admin's name when this request is Brett's own click in the console, else ''."""
    c = getattr(request.state, "axf_user", None)
    if c is None or getattr(c, "via", "token") != "session" or not getattr(c, "admin", False):
        return ""
    for h in AGENT_HEADERS:
        v = (request.headers.get(h) or "").strip()
        if v and v != "console":
            return ""
    return str(getattr(c, "name", "") or "")[:120]


@router.get("/state")
def state() -> dict[str, Any]:
    ensure_health()
    return _run("state")


@router.get("/brief/{build_id}")
def brief(build_id: str) -> dict[str, Any]:
    if len(build_id) > 80:
        raise HTTPException(400, "id too long")
    return _run("brief", build_id)


@router.post("/act")
async def act(request: Request) -> dict[str, Any]:
    body = await request.body()
    if len(body) > MAX_BODY:
        raise HTTPException(413, "change too large")
    try:
        change = json.loads(body or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "not JSON")
    if not isinstance(change, dict) or not isinstance(change.get("action"), str):
        raise HTTPException(400, "a change needs an action")
    change.pop("approver", None)  # who approves comes from the sign-in, never from the body
    return _run("act", json.dumps(change), approver=brett_click(request))


# ---- build packages (build-package@1, web/packager-core.mjs): package waiting steps, send to a helper or queue them
#
# Brett, Nov 4 2026: select the steps waiting to be built (Fable by default), combine them into one build, then send it
# to a helper or add it to this orchestrator. Owner-only on the primary: a secondary session (Session sync,
# capability axf.session-sync@1) is refused here, whatever its UI shows. Sending goes through that capability's
# offer(); without it the package stays in this orchestrator and the answer says why. Every package and every send
# re-analyzes the order (packager.mjs reanalyze) and the Breakroom Sessions channel gets one line (axf.crew@1 post).

PACKAGER = CLI.parent / "packager.mjs"
SYNC_CAP = "axf.session-sync@1"
CREW_CAP = "axf.crew@1"
PLANS_CAP = "plans@1"
SESSION_HEADERS = ("x-axf-session", "x-axhub-session")
ACCOUNT_HEADERS = ("x-axf-account",)


def _sync():
    cap = plugin_services.get(SYNC_CAP)
    return cap if cap is not None and hasattr(cap, "link") else None


def package_role(request: Request) -> str:
    """primary | secondary for the caller. Brett's own click, the console itself and a project without Session sync are primary."""
    if brett_click(request):
        return "primary"
    cap = _sync()
    if cap is None:
        return "primary"
    session = next((request.headers.get(h, "").strip() for h in SESSION_HEADERS if request.headers.get(h, "").strip()), "")
    if not session or session == "console":
        return "primary"
    account = next((request.headers.get(h, "").strip() for h in ACCOUNT_HEADERS if request.headers.get(h, "").strip()), "")
    try:
        return "secondary" if cap.role_of(session, account) == "secondary" else "primary"
    except Exception:  # noqa: BLE001 — a broken link never locks the owner out
        return "primary"


def _owner_only(request: Request) -> None:
    if package_role(request) != "primary":
        raise HTTPException(403, "secondary sessions can't package builds: only the primary (Brett's sessions) owns the orchestrator")


def _plans_file() -> str:
    """Plan Studio's ready plans for the packager (through plans@1, never its folder); '' when not installed."""
    cap = plugin_services.get(PLANS_CAP)
    if cap is None:
        return ""
    try:
        plans = [p for p in cap.list() if isinstance(p, dict) and p.get("status") == "ready"]
    except Exception:  # noqa: BLE001
        return ""
    f = ROOT / ".axf-console" / "plugins" / FOLDER / "ready-plans.json"
    try:
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(plans))
    except OSError:
        return ""
    return str(f)


def _pack(*args: str, approver: str = "") -> dict[str, Any]:
    env = {k: v for k, v in os.environ.items() if k not in APPROVER_KEYS}
    if approver:
        env.update(AXF_APPROVER=approver, AXF_APPROVER_VIA="console")
    plans = _plans_file()
    if plans:
        env["AXF_PACKAGER_PLANS"] = plans
    proc = subprocess.run(["node", str(PACKAGER), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=90, env=env)
    out = proc.stdout.strip().splitlines()
    try:
        return json.loads(out[-1]) if out else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}


def helpers() -> list[dict[str, Any]]:
    """Helper (secondary) sessions on the link that can take work, for the Send to helper picker."""
    cap = _sync()
    if cap is None:
        return []
    try:
        link = cap.link() or {}
    except Exception:  # noqa: BLE001
        return []
    p = link.get("primary") or {}
    out = []
    for s in (link.get("sessions") or {}).values():
        if not isinstance(s, dict) or s.get("endedAt") or s.get("id") == p.get("session") or (p.get("account") and s.get("account") == p.get("account")):
            continue
        out.append({"id": s.get("id"), "account": s.get("account"), "agent": s.get("agent"), "client": s.get("client"), "lastSeenAt": s.get("lastSeenAt"), "doing": s.get("doing")})
    return out


def post_chat(text: str) -> bool:
    """One line in the Breakroom Sessions channel (best effort; the crew chat may not have channels yet)."""
    crew = plugin_services.get(CREW_CAP)
    if crew is None or not hasattr(crew, "post"):
        return False
    try:
        crew.post([{"from": "boss", "kind": "handover", "text": text[:1000], "channel": "sessions"}])
        return True
    except Exception:  # noqa: BLE001 — the chat is best effort
        return False


def send_to_helper(build_id: str, to: str, now: bool, request: Request) -> dict[str, Any]:
    """Offer a package to a helper through Session sync (one handover transaction there), then record it here."""
    cap = _sync()
    if cap is None or not hasattr(cap, "offer"):
        return {"sent": False, "why": "Session sync isn't running here (or can't take offers yet), so the package stays in your orchestrator."}
    who = {"session": "console", "account": "", "brett": bool(brett_click(request)), "name": brett_click(request)}
    try:
        r = cap.offer({"build": build_id, "mode": "whole", "to": to or None, "reason": f"Build package {build_id}" + (" (do it now)" if now else ""), "priority": "now" if now else "normal"}, who)
    except Exception as e:  # noqa: BLE001
        return {"sent": False, "why": f"Session sync refused the offer: {str(e)[:300]}"}
    if isinstance(r, dict) and r.get("ok") is False:
        return {"sent": False, "why": str(r.get("message") or r.get("error") or "refused")[:300]}
    offer = (r or {}).get("offer") or {}
    _pack("mark-sent", build_id, json.dumps({"to": to or "any helper", "offer": offer.get("id", "") if isinstance(offer, dict) else "", "now": now}))
    return {"sent": True, "offer": offer, "to": to or "any helper"}


def replan_everything(request: Request) -> dict[str, Any]:
    """Re-analyze after every send (addendum 1): this orchestrator's order, then Session sync's whole picture when present."""
    mine = _pack("reanalyze", "--apply")
    cap = _sync()
    theirs: Any = None
    if cap is not None and hasattr(cap, "replan"):
        try:
            theirs = cap.replan({"dryRun": False}, {"session": "console", "brett": bool(brett_click(request))})
        except Exception as e:  # noqa: BLE001
            theirs = {"ok": False, "error": str(e)[:300]}
    return {"orchestrator": mine, "sessions": theirs}


@router.get("/package/candidates")
def package_candidates(request: Request) -> dict[str, Any]:
    """Every waiting step (all builds, all profiles, ready plans) for the Package builds window, with filters and helpers."""
    role = package_role(request)
    if role != "primary":
        return {"ok": True, "role": role, "candidates": [], "hidden": "Packaging is the primary session's job."}
    r = _pack("candidates")
    r.update(role=role, helpers=helpers(), sessionSync=_sync() is not None, canSend=_sync() is not None and hasattr(_sync(), "offer"), chat=hasattr(plugin_services.get(CREW_CAP) or object(), "post"))
    return r


@router.post("/package")
async def package(request: Request) -> dict[str, Any]:
    """Package the ticked steps (`order` = priority), then add it to this orchestrator (`position`) or send it (`dest: helper`, `to`, `now`)."""
    _owner_only(request)
    body = await _json_body(request)
    order = body.get("order")
    if not isinstance(order, list) or not order or not all(isinstance(k, str) and len(k) < 200 for k in order) or len(order) > 400:
        raise HTTPException(400, "order = the ticked step keys, in priority order")
    if body.get("confirmed") is not True:
        raise HTTPException(400, "confirm the ticked list first (confirmed: true)")
    req = {k: body.get(k) for k in ("order", "name", "model", "thinking", "position", "dest", "said", "category") if body.get(k) is not None}
    res = _pack("package", json.dumps(req), approver=brett_click(request))
    if not res.get("ok"):
        raise HTTPException(400, str(res.get("error") or "packaging failed"))
    build = res.get("build") or {}
    for m in res.get("plans") or []:
        _link_plan(m, build.get("id", ""))
    sent: dict[str, Any] = {"sent": False}
    if body.get("dest") == "helper":
        sent = send_to_helper(build.get("id", ""), str(body.get("to") or ""), body.get("now") is True, request)
        res["replan"] = replan_everything(request)
    res["send"] = sent
    res["posted"] = post_chat(_chat_line(build, sent, body))
    return res


@router.post("/package/{build_id}/send")
async def package_send(build_id: str, request: Request) -> dict[str, Any]:
    """Send an existing package to a helper (`to`, `now`); re-analyzes afterwards."""
    _owner_only(request)
    if len(build_id) > 80:
        raise HTTPException(400, "id too long")
    body = await _json_body(request)
    sent = send_to_helper(build_id, str(body.get("to") or ""), body.get("now") is True, request)
    replan = replan_everything(request)
    state = _run("state")
    b = next((x for x in (state.get("state") or {}).get("builds", []) if x.get("id") == build_id), {"id": build_id, "title": build_id, "steps": []})
    return {"ok": True, "send": sent, "replan": replan, "posted": post_chat(_chat_line(b, sent, body)) if sent.get("sent") else False}


@router.post("/package/{build_id}/unpackage")
async def package_undo(build_id: str, request: Request) -> dict[str, Any]:
    """A package with nothing done goes back to its builds (its steps return, the package is removed)."""
    _owner_only(request)
    if len(build_id) > 80:
        raise HTTPException(400, "id too long")
    res = _pack("unpackage", build_id)
    if not res.get("ok"):
        raise HTTPException(400, str(res.get("error") or "failed"))
    return res


@router.post("/package/reanalyze")
async def package_reanalyze(request: Request) -> dict[str, Any]:
    """Re-check the queue order against every package (`apply: false` previews)."""
    _owner_only(request)
    body = await _json_body(request)
    if body.get("apply") is False:
        return _pack("reanalyze")
    return {"ok": True, **replan_everything(request)}


def _chat_line(build: dict[str, Any], sent: dict[str, Any], body: dict[str, Any]) -> str:
    steps = build.get("steps") or []
    where = f"sent to {sent.get('to')}" + (" (do it now)" if body.get("now") else "") if sent.get("sent") else (
        "added to the orchestrator" + (" at the top of the queue" if body.get("position", 0) == 0 else ""))
    lines = [f"{i + 1}. [{s.get('model')}] {str(s.get('text') or '')[:140]} ({(s.get('origin') or {}).get('build', '')})" for i, s in enumerate(steps[:30])]
    return f"Package {build.get('id')} \"{build.get('title')}\" {where}: {len(steps)} step(s).\n" + "\n".join(lines)


def _link_plan(mark: dict[str, Any], pkg_id: str) -> None:
    """A packaged plan step: marked on its plan (plans@1 save), with a link to the package."""
    cap = plugin_services.get(PLANS_CAP)
    if cap is None or not pkg_id:
        return
    try:
        plan = cap.get(str(mark.get("build", "")).removeprefix("plan:"))
        if not plan:
            return
        for st in plan.get("steps") or []:
            if str(st.get("id")) == str(mark.get("step")):
                st["packagedInto"] = pkg_id
        links = plan.setdefault("links", [])
        if not any(link.get("ref") == pkg_id for link in links):
            links.append({"kind": "build", "ref": pkg_id, "label": "packaged into"})
        cap.save(plan, by="build-orchestrator", force=True)
    except Exception:  # noqa: BLE001 — the package is made; the plan link is best effort
        pass


# ---- what Brett said (build-origin@1): framework/cli/build-origin.mjs, zero tokens

ORIGIN_CLI = ROOT / "framework" / "cli" / "build-origin.mjs"
SAID_MAX = 8000


def _origin(*args: str) -> dict[str, Any]:
    proc = subprocess.run(["node", str(ORIGIN_CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=60)
    out = proc.stdout.strip().splitlines()
    try:
        res = json.loads(out[-1]) if out else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        res = {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}
    if not res.get("ok"):
        raise HTTPException(404 if "no build" in str(res.get("error", "")) else 400, str(res.get("error", "failed")))
    return res


def _said_args(body: dict[str, Any], who: str) -> list[str]:
    said = body.get("said")
    if not isinstance(said, str) or not said.strip():
        raise HTTPException(400, "said is required: Brett's exact words, unedited")
    if len(said) > SAID_MAX:
        raise HTTPException(413, "said is too long")
    args = ["--said", said, "--by", str(body.get("by") or who or "console")[:120]]
    for k in ("source", "at", "session", "link"):
        v = body.get(k)
        if isinstance(v, str) and v.strip():
            args += [f"--{k}", v.strip()[:500]]
    return args


async def _json_body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise HTTPException(413, "too large")
    try:
        body = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "not JSON")
    if not isinstance(body, dict):
        raise HTTPException(400, "a JSON object is needed")
    return body


@router.get("/origin/{build_id}")
def origin_get(build_id: str) -> dict[str, Any]:
    """What Brett said that started a build: his verbatim words, when, where, who launched it, the brief, addenda."""
    if len(build_id) > 80:
        raise HTTPException(400, "id too long")
    return _origin("get", build_id)


@router.post("/origin/{build_id}")
async def origin_set(build_id: str, request: Request) -> dict[str, Any]:
    """Record what Brett said (verbatim) on a build that has no words yet; his words are never replaced."""
    if len(build_id) > 80:
        raise HTTPException(400, "id too long")
    body = await _json_body(request)
    return _origin("set", build_id, *_said_args(body, brett_click(request)))


@router.post("/origin/{build_id}/addendum")
async def origin_addendum(build_id: str, request: Request) -> dict[str, Any]:
    """Add a later change Brett asked for (verbatim) to a build's origin."""
    if len(build_id) > 80:
        raise HTTPException(400, "id too long")
    body = await _json_body(request)
    return _origin("addendum", build_id, *_said_args(body, brett_click(request)))


# ---- systems check: live sync + reconciler (axf.health@1)

def _report_file() -> Path:
    data = os.environ.get("AXF_DATA_DIR") or ""
    if data and data != "off":
        return Path(data) / "builds" / "reconcile.json"
    hub = Path(os.environ.get("AXHUB_PROJECTS_DIR") or "/projects") / "amberx-axf" / "_data"
    return hub / "builds" / "reconcile.json" if hub.is_dir() else ROOT / ".axf-console" / "builds-reconcile.json"


def _age_min(iso: str, now: float) -> float:
    try:
        return (now - datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()) / 60
    except (ValueError, AttributeError):
        return 1e9


def health_probe(live: dict[str, Any] | None = None, report: dict[str, Any] | None = None, now: float | None = None) -> dict[str, Any]:
    """Red: changes stuck before main. Amber: orphans, or the reconciler hasn't run. Green otherwise."""
    now = now if now is not None else time.time()
    if live is None:
        try:
            p = subprocess.run(["node", str(LIVE_CLI), "status", "--json"], cwd=ROOT, capture_output=True, text=True, timeout=20)
            live = json.loads(p.stdout.strip().splitlines()[-1]) if p.stdout.strip() else {}
        except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError, IndexError):
            live = {}
    if report is None:
        try:
            report = json.loads(_report_file().read_text())
        except (OSError, json.JSONDecodeError):
            report = {}
    details: list[str] = []
    queued = int(live.get("queued") or 0)
    if queued and live.get("error") and _age_min(str(live.get("lastError") or ""), now) < 60 and _age_min(str(live.get("lastOk") or ""), now) >= STUCK_MIN:
        return {"status": "error", "summary": f"{queued} build change(s) haven't reached main: {str(live.get('error'))[:200]}",
                "details": ["Banners and THREADS on main are behind until they go through.", "On the VPS: `node framework/cli/builds-live.mjs flush` retries and prints why."]}
    orphans = report.get("orphans") or {}
    prs, branches = orphans.get("prs") or [], orphans.get("branches") or []
    if report.get("at"):
        details.append(f"Reconciled {report.get('at')}: {report.get('prs', 0)} PRs, {report.get('branches', 0)} branches; {len(report.get('changes') or [])} fix(es), {len(report.get('suggestions') or [])} to check.")
    if not report.get("at") or _age_min(str(report.get("at")), now) > STALE_MIN:
        return {"status": "warn", "summary": "The builds reconciler hasn't run lately: PRs and branches may not be linked to their builds.", "details": details + [
            "It runs at session start and every 10 min (cron axf-builds-reconcile). Run it: `node framework/cli/builds-reconcile.mjs --apply`."]}
    if report.get("error"):
        return {"status": "warn", "summary": f"The builds reconciler couldn't read GitHub: {str(report.get('error'))[:200]}", "details": details}
    if prs or branches:
        lines = [f"PR #{p.get('number')} {p.get('branch')}: {p.get('title')}" for p in prs[:12]] + [f"branch {b.get('branch')} ({b.get('ahead')} commits, no PR)" for b in branches[:12]]
        return {"status": "warn", "summary": f"{len(prs)} open PR(s) and {len(branches)} branch(es) belong to no build.", "details": details + lines + [
            "Add each to a build in the Build orchestrator (set its branch / PR), or close it."]}
    return {"status": "ok", "summary": f"Builds are live on main; every open PR belongs to a build ({queued} change(s) queued).", "details": details}


SEES_ID = "console-sees-builds"
LIVE_FRESH_MIN = 20  # a Build manager entry whose heartbeat is newer than this is a build running right now


def _changes_dir() -> Path:
    data = os.environ.get("AXF_DATA_DIR") or ""
    if data and data != "off":
        return Path(data) / "changes"
    return Path(os.environ.get("AXHUB_PROJECTS_DIR") or "/projects") / "amberx-axf" / "_data" / "changes"


def running_now(now: float | None = None, root: Path | None = None) -> list[str]:
    """Titles of Build manager (change-log@1) entries running right now: status running, heartbeat fresh. Independent of
    the builds store, so it still says builds are running when the console can't read the store."""
    now = now if now is not None else time.time()
    root = root or _changes_dir()
    out: list[str] = []
    months = {time.strftime("%Y/%m", time.gmtime(now)), time.strftime("%Y/%m", time.gmtime(now - 32 * 86400))}
    for m in months:
        for f in sorted((root / m).glob("chg-*.json")) if (root / m).is_dir() else []:
            try:
                e = json.loads(f.read_text())
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(e, dict) and e.get("status") == "running" and _age_min(str(e.get("lastSeenAt") or ""), now) < LIVE_FRESH_MIN:
                out.append(str(e.get("title") or f.stem)[:80])
    return out


def sees_probe(summary: dict[str, Any] | None = None, running: list[str] | None = None) -> dict[str, Any]:
    """Red when builds are running but the console reads zero builds (auto-land s5, Nov 3 2026: overview, build queue
    and plan said 0 while builds ran). `summary` = what the console's own engine read gives (build-queue.mjs)."""
    if summary is None:
        try:
            p = subprocess.run(["node", "--input-type=module", "-e", "import('./framework/cli/build-queue.mjs').then((m) => console.log(JSON.stringify(m.buildsSummary())))"],
                               cwd=ROOT, capture_output=True, text=True, timeout=30)
            summary = json.loads(p.stdout.strip().splitlines()[-1]) if p.stdout.strip() else {"error": (p.stderr or "no output")[-200:], "total": 0}
        except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError, IndexError) as e:
            summary = {"error": str(e)[:200], "total": 0}
    running = running_now() if running is None else running
    total = int((summary or {}).get("total") or 0)
    if running and total == 0:
        why = (summary or {}).get("error") or "the builds store read came back empty"
        return {"status": "error", "summary": f"The console sees 0 builds while {len(running)} build(s) run: {str(why)[:160]}",
                "details": [f"Running: {', '.join(running[:6])}", "Overview, Build queue and Plan read the builds store through framework/cli/build-queue.mjs (buildsSummary).",
                            "On the VPS: `node framework/cli/builds-store.mjs verify`, then `node framework/cli/builds-live.mjs sync` in /opt/axf."]}
    run_store = len((summary or {}).get("running") or [])
    return {"status": "ok", "summary": f"The console sees {total} build(s) ({run_store} running in the store, {len(running)} live in the Build manager).", "details": []}


_health_done = False


def ensure_health() -> bool:
    """Registers the live-sync item on the systems check once it provides axf.health@1 (plugins load in any order)."""
    global _health_done
    if _health_done:
        return True
    reg = plugin_services.get(HEALTH_CAP)
    if reg is None:
        return False
    try:
        reg.register({"id": HEALTH_ID, "label": "Builds reach main live", "service": "github", "order": 55, "severity": "error",
                      "run": lambda: health_probe(), "interval": 300,
                      "breaks": "The Build orchestrator, banners and THREADS on main show stale build status; finished work shows as pending.",
                      "instructions": ["`node framework/cli/builds-live.mjs status` / `flush` on the VPS.",
                                       "`node framework/cli/builds-reconcile.mjs` lists what it would link; `--apply` writes it (live)."]}, FOLDER)
        reg.register({"id": SEES_ID, "label": "Console sees the builds", "service": "console", "order": 56, "severity": "error",
                      "run": lambda: sees_probe(), "interval": 300,
                      "breaks": "Overview, Build queue and Plan (console and MCP) show 0 builds, so nobody sees what is running.",
                      "instructions": ["`node framework/cli/builds-store.mjs verify` on the VPS.", "`node framework/cli/builds-live.mjs sync` in /opt/axf brings main's store in."]}, FOLDER)
    except Exception:  # noqa: BLE001 — the orchestrator works without its health item
        return False
    _health_done = True
    return True


ensure_health()

