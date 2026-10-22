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

# the banner plugins' server parts, in the console: Patches passes the allowed routes on with the console token
import json as _json  # noqa: E402
import threading as _threading  # noqa: E402
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer  # noqa: E402

seen: list[dict] = []


class FakeConsole(BaseHTTPRequestHandler):
    def log_message(self, *a):  # noqa: ANN002
        pass

    def _answer(self) -> None:
        n = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(n) if n else b""
        seen.append({"method": self.command, "path": self.path, "auth": self.headers.get("authorization"), "body": body})
        if self.path.startswith("/api/plugins/push-banner/moved"):
            self.send_response(302); self.send_header("Location", "https://evil.example/steal"); self.end_headers(); return
        if self.path.startswith("/api/plugins/build-manager/events"):
            self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
            self.wfile.write(b"data: one\n\ndata: two\n\n"); return
        if self.path.startswith("/api/plugins/activity/off"):
            self.send_response(404); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b'{"detail":"Not Found"}'); return
        out = _json.dumps({"ok": True, "path": self.path, "got": body.decode() or None}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _answer


srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeConsole)
_threading.Thread(target=srv.serve_forever, daemon=True).start()
main.CONSOLE_URL = f"http://127.0.0.1:{srv.server_port}"
os.environ.pop("PATCHES_CONSOLE_TOKEN", None)
check(c.get("/api/console/plugins/activity/items", headers=TOKEN).status_code == 503, "proxy: no console token = 503, says so")
os.environ["PATCHES_CONSOLE_TOKEN"] = "console-secret"
r = c.get("/api/console/plugins/activity/items?since=5&x=a%20b", headers=TOKEN)
check(r.status_code == 200 and r.json()["path"] == "/api/plugins/activity/items?since=5&x=a+b", "proxy: plugin route + query passed on")
check(seen[-1]["auth"] == "Bearer console-secret", "proxy: console token added server-side")
check("console-secret" not in r.text, "proxy: token never in the answer")
r = c.post("/api/console/plugins/push-banner/merge-all", headers=TOKEN, json={"confirm": "merge-all"})
check(r.status_code == 200 and _json.loads(r.json()["got"]) == {"confirm": "merge-all"}, "proxy: POST body passed on")
check(c.put("/api/console/plugins/claude-handoff/config", headers=TOKEN, json={}).status_code == 200, "proxy: PUT")
check(c.delete("/api/console/plugins/activity/item?id=x", headers=TOKEN).status_code == 200, "proxy: DELETE")
check(c.get("/api/console/pending", headers=TOKEN).status_code == 200, "proxy: console pending list (read)")
check(c.post("/api/console/build-queue/steps", headers=TOKEN, json={"id": "x", "index": 0, "done": True}).status_code == 200, "proxy: build-queue step tick")
n = len(seen)
for bad in ["plugins/console-terminal/sessions", "plugins/ai-assistant/chat", "plugins/activity", "token/reset", "secrets", "mcp", "plugins/activity/../../token/reset", "plugins/activity/%2e%2e/x", "plugins//activity/x"]:
    check(c.get(f"/api/console/{bad}", headers=TOKEN).status_code == 404, f"proxy: refuses {bad}")
check(c.delete("/api/console/pending", headers=TOKEN).status_code == 404, "proxy: only the listed methods on console routes")
check(c.post("/api/console/plan", headers=TOKEN, json={}).status_code == 404, "proxy: plan is read-only")
check(len(seen) == n, "proxy: refused routes never reach the console")
check(c.get("/api/console/plugins/activity/items").status_code == 401, "proxy: needs a caller")
check(c.get("/api/console/plugins/activity/items", headers=session("conrad", "user")).status_code == 403, "proxy: hub users refused")
check(c.get("/api/console/plugins/activity/items", headers=session("brett", "admin")).status_code == 200, "proxy: signed-in hub admin")
check(c.post("/api/console/plugins/activity/report", headers={**session("brett", "admin"), "origin": "https://other.example"}, json={}).status_code == 403, "proxy: cross-site write refused")
check(c.get("/api/console/plugins/push-banner/moved", headers=TOKEN).status_code == 502, "proxy: a redirect is never followed")
check(not any(x["path"].startswith("/steal") for x in seen), "proxy: nothing went to the redirect target")
check(c.get("/api/console/plugins/activity/off", headers=TOKEN).status_code == 404, "proxy: the console's 404 (plugin off) passed on")
check(c.post("/api/console/plugins/activity/report", headers=TOKEN, content=b"x" * (main.MAX_PROXY_BODY + 1)).status_code == 413, "proxy: body cap")
r = c.get("/api/console/plugins/build-manager/events", headers=TOKEN)
check(r.headers["content-type"].startswith("text/event-stream") and "data: two" in r.text, "proxy: event stream passed on")
main.CONSOLE_URL = "http://127.0.0.1:9"
check(c.get("/api/console/plugins/activity/items", headers=TOKEN).status_code == 502, "proxy: console down = 502")
srv.shutdown()
r = c.post("/api/plugins/install", headers=TOKEN, json={"app": "patches", "plugins": [{"id": "ai.amberx.axf.console.activity", "name": "Activity", "on": True}]}).json()
check(r["apps"]["patches"]["plugins"]["ai.amberx.axf.console.activity"]["enabled"], "Patches' own banner plugins install under app patches")

print(f"server self-test: {passed} checks passed")
