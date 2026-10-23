"""Self-test for the {{APP_NAME}} server (python3 server/test_server.py). Needs fastapi + httpx (TestClient).

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
os.environ.update({"APP_TOKEN": "tok-123", "APP_TRUST_WALL": "1", "APP_WALL_SECRET": SECRET, "APP_DIST": str(DIST), "APP_THEMES_PERM": "demo.themes"})

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

print(f"server self-test: {passed} checks passed")
