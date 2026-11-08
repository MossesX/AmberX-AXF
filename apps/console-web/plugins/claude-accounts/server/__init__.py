"""Server part of the Claude accounts plugin. Mounted at /api/plugins/claude-accounts/.

A thin, temporary front on the VPS host script `claude-account` (list | save <name> | use <name> | who). The Handoff 2
add-ons switcher replaces it. It only ever handles account names, the active marker and the email + plan the signed-in
Claude reports: the saved logins stay on the host and nothing here reads them.

  GET  accounts   { ready, why, accounts: [{name, active, email, plan}], active, login, loginChanged, pending, note, checked, expiresAt }
  GET  who        { active, email, plan }
  POST use        { name }: asks to switch (one held axHub vps.run, fixed command)
  POST save       { name }: asks to save the current login under that name (same)
  POST role       { name, role: worker | saved }: a worker only runs headless jobs and is never made active
  POST signin     { name }: asks to sign that account in, in its own folder, in a tmux session (held)
  POST remove     { name }: asks to set a saved account aside; it is moved, never deleted (held)
  POST label      { name, label }: a display name (Hulu, Moses X…)

Job routing (build workers-api-routing, Nov 8 2026): every subscription login is a worker unless stopped, the console's
account takes jobs after them (setting), 3 build and 5 wait per account, and API-key accounts take only the jobs a rule
sends them, under daily / weekly spend caps. The rules engine is deploy/worker-routing.mjs (run here with node, fixed
argv, JSON on stdin, never a shell), the same code the launcher uses, so the preview is what a launch would do.
  GET  routing           { config, accounts (role, kind, running, queued, limits, spend), alerts, fields }
  PUT  routing           { config }: the whole config
  POST routing/settings  { interactiveTakesJobs?, building?, queue? }
  POST routing/rule      { op: add|update|remove|move|enable|disable, id?, rule?, at?, to? }
  POST routing/api       { op: add|remove|enable|disable|caps, name, label?, dailyCapUsd?, weeklyCapUsd?, alertAt? }
  POST routing/test      { job: { jobType, model, priority, profile, steps, minutes } } → which account it would go to
Raising or removing a spend cap (or adding an API account without both caps) is Brett's own signed-in click: the
console token (sessions, MCP, voice) may lower a cap but never raise one.

Account health check (build account-health-failover, Nov 8 2026): deploy/claude-account-probe.mjs checks every account
on the host (a tiny bare session + free usage / models reads) and writes the ONE shared store account-status@1
(account-status.json in this plugin's data folder; deploy/account-status.mjs documents it). The console never runs it
itself: it writes account-probe-request.json there and the host's minute sweep starts the check (within a minute).
  GET  checks            { store (account-status@1), settings, request (waiting), summary }
  POST checks            { trigger: load|manual, accounts?: [names] }: ask for a check (load = skipped within the gap)
  POST checks/settings   { enabled?, intervalMin?, onLoad?, loadGapMin?, session?, apiMessage?, timeoutSec?, notifyRuns?, alertProblems? }
Capability axf.account-status@1 hands the store to other plugins (the usage badge): status(), able(name, model).

Capability axf.claude-accounts@1 gives other plugins the same view and the same held switch (AI keys lists these accounts
beside its own keys); it hands out names, types, emails and plans, never a credential.

Reads go over the Terminal's VPS host connection (capability axf.headless@1). Writes are one held axHub `vps.run` through
Vinny (axf.vinny@1), so nothing changes on the host until Brett's veto window or Approve in the Follow Amber pop-up.
Every command here is a constant plus a name that passed NAME, so no caller can reach a free-form shell.
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
from fastapi.concurrency import run_in_threadpool

import plugin_services

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
ROOT = Path(__file__).resolve().parents[5]  # the repo root
SCRIPT = "/usr/local/bin/claude-account"
NAME = re.compile(r"[a-z0-9-]{1,32}")
SEP = "---axf-accounts---"
WORKERS_CLI = "/opt/axf/deploy/claude-workers.mjs"
SEP2 = "---axf-workers---"
READ_COMMAND = (f'export PATH="$HOME/.local/bin:$PATH"; {SCRIPT} list; echo {SEP}; timeout 15 claude auth status 2>/dev/null || true; '
                f'echo {SEP2}; timeout 8 node {WORKERS_CLI} status --json 2>/dev/null || true')
COMMANDS = {"use": SCRIPT, "save": SCRIPT, "signin": f"node {WORKERS_CLI}", "remove": f"node {WORKERS_CLI}"}
READ_TTL_S = 30.0
PENDING_TTL_S = 180.0  # the 90 s veto countdown and some room; a call he denied clears by itself after this
LIST_LINE = re.compile(r"^(\*)?\s*([a-z0-9-]{1,32})(?: \[(token|api key)\])?(?: \(active\))?$")
TYPES = {"": "login", "token": "token", "api key": "api-key"}  # what `claude-account list` marks each row with
NOTE = "Running builds keep their account. New jobs go to the least busy worker, then the console's account; API keys only take jobs a routing rule sends them."
ROUTER = ROOT / "deploy" / "worker-routing.mjs"
ROLE_NAMES = ("interactive", "worker", "saved", "api-worker", "api-off")

_lock = threading.RLock()
_cache: dict[str, Any] = {"at": 0.0, "value": None}
_pending: dict[str, Any] | None = None


def _data() -> Path:
    return Path(os.environ.get("AXF_CLAUDE_ACCOUNTS_DATA_DIR") or (ROOT / ".axf-console" / "plugins" / FOLDER))


def _seen() -> dict[str, Any]:
    try:
        v = json.loads((_data() / "seen.json").read_text())
        return v if isinstance(v, dict) else {}
    except (OSError, ValueError):
        return {}


def _remember(name: str, login: dict[str, str]) -> None:
    seen = _seen()
    if seen.get(name) == login:
        return
    _data().mkdir(parents=True, exist_ok=True)
    (_data() / "seen.json").write_text(json.dumps({**seen, name: login}, indent=1))


def _raw_config() -> dict[str, Any]:
    try:
        v = json.loads((_data() / "workers.json").read_text())
        return v if isinstance(v, dict) else {}
    except (OSError, ValueError):
        return {}


def route(op: str, payload: dict[str, Any]) -> Any:
    """deploy/worker-routing.mjs <op> with JSON on stdin (fixed argv, no shell). Raises 503 when node or the file is missing."""
    try:
        p = subprocess.run(["node", str(ROUTER), op], input=json.dumps(payload), capture_output=True, text=True, timeout=20, cwd=str(ROOT))
    except (OSError, subprocess.TimeoutExpired) as e:
        raise HTTPException(503, f"The job router didn't run: {str(e)[:120]}") from None
    if p.returncode != 0:
        raise HTTPException(503, f"The job router failed: {(p.stderr or '').strip()[:200]}")
    return json.loads(p.stdout or "null")


def config() -> dict[str, Any]:
    """The routing config with every default filled in (claude-workers@1)."""
    return route("normalize", {"config": _raw_config()})


def workers() -> list[str]:
    """The subscription logins that take headless jobs, in order (from the host's view; config order when it can't be read)."""
    v = _read()
    host = v.get("host") or {}
    if host:
        return [n for n, h in host.items() if h.get("role") == "worker"]
    cfg = _raw_config()
    return [n for n in cfg.get("workers") or [] if isinstance(n, str) and NAME.fullmatch(n) and n not in (cfg.get("excluded") or [])]


def _save_config(new: dict[str, Any], who: str, owner: bool) -> dict[str, Any]:
    """Normalise and write workers.json. A raised or removed spend cap needs Brett's own click (owner)."""
    with _lock:
        before = _raw_config()
        raised = route("raised", {"before": before, "after": new})
        if raised and not owner:
            raise HTTPException(403, f"Raising a spend cap is Brett's own click in the console ({'; '.join(raised)[:300]}). Lowering one is fine.")
        cfg = route("normalize", {"config": new})
        _data().mkdir(parents=True, exist_ok=True)
        tmp = _data() / f"workers.json.{os.getpid()}.tmp"
        tmp.write_text(json.dumps(cfg, indent=1))
        tmp.replace(_data() / "workers.json")
    _forget_read()
    return cfg


