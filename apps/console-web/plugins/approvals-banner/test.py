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


# The console image must ship what the relay imports: a missing httpx left /decide unmounted and every Approve tap
# answered 405 Method Not Allowed (Nov 9 2026, after mcp 2.3 moved to httpx2).
_reqs = (HERE.parents[1] / "server" / "requirements.txt").read_text()
ok(any(line.split("#")[0].strip().startswith("httpx>") for line in _reqs.splitlines()), "console requirements list httpx")

ID = "0123abcd-0123-4abc-8def-0123456789ab"
EXPIRED = "0123abcd-0123-4abc-8def-0000000000e0"
DECIDED = "0123abcd-0123-4abc-8def-0000000000d0"
seen: list[httpx.Request] = []
# The owner account the console signs in with (AXF_HUB_RELAY_USER / _PASSWORD) and the sessions the hub takes now.
hub_state = {"sessions": {"good"}, "signins": 0, "first": False, "busy": False}


def hub(req: httpx.Request) -> httpx.Response:
    """The hub's rule: the session cookie, its CSRF value, its own Origin."""
    seen.append(req)
    if req.url.path == "/auth/login":
        hub_state["signins"] += 1
        form = dict(x.split("=", 1) for x in req.content.decode().split("&"))
        if req.headers.get("origin") != "https://hub.example.test":
            return httpx.Response(403, text="Sign in from the hub's own page")
        if hub_state["busy"]:
            return httpx.Response(303, headers={"location": "/auth/login?rd=%2F&err=busy"})
        if form.get("username") != "console-relay" or form.get("password") != "s3cret":
            return httpx.Response(303, headers={"location": "/auth/login?rd=%2F&err=wrong"})
        tok = f"owner{hub_state['signins']}"
        hub_state["sessions"].add(tok)
        loc = "/auth/first?rd=%2F" if hub_state["first"] else "/"
        return httpx.Response(303, headers=[("location", loc), ("set-cookie", f"axhub_session={tok}; Path=/; Domain=.example.test; HttpOnly; Secure")])
    if (req.headers.get("cookie") or "").removeprefix("axhub_session=") not in hub_state["sessions"]:
        return httpx.Response(401, json={"signedIn": False})
    if req.url.path == "/auth/api/session":
        return httpx.Response(200, json={"csrf": "c" * 12})
    if req.headers.get("origin") != "https://hub.example.test" or req.headers.get("x-axhub-csrf") != "c" * 12:
        return httpx.Response(403, json={"error": {"code": "denied", "message": "Only from the hub's own pages."}})
    if EXPIRED in req.url.path:
        return httpx.Response(409, json={"error": {"code": "expired", "message": "That request expired."}})
    if DECIDED in req.url.path:
        return httpx.Response(409, json={"error": {"code": "decided", "message": "That request was already decided."}})
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
ok(r["ok"] is False and r["code"] == "no_credential" and len(seen) == n, "no cookie, no owner sign-in: no call")
ok("AXF_HUB_RELAY_USER" in r["message"] and "Nothing was decided" in r["message"], f"the exact reason {r}")

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
pr = c.get("/relay").json()
ok(pr["relay"] is False and "AXF_HUB_RELAY_USER" in pr["reason"], f"no cookie, no relay, and why {pr}")
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

# ==== the console's own owner sign-in (Brett, Nov 7 2026: the browser's hub cookie never reached the console)
srv.httpx.Client = HubClient
os.environ["AXF_HUB_RELAY_USER"] = "console-relay"
os.environ["AXF_HUB_RELAY_PASSWORD"] = "s3cret"
c.cookies.clear()
pr = c.get("/relay").json()
ok(pr["relay"] is True and pr["via"] == "owner", f"no browser cookie, owner sign-in set: relay {pr}")

# approve, deny on the owner session; one sign-in serves both
n0 = hub_state["signins"]
r = tap({"id": ID, "action": "approve", "rev": 1}, None).json()
ok(r["ok"] is True and r["via"] == "owner" and r["state"] == "approved-now", f"owner approve {r}")
login = next(q for q in seen if q.url.path == "/auth/login")
ok(login.headers["origin"] == "https://hub.example.test", "the sign-in posts the hub's own Origin")
dec = seen[-1]
ok(dec.headers["cookie"].startswith("axhub_session=owner") and dec.headers["x-axhub-csrf"] == "c" * 12, "decided with the owner session + its CSRF")
r = tap({"id": ID, "action": "approve-now"}, None).json()
ok(r["ok"] is True and seen[-1].url.path.endswith("/approve-now"), "owner approve-now")
r = tap({"id": ID, "action": "decline"}, None).json()
ok(r["ok"] is True and json.loads(seen[-1].content)["action"] == "decline", "owner deny on an approval = decline")
r = tap({"id": ID, "action": "deny"}, None).json()
ok(r["ok"] is False and r["code"] == "too_late" and r["message"] == "Too late, it ran.", f"owner deny refused in place {r}")
ok(hub_state["signins"] == n0 + 1, "one sign-in, kept in memory")

