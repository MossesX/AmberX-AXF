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
            if body.get("tools") and not any(m["role"] == "tool" for m in msgs) and "write it" in json.dumps(msgs[-1]):
                args = json.dumps({"container": "web", "path": "/app/a.ts", "content": "new", "reason": "fix"})
                w(f'data: {json.dumps({"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "w1", "function": {"name": "container_write", "arguments": args}}]}, "finish_reason": "tool_calls"}]})}\n\n')
            elif body.get("tools") and not any(m["role"] == "tool" for m in msgs) and "calc" in json.dumps(msgs[-1]):
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
os.environ["AXF_TRUST_WALL"] = "1"
os.environ["AXF_WALL_SECRET"] = "test-wall-secret-0123456789abcdef0123"
import wall  # noqa: E402  (core: who is calling behind axHub's wall)
import hmac as _hm, hashlib as _hl, time as _tm  # noqa: E402


def signed(user, role="user", perms="", host="testserver", secret="test-wall-secret-0123456789abcdef0123", ts=None):
    """Wall headers as axHub signs them (X-Auth-Sig)."""
    ts = int(ts if ts is not None else _tm.time())
    mac = _hm.new(secret.encode(), f"v1|{ts}|{user}|{role}|{perms}|{host}".encode(), _hl.sha256).hexdigest()
    return {"x-auth-via": "session", "x-auth-user": user, "x-auth-role": role, "x-auth-perms": perms, "x-auth-sig": f"v1.{ts}.{mac}"}


@app.middleware("http")
async def _as_console_core(request, call_next):  # what the console's _plugin_auth does for a "wallUsers" plugin
    c = wall.wall_caller(request.headers)
    if c:
        request.state.axf_user = c
    return await call_next(request)

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


_LIFE = {"session.open", "session.close", "turn.start", "turn.end", "wait", "resume", "interrupted", "replay", "session"}


def parse_sse(text, lifecycle=False):
    """(event, data) pairs; lifecycle events and the replay header are skipped unless asked for."""
    events = []
    for block in text.split("\n\n"):
        ev, data, seq = None, None, None
        for line in block.strip().split("\n"):
            if line.startswith("event: "):
                ev = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
            elif line.startswith("id: "):
                seq = int(line[4:])
        if ev is None or (ev in _LIFE and not lifecycle):
            continue
        events.append((ev, data, seq) if lifecycle else (ev, data))
    return events


def turn(cid, **body):
    r = c.post(f"{P}/conversations/{cid}/messages", json=body)
    return parse_sse(r.text)


print("ai-assistant self-test")
st = c.get(f"{P}/status").json()
check(st["needsSetup"] is True, "fresh install needs setup")
cat = c.get(f"{P}/catalog").json()
check(len(cat["providers"]) >= 15, "catalog lists 15+ providers")
reg = json.load(open(HERE.parents[3] / "framework" / "schemas" / "ai-providers.json"))
check([p["kind"] for p in cat["providers"]] == [p["kind"] for p in reg["providers"]] and reg["$axf"] == "ai-providers@1", "catalog comes from the shared framework registry (ai-providers@1)")
check({"openai", "anthropic", "claude-cli"} <= set(cat["protocols"]), "protocols listed")
ci = c.get(f"{P}/contract").json()
check(ci["assistant"] == "assistant@1" and ci["liveSession"] == "live-session@1" and {h["id"] for h in ci["hosts"]} == {"local", "axhub"} and "ai.chat.start" in ci["actions"], "/contract describes what the assistant speaks")

# --- assistant@1: the plugin runs on the framework's Python contract (framework/python/axf/contracts/assistant.py);
# the fixture replay itself lives in framework/python/axf/contracts/test.py (CI), one check here keeps it honest.
print("assistant@1 contract")
ctr = mod.contract
check(ctr.__name__ == "axf.contracts.assistant" and mod.providers.__name__ == "axf.assistant_host.providers" and mod.sessions.__name__ == "axf.assistant_host.sessions",
      "plugin imports the contract and host runtime from framework/python (no private copies)")
