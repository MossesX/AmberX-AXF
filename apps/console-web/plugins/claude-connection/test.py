#!/usr/bin/env python3
"""Self-test for the Claude connection plugin (fake AI assistant + AI keys services, fake ~/.claude.json).

    python3 apps/console-web/plugins/claude-connection/test.py
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
TMP = Path(tempfile.mkdtemp(prefix="axf-cc-test-"))
os.environ["AXF_CLAUDE_JSON"] = str(TMP / "claude.json")
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

cx.set_context(ROOT=TMP)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.claude_connection_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
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
    print(f"  ✓ {msg}")


class FakeLlm:
    mode = "ok"
    kind = "claude-code"
    calls: list = []

    def profiles(self):
        return [{"id": "main", "kind": self.kind, "label": "Main"}]

    def complete(self, messages, system=None, profile=None, model=None, tools=None, params=None):
        self.calls.append(params)
        if self.mode == "boom":
            raise RuntimeError("401 invalid x-api-key")
        return {"text": "" if self.mode == "empty" else "OK", "model": "claude-opus-5-5", "profile": "main"}


class FakeKeys:
    def list(self):
        return {"keys": [{"id": "k1", "label": "Work key", "hint": "…abcd", "kind": "anthropic"}], "active": {"anthropic": "k1"}}


def fresh():
    return c.get("/p/status?refresh=true").json()


print("claude-connection self-test")
r = fresh()
check(not r["ok"] and "AI assistant" in r["error"], "no assistant: no connection, says why")
llm = FakeLlm()
plugin_services.provide("axf.llm@1", llm, "fake-assistant")
r = fresh()
check(r["ok"] and r["mode"] == "subscription" and r["email"] == "" and r["account"] == "Claude subscription", "subscription, no email known yet")
check(llm.calls[-1]["max_tokens"] <= 16, "one tiny request")
(TMP / "claude.json").write_text(json.dumps({"oauthAccount": {"emailAddress": "brett@example.com"}}))
r = fresh()
check(r["email"] == "brett@example.com" and r["account"] == "brett@example.com", "email from ~/.claude.json oauthAccount.emailAddress")
(TMP / "claude.json").write_text(json.dumps({"oauthAccount": {"emailAddress": "not an email"}}))
(TMP / ".axf-console").mkdir()
(TMP / ".axf-console" / "host-check.json").write_text(json.dumps({"$axf": "host-check@1", "checks": {"host-claude-login": {"status": "ok", "summary": "signed in as vps@example.com"}}}))
check(fresh()["email"] == "vps@example.com", "falls back to the host doctor's sign-in line")
n = len(llm.calls)
c.get("/p/status"); c.get("/p/status")
check(len(llm.calls) == n, "cached: page loads don't each make a request")
llm.kind = "anthropic"
r = fresh()
check(r["ok"] and r["mode"] == "api-key" and r["email"] == "" and r["account"] == "API key", "API key: no email, says API key")
plugin_services.provide("axf.ai-keys@1", FakeKeys(), "fake-keys")
r = fresh()
check(r["account"] == "API key · Work key" and "abcd" not in json.dumps(r), "API key: the AI keys label, never the key")
llm.kind = "openai"
r = fresh()
check(not r["ok"] and "isn't Claude" in r["error"], "a non-Claude default provider is no Claude connection")
llm.kind, llm.mode = "claude-code", "boom"
r = fresh()
check(not r["ok"] and "invalid x-api-key" in r["error"] and r["email"] == "", "provider error: no connection with the reason")
llm.mode = "empty"
check(not fresh()["ok"], "an empty answer counts as no connection")
D = {"mode": "colors", "icon": "claude", "on": "claude", "off": "claude", "onTone": "success", "offTone": "danger"}
check(c.get("/p/config").json() == {"look": D}, "look: none saved = the Claude mark, green / red")
two = {"mode": "icons", "on": "wifi", "off": "wifi-off@blink:still", "onTone": "accent", "offTone": "warning"}
r = c.put("/p/config", json={"look": two}).json()["look"]
check(r["mode"] == "icons" and r["on"] == "wifi" and r["off"] == "wifi-off@blink:still" and r["offTone"] == "warning", "look: two icons + colours save")
check(c.get("/p/status").json()["look"]["on"] == "wifi", "status carries the look for Patches")
check(c.put("/p/config", json={"look": {"mode": "icons", "on": "<script>"}}).status_code == 400, "look: a bad icon is refused")
check(c.get("/p/config").json()["look"]["on"] == "wifi", "a refused look keeps the saved one")
check(c.put("/p/config", json={"look": {"mode": "colors", "icon": "plug", "onTone": "nope"}}).json()["look"]["onTone"] == "success", "look: an unknown colour falls back")
(TMP / ".axf-console" / "plugins" / "claude-connection").mkdir(parents=True, exist_ok=True)
(TMP / ".axf-console" / "plugins" / "claude-connection" / "config.json").write_text(json.dumps({"icon": "cloud@pulse:still"}))
check(c.get("/p/config").json()["look"] == {**D, "icon": "cloud@pulse:still", "on": "cloud@pulse:still", "off": "cloud@pulse:still"}, "an icon saved before reads as one icon in two colours")
print(f"claude-connection self-test: {ok} checks passed")
