"""The hub-pages relay (server/hub_pages.py): who may use it, which paths go through, CSRF, the owner sign-in fallback.

Run: python3 apps/console-web/server/test_hub_pages.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

SECRET = "s" * 40
os.environ["AXF_TRUST_WALL"] = "1"
os.environ["AXF_WALL_SECRET"] = SECRET
os.environ["AXF_WALL_HUB"] = "https://hub.example.test"
for k in ("AXF_HUB_RELAY_USER", "AXF_HUB_RELAY_PASSWORD", "AXF_HUB_RELAY_OWNERS"):
    os.environ.pop(k, None)

import httpx  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import axf_framework  # noqa: E402,F401
import hub_pages  # noqa: E402
import wall  # noqa: E402

checks = 0


def ok(cond: bool, what: str) -> None:
    global checks
    if not cond:
        raise AssertionError(what)
    checks += 1
    print(f"  ✓ {what}")


HUB = "https://hub.example.test"
seen: list[httpx.Request] = []
SESSIONS = {"brett-cookie": "brett", "owner-cookie": "owner"}


def fake_hub(req: httpx.Request) -> httpx.Response:
    seen.append(req)
    cookie = (req.headers.get("cookie") or "").removeprefix("axhub_session=")
    who = SESSIONS.get(cookie)
    path = req.url.path
    if path == "/auth/login" and req.method == "POST":
        return httpx.Response(302, headers={"location": "/", "set-cookie": "axhub_session=owner-cookie; Path=/; HttpOnly"})
    if path == "/auth/api/session":
        if not who:
            return httpx.Response(200, json={"signedIn": False, "hub": HUB, "loginUrl": f"{HUB}/auth/login"})
        return httpx.Response(200, json={"signedIn": True, "hub": HUB, "loginUrl": "", "admin": True, "csrf": f"csrf-{who}", "user": {"username": who}})
    if not who:
        return httpx.Response(401, json={"error": {"code": "signed_out", "message": "Sign in on the hub."}})
    if req.method == "POST":
        if req.headers.get("x-axhub-csrf") != f"csrf-{who}" or req.headers.get("origin") != HUB:
            return httpx.Response(403, json={"error": {"code": "csrf", "message": "bad csrf"}})
        return httpx.Response(200, json={"ok": True, "by": who, "got": json.loads(req.content or b"{}")})
    return httpx.Response(200, json={"items": [], "by": who, "query": str(req.url.query, "ascii") if isinstance(req.url.query, bytes) else str(req.url.query)})


def client_factory() -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(fake_hub), follow_redirects=False)


tmp = tempfile.TemporaryDirectory()
app = FastAPI()
owner = hub_pages.OwnerSession()
app.include_router(hub_pages.router_for(Path(tmp.name), client_factory, owner))
c = TestClient(app, raise_server_exceptions=False, base_url="http://testserver")


def admin_headers(name: str = "brett", role: str = "admin") -> dict[str, str]:
    import time
    from axf_server.wall import sign
    sig = sign(SECRET, name, role, "", "testserver", int(time.time()))
    return {"X-Auth-Via": "session", "X-Auth-User": name, "X-Auth-Role": role, "X-Auth-Perms": "", "X-Auth-Sig": sig}


H = admin_headers()
probe = wall.wall_caller({**{k.lower(): v for k, v in H.items()}, "host": "testserver"})
if probe is None:
    # The wall's header names come from the framework; read them off a signed fixture instead of guessing.
    raise SystemExit("wall headers in this test don't match framework/python/axf_server/wall.py; update admin_headers()")

print("hub-pages relay")
# Who may use it
r = c.get("/api/hub-pages/auth/api/approvals")
ok(r.status_code == 403, "no wall browser (the console token alone) is refused")
r = c.get("/api/hub-pages/auth/api/approvals", headers=admin_headers("u", "user"))
ok(r.status_code == 403, "a wall user who isn't an admin is refused")

# Paths
for bad in ("auth/admin/approvals.json", "mcp", "auth/api/../x", "auth/apix", "data/foo"):
    r = c.get(f"/api/hub-pages/{bad}", headers=H, cookies={"axhub_session": "brett-cookie"})
    ok(r.status_code in (400, 404), f"path {bad!r} doesn't go through")

# Reads with the browser's own session, query passed on
seen.clear()
r = c.get("/api/hub-pages/auth/api/approvals?status=pending", headers=H, cookies={"axhub_session": "brett-cookie"})
ok(r.status_code == 200 and r.json()["by"] == "brett", "a read goes out with the browser's own hub session")
ok("status=pending" in r.json()["query"], "the query string is passed on")
ok(r.headers.get("cache-control") == "no-store", "replies are never cached")
ok(all(str(q.url).startswith(HUB) for q in seen), "only the wall's hub is called")

# Session: CSRF never reaches the page
r = c.get("/api/hub-pages/auth/api/session", headers=H, cookies={"axhub_session": "brett-cookie"})
ok(r.status_code == 200 and r.json()["signedIn"] and "csrf" not in r.json() and r.json()["via"] == "browser", "the session reply drops the CSRF value and says via browser")

# No session, no owner sign-in
r = c.get("/api/hub-pages/auth/api/session", headers=H)
ok(r.status_code == 200 and r.json()["signedIn"] is False and "AXF_HUB_RELAY_USER" in r.json()["reason"], "no session at all: signed out, and it says how to fix it")
r = c.get("/api/hub-pages/auth/api/users", headers=H)
ok(r.status_code == 401 and r.json()["error"]["code"] == "no_credential", "a read without any session is refused with no_credential")

# Writes: same origin, JSON, CSRF from the same session
r = c.post("/api/hub-pages/auth/api/approvals/x", headers={**H, "Origin": "https://evil.test"}, json={"action": "approve"}, cookies={"axhub_session": "brett-cookie"})
ok(r.status_code == 403, "a write from another origin is refused")
r = c.post("/api/hub-pages/auth/api/approvals/x", headers={**H, "Origin": "http://testserver", "Content-Type": "text/plain"}, content=b"{}", cookies={"axhub_session": "brett-cookie"})
ok(r.status_code == 415, "a write that isn't JSON is refused")
r = c.post("/api/hub-pages/auth/api/approvals/x", headers={**H, "Origin": "http://testserver"}, json={"action": "approve"}, cookies={"axhub_session": "brett-cookie"})
ok(r.status_code == 200 and r.json()["by"] == "brett" and r.json()["got"] == {"action": "approve"}, "a write carries the session's CSRF value and the hub's Origin")
log = (Path(tmp.name) / "hub-pages.jsonl").read_text().strip().splitlines()
ok(len(log) == 1 and json.loads(log[0])["path"] == "auth/api/approvals/x" and "cookie" not in log[0], "writes are logged without the cookie")

# Owner sign-in fallback
os.environ["AXF_HUB_RELAY_USER"] = "owner"
os.environ["AXF_HUB_RELAY_PASSWORD"] = "pw"
r = c.get("/api/hub-pages/auth/api/users", headers=H)
ok(r.status_code == 200 and r.json()["by"] == "owner", "without a browser session the owner sign-in reads")
r = c.get("/api/hub-pages/auth/api/users", headers=H, cookies={"axhub_session": "stale"})
ok(r.status_code == 200 and r.json()["by"] == "owner", "a session the hub no longer takes falls back to the owner sign-in")
r = c.get("/api/hub-pages-state", headers=H)
ok(r.json()["relay"] is True and r.json()["via"] == "owner", "the state probe says via owner")
os.environ["AXF_HUB_RELAY_OWNERS"] = "someone-else"
r = c.get("/api/hub-pages/auth/api/users", headers=H)
ok(r.status_code == 401, "AXF_HUB_RELAY_OWNERS narrows who may use the owner sign-in")
for k in ("AXF_HUB_RELAY_USER", "AXF_HUB_RELAY_PASSWORD", "AXF_HUB_RELAY_OWNERS"):
    os.environ.pop(k, None)

print(f"hub-pages: {checks} checks passed")
