#!/usr/bin/env python3
"""Self-test for the Agent voice plugin's server (fake agents service, fake voice providers).

    python3 apps/console-web/plugins/agent-voice/test.py
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
os.environ["AXF_AGENT_VOICE_DIR"] = tempfile.mkdtemp(prefix="axf-av-test-")
os.environ.pop("OPENAI_API_KEY", None)
os.environ.pop("ELEVENLABS_API_KEY", None)
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.agent_voice_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
ok = 0
DATA = Path(os.environ["AXF_AGENT_VOICE_DIR"])


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


calls: list = []


def fake_http(url, headers, body, method="POST"):
    calls.append({"url": url, "headers": headers, "body": json.loads(body) if body else None, "method": method})
    if "bad" in (headers.get("authorization", "") + headers.get("xi-api-key", "")):
        return 401, "application/json", b'{"error":{"message":"Incorrect API key"}}'
    if url.endswith("/v1/models"):
        return 200, "application/json", b'{"data":[]}'
    if url.endswith("/v1/voices"):
        return 200, "application/json", b'{"voices":[{"voice_id":"abc123","name":"Rachel","category":"premade"}]}'
    if "audio/speech" in url or "text-to-speech" in url:
        return 200, "audio/mpeg", b"ID3fakeaudio"
    return 404, "application/json", b"{}"


mod.http = fake_http


class FakeAgents:
    def list_agents(self):
        return [{"id": "molly", "name": "Molly", "icon": "mic"}, {"id": "mosses", "name": "Mosses"}, {"name": "no id"}]


r = c.get("/p/store").json()
check(r["agents"] == [] and r["agentsService"] is False, "no agent manager: no agents, no crash")
plugin_services.provide("axf.agents@1", FakeAgents(), "fake-agents")
r = c.get("/p/store").json()
check([a["id"] for a in r["agents"]] == ["molly", "mosses"], "agents from axf.agents@1 (bad rows dropped)")
check(r["cloud"] == {"openai": False, "elevenlabs": False}, "no cloud keys yet")

check(c.put("/p/profiles/../x", json={}).status_code in (400, 404), "bad agent id refused")
check(c.put("/p/profiles/molly", json={"x": "y" * 70000}).status_code == 413, "huge profile refused")
p = c.put("/p/profiles/molly", json={"enabled": True, "agentId": "someone-else", "permissions": {"listen": True, "cloud": False}, "cloud": {"provider": "openai", "voice": "nova"}}).json()["profile"]
check(p["agentId"] == "molly" and p["$axf"] == "agent-voice@1" and p["updatedAt"], "profile saved under its path id")
check(c.get("/p/store").json()["store"]["profiles"]["molly"]["enabled"] is True, "profile reads back")
check((DATA / "store.json").stat().st_mode & 0o777 == 0o600, "store is private (0600)")

check(c.put("/p/mic", json={"mode": "toggle"}).json()["ok"], "mic saved")
check(c.put("/p/pronunciations", json=[{"from": "k8s", "to": "kubernetes"}, {"from": ""}, 3]).json()["count"] == 1, "pronunciations keep good rows")

r = c.post("/p/tts", json={"agentId": "molly", "text": "hello"})
check(r.status_code == 403 and "cloud" in r.json()["detail"], "cloud speech refused without the agent's cloud permission")
c.put("/p/profiles/molly", json={"enabled": True, "permissions": {"listen": True, "cloud": True}, "cloud": {"provider": "openai", "voice": "nova", "style": "warm"}, "rate": 1.2})
r = c.post("/p/tts", json={"agentId": "molly", "text": "hello"})
check(r.status_code == 400 and "key" in r.json()["detail"], "no key: says where to add one")

check(c.put("/p/keys/openai", json={"key": "bad-key"}).status_code == 400, "a refused key isn't stored")
check(c.put("/p/keys/openai", json={"key": "has space"}).status_code == 400, "a key with spaces is refused")
check(c.put("/p/keys/openai", json={"key": "sk-good"}).json()["ok"], "a working key is stored")
check((DATA / "keys.json").stat().st_mode & 0o777 == 0o600, "keys are private (0600)")
keys = c.get("/p/keys").json()["providers"]
check(keys[0]["set"] and keys[0]["stored"] and "sk-good" not in json.dumps(keys), "keys list says set, never shows the key")
check(c.put("/p/keys/nope", json={"key": "x"}).status_code == 404, "unknown provider")

calls.clear()
r = c.post("/p/tts", json={"agentId": "molly", "text": "hello there"})
check(r.status_code == 200 and r.content == b"ID3fakeaudio" and r.headers["x-agent-voice-cache"] == "miss", "OpenAI speech returned")
sent = calls[-1]["body"]
check(sent["voice"] == "nova" and sent["instructions"] == "warm" and sent["speed"] == 1.2 and sent["model"] == "gpt-4o-mini-tts", "profile's voice, style and speed sent")
check(calls[-1]["headers"]["authorization"] == "Bearer sk-good", "key goes only to the provider")
calls.clear()
r = c.post("/p/tts", json={"agentId": "molly", "text": "hello there"})
check(r.headers["x-agent-voice-cache"] == "hit" and not calls, "second time from the cache")
check(c.post("/p/tts", json={"agentId": "molly", "text": "x" * 5000}).status_code == 413, "too long refused")
check(c.post("/p/tts", json={"agentId": "molly", "text": "  "}).status_code == 400, "empty refused")

check(c.get("/p/voices/elevenlabs").status_code == 400, "ElevenLabs voices need a key")
check(c.put("/p/keys/elevenlabs", json={"key": "xi-good"}).json()["ok"], "ElevenLabs key tested + stored")
v = c.get("/p/voices/elevenlabs").json()
check(v["voices"][0] == {"id": "abc123", "name": "Rachel", "category": "premade"}, "ElevenLabs voices listed")
check(len(c.get("/p/voices/openai").json()["voices"]) >= 6, "OpenAI voices listed")
c.put("/p/profiles/molly", json={"enabled": True, "permissions": {"cloud": True}, "cloud": {"provider": "elevenlabs", "voice": "abc123", "stability": 0.3}})
r = c.post("/p/tts", json={"agentId": "molly", "text": "eleven"})
check(r.status_code == 200 and "text-to-speech/abc123" in calls[-1]["url"] and calls[-1]["body"]["voice_settings"]["stability"] == 0.3, "ElevenLabs speech with the voice settings")

r = c.put("/p/import", json={"$axf": "agent-voice@1", "profiles": {"mosses": {"enabled": True}, "../bad": {}}, "pronunciations": [{"from": "K8S", "to": "x"}, {"from": "AXF", "to": "A X F"}]}).json()
check(r["count"] == 1, "import takes valid profiles only")
check([p["from"] for p in c.get("/p/store").json()["store"]["pronunciations"]] == ["k8s", "AXF"], "import merges pronunciations without duplicates")
check(c.put("/p/import", json={"x": 1}).status_code == 400, "import refuses other files")

check(c.delete("/p/profiles/mosses").json()["removed"], "profile removed")
check(c.get("/p/check").json()["voiceAgents"] == 1, "self check counts voice agents")
check(c.delete("/p/cache").json()["removed"] >= 1, "cache cleared")
check(c.delete("/p/keys/openai").json()["ok"] and not c.get("/p/keys").json()["providers"][0]["set"], "key removed")
plugin_services.withdraw("fake-agents")
check(c.get("/p/store").json()["agents"] == [], "agent manager removed: agents gone, store intact")
print(f"all {ok} checks passed")