def _save_workers(names: list[str]) -> None:
    """Older callers: `names` take jobs, every other saved subscription login is stopped."""
    cfg = _raw_config()
    known = [n for n in _read().get("names", []) if n not in names]
    _save_config({**cfg, "workers": names, "excluded": [n for n in known if n not in names]}, "console", True)


def parse_workers(text: str) -> dict[str, dict[str, Any]]:
    """`claude-workers.mjs status --json` → name → what the host knows: limit, running jobs, runs, cost. Nothing else passes."""
    try:
        v = json.loads(text or "{}")
    except ValueError:
        return {}
    rows = v.get("accounts") if isinstance(v, dict) else None
    out: dict[str, dict[str, Any]] = {}
    for a in rows if isinstance(rows, list) else []:
        if not isinstance(a, dict) or not isinstance(a.get("name"), str):
            continue
        lim = a.get("limited") if isinstance(a.get("limited"), dict) else None
        sp = a.get("spend") if isinstance(a.get("spend"), dict) else None
        home = a.get("home") if isinstance(a.get("home"), dict) else None
        out[a["name"]] = {"limited": {**{k: str(lim.get(k) or "")[:60] for k in ("until", "kind", "reason", "at")}, "untilSignin": bool(lim.get("untilSignin"))} if lim else None,
                          "home": {k: str(home.get(k) or "")[:80] for k in ("lastRefreshAt", "lastRefreshBy", "expiresAt")} if home else None,
                          "role": str(a.get("role") or "") if a.get("role") in ROLE_NAMES else "", "kind": "api" if a.get("kind") == "api" else "subscription",
                          "label": str(a.get("label") or "")[:40], "queued": int(a.get("queued") or 0), "building": int(a.get("building") or 0), "queue": int(a.get("queue") or 0),
                          "hasKey": a.get("hasKey") is not False, "why": str(a.get("why") or "")[:200], "takesJobs": bool(a.get("takesJobs")),
                          "spend": {k: (float(sp.get(k) or 0) if k not in ("state", "why") else str(sp.get(k) or "")[:120]) for k in ("day", "week", "dayCap", "weekCap", "alertAt", "state", "why")} if sp else None,
                          "running": [str(s)[:80] for s in a.get("running") or []][:20], "runsToday": int(a.get("runsToday") or 0),
                          "costToday": float(a.get("costToday") or 0), "costWeek": float(a.get("costWeek") or 0),
                          "email": str(a.get("email") or "")[:200], "plan": str(a.get("plan") or "")[:40],
                          "models": [m for m in a.get("models") or [] if m in ("opus", "fable")] if isinstance(a.get("models"), list) else None,
                          "recent": [{k: r.get(k) for k in ("session", "name", "agent", "model", "at", "end", "exit", "costUsd")} for r in (a.get("recent") or [])[:5] if isinstance(r, dict)]}
    return out


EVENT_KEYS = ("at", "action", "account", "kind", "reason", "build", "to", "movedTo", "until", "stopped", "waiting")


def parse_events(text: str) -> list[dict[str, Any]]:
    """The host's recent account events (out / move / back), newest first; names, kinds and times only."""
    try:
        v = json.loads(text or "{}")
    except ValueError:
        return []
    ev = v.get("events") if isinstance(v, dict) else None
    return [{k: (e.get(k) if isinstance(e.get(k), bool) else str(e.get(k) or "")[:120]) for k in EVENT_KEYS if k in e} for e in (ev if isinstance(ev, list) else [])[:20] if isinstance(e, dict)]


def clean_name(raw: Any) -> str:
    """The name asked for, or 400. Spoken names come as "Account 2": lower case, spaces to dashes, then the one rule."""
    name = re.sub(r"\s+", "-", raw.strip().lower()) if isinstance(raw, str) else ""
    if not NAME.fullmatch(name):
        raise HTTPException(400, "A name is 1 to 32 lower-case letters, digits or dashes.")
    return name


def parse_list(text: str) -> tuple[list[str], str, dict[str, str]]:
    """`claude-account list` → (names, active name, name → type). Anything that isn't a well-formed row is dropped."""
    names, active, types = [], "", {}
    for line in (text or "").splitlines():
        m = LIST_LINE.match(line.rstrip())
        if m:
            names.append(m.group(2))
            types[m.group(2)] = TYPES[m.group(3) or ""]
            if m.group(1):
                active = m.group(2)
    return names, active, types


def parse_login(text: str) -> dict[str, str]:
    """`claude auth status` → only {email, plan}: every other field stays out of this process's answers."""
    try:
        v = json.loads(text or "{}")
    except ValueError:
        return {}
    if not isinstance(v, dict) or not v.get("loggedIn"):
        return {}
    return {"email": str(v.get("email") or "")[:200], "plan": str(v.get("subscriptionType") or "")[:40]}