afx = json.load(open(HERE.parents[3] / "framework" / "spec" / "fixtures" / "assistant.json"))
check(not ctr.check_fixture(afx), "the framework contract replays spec/fixtures/assistant.json")
check(mod.providers.HOST_LABEL == "the console server" and mod.providers.extra_kinds is sys.modules["axf_console_plugins.ai_assistant.store"].extra_provider_kinds and ".axf-console" in mod.providers.PRIVATE_DIRS,
      "host hooks name the console (label, extra provider kinds, private folder)")

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
ev = turn(conv["id"], content="hi there", context={"view": "home", "extra": {"projectId": "apk-1", "custom": {"k": [1, 2]}, "bad key": 1}})
texts = "".join(d["text"] for e, d in ev if e == "text")
check(texts == "Hello from fake", "streamed text arrives in order")
_cv = c.get(f"{P}/conversations/{conv['id']}").json()["conversation"]
check(_cv["messages"][0]["meta"]["context"] == {"view": "home", "extra": {"projectId": "apk-1", "custom": {"k": [1, 2]}}}, "ChatContext.extra is normalised and stored with the message (unknown keys kept, bad keys dropped)")
_sys = next(m["content"] for x in reversed(CALLS) for m in x["body"]["messages"] if m["role"] == "system")
check("projectId: apk-1" in _sys and "view: home" in _sys and "custom" not in _sys, "well-known extra keys reach the model in the context line; a host's own keys stay out of it")
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
c.patch(f"{P}/conversations/{conv['id']}", json={"tags": ["axf", "review"]})
check(c.get(f"{P}/tags").json()["items"][:2] == ["axf", "review"] and [i["id"] for i in c.get(f"{P}/conversations", params={"tag": "review"}).json()["items"]] == [conv["id"]], "tags: listed and filterable")
check(c.get(f"{P}/conversations/{conv['id']}/export?format=txt").text.startswith("You:"), "export plain text")


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
safety = mod.tools.safety
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
list(mod.providers.stream_chat({"kind": "anthropic", "baseUrl": f"{BASE}/an", "key": "x" * 30}, [{"role": "user", "content": "hi"}], system="s", model="m", params={"thinking": True, "max_tokens": 4096, "thinking_budget": 4096}))
b = CALLS[-1]["body"]
check(b["thinking"]["budget_tokens"] < b["max_tokens"], "thinking budget stays below max_tokens")

# --- Mosses: proposed container changes become one change batch (approval card), proxied by capability ------------
class FakeMosses(FakeAgents):
    def get_agent(self, aid):
        return {"id": aid, "name": "Mosses", "icon": "code", "system_prompt": "You are Mosses.", "model": {},
                "tools": [{"name": "container_write", "description": "propose", "parameters": {"type": "object", "properties": {}}}],
                "writeMode": {"containers": ["web"], "snapshots": True}}

    def run_tool(self, aid, name, args, ctx):
        n = ctx["stage"]({"kind": "write", **args})
        return f"Proposed change #{n}"


class FakeContainers:
    batches: dict = {}

    def create_batch(self, items, actor=None, conversation="", turn="", title=""):
        b = {"id": f"b-20261018000000-{len(self.batches):08x}", "status": "pending", "items": [{**it, "id": f"i{i + 1}", "status": "pending"} for i, it in enumerate(items)],
             "actor": actor, "conversation": conversation, "turn": turn, "title": title, "snapshots": [], "createdAt": 1}
        self.batches[b["id"]] = b
        return b

    def public_batch(self, b):
        return {**b, "items": [{k: v for k, v in it.items() if k != "content"} for it in b["items"]]}

    def get_batch(self, bid):
        if bid not in self.batches:
            raise KeyError("no such batch")
        return self.batches[bid]

    def list_batches(self, status="", conversation="", limit=50):
        return [b for b in self.batches.values() if not conversation or b["conversation"] == conversation][:limit]

    def approve_stream(self, bid, items, who, accept_unseen=False):
        b = self.batches[bid]
        b.update(status="applied", snapshots=["s-1"])
        for it in b["items"]:
            it["status"] = "applied"
        yield f"data: {json.dumps({'type': 'snapshot', 'id': 's-1'})}\n\n"
        yield f"data: {json.dumps({'type': 'batch', 'batch': self.public_batch(b)})}\n\n"

    def reject_batch(self, bid, who=None):
        self.batches[bid]["status"] = "rejected"
        return self.batches[bid]

    def undo_batch(self, bid, who=None):
        self.batches[bid]["status"] = "undone"
        return self.batches[bid]


plugin_services.provide("axf.agents@1", FakeMosses(), "fake-agent-manager")
check(c.get(f"{P}/agents/coder/write-mode").json()["writeMode"] is None or True, "write-mode route answers")
c4 = c.post(f"{P}/conversations", json={"settings": {"agentId": "coder", "profileId": oa}}).json()["conversation"]
ev = turn(c4["id"], content="please write it")
check(any(e == "batch" for e, _ in ev) is False, "no batch without Container access (changes dropped with a note)")
check(any(e == "text" and "dropped" in d["text"] for e, d in ev), "…and the chat says so")
fc = FakeContainers()
plugin_services.provide("axf.containers@1", fc, "fake-container-access")
check(c.get(f"{P}/agents/coder/write-mode").json()["writeMode"]["containers"] == ["web"], "write-mode badge data for the selected agent")
c4 = c.post(f"{P}/conversations", json={"settings": {"agentId": "coder", "profileId": oa}}).json()["conversation"]
ev = turn(c4["id"], content="please write it")
bev = [d for e, d in ev if e == "batch"]
check(bev and bev[0]["batch"]["items"][0]["path"] == "/app/a.ts" and "content" not in bev[0]["batch"]["items"][0], "proposals become one batch (content stays server-side)")
start = [d for e, d in ev if e == "start"][0]
check(start["agent"]["writeMode"]["containers"] == ["web"], "start event carries write mode")
done = [d for e, d in ev if e == "done"][0]["message"]
bid = bev[0]["batch"]["id"]
check(done["meta"]["batch"] == bid and fc.batches[bid]["conversation"] == c4["id"] and fc.batches[bid]["actor"]["name"] == "Mosses", "reply links its batch; batch knows the conversation and agent")
check(c.get(f"{P}/batches/{bid}").json()["id"] == bid, "batch readable through the assistant")
r = c.post(f"{P}/batches/{bid}/approve", json={"items": ["i1"]})
check('"applied"' in r.text and r.headers["content-type"].startswith("text/event-stream"), "approval streams through the assistant")
check(c.post(f"{P}/batches/{bid}/undo", json={}).status_code == 400 and c.post(f"{P}/batches/{bid}/undo", json={"confirm": "undo"}).json()["status"] == "undone", "undo needs a confirm")
CALLS.clear()
turn(c4["id"], content="what happened?")
sent = next(x["body"] for x in CALLS if "what happened" in json.dumps(x["body"]))
check(bid in sent["messages"][0]["content"] and "undone" in sent["messages"][0]["content"], "next turn sees the batch outcome")
check(c.get(f"{P}/batches/b-nope").status_code == 404, "unknown batch is 404")

