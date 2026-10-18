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
        if self.mode == "boom":
            raise RuntimeError("401 invalid x-api-key")
        if self.mode == "empty":
            return {"text": "", "model": "claude-opus-5-5"}
        return {"text": "OK", "model": self.model, "profile": "anthropic-main"}


print("claude-badge self-test")
check(c.get("/p/status").json()["last"] is None, "no result before the first test")
r = c.post("/p/test").json()
check(not r["ok"] and "AI assistant" in r["error"], "no assistant: AI unavailable, says why")
llm = FakeLlm()
llm.model = "claude-opus-5-5"
plugin_services.provide("axf.llm@1", llm, "fake-assistant")
r = c.post("/p/test").json()
check(r["ok"] and r["name"] == "Claude Opus 5.5" and r["claude"] and r["provider"] == "anthropic-main", "connected: model name made readable")
check(llm.calls[-1]["params"]["max_tokens"] <= 16 and len(llm.calls[-1]["messages"]) == 1, "the test is one tiny request")
for raw, want in [("claude-sonnet-5-5", "Claude Sonnet 5.5"), ("claude-fable-5-1", "Claude Fable 5.1"), ("claude-haiku-5-5-20261001", "Claude Haiku 5.5"),
                  ("claude-3-5-sonnet-20241022", "Claude Sonnet 3.5"), ("claude-opus-5", "Claude Opus 5"), ("gpt-5", "gpt-5"), ("", "")]:
    check(mod.pretty_model(raw) == want, f"model name {raw!r} → {want!r}")
llm.model = "gpt-5"
r = c.post("/p/test").json()
check(r["ok"] and r["name"] == "gpt-5" and not r["claude"], "another provider's model is shown as is")
llm.mode = "boom"
r = c.post("/p/test").json()
check(not r["ok"] and "invalid x-api-key" in r["error"] and r["name"] == "", "provider error: AI unavailable with the reason")
llm.mode = "empty"
check(not c.post("/p/test").json()["ok"], "an empty answer counts as unavailable")
last = c.get("/p/status").json()["last"]
check(last and not last["ok"] and "OK" not in json.dumps(last), "last result kept, no reply text stored")
f = Path(os.environ["AXF_CLAUDE_BADGE_DIR"]) / "status.json"
check((f.stat().st_mode & 0o777) == 0o600, "result file is private (0600)")
plugin_services.withdraw("fake-assistant")
check(not c.post("/p/test").json()["ok"], "assistant removed: unavailable again")
print(f"all {ok} checks passed")
