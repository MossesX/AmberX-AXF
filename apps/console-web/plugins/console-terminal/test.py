#!/usr/bin/env python3
"""Self-test for the Terminal plugin (real PTYs; a fake axf.containers@1 TTY; a fake claude CLI).

    python3 apps/console-web/plugins/terminal/test.py

Checks the console shell over the WebSocket (input, output, resize), secrets kept out of the environment, re-attach
with the byte offset (no duplicates; reset when it scrolled out), Mosh mode keeping a detached session while a normal
one closes after its grace, container shells through Container access (protected ones need a confirm), the VPS tab's
guards and key, the Claude Code tab, settings validation, the session log and the idle timeout.
"""
from __future__ import annotations

import importlib.util
import json
import os
import socket
import stat
import sys
import tempfile
import threading
import time
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
os.environ["AXF_TERMINAL_DIR"] = tempfile.mkdtemp(prefix="axf-term-test-")
os.environ["SUPER_SECRET_TOKEN"] = "leak-me-not"
os.environ["ANTHROPIC_API_KEY"] = "sk-ant-should-not-leak"
os.environ["AXF_TOKEN"] = "console-token-should-not-leak"
os.environ["HARMLESS_SETTING"] = "visible"
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

cx.set_context(ROOT=REPO, current_token=lambda: "t" * 32)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.terminal_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)
sessions = sys.modules["axf_console_plugins.terminal_test.sessions"]

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


def read_until(ws, needle: bytes, limit: float = 8.0) -> bytes:
    got = b""
    end = time.time() + limit
    while needle not in got and time.time() < end:
        m = ws.receive()
        if m.get("bytes"):
            got += m["bytes"]
        elif m.get("text") and '"exit"' in m["text"]:
            break
    return got


print("terminal self-test")
st = c.get("/p/status").json()
check(st["containers"] is False and "settings" in st, "status answers")
s = c.post("/p/sessions", json={"kind": "console", "cols": 90, "rows": 25}).json()
check(s["kind"] == "console" and s["title"] == "Console" and s["cwd"] == str(REPO), "console shell opens at the repo")
with c.websocket_connect(f"/p/sessions/{s['id']}/ws?have=0") as ws:
    hello = json.loads(ws.receive_text())
    check(hello["type"] == "hello" and hello["info"]["id"] == s["id"], "hello on attach")
    ws.send_text("\x00resize:120,40")
    ws.send_bytes(b"stty size; echo out-$((40+2)); echo COUNT=$(env | grep -c -E 'leak-me-not|sk-ant-should|console-token-should'); echo HARMLESS=$HARMLESS_SETTING\n")
    out = read_until(ws, b"HARMLESS=visible")
    check(b"40 120" in out, "resize reaches the PTY")
    check(b"out-42" in out, "input runs and output streams")
    check(b"COUNT=0" in out, "no token, key or secret in the shell environment")
    check(b"HARMLESS=visible" in out, "ordinary environment kept")
sess = sessions.MANAGER.get(s["id"])
off = sess.offset
with c.websocket_connect(f"/p/sessions/{s['id']}/ws?have={off}") as ws:
    hello = json.loads(ws.receive_text())
    check(not hello["reset"] and hello["offset"] == off, "re-attach from the last byte seen: nothing replayed twice")
    ws.send_bytes(b"echo again\n")
    check(b"again" in read_until(ws, b"again"), "re-attached session still works")
with c.websocket_connect(f"/p/sessions/{s['id']}/ws?have=999999999") as ws:
    hello = json.loads(ws.receive_text())
    check(hello["reset"] and hello["offset"] == sess.offset - len(sess.buf), "unknown offset → reset + full replay")
    first = ws.receive()
    check(first.get("bytes") and b"out-42" in first["bytes"], "replay carries earlier output")