def parse_status(text: str) -> dict[str, Any]:
    """`claude auth status` → {checked, expiresAt}: did it answer at all, and when the login runs out (ISO, "" when it didn't say)."""
    try:
        v = json.loads(text or "")
    except ValueError:
        return {"checked": False, "expiresAt": ""}
    if not isinstance(v, dict):
        return {"checked": False, "expiresAt": ""}
    return {"checked": True, "expiresAt": str(v.get("loginExpiresAt") or "")[:40]}


def _read() -> dict[str, Any]:
    """The accounts on the host now (30 s cache, shared by every console and the banner chip)."""
    with _lock:
        now = time.time()
        if _cache["value"] is not None and now - _cache["at"] < READ_TTL_S:
            return _cache["value"]
        svc = plugin_services.get("axf.headless@1")
        if svc is None or not hasattr(svc, "vps_read"):
            r: dict[str, Any] = {"ready": False, "out": "", "why": "The Terminal plugin is off or too old, so the console can't reach the VPS host."}
        else:
            r = svc.vps_read(READ_COMMAND, 25)
        listing, _, rest = str(r.get("out") or "").partition(SEP)
        status, _, hosted = rest.partition(SEP2)
        names, active, types = parse_list(listing)
        value = {"ready": bool(r.get("ready")), "why": str(r.get("why") or "")[:200], "names": names, "active": active, "types": types, "login": parse_login(status.strip()), **parse_status(status.strip()), "host": parse_workers(hosted.strip()), "events": parse_events(hosted.strip())}
        _cache.update(at=now, value=value)
        return value


def _forget_read() -> None:
    with _lock:
        _cache.update(at=0.0, value=None)


def _pending_now(names: list[str] | None = None, active: str = "") -> dict[str, Any] | None:
    """The call waiting for Brett, until it took effect or its time ran out."""
    global _pending
    with _lock:
        p = _pending
        if p and (time.time() - p["at"] > PENDING_TTL_S or (names is not None and p["name"] in names and p["name"] == active and p["op"] == "use")):
            _pending = p = None
        return dict(p) if p else None


def view() -> dict[str, Any]:
    v = _read()
    names, active, login = v["names"], v["active"], v["login"]
    pending = _pending_now(names, active)
    seen = _seen()
    known = seen.get(active) if active else None
    saving_over = bool(pending and pending["op"] == "save" and pending["name"] == active)
    changed = bool(login.get("email") and known and known.get("email") and known["email"] != login["email"] and not saving_over)
    if active and login.get("email") and not changed:
        _remember(active, login)
        seen[active] = login
    idle = {"limited": None, "home": None, "models": None, "running": [], "runsToday": 0, "costToday": 0.0, "costWeek": 0.0, "recent": [], "label": "", "queued": 0, "building": 0, "queue": 0, "spend": None, "why": "", "takesJobs": False}

    def row(n: str) -> dict[str, Any]:
        host = v["host"].get(n, {})
        kind = "api" if v["types"].get(n) == "api-key" or host.get("kind") == "api" else "subscription"
        role = "interactive" if n == active else host.get("role") or ("saved" if kind == "subscription" else "api-off")
        return {"name": n, "active": n == active, "type": v["types"].get(n, "api-key" if kind == "api" else "login"), "kind": kind, "hasKey": host.get("hasKey", True),
                "email": str((seen.get(n) or {}).get("email") or host.get("email") or ""),
                "plan": str((seen.get(n) or {}).get("plan") or host.get("plan") or ""), "role": role,
                **{k: host.get(k, d) for k, d in idle.items()}}

    names = names + [n for n in v["host"] if n not in names]   # API worker slots whose key isn't saved yet
    rows = [row(n) for n in names]
    store = health_store()
    for r in rows:
        r["health"] = store["accounts"].get(r["name"])
    return {"ok": True, "ready": v["ready"], "why": v["why"], "accounts": rows, "active": active, "login": login, "loginChanged": changed, "pending": pending, "note": NOTE,
            "checked": v["checked"], "expiresAt": v["expiresAt"], "events": v.get("events") or [], "failover": failover_settings()}


def _who(request: Request) -> str:
    """The caller's name when it is the owner (his signed-in session or the console token); anyone else → 403."""
    user = getattr(request.state, "axf_user", None)
    if user is None:
        return "console"
    if getattr(user, "admin", False):
        return str(getattr(user, "name", "") or "owner")
    raise HTTPException(403, "Claude accounts is for the owner only.")


async def _name(request: Request) -> str:
    try:
        b = await request.json()
    except ValueError:
        b = {}
    return clean_name(b.get("name") if isinstance(b, dict) else "")


def outcome(r: dict[str, Any]) -> dict[str, Any]:
    """What axHub answered for one vps.run: ran already (a No wait pass), or held for Brett. The host's output is never passed on."""
    if "confirm" in r:
        return {"state": "waiting"}
    text = str(r.get("ok") or "")
    code = re.search(r"^exit (-?\d+)\b", text, re.M)
    if code:
        return {"state": "done"} if code.group(1) == "0" else {"state": "failed", "message": f"The VPS command failed (exit {code.group(1)})."}
    return {"state": "waiting"}


