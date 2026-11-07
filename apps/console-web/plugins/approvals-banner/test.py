"""Approvals banner relay: a tap in the console reaches the hub with Brett's own session and the answer comes back in
place; the console token, a session without the cookie, another origin and a bad id are refused before the hub hears.

    python apps/console-web/plugins/approvals-banner/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "server"))
DATA = tempfile.mkdtemp()
os.environ["AXF_APPROVALS_BANNER_DATA_DIR"] = DATA
os.environ["AXF_WALL_HUB"] = "https://hub.example.test"

import httpx  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

spec = importlib.util.spec_from_file_location("approvals_banner_server", HERE / "server" / "__init__.py")
srv = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(srv)

checks = 0


def ok(v: object, what: str) -> None:
    global checks
    assert v, what
    checks += 1


ID = "0123abcd-0123-4abc-8def-0123456789ab"
seen: list[httpx.Request] = []


def hub(req: httpx.Request) -> httpx.Response:
    """The hub's rule: the session cookie, its CSRF value, its own Origin."""
    seen.append(req)
    if req.headers.get("cookie") != "axhub_session=good":
        return httpx.Response(401, json={"signedIn": False})
    if req.url.path == "/auth/api/session":
        return httpx.Response(200, json={"csrf": "c" * 12})
    if req.headers.get("origin") != "https://hub.example.test" or req.headers.get("x-axhub-csrf") != "c" * 12:
        return httpx.Response(403, json={"error": {"code": "denied", "message": "Only from the hub's own pages."}})
    if ID not in req.url.path:
        return httpx.Response(404, json={"error": {"code": "not_found", "message": "No such request."}})
    if req.url.path.endswith("/deny"):
        return httpx.Response(409, json={"state": "ran", "error": {"code": "too_late", "message": "Too late, it ran."}})
    return httpx.Response(200, json={"ok": True, "state": "approved-now", "message": "Done."})


real_client = httpx.Client


class HubClient:
    """httpx.Client bound to the fake hub, whatever the route passes."""

    def __new__(cls, **kw):  # noqa: ANN003
        return real_client(transport=httpx.MockTransport(hub), **kw)


srv.httpx.Client = HubClient

admin = srv.wall.Caller("brett", "admin", frozenset(), "session")
user = srv.wall.Caller("sam", "user", frozenset(), "session")
who: list = [admin]
srv.wall.wall_caller = lambda headers: who[0]

app = FastAPI()
app.include_router(srv.router)
c = TestClient(app, base_url="https://console.example.test", raise_server_exceptions=True)
ORIGIN = {"origin": "https://console.example.test"}
GOOD = {"axhub_session": "good", "other": "keep-me-out"}


def tap(body: dict, cookies: dict | None = GOOD, headers: dict | None = None):
    c.cookies.clear()
    for k, v in (cookies or {}).items():
        c.cookies.set(k, v)
    return c.post("/decide", json=body, headers=ORIGIN if headers is None else headers)


# ---- Brett's own tap reaches the hub and the answer comes back
r = tap({"id": ID, "action": "approve", "rev": 3}).json()
ok(r["ok"] is True and r["state"] == "approved-now" and r["message"] == "Done.", f"approve relayed {r}")
post = seen[-1]
ok(post.method == "POST" and post.url.path == f"/auth/api/approvals/{ID}", "plain approve uses the hub's decide route")
ok(json.loads(post.content) == {"rev": 3, "action": "approve"}, "action + rev in the body")
ok(post.headers["origin"] == "https://hub.example.test", "the hub's Origin")
ok(post.headers["cookie"] == "axhub_session=good", "only the hub session cookie goes on")

r = tap({"id": ID, "action": "approve-now"}).json()
ok(r["ok"] and seen[-1].url.path.endswith(f"{ID}/approve-now"), "a held call uses its veto route")
r = tap({"id": ID, "action": "shelve"}).json()
ok(r["ok"] and seen[-1].url.path.endswith("/shelve"), "shelve too")

# ---- the hub's refusal comes back in place
r = tap({"id": ID, "action": "deny"}).json()
ok(r["ok"] is False and r["code"] == "too_late" and r["message"] == "Too late, it ran." and r["state"] == "ran", f"refusal in place {r}")

# ---- a dead session says so, nothing is decided
n = len(seen)
r = tap({"id": ID, "action": "approve"}, {"axhub_session": "stale"}).json()
ok(r["ok"] is False and r["code"] == "no_session", f"stale session {r}")
ok(len(seen) == n + 1 and seen[-1].url.path == "/auth/api/session", "no decision sent on a dead session")

# ---- no cookie at all: the hub never hears about it
n = len(seen)
r = tap({"id": ID, "action": "approve"}, None).json()
ok(r["ok"] is False and r["code"] == "no_session" and len(seen) == n, "no cookie, no call")

# ---- the console token (every Claude session) is refused, cookie or not
who[0] = None
n = len(seen)
ok(tap({"id": ID, "action": "approve"}).status_code == 403, "console token refused")
ok(c.get("/relay").json()["relay"] is False, "the probe says no relay for the token")
who[0] = user
ok(tap({"id": ID, "action": "approve"}).status_code == 403, "a hub user who isn't an admin refused")
who[0] = admin
ok(len(seen) == n, "none of those reached the hub")

# ---- only from the console's own pages, only JSON, only real ids and actions
ok(tap({"id": ID, "action": "approve"}, headers={"origin": "https://evil.example.test"}).status_code == 403, "another origin refused")
ok(tap({"id": ID, "action": "approve"}, headers={}).status_code == 403, "no origin refused")
ok(tap({"id": "../../admin", "action": "approve"}).status_code == 400, "a path in the id refused")
ok(tap({"id": ID, "action": "revoke"}).status_code == 400, "only the decisions a tap can make")
ok(c.post("/decide", content="id=x", headers={**ORIGIN, "content-type": "application/x-www-form-urlencoded"}).status_code == 415, "a form post refused")
ok(len(seen) == n, "none of those reached the hub either")

# ---- the probe, the hub address, the log
c.cookies.clear()
ok(c.get("/relay").json()["relay"] is False, "no cookie, no relay")
c.cookies.set("axhub_session", "good")
ok(c.get("/relay").json()["relay"] is True, "signed-in admin browser: relay")
os.environ["AXF_WALL_HUB"] = "http://hub.example.test"
ok(srv.hub_base() == "", "plain http is never trusted with the cookie")
ok(tap({"id": ID, "action": "approve"}).status_code == 503, "no https hub, no relay")
os.environ["AXF_WALL_HUB"] = "https://hub.example.test"

log = (Path(DATA) / "relay.jsonl").read_text()
ok("good" not in log and "axhub_session" not in log, "the session never reaches the log")
ok('"by": "brett"' in log and '"action": "approve-now"' in log, "who and what are logged")


def down(req: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("down", request=req)


hub_real = hub
srv.httpx.Client = lambda **kw: real_client(transport=httpx.MockTransport(down), **kw)
r = tap({"id": ID, "action": "approve"}).json()
ok(r["ok"] is False and r["code"] == "unreachable" and "Nothing was decided" in r["message"], f"hub down {r}")

print(f"approvals-banner relay ok ({checks} checks)")
