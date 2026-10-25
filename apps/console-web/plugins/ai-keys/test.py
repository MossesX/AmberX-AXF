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
os.environ["AXF_AI_KEYS_NO_THREAD"] = "1"  # no refresh thread
os.environ["AXF_AI_KEYS_NO_VPS"] = "1"  # VPS writes are run by hand below
os.environ.pop("AXF_CLAUDE_CREDENTIALS", None)
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
R1 = "sk-ant-ort01-" + "r" * 40
SPENT: set[str] = set()
ROT = {"n": 0}


def refresher(refresh):
    if refresh in SPENT or not refresh.startswith("sk-ant-ort01-r"):
        raise RuntimeError(f"400 invalid_grant {refresh}")
    SPENT.add(refresh)
    ROT["n"] += 1
    new_a, new_r = f"sk-ant-oat01-{'n' * 38}{ROT['n']:02d}", f"sk-ant-ort01-r{'s' * 37}{ROT['n']:02d}"
    GOOD.add(new_a)
    return {"access": new_a, "refresh": new_r, "expiresAt": mod._now() + 8 * 3600_000, "scopes": ["user:inference"]}


mod.REFRESHER = refresher
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
r = c.post("/p/keys", json={"key": S1, "label": "Max"})
check(r.status_code == 400 and "refresh token" in r.json()["detail"], "subscription token alone: refused, both tokens required")
r = c.post("/p/keys", json={"key": S1, "refresh": "sk-ant-ort01-" + "x" * 40, "label": "Max"})
check(r.status_code == 400 and "refresh token was refused" in r.json()["detail"] and "xxxx" not in r.text, "a refresh token that doesn't work: refused, not echoed")
r = c.post("/p/keys", json={"key": "sk-ant-oat01-" + "q" * 40, "refresh": R1})
check(r.status_code == 400 and "access token was refused" in r.json()["detail"] and R1 not in SPENT, "an access token that doesn't work (not expired): refused before the refresh is spent")
r = c.post("/p/keys", json={"key": f" {S1}\n", "refresh": R1, "label": "Max"}).json()
S1 = svc().active_key("claude-code")
check(r["key"]["kind"] == "claude-code" and r["key"]["pair"] and S1.startswith("sk-ant-oat01-n"), "pair authorised in tandem, rotated pair stored and active")
check(r["key"]["lastTest"]["ok"] and [x["step"] for x in r["key"]["lastTest"]["steps"]] == ["access", "refresh", "renewed access"], "validation ran all three steps")
check(R1 not in json.dumps(r) and S1 not in json.dumps(r) and r["key"]["refreshHint"].startswith("…"), "neither token is returned")
sid = r["key"]["id"]
c.post("/p/active", json={"id": k2})
check(svc().active_key("anthropic") == A2, "pick the active key")
check(svc().active_key("claude-code") == S1, "the other kind is untouched")
# Credentials file pasted whole, already expired: the refresh token renews it.
R2 = "sk-ant-ort01-r" + "t" * 39
creds = {"claudeAiOauth": {"accessToken": "sk-ant-oat01-" + "o" * 40, "refreshToken": R2, "expiresAt": mod._now() - 1000, "scopes": ["user:inference"], "subscriptionType": "max"}}
r = c.post("/p/keys", json={"credentials": json.dumps(creds), "label": "From the VPS"}).json()
cid = r["key"]["id"]
check(r["key"]["pair"] and r["key"]["subscriptionType"] == "max" and r["key"]["lastTest"]["steps"][0]["note"].startswith("expired"), "credentials file: expired access renewed by the refresh token")
check(c.post("/p/keys", json={"credentials": "{nope"}).status_code == 400, "credentials file that isn't JSON: refused")
check(c.post("/p/active", json={"id": cid}).json()["active"]["claude-code"] == cid, "pick a pair")
# Expiry: a read close to expiry refreshes; the refresh pass renews pairs within 30 min.
db = mod._load(); db["keys"][cid]["expiresAt"] = mod._now() + 60_000; mod._save(db)
before = mod._load()["keys"][cid]["key"]
after = svc().active_key("claude-code")
check(after != before and mod._load()["keys"][cid]["expiresAt"] > mod._now() + 3600_000, "active pair close to expiry: refreshed on read")
db = mod._load(); db["keys"][sid]["expiresAt"] = mod._now() + 20 * 60_000; mod._save(db)
check(mod.refresh_due() == 1, "refresh pass renews only the pair close to expiry")
db = mod._load(); db["keys"][sid]["expiresAt"] = mod._now() - 1; SPENT.add(db["keys"][sid]["refresh"]); mod._save(db)
check(mod.refresh_due() == 0 and mod._load()["keys"][sid].get("refreshError"), "a refresh that fails is recorded, nothing lost")
# Older single tokens: listed as needing a refresh token, never active, completed with PATCH.
db = mod._load(); db["keys"]["old1"] = {"label": "Old", "kind": "claude-code", "key": "sk-ant-oat01-" + "c" * 40, "createdAt": 1}; mod._save(db)
row = next(k for k in c.get("/p/keys").json()["keys"] if k["id"] == "old1")
check(row["needsRefresh"] and c.post("/p/active", json={"id": "old1"}).status_code == 400, "single token: flagged, can't be made active")
R3 = "sk-ant-ort01-r" + "u" * 39
r = c.patch("/p/keys/old1", json={"refresh": R3})
check(r.status_code == 200 and not next(k for k in r.json()["keys"] if k["id"] == "old1")["needsRefresh"], "single token completed into a pair")
# VPS: no direct path → noted in the log, Vinny writes it after the approval; the command holds no token.
calls = []


