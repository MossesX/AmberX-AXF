#!/usr/bin/env python3
"""Self-test for the axHub connection plugin (fake hub answers).

    python3 apps/console-web/plugins/hub-connection/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
TMP = Path(tempfile.mkdtemp(prefix="axf-hc-test-"))
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402

cx.set_context(ROOT=TMP)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.hub_connection_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
ok = 0
CALLS: list = []
ANSWER = {"code": 200}
mod.post = lambda url, body, headers: (CALLS.append({"url": url, "auth": headers.get("Authorization"), "body": json.loads(body)}), ANSWER["code"])[1]


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


def fresh():
    return c.get("/p/status?refresh=true").json()


print("hub-connection self-test")
os.environ.pop("AXHUB_TOKEN", None)
os.environ.pop("AXHUB_URL", None)
r = fresh()
check(not r["ok"] and "no axHub token" in r["error"] and not CALLS, "no token: no connection, hub not asked")
os.environ["AXHUB_TOKEN"] = "hub-tok"
r = fresh()
check(r["ok"] and r["hub"] == "https://axhub.amberxai.com", "connected to the default hub")
check(CALLS[-1]["url"] == "https://axhub.amberxai.com/mcp" and CALLS[-1]["auth"] == "Bearer hub-tok" and CALLS[-1]["body"]["method"] == "initialize", "one MCP initialize with the hub token")
check("hub-tok" not in json.dumps(r), "the token is never returned")
n = len(CALLS)
c.get("/p/status"); c.get("/p/status")
check(len(CALLS) == n, "cached: page loads don't each ask the hub")
ANSWER["code"] = 401
check("refused the token" in fresh()["error"], "a refused token says so")
ANSWER["code"] = 0
check("Can't reach" in fresh()["error"], "an unreachable hub says so")
os.environ["AXHUB_URL"] = "http://hub.example"
check("https" in fresh()["error"], "plain http refused")
os.environ["AXHUB_URL"] = "https://hub.example/"
ANSWER["code"] = 200
check(fresh()["hub"] == "https://hub.example", "AXHUB_URL used, trailing slash dropped")
D = {"mode": "colors", "icon": "hub", "on": "hub", "off": "hub", "onTone": "success", "offTone": "danger"}
check(c.get("/p/config").json() == {"look": D}, "look: none saved = the hub icon, green / red")
two = {"mode": "icons", "on": "wifi@pulse", "off": "wifi-off", "onTone": "accent", "offTone": "muted"}
check(c.put("/p/config", json={"look": two}).json()["look"] == {**two, "icon": "hub"}, "look: two icons + colours save")
check(c.get("/p/status").json()["look"]["off"] == "wifi-off", "status carries the look for Patches")
check(c.put("/p/config", json={"look": {"on": "<x>"}}).status_code == 400, "look: a bad icon is refused")
check(c.put("/p/config", json={"icon": "hub"}).status_code == 400, "look: anything but {look} is refused")
check(oct((mod.data_dir() / "config.json").stat().st_mode & 0o777) == "0o600", "config file 0600")
print(f"hub-connection self-test: {ok} checks passed")
