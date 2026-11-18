"""Hub plugin server (hub-console@1 reads): every screen's state through the relay service or the browser's own cookie,
with retries and a clear unavailable state; bearer reads through axHub's MCP tools and the policy table.

    python apps/console-web/plugins/hub-admin/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "server"))
DATA = tempfile.mkdtemp()
os.environ["AXF_HUB_ADMIN_DATA_DIR"] = DATA
os.environ["AXF_WALL_HUB"] = "https://hub.example.test"
os.environ["AXHUB_URL"] = "https://hub.example.test"
os.environ["AXHUB_TOKEN"] = "HUB-tok-abcdef0123"

import httpx  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import plugin_services  # noqa: E402

spec = importlib.util.spec_from_file_location("hub_admin_server", HERE / "server" / "__init__.py")
srv = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(srv)
srv.BACKOFF_S = 0.0

checks = 0


def ok(v: object, what: str) -> None:
    global checks
    assert v, what
    checks += 1


# ---------------------------------------------------------------- a fake hub (its /auth/api JSON pages + /mcp)

ID = "0123abcd-0123-4abc-8def-0123456789ab"
state: dict[str, Any] = {"sessions": {"good"}, "down": 0, "old": False, "mcp_down": 0, "policy": 200}
seen: list[httpx.Request] = []
APPROVALS = {"filters": [{"id": "all", "label": "All"}], "filter": "all", "page": 1, "pages": 1, "total": 1, "waiting": 1, "heldCount": 0, "postponed": 0,
             "items": [{"id": ID, "tool": "vps.run", "title": "Restart nginx", "status": "pending", "revision": 2}], "auto": {"available": True, "minutes": [5]}, "log": True}


def hub(req: httpx.Request) -> httpx.Response:
    seen.append(req)
    p = req.url.path
    if state["down"] > 0:
        state["down"] -= 1
        return httpx.Response(503, text="down")
    if p.startswith("/auth/api/") and state["old"]:
        return httpx.Response(404, text="no such page")
    cookie = (req.headers.get("cookie") or "").replace("axhub_session=", "")
    bearer = (req.headers.get("authorization") or "") == f"Bearer {os.environ.get('AXHUB_TOKEN', '')}" and bool(os.environ.get("AXHUB_TOKEN"))
    if p == "/auth/api/policy" and not bearer and cookie not in state["sessions"]:
        return httpx.Response(401, json={"error": {"code": "signed_out", "message": "Sign in"}})
    if (p.startswith("/auth/api/") and p != "/auth/api/policy") or p in ("/apps.json", "/auth/admin/approvals/log.json"):
        if cookie not in state["sessions"]:
            return httpx.Response(401, json={"error": {"code": "signed_out", "message": "Sign in"}})
    if p == "/auth/api/session":
        return httpx.Response(200, json={"signedIn": True, "admin": True, "csrf": "c1", "user": {"username": "brett"}, "can": {"approvals": True}})
    if p == "/auth/api/approvals":
        return httpx.Response(200, json={**APPROVALS, "filter": req.url.params.get("status", "all"), "page": int(req.url.params.get("page", "1"))})
    if p == f"/auth/api/approvals/{ID}":
        return httpx.Response(200, json={"item": APPROVALS["items"][0], "auto": APPROVALS["auto"]})
    if p == "/auth/admin/approvals/log.json":
        return httpx.Response(200, json={"entries": [{"id": "e1"}], "total": 1})
    if p == "/auth/api/approvals/log":
        return httpx.Response(200, json={"total": 1, "page": 1, "pages": 1, "tools": ["vps.run"], "statuses": ["approved"], "counts": {"approved": 1}, "entries": [{"id": "e1", "qualifiedTool": "vps.run", "status": "approved"}], "underPass": 0, "windows": [],
                                         "echo": dict(req.url.params)})
    if p == "/auth/api/passes":
        if req.method == "POST":
            return httpx.Response(200, json={"ok": True, "message": "Pass on", "pass": {"id": "p2"}})
        return httpx.Response(200, json={"active": [{"id": "p1", "secondsLeft": 100}], "recent": [], "minutes": {"min": 5, "max": 240, "presets": [30]}, "now": "2026-11-17T12:00:00Z"})
    if p in ("/auth/api/passes/p1/revoke", "/auth/api/passes/p1/extend", "/auth/api/go-pass/end") and req.method == "POST":
        return httpx.Response(200, json={"ok": True, "message": "Done"})
    if p == "/auth/api/go-pass":
        return httpx.Response(200, json={"live": False, "hours": [4], "repos": [], "branch": "go-pass", "file": "GO", "writes": []})
    if p == "/auth/api/users" and req.method == "POST":
        return httpx.Response(200, json={"ok": True, "message": "Added."})
    if p.startswith("/auth/api/users/") and req.method == "POST":
        return httpx.Response(200, json={"ok": True, "message": "Saved."})
    if p == "/auth/api/users":
        return httpx.Response(200, json={"you": "u1", "roles": ["admin", "user"], "passwordMin": 12, "tempPasswordMin": 8, "hints": [], "users": [{"id": "u1", "username": "brett", "role": "admin", "disabled": False, "name": "Brett", "email": "", "permissions": [], "mustChangePassword": False, "weakPassword": False, "createdAt": "", "passwordChangedAt": ""}]})
    if p == "/auth/api/account":
        return httpx.Response(200, json={"user": {"username": "brett", "role": "admin"}, "passwordMin": 12, "browsers": [{"id": "b1", "label": "Phone", "lastSeenAt": "", "current": True}]})
    if p == "/auth/api/handoff":
        return httpx.Response(200, json={"runs": [{"id": "20261117-093000-ab12", "at": 1, "project": "x", "repo": "r", "commit": "c", "published": None, "failed": False, "files": 2}]})
    if p == "/auth/api/handoff/20261117-093000-ab12":
        return httpx.Response(200, json={"id": "20261117-093000-ab12", "at": 1, "project": "x", "repo": "r", "commit": "c", "published": None, "failed": False, "note": "", "instructions": "", "prompt": "P", "files": [], "log": [], "elapsed": 3, "steps": [], "sentAt": 0})
    if p in ("/auth/api/auth/clients", "/auth/api/auth/tokens"):
        return httpx.Response(404, json={"error": {"code": "not_found", "message": "no such page"}})
    if p == "/apps.json":
        return httpx.Response(200, json={"apps": [{"project": "amberx", "name": "AmberX"}], "updatedAt": "2026-11-17T00:00:00Z"})
    if p == "/auth/api/policy" and req.method == "PUT":
        return httpx.Response(200, json={"ok": True, "table": {"$axf": "policy-table@1"}})
    if p == "/auth/api/policy":
        if state["policy"] != 200:
            return httpx.Response(state["policy"], text="no")
        return httpx.Response(200, json={"$axf": "policy-table@1", "services": [{"namespace": "vps", "type": "ssh", "enabled": True, "defaultPolicy": "deny", "toolsStale": False, "tools": [{"name": "run", "policy": "veto", "vetoSeconds": 90}]},
                                                                               {"namespace": "dead", "type": "http", "enabled": True, "defaultPolicy": "deny", "toolsStale": True, "tools": []}], "veto": {"defaultSeconds": 90, "min": 10, "max": 1800}})
    if p == "/mcp":
        if state["mcp_down"] > 0:
            state["mcp_down"] -= 1
            return httpx.Response(502, text="bad gateway")
        body = json.loads(req.content)
        if body["method"] == "initialize":
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": {}}, headers={"mcp-session-id": "s1"})
        if body["method"] == "notifications/initialized":
            return httpx.Response(202)
        name = body["params"]["name"]
        if name == "list_services":
            text = json.dumps({"services": [{"namespace": "vps", "type": "ssh", "tools": ["run", "logs"], "status": "ok"}, {"namespace": "github", "type": "http", "tools": ["list_repos"]}]})
        elif name == "describe_service":
            svc = body["params"]["arguments"]["service"]
            if svc not in ("vps", "github"):
                return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": {"isError": True, "content": [{"type": "text", "text": json.dumps({"error": {"message": f"unknown service {svc}"}})}]}})
            text = json.dumps({"namespace": svc, "tools": [{"name": "run", "inputSchema": {"type": "object"}}]})
        else:
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": {"isError": True, "content": [{"type": "text", "text": json.dumps({"error": {"message": "no such tool"}})}]}})
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": {"content": [{"type": "text", "text": text}]}})
    return httpx.Response(404, text="?")


real_client = httpx.Client


class HubClient:
    def __new__(cls, **kw):  # noqa: ANN003
        kw.pop("transport", None)
        return real_client(transport=httpx.MockTransport(hub), **kw)


srv.httpx.Client = HubClient


def hub_transport(req: Any) -> Any:
    """axf_server.http transport: (Request) → Response, over the same fake hub."""
    body = req.body if isinstance(req.body, (bytes, bytearray)) else (req.body or b"")
    r = hub(httpx.Request(req.method, req.url, headers=dict(req.headers), content=bytes(body)))
    return srv.axf_http.Response(status=r.status_code, headers=dict(r.headers), body=r.content, url=str(req.url))


srv.HUB_LINK = srv.HubLink("https://hub.example.test", lambda: os.environ.get("AXHUB_TOKEN", ""), transport=hub_transport, client_name="test")

app = FastAPI()
app.include_router(srv.router)
c = TestClient(app, base_url="https://console.example.test", raise_server_exceptions=True)


def get(path: str, cookies: dict | None = None, **params: Any):
    c.cookies.clear()
    for k, v in (cookies or {}).items():
        c.cookies.set(k, v)
    return c.get(path, params=params)


GOOD = {"axhub_session": "good"}

# ---------------------------------------------------------------- the table and the browser's own cookie (no relay plugin)

r = get("/table")
ok(r.status_code == 200 and r.json()["table"]["$axf"] == "hub-console@1", "the route table is served")

r = get("/approvals", GOOD, status="pending", page=2)
j = r.json()
ok(r.status_code == 200 and j["ok"] and j["screen"] == "approvals" and j["shape"] == "approval-grid@1", "approvals state through the browser's own cookie")
ok(j["filter"] == "pending" and j["page"] == 2 and j["items"][0]["id"] == ID and j["via"] == "browser", "status + page reach the hub; the table's fields come back")
ok(set(srv.screen_of(srv.load_table(), "approvals")["state"]["fields"]) <= set(j), "every field the table names is present")
ok(get("/approvals", GOOD, status="bogus").json()["filter"] == "all", "an unknown status filter falls back to all")

r = get("/approvals", None)
ok(r.status_code == 200 and r.json()["ok"] is False and r.json()["code"] == "relay_off", "no cookie and no relay plugin: relay_off, in words")
r = get("/approvals", {"axhub_session": "stale"})
ok(r.json()["code"] == "signed_out", "a session the hub refuses: signed_out")

r = get(f"/approvals/{ID}", GOOD)
ok(r.json()["ok"] and r.json()["item"]["id"] == ID and r.json()["row"] == ID and r.json()["shape"] == "approval-item@1", "one approval row")
ok(get("/approvals/not-an-id", GOOD).status_code == 400, "a row id outside the screen's pattern is 400")
ok(get("/nowhere", GOOD).status_code == 404, "an unknown screen is 404")

# old hub: 404 on /auth/api
state["old"] = True
ok(get("/approvals", GOOD).json()["code"] == "old_hub", "a hub without JSON pages: old_hub")
state["old"] = False

# retries: two 503s then an answer
before = len(seen)
state["down"] = 2
j = get("/approvals", GOOD).json()
ok(j["ok"] and len(seen) - before == 3, f"two 503s are retried and the third answer is served ({len(seen) - before} calls)")
state["down"] = 10
j = get("/approvals", GOOD).json()
ok(j["ok"] is False and j["code"] == "hub_unavailable", "a hub that stays down: hub_unavailable after the retries")
state["down"] = 0

# the other session screens
j = get("/log", GOOD, q="nginx", via="web", sort="oldest", tool="vps.run").json()
ok(j["ok"] and j["entries"][0]["id"] == "e1" and j["shape"] == "approval-log@1", "approval log")
j = get("/users", GOOD).json()
ok(j["ok"] and j["users"][0]["username"] == "brett" and j["roles"] == ["admin", "user"], "users")
ok(get("/users/u1", GOOD).json()["username"] == "brett", "one user")
ok(get("/users/u9", GOOD).status_code == 404, "an unknown user is 404")
j = get("/account", GOOD).json()
ok(j["ok"] and j["browsers"][0]["id"] == "b1" and j["phone"]["available"] is False and j["notifications"]["opens"].startswith("view:claude-settings"), "account with the phone and notification links")
j = get("/handoff", GOOD).json()
ok(j["ok"] and j["runs"][0]["id"] == "20261117-093000-ab12", "handoff runs")
ok(get("/handoff/20261117-093000-ab12", GOOD).json()["prompt"] == "P", "one handoff run")
ok(get("/handoff/20261117-093000-zz!!", GOOD).status_code == 400, "a handoff row id outside the pattern is refused")
j = get("/apps", GOOD).json()
ok(j["ok"] and j["status"] == "ok" and j["apps"][0]["project"] == "amberx", "app catalog")
j = get("/auth", GOOD).json()
ok(j["ok"] and j["signIn"]["accounts"] == 1 and j["signIn"]["admins"] == 1, "auth admin: sign-in rules from the users page")
ok(j["missing"]["clients"]["code"] == "hub_missing" and j["missing"]["tokens"]["proposed"].startswith("POST /auth/api/auth/tokens"), "OAuth clients and tokens: hub_missing with the proposed route")
j = get("/overview", GOOD).json()
ok(j["ok"] and j["signedIn"] and j["admin"] and j["waiting"] == 1 and j["relay"]["relay"] is False, "overview: session, waiting count, relay state (relay plugin off)")
j = get("/overview").json()
ok(j["ok"] and j["signedIn"] is False and "approvals-banner" in j["note"], "overview without any session is still an answer")

# ---------------------------------------------------------------- the bearer channel: connectors + one service

j = get("/connectors", GOOD).json()
ok(j["ok"] and [s["namespace"] for s in j["services"]] == ["dead", "github", "vps"], f"connectors merge the policy table and list_services ({[s['namespace'] for s in j['services']]})")
vps = next(s for s in j["services"] if s["namespace"] == "vps")
ok(vps["listed"] and vps["defaultPolicy"] == "deny" and vps["toolCount"] == 2, "a service carries its policy row and its listing")
ok(next(h for h in j["health"] if h["namespace"] == "dead")["status"] == "warn" and j["veto"]["defaultSeconds"] == 90, "health marks a stale service; the veto block rides along")
j = get("/connectors/vps", GOOD).json()
ok(j["ok"] and j["tools"][0]["name"] == "run" and j["policyTools"][0]["policy"] == "veto" and j["recentCalls"][0]["id"] == "e1", "one service: described tools, policy, recent calls")
ok(get("/connectors/nope", GOOD).status_code == 404, "an unknown service is 404")
ok(get("/connectors/Bad Name", GOOD).status_code == 400, "a service id outside the pattern is 400")

state["mcp_down"] = 2
j = get("/connectors", GOOD).json()
ok(j["ok"] and any(s["namespace"] == "github" for s in j["services"]), "MCP trouble is retried")
state["mcp_down"] = 10
j = get("/connectors", GOOD).json()
ok(j["ok"] and "listUnavailable" in j and j["listUnavailable"]["code"] == "hub_unavailable" and [s["namespace"] for s in j["services"]] == ["dead", "vps"], "MCP down for good: the policy table alone, and the unavailable part named")
state["mcp_down"] = 0
state["policy"] = 404
j = get("/connectors", GOOD).json()
ok(j["ok"] and j["policyUnavailable"]["code"] == "old_hub", "no policy API: old_hub named, listing still served")
state["policy"] = 200

tok = os.environ.pop("AXHUB_TOKEN")
srv.HUB_LINK = srv.HubLink("https://hub.example.test", lambda: "", transport=hub_transport, client_name="test")
j = get("/connectors", GOOD).json()
ok(j["ok"] is False and j["code"] == "hub_unavailable" and "AXHUB_TOKEN" in j["message"], "no hub token: a clear unavailable state")
os.environ["AXHUB_TOKEN"] = tok
srv.HUB_LINK = srv.HubLink("https://hub.example.test", lambda: tok, transport=hub_transport, client_name="test")

# ---------------------------------------------------------------- through the relay service (the approvals-banner plugin on)

calls: list[tuple[str, dict | None]] = []


class FakeRelay:
    mode = "owner"

    def state(self, request):  # noqa: ANN001
        return {"relay": True, "via": self.mode, "reason": ""}

    def read(self, request, path, params=None, timeout=0):  # noqa: ANN001
        calls.append((path, params))
        if self.mode == "signed_out":
            return {"ok": False, "code": "signed_out", "status": 401, "message": "no owner sign-in"}
        if self.mode == "down":
            return {"ok": False, "code": "unreachable", "status": 0, "message": "boom"}
        r = hub(httpx.Request("GET", f"https://hub.example.test{path}", params=params, headers={"cookie": "axhub_session=good"}))
        return {"ok": r.status_code == 200, "status": r.status_code, "json": r.json() if r.status_code == 200 else {}, "via": self.mode, **({} if r.status_code == 200 else {"code": "old_hub" if r.status_code == 404 else "hub_error"})}


relay = FakeRelay()
plugin_services.provide("axf.hub-relay@1", relay, "approvals-banner")
j = get("/approvals").json()
ok(j["ok"] and j["via"] == "owner" and calls[-1][0] == "/auth/api/approvals", "with the relay on, a browser without a cookie still reads through the owner sign-in")
j = get("/overview").json()
ok(j["ok"] and j["relay"]["via"] == "owner", "overview reports the relay state")
relay.mode = "signed_out"
ok(get("/users").json()["code"] == "signed_out", "the relay's signed_out comes through as signed_out")
relay.mode = "down"
n0 = len(calls)
j = get("/users").json()
ok(j["code"] == "hub_unavailable" and len(calls) - n0 == srv.RETRIES, "an unreachable hub through the relay is retried, then named")
relay.mode = "owner"
j = get("/passes").json()
ok(j["ok"] and j["active"][0]["id"] == "p1" and j["goPass"]["live"] is False and j["veto"]["defaultSeconds"] == 90 and j["requests"] == [] and j["noWait"] is None, "passes: passes + go pass + veto + requests + No wait")
(Path(DATA) / "requests.jsonl").write_text(json.dumps({"id": "r1", "service": "vps", "minutes": 30, "state": "open"}) + "\n" + json.dumps({"id": "r0", "state": "done"}) + "\n")
ok([q["id"] for q in get("/passes").json()["requests"]] == ["r1"], "open pass requests from the plugin's data folder show on the Passes screen")

# ---------------------------------------------------------------- actions (s8): who may run each, through the relay

writes: list[tuple[str, Any, bool]] = []


class FakeRelayWrites(FakeRelay):
    def write(self, request, path, body, person, timeout=0, method="POST"):  # noqa: ANN001
        writes.append((path, body, person) if method == "POST" else (method, path, body, person))
        if person and not getattr(self, "admin_browser", True):
            return {"ok": False, "code": "person_required", "status": 403, "message": "Only your own tap in your signed-in console browser does this."}
        if path.endswith("/approve-now"):
            return {"ok": True, "status": 200, "json": {"ok": True, "state": "approved-now", "message": "Approved, running now"}, "via": "browser"}
        if path.endswith("/auto/stop"):
            return {"ok": True, "status": 200, "json": {"message": "Stopped."}, "via": "owner"}
        if path.startswith("/auth/api/users") or path.startswith("/auth/api/account") or path == "/auth/api/logout":
            return {"ok": True, "status": 200, "json": {"ok": True, "message": "Saved."}, "via": "browser"}
        return {"ok": True, "status": 200, "json": {"ok": True, "message": "Done.", "item": {"id": ID, "status": "declined"}}, "via": "browser"}


relay_w = FakeRelayWrites()
plugin_services.provide("axf.hub-relay@1", relay_w, "approvals-banner")
HELD = "0123abcd-0123-4abc-8def-00000000ae1d"
_items_held = {"id": HELD, "tool": "vps.run", "title": "Restart nginx", "status": "held", "revision": 1, "veto": {"runsAt": "2026-11-17T12:01:00Z", "secondsLeft": 60, "countdownSeconds": 90, "actions": ["deny", "approve-now", "shelve"]}}


def hub_with_held(req: httpx.Request) -> httpx.Response:
    if req.url.path == f"/auth/api/approvals/{HELD}":
        return httpx.Response(200, json={"item": _items_held, "auto": APPROVALS["auto"]})
    return hub(req)


relay_w_read = relay_w.read


def read_with_held(request, path, params=None, timeout=0):  # noqa: ANN001
    if path == f"/auth/api/approvals/{HELD}":
        return {"ok": True, "status": 200, "json": {"item": _items_held, "auto": APPROVALS["auto"]}, "via": "owner"}
    return relay_w_read(request, path, params, timeout)


relay_w.read = read_with_held  # type: ignore[method-assign]


def post(path: str, body: dict | None = None, cookies: dict | None = GOOD):
    c.cookies.clear()
    for k, v in (cookies or {}).items():
        c.cookies.set(k, v)
    return c.post(path, json=body or {}, headers={"origin": "https://console.example.test"})


j = post(f"/approvals/{ID}/deny", {"rev": 2}).json()
ok(j["ok"] and j["action"] == "deny" and j["row"] == ID and j["item"]["status"] == "declined", "deny a pending request: through the relay as Brett")
ok(writes[-1] == (f"/auth/api/approvals/{ID}", {"action": "decline", "rev": 2}, True), f"a pending Deny is the hub's decline with the revision shown, person=True ({writes[-1]})")
j = post(f"/approvals/{HELD}/approve").json()
ok(j["ok"] and j["state"] == "approved-now" and writes[-1] == (f"/auth/api/approvals/{HELD}/approve-now", {}, True), "approve a held call: the veto@1 approve-now route")
post(f"/approvals/{HELD}/shelve")
ok(writes[-1][0] == f"/auth/api/approvals/{HELD}/shelve" and writes[-1][2] is True, "shelve a held call: its own route, person")
post(f"/approvals/{ID}/postpone", {"minutes": 30})
ok(writes[-1] == (f"/auth/api/approvals/{ID}", {"action": "postpone", "rev": 2, "minutes": 30}, True), f"postpone carries its minutes ({writes[-1]})")
relay_w.admin_browser = False
j = post(f"/approvals/{ID}/approve").json()
ok(j["ok"] is False and j["code"] == "person_required", "without Brett's own browser a decision is refused: person_required")
relay_w.admin_browser = True
ok(post(f"/approvals/not-an-id/approve").status_code == 400, "a decision on a bad row id is 400")
ok(post(f"/approvals/{ID}/nope").status_code == 404, "an unknown action is 404")

j = post("/approvals/auto-stop").json()
ok(j["ok"] and writes[-1] == ("/auth/api/approvals/auto/stop", {}, False), "auto-stop is a command (person=False) on the hub's route")
ok(post("/approvals/auto-start", {"minutes": 999}).status_code == 400, "auto-start refuses minutes out of range")
post("/approvals/auto-start", {"minutes": 10})
ok(writes[-1] == ("/auth/api/approvals/auto", {"minutes": 10}, True), "auto-start is Brett's tap on the hub's auto route")
j = post("/approvals/check").json()
ok(j["ok"] and j["state"]["ok"] and j["state"]["screen"] == "approvals", "check reads the hub again and answers the state")
audit = [json.loads(line) for line in (Path(DATA) / "actions.jsonl").read_text().splitlines()]
ok(any(e["action"] == "deny" and e["ok"] and e["who"] == "person" for e in audit) and all("cookie" not in json.dumps(e) for e in audit), "every action is audited, never a cookie")

# without the relay plugin: a person write needs the admin browser (wall) and its own cookie
plugin_services.withdraw("approvals-banner")
srv.wall.wall_caller = lambda headers: None
j = post(f"/approvals/{ID}/deny").json()
ok(j["ok"] is False and j["code"] == "person_required", "relay off + not a wall admin: person_required")
admin = srv.wall.Caller("brett", "admin", frozenset(), "session")
srv.wall.wall_caller = lambda headers: admin
j = post(f"/approvals/{ID}/deny", {"rev": 2}).json()
ok(j["ok"] and j["via"] == "browser" and any(r.url.path == f"/auth/api/approvals/{ID}" and r.method == "POST" for r in seen), "relay off + wall admin + own cookie: the write goes with the browser session and the hub's CSRF")
j = post(f"/approvals/{ID}/deny", {}, cookies=None).json()
ok(j["ok"] is False and j["code"] == "relay_off", "relay off and no cookie: relay_off")
plugin_services.provide("axf.hub-relay@1", relay, "approvals-banner")

# ---------------------------------------------------------------- approval log (s10): download is a command
j = post("/log/download").json()
ok(j["ok"] and j["action"] == "download" and j["log"]["total"] == 1, "the whole log as JSON through the session")
relay.mode = "signed_out"
j = post("/log/download", cookies=None).json()
ok(j["ok"] is False and j["code"] == "signed_out", "no session anywhere: an unavailable state, not a stack trace")
relay.mode = "owner"

# ---------------------------------------------------------------- passes (s11 / s12): grant and go are Brett's tap, revoke confirms, the rest are commands
plugin_services.provide("axf.hub-relay@1", relay_w, "approvals-banner")
writes.clear()
j = post("/passes/grant", {"service": "vps", "scope": ["tokens.*"], "minutes": 30, "reason": "Theme work"}).json()
ok(j["ok"] and writes[-1] == ("/auth/api/passes", {"service": "vps", "scope": ["tokens.*"], "minutes": 30, "reason": "Theme work"}, True), f"grant: the hub's passes route as Brett's tap ({writes[-1]})")
ok(post("/passes/grant", {"service": "vps", "minutes": 30, "reason": "x"}).status_code == 400, "a grant without scope or tools is refused")
ok(post("/passes/grant", {"service": "vps", "scope": "a", "minutes": 0, "reason": "x"}).status_code == 400, "minutes out of range is refused")
j = post("/passes/request", {"service": "github", "tools": ["list_repos"], "minutes": 15, "reason": "Look at PRs"}).json()
ok(j["ok"] and j["request"]["state"] == "open" and j["request"]["service"] == "github", "a request is written and waits")
rid = j["request"]["id"]
reqs = get("/passes").json()["requests"]
ok(any(r["id"] == rid for r in reqs), "the request shows on the Passes screen")
j = post("/passes/grant", {"service": "github", "tools": ["list_repos"], "minutes": 15, "reason": "Look at PRs", "requestId": rid}).json()
ok(j["ok"] and not any(r["id"] == rid for r in get("/passes").json()["requests"]), "granting a request marks it granted")
n_writes = len(writes)
j = post("/passes/p1/revoke").json()
ok(j["ok"] is False and j["code"] == "confirmation_required" and j["confirm"] and len(writes) == n_writes, "revoke: the first call answers a token and nothing reaches the hub")
j2 = post("/passes/p1/revoke", {"confirm": "wrong"}).json()
ok(j2["code"] == "confirmation_required" and j2["confirm"] != j["confirm"], "a wrong token: a fresh token, still nothing sent")
j3 = post("/passes/p1/revoke", {"confirm": j2["confirm"]}).json()
ok(j3["ok"] and writes[-1] == ("/auth/api/passes/p1/revoke", {}, False), "the second call with the token revokes (person=False: a confirm command)")
j = post("/passes/p1/extend", {"minutes": 30}).json()
ok(j["ok"] and writes[-1] == ("/auth/api/passes/p1/extend", {"minutes": 30}, False), "extend is a plain command")
ok(post("/passes/p1/extend", {"minutes": "lots"}).status_code == 400, "extend needs minutes")
j = post("/passes/go", {"hours": 4, "note": "phone"}).json()
ok(j["ok"] and writes[-1] == ("/auth/api/go-pass", {"hours": 4, "note": "phone"}, True), "go pass is Brett's tap")
j = post("/passes/go-end").json()
ok(j["ok"] and writes[-1] == ("/auth/api/go-pass/end", {}, False), "ending the go pass is a command")
ok(post(f"/passes/{'x' * 201}/revoke").status_code == 400, "an absurd pass id (over 200 characters) is 400")

# ---------------------------------------------------------------- the veto countdown setting (s12): a confirm that PUTs the policy table
j = post("/passes/veto-countdown", {"seconds": 120}).json()
ok(j["ok"] is False and j["code"] == "confirmation_required" and j["action"] == f"setting:{srv.VETO_SETTING}", "the countdown setting's write confirms first")
j = post("/passes/veto-countdown", {"seconds": 120, "confirm": j["confirm"]}).json()
ok(j["ok"] and writes[-1][0] == "PUT" and writes[-1][1] == "/auth/api/policy" and writes[-1][2]["changes"] == [{"service": "vps", "tool": "run", "vetoSeconds": 120}] and writes[-1][3] is False, f"then PUTs the countdown onto every veto tool ({writes[-1]})")
ok(post("/passes/veto-countdown", {"seconds": 5}).status_code == 400, "a countdown under the hub's minimum is refused")
ok(srv.veto_changes({"services": [{"namespace": "a", "tools": [{"name": "x", "policy": "veto"}, {"name": "y", "policy": "allow"}]}]}, 60) == [{"service": "a", "tool": "x", "vetoSeconds": 60}], "only veto tools get the countdown")

# ---------------------------------------------------------------- users (s13 / s14)
def confirmed(path: str, body: dict | None = None, method: str = "POST"):
    """A confirm action, both calls: → the second answer."""
    first = c.request(method, path, json=body or {}, headers={"origin": "https://console.example.test"}).json()
    assert first.get("code") == "confirmation_required", first
    return c.request(method, path, json={**(body or {}), "confirm": first["confirm"]}, headers={"origin": "https://console.example.test"}).json()


c.cookies.clear(); c.cookies.set("axhub_session", "good")
j = confirmed("/users/invite", {"username": "sam", "name": "Sam", "email": "", "password": "temp-pass-123", "role": "user"})
ok(j["ok"] and writes[-1] == ("/auth/api/users", {"username": "sam", "name": "Sam", "email": "", "password": "temp-pass-123", "role": "user"}, False), f"invite confirms, then posts the account ({writes[-1][0]})")
ok(post("/users/invite", {"username": "sam"}).status_code == 400, "invite without a temporary password is refused before any token")
j = post("/users/u1/profile", {"name": "Brett M", "email": "b@example.test"}).json()
ok(j["ok"] and writes[-1] == ("/auth/api/users/u1", {"action": "profile", "name": "Brett M", "email": "b@example.test"}, False), "profile is a plain command")
j = confirmed("/users/u1/role", {"role": "admin"})
ok(j["ok"] and writes[-1][1] == {"action": "role", "role": "admin"}, "role change confirms")
j = confirmed("/users/u1/permissions", {"permissions": ["console.plugin.theme-manager", " apps.download "]})
ok(j["ok"] and writes[-1][1] == {"action": "permissions", "permissions": ["console.plugin.theme-manager", "apps.download"]}, "permissions confirm and are trimmed")
ok(post("/users/u1/permissions", {"permissions": "nope"}).status_code == 400, "permissions must be a list")
j = post("/users/u1/password", {"password": "new-temp-123"}).json()
ok(j["ok"] and writes[-1] == ("/auth/api/users/u1", {"action": "password", "password": "new-temp-123"}, True), "a temporary password is Brett's tap")
audit = [json.loads(line) for line in (Path(DATA) / "actions.jsonl").read_text().splitlines()]
ok(not any("new-temp-123" in json.dumps(e) for e in audit), "the password never reaches the audit log")
ok(post("/users/u1/enable").json()["ok"] and writes[-1][1] == {"action": "enable"}, "enable is a command")
ok(confirmed("/users/u1/disable")["ok"] and writes[-1][1] == {"action": "disable"}, "disable confirms")
ok(confirmed("/users/u1/signout")["ok"] and writes[-1][1] == {"action": "signout"}, "sign-out everywhere confirms")
j = confirmed("/users/u1", None, "DELETE")
ok(j["ok"] and writes[-1][1] == {"action": "delete", "sure": True}, "delete is a DELETE that confirms and carries sure")
ok(c.delete("/users/u1").json()["code"] == "confirmation_required", "a bare DELETE only hands out a token")

# ---------------------------------------------------------------- account (s15 / s16) and the overview actions
j = post("/account/profile", {"name": "Brett", "email": "b@example.test"}).json()
ok(j["ok"] and writes[-1] == ("/auth/api/account/profile", {"name": "Brett", "email": "b@example.test"}, False), "account profile is a command")
j = post("/account/password", {"current": "old-pass-1", "password": "new-pass-12345", "confirm": "new-pass-12345"}).json()
ok(j["ok"] and writes[-1][2] is True and writes[-1][0] == "/auth/api/account/password", "changing the password is Brett's tap")
ok(post("/account/password", {"current": "a", "password": "b", "confirm": "c"}).status_code == 400, "mismatched new passwords are refused")
ok(confirmed("/account/signout-others")["ok"] and writes[-1][0] == "/auth/api/account/signout-others", "signing the other browsers out confirms")
j = post("/account/signout").json()
ok(j["ok"] and writes[-1] == ("/auth/api/logout", {}, True), "signing out is Brett's tap on the hub's logout")
j = post("/account/phone").json()
ok(j["ok"] and j["opens"].startswith("view:settings/tab:settings.tabs=plugins"), "the phone action answers the Phone Connect settings address")
ok(post("/account/notifications").json()["opens"].startswith("view:claude-settings"), "the notifications action answers the Claude settings address")
j = post("/overview/check").json()
ok(j["ok"] and j["state"]["screen"] == "overview", "overview check reads again")
ok(post("/overview/sign-in").json()["opens"].endswith("/auth/login"), "sign-in answers the hub's own page")
ok(post("/overview/sign-out").json()["ok"] and writes[-1] == ("/auth/api/logout", {}, True), "sign-out from the overview is Brett's tap")

# ---------------------------------------------------------------- the manifest declares every read with its tool

manifest = json.loads((HERE / "plugin.json").read_text())
declared = {it["route"]: it.get("tool") for it in manifest["commands"]["items"] if it.get("route")}
table = srv.load_table()
for s in table["screens"]:
    ok(declared.get(f"GET /{s['id']}") == s["state"]["tool"], f"GET /{s['id']} is declared as {s['state']['tool']}")
    if s.get("rows", {}).get("read"):
        ok(declared.get(f"GET /{s['id']}/{{row}}") == s["rows"]["read"]["tool"], f"GET /{s['id']}/{{row}} is declared as {s['rows']['read']['tool']}")
for s in table["screens"]:
    ok(s["id"] in srv.READERS, f"{s['id']} has a reader")
    if s.get("rows", {}).get("read"):
        ok(s["id"] in srv.ROW_READERS, f"{s['id']} has a row reader")

print(f"hub-admin server ok ({checks} checks)")