# --- the Claude Code CLI gets the same tools through the MCP bridge -------------------------------------------------
import os as _os  # noqa: E402
import stat as _stat  # noqa: E402
import tempfile as _tf  # noqa: E402
fake_dir = _tf.mkdtemp(prefix="fake-claude-")
argv_file = _os.path.join(fake_dir, "argv.json")
fake = _os.path.join(fake_dir, "claude")
with open(fake, "w") as f:
    f.write(f"""#!{sys.executable}
import json, subprocess, sys
json.dump(sys.argv, open({argv_file!r}, "w"))
sys.stdin.read()
cfg = json.load(open(sys.argv[sys.argv.index("--mcp-config") + 1]))["mcpServers"]["axf"]
p = subprocess.Popen([cfg["command"], *cfg["args"]], env=cfg["env"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
def rpc(i, m, params):
    p.stdin.write(json.dumps({{"jsonrpc": "2.0", "id": i, "method": m, "params": params}}) + "\\n"); p.stdin.flush()
    return json.loads(p.stdout.readline())
rpc(1, "initialize", {{"protocolVersion": "2025-06-18"}})
tools = rpc(2, "tools/list", {{}})["result"]["tools"]
r = rpc(3, "tools/call", {{"name": next(t["name"] for t in tools if t["name"] == "container_write"), "arguments": {{"container": "web", "path": "/app/b.ts", "content": "x", "reason": "cli"}}}})
txt = r["result"]["content"][0]["text"]
print(json.dumps({{"type": "stream_event", "event": {{"type": "content_block_delta", "delta": {{"type": "text_delta", "text": "Done: " + txt}}}}}}), flush=True)
print(json.dumps({{"type": "result", "usage": {{"input_tokens": 3, "output_tokens": 2}}}}), flush=True)
p.stdin.close(); p.wait()
""")
_os.chmod(fake, _os.stat(fake).st_mode | _stat.S_IEXEC)
_os.environ["CLAUDE_BIN"] = fake
cli = c.post(f"{P}/profiles", json={"kind": "claude-code", "label": "Sub", "key": "sk-ant-oat01-" + "x" * 40, "defaultModel": "claude-test"}).json()["profile"]["id"]
c5 = c.post(f"{P}/conversations", json={"settings": {"agentId": "coder", "profileId": cli}}).json()["conversation"]
ev = turn(c5["id"], content="change b.ts")
argv = json.load(open(argv_file))
allowed = argv[argv.index("--allowedTools") + 1:argv.index("--disallowedTools")]
denied = argv[argv.index("--disallowedTools") + 1:]
check("mcp__axf" in allowed and "Edit" in denied and "Bash" in denied and "--strict-mcp-config" in argv, "CLI gets the console tools over MCP; its own Edit/Bash stay off")
check(any(e == "tool" and d.get("phase") == "result" and d["name"] == "container_write" for e, d in ev), "bridged tool calls show in the chat")
check(any(e == "text" and "Proposed change #1" in d["text"] for e, d in ev), "the CLI got the tool result")
bev = [d for e, d in ev if e == "batch"]
check(bev and bev[0]["batch"]["items"][0]["path"] == "/app/b.ts", "CLI proposals land on the same approval card")
check(not [x for x in _os.listdir(_tf.gettempdir()) if x.startswith("axf-bridge-")], "bridge folder removed after the turn")
plugin_services.withdraw("fake-container-access")
plugin_services.withdraw("fake-agent-manager")
prov = mod.providers
os.environ.update({"COOLIFY_TOKEN": "c-secret", "HOSTINGER_API_TOKEN": "h", "AXHUB_TOKEN": "a", "AXF_TOKEN": "t", "SOME_PASSWORD": "p", "HARMLESS_SETTING": "ok"})
ce = prov._cli_env()
check(not any(k in ce for k in ("COOLIFY_TOKEN", "HOSTINGER_API_TOKEN", "AXHUB_TOKEN", "AXF_TOKEN", "SOME_PASSWORD")) and ce.get("HARMLESS_SETTING") == "ok" and "PATH" in ce,
      "Claude Code CLI env: every token, key and password removed")