def ask(op: str, name: str, by: str) -> dict[str, Any]:
    """One held call: `claude-account <op> <name>`, the name already checked. A repeat of the same ask sends nothing."""
    global _pending
    v = view()
    if v["ready"] and op == "use" and name not in [a["name"] for a in v["accounts"]]:
        raise HTTPException(404, f"No saved account called {name}.")
    row = next((a for a in v["accounts"] if a["name"] == name), None)
    # Since Nov 8 2026 every subscription login is a worker: switching the console to one makes it the interactive
    # account (it still takes headless jobs after the workers while that setting is on).
    if op == "remove":
        if not row:
            raise HTTPException(404, f"No saved account called {name}.")
        if row["active"]:
            raise HTTPException(409, f"{name} is the console's account: switch to another one first.")
        if row["running"]:
            raise HTTPException(409, f"{name} is running {len(row['running'])} job(s): wait for them to finish.")
    if op == "use" and name == v["active"]:
        return {"ok": True, "state": "done", "name": name, "message": f"{name} is already the active account.", "note": NOTE}
    if op == "use" and v["loginChanged"]:
        raise HTTPException(409, f"The login on the VPS is no longer {v['active']}: save it under its own name first, or the switch writes it over {v['active']}.")
    p = _pending_now()
    if p and p["op"] == op and p["name"] == name:
        return {"ok": True, "state": "waiting", "name": name, "message": "That is already waiting for your approval.", "note": NOTE, "pending": p}
    if p:
        raise HTTPException(409, f"{p['op']} {p['name']} is still waiting for your approval.")
    svc = plugin_services.get("axf.vinny@1")
    if svc is None:
        raise HTTPException(503, "Switching goes through Vinny: turn the Agent manager on.")
    ready, why = svc.ready()
    if not ready:
        raise HTTPException(503, f"Vinny can't reach axHub: {why}")
    what = {"use": f"Switch Claude on the VPS to {name}", "save": f"Save the current Claude login as {name}",
            "signin": f"Start the Claude sign-in for {name}", "remove": f"Set the saved Claude account {name} aside"}[op]
    try:
        r = svc.call("vps.run", {"command": f"{COMMANDS[op]} {op} {name}", "timeout_seconds": 30}, reason=f"{what} (asked by {by})"[:200])
    except Exception as e:  # noqa: BLE001 — say what went wrong, plainly
        raise HTTPException(502, f"axHub didn't take it: {str(e)[:200]}") from None
    o = outcome(r)
    _forget_read()
    if o["state"] == "waiting":
        with _lock:
            _pending = {"op": op, "name": name, "by": by, "at": time.time()}
        return {"ok": True, **o, "name": name, "message": f"{what}: waiting for your approval (Follow Amber pop-up or axHub). It runs after the countdown unless you deny it.", "note": NOTE}
    return {"ok": o["state"] == "done", **o, "name": name, "message": o.get("message", f"{what}: done."), "note": NOTE}


@router.get("/accounts")
def accounts(request: Request) -> dict[str, Any]:
    _who(request)
    return view()


@router.get("/who")
def who(request: Request) -> dict[str, Any]:
    _who(request)
    v = view()
    row = next((a for a in v["accounts"] if a["active"]), {})
    return {"ok": True, "ready": v["ready"], "active": v["active"], "email": row.get("email", ""), "plan": row.get("plan", "")}


@router.post("/use")
async def use(request: Request) -> dict[str, Any]:
    by = _who(request)
    name = await _name(request)
    return await run_in_threadpool(ask, "use", name, by)


@router.post("/save")
async def save(request: Request) -> dict[str, Any]:
    by = _who(request)
    name = await _name(request)
    return await run_in_threadpool(ask, "save", name, by)


@router.post("/role")
async def role(request: Request) -> dict[str, Any]:
    _who(request)
    try:
        b = await request.json()
    except ValueError:
        b = {}
    b = b if isinstance(b, dict) else {}
    name, want = clean_name(b.get("name")), b.get("role")
    if want not in ("worker", "saved"):
        raise HTTPException(400, "role is worker or saved.")
    v = await run_in_threadpool(view)
    row = next((a for a in v["accounts"] if a["name"] == name), None)
    if want == "worker":
        if not row:
            raise HTTPException(404, f"No saved account called {name}.")
        if row["active"]:
            raise HTTPException(409, f"{name} is the console's account: it takes headless jobs after the workers (Job routing → Console account takes jobs).")
        if row["kind"] == "api":
            raise HTTPException(409, "An API key bills per token: set it up under Job routing → API accounts, and it only takes jobs a rule sends it.")

    def change() -> dict[str, Any]:
        cfg = _raw_config()
        order = [n for n in cfg.get("workers") or [] if n != name]
        excluded = [n for n in cfg.get("excluded") or [] if n != name]
        return _save_config({**cfg, "workers": order + [name] if want == "worker" else order, "excluded": excluded if want == "worker" else excluded + [name]}, "console", True)

    await run_in_threadpool(change)
    return {"ok": True, "name": name, "role": want, "message": f"{name} takes headless jobs." if want == "worker" else f"{name} no longer takes headless jobs."}


def _body_dict(b: Any) -> dict[str, Any]:
    return b if isinstance(b, dict) else {}


async def _body(request: Request) -> dict[str, Any]:
    try:
        return _body_dict(await request.json())
    except ValueError:
        return {}


def _owner(request: Request) -> bool:
    """Brett's own signed-in session (not the console token, which sessions, MCP and voice use)."""
    user = getattr(request.state, "axf_user", None)
    return bool(user is not None and getattr(user, "admin", False))


def routing_view() -> dict[str, Any]:
    v = view()
    cfg = config()
    host_rows = [{"name": a["name"], "kind": a["kind"], "active": a["active"], "hasKey": a.get("hasKey", True), "limited": a["limited"], "running": len(a["running"]),
                  "queued": a["queued"], "costToday": a["costToday"], "costWeek": a["costWeek"]} for a in v["accounts"]]
    return {"ok": True, "ready": v["ready"], "why": v["why"], "config": cfg, "accounts": v["accounts"], "alerts": route("alerts", {"config": cfg, "accounts": host_rows}),
            "fields": {"jobTypes": _job_types(), "models": ["fable", "opus"], "priorities": ["P0", "P1", "P2", "P3"], "profiles": ["all"], "subs": ["any", "busy"]}, "note": NOTE}


def _job_types() -> list[str]:
    """build (orchestrator builds), agent-job, and every job-type@1 asset id (framework/assets/job-type)."""
    out = ["build", "agent-job"]
    try:
        out += sorted(p.stem for p in (ROOT / "framework" / "assets" / "job-type").glob("*.json"))
    except OSError:
        pass
    return out


def preview(job: Any) -> dict[str, Any]:
    v = view()
    rows = [{"name": a["name"], "kind": a["kind"], "active": a["active"], "hasKey": a.get("hasKey", True), "limited": a["limited"],
             "running": len(a["running"]) + int(a.get("queued") or 0), "queued": a["queued"], "costToday": a["costToday"], "costWeek": a["costWeek"]} for a in v["accounts"]]
    return route("decide", {"config": _raw_config(), "accounts": rows, "job": _body_dict(job)})


@router.get("/routing")
def get_routing(request: Request) -> dict[str, Any]:
    _who(request)
    return routing_view()


@router.put("/routing")
async def put_routing(request: Request) -> dict[str, Any]:
    by = _who(request)
    b = await _body(request)
    cfg = await run_in_threadpool(_save_config, _body_dict(b.get("config")), by, _owner(request))
    return {"ok": True, "config": cfg, "message": "Job routing saved."}


