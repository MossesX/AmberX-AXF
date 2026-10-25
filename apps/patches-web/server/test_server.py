"""Self-test for the Patches server (python3 server/test_server.py). Needs fastapi + httpx (TestClient).

Covers the wall rules this template ships with: the app token, axHub's signature (secret, age, host), admin vs user,
malformed sessions, bearer-via-hub, cross-site writes, and the static web app with its path guard.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
DIST = Path(tempfile.mkdtemp())
(DIST / "index.html").write_text("<!doctype html><div id=root></div>")
(DIST / "app.js").write_text("console.log(1)")
SECRET = "s" * 40
os.environ.update({"APP_DATA_DIR": tempfile.mkdtemp(), "APP_TOKEN": "tok-123", "APP_TRUST_WALL": "1", "APP_WALL_SECRET": SECRET, "APP_DIST": str(DIST), "APP_THEMES_PERM": "demo.themes"})

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import wall  # noqa: E402

c = TestClient(main.app)
HOST = "testserver"
passed = 0


def check(cond: bool, what: str) -> None:
    global passed
    if not cond:
        raise SystemExit(f"FAIL: {what}")
    passed += 1


def session(user: str, role: str, perms: str = "", ts: int | None = None, host: str = HOST, secret: str = SECRET) -> dict[str, str]:
    ts = int(time.time()) if ts is None else ts
    sig = hmac.new(secret.encode(), f"v1|{ts}|{user}|{role}|{perms}|{host}".encode(), hashlib.sha256).hexdigest()
    return {"x-auth-via": "session", "x-auth-user": user, "x-auth-role": role, "x-auth-perms": perms, "x-auth-sig": f"v1.{ts}.{sig}"}


TOKEN = {"authorization": "Bearer tok-123"}

# token
check(c.get("/api/health").status_code == 200, "health is open")
check(c.get("/api/hello").status_code == 401, "no token, no session: 401")
check(c.get("/api/hello", headers={"authorization": "Bearer nope"}).status_code == 401, "wrong token: 401")
check(c.get("/api/hello", headers=TOKEN).json()["message"].startswith("Hello app-token"), "token works")

# signed-in admin
r = c.get("/api/hello", headers=session("brett", "admin"))
check(r.status_code == 200 and "brett" in r.json()["message"], "signed admin works")
me = c.get("/api/me", headers=session("brett", "admin")).json()
check(me["wall"] and me["user"]["name"] == "brett" and me["role"] == "admin", "me: admin")

# signature: wrong secret, too old, other host, tampered role → refused (403, never anonymous)
check(c.get("/api/hello", headers=session("brett", "admin", secret="x" * 40)).status_code == 403, "wrong secret refused")
check(c.get("/api/hello", headers=session("brett", "admin", ts=int(time.time()) - 600)).status_code == 403, "stale signature refused")
check(c.get("/api/hello", headers=session("brett", "admin", host="evil.example")).status_code == 403, "other host refused")
h = session("conrad", "user"); h["x-auth-role"] = "admin"
check(c.get("/api/hello", headers=h).status_code == 403, "tampered role refused")
h = session("Bad Name", "admin")
check(c.get("/api/hello", headers=h).status_code == 403, "bad user name refused")
check(c.get("/api/hello", headers={**session("brett", "admin", secret="x" * 40), **TOKEN}).status_code == 200, "bad session + real token still works")

# signed-in user: default-deny beyond health/me; role from the themes permission
check(c.get("/api/hello", headers=session("conrad", "user")).status_code == 403, "user: hello is admin-only")
check(c.get("/api/me", headers=session("conrad", "user")).json()["role"] == "user", "me: user")
check(c.get("/api/me", headers=session("conrad", "user", "demo.themes")).json()["role"] == "themes", "me: themes")
check(c.get("/api/me", headers=session("conrad", "user", "demo.*")).json()["role"] == "themes", "me: themes by wildcard")
check(c.post("/api/me", headers=session("conrad", "user")).status_code == 403, "user: no writes")

# bearer let through by the hub must be the real token
check(c.get("/api/hello", headers={"x-auth-via": "token", "authorization": "Bearer nope"}).status_code == 401, "bearer via hub: wrong token 401")
check(c.get("/api/hello", headers={"x-auth-via": "token", **TOKEN}).status_code == 200, "bearer via hub: real token ok")

# cross-site writes from a signed-in browser are refused
check(c.post("/api/hello", headers={**session("brett", "admin"), "origin": "https://other.example"}).status_code == 403, "cross-site write refused")
check(c.post("/api/hello", headers={**session("brett", "admin"), "origin": "http://testserver"}).status_code == 405, "same-origin write reaches routing")

# wall off: headers ignored entirely
os.environ["APP_TRUST_WALL"] = "0"
check(c.get("/api/hello", headers=session("brett", "admin")).status_code == 401, "wall off: session headers ignored")
check(c.get("/api/me").json() == {"wall": False, "hub": main.HUB, "user": None, "role": None}, "wall off: me says so")
os.environ["APP_TRUST_WALL"] = "1"
os.environ["APP_WALL_SECRET"] = "short"
check(not wall.trusted(), "short secret: wall not trusted")
os.environ["APP_WALL_SECRET"] = SECRET

# web app + path guard
check("id=root" in c.get("/").text, "index served")
check(c.get("/app.js").text == "console.log(1)", "static file served")
check("id=root" in c.get("/some/view").text, "SPA fallback")
check("id=root" in c.get("/../server/main.py").text, "no escape from dist")
check(c.get("/api/nope", headers=TOKEN).status_code == 404, "unknown api route 404, not index")

# plugins Patches manages for the apps in its tabs
r = c.get("/api/plugins", headers=TOKEN).json()
check(r["$axf"] == "patches-plugins@1" and r["apps"]["console"]["plugins"] == {}, "plugins: empty to start")
check(c.get("/api/plugins").status_code == 401, "plugins: needs a caller")
check(c.get("/api/plugins", headers=session("conrad", "user")).status_code == 403, "plugins: users can't read")
rep = [{"id": "ai.amberx.axf.example.alpha", "name": " Activity\n", "version": "0.1.0", "on": True}, {"id": "ai.amberx.axf.example.beta", "name": "Terminal", "on": False}, {"id": "bad id!", "name": "x"}, "nope"]
r = c.post("/api/plugins/install", headers=TOKEN, json={"app": "console", "plugins": rep}).json()
mine = r["apps"]["console"]["plugins"]
check(r["added"] == ["ai.amberx.axf.example.alpha", "ai.amberx.axf.example.beta"], "install: valid ids added")
check(mine["ai.amberx.axf.example.alpha"]["enabled"] and not mine["ai.amberx.axf.example.beta"]["enabled"], "install: starts as the app had it")
check(mine["ai.amberx.axf.example.alpha"]["name"] == "Activity", "install: name cleaned")
check(oct((main.PLUGINS_FILE.stat().st_mode) & 0o777) == "0o600", "store is 0600")
c.post("/api/plugins/enabled", headers=TOKEN, json={"app": "console", "id": "ai.amberx.axf.example.beta", "enabled": True})
r = c.post("/api/plugins/install", headers=TOKEN, json={"app": "console", "plugins": [{"id": "ai.amberx.axf.example.beta", "on": False}]}).json()
check(r["added"] == [] and r["apps"]["console"]["plugins"]["ai.amberx.axf.example.beta"]["enabled"], "install again keeps the switch")
check(c.post("/api/plugins/install", headers=TOKEN, json={"app": "other", "plugins": []}).status_code == 400, "install: unknown app refused")
check(c.post("/api/plugins/install", headers=TOKEN, json={"app": "console", "plugins": "x"}).status_code == 400, "install: bad list refused")
check(c.post("/api/plugins/enabled", headers=TOKEN, json={"app": "console", "id": "nope", "enabled": True}).status_code == 404, "switch: not installed 404")
check(c.post("/api/plugins/install", headers={**session("brett", "admin"), "origin": "https://other.example"}, json={"app": "console", "plugins": []}).status_code == 403, "install: cross-site refused")
check(c.post("/api/plugins/install", headers={**session("brett", "admin"), "origin": "http://testserver"}, json={"app": "pilot", "plugins": [{"id": "pilot.x", "on": True}]}).status_code == 200, "install: signed-in admin, same origin")
r = c.post("/api/plugins/remove", headers=TOKEN, json={"app": "console", "id": "ai.amberx.axf.example.alpha"}).json()
check("ai.amberx.axf.example.alpha" not in r["apps"]["console"]["plugins"], "remove")
main.PLUGINS_FILE.write_text("{broken")
check(c.get("/api/plugins", headers=TOKEN).json()["apps"]["console"]["plugins"] == {}, "damaged store reads as empty")

# Patches' tab group (patches-tabs@1): the apps by default; plugin tabs for tabable plugins
r = c.get("/api/tabs", headers=TOKEN).json()
check(r["$axf"] == "patches-tabs@1" and [t["app"] for t in r["tabs"]] == ["console", "pilot", "axhub"], "tabs: the three apps to start")
check(c.get("/api/tabs").status_code == 401, "tabs: needs a caller")
check(c.get("/api/tabs", headers=session("conrad", "user")).status_code == 403, "tabs: users can't read")
todo = {"kind": "plugin", "app": "console", "plugin": "ai.amberx.axf.example.todos", "view": "todos", "label": " Todos\n", "icon": "list"}
r = c.put("/api/tabs", headers=TOKEN, json={"tabs": [{"kind": "app", "app": "console"}, todo, {"kind": "app", "app": "axhub"}]}).json()
check([t.get("view", t["app"]) for t in r["tabs"]] == ["console", "todos", "axhub"] and r["tabs"][1]["label"] == "Todos", "tabs: saved in order, label cleaned")
check(c.get("/api/tabs", headers=TOKEN).json() == r, "tabs: read back")
check(c.put("/api/tabs", headers=TOKEN, json={"tabs": [todo, todo]}).status_code == 400, "tabs: a tab twice refused")
check(c.put("/api/tabs", headers=TOKEN, json={"tabs": [{**todo, "view": "bad view"}]}).status_code == 400, "tabs: bad view refused")
check(c.put("/api/tabs", headers=TOKEN, json={"tabs": [{"kind": "app", "app": "elsewhere"}]}).status_code == 400, "tabs: unknown app refused")
check(c.put("/api/tabs", headers=TOKEN, json={"tabs": "x"}).status_code == 400, "tabs: not a list refused")
check(c.put("/api/tabs", headers={**session("brett", "admin"), "origin": "https://other.example"}, json={"tabs": []}).status_code == 403, "tabs: cross-site refused")
r = c.put("/api/tabs", headers=TOKEN, json={"tabs": [{**todo, "icon": "Bad Icon"}]}).json()
check("icon" not in r["tabs"][0], "tabs: bad icon dropped")
check(oct(main.TABS_FILE.stat().st_mode & 0o777) == "0o600", "tabs: file 0600")
main.TABS_FILE.write_text("{broken")
check([t["app"] for t in c.get("/api/tabs", headers=TOKEN).json()["tabs"]] == ["console", "pilot", "axhub"], "tabs: damaged file reads as the defaults")

# Plugins per app (patches-app-plugins@1): a fake Dev Console on loopback answers the console adapter
import http.server  # noqa: E402
import json as _json  # noqa: E402
import threading as _threading  # noqa: E402

import app_plugins  # noqa: E402

FAKE = {"installed": {"alpha": "ai.amberx.axf.console.alpha"}, "calls": [], "fail": set()}
CATALOG = {"alpha": "ai.amberx.axf.console.alpha", "beta": "ai.amberx.axf.console.beta"}
HUBP = {"installed": {}, "catalog": {"hub-hi": "ai.amberx.axhub.hub-hi"}}


class FakeConsole(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_a):  # quiet
        pass

    def _send(self, code, body):
        raw = _json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _auth(self):
        if self.headers.get("authorization") != "Bearer console-tok":
            self._send(401, {"detail": "unauthorized"})
            return False
        return True

    def do_GET(self):
        if not self._auth():
            return
        if self.path == "/api/plugins":
            items = [{"folder": f, "id": i, "name": f.title(), "version": "0.1.0", "enabled": True, "builtWith": {"model": "opus"}} for f, i in FAKE["installed"].items()]
            items.append({"folder": "gone", "id": "ai.amberx.axf.console.gone", "name": "Gone", "version": "1", "removed": True})
            return self._send(200, {"items": items})
        if self.path == "/api/app-plugins/axhub":
            return self._send(200, {"kind": "axhub", "items": [{"folder": f, "id": i, "name": "Hub hi", "version": "0.1.0", "builtWith": {"model": "opus"}} for f, i in HUBP["installed"].items()]})
        if self.path == "/api/plugin-catalog?kind=axhub":
            return self._send(200, {"items": [{"kind": "axhub", "folder": f, "id": i, "name": "Hub hi", "version": "0.1.0"} for f, i in HUBP["catalog"].items()]})
        if self.path.startswith("/api/plugin-catalog"):
            return self._send(200, {"items": [{"kind": "console", "folder": f, "id": i, "name": f.title(), "version": "0.2.0", "builtWith": {"model": "fable"}} for f, i in CATALOG.items()]})
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("location", "https://elsewhere.example/")
            self.end_headers()
            return
        self._send(404, {"detail": "no"})

    def do_POST(self):
        if not self._auth():
            return
        body = _json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
        FAKE["calls"].append((self.path, body))
        if self.path == "/api/plugin-catalog/install":
            f = body.get("folder")
            if f in FAKE["fail"] or body.get("confirm") != f:
                return self._send(400, {"detail": f"cannot install {f}"})
            FAKE["installed"][f] = CATALOG[f]
            return self._send(200, {"ok": True, "note": "Committed to GitHub"})
        if self.path.startswith("/api/app-plugins/axhub/"):
            f = body.get("folder")
            if body.get("confirm") != f or f not in HUBP["catalog"]:
                return self._send(400, {"detail": "bad axhub change"})
            if self.path.endswith("/install"):
                HUBP["installed"][f] = HUBP["catalog"][f]
            else:
                HUBP["installed"].pop(f, None)
            return self._send(200, {"note": "Committed to GitHub: the app rebuilds"})
        if self.path.endswith("/uninstall"):
            f = self.path.split("/")[3]
            if body.get("confirm") != f or not body.get("code") or not body.get("publish"):
                return self._send(400, {"detail": "confirm + code + publish needed"})
            FAKE["installed"].pop(f, None)
            return self._send(200, {"code": True, "published": {"pushed": True}})
        self._send(404, {"detail": "no"})


PIL = {"installed": {"pil-extra": {"id": "ai.amberx.pilot.extra", "name": "Extra", "version": "1.0.0"}}, "bundled": {"look": "ai.amberx.pilot.look"},
       "catalog": {"pil-extra": "ai.amberx.pilot.extra", "pil-new": "ai.amberx.pilot.new"}, "calls": [], "state": {}}


class FakePilot(FakeConsole):
    def _auth(self):
        if self.headers.get("authorization") != "Bearer pilot-tok":
            self._send(401, {"detail": "unauthorized"})
            return False
        return True

    def do_GET(self):
        if not self._auth():
            return
        if self.path == "/api/plugin-catalog":
            return self._send(200, {"items": [{"kind": "pilot", "folder": f, "id": i, "name": f, "version": "1.0.0"} for f, i in PIL["catalog"].items()],
                                    "installed": PIL["installed"], "bundled": PIL["bundled"], "reachable": True, "error": ""})
        if self.path == "/api/plugin-state":
            return self._send(200, {"enabled": PIL["state"]})
        self._send(404, {"detail": "no"})

    def do_POST(self):
        if not self._auth():
            return
        body = _json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
        PIL["calls"].append((self.path, body))
        if self.path.startswith("/api/plugin-state/"):
            PIL["state"][self.path.rsplit("/", 1)[1]] = bool(body.get("enabled"))
            return self._send(200, {"enabled": PIL["state"]})
        f = body.get("folder")
        if body.get("confirm") != f:
            return self._send(400, {"detail": "confirm"})
        if self.path == "/api/plugin-catalog/install":
            PIL["installed"][f] = {"id": PIL["catalog"][f], "name": f, "version": "1.0.0"}
            return self._send(200, {"installed": f, "rebuild": True})
        if self.path == "/api/plugin-catalog/uninstall":
            PIL["installed"].pop(f, None)
            return self._send(200, {"removed": f, "rebuild": True})
        self._send(404, {"detail": "no"})


psrv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakePilot)
_threading.Thread(target=psrv.serve_forever, daemon=True).start()
os.environ["APP_PILOT_URL"] = f"http://127.0.0.1:{psrv.server_address[1]}"
os.environ.pop("APP_PILOT_TOKEN", None)

srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeConsole)
_threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}"

check(app_plugins.safe_base("https://console.amberxai.com") == "https://console.amberxai.com", "base: https ok")
check(app_plugins.safe_base("http://console.amberxai.com") == "", "base: plain http refused off loopback")
check(app_plugins.safe_base("https://u:p@console.amberxai.com") == "" and app_plugins.safe_base("https://x.example/path") == "", "base: no credentials or path")
check(app_plugins.safe_base(BASE) == BASE, "base: loopback http ok")
try:
    app_plugins.call(BASE, "console-tok", "GET", "/redirect")
    check(False, "redirect refused")
except app_plugins.AppError as e:
    check("redirect" in str(e), "call: a redirect is refused, token never follows")

main.TABS_FILE.unlink()
main.PLUGINS_FILE.write_text(_json.dumps({"apps": {"pilot": {"plugins": {"pilot.x": {"name": "Pilot X", "enabled": True}}}}}))
os.environ.pop("APP_CONSOLE_TOKEN", None)
os.environ["APP_CONSOLE_URL"] = BASE
g = c.get("/api/app-plugins", headers=TOKEN).json()
check([a["app"] for a in g["apps"]] == ["console", "pilot", "axhub"], "grid: one column per app in the tabs, in order")
check(not g["apps"][0]["reachable"] and "APP_CONSOLE_TOKEN" in g["apps"][0]["reason"], "grid: no console token says why")
check(c.get("/api/app-plugins").status_code == 401 and c.get("/api/app-plugins", headers=session("conrad", "user")).status_code == 403, "grid: callers + users refused")

os.environ["APP_CONSOLE_TOKEN"] = "console-tok"
g = c.get("/api/app-plugins", headers=TOKEN).json()
rows = {r["id"]: r for r in g["plugins"]}
A, B = "ai.amberx.axf.console.alpha", "ai.amberx.axf.console.beta"
check({A, B, "pilot.x", "ai.amberx.axhub.hub-hi"} <= set(rows), "grid: rows = Patches' list + installed + catalog, removed plugins left out")
check(rows[A]["cells"]["console"] == {"installed": True, "canChange": True, "why": ""}, "grid: installed + changeable")
check(rows[B]["cells"]["console"]["installed"] is False and rows[B]["cells"]["console"]["canChange"], "grid: in the catalog = installable")
check(rows["pilot.x"]["cells"]["console"]["canChange"] is False and "catalog" in rows["pilot.x"]["cells"]["console"]["why"], "grid: not in the catalog = locked")
check(rows[A]["cells"]["pilot"]["installed"] is None and "APP_PILOT_TOKEN" in rows[A]["cells"]["pilot"]["why"], "grid: no Pilot token = Pilot column read-only, says why")
check(rows["ai.amberx.axhub.hub-hi"]["cells"]["axhub"] == {"installed": False, "canChange": True, "why": ""}, "grid: axHub column installable through the console")
check(rows[A]["cells"]["axhub"]["canChange"] is False and "catalog" in rows[A]["cells"]["axhub"]["why"], "grid: a console plugin isn't an axHub plugin")
check(rows[A]["model"] == "opus" and "_snaps" not in g, "grid: model kept, internals not sent")

check(c.post("/api/app-plugins/apply", headers=TOKEN, json={"changes": [{"app": "console", "id": B, "install": True}]}).status_code == 400, "apply: needs confirm")
check(c.post("/api/app-plugins/apply", headers=TOKEN, json={"confirm": "apply", "changes": [{"app": "pilot", "id": A, "install": True}]}).status_code == 400, "apply: a locked cell is refused")
check(c.post("/api/app-plugins/apply", headers=TOKEN, json={"confirm": "apply", "changes": [{"app": "console", "id": "nope", "install": True}]}).status_code == 400, "apply: unknown plugin refused")
check(c.post("/api/app-plugins/apply", headers={**session("brett", "admin"), "origin": "https://other.example"}, json={"confirm": "apply", "changes": []}).status_code == 403, "apply: cross-site refused")
r = c.post("/api/app-plugins/apply", headers=TOKEN, json={"confirm": "apply", "changes": [{"app": "console", "id": A, "install": True}]}).json()
check("nothing to change" in r.get("note", ""), "apply: a box that already matches changes nothing")

r = c.post("/api/app-plugins/apply", headers=TOKEN, json={"confirm": "apply", "changes": [{"app": "console", "id": B, "install": True}, {"app": "console", "id": A, "install": False}]})
check(r.status_code == 200 and r.json()["job"]["state"] == "running", "apply: starts in the background")
j = app_plugins.wait()
check(j["state"] == "done" and [x["state"] for x in j["items"]] == ["done", "done"], "apply: both changes done")
check(set(FAKE["installed"]) == {"beta"}, "apply: beta installed, alpha uninstalled in the Console")
check(("/api/plugin-lifecycle/alpha/uninstall", {"confirm": "alpha", "code": True, "publish": True}) in FAKE["calls"], "apply: uninstall removes the code and publishes")
lst = c.get("/api/plugins", headers=TOKEN).json()["apps"]["console"]["plugins"]
check(B in lst and A not in lst, "apply: Patches' own list follows")
check(c.get("/api/app-plugins/apply", headers=TOKEN).json()["job"]["state"] == "done", "apply: progress readable")

FAKE["fail"].add("alpha")
c.post("/api/app-plugins/apply", headers=TOKEN, json={"confirm": "apply", "changes": [{"app": "console", "id": A, "install": True}, {"app": "console", "id": B, "install": False}]})
j = app_plugins.wait()
check(j["state"] == "partial" and j["items"][0]["state"] == "failed" and "cannot install" in j["items"][0]["note"] and j["items"][1]["state"] == "done", "apply: a failure is noted, the rest still run")

FAKE["fail"].discard("alpha")

# Pilot: real adapter with its token; bundled plugins are locked
os.environ["APP_PILOT_TOKEN"] = "pilot-tok"
g = c.get("/api/app-plugins", headers=TOKEN).json()
rows = {r["id"]: r for r in g["plugins"]}
pcol = next(a for a in g["apps"] if a["app"] == "pilot")
check(pcol["reachable"] and pcol["canInstall"], "pilot: reachable and installable with its token")
check(rows["ai.amberx.pilot.extra"]["cells"]["pilot"] == {"installed": True, "canChange": True, "why": ""}, "pilot: catalog-installed plugin can be removed")
lk = rows["ai.amberx.pilot.look"]["cells"]["pilot"]
check(lk["installed"] is True and lk["canChange"] and lk.get("switch") and "bundled" in lk["why"], "pilot: bundled plugin = an on/off switch, says so")
check(rows["ai.amberx.pilot.new"]["cells"]["pilot"]["installed"] is False and rows["ai.amberx.pilot.new"]["cells"]["pilot"]["canChange"], "pilot: catalog plugin installable")
c.post("/api/app-plugins/apply", headers=TOKEN, json={"confirm": "apply", "changes": [{"app": "pilot", "id": "ai.amberx.pilot.look", "install": False}]})
j = app_plugins.wait()
check(j["state"] == "done" and j["items"][0]["switch"] and PIL["state"] == {"ai.amberx.pilot.look": False} and "look" in PIL["bundled"], "pilot: unticking a bundled plugin switches it off, never uninstalls it")
lk = {r["id"]: r for r in c.get("/api/app-plugins", headers=TOKEN).json()["plugins"]}["ai.amberx.pilot.look"]["cells"]["pilot"]
check(lk["installed"] is False and lk["canChange"] and lk.get("switch"), "pilot: switched-off bundled plugin shows unticked, still changeable")
c.post("/api/app-plugins/apply", headers=TOKEN, json={"confirm": "apply", "changes": [{"app": "pilot", "id": "ai.amberx.pilot.look", "install": True}]})
check(app_plugins.wait()["state"] == "done" and PIL["state"] == {"ai.amberx.pilot.look": True}, "pilot: ticking it switches it back on")
c.post("/api/app-plugins/apply", headers=TOKEN, json={"confirm": "apply", "changes": [
    {"app": "pilot", "id": "ai.amberx.pilot.new", "install": True}, {"app": "pilot", "id": "ai.amberx.pilot.extra", "install": False},
    {"app": "axhub", "id": "ai.amberx.axhub.hub-hi", "install": True}]})
j = app_plugins.wait()
check(j["state"] == "done", "apply: pilot + axhub changes done")
check(set(PIL["installed"]) == {"pil-new"} and ("/api/plugin-catalog/install", {"folder": "pil-new", "confirm": "pil-new"}) in PIL["calls"], "pilot: installed + uninstalled through Pilot's routes")
check(HUBP["installed"] == {"hub-hi": "ai.amberx.axhub.hub-hi"} and "rebuilds" in j["items"][2]["note"], "axhub: installed through the console, its note kept")
g = c.get("/api/app-plugins", headers=TOKEN).json()
rows = {r["id"]: r for r in g["plugins"]}
check(rows["ai.amberx.axhub.hub-hi"]["cells"]["axhub"]["installed"] is True, "axhub: grid shows it installed")
c.post("/api/app-plugins/apply", headers=TOKEN, json={"confirm": "apply", "changes": [{"app": "axhub", "id": "ai.amberx.axhub.hub-hi", "install": False}]})
check(app_plugins.wait()["state"] == "done" and not HUBP["installed"], "axhub: uninstalled through the console")
check(not any("pilot-tok" in str(v) for v in c.get("/api/app-plugins", headers=TOKEN).json().values()), "pilot: token never in the grid")

print(f"server self-test: {passed} checks passed")