# grace vs Mosh mode
sessions.GRACE_SECONDS = 1
m = c.post("/p/sessions", json={"kind": "console", "mosh": True}).json()
n = c.post("/p/sessions", json={"kind": "console"}).json()
time.sleep(7)
ids = {x["id"] for x in c.get("/p/sessions").json()["items"]}
check(m["id"] in ids, "Mosh mode keeps a detached session")
check(n["id"] not in ids, "a normal session closes after its grace when nobody is attached")
c.delete(f"/p/sessions/{m['id']}")

# idle timeout
i = c.post("/p/sessions", json={"kind": "console", "mosh": True}).json()
time.sleep(1.5)  # let the shell print its prompt first (output counts as activity)
sessions.MANAGER.get(i["id"]).last = time.time() - 61 * 60
time.sleep(6)
check(i["id"] not in {x["id"] for x in c.get("/p/sessions").json()["items"]}, "idle sessions close (60 min)")

# containers through axf.containers@1
check(c.post("/p/sessions", json={"kind": "container", "container": "web"}).status_code == 403, "no Container access → console shell only")


class FakeTty:
    def __init__(self):
        self.a, self.b = socket.socketpair()
        self.closed = False
        self.size = None
        threading.Thread(target=self._echo, daemon=True).start()

    def _echo(self):  # a tiny "container shell": echoes what it gets, upper-cased
        while True:
            try:
                d = self.b.recv(4096)
            except OSError:
                return
            if not d:
                return
            self.b.sendall(d.upper())

    def read(self):
        try:
            return self.a.recv(65536)
        except OSError:
            return b""

    def write(self, d):
        self.a.sendall(d)

    def resize(self, cols, rows):
        self.size = (cols, rows)

    def close(self):
        self.closed = True
        self.a.close()
        self.b.close()


class FakeContainers:
    opened: list = []

    def list(self):
        return [{"name": "web", "image": "node", "state": "running", "reachable": True, "protected": None},
                {"name": "coolify", "image": "coolify", "state": "running", "reachable": False, "protected": {"label": "Coolify"}}]

    def tty(self, name, actor=None, cwd="", user="", allow_protected=False, cols=100, rows=30, command=None, env=None):
        if name == "coolify" and not allow_protected:
            raise PermissionError("protected")
        self.opened.append({"name": name, "cwd": cwd, "actor": actor, "allow": allow_protected})
        return FakeTty(), {"name": name}


fc = FakeContainers()
plugin_services.provide("axf.containers@1", fc, "fake-container-access")
check([t["name"] for t in c.get("/p/targets").json()["items"]] == ["web", "coolify"], "container targets listed")
cs = c.post("/p/sessions", json={"kind": "container", "container": "web", "cwd": "/app/src"}).json()
check(cs["title"] == "web" and fc.opened[-1] == {"name": "web", "cwd": "/app/src", "actor": {"kind": "user", "id": "console", "name": "Brett (terminal)"}, "allow": False},
      "container shell opens in the right-clicked folder, as you")
with c.websocket_connect(f"/p/sessions/{cs['id']}/ws") as ws:
    json.loads(ws.receive_text())
    ws.send_bytes(b"hello\n")
    check(b"HELLO" in read_until(ws, b"HELLO"), "container TTY streams both ways")
r = c.post("/p/sessions", json={"kind": "container", "container": "coolify"})
check(r.status_code == 403 and "confirm" in r.json()["detail"], "protected container needs a confirm")
pc = c.post("/p/sessions", json={"kind": "container", "container": "coolify", "confirmProtected": True}).json()
check(pc["protected"] and pc["badge"] == "PROTECTED" and fc.opened[-1]["allow"], "…and opens with the badge after it")
check(c.post("/p/sessions", json={"kind": "container", "container": "nope"}).status_code == 404, "unknown container is 404")
plugin_services.withdraw("fake-container-access")

# VPS tab
check(c.post("/p/sessions", json={"kind": "vps"}).status_code == 400, "VPS tab needs a host and a key first")
for bad in ({"vps": {"host": "-oProxyCommand=evil"}}, {"vps": {"host": "a b"}}, {"vps": {"host": "h", "user": "root;id"}}, {"user": "root; rm"}, {"claudeToken": "sk-ant-api03-nope"}):
    check(c.put("/p/settings", json=bad).status_code == 400, f"settings refuse {json.dumps(bad)[:40]}")