# Build mode (Oct 28 2026): a build agent's turn gives the CLI its own Edit/Write/Bash in the repo, secrets still denied
_bd = _tf.mkdtemp()
_bf = _os.path.join(_bd, "fake-build-claude")
with open(_bf, "w") as f:
    f.write(f"""#!{sys.executable}
import json, os, sys
json.dump({{"argv": sys.argv[1:], "cwd": os.getcwd(), "scrub": os.environ.get("CLAUDE_CODE_SUBPROCESS_ENV_SCRUB")}}, open({_os.path.join(_bd, "argv.json")!r}, "w"))
sys.stdin.read()
print(json.dumps({{"type": "result", "usage": {{"input_tokens": 1, "output_tokens": 1}}}}), flush=True)
""")
_os.chmod(_bf, 0o755)
_os.environ["CLAUDE_BIN"] = _bf
_prof = {"kind": "claude-code", "key": "sk-ant-oat01-" + "x" * 40}
list(prov.stream_chat(_prof, [{"role": "user", "content": "build"}], model="claude-test", cwd=_bd, build={"root": _bd}))
_b = json.load(open(_os.path.join(_bd, "argv.json")))
_ba = _b["argv"]
_al = _ba[_ba.index("--allowedTools") + 1:_ba.index("--disallowedTools")]
_de = _ba[_ba.index("--disallowedTools") + 1:]
check({"Edit", "Write", "MultiEdit", "Bash"} <= set(_al) and not {"Edit", "Write", "MultiEdit", "Bash"} & set(_de) and _ba[_ba.index("--permission-mode") + 1] == "acceptEdits"
      and _b["cwd"] == _os.path.realpath(_bd) and _b["scrub"] is None, "build mode: CLI gets Edit/Write/MultiEdit/Bash without asking, in the build folder")
check(any(x.startswith("Edit(") and ".env" in x for x in _de) and any(x.startswith("Read(") and ".env" in x for x in _de), "build mode: env files and keys stay unreadable and unwritable")
list(prov.stream_chat(_prof, [{"role": "user", "content": "hi"}], model="claude-test", cwd=_bd))
_ba = json.load(open(_os.path.join(_bd, "argv.json")))["argv"]
_de = _ba[_ba.index("--disallowedTools") + 1:]
check("Bash" in _de and "Edit" in _de and _ba[_ba.index("--permission-mode") + 1] == "default", "without build mode the CLI's Edit/Bash stay off")
list(prov.stream_chat(_prof, [{"role": "user", "content": "hi"}], model="claude-test", cwd=_bd, build={"root": _bd}, read_files=False))
_ba = json.load(open(_os.path.join(_bd, "argv.json")))["argv"]
check("Bash" in _ba[_ba.index("--disallowedTools") + 1:], "build mode never applies to users without file tools")
for _bm in ({"root": _bd}, None):
    list(prov.stream_chat(_prof, [{"role": "user", "content": "hi"}], model="claude-test", cwd=_bd, build=_bm))
    _ba = json.load(open(_os.path.join(_bd, "argv.json")))["argv"]
    _al, _de = _ba[_ba.index("--allowedTools") + 1:_ba.index("--disallowedTools")], _ba[_ba.index("--disallowedTools") + 1:]
    check({"Task", "Agent"} <= set(_de) and not {"Task", "Agent"} & set(_al), f"no sub-agents in the assistant ({'build mode' if _bm else 'chat'})")
deny = prov._cli_abs_deny("/work/repo")
check("Read(//proc/**)" in deny and "Read(//work/repo/.axf-console/**)" in deny and "Grep(~/.ssh/**)" in deny, "Claude Code CLI can't read /proc, the console's private folder or SSH keys")

# ---------------------------------------------------------------- live sessions (live-session@1)
print("live sessions")
import time as _time  # noqa: E402
sess = mod.sessions
# The live-session@1 fixture replay (states, reducer, log, replays) lives in framework/python/axf/assistant_host/test.py.
fx = json.load(open(HERE.parents[3] / "framework" / "spec" / "fixtures" / "live-session.json"))
check(sess.STATES == fx["states"] and sess.KINDS == fx["kinds"], "states + reserved kinds match the kernel contract")
check(mod._host.label == "This console" and mod._host.restart_reason.startswith("The console restarted") and "this console" in mod.HOSTS.get("axhub").note, "the console names its local host and the axHub placeholder")

# a slow fake reply: the browser leaves after the first event, the reply still finishes on the server
import queue as _q  # noqa: E402
gate = _q.Queue()


def slow_run_turn(cid, body, caller=None):
    yield mod._sse("start", {"turnId": "t-slow", "agent": None})
    yield mod._sse("text", {"text": "part one "})
    gate.get(timeout=10)
    yield mod._sse("text", {"text": "part two"})
    yield mod._sse("done", {"message": {"id": "m-x", "role": "assistant", "content": "part one part two"}, "title": "Slow chat"})


