"""CORS for the amberxai.com apps (server/cors.py + main.py): Molly's preflight and token calls to /api.

Run: python3 apps/console-web/server/test_cors.py   (CI runs it next to test_wall_users.py)
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

TOKEN = "c" * 32
_tmp = tempfile.TemporaryDirectory()
os.environ["AXF_STATE"] = str(Path(_tmp.name) / "state.json")
os.environ.setdefault("AXF_DATA_DIR", "off")
os.environ["AXF_TOKEN"] = TOKEN
os.environ["AXF_TRUST_WALL"] = "1"
os.environ["AXF_WALL_SECRET"] = "w" * 40
os.environ["AXF_CORS_ORIGINS"] = "https://staging.example.test, *, javascript:alert(1), https://staging.example.test/"

from fastapi.testclient import TestClient  # noqa: E402

import cors  # noqa: E402
import main  # noqa: E402

c = TestClient(main.app, raise_server_exceptions=False)
checks = 0
MOLLY = "https://molly.amberxai.com"


def ok(cond: bool, what: str) -> None:
    global checks
    if not cond:
        raise AssertionError(what)
    checks += 1
    print(f"  ✓ {what}")


def preflight(origin: str, headers: str = "authorization, content-type, accept", via: str = "") -> object:
    h = {"origin": origin, "access-control-request-method": "GET", "access-control-request-headers": headers}
    if via:
        h["x-auth-via"] = via
    return c.options("/api/me", headers=h)


print("origins")
for o in (MOLLY, "https://axhub.amberxai.com", "https://console.amberxai.com", "https://amberxai.com", "http://localhost:5173", "http://127.0.0.1", "https://localhost"):
    ok(cors.allowed(o), f"allowed: {o}")
for o in ("https://evil.example", "https://amberxai.com.evil.example", "https://molly.amberxai.com.evil.example", "http://molly.amberxai.com",
          "https://evilamberxai.com", "https://localhost.evil.example", "null", ""):
    ok(not cors.allowed(o), f"refused: {o or '(empty)'}")
ok(cors.extra_origins() == ["https://staging.example.test"], "AXF_CORS_ORIGINS: exact origins only, '*' and junk dropped, de-duplicated")
ok(cors.allowed("https://staging.example.test"), "an AXF_CORS_ORIGINS origin is allowed")

print("preflight (the wall lets OPTIONS through; the middleware answers before any token check)")
r = preflight(MOLLY)
ok(r.status_code == 200, f"Molly's preflight answers 200 (got {r.status_code})")
ok(r.headers.get("access-control-allow-origin") == MOLLY, "allow-origin is Molly's origin, not *")
allow = {h.strip() for h in r.headers.get("access-control-allow-headers", "").lower().split(",")}
ok({"authorization", "content-type", "accept"} <= allow, "allow-headers: authorization, content-type, accept")
ok("access-control-allow-credentials" not in r.headers, "cookies never allowed cross-origin")
r = preflight(MOLLY, via="token")
ok(r.status_code == 200, "a preflight with a stray X-Auth-Via: token still answers (no 401 before CORS)")
r = preflight("https://evil.example")
ok(r.status_code == 400 and "access-control-allow-origin" not in r.headers, "a foreign origin's preflight is refused")
r = preflight(MOLLY, headers="authorization, x-something-else")
ok(r.status_code == 400, "a header outside the list is refused")

print("the real call")
r = c.get("/api/me", headers={"origin": MOLLY, "authorization": f"Bearer {TOKEN}"})
ok(r.status_code == 200 and r.headers.get("access-control-allow-origin") == MOLLY, "token call from Molly: 200 with CORS headers")
r = c.get("/api/me", headers={"origin": MOLLY, "authorization": "Bearer wrong", "x-auth-via": "token"})
ok(r.status_code == 401, "wrong token behind the wall: 401")
ok(r.headers.get("access-control-allow-origin") == MOLLY, "the gate's 401 still carries CORS headers (Molly reads 'signed out', not 'unreachable')")
r = c.get("/api/me", headers={"origin": "https://evil.example", "authorization": f"Bearer {TOKEN}"})
ok("access-control-allow-origin" not in r.headers, "a foreign origin gets no CORS headers")

print(f"\ncors: {checks} checks passed")