@router.post("/routing/settings")
async def routing_settings(request: Request) -> dict[str, Any]:
    by = _who(request)
    b = await _body(request)

    def change() -> dict[str, Any]:
        cfg = config()
        if "interactiveTakesJobs" in b:
            cfg["interactiveTakesJobs"] = bool(b["interactiveTakesJobs"])
        for k in ("building", "queue"):
            if k in b:
                cfg["limits"][k] = b[k]
        return _save_config(cfg, by, _owner(request))

    cfg = await run_in_threadpool(change)
    return {"ok": True, "config": cfg, "message": f"Console account takes jobs: {'on' if cfg['interactiveTakesJobs'] else 'off'} · {cfg['limits']['building']} building · {cfg['limits']['queue']} queued per account."}


@router.post("/routing/rule")
async def routing_rule(request: Request) -> dict[str, Any]:
    by = _who(request)
    b = await _body(request)
    op, rid = b.get("op"), str(b.get("id") or "")

    def change() -> dict[str, Any]:
        cfg = config()
        rules = cfg["rules"]
        idx = next((i for i, r in enumerate(rules) if r["id"] == rid), -1)
        if op != "add" and idx < 0:
            raise HTTPException(404, f"No rule {rid or '(no id)'}.")
        if op == "add":
            at = b.get("at")
            rules.insert(max(0, min(len(rules), int(at))) if isinstance(at, int) else len(rules), _body_dict(b.get("rule")))
        elif op == "update":
            r = _body_dict(b.get("rule"))
            rules[idx] = {**rules[idx], **r, "when": {**rules[idx]["when"], **_body_dict(r.get("when"))}, "id": rid}
        elif op == "remove":
            rules.pop(idx)
        elif op in ("enable", "disable"):
            rules[idx]["enabled"] = op == "enable"
        elif op == "move":
            to = b.get("to")
            dest = idx - 1 if to == "up" else idx + 1 if to == "down" else int(to) if isinstance(to, int) else idx
            rules.insert(max(0, min(len(rules) - 1, dest)), rules.pop(idx))
        else:
            raise HTTPException(400, "op is add, update, remove, move, enable or disable.")
        return _save_config(cfg, by, _owner(request))

    cfg = await run_in_threadpool(change)
    return {"ok": True, "rules": cfg["rules"], "message": f"Rule {op}: done."}


@router.post("/routing/api")
async def routing_api(request: Request) -> dict[str, Any]:
    by = _who(request)
    b = await _body(request)
    op, name = b.get("op"), clean_name(b.get("name"))

    def change() -> dict[str, Any]:
        cfg = config()
        api = cfg["api"]
        if op == "add":
            api[name] = {"label": str(b.get("label") or api.get(name, {}).get("label") or name)[:40], "enabled": True,
                         "dailyCapUsd": b.get("dailyCapUsd", 0), "weeklyCapUsd": b.get("weeklyCapUsd", 0), "alertAt": b.get("alertAt", 0.8)}
        elif name not in api:
            raise HTTPException(404, f"{name} is not an API account here: add it first.")
        elif op == "remove":
            api.pop(name)
        elif op in ("enable", "disable"):
            api[name]["enabled"] = op == "enable"
        elif op == "caps":
            for k in ("dailyCapUsd", "weeklyCapUsd", "alertAt", "label"):
                if k in b:
                    api[name][k] = b[k]
        else:
            raise HTTPException(400, "op is add, remove, enable, disable or caps.")
        return _save_config(cfg, by, _owner(request))

    cfg = await run_in_threadpool(change)
    a = cfg["api"].get(name)
    msg = f"{a['label'] or name}: {'on' if a['enabled'] else 'off'} · ${a['dailyCapUsd']}/day · ${a['weeklyCapUsd']}/week" if a else f"{name} is no longer an API account."
    return {"ok": True, "api": cfg["api"], "message": msg}


@router.post("/routing/test")
async def routing_test(request: Request) -> dict[str, Any]:
    _who(request)
    b = await _body(request)
    d = await run_in_threadpool(preview, b.get("job") if "job" in b else b)
    return {"ok": True, **d}


@router.post("/label")
async def label(request: Request) -> dict[str, Any]:
    by = _who(request)
    b = await _body(request)
    name, text = clean_name(b.get("name")), str(b.get("label") or "").strip()[:40]

    def change() -> dict[str, Any]:
        cfg = config()
        if name in cfg["api"]:
            cfg["api"][name]["label"] = text
        else:
            cfg["perAccount"][name] = {**cfg["perAccount"].get(name, {}), "label": text}
        return _save_config(cfg, by, True)

    await run_in_threadpool(change)
    return {"ok": True, "name": name, "label": text, "message": f"{name} is shown as {text or name}."}


@router.post("/signin")
async def signin(request: Request) -> dict[str, Any]:
    by = _who(request)
    name = await _name(request)
    return await run_in_threadpool(ask, "signin", name, by)


@router.post("/remove")
async def remove(request: Request) -> dict[str, Any]:
    by = _who(request)
    name = await _name(request)
    return await run_in_threadpool(ask, "remove", name, by)


FAILOVER_DEFAULTS = {"enabled": True, "maxMoves": 6, "waitMinutes": 720, "alerts": True, "alertOnLimit": True}  # = worker-routing.mjs FAILOVER_DEFAULTS
FAILOVER_RANGES = {"maxMoves": (0, 20), "waitMinutes": (0, 2880)}


def failover_settings() -> dict[str, Any]:
    """Failover settings with defaults filled in (the same rules as normFailover in deploy/worker-routing.mjs)."""
    raw = _raw_config().get("failover")
    raw = raw if isinstance(raw, dict) else {}
    out = dict(FAILOVER_DEFAULTS)
    for k in ("enabled", "alerts", "alertOnLimit"):
        out[k] = raw.get(k) is not False
    for k, (lo, hi) in FAILOVER_RANGES.items():
        try:
            out[k] = min(hi, max(lo, int(round(float(raw[k])))))
        except (KeyError, TypeError, ValueError):
            pass
    return out


@router.get("/failover")
def get_failover(request: Request) -> dict[str, Any]:
    _who(request)
    v = view()
    return {"ok": True, "failover": failover_settings(), "events": v.get("events") or [],
            "out": [{"name": a["name"], "label": a.get("label") or "", "email": a["email"], **(a["limited"] or {})} for a in v["accounts"] if a.get("limited")],
            "logins": [{"name": a["name"], "email": a["email"], **(a.get("home") or {})} for a in v["accounts"] if a.get("home")]}


