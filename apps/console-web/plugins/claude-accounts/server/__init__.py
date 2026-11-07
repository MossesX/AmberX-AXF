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
NOTE = "Running builds keep their account; new launches use the active one."

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


def workers() -> list[str]:
    """The accounts marked as workers (claude-workers@1), in order."""
    try:
        v = json.loads((_data() / "workers.json").read_text())
        rows = v.get("workers") if isinstance(v, dict) else None
    except (OSError, ValueError):
        rows = None
    return [n for n in rows if isinstance(n, str) and NAME.fullmatch(n)] if isinstance(rows, list) else []


def _save_workers(names: list[str]) -> None:
    _data().mkdir(parents=True, exist_ok=True)
    (_data() / "workers.json").write_text(json.dumps({"$axf": "claude-workers@1", "workers": names}, indent=1))


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
        out[a["name"]] = {"limited": {k: str(lim.get(k) or "")[:40] for k in ("until", "kind", "reason")} if lim else None,
                          "running": [str(s)[:80] for s in a.get("running") or []][:20], "runsToday": int(a.get("runsToday") or 0),
                          "costToday": float(a.get("costToday") or 0), "costWeek": float(a.get("costWeek") or 0),
                          "email": str(a.get("email") or "")[:200], "plan": str(a.get("plan") or "")[:40],
                          "recent": [{k: r.get(k) for k in ("session", "name", "agent", "model", "at", "end", "exit", "costUsd")} for r in (a.get("recent") or [])[:5] if isinstance(r, dict)]}
    return out


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
        value = {"ready": bool(r.get("ready")), "why": str(r.get("why") or "")[:200], "names": names, "active": active, "types": types, "login": parse_login(status.strip()), **parse_status(status.strip()), "host": parse_workers(hosted.strip())}
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
    marked = workers()
    idle = {"limited": None, "running": [], "runsToday": 0, "costToday": 0.0, "costWeek": 0.0, "recent": []}

    def row(n: str) -> dict[str, Any]:
        host = v["host"].get(n, {})
        return {"name": n, "active": n == active, "type": v["types"].get(n, "login"), "email": str((seen.get(n) or {}).get("email") or host.get("email") or ""),
                "plan": str((seen.get(n) or {}).get("plan") or host.get("plan") or ""), "role": "interactive" if n == active else "worker" if n in marked else "saved",
                **{k: host.get(k, d) for k, d in idle.items()}}

    rows = [row(n) for n in names]
    return {"ok": True, "ready": v["ready"], "why": v["why"], "accounts": rows, "active": active, "login": login, "loginChanged": changed, "pending": pending, "note": NOTE,
            "checked": v["checked"], "expiresAt": v["expiresAt"]}


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
    if op == "use" and row and row["role"] == "worker":
        raise HTTPException(409, f"{name} is a worker: it only runs headless jobs. Stop it being a worker first.")
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
            raise HTTPException(409, f"{name} is the console's account: switch to another one first.")
        if row["type"] == "api-key":
            raise HTTPException(409, "An API key bills per token, so it can't be a worker.")
    with _lock:
        names = [n for n in workers() if n != name]
        _save_workers(names + [name] if want == "worker" else names)
    _forget_read()
    return {"ok": True, "name": name, "role": want, "message": f"{name} now runs headless jobs only." if want == "worker" else f"{name} no longer takes headless jobs."}


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


def worker_health() -> dict[str, Any]:
    """Systems check: a job needs a worker that can run. Quiet while no worker is set up."""
    marked = workers()
    if not marked:
        return {"status": "ok", "summary": "No worker accounts set up."}
    v = view()
    if not v["ready"]:
        return {"status": "unknown", "summary": v["why"] or "Can't read the VPS host.", "unreachable": True}
    rows = [a for a in v["accounts"] if a["name"] in marked]
    free = [a for a in rows if not a["limited"]]
    if free:
        return {"status": "ok", "summary": f"{len(free)} of {len(marked)} worker accounts can take jobs."}
    ends = sorted(a["limited"]["until"] for a in rows if a["limited"])
    return {"status": "error", "summary": f"No worker account can take jobs{f' until {ends[0]}' if ends else ''}: new builds run on the console's account."}


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
    elif tries > 0:  # plugins load in any order
        timer = threading.Timer(5.0, _register_health, args=(tries - 1,))
        timer.daemon = True
        timer.start()


_register_health()
