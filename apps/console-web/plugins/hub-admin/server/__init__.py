"""Server part of the Hub plugin (hub-console@1). Mounted at /api/plugins/hub-admin/.

Every hub screen's state, read through axHub and answered in the shape the route table (framework/schemas/hub-console.json)
names, with retries and a clear unavailable state instead of a stack trace:

  GET  table                    the route table
  GET  <screen>[?params]        one screen's state (hub-console@1 `state`)
  GET  <screen>/<row>           one row (hub-console@1 `rows.read`)

Two channels, never mixed (HUB-CONSOLE.md → Channels):
  session   `/auth/api/*` reads through the approvals-banner relay's service `axf.hub-relay@1` (the tapping browser's
            own hub session, else the console's owner sign-in); when that plugin is off, the browser's cookie alone;
  bearer    the console's hub token: axHub's own MCP tools (list_services, describe_service) and GET /auth/api/policy.
The console token never decides and never writes to the hub; the action routes (steps 8+) hand a person's tap to the
relay and refuse everything else.

Answers are always JSON with `ok`. A read that could not be served says why in one of these codes (HTTP 200, so every
transport shows the same words): signed_out (no hub session and no owner sign-in), forbidden (the account isn't an
admin), old_hub (the hub has no JSON pages yet), hub_unavailable (unreachable or 5xx after the retries), hub_missing
(the hub has no route for this part yet; the `proposed` route says what to grow), relay_off (nothing can hold a session).
Bad input is 400 / 404 as usual.
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any, Callable

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import approvals_relay as relay_core
from axf_server import http as axf_http
from axf_server.github_hub import HubLink, HubUnreachable

import plugin_services
import wall

router = APIRouter()
FOLDER = "hub-admin"
ROOT = Path(__file__).resolve().parents[5]
TABLE_FILE = ROOT / "framework" / "schemas" / "hub-console.json"
RELAY_CAP = "axf.hub-relay@1"
HEALTH_CAP = "axf.health@1"
COOKIE = "axhub_session"
TIMEOUT_S = 8.0
RETRIES = 3
BACKOFF_S = 0.3
MESSAGE_MAX = 300
# Codes a read answers when it can't be served (HUB-CONSOLE.md).
CODES = ("signed_out", "forbidden", "old_hub", "hub_unavailable", "hub_missing", "relay_off", "hub_error")
HUB_LINK = HubLink.from_env(client_name="axf-console-hub")

_table_cache: dict[str, Any] = {}


def load_table() -> dict[str, Any]:
    """The hub-console@1 route table (the single source every projection reads), re-read when the file changes."""
    st = TABLE_FILE.stat()
    if _table_cache.get("mtime") != st.st_mtime:
        _table_cache.update(mtime=st.st_mtime, table=json.loads(TABLE_FILE.read_text(encoding="utf-8")))
    return _table_cache["table"]


def screen_of(table: dict[str, Any], sid: str) -> dict[str, Any] | None:
    return next((s for s in table.get("screens", []) if s.get("id") == sid), None)


def _data() -> Path:
    return Path(os.environ.get("AXF_HUB_ADMIN_DATA_DIR") or (ROOT / ".axf-console" / "plugins" / FOLDER))


def hub_base() -> str:
    hub = (os.environ.get("AXF_WALL_HUB") or os.environ.get("AXHUB_URL") or "https://axhub.amberxai.com").strip().rstrip("/")
    return relay_core.hub_base(hub)


def row_ok(screen: dict[str, Any], row: str) -> bool:
    rows = screen.get("rows") or {}
    if not rows or not row or "/" in row or "\\" in row or row in (".", "..") or len(row) > 200:
        return False
    pat = rows.get("idPattern")
    return bool(re.search(pat, row)) if pat else True


def unavailable(code: str, message: str, **extra: Any) -> dict[str, Any]:
    assert code in CODES, code
    return {"ok": False, "code": code, "message": message[:MESSAGE_MAX], **extra}


# ---------------------------------------------------------------- the session channel

class Session:
    """`/auth/api` reads through the relay service (browser session, else the console's owner sign-in); without the
    relay plugin, the browser's own cookie forwarded and nothing else."""

    def __init__(self, request: Request) -> None:
        self.request = request
        self.relay = plugin_services.get(RELAY_CAP)

    def get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """→ {ok, json, via} or an unavailable state (one retry round for network trouble and 5xx)."""
        last: dict[str, Any] = unavailable("hub_unavailable", "axHub didn't answer.")
        for attempt in range(RETRIES):
            r = self._once(path, params)
            if r["ok"] or r.get("code") not in ("hub_unavailable",):
                return r
            last = r
            time.sleep(BACKOFF_S * (attempt + 1))
        return last

    def _once(self, path: str, params: dict[str, Any] | None) -> dict[str, Any]:
        if self.relay is not None:
            r = self.relay.read(self.request, path, params, timeout=TIMEOUT_S)
            if r.get("ok"):
                return {"ok": True, "json": r.get("json") or {}, "via": r.get("via", "")}
            code = r.get("code", "hub_error")
            if code in ("unreachable",) or (isinstance(r.get("status"), int) and r["status"] >= 500):
                return unavailable("hub_unavailable", r.get("message") or "axHub didn't answer.", via=r.get("via", ""))
            if code in ("signed_out", "owner_password", "owner_busy", "owner_refused", "no_credential"):
                return unavailable("signed_out", r.get("message") or "Sign in to axHub.", via=r.get("via", ""))
            if code in ("old_hub", "forbidden", "hub_error"):
                return unavailable(code, r.get("message") or f"axHub answered {r.get('status')}.", via=r.get("via", ""))
            return unavailable("hub_error", r.get("message") or "axHub refused the read.", via=r.get("via", ""))
        cookie = self.request.cookies.get(COOKIE) or ""
        hub = hub_base()
        if not hub:
            return unavailable("hub_unavailable", "The console has no https hub address (AXF_WALL_HUB).")
        if not cookie:
            return unavailable("relay_off", "The approvals-banner plugin is off and this browser brought no axHub session: nothing here can read the hub for you.")
        try:
            with httpx.Client(timeout=TIMEOUT_S, follow_redirects=False) as client:
                r = relay_core.get_json(hub, cookie, path, client, params)
        except httpx.HTTPError as e:
            return unavailable("hub_unavailable", f"Couldn't reach axHub ({type(e).__name__}).")
        st = r["status"]
        if st == 200:
            return {"ok": True, "json": r["json"], "via": "browser"}
        if st >= 500:
            return unavailable("hub_unavailable", f"axHub answered {st}.", via="browser")
        err = r["json"].get("error") if isinstance(r["json"].get("error"), dict) else {}
        msg = str(err.get("message") or f"axHub answered {st}.")
        return unavailable({401: "signed_out", 403: "forbidden", 404: "old_hub"}.get(st, "hub_error"), msg, via="browser")


# ---------------------------------------------------------------- the bearer channel

def hub_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """One of axHub's own MCP tools with the console's hub token; → {ok, data} or an unavailable state. Retries network trouble."""
    if not HUB_LINK.configured():
        return unavailable("hub_unavailable", "The console has no axHub token (AXHUB_TOKEN): connectors can't be listed.")
    last: dict[str, Any] = unavailable("hub_unavailable", "axHub didn't answer.")
    for attempt in range(RETRIES):
        try:
            res = HUB_LINK.tool(name, arguments, timeout=TIMEOUT_S)
        except HubUnreachable as e:
            last = unavailable("hub_unavailable", str(e))
            time.sleep(BACKOFF_S * (attempt + 1))
            continue
        text = "\n".join(c.get("text", "") for c in res.get("content", []) if isinstance(c, dict))
        if res.get("isError"):
            return unavailable("hub_error", text or f"axHub couldn't run {name}.")
        try:
            data = json.loads(text) if text.strip() else {}
        except ValueError:
            data = {"text": text}
        return {"ok": True, "data": data}
    return last


def policy_table() -> dict[str, Any]:
    """GET /auth/api/policy (policy-table@1) with the hub token; → {ok, data} or an unavailable state."""
    hub = HUB_LINK.url()
    tok = HUB_LINK.token()
    if not hub or not tok:
        return unavailable("hub_unavailable", "The console has no axHub token (AXHUB_TOKEN).")
    last: dict[str, Any] = unavailable("hub_unavailable", "axHub didn't answer.")
    for attempt in range(RETRIES):
        try:
            r = axf_http.request("GET", f"{hub}/auth/api/policy", headers={"authorization": f"Bearer {tok}", "accept": "application/json"}, timeout=TIMEOUT_S, redirects="never", transport=HUB_LINK.transport)
        except axf_http.HttpError as e:  # type: ignore[attr-defined]
            last = unavailable("hub_unavailable", f"Couldn't reach axHub ({type(e).__name__}).")
            time.sleep(BACKOFF_S * (attempt + 1))
            continue
        if r.status == 200:
            try:
                return {"ok": True, "data": r.json()}
            except ValueError:
                return unavailable("hub_error", "axHub's policy answer isn't JSON.")
        if r.status == 404:
            return unavailable("old_hub", "axHub doesn't have the policy API yet.")
        if r.status in (401, 403):
            return unavailable("forbidden", f"axHub refused the console's token for the policy table ({r.status}).")
        last = unavailable("hub_unavailable", f"axHub answered {r.status}.")
        if r.status < 500:
            return last
        time.sleep(BACKOFF_S * (attempt + 1))
    return last


# ---------------------------------------------------------------- the readers (one per screen, the table's fields)

def _pass_requests() -> list[dict[str, Any]]:
    """Pass requests waiting for Brett's click (hub_pass_request writes them; the Passes screen shows them)."""
    f = _data() / "requests.jsonl"
    if not f.exists():
        return []
    out: list[dict[str, Any]] = []
    for line in f.read_text(encoding="utf-8").splitlines()[-200:]:
        try:
            j = json.loads(line)
        except ValueError:
            continue
        if isinstance(j, dict) and j.get("state", "open") == "open":
            out.append(j)
    return out


def _missing(table: dict[str, Any], sid: str, action: str) -> dict[str, Any]:
    a = next((x for x in (screen_of(table, sid) or {}).get("actions", []) if x.get("id") == action), None)
    m = (a or {}).get("missing") or {}
    return {"code": "hub_missing", "proposed": m.get("proposed", ""), "why": m.get("why", ""), **({"cli": m["cli"]} if m.get("cli") else {})}


def read_overview(s: Session, table: dict[str, Any], p: dict[str, Any]) -> dict[str, Any]:
    r = s.get("/auth/api/session")
    relay = plugin_services.get(RELAY_CAP)
    relay_state = relay.state(s.request) if relay is not None else {"relay": False, "via": "", "reason": "The approvals-banner plugin is off."}
    hub = hub_base()
    if not r["ok"]:
        if r["code"] in ("signed_out", "relay_off"):
            return {"ok": True, "signedIn": False, "admin": False, "user": None, "can": {}, "waiting": None, "heldCount": None, "hub": hub, "checkedAt": _now(), "relay": relay_state, "via": r.get("via", ""), "note": r["message"]}
        return r
    j = r["json"]
    waiting = held = None
    if j.get("admin"):
        g = s.get("/auth/api/approvals", {"status": "pending", "page": 1})
        if g["ok"]:
            waiting, held = g["json"].get("waiting"), g["json"].get("heldCount", 0)
    return {"ok": True, "signedIn": bool(j.get("signedIn")), "admin": bool(j.get("admin")), "user": j.get("user"), "can": j.get("can") or {},
            "waiting": waiting, "heldCount": held, "hub": hub, "checkedAt": _now(), "relay": relay_state, "via": r["via"]}


def read_approvals(s: Session, table: dict[str, Any], p: dict[str, Any]) -> dict[str, Any]:
    allowed = (screen_of(table, "approvals") or {}).get("state", {}).get("params", {}).get("status", [])
    status = p.get("status") if p.get("status") in allowed else "all"
    page = _int(p.get("page"), 1)
    r = s.get("/auth/api/approvals", {"status": status, "page": page})
    return {"ok": True, "via": r["via"], **_pick(r["json"], screen_of(table, "approvals")["state"]["fields"])} if r["ok"] else r


def read_approval(s: Session, table: dict[str, Any], row: str) -> dict[str, Any]:
    r = s.get(f"/auth/api/approvals/{row}")
    return {"ok": True, "via": r["via"], "item": r["json"].get("item"), "auto": r["json"].get("auto")} if r["ok"] else r


def read_log(s: Session, table: dict[str, Any], p: dict[str, Any]) -> dict[str, Any]:
    spec = screen_of(table, "log")["state"]["params"]
    q: dict[str, Any] = {}
    for k in ("q", "status", "tool", "pass"):
        v = str(p.get(k) or "")[:200]
        if v:
            q[k] = v
    for k in ("via", "sort"):
        v = p.get(k)
        if v in spec[k]:
            q[k] = v
    q["page"] = _int(p.get("page"), 1)
    r = s.get("/auth/api/approvals/log", q)
    return {"ok": True, "via": r["via"], **_pick(r["json"], screen_of(table, "log")["state"]["fields"])} if r["ok"] else r


def read_passes(s: Session, table: dict[str, Any], p: dict[str, Any]) -> dict[str, Any]:
    r = s.get("/auth/api/passes")
    if not r["ok"]:
        return r
    go = s.get("/auth/api/go-pass")
    pol = policy_table()
    no_wait = None
    cs = plugin_services.get("axf.claude-settings@1")
    fn = getattr(cs, "get", None) if cs is not None else None
    if callable(fn):
        try:
            v = fn()
            no_wait = v.get("noWait") if isinstance(v, dict) else None
        except Exception:  # noqa: BLE001 — No wait is shown read-only here; its owner reports its own health
            no_wait = None
    return {"ok": True, "via": r["via"], "active": r["json"].get("active", []), "recent": r["json"].get("recent", []), "minutes": r["json"].get("minutes"),
            "requests": _pass_requests(), "goPass": go["json"] if go["ok"] else {"unavailable": go}, "veto": (pol["data"].get("veto") if pol["ok"] else {"unavailable": pol}),
            "noWait": no_wait, "now": r["json"].get("now") or _now()}


def read_users(s: Session, table: dict[str, Any], p: dict[str, Any]) -> dict[str, Any]:
    r = s.get("/auth/api/users")
    return {"ok": True, "via": r["via"], **_pick(r["json"], screen_of(table, "users")["state"]["fields"])} if r["ok"] else r


def read_user(s: Session, table: dict[str, Any], row: str) -> dict[str, Any]:
    r = s.get("/auth/api/users")
    if not r["ok"]:
        return r
    u = next((x for x in r["json"].get("users", []) if isinstance(x, dict) and x.get("id") == row), None)
    if u is None:
        raise HTTPException(404, "no such hub account")
    return {"ok": True, "via": r["via"], **u}


def read_account(s: Session, table: dict[str, Any], p: dict[str, Any]) -> dict[str, Any]:
    r = s.get("/auth/api/account")
    if not r["ok"]:
        return r
    phone = plugin_services.get("axf.phone-connect@1")
    fn = getattr(phone, "pairing_state", None) if phone is not None else None
    try:
        phone_state = fn() if callable(fn) else {"available": False, "note": "Phone Connect isn't installed here."}
    except Exception:  # noqa: BLE001
        phone_state = {"available": False, "note": "Phone Connect didn't answer."}
    return {"ok": True, "via": r["via"], "user": r["json"].get("user"), "passwordMin": r["json"].get("passwordMin"), "browsers": r["json"].get("browsers", []),
            "phone": phone_state, "notifications": {"opens": "view:claude-settings/tab:claude-settings.tabs=notifications"}}


def read_connectors(s: Session, table: dict[str, Any], p: dict[str, Any]) -> dict[str, Any]:
    listed = hub_tool("list_services", {})
    pol = policy_table()
    if not listed["ok"] and not pol["ok"]:
        return listed
    services: dict[str, dict[str, Any]] = {}
    for svc in (pol["data"].get("services", []) if pol["ok"] else []):
        if isinstance(svc, dict) and svc.get("namespace"):
            services[svc["namespace"]] = {**svc, "listed": False}
    raw = listed["data"] if listed["ok"] else {}
    items = raw.get("services") if isinstance(raw, dict) else raw
    for svc in (items if isinstance(items, list) else []):
        if not isinstance(svc, dict):
            continue
        ns = svc.get("namespace") or svc.get("name") or svc.get("id")
        if not ns:
            continue
        cur = services.setdefault(ns, {"namespace": ns, "tools": []})
        cur.update({"listed": True, "type": svc.get("type", cur.get("type")), "description": svc.get("description", cur.get("description", "")),
                    "toolCount": len(svc.get("tools") or []) if isinstance(svc.get("tools"), list) else svc.get("toolCount"), "status": svc.get("status", "")})
    health = [{"namespace": ns, "status": "warn" if v.get("toolsStale") else "error" if (v.get("enabled") and not v.get("tools") and not v.get("toolCount")) else "ok",
               "why": "the hub's tool list for it is stale" if v.get("toolsStale") else "enabled but no tools answered" if (v.get("enabled") and not v.get("tools") and not v.get("toolCount")) else ""}
              for ns, v in sorted(services.items())]
    show = str(p.get("show") or "enabled")
    rows = [v for v in services.values() if show == "all" or v.get("enabled", True)]
    return {"ok": True, "services": sorted(rows, key=lambda v: v["namespace"]), "veto": pol["data"].get("veto") if pol["ok"] else {"unavailable": pol},
            "health": health, "checkedAt": _now(), **({} if listed["ok"] else {"listUnavailable": listed}), **({} if pol["ok"] else {"policyUnavailable": pol})}


def read_service(s: Session, table: dict[str, Any], row: str) -> dict[str, Any]:
    desc = hub_tool("describe_service", {"service": row})
    pol = policy_table()
    if not desc["ok"] and not pol["ok"]:
        return desc
    policy_row = next((x for x in (pol["data"].get("services", []) if pol["ok"] else []) if isinstance(x, dict) and x.get("namespace") == row), None)
    if desc["ok"] and not isinstance(desc["data"], dict):
        desc = {"ok": True, "data": {"text": desc["data"]}}
    if not desc["ok"] and policy_row is None:
        raise HTTPException(404, "no such service on the hub")
    d = desc["data"] if desc["ok"] else {}
    log = s.get("/auth/api/approvals/log", {"tool": f"{row}.", "page": 1})
    recent = log["json"].get("entries", []) if log["ok"] else []
    tools = d.get("tools") if isinstance(d.get("tools"), list) else (policy_row or {}).get("tools", [])
    return {"ok": True, "namespace": row, "type": (policy_row or {}).get("type") or d.get("type"), "enabled": (policy_row or {}).get("enabled", True),
            "defaultPolicy": (policy_row or {}).get("defaultPolicy"), "policyPreset": (policy_row or {}).get("policyPreset"), "toolsStale": (policy_row or {}).get("toolsStale", False),
            "tools": tools, "policyTools": (policy_row or {}).get("tools", []), "recentCalls": recent[:50], "recentUnavailable": None if log["ok"] else log,
            "health": {"status": "warn" if (policy_row or {}).get("toolsStale") else "ok"}, **({} if desc["ok"] else {"describeUnavailable": desc})}


def read_handoff(s: Session, table: dict[str, Any], p: dict[str, Any]) -> dict[str, Any]:
    r = s.get("/auth/api/handoff")
    return {"ok": True, "via": r["via"], "runs": r["json"].get("runs", [])} if r["ok"] else r


def read_handoff_run(s: Session, table: dict[str, Any], row: str) -> dict[str, Any]:
    r = s.get(f"/auth/api/handoff/{row}")
    return {"ok": True, "via": r["via"], **_pick(r["json"], screen_of(table, "handoff")["rows"]["read"]["fields"])} if r["ok"] else r


def read_auth(s: Session, table: dict[str, Any], p: dict[str, Any]) -> dict[str, Any]:
    r = s.get("/auth/api/users")
    if not r["ok"]:
        return r
    j = r["json"]
    users = j.get("users", [])
    sign_in = {"method": "username + password (the hub's sign-in wall)", "roles": j.get("roles", []), "passwordMin": j.get("passwordMin"), "tempPasswordMin": j.get("tempPasswordMin"),
               "accounts": len(users), "admins": sum(1 for u in users if isinstance(u, dict) and u.get("role") == "admin"), "weakPasswords": sum(1 for u in users if isinstance(u, dict) and u.get("weakPassword"))}
    clients = s.get("/auth/api/auth/clients")
    tokens = s.get("/auth/api/auth/tokens")
    missing: dict[str, Any] = {}
    if not clients["ok"]:
        missing["clients"] = _missing(table, "auth", "client-add") if clients["code"] == "old_hub" else clients
    if not tokens["ok"]:
        missing["tokens"] = _missing(table, "auth", "token-create") if tokens["code"] == "old_hub" else tokens
    return {"ok": True, "via": r["via"], "signIn": sign_in, "clients": clients["json"].get("clients", []) if clients["ok"] else [], "tokens": tokens["json"].get("tokens", []) if tokens["ok"] else [], "missing": missing}


def read_apps(s: Session, table: dict[str, Any], p: dict[str, Any]) -> dict[str, Any]:
    r = s.get("/apps.json")
    if not r["ok"]:
        if r["code"] == "forbidden":
            return {"ok": True, "via": r.get("via", ""), "status": "not-admin", "apps": [], "updatedAt": None, "error": "This hub account needs apps.download."}
        return r
    j = r["json"]
    return {"ok": True, "via": r["via"], "status": "ok", "apps": j.get("apps", []), "updatedAt": j.get("updatedAt"), "error": None}


READERS: dict[str, Callable[[Session, dict[str, Any], dict[str, Any]], dict[str, Any]]] = {
    "overview": read_overview, "approvals": read_approvals, "log": read_log, "passes": read_passes, "users": read_users, "account": read_account,
    "connectors": read_connectors, "handoff": read_handoff, "auth": read_auth, "apps": read_apps,
}
ROW_READERS: dict[str, Callable[[Session, dict[str, Any], str], dict[str, Any]]] = {
    "approvals": read_approval, "users": read_user, "connectors": read_service, "handoff": read_handoff_run,
}


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _int(v: Any, default: int) -> int:
    try:
        n = int(v)
        return n if n >= 1 else default
    except (TypeError, ValueError):
        return default


def _pick(j: dict[str, Any], fields: list[str]) -> dict[str, Any]:
    return {k: j.get(k) for k in fields} if isinstance(j, dict) else {}


async def read_screen(request: Request, sid: str, row: str | None = None) -> dict[str, Any]:
    table = load_table()
    screen = screen_of(table, sid)
    if screen is None:
        raise HTTPException(404, f"no hub screen {sid}")
    params = {k: v for k, v in request.query_params.items()}
    s = Session(request)
    if row is None:
        out = await run_in_threadpool(READERS[sid], s, table, params)
    else:
        if not row_ok(screen, row):
            raise HTTPException(400, f"not a {sid} row id")
        reader = ROW_READERS.get(sid)
        if reader is None:
            raise HTTPException(404, f"{sid} rows have no detail read")
        out = await run_in_threadpool(reader, s, table, row)
    out.setdefault("screen", sid)
    out.setdefault("hub", hub_base())
    out.setdefault("shape", screen["state"]["shape"] if row is None else (screen.get("rows", {}).get("read") or screen["state"])["shape"])
    if row is not None:
        out.setdefault("row", row)
    ensure_health()
    return out


# ---------------------------------------------------------------- routes (one per screen, so every read is its own command)

@router.get("/table")
def get_table() -> dict[str, Any]:
    """The hub-console@1 route table (every screen, its reads, actions and settings)."""
    return {"ok": True, "table": load_table()}


@router.get("/overview")
async def get_overview(request: Request) -> dict[str, Any]:
    """Hub status: whether the console holds a hub session, who it is, how many calls wait, the relay state."""
    return await read_screen(request, "overview")


@router.get("/approvals")
async def get_approvals(request: Request, status: str = "all", page: int = 1) -> dict[str, Any]:
    """Approvals: every call axHub is holding or asking about (approval-grid@1), filtered by status, paged."""
    return await read_screen(request, "approvals")


@router.get("/approvals/{row}")
async def get_approval(request: Request, row: str) -> dict[str, Any]:
    """One approval request (approval-item@1): the reason, the exact call, who asked, its countdown and history."""
    return await read_screen(request, "approvals", row)


@router.get("/log")
async def get_log(request: Request, q: str = "", status: str = "", via: str = "", tool: str = "", sort: str = "newest", page: int = 1) -> dict[str, Any]:
    """Approval log (approval-log@1): every request and how it ended, filtered by words, status, who decided, tool and pass."""
    return await read_screen(request, "log")


@router.get("/passes")
async def get_passes(request: Request) -> dict[str, Any]:
    """Passes and veto (hub-passes@1): active and ended passes, pass requests waiting for Brett, the go pass, the veto countdown, No wait."""
    return await read_screen(request, "passes")


@router.get("/users")
async def get_users(request: Request) -> dict[str, Any]:
    """Hub accounts (hub-users@1): every account with its role, permissions and state."""
    return await read_screen(request, "users")


@router.get("/users/{row}")
async def get_user(request: Request, row: str) -> dict[str, Any]:
    """One hub account (hub-user@1)."""
    return await read_screen(request, "users", row)


@router.get("/account")
async def get_account(request: Request) -> dict[str, Any]:
    """Your hub account (hub-account@1): profile, signed-in browsers, the linked phone, notification preferences."""
    return await read_screen(request, "account")


@router.get("/connectors")
async def get_connectors(request: Request, show: str = "enabled") -> dict[str, Any]:
    """Connected services (hub-services@1): every service with its status, policies and key health."""
    return await read_screen(request, "connectors")


@router.get("/connectors/{row}")
async def get_service(request: Request, row: str) -> dict[str, Any]:
    """One service (hub-service@1): its tools and schemas, the policy per tool, its recent calls."""
    return await read_screen(request, "connectors", row)


@router.get("/handoff")
async def get_handoff(request: Request) -> dict[str, Any]:
    """Handoff runs (hub-handoffs@1): the Claude account handoff kits the hub built."""
    return await read_screen(request, "handoff")


@router.get("/handoff/{row}")
async def get_handoff_run(request: Request, row: str) -> dict[str, Any]:
    """One handoff run (hub-handoff@1): prompt, files, log, steps."""
    return await read_screen(request, "handoff", row)


@router.get("/auth")
async def get_auth(request: Request) -> dict[str, Any]:
    """Auth admin (hub-auth@1): sign-in rules, OAuth clients and API tokens (hub_missing where the hub has no route yet)."""
    return await read_screen(request, "auth")


@router.get("/apps")
async def get_apps(request: Request) -> dict[str, Any]:
    """App catalog (hub-apps@1): every app the framework's CI built, with downloads on the hub's own path."""
    return await read_screen(request, "apps")


# ---------------------------------------------------------------- actions (hub-console@1 `actions`): who may run each

class Writer:
    """`/auth/api` writes through the relay service (browser session, else the owner sign-in); without the relay plugin, the
    browser's own cookie and nothing else. `person=True` goes only for a wall admin's same-origin browser request."""

    def __init__(self, request: Request) -> None:
        self.request = request
        self.relay = plugin_services.get(RELAY_CAP)

    def post(self, path: str, body: Any, person: bool, method: str = "POST") -> dict[str, Any]:
        if self.relay is not None:
            r = self.relay.write(self.request, path, body, person, timeout=TIMEOUT_S, method=method)
            if r.get("ok"):
                return {"ok": True, "json": r.get("json") or {}, "via": r.get("via", "")}
            return {"ok": False, "code": r.get("code", "hub_error"), "message": r.get("message") or "axHub refused it.", "status": r.get("status"), "via": r.get("via", ""), "json": r.get("json") or {}}
        c = wall.wall_caller(self.request.headers)
        if person and (c is None or not c.admin or not wall.same_origin(self.request)):
            return {"ok": False, "code": "person_required", "message": "Only your own tap in your signed-in console browser does this.", "status": 403}
        cookie = self.request.cookies.get(COOKIE) or ""
        hub = hub_base()
        if not hub:
            return {"ok": False, "code": "hub_unavailable", "message": "The console has no https hub address (AXF_WALL_HUB).", "status": 0}
        if not cookie:
            return {"ok": False, "code": "relay_off", "message": "The approvals-banner plugin is off and this browser brought no axHub session.", "status": 401}
        try:
            with httpx.Client(timeout=TIMEOUT_S, follow_redirects=False) as client:
                r = relay_core.post_json(hub, cookie, path, body, client, method)
        except httpx.HTTPError as e:
            return {"ok": False, "code": "hub_unavailable", "message": f"Couldn't reach axHub ({type(e).__name__}).", "status": 0}
        if r["status"] == 200:
            return {"ok": True, "json": r["json"], "via": "browser"}
        err = r["json"].get("error") if isinstance(r["json"].get("error"), dict) else {}
        return {"ok": False, "code": str(r.get("code") or "hub_refused"), "message": str(err.get("message") or f"axHub answered {r['status']}.")[:MESSAGE_MAX], "status": r["status"], "via": "browser", "json": r["json"]}


def _audit(entry: dict[str, Any]) -> None:
    """One line per action asked of the hub (never a cookie, never a token); a log that can't be written never stops a tap."""
    try:
        d = _data()
        d.mkdir(parents=True, exist_ok=True)
        with (d / "actions.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({"at": _now(), **entry}) + "\n")
    except OSError:
        pass


def _action(table: dict[str, Any], sid: str, aid: str) -> dict[str, Any]:
    """An action of a screen, or one of its settings written through the hub (`setting:<key>`, who from the setting)."""
    screen = screen_of(table, sid)
    if screen is None:
        raise HTTPException(404, f"no hub screen {sid}")
    if aid.startswith("setting:"):
        st = next((x for x in screen.get("settings", []) if x.get("key") == aid[len("setting:"):]), None)
        if st is None or not st.get("writes"):
            raise HTTPException(404, f"no hub-written setting {aid}")
        return {"id": aid, "label": st.get("label", aid), "who": st.get("who", "confirm"), "effect": "write", "hub": st["writes"]}
    a = next((x for x in screen.get("actions", []) if x.get("id") == aid), None)
    if a is None:
        raise HTTPException(404, f"no hub action {sid}/{aid}")
    return a


def _caller(request: Request) -> str:
    c = wall.wall_caller(request.headers)
    if c is not None:
        return c.name
    u = getattr(getattr(request, "state", None), "axf_user", None)
    return getattr(u, "name", "") or "token"


async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
    except ValueError:
        return {}
    return b if isinstance(b, dict) else {}


# ---- confirm tokens (hub-console@1 who: confirm): the first call answers confirmation_required + a token, the second carries it
import secrets as _secrets

CONFIRM_TTL_S = 300
_confirms: dict[str, tuple[float, str]] = {}


def _confirm_key(sid: str, aid: str, row: str | None, caller: str) -> str:
    return f"{caller}|{sid}|{aid}|{row or ''}"


def confirm_check(sid: str, aid: str, row: str | None, caller: str, given: Any) -> dict[str, Any] | None:
    """None when the call may go ahead; else the confirmation_required answer carrying the token to send back."""
    now = time.time()
    for k, (exp, _) in list(_confirms.items()):
        if exp < now:
            _confirms.pop(k, None)
    key = _confirm_key(sid, aid, row, caller)
    held = _confirms.get(key)
    if isinstance(given, str) and given and held and held[1] == given:
        _confirms.pop(key, None)
        return None
    token = _secrets.token_urlsafe(18)
    _confirms[key] = (now + CONFIRM_TTL_S, token)
    return {"ok": False, "code": "confirmation_required", "confirm": token, "message": f"{sid} {aid}{' ' + row if row else ''} changes the hub: send it again with confirm set to this token (valid {CONFIRM_TTL_S // 60} min)."}


async def run_action(request: Request, sid: str, aid: str, row: str | None, hub_call: Callable[[Session, dict[str, Any]], tuple[Any, ...]] | None, body: dict[str, Any] | None = None) -> dict[str, Any]:
    """One action of the route table: checks who may run it, finds the hub route, posts through the console's own hub
    session, audits, and answers {ok, message, state?, …} or the unavailable / refusal state."""
    table = load_table()
    screen = screen_of(table, sid)
    a = _action(table, sid, aid)
    if row is not None and not row_ok(screen or {}, row):
        raise HTTPException(400, f"not a {sid} row id")
    b = body if body is not None else await _body(request)
    person = a.get("who") == "person"
    if a.get("missing"):
        out = {"ok": False, "code": HUB_MISSING, "message": a["missing"].get("why", "axHub has no route for this yet."), "proposed": a["missing"].get("proposed", ""), **({"cli": a["missing"]["cli"]} if a["missing"].get("cli") else {})}
    elif hub_call is None:
        out = {"ok": True, "message": "Nothing to send to the hub."}
    else:
        s = Session(request)
        method = "POST"
        try:
            called = await run_in_threadpool(hub_call, s, b)
            path, payload = called[0], called[1]
            if len(called) > 2:
                method = str(called[2])
        except HTTPException:
            raise
        except LookupError as e:
            out = {"ok": False, "code": "not_found", "message": str(e)}
            path = ""
            payload = None
        except Unavailable as e:
            out = dict(e.state)
            path = ""
            payload = None
        if path and a.get("who") == "confirm":
            # bad input is refused above, before a token is handed out; the confirm guards the write itself
            need = confirm_check(sid, aid, row, _caller(request), b.get("confirm"))
            if need is not None:
                return {"screen": sid, "action": aid, **({"row": row} if row is not None else {}), **need}
        if path:
            r = await run_in_threadpool(Writer(request).post, path, payload, person, method)
            if r["ok"]:
                j = r["json"]
                out = {"ok": True, "via": r["via"], "message": str(j.get("message") or "Done.")[:MESSAGE_MAX], **({"state": j["state"]} if isinstance(j.get("state"), str) else {}), **({"item": j["item"]} if isinstance(j.get("item"), dict) else {})}
            else:
                out = {"ok": False, "code": r.get("code", "hub_error"), "message": r.get("message", ""), "via": r.get("via", ""), **({"state": r["json"]["state"]} if isinstance(r.get("json"), dict) and isinstance(r["json"].get("state"), str) else {})}
    _audit({"by": _caller(request), "screen": sid, "action": aid, "row": row, "who": a.get("who"), "ok": out["ok"], "code": out.get("code", ""), "via": out.get("via", "")})
    return {"screen": sid, "action": aid, **({"row": row} if row is not None else {}), **out}


# ---- Approvals (s8): decide actions are Brett's tap (person); auto-stop and check are commands

class Unavailable(Exception):
    """A read an action needed first could not be served: the action answers that state (never a stack trace)."""

    def __init__(self, state: dict[str, Any]) -> None:
        super().__init__(state.get("message", ""))
        self.state = state


def _approval_status(s: Session, row: str) -> dict[str, Any]:
    r = s.get(f"/auth/api/approvals/{row}")
    if not r["ok"]:
        raise Unavailable(r)
    item = r["json"].get("item") or {}
    if not isinstance(item, dict):
        raise LookupError("no such request on the hub")
    return item


def _decide_call(action: str) -> Callable[[Session, dict[str, Any]], tuple[str, Any]]:
    """The hub route of a decision on one request: held calls have their own routes (veto@1), the rest go through the
    plain decide route with the revision the screen showed (a request that changed meanwhile is refused by the hub)."""
    def call(s: Session, b: dict[str, Any]) -> tuple[str, Any]:
        row = str(b.get("_row"))
        item = _approval_status(s, row)
        held = item.get("status") == "held" and isinstance(item.get("veto"), dict)
        rev = b.get("rev") if isinstance(b.get("rev"), int) else item.get("revision")
        if held and action in ("approve", "deny", "shelve"):
            return f"/auth/api/approvals/{row}/{'approve-now' if action == 'approve' else action}", {}
        hub_action = {"approve": "approve", "deny": "decline", "shelve": "postpone"}.get(action, action)
        extra = {k: v for k, v in b.items() if k in ("until", "minutes", "condition", "note", "reason") and v is not None}
        return f"/auth/api/approvals/{row}", {"action": hub_action, **({"rev": rev} if isinstance(rev, int) else {}), **extra}
    return call


async def _decide(request: Request, row: str, action: str) -> dict[str, Any]:
    b = await _body(request)
    return await run_action(request, "approvals", action, row, _decide_call(action), {**b, "_row": row})


@router.post("/approvals/{row}/approve")
async def post_approve(request: Request, row: str) -> dict[str, Any]:
    """Approve one request (Brett's own tap; a held call runs at once)."""
    return await _decide(request, row, "approve")


@router.post("/approvals/{row}/deny")
async def post_deny(request: Request, row: str) -> dict[str, Any]:
    """Deny one request (Brett's own tap)."""
    return await _decide(request, row, "deny")


@router.post("/approvals/{row}/shelve")
async def post_shelve(request: Request, row: str) -> dict[str, Any]:
    """Shelve a held call: the countdown pauses until Brett decides (his own tap)."""
    return await _decide(request, row, "shelve")


@router.post("/approvals/{row}/postpone")
async def post_postpone(request: Request, row: str) -> dict[str, Any]:
    """Postpone one request (Brett's own tap)."""
    return await _decide(request, row, "postpone")


@router.post("/approvals/{row}/ignore")
async def post_ignore(request: Request, row: str) -> dict[str, Any]:
    """Ignore one request (Brett's own tap)."""
    return await _decide(request, row, "ignore")


@router.post("/approvals/{row}/revoke")
async def post_revoke(request: Request, row: str) -> dict[str, Any]:
    """Revoke an approval (Brett's own tap)."""
    return await _decide(request, row, "revoke")


@router.post("/approvals/{row}/reopen")
async def post_reopen(request: Request, row: str) -> dict[str, Any]:
    """Reopen a decided request (Brett's own tap)."""
    return await _decide(request, row, "reopen")


@router.post("/approvals/auto-start")
async def post_auto_start(request: Request) -> dict[str, Any]:
    """Approve everything for N minutes (Brett's own tap, tapped twice on the screen)."""
    def call(s: Session, b: dict[str, Any]) -> tuple[str, Any]:
        minutes = b.get("minutes")
        if not isinstance(minutes, int) or minutes < 1 or minutes > 240:
            raise HTTPException(400, "minutes: 1 to 240")
        return "/auth/api/approvals/auto", {"minutes": minutes}
    return await run_action(request, "approvals", "auto-start", None, call)


@router.post("/approvals/auto-stop")
async def post_auto_stop(request: Request) -> dict[str, Any]:
    """Stop approving automatically (the auto-approve window ends now)."""
    return await run_action(request, "approvals", "auto-stop", None, lambda s, b: ("/auth/api/approvals/auto/stop", {}))


@router.post("/approvals/check")
async def post_check(request: Request) -> dict[str, Any]:
    """Read the hub again now and answer the Approvals state."""
    out = await run_action(request, "approvals", "check", None, None)
    state = await read_screen(request, "approvals")
    return {**out, "state": state}


# ---- Passes and veto (s11 / s12): grant and go are Brett's tap; request, extend and go-end are commands; revoke confirms

def _patterns(v: Any) -> list[str] | None:
    if isinstance(v, list):
        out = [str(x).strip() for x in v if str(x).strip()]
    elif isinstance(v, str):
        out = [x.strip() for x in v.split(",") if x.strip()]
    else:
        return None
    return out[:40] or None


def _pass_body(b: dict[str, Any]) -> dict[str, Any]:
    service = str(b.get("service") or "").strip()[:80]
    minutes = b.get("minutes")
    reason = str(b.get("reason") or "").strip()[:300]
    scope = _patterns(b.get("scope"))
    tools = _patterns(b.get("tools"))
    if not service or not reason or not (scope or tools):
        raise HTTPException(400, "a pass needs service, reason and a scope or tools")
    if not isinstance(minutes, int) or isinstance(minutes, bool) or minutes < 1 or minutes > 1440:
        raise HTTPException(400, "minutes: 1 to 1440")
    return {"service": service, **({"scope": scope} if scope else {}), **({"tools": tools} if tools else {}), "minutes": minutes, "reason": reason}


def _requests_file() -> Path:
    return _data() / "requests.jsonl"


def _mark_request(rid: str, state: str, by: str) -> None:
    f = _requests_file()
    if not f.exists():
        return
    out = []
    for line in f.read_text(encoding="utf-8").splitlines():
        try:
            j = json.loads(line)
        except ValueError:
            continue
        if isinstance(j, dict) and j.get("id") == rid:
            j = {**j, "state": state, "decidedAt": _now(), "decidedBy": by}
        out.append(json.dumps(j))
    f.write_text("\n".join(out) + ("\n" if out else ""), encoding="utf-8")


@router.post("/passes/grant")
async def post_pass_grant(request: Request) -> dict[str, Any]:
    """Switch a pass on (Brett's own tap): service, scope and/or tools, minutes, reason; requestId marks a waiting request granted."""
    b = await _body(request)
    payload = _pass_body(b)
    rid = str(b.get("requestId") or "")
    out = await run_action(request, "passes", "grant", None, lambda s, _b: ("/auth/api/passes", payload), b)
    if out.get("ok") and rid:
        _mark_request(rid, "granted", _caller(request))
    return out


@router.post("/passes/request")
async def post_pass_request(request: Request) -> dict[str, Any]:
    """Ask Brett for a pass: the request waits on the Passes screen with a Grant button (the grant stays his click)."""
    b = await _body(request)
    payload = _pass_body(b)
    rid = f"req-{int(time.time() * 1000):x}-{_secrets.token_hex(2)}"
    entry = {"id": rid, "state": "open", "by": _caller(request), "at": _now(), **payload}
    d = _data()
    d.mkdir(parents=True, exist_ok=True)
    with _requests_file().open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    notify = plugin_services.get("axf.notify@1")
    fn = getattr(notify, "send", None) if notify is not None else None
    if callable(fn):
        try:
            fn({"type": "hub.pass-request", "title": f"Pass asked: {payload['service']} for {payload['minutes']} min", "body": payload["reason"], "open": "view:hub/tab:hub.tabs=passes", "owner": FOLDER})
        except Exception:  # noqa: BLE001 — the request is written whether or not the phone hears about it
            pass
    out = await run_action(request, "passes", "request", None, None, b)
    return {**out, "request": entry, "message": "Asked. It waits on Hub → Passes for Brett's Grant."}


@router.post("/passes/{row}/revoke")
async def post_pass_revoke(request: Request, row: str) -> dict[str, Any]:
    """Revoke a pass now (a confirm: the first call answers a token, the second carries it)."""
    return await run_action(request, "passes", "revoke", row, lambda s, b: (f"/auth/api/passes/{row}/revoke", {}))


@router.post("/passes/{row}/extend")
async def post_pass_extend(request: Request, row: str) -> dict[str, Any]:
    """Extend a pass: {minutes} from now."""
    def call(s: Session, b: dict[str, Any]) -> tuple[str, Any]:
        minutes = b.get("minutes")
        if not isinstance(minutes, int) or isinstance(minutes, bool) or minutes < 1 or minutes > 1440:
            raise HTTPException(400, "minutes: 1 to 1440")
        return f"/auth/api/passes/{row}/extend", {"minutes": minutes}
    return await run_action(request, "passes", "extend", row, call)


@router.post("/passes/go")
async def post_go_pass(request: Request) -> dict[str, Any]:
    """Go pass for N hours (Brett's own tap): sessions that cannot reach axHub may work."""
    def call(s: Session, b: dict[str, Any]) -> tuple[str, Any]:
        hours = b.get("hours")
        if not isinstance(hours, int) or isinstance(hours, bool) or hours < 1 or hours > 72:
            raise HTTPException(400, "hours: 1 to 72")
        return "/auth/api/go-pass", {"hours": hours, "note": str(b.get("note") or "")[:200]}
    return await run_action(request, "passes", "go", None, call)


@router.post("/passes/go-end")
async def post_go_pass_end(request: Request) -> dict[str, Any]:
    """End the go pass now."""
    return await run_action(request, "passes", "go-end", None, lambda s, b: ("/auth/api/go-pass/end", {}))


# ---- the veto countdown (s12): the registered setting axf.hub.veto.countdownSeconds writes the policy table (a confirm)

VETO_SETTING = "axf.hub.veto.countdownSeconds"


def veto_changes(policy: dict[str, Any], seconds: int) -> list[dict[str, Any]]:
    """Every tool whose effective policy is veto gets the new countdown (one PUT, all or nothing on the hub)."""
    out = []
    for svc in policy.get("services", []) if isinstance(policy, dict) else []:
        if not isinstance(svc, dict) or not svc.get("namespace"):
            continue
        for t in svc.get("tools", []) if isinstance(svc.get("tools"), list) else []:
            if isinstance(t, dict) and t.get("name") and t.get("policy") == "veto":
                out.append({"service": svc["namespace"], "tool": t["name"], "vetoSeconds": seconds})
    return out


@router.post("/passes/veto-countdown")
async def post_veto_countdown(request: Request) -> dict[str, Any]:
    """Set the veto countdown (seconds) on every tool axHub holds for a veto: the registered setting's write (a confirm)."""
    def call(s: Session, b: dict[str, Any]) -> tuple[str, Any, str]:
        seconds = b.get("seconds")
        pol = policy_table()
        if not pol["ok"]:
            raise Unavailable(pol)
        veto = pol["data"].get("veto") if isinstance(pol["data"], dict) else {}
        lo, hi = (veto or {}).get("min", 10), (veto or {}).get("max", 1800)
        if not isinstance(seconds, int) or isinstance(seconds, bool) or seconds < lo or seconds > hi:
            raise HTTPException(400, f"seconds: {lo} to {hi}")
        changes = veto_changes(pol["data"], seconds)
        if not changes:
            raise LookupError("no tool on the hub is held for a veto, so there is no countdown to set")
        return "/auth/api/policy", {"changes": changes, "reason": str(b.get("reason") or f"Veto countdown {seconds} s from the console")[:200]}, "PUT"
    return await run_action(request, "passes", f"setting:{VETO_SETTING}", None, call)


# ---- Users (s13 / s14): invite, role, permissions, disable, sign-out and delete confirm; password is Brett's tap; profile and enable are commands

def _user_action(action: str, build: Callable[[dict[str, Any]], dict[str, Any]]) -> Callable[[Session, dict[str, Any]], tuple[str, Any]]:
    def call(s: Session, b: dict[str, Any]) -> tuple[str, Any]:
        return f"/auth/api/users/{b['_row']}", {"action": action, **build(b)}
    return call


def _str(b: dict[str, Any], k: str, max_len: int = 200, required: bool = False) -> str:
    v = b.get(k)
    if v is None or v == "":
        if required:
            raise HTTPException(400, f"{k} is needed")
        return ""
    if not isinstance(v, str):
        raise HTTPException(400, f"{k} must be text")
    return v.strip()[:max_len]


async def _user(request: Request, row: str, action: str, call: Callable[[Session, dict[str, Any]], tuple[str, Any]]) -> dict[str, Any]:
    b = await _body(request)
    return await run_action(request, "users", action, row, call, {**b, "_row": row})


@router.post("/users/invite")
async def post_users_invite(request: Request) -> dict[str, Any]:
    """Add a hub account with a temporary password they replace at first sign-in (a confirm)."""
    def call(s: Session, b: dict[str, Any]) -> tuple[str, Any]:
        username = _str(b, "username", 80, True)
        password = _str(b, "password", 200, True)
        role = _str(b, "role", 20) or "user"
        return "/auth/api/users", {"username": username, "name": _str(b, "name"), "email": _str(b, "email"), "password": password, "role": role}
    return await run_action(request, "users", "invite", None, call)


@router.post("/users/{row}/profile")
async def post_user_profile(request: Request, row: str) -> dict[str, Any]:
    """Save an account's name and email."""
    return await _user(request, row, "profile", _user_action("profile", lambda b: {"name": _str(b, "name"), "email": _str(b, "email")}))


@router.post("/users/{row}/role")
async def post_user_role(request: Request, row: str) -> dict[str, Any]:
    """Change an account's role (a confirm)."""
    return await _user(request, row, "role", _user_action("role", lambda b: {"role": _str(b, "role", 20, True)}))


@router.post("/users/{row}/permissions")
async def post_user_permissions(request: Request, row: str) -> dict[str, Any]:
    """Save the permissions apps behind the wall see for an account (a confirm)."""
    def build(b: dict[str, Any]) -> dict[str, Any]:
        perms = b.get("permissions")
        if not isinstance(perms, list) or any(not isinstance(x, str) for x in perms):
            raise HTTPException(400, "permissions must be a list of strings")
        return {"permissions": [x.strip()[:120] for x in perms if x.strip()][:200]}
    return await _user(request, row, "permissions", _user_action("permissions", build))


@router.post("/users/{row}/password")
async def post_user_password(request: Request, row: str) -> dict[str, Any]:
    """Set a temporary password for an account (Brett's own tap; never stored or logged here)."""
    return await _user(request, row, "password", _user_action("password", lambda b: {"password": _str(b, "password", 200, True)}))


@router.post("/users/{row}/enable")
async def post_user_enable(request: Request, row: str) -> dict[str, Any]:
    """Enable a disabled account."""
    return await _user(request, row, "enable", _user_action("enable", lambda b: {}))


@router.post("/users/{row}/disable")
async def post_user_disable(request: Request, row: str) -> dict[str, Any]:
    """Disable an account (a confirm)."""
    return await _user(request, row, "disable", _user_action("disable", lambda b: {}))


@router.post("/users/{row}/signout")
async def post_user_signout(request: Request, row: str) -> dict[str, Any]:
    """Sign an account out of every browser (a confirm)."""
    return await _user(request, row, "signout", _user_action("signout", lambda b: {}))


@router.delete("/users/{row}")
async def delete_user(request: Request, row: str) -> dict[str, Any]:
    """Delete an account (a confirm; the hub keeps the last admin and Brett's own account safe)."""
    return await _user(request, row, "delete", _user_action("delete", lambda b: {"sure": True}))


# ---- Approval log (s10): the hub's whole log as JSON, a command

@router.post("/log/download")
async def post_log_download(request: Request) -> dict[str, Any]:
    """The hub's whole approval log as JSON (the same file its Download JSON button serves), through the console's hub session."""
    s = Session(request)
    r = await run_in_threadpool(s.get, "/auth/admin/approvals/log.json")
    out = {"ok": True, "via": r["via"], "log": r["json"], "message": "The hub's approval log."} if r["ok"] else r
    _audit({"by": _caller(request), "screen": "log", "action": "download", "row": None, "who": "command", "ok": out["ok"], "code": out.get("code", ""), "via": out.get("via", "")})
    return {"screen": "log", "action": "download", **out}


# ---------------------------------------------------------------- systems check: can the console read the hub?

HEALTH_ID = "hub-console-read"
_health_done = False


def health_probe() -> dict[str, Any]:
    relay = plugin_services.get(RELAY_CAP)
    if relay is None:
        return {"status": "warn", "summary": "The Hub screens read axHub only with the browser's own session: the approvals-banner plugin (the relay) is off.", "details": []}
    if not HUB_LINK.configured():
        return {"status": "warn", "summary": "Connectors can't be listed: the console has no axHub token (AXHUB_TOKEN).", "details": []}
    return {"status": "ok", "summary": "The Hub screens read axHub through the relay and the console's hub token.", "details": []}


def ensure_health() -> bool:
    global _health_done
    if _health_done:
        return True
    reg = plugin_services.get(HEALTH_CAP)
    if reg is None:
        return False
    try:
        reg.register({"id": HEALTH_ID, "label": "Hub screens (reading axHub)", "service": "axhub", "order": 41, "severity": "warn", "run": lambda: health_probe(),
                      "breaks": "Without the relay or the hub token the Hub screens show 'signed out' or empty connectors.",
                      "instructions": ["Keep the approvals-banner plugin enabled (it holds the hub session).", "Set AXHUB_TOKEN (Settings → Plugins → Systems check → Keys) for the connectors list."]}, FOLDER)
    except Exception:  # noqa: BLE001 — the screens work without the health item
        return False
    _health_done = True
    return True