@router.post("/failover")
async def set_failover(request: Request) -> dict[str, Any]:
    """{ enabled?, maxMoves?, waitMinutes?, alerts?, alertOnLimit? }: what happens when an account stops a build."""
    by = _who(request)
    b = _body_dict(await _body(request))

    def change() -> dict[str, Any]:
        cfg = _raw_config()
        f = dict(failover_settings())
        for k in ("enabled", "alerts", "alertOnLimit"):
            if k in b:
                if not isinstance(b[k], bool):
                    raise HTTPException(400, f"{k} is true or false.")
                f[k] = b[k]
        for k, (lo, hi) in FAILOVER_RANGES.items():
            if k in b:
                try:
                    n = int(b[k])
                except (TypeError, ValueError):
                    raise HTTPException(400, f"{k} is a whole number from {lo} to {hi}.") from None
                if not lo <= n <= hi:
                    raise HTTPException(400, f"{k} is a whole number from {lo} to {hi}.")
                f[k] = n
        return _save_config({**cfg, "failover": f}, by, _owner(request)).get("failover") or f

    return {"ok": True, "failover": await run_in_threadpool(change)}


def _clear_limit(name: str) -> bool:
    """Take an account out of worker-state.json's limits (the host's lock file, so the launcher never loses a claim)."""
    state_file = _data() / "worker-state.json"
    lock = Path(f"{state_file}.lock")
    deadline = time.time() + 15
    while True:
        try:
            os.close(os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600))
            break
        except FileExistsError:
            try:
                if time.time() - lock.stat().st_mtime > 10:
                    lock.unlink(missing_ok=True)
                    continue
            except OSError:
                continue
            if time.time() > deadline:
                raise HTTPException(503, "The worker state is locked: try again in a moment.") from None
            time.sleep(0.05)
    try:
        try:
            st = json.loads(state_file.read_text())
        except (OSError, ValueError):
            return False
        limits = st.get("limits") if isinstance(st, dict) else None
        if not isinstance(limits, dict) or name not in limits:
            return False
        del limits[name]
        tmp = Path(f"{state_file}.{os.getpid()}.tmp")
        tmp.write_text(json.dumps(st, indent=1))
        tmp.replace(state_file)
        return True
    finally:
        lock.unlink(missing_ok=True)


def _resolve_alerts(name: str) -> None:
    try:
        import main  # noqa: PLC0415 — the console core (only inside the console process)
        hub = getattr(main, "ALERTS", None)
        if hub:
            hub.resolve([f"claude-accounts:account:{name}:{k}" for k in ("auth", "usage", "credits")])
    except Exception:  # noqa: BLE001 — the alert closing never stops the change
        pass


@router.post("/clear")
async def clear(request: Request) -> dict[str, Any]:
    """{ name }: bring an account back in now (signed in again, topped up). Its phone alert closes."""
    _who(request)
    name = await _name(request)
    had = await run_in_threadpool(_clear_limit, name)
    if had:
        _resolve_alerts(name)
    _forget_read()
    return {"ok": True, "name": name, "cleared": had, "message": f"{name} takes jobs again." if had else f"{name} was not out."}


LOGINS_COMMAND = "timeout 15 node /opt/axf/deploy/claude-home.mjs audit --json 2>/dev/null || echo []"


@router.get("/logins")
def logins(request: Request) -> dict[str, Any]:
    """One home per login: every place a login is kept on the host (home, live login, build copies) and whether it is in step."""
    _who(request)
    svc = plugin_services.get("axf.headless@1")
    if svc is None or not hasattr(svc, "vps_read"):
        raise HTTPException(503, "The Terminal plugin is off, so the console can't reach the VPS host.")
    r = svc.vps_read(LOGINS_COMMAND, 20)
    try:
        rows = json.loads(str(r.get("out") or "[]").strip() or "[]")
    except ValueError:
        rows = []
    keep = ("kind", "session", "owner", "token", "expiresAt", "state")   # token = a 12-character hash prefix, never a credential
    out = [{k: str(x.get(k) or "")[:80] for k in keep} for x in rows if isinstance(x, dict)][:200]
    return {"ok": True, "ready": bool(r.get("ready")), "logins": out, "behind": sum(1 for x in out if x["state"] == "behind"), "foreign": sum(1 for x in out if x["state"] == "foreign")}


def worker_health() -> dict[str, Any]:
    """Systems check: a job needs an account that can run it."""
    v = view()
    if not v["ready"]:
        return {"status": "unknown", "summary": v["why"] or "Can't read the VPS host.", "unreachable": True}
    rows = [a for a in v["accounts"] if a["kind"] == "subscription" and a.get("takesJobs", a["role"] == "worker")]
    if not rows:
        return {"status": "warn", "summary": "No subscription account takes headless jobs: Job routing → Workers."}
    free = [a for a in rows if not a["limited"]]
    if free:
        return {"status": "ok", "summary": f"{len(free)} of {len(rows)} Claude accounts can take headless jobs."}
    ends = sorted(a["limited"]["until"] for a in rows if a["limited"])
    return {"status": "error", "summary": f"No Claude account can take jobs{f' until {ends[0]}' if ends else ''}: new builds wait or run on the console's account."}


def login_health() -> dict[str, Any]:
    """Systems check: a saved login that died (expired, could not be renewed) stays out of every job until it is signed in."""
    v = view()
    if not v["ready"]:
        return {"status": "unknown", "summary": v["why"] or "Can't read the VPS host.", "unreachable": True}
    dead = [a for a in v["accounts"] if (a.get("limited") or {}).get("untilSignin")]
    if not dead:
        return {"status": "ok", "summary": "Every saved Claude login works (or comes back by itself)."}
    names = ", ".join(f"{a['name']}{' (' + a['email'] + ')' if a.get('email') else ''}" for a in dead)
    since = min(str((a["limited"] or {}).get("at") or "") for a in dead)
    return {"status": "error", "summary": f"Claude login dead, needs signing in: {names}{' (since ' + since[:16].replace('T', ' ') + ' UTC)' if since else ''}. Builds skip it and run on the other accounts."}


def api_health() -> dict[str, Any]:
    """Systems check: API accounts near or over a spend cap, or set up without a key."""
    try:
        alerts = routing_view()["alerts"]
    except HTTPException as e:
        return {"status": "unknown", "summary": str(e.detail)[:200], "unreachable": True}
    if not alerts:
        return {"status": "ok", "summary": "API accounts are under their spend caps."}
    worst = "error" if any(a["level"] == "error" for a in alerts) else "warn"
    return {"status": worst, "summary": "; ".join(a["text"] for a in alerts)[:300]}


# ── Account health check (account-status@1) ──────────────────────────────────────────────────────────────────────

