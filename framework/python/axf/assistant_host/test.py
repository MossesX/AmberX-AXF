#!/usr/bin/env python3
"""Self-test for the shared assistant host runtime (stdlib only):

    python3 framework/python/axf/assistant_host/test.py

1. live-session@1: sessions.py replays framework/spec/fixtures/live-session.json (states, reducer, log, replays — the
   same file the TS reference and the Kotlin kernel replay), then a LocalHost runs a turn in its thread: a viewer that
   leaves keeps nothing from running, reattaching replays what was missed, owner events never pose as lifecycle kinds,
   a restart marks a running turn interrupted and calls the host's hook, close forgets the session.
2. providers.py: registry from the shared schema + a host's extra kinds (open registry), the three protocols against
   a fake server (OpenAI-compatible streaming with tool calls and usage, Anthropic SSE with thinking), key handling
   (stored key, env key, header masking rules, subscription-token mix-ups), the Claude Code CLI hooks: secrets and
   the host's own prefixes/credentials removed from the CLI environment, private folders denied in relative and
   absolute form, the jail for callers without file access.
3. safety.py: the calculator refuses every bomb fast and still does arithmetic; fetch refuses private and
   link-local addresses before connecting.
"""
from __future__ import annotations

import json
import os
import socket
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = HERE.parents[1]
sys.path.insert(0, str(PY))
from axf.assistant_host import providers, safety, sessions  # noqa: E402

FIX = PY.parent / "spec" / "fixtures"
n = 0


def check(cond: bool, what: str) -> None:
    global n
    if not cond:
        raise SystemExit(f"FAIL: {what}")
    n += 1
    print(f"  ✓ {what}")


print("axf.assistant_host self-test")

# ---------------------------------------------------------------- 1. live sessions
print("live sessions (live-session@1)")
fx = json.loads((FIX / "live-session.json").read_text())
check(sessions.CONTRACT == fx["contract"] if "contract" in fx else True, "contract id")
check(sessions.STATES == fx["states"] and sessions.KINDS == fx["kinds"], "states + reserved kinds match the kernel contract")
check(all(sessions.reduce(t["state"], t["kind"]) == t["next"] for t in fx["transitions"]), "state reducer matches the reference for every state × kind")
lg, stt, sts = sessions.EventLog(fx["log"]["limit"]), "idle", []
for a in fx["log"]["appends"]:
    lg.append(a["kind"], a.get("data"), a["at"])
    stt = sessions.reduce(stt, a["kind"])
    sts.append(stt)
check(sts == fx["log"]["states"] and lg.items == fx["log"]["kept"] and lg.last == fx["log"]["lastSeq"] and lg.first_seq == fx["log"]["firstSeq"], "event log appends + trims like the reference")
check(all(lg.since(q["after"], q["max"]) == q["result"] for q in fx["replays"]), "event log replays (gap / reset / more) match the reference")

folder = Path(tempfile.mkdtemp(prefix="axf-host-test-")) / "sessions"
host = sessions.LocalHost(folder, label="Test host", note="runs here", restart_reason="The test host restarted.")
check(host.describe() == {"id": "local", "label": "Test host", "available": True, "note": "runs here"}, "LocalHost takes the host's own label and note")
gate = threading.Event()


def produce():
    yield "event: start\ndata: {\"turnId\": \"t1\"}\n\n"
    yield "event: turn.end\ndata: {\"fake\": true}\n\n"   # an owner event posing as a lifecycle kind
    yield "event: text\ndata: {\"text\": \"part one \"}\n\n"
    gate.wait(10)
    yield "event: text\ndata: {\"text\": \"part two\"}\n\n"
    yield "event: done\ndata: {\"title\": \"Slow chat\"}\n\n"


seq = host.start_turn("conv-1", "first title", produce, notice="runs locally", owner="brett")
first = []
for chunk in host.tail("conv-1", 0, until_idle=True, max_wait_s=0.5):
    first.append(chunk)
    if "part one" in chunk:
        break   # the viewer leaves
time.sleep(0.1)
check(host.running("conv-1") and host.info("conv-1")["state"] == "running", "a viewer leaving keeps the reply running")
check(any("owner.turn.end" in c for c in first) and host.info("conv-1")["state"] == "running", "owner events never pose as lifecycle kinds")
try:
    host.start_turn("conv-1", "", produce)
    check(False, "a second turn while one runs is refused")
except sessions.Busy:
    check(True, "a second turn while one runs is refused")
