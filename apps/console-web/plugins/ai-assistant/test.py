#!/usr/bin/env python3
"""Self-test for the AI assistant plugin's server part (no network, no keys).

    python3 apps/console-web/plugins/ai-assistant/test.py

Runs fake OpenAI-compatible and Anthropic servers on localhost, mounts the plugin router in a FastAPI app the same
way the console does, and checks: profiles, model lists, streamed turns, tool rounds, fallback, regenerate, edit,
fork, export/import, agent integration through a fake axf.agents@1 service, compare, usage and the axf.llm@1 service.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER_DIR = HERE.parents[1] / "server"
os.environ["AXF_AI_ASSISTANT_DIR"] = tempfile.mkdtemp(prefix="axf-ai-test-")
sys.path.insert(0, str(SERVER_DIR))  # plugin_services lives next to the console's main.py

import plugin_services  # noqa: E402

CALLS: list[dict] = []


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):  # noqa: ANN002
        pass

    def _json(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):  # noqa: N802
        if self.path.startswith("/oa/models"):
            return self._json({"data": [{"id": "fake-1"}, {"id": "fake-2"}]})
        if self.path.startswith("/an/v1/models"):
            return self._json({"data": [{"id": "claude-test"}]})
        self._json({"error": {"message": "nope"}}, 404)

    def do_POST(self):  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        CALLS.append({"path": self.path, "body": body, "auth": self.headers.get("authorization") or self.headers.get("x-api-key")})
        if self.path.startswith("/broken"):
            return self._json({"error": {"message": "boom"}}, 500)
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        w = lambda s: (self.wfile.write(s.encode()), self.wfile.flush())  # noqa: E731
        if self.path.startswith("/oa/chat/completions"):
            msgs = body["messages"]
            if body.get("tools") and not any(m["role"] == "tool" for m in msgs) and "calc" in json.dumps(msgs[-1]):
                w('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"calculator","arguments":"{\\"expr"}}]}}]}\n\n')
                w('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ession\\": \\"6*7\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n')
            else:
                last_tool = next((m["content"] for m in reversed(msgs) if m["role"] == "tool"), None)
                text = f"result {last_tool}" if last_tool else "Hello from fake"
                for part in (text[:5], text[5:]):
                    w(f'data: {json.dumps({"choices": [{"delta": {"content": part}}]})}\n\n')
                w('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n')
            w('data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7}}\n\n')
            w("data: [DONE]\n\n")
        elif self.path.startswith("/an/v1/messages"):
            assert body["system"][0]["text"]
            for ev in [{"type": "message_start", "message": {"usage": {"input_tokens": 5}}},
                       {"type": "content_block_start", "index": 0, "content_block": {"type": "text"}},
                       {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Claude says hi"}},
                       {"type": "content_block_stop", "index": 0},
                       {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 3}}]:
                w(f"event: {ev['type']}\ndata: {json.dumps(ev)}\n\n")


srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}"

import types  # noqa: E402

sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []  # as main.py does
spec = importlib.util.spec_from_file_location("axf_console_plugins.ai_assistant", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/api/plugins/ai-assistant")
c = TestClient(app)
P = "/api/plugins/ai-assistant"
ok = 0


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


def turn(cid, **body):
    r = c.post(f"{P}/conversations/{cid}/messages", json=body)
    events = []
    for block in r.text.split("\n\n"):
        lines = block.strip().split("\n")
        if len(lines) == 2:
            events.append((lines[0][7:], json.loads(lines[1][6:])))
    return events


print("ai-assistant self-test")
st = c.get(f"{P}/status").json()
check(st["needsSetup"] is True, "fresh install needs setup")
check(len(c.get(f"{P}/catalog").json()["providers"]) >= 15, "catalog lists 15+ providers")

r = c.post(f"{P}/profiles", json={"kind": "custom", "label": "Fake OA", "baseUrl": f"{BASE}/oa", "key": "sk-test-1234567890abcdefghij", "defaultModel": "fake-1"})
check(r.status_code == 200 and r.json()["profile"]["hasKey"], "create OpenAI-compatible profile with a stored key")
oa = r.json()["profile"]["id"]
check("key" not in json.dumps(c.get(f"{P}/config").json()["profiles"]).replace("hasKey", "").replace("keyEnv", "").replace("keyReady", ""), "stored key never returned")
check(c.get(f"{P}/profiles/{oa}/models").json()["models"] == ["fake-1", "fake-2"], "fetch model list")
check(c.post(f"{P}/profiles/{oa}/test", json={}).json()["ok"], "connection test")
an = c.post(f"{P}/profiles", json={"kind": "anthropic", "label": "Fake Claude", "baseUrl": f"{BASE}/an", "key": "sk-ant-test-123456789012345678", "defaultModel": "claude-test"}).json()["profile"]["id"]
check(c.get(f"{P}/profiles/{an}/models").json()["models"] == ["claude-test"], "anthropic model list")
bad = c.post(f"{P}/profiles", json={"kind": "custom", "label": "Broken", "baseUrl": f"{BASE}/broken", "key": "x" * 24, "defaultModel": "m"}).json()["profile"]["id"]

conv = c.post(f"{P}/conversations", json={}).json()["conversation"]
ev = turn(conv["id"], content="hi there", context={"view": "home"})
texts = "".join(d["text"] for e, d in ev if e == "text")
check(texts == "Hello from fake", "streamed text arrives in order")
done = [d for e, d in ev if e == "done"][0]
check(done["message"]["meta"]["usage"] == {"input": 11, "output": 7}, "usage recorded on the message")
check(CALLS[-1]["auth"] == "Bearer sk-test-1234567890abcdefghij", "bearer auth sent")

ev = turn(conv["id"], content="please calc 6*7")
tools_ev = [d for e, d in ev if e == "tool"]
check(len(tools_ev) == 2 and tools_ev[1]["preview"] == "42", "tool round: calculator called and returned 42")
check("result 42" in "".join(d["text"] for e, d in ev if e == "text"), "model answered with the tool result")

ev = turn(conv["id"], regenerate=True)
check(any(e == "done" for e, _ in ev), "regenerate last reply")
cv = c.get(f"{P}/conversations/{conv['id']}").json()["conversation"]
users = [m for m in cv["messages"] if m["role"] == "user"]
check(len(users) == 2, "regenerate did not add a user message")
ev = turn(conv["id"], content="hi again", editMessageId=users[1]["id"])
cv = c.get(f"{P}/conversations/{conv['id']}").json()["conversation"]
check([m["content"] for m in cv["messages"] if m["role"] == "user"] == ["hi there", "hi again"], "edit-and-resend replaces the message and what followed")

ev = turn(conv["id"], content="my key is sk-proj-abcdefghijklmnopqrstuvwxyz123456")
check(any("[redacted secret]" in json.dumps(x["body"]) for x in CALLS[-3:]), "secrets redacted before leaving the console")

c.patch(f"{P}/conversations/{conv['id']}", json={"settings": {"profileId": an}})
ev = turn(conv["id"], content="switch provider")
check("Claude says hi" in "".join(d["text"] for e, d in ev if e == "text"), "per-conversation provider (Anthropic) streams")

c.put(f"{P}/config", json={"fallback": [oa], "defaultProfile": bad})
c2 = c.post(f"{P}/conversations", json={}).json()["conversation"]
ev = turn(c2["id"], content="fallback please")
check(any(e == "status" and "failed" in d["text"] for e, d in ev) and "Hello from fake" in "".join(d["text"] for e, d in ev if e == "text"), "falls back to the next profile when one fails")
c.put(f"{P}/config", json={"fallback": [], "defaultProfile": oa})

f = c.post(f"{P}/conversations/{conv['id']}/fork", json={"messageId": cv["messages"][1]["id"]}).json()["conversation"]
check(len(f["messages"]) == 2, "fork from a message")
md = c.get(f"{P}/conversations/{conv['id']}/export?format=md").text
check(md.startswith("# ") and "## You" in md, "export Markdown")
js = c.get(f"{P}/conversations/{conv['id']}/export?format=json").json()
imp = c.post(f"{P}/conversations/import", json=js).json()["conversation"]
check(len(imp["messages"]) == len(js["messages"]), "import an exported conversation")
check(len(c.get(f"{P}/conversations", params={"q": "again"}).json()["items"]) >= 1, "search conversations")


class FakeAgents:
    recorded: list = []

    def list_agents(self):
        return [{"id": "coder", "name": "Coder", "icon": "code"}]

    def get_agent(self, aid):
        return {"id": aid, "name": "Coder", "icon": "code", "system_prompt": "You are Coder, an expert engineer.", "model": {"temperature": 0.1},
                "tools": [{"name": "agent_ping", "description": "ping", "parameters": {"type": "object", "properties": {}}}]} if aid == "coder" else None

    def memory_context(self, aid, query):
        return "- Brett prefers TypeScript strict mode"

    def run_tool(self, aid, name, args, ctx):
        return "pong"

    def record_turn(self, aid, u, a, meta):
        self.recorded.append((aid, u, a))


st = c.get(f"{P}/status").json()
check(st["integrations"]["agents"] is False, "no agent manager → integration off")
fa = FakeAgents()
plugin_services.provide("axf.agents@1", fa, "fake-agent-manager")
st = c.get(f"{P}/status").json()
check(st["integrations"]["agents"] and st["agents"][0]["id"] == "coder", "agent manager present → agents listed")
c3 = c.post(f"{P}/conversations", json={"settings": {"agentId": "coder"}}).json()["conversation"]
ev = turn(c3["id"], content="hello coder")
sent = next(x["body"] for x in reversed(CALLS) if "hello coder" in json.dumps(x["body"]) and x["body"].get("tools"))  # skip the auto-title call
check("You are Coder" in sent["messages"][0]["content"] and "TypeScript strict" in sent["messages"][0]["content"], "agent prompt + memory injected")
check(any(t["function"]["name"] == "agent_ping" for t in sent["tools"]) and sent["temperature"] == 0.1, "agent tools + model params applied")
check(fa.recorded and fa.recorded[-1][0] == "coder", "turn recorded to agent memory")
check([d for e, d in ev if e == "start"][0]["agent"]["name"] == "Coder", "start event names the agent")
plugin_services.withdraw("fake-agent-manager")

r = c.post(f"{P}/compare", json={"prompt": "hi", "targets": [{"profileId": oa}, {"profileId": an}]}).json()
check(all(x["ok"] for x in r["results"]) and r["results"][1]["text"] == "Claude says hi", "compare two providers side by side")
u = c.get(f"{P}/usage").json()
check(u["today"]["calls"] >= 8, "usage counted per day")
llm = plugin_services.get("axf.llm@1")
out = llm.complete([{"role": "user", "content": "hi"}], profile=oa)
check(out["text"] == "Hello from fake", "axf.llm@1 service completes for other plugins")
c.put(f"{P}/config", json={"dailyTokenBudget": 1})
ev = turn(conv["id"], content="over budget?")
check(any(e == "error" and "budget" in d["message"] for e, d in ev), "daily token budget enforced")
check(c.delete(f"{P}/profiles/{bad}").status_code == 200, "delete profile")
# --- regression checks from the security review
import time as _t  # noqa: E402
safety = sys.modules["axf_console_plugins.ai_assistant.safety"]
tools_mod = sys.modules["axf_console_plugins.ai_assistant.tools"]
for bomb in ("((9**999)**999)**999", "2**" * 60 + "2", "9**9**9**9", "(10**4000)*(10**4000)"):
    t0 = _t.monotonic()
    try:
        safety.calc(bomb)
        res = "ok"
    except ValueError:
        res = "refused"
    check(_t.monotonic() - t0 < 1, f"calculator bomb {bomb[:24]}… returns fast ({res})")
check(safety.calc("2**10 + 3*(4-1)") == "1033", "calculator still does arithmetic")
t0 = _t.monotonic()
tools_mod.repo_search("(a+)+$", "apps/console-web/plugins/ai-assistant")
check(_t.monotonic() - t0 < 5, "repo search is literal (no ReDoS)")
for u in ("http://127.0.0.1:1/", "http://localhost/", "http://169.254.169.254/latest/", "http://[::1]/", "http://100.64.0.1/"):
    try:
        tools_mod.web_fetch(u)
        check(False, f"web_fetch refuses {u}")
    except ValueError:
        check(True, f"web_fetch refuses {u}")
r = c.post(f"{P}/profiles", json={"kind": "custom", "label": "Hdr", "baseUrl": f"{BASE}/oa", "key": "k" * 24, "headers": {"x-goog-api-key": "supersecret"}}).json()["profile"]
check(r["headers"]["x-goog-api-key"] != "supersecret" and "supersecret" not in c.get(f"{P}/config").text, "custom header values are masked in the browser")
c.post(f"{P}/profiles", json={"id": r["id"], "kind": "custom", "headers": r["headers"]})
check(sys.modules["axf_console_plugins.ai_assistant.store"].load_config()["profiles"][r["id"]]["headers"]["x-goog-api-key"] == "supersecret", "saving masked headers keeps the stored value")
c.put(f"{P}/config", json={"dailyTokenBudget": 0})
CALLS.clear()
list(sys.modules["axf_console_plugins.ai_assistant.providers"].stream_chat({"kind": "anthropic", "baseUrl": f"{BASE}/an", "key": "x" * 30}, [{"role": "user", "content": "hi"}], system="s", model="m", params={"thinking": True, "max_tokens": 4096, "thinking_budget": 4096}))
b = CALLS[-1]["body"]
check(b["thinking"]["budget_tokens"] < b["max_tokens"], "thinking budget stays below max_tokens")
print(f"all {ok} checks passed")