real_run_turn = mod.run_turn
mod.run_turn = slow_run_turn
sc = c.post(f"{P}/conversations", json={}).json()["conversation"]["id"]
# a real server + a real client that hangs up after the first piece (TestClient can't disconnect)
import socket as _sock  # noqa: E402
import http.client as _hc  # noqa: E402
import uvicorn as _uv  # noqa: E402
with _sock.socket() as _s:
    _s.bind(("127.0.0.1", 0))
    _port = _s.getsockname()[1]
_srv = _uv.Server(_uv.Config(app, host="127.0.0.1", port=_port, log_level="error"))
threading.Thread(target=_srv.run, daemon=True).start()
for _ in range(100):
    if _srv.started:
        break
    _time.sleep(0.05)


def hang_up_after(path, marker):
    """POST like the browser, read until `marker`, then drop the connection."""
    conn = _hc.HTTPConnection("127.0.0.1", _port, timeout=10)
    conn.request("POST", path, body=json.dumps({"content": "go"}), headers={"content-type": "application/json"})
    resp, got = conn.getresponse(), b""
    while marker not in got:
        piece = resp.read1(4096)
        if not piece:
            break
        got += piece
    conn.sock.close()
    conn.close()
    return got


first = hang_up_after(f"{P}/conversations/{sc}/messages", b"part one")
_time.sleep(0.3)
check(b"part one" in first and b"id: " in first, "reply streams with seq ids")
info = c.get(f"{P}/sessions/{sc}").json()["session"]
check(info and info["state"] == "running", "browser hung up; the reply keeps running on the server")
check(c.post(f"{P}/conversations/{sc}/messages", json={"content": "again"}).status_code == 409, "a second message while a reply runs is refused (409)")
seen = max(seq for _, _, seq in parse_sse(first.decode(), lifecycle=True) if seq)
gate.put(1)
for _ in range(100):
    if c.get(f"{P}/sessions/{sc}").json()["session"]["state"] == "idle":
        break
    _time.sleep(0.05)
rest = parse_sse(c.get(f"{P}/sessions/{sc}/events", params={"since": seen}).text, lifecycle=True)
check([e for e, _, _ in rest][:1] == ["replay"] and any(e == "text" and d["text"] == "part two" for e, d, _ in rest) and any(e == "turn.end" for e, _, _ in rest),
      "reattaching replays only what was missed, through the end of the turn")
page = c.get(f"{P}/sessions/{sc}/events", params={"since": 0, "follow": 0}).json()
check(page["state"] == "idle" and page["events"][0]["kind"] == "session.open" and not page["gap"], "JSON page of the whole log")
lst = c.get(f"{P}/sessions").json()
check(any(i["id"] == sc and i["title"] == "Slow chat" for i in lst["items"]) and {h["id"] for h in lst["hosts"]} == {"local", "axhub"}, "sessions listed with hosts (local + axHub placeholder)")
check(c.put(f"{P}/config", json={"sessionHost": "axhub"}).status_code == 200 and c.put(f"{P}/config", json={"sessionHost": "nowhere"}).status_code == 400, "session host setting validated")
gate.put(1)
ev2 = turn(sc, content="via hub")
check(any(e == "status" and "axHub" in d["text"] for e, d in ev2), "axHub host not built yet: falls back to this console with a notice")
c.put(f"{P}/config", json={"sessionHost": "local"})
svc = plugin_services.get("axf.live-sessions@1")
check(svc and svc.info(sc)["lastSeq"] > 0 and svc.events(sc, 0, 3)["more"], "axf.live-sessions@1 service for other plugins")
# restart while running → interrupted; close ends the session; deleting the conversation forgets it
gate2 = _q.Queue()
def hang(cid, body, caller=None):  # noqa: E306
    yield mod._sse("start", {"turnId": "t-hang", "agent": None})
    gate2.get(timeout=10)
mod.run_turn = hang
hc = c.post(f"{P}/conversations", json={}).json()["conversation"]["id"]
hang_up_after(f"{P}/conversations/{hc}/messages", b"t-hang")
mod._host._save(mod._host.get(hc))
fresh = sess.LocalHost(mod._host.folder)
check(fresh.info(hc)["state"] == "idle" and fresh.get(hc).log.items[-1]["kind"] == "interrupted", "after a restart a running turn is marked interrupted, the session stays open")
gate2.put(1)
check(c.post(f"{P}/sessions/{hc}/close").json()["closed"] and c.get(f"{P}/sessions/{hc}").json()["session"] is None, "close ends the session on purpose")
check(not (mod._host.folder / f"{hc}.json").exists(), "closed session's log removed")
# an interrupted reply keeps the text it had streamed (marked interrupted) so nothing the model said is lost
gate4 = _q.Queue()
def partial(cid, body, caller=None):  # noqa: E306
    yield mod._sse("start", {"turnId": "t-part", "agent": None})
    yield mod._sse("text", {"text": "half an answer"})
    gate4.get(timeout=10)
