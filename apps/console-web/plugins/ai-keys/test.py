#!/usr/bin/env python3
"""Self-test for the AI keys plugin (fake key tester, scratch data folder).

    python3 apps/console-web/plugins/ai-keys/test.py
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
os.environ["AXF_AI_KEYS_DIR"] = tempfile.mkdtemp(prefix="axf-aikeys-test-")
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.ai_keys_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
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


GOOD = {"sk-ant-api03-" + "a" * 40, "sk-ant-api03-" + "b" * 40, "sk-ant-oat01-" + "c" * 40}
BAD = "sk-ant-api03-" + "z" * 40


def fake(kind, key):
    if key not in GOOD:
        raise RuntimeError(f"401 invalid x-api-key {key}")
    return {"ok": True, "ms": 5, "detail": kind}


mod.TESTER = fake
svc = lambda: plugin_services.get("axf.ai-keys@1")  # noqa: E731
A1, A2, S1 = sorted(GOOD)[0], sorted(GOOD)[1], "sk-ant-oat01-" + "c" * 40

print("ai-keys self-test")
check(c.get("/p/keys").json()["keys"] == [], "empty to start")
check(svc() and svc().active_key("anthropic") == "", "service: no active key yet")
check(c.post("/p/keys", json={"key": "hello"}).status_code == 400, "not a key: refused")
r = c.post("/p/keys", json={"key": BAD, "label": "bad"})
check(r.status_code == 400 and "wasn't saved" in r.json()["detail"] and BAD not in r.text, "invalid key refused, key not echoed")
check(c.get("/p/keys").json()["keys"] == [], "nothing saved after a failed test")
r = c.post("/p/keys", json={"key": A1, "label": "Main"}).json()
check(r["key"]["kind"] == "anthropic" and r["key"]["active"] and r["key"]["hint"] == "…aaaa", "API key saved, first of its kind becomes active")
check(A1 not in json.dumps(r), "the key is never returned")
check(c.post("/p/keys", json={"key": A1}).status_code == 409, "duplicate refused")
r = c.post("/p/keys", json={"key": A2, "label": "Second"}).json()
k2 = r["key"]["id"]
check(not r["key"]["active"] and svc().active_key("anthropic") == A1, "a second key doesn't take over by itself")
r = c.post("/p/keys", json={"key": f" {S1}\n", "label": "Max"}).json()
check(r["key"]["kind"] == "claude-code" and svc().active_key("claude-code") == S1, "subscription token detected, whitespace stripped, active")
c.post("/p/active", json={"id": k2})
check(svc().active_key("anthropic") == A2, "pick the active key")
check(svc().active_key("claude-code") == S1, "the other kind is untouched")
c.post("/p/active", json={"kind": "anthropic", "id": ""})
check(svc().active_key("anthropic") == "", "no active key: the assistant's own key applies")
c.post("/p/active", json={"id": k2})
r = c.post(f"/p/keys/{k2}/test").json()
check(r["test"]["ok"], "re-test works")
GOOD.discard(A2)
r = c.post(f"/p/keys/{k2}/test").json()
check(not r["test"]["ok"] and A2 not in json.dumps(r), "a key that stopped working shows failed, key hidden in the error")
c.patch(f"/p/keys/{k2}", json={"label": "Renamed"})
check(any(k["label"] == "Renamed" for k in c.get("/p/keys").json()["keys"]), "rename")
c.delete(f"/p/keys/{k2}")
check(svc().active_key("anthropic") == A1, "removing the active key hands over to the next of its kind")
check(c.delete("/p/keys/nope").status_code == 404, "unknown id: 404")
f = Path(os.environ["AXF_AI_KEYS_DIR"]) / "keys.json"
check((f.stat().st_mode & 0o777) == 0o600, "keys file is private (0600)")
# The assistant runtime's hook: the active key wins over a profile's own key, except for noKeyOverride tests.
sys.path.insert(0, str(REPO / "framework" / "python"))
from axf.assistant_host import providers  # noqa: E402
providers.key_override = lambda p: (svc().active_key(p.get("kind", "")) if svc() else "")
check(providers.resolve_key({"kind": "anthropic", "key": "own"}) == A1, "assistant: active key replaces the profile's key")
check(providers.resolve_key({"kind": "openai", "key": "own"}) == "own", "assistant: other providers keep their own key")
check(providers.resolve_key({"kind": "anthropic", "key": "own", "noKeyOverride": True}) == "own", "assistant: key tests use the key under test")
plugin_services.withdraw("ai-keys")
check(providers.resolve_key({"kind": "anthropic", "key": "own"}) == "own", "plugin off: the profile's own key applies")
print(f"all {ok} checks passed")
