#!/usr/bin/env python3
"""Self-test for the Claude badge plugin (fake AI assistant service).

    python3 apps/console-web/plugins/claude-badge/test.py
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
REPO = HERE.parents[3]
os.environ["AXF_CLAUDE_BADGE_DIR"] = tempfile.mkdtemp(prefix="axf-cb-test-")
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.claude_badge_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
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
    calls: list = []

    def complete(self, messages, system=None, profile=None, model=None, tools=None, params=None):
        self.calls.append({"messages": messages, "params": params})
        if self.mode == "broke":
            raise RuntimeError("400 Your credit balance is too low to access the Anthropic API")
        if self.mode == "limit":
            raise RuntimeError("Claude usage limit reached")
        if self.mode == "boom":
            raise RuntimeError("401 invalid x-api-key")
        if self.mode == "empty":
            return {"text": "", "model": "claude-opus-5-5"}
        return {"text": "OK", "model": self.model, "profile": "anthropic-main"}


print("claude-badge self-test")
check(c.get("/p/status").json()["last"] is None, "no result before the first test")
r = c.post("/p/test").json()
check(not r["ok"] and "AI assistant" in r["error"] and r["state"] == "error", "no assistant: AI unavailable, says why")
llm = FakeLlm()
llm.model = "claude-opus-5-5"
plugin_services.provide("axf.llm@1", llm, "fake-assistant")
r = c.post("/p/test").json()
check(r["ok"] and r["state"] == "ok" and r["name"] == "Claude Opus 5.5" and r["claude"] and r["provider"] == "anthropic-main", "connected: model name made readable")
check(llm.calls[-1]["params"]["max_tokens"] <= 16 and len(llm.calls[-1]["messages"]) == 1, "the test is one tiny request")
for raw, want in [("claude-sonnet-5-5", "Claude Sonnet 5.5"), ("claude-fable-5-1", "Claude Fable 5.1"), ("claude-haiku-5-5-20261001", "Claude Haiku 5.5"),
                  ("claude-3-5-sonnet-20241022", "Claude Sonnet 3.5"), ("claude-opus-5", "Claude Opus 5"), ("gpt-5", "gpt-5"), ("", "")]:
    check(mod.pretty_model(raw) == want, f"model name {raw!r} → {want!r}")
llm.model = "gpt-5"
r = c.post("/p/test").json()
check(r["ok"] and r["name"] == "gpt-5" and not r["claude"], "another provider's model is shown as is")
llm.mode = "boom"
r = c.post("/p/test").json()
check(not r["ok"] and "invalid x-api-key" in r["error"] and r["name"] == "" and r["state"] == "error", "bad key: can't connect (state error) with the reason")
llm.mode = "broke"
r = c.post("/p/test").json()
check(not r["ok"] and r["state"] == "no-credit" and "credit balance" in r["error"], "account works but no credits: state no-credit")
llm.mode = "limit"
check(c.post("/p/test").json()["state"] == "no-credit", "usage limit reached counts as out of credits")
for msg, want in [("402 Payment Required", "no-credit"), ("insufficient_quota", "no-credit"), ("401 invalid x-api-key", "error"), ("connection refused", "error"), ("", "error")]:
    check(mod.classify(False, msg) == want, f"classify {msg!r} → {want}")
check(mod.classify(True, "quota") == "ok", "a working answer is ok whatever the text")
f0 = Path(os.environ["AXF_CLAUDE_BADGE_DIR"]) / "status.json"
saved = f0.read_text("utf-8")
f0.write_text(json.dumps({"at": 1, "ok": False, "error": "credit balance is too low"}), "utf-8")
check(c.get("/p/status").json()["last"]["state"] == "no-credit", "an older saved result without a state gets one")
f0.write_text(saved, "utf-8")
f0.chmod(0o600)
llm.mode = "empty"
r = c.post("/p/test").json()
check(not r["ok"] and r["state"] == "error", "an empty answer counts as unavailable")
last = c.get("/p/status").json()["last"]
check(last and not last["ok"] and "OK" not in json.dumps(last), "last result kept, no reply text stored")
f = Path(os.environ["AXF_CLAUDE_BADGE_DIR"]) / "status.json"
check((f.stat().st_mode & 0o777) == 0o600, "result file is private (0600)")
plugin_services.withdraw("fake-assistant")
check(not c.post("/p/test").json()["ok"], "assistant removed: unavailable again")
print("VPS connection (no model call)")


class FakeAccounts:
    def __init__(self):
        self.value = {"ready": True, "why": "", "checked": True, "active": "account-1", "login": {"email": "b@example.com", "plan": "max"}, "expiresAt": "2099-01-01T00:00:00.000Z"}
        self.fail = False

    def view(self):
        if self.fail:
            raise RuntimeError("ssh broke")
        return self.value


class FakeKeys:
    at = 0
    asked = ""

    def limited_at(self, name=""):
        self.asked = name
        return self.at


llm = FakeLlm()
llm.model = "claude-opus-5-5"
plugin_services.provide("axf.llm@1", llm, "fake-assistant")
llm.calls.clear()
before = f.read_text("utf-8")
r = c.get("/p/vps").json()
check(r["state"] == "error" and not r["reachable"] and "plugin is off" in r["error"], "no accounts service: grey, says why, not 'logged out'")
fa, fk = FakeAccounts(), FakeKeys()
plugin_services.provide("axf.claude-accounts@1", fa, "fake-accounts")
plugin_services.provide("axf.ai-keys@1", fk, "fake-keys")
r = c.get("/p/vps").json()
check(r["ok"] and r["state"] == "ok" and r["email"] == "b@example.com" and r["plan"] == "max" and r["account"] == "account-1", "logged in: green, with who")
check(fk.asked == "account-1", "the limit mark is asked for the active account")
fk.at = 12345
r = c.get("/p/vps").json()
check(not r["ok"] and r["state"] == "no-credit" and r["reachable"] and r["limitedAt"] == 12345 and r["email"], "limit hit: amber, keeps the account")
fk.at = 0
fa.value = {**fa.value, "login": {}}
r = c.get("/p/vps").json()
check(r["state"] == "error" and r["reachable"] and "isn't logged in" in r["error"], "read fine, nobody logged in: red")
fa.value = {**fa.value, "login": {"email": "b@example.com"}, "expiresAt": "2020-01-01T00:00:00.000Z"}
check("expired" in c.get("/p/vps").json()["error"], "login past its expiry: red")
fa.value = {**fa.value, "expiresAt": "not a date"}
check(c.get("/p/vps").json()["state"] == "ok", "an unreadable expiry is not an expired login")
fa.value = {**fa.value, "checked": False, "login": {}}
r = c.get("/p/vps").json()
check(r["state"] == "error" and not r["reachable"], "`claude auth status` gave nothing: can't read, not logged out")
fa.value = {**fa.value, "ready": False, "why": "the VPS tab isn't set up"}
r = c.get("/p/vps").json()
check(not r["reachable"] and "VPS tab" in r["error"], "host unreachable: grey with the reason")
fa.fail = True
r = c.get("/p/vps").json()
check(r["state"] == "error" and not r["reachable"] and "ssh broke" in r["error"], "a failing read says why")
fa.fail = False
fa.value = FakeAccounts().value
plugin_services.withdraw("fake-keys")
check(c.get("/p/vps").json()["state"] == "ok", "AI keys off: still reads the login")
check(not llm.calls, "VPS checks never called a model")
check(f.read_text("utf-8") == before, "VPS checks leave the console test's saved result alone")


guest_app = FastAPI()


@guest_app.middleware("http")
async def _guest(request, call_next):
    request.state.axf_user = types.SimpleNamespace(admin=False, name="guest")
    return await call_next(request)


guest_app.include_router(mod.router, prefix="/p")
g = TestClient(guest_app).get("/p/vps").json()
check(g["state"] == "ok" and not g["email"] and not g["plan"] and not g["account"], "a non-owner gets the state, not who it is")
print(f"all {ok} checks passed")
