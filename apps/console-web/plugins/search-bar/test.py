#!/usr/bin/env python3
"""Self-test for the Search bar plugin's server part (config, AI gate, ranking, state).

    python3 apps/console-web/plugins/search-bar/test.py
"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
os.environ["AXF_SEARCH_BAR_DIR"] = tempfile.mkdtemp(prefix="axf-sb-test-")

sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.search_bar_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
ok = 0


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1


# ---- config
r = c.get("/p/config").json()
check(r["options"]["mode"] == "words" and r["options"]["ai"] is False, "defaults")
check(c.put("/p/config", json={"mode": "regex", "caseSensitive": True}).json()["options"]["mode"] == "regex", "save mode")
check(c.get("/p/config").json()["options"]["caseSensitive"] is True, "kept on disk")
check(c.put("/p/config", json={"mode": "magic"}).status_code == 400, "bad mode refused")
check(c.put("/p/config", json={"perCategory": 0}).status_code == 400, "range checked")
check(c.put("/p/config", json={"nope": 1}).status_code == 400, "unknown key refused")

# ---- AI gate: needs the capability + an Ollama profile + the switch
plugin_services._services.clear()
check(c.get("/p/ai").json()["active"] is False, "no capability: off")
check(c.post("/p/ai/rank", json={"q": "x", "candidates": [{"id": "a"}]}).status_code == 409, "rank refused while off")


class FakeLlm:
    def __init__(self, profiles):
        self._p = profiles
        self.calls = []

    def profiles(self):
        return self._p

    def complete(self, messages, system=None, profile=None, model=None, tools=None, params=None):
        self.calls.append(profile)
        return {"text": 'Sure: {"ids": ["b", "zzz", "a", "b"]}'}


cloud = FakeLlm([{"id": "claude", "kind": "anthropic", "baseUrl": "https://api.anthropic.com"}])
plugin_services.provide("axf.llm@1", cloud, folder="x")
c.put("/p/config", json={"ai": True})
st = c.get("/p/ai").json()
check(st["capability"] and not st["ollama"] and not st["active"], "a cloud provider is not a Llama connection")

llama = FakeLlm([{"id": "claude", "kind": "anthropic"}, {"id": "home-llama", "kind": "ollama", "baseUrl": "http://127.0.0.1:11434"}])
plugin_services.provide("axf.llm@1", llama, folder="x")
st = c.get("/p/ai").json()
check(st["active"] and st["profile"] == "home-llama", "Ollama + switch on: active")
r = c.post("/p/ai/rank", json={"q": "dark", "candidates": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}]}).json()
check(r["ids"] == ["b", "a"], f"ids filtered and deduplicated: {r}")
check(llama.calls == ["home-llama"], "ran on the Ollama profile")
c.put("/p/config", json={"ai": False})
check(c.get("/p/ai").json()["active"] is False, "switch off: off even with Ollama")

# ---- state report
check(c.put("/p/state", json={"tab": "t1", "instances": [{"id": "banner:everything", "host": "banner", "view": "bar", "scope": "settings", "query": "font", "open": True, "results": 3, "categories": {"settings": 3}}]}).json()["ok"], "report")
s = c.get("/p/state").json()
check(s["tabs"][0]["instances"][0]["scope"] == "settings" and s["tabs"][0]["instances"][0]["results"] == 3, "state readable")
check(c.put("/p/state", json={"tab": "../x"}).status_code == 400, "bad tab id refused")

print(f"search-bar server: {ok} checks passed")