import shutil  # noqa: E402
if not shutil.which("ssh-keygen"):
    print("  · ssh-keygen not installed here: VPS key checks skipped")
    print(f"all {ok} checks passed")
    sys.exit(0)
k = c.post("/p/ssh/keygen", json={}).json()
check(k["publicKey"].startswith("ssh-ed25519 ") and k["publicKey"].endswith("axf-console-terminal"), "dedicated ed25519 key made")
key = Path(os.environ["AXF_TERMINAL_DIR"]) / "ssh" / "id_ed25519"
check(stat.S_IMODE(key.stat().st_mode) == 0o600 and "PRIVATE" not in json.dumps(c.get("/p/settings").json()), "private key stays on the server (0600)")
check(c.post("/p/ssh/keygen", json={}).json()["publicKey"] == k["publicKey"], "keygen keeps the key unless asked to replace it")
c.put("/p/settings", json={"vps": {"host": "127.0.0.1", "port": 1, "user": "root"}})
v = c.post("/p/sessions", json={"kind": "vps", "cwd": "/root"}).json()
check(v["badge"] == "HOST ROOT" and v["target"] == "127.0.0.1", "VPS tab opens over ssh with the HOST ROOT badge")
c.delete(f"/p/sessions/{v['id']}")

# Claude Code tab with a fake CLI
fake = Path(tempfile.mkdtemp()) / "claude"
fake.write_text("#!/bin/sh\necho CLAUDE-TAB token=${CLAUDE_CODE_OAUTH_TOKEN:+set} key=${ANTHROPIC_API_KEY:-none} pwd=$(pwd)\nsleep 2\n")
fake.chmod(0o755)
os.environ["CLAUDE_BIN"] = str(fake)
check(c.put("/p/settings", json={"claudeToken": "sk-ant-oat01-" + "x" * 30}).json()["claudeToken"] is True, "Claude Code token saved (write-only)")
check("sk-ant-oat01" not in c.get("/p/settings").text, "…and never returned")
cl = c.post("/p/sessions", json={"kind": "claude", "cwd": str(REPO / "framework")}).json()
with c.websocket_connect(f"/p/sessions/{cl['id']}/ws") as ws:
    json.loads(ws.receive_text())
    out = read_until(ws, b"pwd=")
    out += read_until(ws, b"\n", 2)
check(b"CLAUDE-TAB token=set key=none" in out and str(REPO / "framework").encode() in out, "Claude Code tab gets only its own token, in the chosen folder")

# limits + log
check(c.post("/p/sessions", json={"kind": "nope"}).status_code == 400, "unknown kind refused")
check(c.post("/p/sessions", json={"kind": "console", "cwd": "relative/path"}).status_code == 400, "cwd must be absolute")
log = c.get("/p/log").json()["items"]
check(any(e["op"] == "open" and e["kind"] == "container" and e["protected"] for e in log) and any(e["op"] == "close" and e["reason"] == "idle" for e in log),
      "session log: who, where, when, why it closed")
check(all("leak" not in json.dumps(e) for e in log), "the log never holds typed input")
before = len(c.get("/p/sessions").json()["items"])
cx.set_context(current_token=lambda: "u" * 32)
time.sleep(6)
check(before > 0 and not c.get("/p/sessions").json()["items"], "a console token reset closes every terminal")
root = os.environ["AXF_TERMINAL_DIR"]
check(all((p.stat().st_mode & 0o077) == 0 for p in Path(root).rglob("*") if p.is_file() and p.suffix != ".pub" and p.name != "known_hosts")
      and all((p.stat().st_mode & 0o077) == 0 for p in Path(root).rglob("*") if p.is_dir()), "data files and folders private (public key and known_hosts inside a private folder)")
print(f"all {ok} checks passed")