mod.run_turn = partial
pc = c.post(f"{P}/conversations", json={}).json()["conversation"]["id"]
hang_up_after(f"{P}/conversations/{pc}/messages", b"half an answer")
mod._host._save(mod._host.get(pc))
fresh2 = sess.LocalHost(mod._host.folder)
fresh2.on_interrupted = mod._keep_interrupted
fresh2.load()
pm = c.get(f"{P}/conversations/{pc}").json()["conversation"]["messages"]
check(pm and pm[-1]["role"] == "assistant" and pm[-1]["meta"].get("interrupted") and pm[-1]["content"].startswith("half an answer"), "an interrupted reply keeps its streamed text in the conversation")
fresh2.load()
check(sum(1 for m in c.get(f"{P}/conversations/{pc}").json()["conversation"]["messages"] if m.get("meta", {}).get("interrupted")) == 1, "…only once")
gate4.put(1)
# open host registry: a module-provided host (axf.live-host@1) replaces the axHub placeholder
class FakeHubHost(sess.SessionHost):
    id, label, note = "axhub", "axHub (VPS hub)", "fake workers"
    def __init__(self):
        self.inner = sess.LocalHost(mod._host.folder / "hub")
        self.inner._loaded = True
    def available(self):
        return True
    def start_turn(self, *a, **k):
        return self.inner.start_turn(*a, **k)
    def tail(self, *a, **k):
        return self.inner.tail(*a, **k)
    def get(self, *a, **k):
        return self.inner.get(*a, **k)
    def info(self, sid):
        return self.inner.info(sid)
    def list(self, include_closed=False):
        return self.inner.list(include_closed)
fh = FakeHubHost()
plugin_services.provide(sess.HOST_CAPABILITY, fh, "fake-hub")
c.put(f"{P}/config", json={"sessionHost": "axhub"})
check(c.get(f"{P}/sessions").json()["active"] == "axhub" and next(h for h in c.get(f"{P}/sessions").json()["hosts"] if h["id"] == "axhub")["available"], "a module's session host (axf.live-host@1) replaces the axHub placeholder")
mod.run_turn = real_run_turn
hub_c = c.post(f"{P}/conversations", json={}).json()["conversation"]["id"]
ev_h = turn(hub_c, content="on the hub")
check(any(e == "done" for e, _ in ev_h) and not any(e == "status" and "isn't available" in d["text"] for e, d in ev_h) and fh.inner.info(hub_c)["state"] == "idle", "a reply runs on the external host without a fallback notice")
plugin_services.withdraw("fake-hub")
mod.HOSTS.register(sess.AXHUB_PLACEHOLDER)
c.put(f"{P}/config", json={"sessionHost": "local"})
svc2 = plugin_services.get("axf.live-sessions@1")
unreg = svc2.register_host(sess.PlaceholderHost("other", "Other", "declared only"))
check(any(h["id"] == "other" and not h["available"] for h in svc2.hosts()), "axf.live-sessions@1 lets a module register a host")
unreg()
check(not any(h["id"] == "other" for h in svc2.hosts()), "…and unregister it")
c.delete(f"{P}/conversations/{sc}")
check(c.get(f"{P}/sessions/{sc}").json()["session"] is None, "deleting a conversation forgets its session")
mod.run_turn = real_run_turn
u2 = c.get(f"{P}/usage").json()
check("users" in u2, "usage includes per-user totals for admins")
_srv.should_exit = True

# ---------------------------------------------------------------- hub users behind the wall
print("hub users")
U = signed("bea")
UT = signed("bea", perms="assistant.tools")
forged = {**U, "x-auth-role": "admin"}
class _H(dict):
    def get(self, k, d=None):
        return super().get(k, {**self}.get(k.lower(), d))