STATUSES = ("ok", "limited", "no-credits", "expired", "unknown")
STATUS_LABELS = {"ok": "ok", "limited": "limited", "no-credits": "no credits", "expired": "login expired", "unknown": "not checked"}
PROBE_DEFAULTS = {"enabled": True, "intervalMin": 60, "onLoad": True, "loadGapMin": 15, "session": True, "apiMessage": True, "timeoutSec": 60,
                  "notifyRuns": "load", "alertProblems": True}   # = worker-routing.mjs PROBE_DEFAULTS
PROBE_RANGES = {"intervalMin": (10, 1440), "loadGapMin": (0, 240), "timeoutSec": (15, 300)}
PROBE_BOOLS = ("enabled", "onLoad", "session", "apiMessage", "alertProblems")
NOTIFY_RUNS = ("load", "all", "off")
MAX_AGE_S = 6 * 3600   # = account-status.mjs MAX_AGE_MS


def probe_settings() -> dict[str, Any]:
    """The account check settings with defaults filled in (normProbe in deploy/worker-routing.mjs)."""
    raw = _raw_config().get("probe")
    raw = raw if isinstance(raw, dict) else {}
    out = dict(PROBE_DEFAULTS)
    for k in PROBE_BOOLS:
        out[k] = raw.get(k) is not False
    for k, (lo, hi) in PROBE_RANGES.items():
        try:
            out[k] = min(hi, max(lo, int(round(float(raw[k])))))
        except (KeyError, TypeError, ValueError):
            pass
    out["notifyRuns"] = raw.get("notifyRuns") if raw.get("notifyRuns") in NOTIFY_RUNS else PROBE_DEFAULTS["notifyRuns"]
    return out


def health_store() -> dict[str, Any]:
    """account-status.json as every reader sees it (bad rows dropped). Never holds a credential."""
    try:
        v = json.loads((_data() / "account-status.json").read_text())
    except (OSError, ValueError):
        v = {}
    v = v if isinstance(v, dict) else {}
    accounts = {}
    for n, e in (v.get("accounts") or {}).items() if isinstance(v.get("accounts"), dict) else []:
        if isinstance(n, str) and NAME.fullmatch(n) and isinstance(e, dict):
            accounts[n] = {**e, "name": n, "status": e.get("status") if e.get("status") in STATUSES else "unknown"}
    run = v.get("run") if isinstance(v.get("run"), dict) else None
    return {"$axf": "account-status@1", "updatedAt": str(v.get("updatedAt") or ""), "run": run, "accounts": accounts}


def _iso_s(v: Any) -> float:
    try:
        from datetime import datetime  # noqa: PLC0415
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return 0.0


def able(entry: dict[str, Any] | None, model: str = "", now: float | None = None) -> dict[str, Any]:
    """Can this account take a job (with this model)? The same answer as ableFor in deploy/account-status.mjs (login
    changes are checked on the host; here an expired login stays expired until the next check or a sign-in)."""
    now = time.time() if now is None else now
    if not entry or not entry.get("checkedAt"):
        return {"ok": True, "why": "not checked yet", "status": "unknown"}
    age = now - _iso_s(entry["checkedAt"])
    st = entry.get("status")
    if st == "expired":
        if entry.get("source") == "probe" and age > MAX_AGE_S:
            return {"ok": True, "why": "expired at the last check, a while ago", "status": "unknown"}
        return {"ok": False, "why": f"login expired ({entry.get('why') or 'checked ' + entry['checkedAt']})", "status": st}
    if st in ("limited", "no-credits"):
        back = _iso_s(entry.get("until"))
        if back and back <= now:
            return {"ok": True, "why": f"{STATUS_LABELS[st]} until {entry['until']}, should be back", "status": "unknown"}
        if not back and age > MAX_AGE_S:
            return {"ok": True, "why": f"{STATUS_LABELS[st]} at the last check, a while ago", "status": "unknown"}
        return {"ok": False, "why": f"{STATUS_LABELS[st]}{' until ' + entry['until'] if entry.get('until') else ''}", "status": st}
    m = str(model or "").lower()
    if m and isinstance(entry.get("models"), list) and age <= MAX_AGE_S and m not in entry["models"]:
        return {"ok": False, "why": f"can't use {m} now", "status": st, "model": True}
    return {"ok": True, "why": "ok at the last check" if st == "ok" else "not checked yet", "status": st}


def health_summary(store: dict[str, Any] | None = None) -> dict[str, Any]:
    store = store or health_store()
    counts: dict[str, int] = {}
    for e in store["accounts"].values():
        counts[e["status"]] = counts.get(e["status"], 0) + 1
    text = ", ".join(f"{counts[s]} {STATUS_LABELS[s]}" for s in STATUSES if counts.get(s))
    return {"counts": counts, "total": len(store["accounts"]), "text": text or "no account checked yet"}


def _request_file() -> Path:
    return _data() / "account-probe-request.json"


def request_check(trigger: str, accounts: list[str], by: str, now: float | None = None) -> dict[str, Any]:
    """Ask the host for a check (it starts within a minute). A console load inside the gap is skipped."""
    now = time.time() if now is None else now
    if trigger not in ("load", "manual"):
        raise HTTPException(400, "trigger is load or manual.")
    bad = [a for a in accounts if not isinstance(a, str) or not NAME.fullmatch(a)]
    if bad:
        raise HTTPException(400, f"not an account name: {bad[0]!r}"[:120])
    cfg = probe_settings()
    run = health_store()["run"] or {}
    if trigger == "load":
        if not cfg["onLoad"]:
            return {"ok": True, "queued": False, "skipped": "checking on console load is off"}
        last = max(_iso_s(run.get("finishedAt")), _iso_s(run.get("startedAt")))
        if last and now - last < cfg["loadGapMin"] * 60:
            return {"ok": True, "queued": False, "skipped": f"checked {int((now - last) // 60)} min ago"}
        if _request_file().exists():
            return {"ok": True, "queued": False, "skipped": "a check is already asked for"}
    if run.get("state") == "running" and now - _iso_s(run.get("startedAt")) < cfg["timeoutSec"] + 60:
        return {"ok": True, "queued": False, "skipped": "a check is running now"}
    _data().mkdir(parents=True, exist_ok=True)
    req = {"$axf": "account-probe-request@1", "trigger": trigger, "accounts": accounts[:20], "by": by[:60],
           "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))}
    tmp = _request_file().with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(req))
    tmp.replace(_request_file())
    who = ", ".join(accounts) if accounts else "every Claude account"
    return {"ok": True, "queued": True, "message": f"Checking {who}: it starts within a minute, results land here and on your phone."}