seen = max(int(c.split("\n", 1)[0][4:]) for c in first if c.startswith("id: "))
gate.set()
for _ in range(100):
    if host.info("conv-1")["state"] == "idle":
        break
    time.sleep(0.02)
rest = "".join(host.tail("conv-1", seen, until_idle=True))
check(rest.startswith("event: replay") and "part two" in rest and "event: turn.end" in rest and "part one" not in rest, "reattaching replays only what was missed through the end of the turn")
info = host.info("conv-1")
check(info["title"] == "Slow chat" and info["meta"]["owner"] == "brett" and info["meta"]["turnSeq"] == seq and info["viewers"] == 0, "session info: title from done, owner, turn seq, viewers back to 0")
check((folder / "conv-1.json").exists() and oct((folder / "conv-1.json").stat().st_mode)[-3:] == "600", "log saved 0600 when the turn ends")

# a restart while running: the saved file says running → interrupted on load, hook called
saved = json.loads((folder / "conv-1.json").read_text())
saved["state"] = "running"
(folder / "conv-1.json").write_text(json.dumps(saved))
kept = []
host2 = sessions.LocalHost(folder, restart_reason="The test host restarted.")
host2.on_interrupted = lambda s: kept.append(s.id)
host2.load()
ev = host2.get("conv-1").log.items[-1]
check(ev["kind"] == "interrupted" and ev["data"]["reason"] == "The test host restarted." and host2.info("conv-1")["state"] == "idle" and kept == ["conv-1"], "a restart marks the running turn interrupted with the host's reason and calls the hook")
check(host2.close("conv-1") and host2.get("conv-1") is None and not (folder / "conv-1.json").exists(), "close ends the session and forgets its log")
check(host2._path("../../etc/passwd").parent == folder and host2._path("../../etc/passwd").name == "etcpasswd.json", "session ids never leave the sessions folder")
try:
    host2.get("/..", create=True)
    check(False, "an id with nothing safe in it is refused")
except KeyError:
    check(True, "an id with nothing safe in it is refused")

hosts = sessions.SessionHosts()
hosts.register(host2)
hosts.register(sessions.axhub_placeholder("the test host"))
h, note = hosts.resolve("axhub")
check(h is host2 and "axHub" in note and "the test host" in sessions.axhub_placeholder("the test host").note, "an unbuilt host falls back to the first available one with a notice")
try:
    sessions.PlaceholderHost("x", "X", "").list()
    check(False, "placeholder never pretends")
except sessions.NotImplementedHost:
    check(True, "a placeholder host never pretends to work")

# ---------------------------------------------------------------- 2. providers
print("providers")
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
            return self._json({"data": [{"id": "fake-2"}, {"id": "fake-1"}]})
        if self.path.startswith("/an/v1/models"):
            return self._json({"data": [{"id": "claude-test"}]})
        self._json({"error": {"message": "nope"}}, 404)

    def do_POST(self):  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        CALLS.append({"path": self.path, "body": body, "headers": {k.lower(): v for k, v in self.headers.items()}})
        if self.path.startswith("/broken"):
            return self._json({"error": {"message": "boom"}}, 500)
        if self.path.startswith("/denied"):
            return self._json({"error": {"message": "bad key"}}, 401)
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        w = lambda s: (self.wfile.write(s.encode()), self.wfile.flush())  # noqa: E731
        if self.path.startswith("/oa/chat/completions"):
            if body.get("tools") and "calc" in json.dumps(body["messages"][-1]):
                w('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"calculator","arguments":"{\\"expr"}}]}}]}\n\n')
                w('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ession\\": \\"6*7\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n')
            else:
                for part in ("Hello", " from fake"):
                    w(f'data: {json.dumps({"choices": [{"delta": {"content": part}}]})}\n\n')
                w('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n')
            w('data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7}}\n\n')
            w("data: [DONE]\n\n")
        elif self.path.startswith("/an/v1/messages"):
            for ev in [{"type": "message_start", "message": {"usage": {"input_tokens": 5}}},
                       {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking"}},
                       {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "hm"}},
                       {"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "sig"}},
                       {"type": "content_block_stop", "index": 0},
                       {"type": "content_block_start", "index": 1, "content_block": {"type": "text"}},
                       {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "Claude says hi"}},
                       {"type": "content_block_stop", "index": 1},
                       {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 3}}]:
                w(f"event: {ev['type']}\ndata: {json.dumps(ev)}\n\n")
        elif self.path.startswith("/oa/embeddings"):
            self.wfile.write(json.dumps({"data": [{"index": 1, "embedding": [0.2]}, {"index": 0, "embedding": [0.1]}]}).encode())


srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}"

reg = json.loads((PY.parent / "schemas" / "ai-providers.json").read_text())
check([c["kind"] for c in providers.CATALOG] == [p["kind"] for p in reg["providers"]] and reg["$axf"] == "ai-providers@1", "catalog comes from the shared framework registry (ai-providers@1)")
providers.extra_kinds = lambda: [{"kind": "mine", "label": "Mine", "protocol": "openai", "baseUrl": f"{BASE}/oa", "keyEnv": "MINE_KEY", "auth": "bearer", "models": ["m1"]},
                                 {"kind": "openai", "label": "OpenAI (mine)", "protocol": "openai", "baseUrl": f"{BASE}/oa", "keyEnv": "OPENAI_API_KEY", "auth": "bearer", "models": []}]
providers.reload_catalog()
check(providers.kind("mine")["label"] == "Mine" and providers.kind("openai")["label"] == "OpenAI (mine)" and len(providers.CATALOG) == len(reg["providers"]) + 1, "a host's extra kinds merge over the registry (same id replaces: open registry)")
providers.USER_AGENT = "AmberX-Test/1"
oa = {"id": "oa", "kind": "custom", "baseUrl": f"{BASE}/oa", "key": "sk-test-1234567890abcdefghij", "defaultModel": "fake-1"}
check(providers.list_models(oa) == ["fake-1", "fake-2"], "model list (sorted, deduped)")
out = providers.collect(providers.stream_chat(oa, [{"role": "user", "content": "hi"}], system="sys", params={"max_tokens": 50, "temperature": 0}))
check(out["text"] == "Hello from fake" and out["usage"] == {"input": 11, "output": 7} and out["stop"] == "stop", "OpenAI-compatible stream: text, usage, stop")
check(CALLS[-1]["headers"]["authorization"] == "Bearer sk-test-1234567890abcdefghij" and CALLS[-1]["headers"]["user-agent"] == "AmberX-Test/1" and CALLS[-1]["body"]["messages"][0] == {"role": "system", "content": "sys"}, "bearer auth, the host's user agent, system message first")
out = providers.collect(providers.stream_chat(oa, [{"role": "user", "content": "please calc"}], tools=[{"name": "calculator", "description": "d", "parameters": {"type": "object", "properties": {}}}]))
check(out["tool_calls"] == [{"id": "c1", "name": "calculator", "arguments": {"expression": "6*7"}}] and out["stop"] == "tool_use", "tool call arguments assembled across deltas")
os.environ["MINE_KEY"] = "env-key-value-1234567890"
out = providers.collect(providers.stream_chat({"kind": "mine", "defaultModel": "m1"}, [{"role": "user", "content": "hi"}]))
check(CALLS[-1]["headers"]["authorization"] == "Bearer env-key-value-1234567890", "key from the kind's environment variable when none is stored")
an = {"kind": "anthropic", "baseUrl": f"{BASE}/an", "key": "sk-ant-api03-" + "x" * 30, "headers": {"authorization": "evil", "x-extra": "1"}}
out = providers.collect(providers.stream_chat(an, [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "", "tool_calls": [{"id": "t", "name": "f", "arguments": {}}]}, {"role": "tool", "content": "r", "tool_call_id": "t"}],
                                              system="s", model="m", params={"thinking": True, "max_tokens": 4096, "thinking_budget": 4096}))
