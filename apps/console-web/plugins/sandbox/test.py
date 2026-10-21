#!/usr/bin/env python3
"""Self-test for the Sandbox plugin: the shield, the workspaces, the hub reader (a fake axHub on loopback speaking
MCP, through the framework's MCP client) and the routes inside the real console app, as admins and hub users.

    python3 apps/console-web/plugins/sandbox/test.py
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONSOLE = HERE.parents[1]
REPO = HERE.parents[3]
sys.path.insert(0, str(CONSOLE / "server"))

_tmp = tempfile.TemporaryDirectory()
TMP = Path(_tmp.name)
TOKEN = "t" * 32
SECRET = "s" * 40
os.environ.update({
    "AXF_STATE": str(TMP / "state.json"), "AXF_DATA_DIR": "off", "AXF_TOKEN": TOKEN, "AXF_TRUST_WALL": "1",
    "AXF_WALL_SECRET": SECRET, "AXF_WALL_HUB": "https://hub.example.test", "AXF_SANDBOX_DIR": str(TMP / "sandbox"),
    "AXHUB_TOKEN": "hubtoken-" + "x" * 20, "AXHUB_URL": "https://hub.example.test",
})

checks = 0


def ok(cond: bool, what: str) -> None:
    global checks
    if not cond:
        raise AssertionError(what)
    checks += 1
    print(f"  ✓ {what}")


# ---------------------------------------------------------------- fake axHub (MCP over HTTP, JSON answers)
CALLS: list[dict] = []
FILES = {
    "README.md": "# AmberX\nhello sandbox\n",
    "apps/x/bin.dat": None,  # binary
}


def gh_answer(tool: str, args: dict) -> object:
    if tool == "github.repos/get-content":
        p = args.get("path", "")
        if p == "":
            return [{"name": "README.md", "path": "README.md", "type": "file", "size": 24}, {"name": "apps", "path": "apps", "type": "dir", "size": 0}]
        if p in FILES:
            raw = FILES[p].encode() if FILES[p] is not None else b"\x00\x01\x02binary"
            return {"type": "file", "path": p, "sha": "abc", "size": len(raw), "encoding": "base64",
                    "content": base64.b64encode(raw).decode(), "html_url": f"https://github.com/MossesX/AmberX-AXF/blob/main/{p}"}
        return {"error": "nope"}
    if tool == "github.repos/list-commits":
        return [{"sha": "c1", "commit": {"message": "first"}}]
    return {"tool": tool}


class FakeHub(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def do_POST(self):  # noqa: N802
        msg = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))) or b"{}")
        CALLS.append({"auth": self.headers.get("authorization", ""), "msg": msg})
        if "id" not in msg:  # notification
            self.send_response(202)
            self.end_headers()
            return
        if msg["method"] == "initialize":
            result = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "fake-axhub", "version": "1"}}
        elif msg["method"] == "tools/call":
            a = msg["params"]["arguments"]
            ans = gh_answer(a["tool"], a.get("arguments", {}))
            result = {"content": [{"type": "text", "text": json.dumps(ans)}]}
        else:
            result = {}
        body = json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": result}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("mcp-session-id", "sess-1")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeHub)
threading.Thread(target=srv.serve_forever, daemon=True).start()
HUB_URL = f"http://127.0.0.1:{srv.server_address[1]}"

# ---------------------------------------------------------------- the console with the plugin loaded
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

mod = sys.modules.get("axf_console_plugins.sandbox")
ok(mod is not None and "sandbox" in main.PLUGINS, "the console loads the sandbox plugin")
ok("sandbox" in main.WALL_USER_PLUGINS, "it is open to signed-in hub users (wallUsers) and decides per user itself")
shield = sys.modules["axf_console_plugins.sandbox.shield"]
hubmod = sys.modules["axf_console_plugins.sandbox.hub"]

# point the hub reader at the fake hub (the real class, plain-HTTP transport only because the fake is on loopback)
from axf_libs.mcp.client import UrllibTransport  # noqa: E402
mod.HUB = hubmod.HubReader(transport_factory=lambda creds: UrllibTransport(creds), config=lambda: ("https://hub.example.test", os.environ["AXHUB_TOKEN"]))
_orig_session = mod.HUB._session


def _session_loopback():  # same as HubReader._session, but to the loopback fake
    from axf_libs.mcp.client import McpClient
    if mod.HUB._client is None:
        c = McpClient("axhub-sandbox", f"{HUB_URL}/mcp", UrllibTransport(lambda _s: f"Bearer {os.environ['AXHUB_TOKEN']}"), timeout=5)
        c.initialize()
        mod.HUB._client = c
    return mod.HUB._client


mod.HUB._session = _session_loopback

c = TestClient(main.app, raise_server_exceptions=False)
HOST = "testserver"
B = "/api/plugins/sandbox"


def sign(name: str, role: str, perms: str) -> str:
    t = int(time.time())
    return f"v1.{t}." + hmac.new(SECRET.encode(), f"v1|{t}|{name}|{role}|{perms}|{HOST}".encode(), hashlib.sha256).hexdigest()


def hub_user(name: str = "conrad", role: str = "user", perms: str = "") -> dict[str, str]:
    return {"x-auth-user": name, "x-auth-role": role, "x-auth-perms": perms, "x-auth-via": "session",
            "x-auth-sig": sign(name, role, perms), "origin": f"http://{HOST}"}


ADMIN = {"authorization": f"Bearer {TOKEN}"}
CONRAD = hub_user("conrad")
MAYA = hub_user("maya")

print("shield rules")
ok(shield.READ_TOOLS == frozenset(t for t, _ in shield.GITHUB_OPS.values()), "the hub tools sent are exactly the op table's")
ok(all(not any(w in t.split("/")[-1].split("-") for w in shield.WRITE_WORDS) for t in shield.READ_TOOLS), "no tool in the table is a write verb")
allowed = {"mossesx/amberx-axf"}
for bad_op in ("create-issue", "issues/create", "../repos/get", "", "merge"):
    try:
        shield.github_call(bad_op, "MossesX", "AmberX-AXF", {}, allowed)
        ok(False, f"op {bad_op!r} refused")
    except shield.ShieldError:
        ok(True, f"op {bad_op!r} refused")
try:
    shield.github_call("contents", "MossesX", "secret-repo", {}, allowed)
    ok(False, "a repository the admin didn't open is refused")
except shield.ShieldError:
    ok(True, "a repository the admin didn't open is refused")
tool, args = shield.github_call("contents", "MossesX", "AmberX-AXF", {"path": "a/b.md", "ref": "main", "tool": "github.issues/create", "body": "x"}, allowed)
ok(tool == "github.repos/get-content" and set(args) == {"owner", "repo", "path", "ref"}, "unknown fields from the browser are dropped")
for p in ("../x", "/etc/passwd", "a/../b", "a\\b"):
    try:
        shield.github_call("contents", "MossesX", "AmberX-AXF", {"path": p}, allowed)
        ok(False, f"repo path {p!r} refused")
    except shield.ShieldError:
        ok(True, f"repo path {p!r} refused")
_, a2 = shield.github_call("commits", "MossesX", "AmberX-AXF", {"per_page": 5000}, allowed)
ok(a2["per_page"] == shield.MAX_PER_PAGE, "page size is capped")
for good in ("notes.md", "github/AmberX-AXF/src/App.tsx", "pilot/My app (v2).design.json"):
    ok(shield.file_path_ok(good), f"file name {good!r} allowed")
for bad in ("", "../x", "a/../b", ".env", "a/.git/config", "/abs", "a\\b", "a/", "x\x00y", "a/b.", "a//b", "-x"):
    ok(not shield.file_path_ok(bad), f"file name {bad!r} refused")
ok(shield.user_slug("Brett Smith") == "brett-smith" and shield.user_slug("../..") == "anonymous", "workspace folder names are safe")
try:
    shield.clean_config({"repos": ["not a repo"]})
    ok(False, "bad config refused")
except shield.ShieldError:
    ok(True, "bad config refused")
ok(shield.clean_config({"repos": ["MossesX/AmberX-AXF", "mossesx/amberx-axf"]})["repos"] == ["mossesx/amberx-axf"], "repo list is normalised and deduplicated")

print("hub reader")
try:
    mod.HUB.call("github.issues/create", {"owner": "MossesX", "repo": "AmberX-AXF", "title": "x"})
    ok(False, "the reader refuses a write tool even if asked directly")
except shield.ShieldError:
    ok(True, "the reader refuses a write tool even if asked directly")
ok(not any(x["msg"].get("method") == "tools/call" for x in CALLS), "…and nothing reached the hub")
empty = hubmod.HubReader(config=lambda: ("https://hub.example.test", ""))
ok(empty.ready()[0] is False, "no axHub token → GitHub tab says so")

print("access")
r = c.get(f"{B}/me", headers=CONRAD)
ok(r.status_code == 200 and r.json()["allowed"] and not r.json()["admin"] and r.json()["readOnly"], "a hub user gets the sandbox (read-only)")
ok(c.get(f"{B}/admin/state", headers=CONRAD).status_code == 403, "a hub user can't open Sandbox management")
ok(c.put(f"{B}/admin/config", headers=CONRAD, json={"openTo": "everyone"}).status_code == 403, "a hub user can't change the config")
ok(c.post(f"{B}/admin/clear", headers=CONRAD, json={"workspace": "*", "confirm": "clear all"}).status_code == 403, "a hub user can't clear sandboxes")
no_origin = {k: v for k, v in CONRAD.items() if k != "origin"}
ok(c.put(f"{B}/file", headers={**no_origin, "origin": "https://evil.example"}, json={"path": "a.md", "text": "x"}).status_code == 403, "a cross-site write from a browser session is refused")
ok(c.get(f"{B}/me", headers={k: v for k, v in CONRAD.items() if k != "x-auth-sig"}).status_code == 403, "an unsigned session is refused")
ok(c.get(f"{B}/admin/state", headers=ADMIN).status_code == 200, "the console token opens Sandbox management")
ok(c.get(f"{B}/admin/state", headers=hub_user("brett", "admin")).status_code == 200, "a hub admin opens Sandbox management")

print("GitHub through the sandbox (read-only)")
r = c.post(f"{B}/github", headers=CONRAD, json={"op": "contents", "repo": "MossesX/AmberX-AXF", "args": {"path": ""}})
ok(r.status_code == 200 and isinstance(r.json()["data"], list), "browse a repository's files")
sent = [x for x in CALLS if x["msg"].get("method") == "tools/call"]
ok(sent and sent[-1]["msg"]["params"]["name"] == "call" and sent[-1]["msg"]["params"]["arguments"]["tool"] == "github.repos/get-content", "the hub got exactly one read tool call")
ok(all(x["auth"] == f"Bearer {os.environ['AXHUB_TOKEN']}" for x in CALLS), "the hub token stays on the server side (sent only to the hub)")
ok("hubtoken" not in r.text, "…and never comes back to the browser")
r = c.post(f"{B}/github", headers=CONRAD, json={"op": "commits", "repo": "MossesX/AmberX-AXF"})
ok(r.status_code == 200 and r.json()["data"][0]["sha"] == "c1", "list commits")
r = c.post(f"{B}/github", headers=CONRAD, json={"op": "create-issue", "repo": "MossesX/AmberX-AXF", "args": {"title": "x"}})
ok(r.status_code == 400 and "read-only" in r.json()["detail"], "a write op is refused with a plain reason")
n_before = len(CALLS)
r = c.post(f"{B}/github", headers=CONRAD, json={"op": "contents", "repo": "MossesX/private-other", "args": {"path": ""}})
ok(r.status_code == 400 and len(CALLS) == n_before, "a repository outside the list never reaches the hub")
r = c.post(f"{B}/github/file", headers=CONRAD, json={"repo": "MossesX/AmberX-AXF", "path": "README.md"})
ok(r.status_code == 200 and r.json()["isText"] and "hello sandbox" in r.json()["text"], "read a text file")
r = c.post(f"{B}/github/file", headers=CONRAD, json={"repo": "MossesX/AmberX-AXF", "path": "apps/x/bin.dat"})
ok(r.status_code == 200 and r.json()["isText"] is False and r.json()["text"] == "", "binary files aren't shown as text")

print("files: copy, edit, rename, delete — only inside the person's sandbox")
r = c.post(f"{B}/github/copy", headers=CONRAD, json={"repo": "MossesX/AmberX-AXF", "path": "README.md"})
ok(r.status_code == 200 and r.json()["path"] == "github/AmberX-AXF/README.md", "copy a GitHub file into the sandbox")
r = c.get(f"{B}/file", headers=CONRAD, params={"path": "github/AmberX-AXF/README.md"})
ok(r.status_code == 200 and "hello sandbox" in r.json()["text"], "the copy reads back")
ok(c.put(f"{B}/file", headers=CONRAD, json={"path": "github/AmberX-AXF/README.md", "text": "edited"}).status_code == 200, "edit the copy")
ok(FILES["README.md"].startswith("# AmberX"), "GitHub's file is untouched")
ok(c.put(f"{B}/file", headers=CONRAD, json={"path": "notes/todo.md", "text": "a", "create": True}).status_code == 200, "new file")
ok(c.put(f"{B}/file", headers=CONRAD, json={"path": "notes/todo.md", "text": "b", "create": True}).status_code == 400, "new file refuses to overwrite")
ok(c.post(f"{B}/file/rename", headers=CONRAD, json={"from": "notes/todo.md", "to": "notes/done.md"}).status_code == 200, "rename")
for bad in ("../escape.md", ".env", "/etc/x", "a/../../b"):
    ok(c.put(f"{B}/file", headers=CONRAD, json={"path": bad, "text": "x"}).status_code == 400, f"write to {bad!r} refused")
ok(not (TMP / "escape.md").exists() and not (TMP / "sandbox" / "escape.md").exists(), "nothing landed outside the workspace")
ws_root = TMP / "sandbox" / "workspaces"
os.symlink(str(TMP), ws_root / "conrad" / "files" / "link")
ok(c.put(f"{B}/file", headers=CONRAD, json={"path": "link/evil.md", "text": "x"}).status_code == 400, "a link planted inside a workspace isn't followed")
ok(not (TMP / "evil.md").exists(), "…nothing written through it")
(ws_root / "conrad" / "files" / "link").unlink()
r = c.get(f"{B}/files", headers=MAYA)
ok(r.status_code == 200 and r.json()["files"] == [], "another person sees only their own (empty) sandbox")
ok(c.get(f"{B}/file", headers=MAYA, params={"path": "notes/done.md"}).status_code == 400, "…and can't read someone else's file")
ok(c.delete(f"{B}/file", headers=CONRAD, params={"path": "notes/done.md"}).status_code == 200, "delete your own file")
ok(not (ws_root / "conrad" / "files" / "notes").exists(), "empty folders go with it")
mode = (ws_root / "conrad").stat().st_mode & 0o777
ok(mode & 0o077 == 0, "workspace folders are owner-only")

print("limits")
ok(c.put(f"{B}/admin/config", headers=ADMIN, json={"maxFileKb": 1, "maxFiles": 2}).status_code == 200, "admin sets limits")
ok(c.put(f"{B}/file", headers=CONRAD, json={"path": "big.txt", "text": "x" * 2000}).status_code == 400, "file size cap")
c.put(f"{B}/file", headers=CONRAD, json={"path": "two.txt", "text": "x"})
ok(c.put(f"{B}/file", headers=CONRAD, json={"path": "three.txt", "text": "x"}).status_code == 400, "file count cap")
c.put(f"{B}/admin/config", headers=ADMIN, json={"maxFileKb": 512, "maxFiles": 200})

print("Pilot catalog (read-only)")
r = c.get(f"{B}/pilot/catalog", headers=CONRAD)
j = r.json()
ok(r.status_code == 200 and j["templates"] and j["boilerplates"]["items"] and j["assets"].get("color-theme"), "templates, boilerplates and assets come from the framework")
ok("wrap-groups" in j["buildOptions"], "build options come from the registry")
design = {"$axf": "sandbox-design@1", "name": "Test", "template": "react-ts"}
ok(c.put(f"{B}/file", headers=CONRAD, json={"path": "pilot/test.design.json", "text": json.dumps(design)}).status_code == 200, "a design is saved only as a sandbox file")

print("Sandbox management")
st = c.get(f"{B}/admin/state", headers=ADMIN).json()
row = next(w for w in st["workspaces"] if w["id"] == "conrad")
ok(row["files"] >= 2 and row["bytes"] > 0 and row["lastUsedAt"], "every workspace with files, size and last use")
ok(any(e["action"] == "copy" for e in st["log"]) and st["readTools"], "activity log + the read tools in use")
ok(c.post(f"{B}/admin/clear", headers=ADMIN, json={"workspace": "conrad", "confirm": "wrong"}).status_code == 400, "clearing needs the workspace id typed")
ok(c.post(f"{B}/admin/clear", headers=ADMIN, json={"workspace": "../..", "confirm": "../.."}).status_code == 400, "a crafted workspace id is refused")
ok(c.post(f"{B}/admin/clear", headers=ADMIN, json={"workspace": "conrad", "confirm": "conrad"}).json()["cleared"] == 1, "admin clears one sandbox")
ok(c.get(f"{B}/files", headers=CONRAD).json()["files"] == [], "…its files are gone")
c.put(f"{B}/file", headers=MAYA, json={"path": "m.md", "text": "x"})
ok(c.post(f"{B}/admin/clear", headers=ADMIN, json={"workspace": "*", "confirm": "nope"}).status_code == 400, 'clear all needs "clear all"')
ok(c.post(f"{B}/admin/clear", headers=ADMIN, json={"workspace": "*", "confirm": "clear all"}).json()["cleared"] >= 1, "admin clears every sandbox")
ok(TMP.exists() and (TMP / "sandbox").exists(), "clearing stays inside the sandbox folder")

print("open to")
c.put(f"{B}/admin/config", headers=ADMIN, json={"openTo": "permission"})
ok(c.get(f"{B}/files", headers=CONRAD).status_code == 403, "openTo=permission: a user without console.sandbox is refused")
ok(c.get(f"{B}/files", headers=hub_user("conrad", perms="console.sandbox")).status_code == 200, "…with console.sandbox they get in")
c.put(f"{B}/admin/config", headers=ADMIN, json={"openTo": "admins"})
ok(c.get(f"{B}/files", headers=hub_user("conrad", perms="console.sandbox")).status_code == 403, "openTo=admins: users are refused")
ok(c.get(f"{B}/files", headers=ADMIN).status_code == 200, "…admins still get in")
c.put(f"{B}/admin/config", headers=ADMIN, json={"openTo": "everyone", "enabled": False})
ok(c.get(f"{B}/files", headers=CONRAD).status_code == 403 and c.get(f"{B}/me", headers=CONRAD).json()["allowed"] is False, "switched off: users see why")

print("no writes outside the sandbox")
written = [p for p in TMP.rglob("*") if p.is_file() and not str(p).startswith(str(TMP / "sandbox")) and p.name != "state.json"]
ok(written == [], f"the only files the run wrote are in the sandbox folder (+ the console state file): {written[:3]}")

srv.shutdown()
print(f"\nsandbox: {checks} checks passed")
