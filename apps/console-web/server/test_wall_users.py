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


def user(name: str = "conrad", perms: str = "", role: str = "user", via: str = "session") -> dict[str, str]:
    return {"x-auth-user": name, "x-auth-role": role, "x-auth-perms": perms, "x-auth-via": via}


def same(h: dict[str, str]) -> dict[str, str]:
    return {**h, "origin": f"http://{HOST}"}


plugins = sorted(main.PLUGINS)
granted_plugin = "theme-manager" if "theme-manager" in plugins else plugins[0]
wall_user_plugins = sorted(main.WALL_USER_PLUGINS)

print("who is calling")
me = c.get("/api/me", headers=user()).json()
ok(me["user"]["name"] == "conrad" and me["admin"] is False and me["role"] == "user" and me["themes"] is False, "a hub user is a plain user: themes locked")
ok(set(me["plugins"]) == set(wall_user_plugins), "a new user gets only the plugins open to every user")
me = c.get("/api/me", headers=user(perms=f"console.themes,console.plugin.{granted_plugin}")).json()
ok(me["role"] == "themes" and me["themes"] is True and granted_plugin in me["plugins"], "console.themes + a plugin grant show up")
me = c.get("/api/me", headers=user("brett", role="admin")).json()
ok(me["admin"] is True and me["role"] == "admin" and set(me["plugins"]) == set(plugins), "a hub admin has everything")
ok(c.get("/api/me", headers=user(name="BAD NAME")).json()["user"] is None, "malformed wall headers are ignored")
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

print("plugins")
listed = {i["folder"]: i["enabled"] for i in c.get("/api/plugins", headers=user()).json()["items"]}
ok(not any(on for f, on in listed.items() if f not in wall_user_plugins), "plugins not granted are off for the user")
r = c.get(f"/api/plugins/{granted_plugin}/x", headers=user())
ok(r.status_code == 403, "a plugin's routes are refused without its grant")
real = "/api/plugins/theme-manager/themes" if granted_plugin == "theme-manager" else f"/api/plugins/{granted_plugin}/x"
r = c.get(real, headers=user(perms=f"console.plugin.{granted_plugin}"))
ok(r.status_code == 200 and "json" in r.headers.get("content-type", ""), f"granted: {granted_plugin}'s routes open ({r.status_code})")
ok(c.get(real, headers=user()).status_code == 403, "the same real route without the grant is refused")
r = c.get(real, headers=user(perms="console.plugin.*"))
ok(r.status_code not in (401, 403), "console.plugin.* grants every plugin")
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

print("roles for the access policy")
ok(wall.ui_role(wall.Caller("a", "admin")) == "admin", "admin role")
ok(wall.ui_role(wall.Caller("u", "user", frozenset({"console.themes"}))) == "themes", "themes role")
ok(wall.ui_role(wall.Caller("u", "user", frozenset({"console.plugin.x"}))) == "user", "user role")
ok(wall.user_may(wall.Caller("u", "user", frozenset({"console.plugin.*"})), "GET", "/api/plugins/../token/reset") is False, "a dotted plugin path is no grant, even with console.plugin.*")
ok(wall.user_may(wall.Caller("u", "user", frozenset({"console.plugin.*"})), "GET", "/api/plugins/x%2f..%2ftoken") is False, "an encoded plugin path is no grant")

print(f"all {checks} checks passed")
