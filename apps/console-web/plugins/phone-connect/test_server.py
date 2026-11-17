"""Server part of the Phone Connect self-test (run by test.py, which supplies check / ok / E / FX / TMP)."""
# ruff: noqa: F821 — check, ok, E, FX, TMP come from test.py
import importlib.util
import sys
import types
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import wall

HERE = Path(__file__).resolve().parent
_pkg = types.ModuleType("axf_console_plugins")
_pkg.__path__ = []
sys.modules.setdefault("axf_console_plugins", _pkg)
_spec = importlib.util.spec_from_file_location("axf_console_plugins.phone_connect", HERE / "server/__init__.py", submodule_search_locations=[str(HERE / "server")])
pc = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = pc
_spec.loader.exec_module(pc)
svc = sys.modules["axf_console_plugins.phone_connect.service"]
S = sys.modules["axf_console_plugins.phone_connect.store"]

BRETT = wall.Caller("brett", "admin", frozenset({"*"}), "session")
HOST = "console.test"
app = FastAPI()


@app.middleware("http")
async def who(request: Request, call_next):
    """Stands in for main.py's auth: `x-test-person: 1` = the wall's admin browser, else the console token."""
    request.state.axf_user = BRETT if request.headers.get("x-test-person") == "1" else wall.TOKEN_CALLER
    return await call_next(request)


app.include_router(pc.router, prefix="/api/plugins/phone-connect")
app.include_router(pc.device_router, prefix="/api/plugins/phone-connect/device")
cl = TestClient(app, base_url=f"https://{HOST}")
P = "/api/plugins/phone-connect"
PERSON = {"x-test-person": "1", "origin": f"https://{HOST}"}
SESSION = {"x-axf-session": "axf-build-test", "x-axf-via": "mcp"}
DEV = {"deviceId": "phone-0123456789abcdef", "name": "samsung SM-S938B", "app": "phone-connect-droid", "appVersion": "1.0.0",
       "platform": "android", "capabilities": ["open-url@1", "notify@1", "approvals@1", "recorder@1", "voice@1"]}

# ---- s7 pairing routes

r = cl.post(f"{P}/pair/start", headers=SESSION).json()
ok("a session may issue a code", r["ok"] and E.is_code(r["pairing"]["code"]) and r["pairing"]["issuedBy"]["kind"] == "session")
code1 = r["pairing"]["code"]
r2 = cl.post(f"{P}/pair/start", headers=SESSION).json()
check("issuing again cancels the old code", S.pairing(code1)["state"], "cancelled")
code = r2["pairing"]["code"]
check("GET pair shows the pending code", cl.get(f"{P}/pair").json()["pairing"]["code"], code)

r = cl.post(f"{P}/pair/confirm", json={"code": code, "device": DEV, "person": {"kind": "person", "who": "brett"}}, headers=SESSION)
check("the console token cannot claim, even naming a person in the body", (r.status_code, r.json()["error"]["code"]), (403, "denied"))
check("a refused claim leaves the code pending", S.pairing(code)["state"], "pending")
r = cl.post(f"{P}/pair/confirm", json={"code": "AAAAAAAA", "device": DEV}, headers=PERSON)
check("wrong code", r.json()["error"]["code"], "denied")
r = cl.post(f"{P}/pair/confirm", json={"code": code, "device": DEV}, headers={"x-test-person": "1", "origin": "https://evil.test"})
check("a person from another origin is not a person", r.json()["error"]["code"], "denied")
r = cl.post(f"{P}/pair/confirm", json={"code": code, "device": DEV}, headers=PERSON)
j = r.json()
ok("Brett's own sign-in claims and gets the token once", r.status_code == 200 and E.is_token(j["token"]) and j["device"]["state"] == "paired")
TOKEN = j["token"]
ok("the token is never stored", TOKEN not in (Path(TMP) / "plugins/phone-connect/devices/phone-0123456789abcdef.json").read_text())
ok("the device view never shows the hash", "hash" not in (j["device"]["token"] or {}))
check("claimed code is spent", cl.post(f"{P}/pair/confirm", json={"code": code, "device": DEV}, headers=PERSON).json()["error"]["code"], "denied")
devs = cl.get(f"{P}/devices").json()["devices"]
check("GET devices lists the phone", [d["deviceId"] for d in devs], ["phone-0123456789abcdef"])
check("GET devices/{id}", cl.get(f"{P}/devices/phone-0123456789abcdef").json()["device"]["presence"], "online")
check("unknown device", cl.get(f"{P}/devices/phone-ffffffffffffffff").status_code, 404)
r = cl.delete(f"{P}/devices/phone-0123456789abcdef", headers=SESSION)
check("a session cannot revoke", (r.status_code, r.json()["error"]["code"]), (403, "denied"))
r = cl.post(f"{P}/devices/phone-0123456789abcdef/settings", json={"watch": {"on": True}}, headers=SESSION)
check("a session cannot change a phone's settings", r.status_code, 403)
r = cl.post(f"{P}/devices/phone-0123456789abcdef/settings", json={"urlPolicy": {"mode": "allowlist", "allowlist": ["github.com"]}}, headers=PERSON)
check("the owner sets the url policy", r.json()["device"]["urlPolicy"], {"mode": "allowlist", "allowlist": ["github.com"]})
_passed = 0