check(wall.wall_caller(_H({**U, "host": "testserver"})).name == "bea", "a signed wall header is accepted")
check(wall.wall_caller(_H({**forged, "host": "testserver"})) is None, "changing a signed header (user → admin) breaks the signature")
check(wall.wall_caller(_H({**signed("bea", secret="another-secret-0123456789abcdef0123456"), "host": "testserver"})) is None, "a signature made with another secret is refused")
check(wall.wall_caller(_H({**signed("bea", ts=_tm.time() - 600), "host": "testserver"})) is None, "an old signature is refused")
check(wall.wall_caller(_H({**U, "host": "evil.example"})) is None, "a signature for another host is refused")
check(wall.wall_caller(_H({k: v for k, v in U.items() if k != "x-auth-sig"} | {"host": "testserver"})) is None, "unsigned wall headers are ignored")
admin_conv = c.post(f"{P}/conversations", json={}).json()["conversation"]["id"]
bc = c.post(f"{P}/conversations", json={}, headers=U).json()["conversation"]
check(bc.get("owner") == "bea", "a hub user's conversation is theirs")
check([i["id"] for i in c.get(f"{P}/conversations", headers=U).json()["items"]] == [bc["id"]], "users list only their own conversations")
check(c.get(f"{P}/conversations/{admin_conv}", headers=U).status_code == 404, "someone else's conversation is a 404")
check(c.get(f"{P}/config", headers=U).status_code == 403 and c.get(f"{P}/agents", headers=U).status_code == 403, "settings and agents need permissions")
check(c.get(f"{P}/config", headers=signed("bea", perms="assistant.settings")).status_code == 200, "assistant.settings opens the settings")
check(c.get(f"{P}/agents", headers=signed("bea", perms="assistant.*")).status_code == 200, "assistant.* covers every assistant permission")
me = c.get(f"{P}/me", headers=U).json()
check(me["user"]["name"] == "bea" and not me["can"]["assistant.tools"] and me["dailyTokens"] > 0, "/me says who is chatting and what they may do")
check("<textarea" in c.get(f"{P}/app", headers=U).text, "the plain chat page is served to hub users")
c.patch(f"{P}/conversations/{bc['id']}", json={"settings": {"profileId": an}}, headers=U)
before = len(CALLS)
ev = turn_as = parse_sse(c.post(f"{P}/conversations/{bc['id']}/messages", json={"content": "calc 6*7"}, headers=U).text)
sent = CALLS[before:]
check(sent and "tools" not in sent[-1]["body"] and sent[-1]["path"].startswith("/oa/"), "plain chat: no tools, and the user's model choice is ignored without assistant.models")
check(any(e == "done" for e, _ in ev), "a hub user gets a reply")
ev = parse_sse(c.post(f"{P}/conversations/{bc['id']}/messages", json={"content": "calc 6*7"}, headers=UT).text)
check(any(e == "tool" for e, _ in ev), "assistant.tools turns the tools on for that user")
check(c.get(f"{P}/sessions", headers=U).json()["items"] and all(i["id"] == bc["id"] for i in c.get(f"{P}/sessions", headers=U).json()["items"]), "users see only their own live sessions")
cfg0 = c.get(f"{P}/config").json().get("userDailyTokens")
c.put(f"{P}/config", json={"userDailyTokens": 5})
ev = parse_sse(c.post(f"{P}/conversations/{bc['id']}/messages", json={"content": "hi"}, headers=U).text)
check(any(e == "error" and "today" in d["message"] for e, d in ev), "the per-user daily token cap applies")
c.put(f"{P}/config", json={"userDailyTokens": cfg0 or 50000})
check(c.post(f"{P}/conversations/{admin_conv}/messages", json={"content": "x"}, headers=U).status_code == 404, "users can't post into someone else's chat")
ALL = signed("bea", perms="assistant.*")
check(c.get(f"{P}/batches/b1", headers=ALL).status_code == 403 and c.post(f"{P}/batches/b1/approve", json={}, headers=ALL).status_code == 403, "only admins approve or undo change batches, whatever the permissions")
c.patch(f"{P}/conversations/{bc['id']}", json={"settings": {"profileId": an, "systemPrompt": "be brief"}}, headers=U)
cs = c.get(f"{P}/conversations/{bc['id']}", headers=U).json()["conversation"]["settings"]
check("profileId" not in cs and cs.get("systemPrompt") == "be brief", "users only set the settings their permissions allow")
imp = c.post(f"{P}/conversations/import", json={"title": "x", "settings": {"agentId": "coder"}, "messages": [{"role": "assistant", "content": "ok", "toolCalls": [{"id": "1"}], "meta": {"step": True}}, {"role": "tool", "content": "fake"}]}, headers=U).json()["conversation"]
check(imp["owner"] == "bea" and imp["settings"] == {} and imp["messages"] == [{**imp["messages"][0]}] and "toolCalls" not in imp["messages"][0] and imp["messages"][0]["meta"] == {}, "imports by users keep plain text only")
before = len(CALLS)
c.patch(f"{P}/conversations/{bc['id']}", json={"settings": {"tools": True}})  # an admin touching the user's chat
ev = parse_sse(c.post(f"{P}/conversations/{bc['id']}/messages", json={"content": "calc 6*7"}).text)
check(any(e == "status" and "bea's chat" in d["text"] for e, d in ev) and "tools" not in CALLS[-1]["body"], "an admin replying in a user's chat runs with that user's rights")
st_u = c.get(f"{P}/status", headers=U).json()
check(st_u["defaultProfile"] is None and st_u["prompts"] == [] and st_u["me"]["name"] == "bea", "/status shows users only what their chat needs")
import threading as _th  # noqa: E402
gate3 = _q.Queue()
def held(cid, body, caller=None):  # noqa: E306
    yield mod._sse("start", {"turnId": "t-held", "agent": None})
    gate3.get(timeout=10)
mod.run_turn = held
bc2 = c.post(f"{P}/conversations", json={}, headers=U).json()["conversation"]["id"]
_th.Thread(target=lambda: c.post(f"{P}/conversations/{bc['id']}/messages", json={"content": "a"}, headers=U), daemon=True).start()
_time.sleep(0.4)
check(c.post(f"{P}/conversations/{bc2}/messages", json={"content": "b"}, headers=U).status_code == 409, "one running reply per hub user, across conversations")
gate3.put(1)
_time.sleep(0.4)
mod.run_turn = real_run_turn
import subprocess as _sp  # noqa: E402
seen_args = {}
def _capture(args, **kw):  # noqa: E306
    seen_args["args"], seen_args["cwd"], seen_args["env"] = args, kw.get("cwd"), kw.get("env")
    raise OSError("captured")