h = CALLS[-1]["headers"]
check(out["text"] == "Claude says hi" and out["thinking_blocks"] == [{"type": "thinking", "thinking": "hm", "signature": "sig"}] and out["usage"] == {"input": 5, "output": 3}, "Anthropic stream: text, thinking block, usage")
check(h["x-api-key"].startswith("sk-ant-api03") and "authorization" not in h and h["x-extra"] == "1" and h["anthropic-version"] == "2023-06-01", "profile headers can't override auth; version header set")
b = CALLS[-1]["body"]
check(b["max_tokens"] >= 4096 + 2048 and "temperature" not in b and b["messages"][-1]["content"][0]["type"] == "tool_result", "thinking raises max_tokens over the budget and drops temperature; tool results become user blocks")
for prof, needle in [({"kind": "anthropic", "baseUrl": f"{BASE}/an", "key": "sk-ant-oat01-" + "x" * 30}, "subscription token"),
                     ({"kind": "claude-code", "key": "sk-ant-api03-" + "x" * 30}, "Claude Code token"),
                     ({"kind": "custom", "baseUrl": f"{BASE}/denied", "key": "k" * 24, "defaultModel": "m"}, "HTTP 401"),
                     ({"kind": "custom", "baseUrl": f"{BASE}/broken", "key": "k" * 24, "defaultModel": "m"}, "HTTP 500"),
                     ({"kind": "custom", "baseUrl": f"{BASE}/oa", "defaultModel": "m"}, "no API key"),
                     ({"kind": "custom", "baseUrl": f"{BASE}/oa", "key": "k" * 24}, "no model")]:
    try:
        providers.collect(providers.stream_chat(prof, [{"role": "user", "content": "hi"}]))
        check(False, f"refused: {needle}")
    except providers.ProviderError as e:
        check(needle.lower() in str(e).lower(), f"refused with a clear message: {needle}")
check(providers.embed({"kind": "custom", "baseUrl": f"{BASE}/oa", "key": "k" * 24}, ["a", "b"]) == [[0.1], [0.2]], "embeddings come back in input order")
providers.register_protocol("echo", lambda profile, messages, system, model, tools, params, cancel, **kw: iter([{"type": "text", "text": f"echo:{messages[-1]['content']}"}, {"type": "stop", "reason": "end_turn"}]))
providers.extra_kinds = lambda: [{"kind": "echoer", "label": "Echo", "protocol": "echo", "baseUrl": "", "keyEnv": "", "auth": "none", "models": ["e"]}]
providers.reload_catalog()
check(providers.collect(providers.stream_chat({"kind": "echoer"}, [{"role": "user", "content": "yo"}]))["text"] == "echo:yo", "a registered protocol drives a kind (open registry)")

# Claude Code CLI hooks: what the CLI may see is decided by the host's hooks, never by a copy of this module
providers.PRIVATE_DIRS = [".axf-console", ".my-host"]
providers.ENV_PREFIXES_HIDDEN = ["AXF_", "MYHOST_"]
providers.stored_secret_names = lambda: {"HARMLESS_BUT_STORED"}
providers.PRIVATE_ROOTS = lambda: {"/srv/host"}
os.environ.update({"COOLIFY_TOKEN": "c", "SOME_PASSWORD": "p", "MYHOST_SETTING": "m", "AXF_TOKEN": "t", "HARMLESS_BUT_STORED": "s", "HARMLESS_SETTING": "ok"})
ce = providers._cli_env()
check(not any(k in ce for k in ("COOLIFY_TOKEN", "SOME_PASSWORD", "MYHOST_SETTING", "AXF_TOKEN", "HARMLESS_BUT_STORED")) and ce.get("HARMLESS_SETTING") == "ok" and "PATH" in ce,
      "CLI env: secrets, the host's prefixes and its stored credentials removed")
deny = providers._cli_deny()
check("Read(.my-host/**)" in deny and "Grep(**/.axf-console/**)" in deny and "LS(**/.env)" in deny and "Glob(.git/**)" in deny, "relative deny rules cover every private folder, env files, keys, git")
absd = providers._cli_abs_deny("/work/repo")
check("Read(//proc/**)" in absd and "Read(//work/repo/.axf-console/**)" in absd and "Read(//srv/host/.my-host/**)" in absd and "Grep(~/.ssh/**)" in absd, "absolute deny rules: /proc, every private folder under cwd and the host's roots, SSH keys")

