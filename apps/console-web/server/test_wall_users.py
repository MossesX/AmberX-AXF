"""Signed-in hub users in the console (server/wall.py + main.py): default-deny for users, grants from hub permissions.

Run: python3 apps/console-web/server/test_wall_users.py   (CI runs it next to test_alerts.py)
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

TOKEN = "t" * 32
_tmp = tempfile.TemporaryDirectory()
os.environ["AXF_STATE"] = str(Path(_tmp.name) / "state.json")
os.environ.setdefault("AXF_DATA_DIR", "off")
os.environ["AXF_TOKEN"] = TOKEN
os.environ["AXF_TRUST_WALL"] = "1"
SECRET = "s" * 40
os.environ["AXF_WALL_SECRET"] = SECRET
os.environ["AXF_WALL_HUB"] = "https://hub.example.test"

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import wall  # noqa: E402

c = TestClient(main.app, raise_server_exceptions=False)
HOST = "testserver"
checks = 0


def ok(cond: bool, what: str) -> None:
    global checks
    if not cond:
        raise AssertionError(what)
    checks += 1
    print(f"  ✓ {what}")


def sign(name: str, role: str, perms: str, host: str = HOST, ts: int | None = None) -> str:
    """What axHub's /auth/verify sends (decision #80): v1.<ts>.<hmac> over v1|ts|user|role|perms|host."""
    import hashlib, hmac, time  # noqa: E401, PLC0415
    t = int(ts if ts is not None else time.time())
    return f"v1.{t}." + hmac.new(SECRET.encode(), f"v1|{t}|{name}|{role}|{perms}|{host}".encode(), hashlib.sha256).hexdigest()


def user(name: str = "conrad", perms: str = "", role: str = "user", via: str = "session", signed: bool = True) -> dict[str, str]:
    h = {"x-auth-user": name, "x-auth-role": role, "x-auth-perms": perms, "x-auth-via": via}
    if signed:
        h["x-auth-sig"] = sign(name, role, perms)
    return h


def same(h: dict[str, str]) -> dict[str, str]:
    return {**h, "origin": f"http://{HOST}"}


plugins = sorted(main.PLUGINS)
# Plugins are picked from what's loaded (never by name, so removing any plugin keeps this test working).
def plugin_routes(folder: str) -> list:
    mod = sys.modules.get(f"axf_console_plugins.{folder.replace('-', '_')}")
    return list(getattr(getattr(mod, "router", None), "routes", []) or [])


def get_routes(folder: str) -> list[str]:
    """Parameter-free GET routes of a loaded plugin, as full paths."""
    return sorted(f"/api/plugins/{folder}{r.path}" for r in plugin_routes(folder)
                  if "GET" in (getattr(r, "methods", None) or set()) and "{" not in getattr(r, "path", "{"))


grantable = sorted(f for f in main.USER_GRANTABLE_PLUGINS if get_routes(f))
granted_plugin = grantable[0] if grantable else (sorted(main.USER_GRANTABLE_PLUGINS) or plugins)[0]
wall_user_plugins = sorted(main.WALL_USER_PLUGINS)

print("who is calling")
me = c.get("/api/me", headers=user()).json()
ok(me["user"]["name"] == "conrad" and me["admin"] is False and me["role"] == "user" and me["themes"] is False, "a hub user is a plain user: themes locked")
ok(set(me["plugins"]) == set(wall_user_plugins), "a new user gets only the plugins open to every user")
me = c.get("/api/me", headers=user(perms=f"console.themes,console.plugin.{granted_plugin}")).json()
ok(me["role"] == "themes" and me["themes"] is True and granted_plugin in me["plugins"], "console.themes + a plugin grant show up")
me = c.get("/api/me", headers=user("brett", role="admin")).json()
ok(me["admin"] is True and me["role"] == "admin" and set(me["plugins"]) == set(plugins), "a hub admin has everything")
ok(c.get("/api/me", headers=user(name="BAD NAME")).status_code == 403, "malformed wall headers are refused, never anonymous")
ok(c.get("/api/terminal", headers=user(name="a")).status_code == 403, "an unparseable session can't reach routes without their own check")
ok(c.get("/api/terminal", headers=user(signed=False)).status_code == 403, "an unsigned session is refused, never anonymous")
ok(c.get("/api/terminal", headers={**user(), "x-auth-sig": sign("conrad", "admin", "*")}).status_code == 403, "a signature for other values is refused")
ok(c.get("/api/me", headers={**user(signed=False), "authorization": f"Bearer {TOKEN}"}).json()["admin"] is True, "with the console token an unsigned session still works (hub secret not set yet)")
os.environ["AXF_TRUST_WALL"] = ""
ok(c.get("/api/me", headers=user()).json()["user"] is None, "without AXF_TRUST_WALL the wall's headers mean nothing")
os.environ["AXF_TRUST_WALL"] = "1"
ok(c.get("/api/me", headers={"authorization": f"Bearer {TOKEN}"}).json()["admin"] is True, "the console token is admin")

print("what a user may reach")
ok(c.get("/", headers=user()).status_code == 200, "the page itself")
for p in ("/api/catalog", "/api/plugins", "/api/plan", "/api/pending"):
    ok(c.get(p, headers=user()).status_code != 403, f"read {p}")