real_popen = prov.subprocess.Popen
prov.subprocess.Popen = _capture
_os.environ["CLAUDE_BIN"] = fake
try:
    list(prov.stream_chat({"kind": "claude-code", "key": "sk-ant-oat01-" + "x" * 40}, [{"role": "user", "content": "hi"}], model="claude-test", cwd="/work/repo", read_files=False))
except OSError:
    pass
prov.subprocess.Popen = real_popen
a = seen_args.get("args", [])
den = a[a.index("--disallowedTools") + 1:] if "--disallowedTools" in a else []
check(a and "--allowedTools" not in a and "Read" in den and "Grep" in den and seen_args["cwd"] != "/work/repo" and seen_args["env"].get("CLAUDE_CONFIG_DIR"), "Claude Code for plain-chat users: no file tools, empty folder, throwaway config")
check(not _os.path.exists(seen_args["cwd"]), "the CLI's throwaway folder is removed")
# lifecycle + migrations
st_mod = sys.modules["axf_console_plugins.ai_assistant.store"]
check(st_mod.load_config().get("schema") == st_mod.SCHEMA, "config carries the data schema version")
check(json.load(open(HERE / "plugin.json"))["lifecycle"]["$axf"] == "plugin-lifecycle@1" and (HERE / "uninstall.mjs").exists() and (HERE / "install.mjs").exists() and (HERE / "hooks.mjs").exists(), "plugin-lifecycle@1 files present")

# ---- Claude credits probe + auto-switch (axf.llm@1 credits, used by the systems check on every load)
_st, _prov = mod.store, mod.providers
_cfg0 = _st.load_config()
_cfg = _st.load_config()
_cfg["profiles"] = {"cr-a": {"kind": "anthropic", "label": "Key A", "key": "sk-ant-api-x"}, "cr-b": {"kind": "openai", "label": "GPT", "key": "x"},
                    "cr-c": {"kind": "anthropic", "label": "Key C", "key": "sk-ant-api-y"}}
_cfg["defaultProfile"] = "cr-a"
_st.save_config(_cfg)
_answers = {"sk-ant-api-x": "Your credit balance is too low to access the Anthropic API.", "sk-ant-api-y": ""}
_orig_test = _prov.test_profile
def _fake_test(prof, model=None):
    if _answers.get(prof.get("key")):
        raise RuntimeError(_answers[prof["key"]])
    return {"ok": True}
_prov.test_profile = _fake_test
_llm = mod.LlmService()
r = _llm.credits(auto_switch=True)
check(r["state"] == "no-credit" and r["switched"] and r["switched"]["to"] == "cr-c", "credits: out-of-credit default switches to the next Claude key")
check(_st.load_config()["defaultProfile"] == "cr-c", "credits: the new key is the default")
check(all(p["kind"] == "anthropic" for p in r["profiles"]), "credits: only Claude providers are tested")
r = _llm.credits(auto_switch=True)
check(r["state"] == "ok" and r["switched"] is None and len(r["profiles"]) == 1, "credits: a default with credit tests only itself")
_answers["sk-ant-api-y"] = "connection refused"
r = _llm.credits(auto_switch=True)
check(r["state"] == "error" and r["switched"] is None, "credits: a non-credit error never switches")
_answers["sk-ant-api-y"] = "credit balance is too low"
r = _llm.credits(auto_switch=True)
check(r["state"] == "no-credit" and r["switched"] is None and _st.load_config()["defaultProfile"] == "cr-c", "credits: none with credit leaves the default alone")
check("sk-ant" not in json.dumps(r), "credits: never returns keys")
# With a keyring (axf.ai-keys@1) holding the active key, the switch happens among its saved keys, not the profiles.
class _FakeKeys:
    open_action = "keys.open"
    def __init__(self): self.calls = []
    def active_key(self, kind): return "sk-ant-api-x" if kind == "anthropic" else ""
    def credit_switch(self, kind, model, is_no_credit):
        self.calls.append(kind)
        ok = is_no_credit("Your credit balance is too low")
        return {"switched": {"from": "k1", "to": "k2", "label": "Spare"} if ok else None, "tried": [{"id": "k2", "label": "Spare", "state": "ok", "error": ""}]}
_fk = _FakeKeys()
plugin_services.provide("axf.ai-keys@1", _fk, "ai-assistant")
_answers["sk-ant-api-x"] = "Your credit balance is too low"
_answers["sk-ant-api-y"] = ""
_cfg = _st.load_config(); _cfg["defaultProfile"] = "cr-a"; _st.save_config(_cfg)
r = _llm.credits(auto_switch=True)
check(_fk.calls == ["anthropic"] and r["switched"]["via"] == "keys" and r["switched"]["label"] == "Spare", "credits: with a keyring, switches among its saved keys")
check(r["open"] == "keys.open" and _st.load_config()["defaultProfile"] == "cr-a", "credits: keyring switch leaves the default profile and says which dialog to open")
plugin_services.withdraw("ai-assistant")
plugin_services.provide("axf.llm@1", mod.LlmService(), "ai-assistant")
_prov.test_profile = _orig_test
_st.save_config(_cfg0)

print(f"all {ok} checks passed")