# Claude Code CLI failures: the reason Claude Code gives reaches the person (never a bare "exited with code 1")
fake_dir = Path(tempfile.mkdtemp(prefix="axf-fake-cli-"))
fake = fake_dir / "claude"
fake.write_text("""#!/usr/bin/env python3
import json, os, sys
sys.stdin.read()
mode = os.environ.get("FAKE_CLI_MODE", "")
def out(o): print(json.dumps(o), flush=True)
out({"type": "system", "subtype": "init"})
if mode == "auth":
    out({"type": "system", "subtype": "api_retry", "error_status": 401, "error": "authentication_failed"})
    out({"type": "assistant", "message": {"model": "<synthetic>", "content": [{"type": "text", "text": "Failed to authenticate. API Error: 401 OAuth access token is invalid."}]}})
    out({"type": "result", "subtype": "success", "is_error": True, "api_error_status": 401, "result": "Failed to authenticate. API Error: 401 OAuth access token is invalid.", "usage": {}})
    sys.exit(1)
if mode == "model":
    out({"type": "result", "is_error": True, "api_error_status": 404, "result": "There's an issue with the selected model (claude-nope). It may not exist or you may not have access to it.", "usage": {}})
    sys.exit(1)
if mode == "limit":
    out({"type": "result", "is_error": True, "result": "Claude AI usage limit reached|1761200000", "usage": {}})
    sys.exit(1)
if mode == "stderr":
    print("error: unknown option '--bogus' (token sk-ant-oat01-SECRETSECRETSECRET)", file=sys.stderr)
    sys.exit(1)
if mode == "silent":
    sys.exit(1)
out({"type": "assistant", "message": {"model": "m", "content": [{"type": "text", "text": "fine"}]}})
out({"type": "result", "is_error": False, "result": "fine", "usage": {"input_tokens": 3, "output_tokens": 1}})
""")
fake.chmod(0o755)
os.environ["CLAUDE_BIN"] = str(fake)
cli_profile = {"kind": "claude-code", "key": "sk-ant-oat01-faketoken"}


def cli_turn(mode: str):
    os.environ["FAKE_CLI_MODE"] = mode
    try:
        return "ok", providers.collect(providers._stream_cli(cli_profile, [{"role": "user", "content": "hi"}], "", "claude-test", {}, None, str(fake_dir)))
    except providers.ProviderError as e:
        return "error", (str(e), e.status)


kind, got = cli_turn("auth")
check(kind == "error" and "rejected the token" in got[0] and got[1] == 400, "CLI: a refused token says so (not \"exited with code 1\")")
kind, got = cli_turn("model")
check(kind == "error" and "can't use the model `claude-test`" in got[0] and "may not exist" in got[0], "CLI: a model the account can't use names the model and what Claude Code said")
kind, got = cli_turn("limit")
check(kind == "error" and "usage or rate limit" in got[0] and got[1] == 429, "CLI: a usage limit is a 429, so the fallback chain can move on")
kind, got = cli_turn("stderr")
check(kind == "error" and "unknown option '--bogus'" in got[0] and "SECRETSECRET" not in got[0] and "exit code 1" in got[0], "CLI: stderr is shown, with secrets hidden")
kind, got = cli_turn("silent")
check(kind == "error" and "without saying why" in got[0] and "claude -p hi" in got[0], "CLI: a silent failure says how to see the error")
kind, got = cli_turn("ok")
check(kind == "ok" and got["text"] == "fine", "CLI: a working turn still streams its reply")
del os.environ["CLAUDE_BIN"], os.environ["FAKE_CLI_MODE"]

# ---------------------------------------------------------------- 3. safety
print("safety")
for bomb in ("((9**999)**999)**999", "2**" * 60 + "2", "9**9**9**9", "(10**4000)*(10**4000)", "__import__('os')", "1 if 1 else 2"):
    t0 = time.monotonic()
    try:
        safety.calc(bomb)
        res = "ok"
    except (ValueError, SyntaxError):
        res = "refused"
    check(time.monotonic() - t0 < 1 and res == "refused", f"calculator refuses {bomb[:24]}… fast")
check(safety.calc("2**10 + 3*(4-1)") == "1033" and safety.calc("-7 // 2") == "-4", "calculator still does arithmetic")
for u in ("http://127.0.0.1:1/", "http://localhost/", "http://169.254.169.254/latest/", "http://[::1]/", "http://100.64.0.1/", "http://10.1.2.3/", "ftp://example.com/x"):
    try:
        safety.fetch(u, timeout=2, deadline=3)
        check(False, f"fetch refuses {u}")
    except ValueError:
        check(True, f"fetch refuses {u}")
with socket.socket() as s:
    s.bind(("127.0.0.1", 0))
    s.listen(1)
    port = s.getsockname()[1]
    status, ctype, text = (None, None, None)

    def serve_once():
        conn, _ = s.accept()
        conn.recv(4096)
        conn.sendall(b"HTTP/1.1 200 OK\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: 5\r\n\r\nhello")
        conn.close()

    threading.Thread(target=serve_once, daemon=True).start()
    status, ctype, text = safety.fetch(f"http://127.0.0.1:{port}/", allow_private=True, timeout=3, deadline=5)
check(status == 200 and text == "hello" and ctype.startswith("text/plain"), "fetch works when a host allows private addresses on purpose")
print(f"all {n} checks passed")