for m, p in (("GET", "/api/terminal"), ("GET", "/api/events"), ("GET", "/api/alerts"), ("POST", "/api/token/reset"),
             ("GET", "/api/plugin-services"), ("GET", "/api/plugin-lifecycle"), ("POST", "/api/options"),
             ("GET", "/api/standards/projects"), ("POST", "/api/ws-ticket"), ("GET", "/mcp"), ("POST", "/api/pending"),
             ("GET", "/api/project"), ("GET", "/api/servers")):
    ok(c.request(m, p, headers=same(user())).status_code == 403, f"{m} {p} is admins only")
ok(c.get("/api/terminal", headers=user(perms="*.*,console.*")).status_code == 403, "no permission opens admin-only routes")
for p in ("/data/projects.json", "/data/status.json", "/DATA/projects.json", "/panel", "/panel/"):
    ok(c.get(p, headers=user()).status_code == 403, f"{p} is admins only")
ok("root" not in c.get("/api/health", headers=user()).json(), "health shows no host path to users")
ok("root" in c.get("/api/health", headers={"authorization": f"Bearer {TOKEN}"}).json(), "admins still see it")

print("plugins")
listed = {i["folder"]: i["enabled"] for i in c.get("/api/plugins", headers=user()).json()["items"]}
ok(not any(on for f, on in listed.items() if f not in wall_user_plugins), "plugins not granted are off for the user")
r = c.get(f"/api/plugins/{granted_plugin}/x", headers=user())
ok(r.status_code == 403, "a plugin's routes are refused without its grant")
real = (get_routes(granted_plugin) or [f"/api/plugins/{granted_plugin}/x"])[0]
r = c.get(real, headers=user(perms=f"console.plugin.{granted_plugin}"))
ok(r.status_code == 200 and "json" in r.headers.get("content-type", ""), f"granted: {granted_plugin}'s routes open ({r.status_code})")
ok(c.get(real, headers=user()).status_code == 403, "the same real route without the grant is refused")
ok(c.get(real, headers=user(perms="console.plugin.*")).status_code == 403, "wildcards never open a plugin")
ok(c.get(real, headers=user(perms="console.*")).status_code == 403, "console.* doesn't either")
risky = next(f for f in plugins if f not in main.USER_GRANTABLE_PLUGINS and f not in main.WALL_USER_PLUGINS and get_routes(f))
ok(c.get(f"/api/plugins/{risky}/x", headers=user(perms=f"console.plugin.{risky}")).status_code == 403, f"{risky} stays admin-only even when granted")
ok(risky not in c.get("/api/me", headers=user(perms=f"console.plugin.{risky}")).json()["plugins"], "and isn't listed as usable")
listed = {i["folder"]: i["enabled"] for i in c.get("/api/plugins", headers=user(perms=f"console.plugin.{granted_plugin}")).json()["items"]}
ok(listed.get(granted_plugin) == main.plugin_enabled(granted_plugin), "a granted plugin shows as on (when it's on)")
r = c.post(f"/api/plugins/{granted_plugin}/enabled", json={"enabled": False}, headers=same(user(perms=f"console.plugin.{granted_plugin}")))
ok(r.status_code in (401, 403), "a user can't switch a plugin on or off, even a granted one")
other = next((f for f in plugins if f != granted_plugin and f not in wall_user_plugins), None)
if other:
    ok(c.get(f"/api/plugins/{other}/x", headers=user(perms=f"console.plugin.{granted_plugin}")).status_code == 403, "one grant opens only that plugin")
r = c.post(f"/api/plugins/{granted_plugin}/x", headers={**user(perms=f"console.plugin.{granted_plugin}"), "origin": "https://evil.example"})
ok(r.status_code == 403, "cross-site writes from a signed-in browser are refused")
ok(c.get(f"/api/plugins/{granted_plugin}/x", headers=user(perms=f"console.plugin.{granted_plugin}", via="token")).status_code in (401, 403),
   "a request the hub let through on a bearer header still needs the real token")

print("websockets")
from starlette.websockets import WebSocketDisconnect  # noqa: E402
ws_paths = ["/api/shell"] + [f"/api/plugins/{f}{r.path}" for f in plugins for r in plugin_routes(f) if type(r).__name__ == "APIWebSocketRoute" and "{" not in r.path][:3]
for path in ws_paths:
    refused = False
    try:
        with c.websocket_connect(path, headers=user(perms="console.plugin." + path.split("/")[3] if path.startswith("/api/plugins/") else "")) as w:
            w.receive_text()
    except Exception:  # noqa: BLE001 — closed or refused, either way not open
        refused = True
    ok(refused, f"{path}: no WebSocket for hub users")

print("roles for the access policy")
ok(wall.ui_role(wall.Caller("a", "admin")) == "admin", "admin role")
ok(wall.ui_role(wall.Caller("u", "user", frozenset({"console.themes"}))) == "themes", "themes role")
ok(wall.ui_role(wall.Caller("u", "user", frozenset({"console.plugin.x"}))) == "user", "user role")
ok(wall.user_may(wall.Caller("u", "user", frozenset({"console.plugin.*"})), "GET", "/api/plugins/../token/reset") is False, "a dotted plugin path is no grant, even with console.plugin.*")
ok(wall.user_may(wall.Caller("u", "user", frozenset({"console.plugin.*"})), "GET", "/api/plugins/x%2f..%2ftoken") is False, "an encoded plugin path is no grant")

print(f"all {checks} checks passed")