@router.get("/checks")
def get_checks(request: Request) -> dict[str, Any]:
    """The account health store, the check settings and whether a check is waiting to start."""
    _who(request)
    store = health_store()
    req = None
    try:
        req = json.loads(_request_file().read_text())
    except (OSError, ValueError):
        pass
    return {"ok": True, "store": store, "settings": probe_settings(), "summary": health_summary(store),
            "request": {k: str(req.get(k) or "")[:60] for k in ("trigger", "at", "by")} if isinstance(req, dict) else None,
            "labels": STATUS_LABELS}


@router.post("/checks")
async def post_checks(request: Request) -> dict[str, Any]:
    """{ trigger: load|manual, accounts?: [names] }: check accounts now (console load, Check now, voice, MCP)."""
    by = _who(request)
    b = _body_dict(await _body(request))
    names = b.get("accounts") if isinstance(b.get("accounts"), list) else ([b["account"]] if isinstance(b.get("account"), str) and b["account"] else [])
    return await run_in_threadpool(request_check, str(b.get("trigger") or "manual"), names, by)


@router.post("/checks/settings")
async def set_checks(request: Request) -> dict[str, Any]:
    """{ enabled?, intervalMin?, onLoad?, loadGapMin?, session?, apiMessage?, timeoutSec?, notifyRuns?, alertProblems? }"""
    by = _who(request)
    b = _body_dict(await _body(request))

    def change() -> dict[str, Any]:
        cfg = _raw_config()
        f = dict(probe_settings())
        for k in PROBE_BOOLS:
            if k in b:
                if not isinstance(b[k], bool):
                    raise HTTPException(400, f"{k} is true or false.")
                f[k] = b[k]
        for k, (lo, hi) in PROBE_RANGES.items():
            if k in b:
                try:
                    n = int(b[k])
                except (TypeError, ValueError):
                    raise HTTPException(400, f"{k} is a whole number from {lo} to {hi}.") from None
                if not lo <= n <= hi:
                    raise HTTPException(400, f"{k} is a whole number from {lo} to {hi}.")
                f[k] = n
        if "notifyRuns" in b:
            if b["notifyRuns"] not in NOTIFY_RUNS:
                raise HTTPException(400, "notifyRuns is load, all or off.")
            f["notifyRuns"] = b["notifyRuns"]
        return _save_config({**cfg, "probe": f}, by, _owner(request)).get("probe") or f

    return {"ok": True, "settings": await run_in_threadpool(change)}


def account_health() -> dict[str, Any]:
    """Systems check: what the last account check found."""
    store = health_store()
    if not store["accounts"]:
        return {"status": "unknown", "summary": "No Claude account checked yet: the first check runs within the hour, or Claude accounts → Check now."}
    bad = [e for e in store["accounts"].values() if not able(e)["ok"]]
    when = str((store["run"] or {}).get("finishedAt") or store["updatedAt"])[:16].replace("T", " ")
    s = health_summary(store)
    if not bad:
        return {"status": "ok", "summary": f"Claude accounts: {s['text']} (checked {when} UTC)."}
    worst = "error" if any(e["status"] in ("expired", "no-credits") for e in bad) else "warn"
    names = "; ".join(f"{e.get('label') or e['name']}: {STATUS_LABELS[e['status']]}" for e in bad)
    return {"status": worst, "summary": f"{names} (checked {when} UTC). Builds go to the other accounts."[:300]}


class AccountStatusService:
    """axf.account-status@1: the one shared store of what every Claude account can do now (the usage badge reads it)."""
    version = 1

    def status(self) -> dict[str, Any]:
        return health_store()

    def able(self, name: str, model: str = "") -> dict[str, Any]:
        return able(health_store()["accounts"].get(clean_name(name)), model)

    def summary(self) -> dict[str, Any]:
        return health_summary()


plugin_services.provide("axf.account-status@1", AccountStatusService(), FOLDER)


class AccountsService:
    """axf.claude-accounts@1: the accounts on the VPS (no credentials) and the one held switch."""

    def view(self) -> dict[str, Any]:
        return view()

    def use(self, name: str, by: str) -> dict[str, Any]:
        return ask("use", clean_name(name), by)


plugin_services.provide("axf.claude-accounts@1", AccountsService(), FOLDER)


def _register_health(tries: int = 12) -> None:
    svc = plugin_services.get("axf.health@1")
    if svc is not None:
        svc.register({"id": "claude-workers", "label": "Claude worker accounts", "run": worker_health, "severity": "warn", "service": "claude", "order": 62,
                      "breaks": "New headless builds run on the console's own account until a worker can take them.",
                      "instructions": ["Builds → Claude accounts shows when each worker comes back. Sign a worker in again there if its login failed."]}, owner=FOLDER)
        svc.register({"id": "claude-logins", "label": "Claude logins", "run": login_health, "severity": "error", "service": "claude", "order": 61,
                      "breaks": "A Claude account whose login died takes no builds until it is signed in again; the others carry its work.",
                      "instructions": ["Builds → Claude accounts → that account → Sign in (or tell Amber \"sign <account> in\"). It comes back by itself once the new login is saved, and its phone alert closes."]}, owner=FOLDER)
        svc.register({"id": "claude-account-health", "label": "Claude account checks", "run": account_health, "severity": "warn", "service": "claude", "order": 60,
                      "breaks": "An account the check finds expired, limited or out of credits gets no builds until it works again; the others take them.",
                      "instructions": ["Builds → Claude accounts → Account checks shows each account's last check. Check now runs one (within a minute).",
                                       "Login expired: sign that account in again. No credits: top it up, or wait for its reset."]}, owner=FOLDER)
        svc.register({"id": "claude-api-spend", "label": "Claude API accounts", "run": api_health, "severity": "warn", "service": "claude", "order": 63,
                      "breaks": "An API account at its daily or weekly cap takes no more jobs; one without a key takes none at all.",
                      "instructions": ["Settings → Plugins → Claude accounts → Job routing shows each API account's spend and caps. Only your own click raises a cap.",
                                       "No key yet: Terminal → VPS host, run `claude-account savekey <name>` (e.g. hulu-api) and paste the key at the hidden prompt."]}, owner=FOLDER)
    elif tries > 0:  # plugins load in any order
        timer = threading.Timer(5.0, _register_health, args=(tries - 1,))
        timer.daemon = True
        timer.start()


_register_health()
