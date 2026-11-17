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
    fn = getattr(cs, "no_wait_state", None) if cs is not None else None
    if callable(fn):
        try:
            no_wait = fn()
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
