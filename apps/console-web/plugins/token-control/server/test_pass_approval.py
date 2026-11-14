"""pass-approval@1 REST routes (docs/contracts/pass-approval.md) on the Token control plugin mount and the /api/passes
aliases: pending, get, owner approve / deny, POST pass/action with a signed token, the pass:<id> focus resolver.

    cd apps/console-web/server && python3 ../plugins/token-control/server/test_pass_approval.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER = HERE.parents[2] / "server"
sys.path.insert(0, str(SERVER))
os.environ["AXF_CONTROL_DATA_DIR"] = tempfile.mkdtemp(prefix="axf-pass-approval-")
os.environ["AXF_THREADS_FILE"] = ""
os.environ["AXF_PASS_SECRET"] = "test-pass-secret"
os.environ["AXF_NO_TTY_APPROVAL"] = "1"
os.environ.pop("AXF_CONSOLE_URL", None)

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import plugin_services  # noqa: E402

spec = importlib.util.spec_from_file_location("tc_server", HERE / "__init__.py", submodule_search_locations=[str(HERE)])
assert spec and spec.loader
tc = importlib.util.module_from_spec(spec)
sys.modules["tc_server"] = tc
spec.loader.exec_module(tc)

checks = 0


def eq(a, b, what):  # type: ignore[no-untyped-def]
    global checks
    checks += 1
    assert a == b, f"{what}: {a!r} != {b!r}"


def ok(cond, what):  # type: ignore[no-untyped-def]
    eq(bool(cond), True, what)


class Owner:  # Brett's signed-in console session as main.py's auth sets it
    via = "session"
    admin = True
    name = "brett"


class Agent:  # a bearer-token caller (an agent, a script): never an owner approval
    via = "token"
    admin = True
    name = "amber"


who = {"user": Agent()}
os.environ["AXF_TOKEN"] = "configured"  # a console with a token: no local-approval shortcut
app = FastAPI()


@app.middleware("http")
async def as_user(request: Request, call_next):  # type: ignore[no-untyped-def]
    request.state.axf_user = who["user"]
    return await call_next(request)


app.include_router(tc.router, prefix="/api/plugins/token-control")
svc = plugin_services.get("pass-approval@1")
ok(svc is not None, "token-control provides pass-approval@1")
app.include_router(svc.public_router, prefix="/api/passes")
app.include_router(svc.router, prefix="/api/passes")
c = TestClient(app)
M = "/api/plugins/token-control"


def grant(minutes: int = 20) -> str:
    who["user"] = Agent()
    r = c.post(f"{M}/pass/grant", json={"minutes": minutes, "reason": "test"})
    eq(r.status_code, 202, "an agent's grant is a request")
    return r.json()["item"]["id"]


pid = grant()
r = c.get("/api/passes/pending").json()
eq([x["id"] for x in r["items"]], [pid], "GET /api/passes/pending lists it")
item = r["items"][0]
eq(item["deep_link"], f"https://console.amberxai.com/#/pass/{pid}", "deep_link")
eq(item["approve_url"], f"https://console.amberxai.com/#/pass/{pid}/approve", "approve_url")
ok("token" not in json.dumps(r).replace("tokens.", ""), "no token in any read")

r = c.get(f"/api/passes/{pid}")
eq((r.status_code, r.json()["pass"]["state"]), (200, "pending"), "GET /api/passes/<id>")
eq(c.get("/api/passes/pass-zzzzzz-000000").status_code, 404, "unknown pass → 404")

r = c.post(f"/api/passes/{pid}/approve")
eq((r.status_code, r.json()["code"]), (403, "owner_required"), "a bearer token can't approve")
eq(c.get(f"/api/passes/{pid}").json()["pass"]["state"], "pending", "still pending")

who["user"] = Owner()
r = c.post(f"/api/passes/{pid}/approve")
eq((r.status_code, r.json()["pass"]["state"], r.json()["pass"]["approvedVia"]), (200, "active", "console"), "Brett's session approves")
r = c.post(f"/api/passes/{pid}/approve").json()
eq((r["ok"], r["already"]), (True, True), "approving again is idempotent")
eq(c.post(f"{M}/pass/{pid}/deny").status_code, 409, "deny after approve: decided")
eq(c.post(f"{M}/pass/{pid}/maybe").status_code, 400, "only approve or deny")

# signed token: minted for a device delivery, decides without a session, once
pid = grant()
toks = svc.push_tokens(pid)
ok(toks and toks["approve"].startswith("pa1.") and toks["deny"].startswith("pa1."), "push tokens minted")
who["user"] = Agent()
c2 = TestClient(app)
r = c2.post("/api/passes/action", json={"token": toks["deny"]})
eq((r.status_code, r.json()["decision"], r.json()["pass"]["state"]), (200, "deny", "denied"), "POST /api/passes/action denies")
r = c2.post("/api/passes/action", json={"token": toks["deny"]}).json()
eq((r["ok"], r["already"]), (True, True), "the same token again: already")
r = c2.post("/api/passes/action", json={"token": toks["approve"]})
eq((r.status_code, r.json()["code"]), (409, "decided"), "the other token after a decision: decided")
eq(c2.post("/api/passes/action", json={"token": "nope"}).status_code, 400, "malformed token → 400")
pid2 = grant()
t2 = svc.push_tokens(pid2)
forged = t2["approve"][:-4] + ("0000" if not t2["approve"].endswith("0000") else "1111")
eq(c2.post("/api/passes/action", json={"token": forged}).status_code, 401, "a changed signature → 401")
wrong = t2["approve"].replace(pid2, pid)
eq(c2.post(f"{M}/pass/action", json={"token": wrong}).json()["code"], "decided", "a token re-pointed at a decided pass never decides it")
r = c2.post(f"{M}/pass/action", json={"token": t2["approve"]}).json()
eq((r["ok"], r["pass"]["approvedVia"]), (True, "push"), "the plugin mount's pass/action approves, recorded via push")

# audit: every call left a row
rows = [json.loads(x) for x in (Path(os.environ["AXF_CONTROL_DATA_DIR"]) / "audit.jsonl").read_text().splitlines()]
pa = [x for x in rows if x.get("op") == "pass-approval"]
ok(any(x.get("result") == "owner_required" for x in pa) and any(x.get("result") == "already" for x in pa) and any(x.get("nonce") and x.get("result") == "ok" for x in pa), "audit rows for refused, replayed and token decisions")

# deep link: pass:<id> → the Token control screen focused on that pass
focus = [p for p in plugin_services.get_all("console-focus@1") if hasattr(p, "SCREEN") and p.SCREEN == "token-control"][0]
eq(focus.resolve(f"pass:{pid}"), {"screen": "token-control", "focus": f"pass:{pid}", "explicit": True}, "pass:<id> resolves")
eq(focus.resolve(pid)["focus"], f"pass:{pid}", "a bare pass id too")
eq(focus.resolve("build:foo"), None, "anything else is not a pass")

subprocess.run(["rm", "-rf", os.environ["AXF_CONTROL_DATA_DIR"]], check=False)
print(f"✓ pass-approval REST — {checks} checks", flush=True)
