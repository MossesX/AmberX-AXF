"""REST, MCP and the provider bridge of the control registry (build full-api-cli-control-of-everything-plus-an-offli, s17).

REST routes (auth, list / get / export / state / invoke / resolve, the regid convertor leaving control@1's own routes
alone), REST = MCP parity (the same control@1 command for the same call), and the axHub bridge against a mock hub for
Hostinger, Coolify and the VPS: reads go with hold false, changes once with hold true and a reason, destructive ones
need the registry's confirm token, nothing polls. No network, no model.

    python3 apps/console-web/server/test_registry_api.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

os.environ["AXF_CLAUDE_AVAILABLE"] = "0"
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import Depends, FastAPI, HTTPException, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import mcp_server  # noqa: E402
import registry_api as ra  # noqa: E402
import registry_providers as rp  # noqa: E402

checks = 0


def ok(v: object, what: str) -> None:
    global checks
    assert v, what
    checks += 1


sent: list[dict] = []
logs: list[tuple] = []


def control(cmd: dict) -> dict:
    sent.append(cmd)
    return {"ok": True, "echo": cmd}


def auth(request: Request) -> None:
    if request.headers.get("authorization") != "Bearer t":
        raise HTTPException(401, "unauthorized")


app = FastAPI()
app.include_router(ra.router(auth, auth, control, lambda *a: logs.append(a)))


@app.get("/api/control/{target}/{path:path}")
def token_control(target: str, path: str) -> dict:  # stands in for control@1's own router mounted after the registry
    return {"tokenControl": target, "path": path}


c = TestClient(app)
H = {"authorization": "Bearer t"}

# ---------------------------------------------------------------- auth and reads
ok(c.get("/api/registry").status_code == 401, "the registry needs the console token")
r = c.get("/api/registry", params={"owner": "vps", "limit": 50}, headers=H).json()
ok(r["ok"] and r["total"] >= 6 and all(i["owner"] == "vps" for i in r["items"]), "list filters by owner")
ok(c.get("/api/registry", params={"type": "nope"}, headers=H).status_code == 422, "a bad type is refused")
g = c.get("/api/registry/hostinger/tool/dns", headers=H).json()
ok(g["entry"]["id"] == "hostinger/tool/dns" and any(a["id"] == "update" for a in g["entry"]["actions"]), "get one entry with its actions")
ok(c.get("/api/registry/nope/page/x", headers=H).status_code == 404, "unknown entry → 404")
ok(c.get("/api/registry/search", params={"q": "dns records"}, headers=H).json()["items"][0]["id"] == "hostinger/tool/dns", "search")
ok(len(c.get("/api/registry/export", headers=H).json()["entries"]) > 1000, "export the whole index")
ok(c.get("/api/control/tokens.layout/navWidth", headers=H).json() == {"tokenControl": "tokens.layout", "path": "navWidth"}, "control@1's own routes are untouched")

# ---------------------------------------------------------------- state, invoke, resolve
s = c.get("/api/control/console-web/display/tokens.layout/state", headers=H).json()
ok(s["ok"] and sent[-1] == {"$axf": "control@1", "op": "list", "target": "tokens.layout", "by": "rest"}, "state reads through control@1")
bad = c.post("/api/control/console-web/display/tokens.layout/set", json={"params": {"path": "navWidth", "value": 99999}}, headers=H)
ok(bad.status_code == 422 and bad.json()["code"] == "validation", "a value outside the range → 422 before anything runs")
n = len(sent)
good = c.post("/api/control/console-web/display/tokens.layout/set", json={"path": "navWidth", "value": 200}, headers=H).json()
ok(good["ok"] and len(sent) == n + 1 and sent[-1]["value"] == 200 and logs[-1][0] == "registry", "invoke runs one control@1 command and is logged")
dry = c.post("/api/control/console-web/page/plan-studio/open", json={"dry": True}, headers=H).json()
ok(dry["ok"] and "result" not in dry and len(sent) == n + 1, "dry plans only")
res = c.post("/api/control/resolve", json={"input": "open plan studio", "run": True}, headers=H).json()
ok(res["entry"] == "console-web/page/plan-studio" and sent[-1]["target"] == "console.screens", "resolve and run a phrase")
nf = c.post("/api/control/resolve", json={"input": "make me a sandwich"}, headers=H)
ok(nf.status_code == 404 and nf.json()["ai"]["fallback"] is False, "nothing matched, gate closed: 404, no model")
ok(c.post("/api/control/resolve", json={}, headers=H).status_code == 422, "resolve needs input")

# ---------------------------------------------------------------- the AI gate on, with a stub model
os.environ["AXF_CLAUDE_AVAILABLE"] = "1"
asked: list[dict] = []
r = ra.resolve("make me a sandwich", control, ask=lambda brief: asked.append(brief) or {"id": "console-web/page/builds", "action": "open"})
ok(asked and r["ok"] and r["entry"] == "console-web/page/builds" and r["how"]["kind"] == "ai", "gate open: the model proposes, the registry resolves it again")
r = ra.resolve("make me a sandwich", control, ask=lambda brief: {"id": "console-web/display/tokens.layout", "action": "set", "params": {"path": "nope"}})
ok(not r["ok"], "a proposal outside the registry is refused")
os.environ["AXF_CLAUDE_AVAILABLE"] = "0"
r = ra.resolve("make me a sandwich", control, ask=lambda brief: asked.append("called") or {"id": "x"})
ok(asked[-1] != "called" and not r["ok"], "gate closed: the model is never asked")

# ---------------------------------------------------------------- REST = MCP (same command)
server = mcp_server.build_server(lambda op, **a: {}, terminal=lambda since: [], control=control)
for tool in mcp_server.REGISTRY_TOOLS:
    ok(tool in {t.name for t in asyncio.run(server.list_tools())}, f"MCP {tool}")
c.post("/api/control/console-web/setting/spacing/set", json={"spacing": "tight"}, headers=H)
rest_cmd = {k: v for k, v in sent[-1].items() if k != "by"}
asyncio.run(server.call_tool("control_invoke", {"id": "console-web/setting/spacing", "action": "set", "params": {"spacing": "tight"}}))
mcp_cmd = {k: v for k, v in sent[-1].items() if k != "by"}
ok(rest_cmd == mcp_cmd and sent[-1]["by"] == "mcp", "REST and MCP send the identical control@1 command")

# ---------------------------------------------------------------- provider bridge against a mock axHub
hub: list[tuple[str, dict]] = []


def mock_hub(method: str, params: dict, sid: str | None) -> tuple[dict, str | None]:
    hub.append((method, params))
    if method == "initialize":
        return {}, "sid-1"
    if method == "tools/list":
        return {"tools": [{"name": "call"}, {"name": "search"}]}, sid
    if params.get("name") == "search":
        return {"content": [{"type": "text", "text": json.dumps({"tools": [{"name": "hostinger.DNS_getDNSRecordsV1"}, {"name": "coolify.deploy"}, {"name": "vps.run"}]})}]}, sid
    a = params["arguments"]
    if a.get("hold"):
        return {"content": [{"type": "text", "text": json.dumps({"held": True, "job_id": "j-1"})}]}, sid
    return {"content": [{"type": "text", "text": json.dumps({"tool": a["tool"], "args": a["arguments"]})}]}, sid


rp.transport = mock_hub
calls = lambda: [p["arguments"] for m, p in hub if m == "tools/call" and p.get("name") == "call"]  # noqa: E731

r = ra.invoke("hostinger/tool/dns", "records", {}, control)
last = calls()[-1]
ok(r["result"]["ok"] and last["tool"] == "hostinger.DNS_getDNSRecordsV1" and last["arguments"] == {"domain": "amberxai.com"} and last["hold"] is False, "Hostinger read: one call, hold false, default domain")
r = ra.invoke("hostinger/tool/vps", "restart", {"virtualMachineId": 7}, control)
ok(r["code"] == "confirmation_required" and len(calls()) == 1, "Hostinger VPS restart: confirm token first, nothing sent")
r = ra.invoke("hostinger/tool/vps", "restart", {"virtualMachineId": 7}, control, confirm=r["confirm"], reason="Restart after the kernel update")
last = calls()[-1]
ok(r["result"]["code"] == "held" and last["hold"] is True and last["reason"]["title"] == "Restart after the kernel update", "with the token: sent once, held for Brett with the reason")
r = ra.invoke("coolify/tool/applications", "deploy", {"uuid": "abc123", "force": True}, control)
last = calls()[-1]
ok(last["tool"] == "coolify.deploy" and last["arguments"] == {"uuid": "abc123", "force": True} and last["reason"]["title"].startswith("Coolify applications"), "Coolify deploy: held with a title from the entry")
ok(ra.invoke("coolify/tool/envs", "set", {"uuid": "abc123", "key": "1BAD", "value": "x"}, control)["code"] == "validation", "Coolify env key pattern")
r = ra.invoke("vps/tool/logs", "unit", {"unit": "docker.service", "lines": 50}, control)
last = calls()[-1]
ok(last["tool"] == "vps.run" and last["arguments"] == {"command": "journalctl -u 'docker.service' -n '50' --no-pager"} and last["hold"] is True, "VPS read: an allow-listed command, held (axHub asks for every vps.run)")
ok(ra.invoke("vps/tool/logs", "unit", {"unit": "x; reboot"}, control)["code"] == "validation", "VPS: a value outside the pattern never reaches the command line")
r = ra.invoke("vps/tool/processes", "kill", {"pid": 123}, control)
ok(r["code"] == "confirmation_required", "VPS kill needs the confirm token")
before = len(calls())
ra.invoke("vps/tool/health", "summary", {}, control)
ok(len(calls()) == before + 1, "each call is sent once (no polling, no re-sending)")
cat = ra.invoke("axhub-web/tool/connections", "catalog", {"service": "coolify"}, control)
ok(cat["result"]["tools"] == ["coolify.deploy"], "catalog lists the hub's tools for one service")
os.environ["AXHUB_TOKEN"] = "x"
chk = ra.providers_check()
ok("DNS_updateDNSRecordsV1" in chk["providers"]["hostinger"]["missing"] and not chk["ok"], "the provider check names declared ops the hub does not have")
os.environ.pop("AXHUB_TOKEN")

print(f"✓ registry REST, MCP and providers — {checks} checks")