# expired + already decided: the hub's words, in place
r = tap({"id": EXPIRED, "action": "approve"}, None).json()
ok(r["ok"] is False and r["code"] == "expired" and r["message"] == "That request expired.", f"expired {r}")
r = tap({"id": DECIDED, "action": "decline"}, None).json()
ok(r["ok"] is False and r["code"] == "decided" and "already decided" in r["message"], f"already decided {r}")

# the hub dropped the owner session: signed in again once, then decided
hub_state["sessions"] = {"good"}
r = tap({"id": ID, "action": "approve"}, None).json()
ok(r["ok"] is True and hub_state["signins"] == n0 + 2, f"re-signed in after the hub dropped the session {r}")

# a browser cookie the hub no longer takes falls back to the owner sign-in
r = tap({"id": ID, "action": "approve"}, {"axhub_session": "stale"}).json()
ok(r["ok"] is True and r["via"] == "owner", f"stale browser cookie → owner {r}")
# a good browser cookie is still used first (the hub then names him)
r = tap({"id": ID, "action": "approve"}).json()
ok(r["ok"] is True and r["via"] == "browser" and seen[-1].headers["cookie"] == "axhub_session=good", "browser session first")

# wrong password / must pick a new one / busy: exact reason, nothing decided
srv.OWNER.cookie = ""
os.environ["AXF_HUB_RELAY_PASSWORD"] = "wrong"
n = len(seen)
r = tap({"id": ID, "action": "approve"}, None).json()
ok(r["ok"] is False and r["code"] == "owner_refused" and "AXF_HUB_RELAY_PASSWORD" in r["message"], f"wrong owner password {r}")
ok(all(q.url.path == "/auth/login" for q in seen[n:]), "no decision sent without a session")
os.environ["AXF_HUB_RELAY_PASSWORD"] = "s3cret"
hub_state["first"] = True
r = tap({"id": ID, "action": "approve"}, None).json()
ok(r["ok"] is False and r["code"] == "owner_password", f"owner must pick a new password {r}")
hub_state["first"] = False
hub_state["busy"] = True
r = tap({"id": ID, "action": "approve"}, None).json()
ok(r["ok"] is False and r["code"] == "owner_busy", f"hub slowing sign-ins {r}")
hub_state["busy"] = False

# still never the console token, a hub user, or an admin outside AXF_HUB_RELAY_OWNERS
n = len(seen)
who[0] = None
ok(tap({"id": ID, "action": "approve"}, None).status_code == 403, "console token refused with the owner sign-in set")
ok(c.get("/relay").json()["relay"] is False, "token probe: no relay")
who[0] = user
ok(tap({"id": ID, "action": "approve"}, None).status_code == 403, "a hub user refused with the owner sign-in set")
who[0] = admin
os.environ["AXF_HUB_RELAY_OWNERS"] = "someone-else"
r = tap({"id": ID, "action": "approve"}, None).json()
ok(r["ok"] is False and r["code"] == "no_credential" and "approval owners" in r["message"], f"not an owner {r}")
ok(len(seen) == n, "none of those reached the hub")
os.environ["AXF_HUB_RELAY_OWNERS"] = "Brett, other"
ok(tap({"id": ID, "action": "approve"}, None).json()["ok"] is True, "a named owner may")
del os.environ["AXF_HUB_RELAY_OWNERS"]

# relay down: the hub can't be reached at all
srv.OWNER.cookie = ""
srv.httpx.Client = lambda **kw: real_client(transport=httpx.MockTransport(down), **kw)
r = tap({"id": ID, "action": "approve"}, None).json()
ok(r["ok"] is False and r["code"] == "unreachable" and "Nothing was decided" in r["message"], f"owner path, hub down {r}")

log = (Path(DATA) / "relay.jsonl").read_text()
ok("s3cret" not in log and "owner1" not in log, "neither the password nor the owner session reaches the log")
ok('"via": "owner"' in log, "owner decisions are logged as such")
h = srv.health_probe()
ok(h["status"] == "ok", f"health green with the owner sign-in {h}")
del os.environ["AXF_HUB_RELAY_USER"]
ok(srv.health_probe()["status"] == "warn", "health amber without it")

print(f"approvals-banner relay ok ({checks} checks)")