class FakeVinny:
    def ready(self):
        return True, ""

    def call(self, tool, args, conf, timeout, reason):
        calls.append((tool, args, conf))
        staged = json.loads(mod.staged_path().read_text())
        check(staged["claudeAiOauth"]["accessToken"] == svc().active_key("claude-code"), "vps: staged file holds the active pair") if not conf else None
        return {"confirm": "ap1"} if not conf else {"ok": "exit 0\ncredentials written"}


mod.SLEEP = lambda s: None
plugin_services.provide("axf.vinny@1", FakeVinny(), "agent-manager")
v = mod.sync_vps("test")
cmd = calls[0][1]["command"]
check(v["state"] == "done" and v["via"] == "vinny" and calls[1][2] == "ap1", "vps: Vinny writes it after the approval (retried with its id)")
check("sk-ant" not in cmd and "docker exec" in cmd and ".credentials.json" in cmd, "vps: no token in the command")
check(any("can't reach" in l["text"] for l in v["log"]) and any("approval" in l["text"] for l in v["log"]), "vps: trouble noted in the sync log")
check(not mod.staged_path().exists(), "vps: staged file removed after")
target = Path(os.environ["AXF_AI_KEYS_DIR"]) / "vps-home" / ".credentials.json"
os.environ["AXF_CLAUDE_CREDENTIALS"] = str(target)
calls.clear()
v = mod.sync_vps("test")
check(v["via"] == "direct" and not calls and json.loads(target.read_text())["claudeAiOauth"]["refreshToken"].startswith("sk-ant-ort") and (target.stat().st_mode & 0o777) == 0o600, "vps: written directly (0600) when reachable")
os.environ["AXF_CLAUDE_CREDENTIALS"] = "/proc/nope/.credentials.json"
v = mod.sync_vps("test")
check(v["via"] == "vinny" and any("directly" in l["text"] for l in v["log"]), "vps: direct write fails → logged, falls back to Vinny")
os.environ.pop("AXF_CLAUDE_CREDENTIALS")
plugin_services.withdraw("agent-manager")
v = mod.sync_vps("test")
check(v["state"] == "failed" and "Vinny" in v["error"], "vps: no Vinny → failed with why")
check("sk-ant" not in json.dumps(c.get("/p/vps").json()), "vps: status never holds a token")
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
# Credits switch (systems check, via the assistant): the active key is out of credits → the next saved key with credit.
A3, A4 = "sk-ant-api03-" + "d" * 40, "sk-ant-api03-" + "e" * 40
GOOD |= {A3, A4}
c.post("/p/keys", json={"key": A3, "label": "Empty too"})
k4 = c.post("/p/keys", json={"key": A4, "label": "Has credit"}).json()["key"]["id"]
EMPTY = {A1, A3}
def probe(kind, key, model):
    if key in EMPTY:
        raise RuntimeError(f"400 Your credit balance is too low {key}")
mod.CREDIT_PROBE = probe
nc = lambda m: "credit balance" in m  # noqa: E731
r = svc().credit_switch("anthropic", None, nc)
check(r["switched"] and r["switched"]["to"] == k4 and svc().active_key("anthropic") == A4, "credits: switches to the first saved key with credit")
check(all(k not in json.dumps(r) for k in (A1, A3, A4)), "credits: no key in the answer")
check(mod._load()["active"]["claude-code"] == cid, "credits: the other kind is untouched")
EMPTY.add(A4)
r = svc().credit_switch("anthropic", None, nc)
check(r["switched"] is None and svc().active_key("anthropic") == A4, "credits: none with credit leaves the active key alone")
mod.CREDIT_PROBE = lambda kind, key, model: (_ for _ in ()).throw(RuntimeError("connection refused"))
r = svc().credit_switch("anthropic", None, nc)
check(r["switched"] is None and all(t["state"] == "error" for t in r["tried"]), "credits: a non-credit error never switches")
check(svc().open_action == "ai-keys.open", "credits: the systems check opens this dialog")
c.post("/p/active", json={"id": next(k["id"] for k in c.get("/p/keys").json()["keys"] if k["hint"] == "…aaaa")})
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
