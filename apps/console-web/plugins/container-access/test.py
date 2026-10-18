#!/usr/bin/env python3
"""Self-test for Container access (no Docker needed: a fake Docker Engine API runs on localhost).

    python3 apps/console-web/plugins/container-access/test.py

Checks the proxy allow list, the protected list (Coolify, Traefik, the console, the proxy, databases, custom
patterns), reach = list, reads (file, folder, search), user writes and deletes with audit, agents refused without a
snapshot, change batches (diffs, invalid targets, approval needing a snapshot service, one snapshot per container,
ordered apply with stop-at-first-failure, refusing a file that changed since it was proposed, reject, undo), the
HTTP routes and settings validation.
"""
from __future__ import annotations

import base64
import importlib.util
import io
import json
import os
import re
import struct
import sys
import tarfile
import tempfile
import threading
import types
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.environ["AXF_CONTAINER_ACCESS_DIR"] = tempfile.mkdtemp(prefix="axf-ca-test-")
os.environ["AXF_ROOT"] = tempfile.mkdtemp(prefix="axf-ca-root-")  # data of any other plugin loaded below
sys.path.insert(0, str(HERE.parent.parent / "server"))
import plugin_services  # noqa: E402

sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []

# ---------------------------------------------------------------- fake Docker Engine API
FS: dict[str, dict[str, bytes | None]] = {}  # container id -> {path: bytes (file) | None (dir)}
CONTAINERS = [
    {"Id": "a" * 64, "Names": ["/myapp"], "Image": "node:20-alpine", "State": "running", "Status": "Up 2 hours", "Labels": {}},
    {"Id": "b" * 64, "Names": ["/coolify"], "Image": "ghcr.io/coollabsio/coolify:4", "State": "running", "Status": "Up", "Labels": {}},
    {"Id": "c" * 64, "Names": ["/coolify-proxy"], "Image": "traefik:v3.1", "State": "running", "Status": "Up", "Labels": {}},
    {"Id": "d" * 64, "Names": ["/pg-main"], "Image": "postgres:16-alpine", "State": "running", "Status": "Up", "Labels": {}},
    {"Id": "e" * 64, "Names": ["/axf-console"], "Image": "axf-console:latest", "State": "running", "Status": "Up", "Labels": {}},
    {"Id": "f" * 64, "Names": ["/axf-docker-proxy"], "Image": "haproxy:2.9-alpine", "State": "running", "Status": "Up", "Labels": {"axf.docker-proxy": "1"}},
    {"Id": "1" * 64, "Names": ["/old-job"], "Image": "busybox", "State": "exited", "Status": "Exited (0)", "Labels": {}},
    {"Id": "2" * 64, "Names": ["/abcdefghijklmnopqrstuvwx-123456"], "Image": "app:latest", "State": "running", "Status": "Up",
     "Labels": {"coolify.managed": "true", "coolify.type": "application"}},
    {"Id": "3" * 64, "Names": ["/cache"], "Image": "bitnami/redis:7", "State": "running", "Status": "Up", "Labels": {}},
]
for c in CONTAINERS:
    FS[c["Id"]] = {"/": None, "/app": None, "/app/src": None, "/app/src/index.ts": b"console.log('hi')\n", "/app/README.md": b"# app\n",
                   "/app/node_modules": None, "/app/node_modules/x.js": b"x"}
EXECS: dict[str, dict] = {}
REQUESTS: list[tuple[str, str]] = []
RESTARTS: list[str] = []


def _cid(key: str) -> str:
    for c in CONTAINERS:
        if c["Id"].startswith(key) or c["Names"][0][1:] == key:
            return c["Id"]
    raise KeyError(key)


def _tar(cid: str, path: str) -> bytes:
    fs = FS[cid]
    base = path.rstrip("/").rsplit("/", 1)[-1] or "/"
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tf:
        for p in sorted(fs):
            if p == path or p.startswith(path.rstrip("/") + "/"):
                rel = base + p[len(path.rstrip("/")):]
                ti = tarfile.TarInfo(rel)
                if fs[p] is None:
                    ti.type, ti.mode = tarfile.DIRTYPE, 0o755
                    tf.addfile(ti)
                else:
                    ti.size, ti.mode = len(fs[p]), 0o644
                    tf.addfile(ti, io.BytesIO(fs[p]))
    return buf.getvalue()


def _mux(text: str, stream: int = 1) -> bytes:
    b = text.encode()
    return bytes([stream, 0, 0, 0]) + struct.pack(">I", len(b)) + b if b else b""


def _run_exec(e: dict) -> tuple[str, int]:
    cmd, env, cid = list(e["Cmd"]), e.get("Env") or [], e["cid"]
    fs = FS[cid]
    if cmd[:2] == ["sh", "-c"] and "command -v timeout" in cmd[2]:
        cmd = cmd[4:]
    op = next((x.split("=", 1)[1] for x in env if x.startswith("AXF_OP=")), "")
    if op == "listdir":
        d = cmd[4].rstrip("/") or "/"
        if fs.get(d, b"") is not None:
            return "", 3
        out = []
        for p, v in fs.items():
            if p != d and p.rsplit("/", 1)[0] == (d if d != "/" else ""):
                out.append(f"{'d' if v is None else 'f'}\t{0 if v is None else len(v)}\t{p.rsplit('/', 1)[1]}")
        return "\n".join(out) + "\n", 0
    if op == "search":
        pat, root, lim = cmd[4], cmd[5], int(cmd[6])
        hits = []
        for p, v in sorted(fs.items()):
            if v is None or not p.startswith(root) or "/node_modules/" in p:
                continue
            for i, line in enumerate(v.decode(errors="replace").splitlines(), 1):
                if pat in line:
                    hits.append(f"{p}:{i}:{line}")
        return "\n".join(hits[:lim]) + ("\n" if hits else ""), 0 if hits else 1
    if op == "owner":
        return "1000 1000\n", 0
    if op == "mkdir":
        parts = cmd[-1].strip("/").split("/")
        for i in range(1, len(parts) + 1):
            fs.setdefault("/" + "/".join(parts[:i]), None)
        return "", 0
    if op == "delete":
        for p in cmd[cmd.index("--") + 1:]:
            for k in [k for k in fs if k == p or k.startswith(p + "/")]:
                del fs[k]
        return "", 0
    if op == "tree":
        root, skip = cmd[4], re.findall(r"-name (\S+)", cmd[2])
        out = [k for k in sorted(fs) if (k == root or k.startswith(root + "/")) and not any(f"/{x}/" in k + "/" for x in skip)]
        return "\n".join(out) + "\n", 0
    script = cmd[2] if cmd[:2] == ["sh", "-c"] else " ".join(cmd)
    if "fail" in script:
        return f"error from: {script}\n", 1
    if script.startswith("touch "):
        fs[script.split()[1]] = b""
    return f"ran: {script}\n", 0


class Fake(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *a):  # quiet
        pass

    def _send(self, code: int, body: bytes = b"", ctype: str = "application/json", headers: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _route(self):
        u = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        REQUESTS.append((self.command, u.path))
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        p = u.path
        if p == "/version":
            return self._send(200, json.dumps({"Version": "27.0-fake", "ApiVersion": "1.46"}).encode())
        if p == "/containers/json":
            return self._send(200, json.dumps(CONTAINERS).encode())
        m = re.match(r"^/containers/([^/]+)/(json|archive|exec|restart)$", p)
        if m:
            cid = _cid(urllib.parse.unquote(m.group(1)))
            what = m.group(2)
            if what == "json":
                return self._send(200, json.dumps({"Id": cid, "Config": {"WorkingDir": "/app"}}).encode())
            if what == "restart":
                RESTARTS.append(cid)
                return self._send(204)
            if what == "exec":
                e = json.loads(body)
                eid = os.urandom(16).hex()
                EXECS[eid] = {**e, "cid": cid}
                return self._send(201, json.dumps({"Id": eid}).encode())
            path = q["path"]
            fs = FS[cid]
            if self.command in ("GET", "HEAD"):
                if path not in fs:
                    return self._send(404, b'{"message":"no such file"}')
                mode = (1 << 31) | 0o755 if fs[path] is None else 0o644
                st = base64.b64encode(json.dumps({"name": path.rsplit("/", 1)[-1], "size": len(fs[path] or b""), "mode": mode}).encode()).decode()
                return self._send(200, _tar(cid, path) if self.command == "GET" else b"", "application/x-tar", {"X-Docker-Container-Path-Stat": st})
            if self.command == "PUT":
                if path not in fs:
                    return self._send(404, b'{"message":"no such dir"}')
                with tarfile.open(fileobj=io.BytesIO(body)) as tf:
                    for mm in tf.getmembers():
                        full = (path.rstrip("/") + "/" + mm.name).replace("//", "/")
                        fs[full] = None if mm.isdir() else tf.extractfile(mm).read()
                return self._send(200)
        m = re.match(r"^/exec/([a-f0-9]+)/(start|json|resize)$", p)
        if m:
            e = EXECS[m.group(1)]
            if m.group(2) == "json":
                return self._send(200, json.dumps({"Running": False, "ExitCode": e.get("code")}).encode())
            if m.group(2) == "resize":
                return self._send(201)
            out, code = _run_exec(e)
            e["code"] = code
            return self._send(200, _mux(out, 1 if code == 0 else 2), "application/vnd.docker.raw-stream")
        return self._send(404, b'{"message":"page not found"}')

    do_GET = do_POST = do_PUT = do_HEAD = _route


srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ["AXF_DOCKER_PROXY"] = f"http://127.0.0.1:{srv.server_address[1]}"
os.environ["AXF_CONSOLE_CONTAINER"] = "e" * 12


def load():
    name = "axf_console_plugins.container_access_test"
    spec = importlib.util.spec_from_file_location(name, HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


ok = 0
fails: list[str] = []


def check(name: str, cond: bool, detail: str = ""):
    global ok
    if cond:
        ok += 1
    else:
        fails.append(f"{name}: {detail}")
        print(f"FAIL {name} {detail}")


def raises(fn, exc) -> str:
    try:
        fn()
    except exc as e:  # noqa: PERF203
        return str(e) or exc.__name__
    except Exception as e:  # noqa: BLE001
        return f"WRONG {type(e).__name__}: {e}"
    return ""


mod = load()
S = mod.SERVICE
store = sys.modules["axf_console_plugins.container_access_test.store"]
USER = {"kind": "user", "id": "brett", "name": "Brett"}
AGENT = {"kind": "agent", "id": "coder", "name": "Mosses"}

# --- proxy allow list (haproxy ACL regexes, checked with Python's re) ----------------------------------------------
cfg = (HERE / "deploy" / "haproxy.cfg").read_text()
acls = dict(re.findall(r"acl (\w+)\s+path -m reg (\S+)", cfg))
allowed = lambda m, p: any(  # noqa: E731
    re.search(acls[a], p) and ((m in ("GET", "HEAD") and a in ("v_ping", "c_list", "c_inspect", "c_archive"))
                               or (m == "PUT" and a == "c_archive") or (m == "POST" and a in ("c_exec", "e_run", "c_restart"))
                               or (m == "GET" and a == "e_json")) for a in acls)
check("proxy allows list", allowed("GET", "/v1.46/containers/json"))
check("proxy allows archive put", allowed("PUT", "/containers/myapp/archive"))
check("proxy allows exec start", allowed("POST", "/exec/" + "a" * 64 + "/start"))
for m, p in [("POST", "/containers/create"), ("DELETE", "/containers/myapp"), ("POST", "/containers/myapp/kill"), ("GET", "/images/json"),
             ("POST", "/volumes/create"), ("GET", "/containers/../images/json"), ("POST", "/containers/myapp/exec/../../create"), ("GET", "/events")]:
    check(f"proxy denies {m} {p}", not allowed(m, p))
check("proxy ends with deny", "http-request deny" in cfg)

# --- discovery + protection -------------------------------------------------------------------------------------
items = {c["name"]: c for c in S.list()}
check("myapp reachable", items["myapp"]["reachable"] and not items["myapp"]["protected"])
for n, rule in [("coolify", "coolify"), ("coolify-proxy", "traefik"), ("pg-main", "database"), ("cache", "database"), ("axf-console", "console"), ("axf-docker-proxy", "docker-proxy")]:
    pr = items[n]["protected"]
    check(f"{n} protected as {rule}", bool(pr) and pr["rule"] == rule and pr["locked"], str(pr))
check("coolify uuid from name", items["abcdefghijklmnopqrstuvwx-123456"]["coolify"] == "abcdefghijklmnopqrstuvwx")
check("protected refused", "protected" in raises(lambda: S.resolve("coolify"), PermissionError))
check("stopped refused", "exited" in raises(lambda: S.resolve("old-job"), PermissionError))
check("unknown refused", raises(lambda: S.resolve("nope"), KeyError) != "")
check("protected read refused", raises(lambda: S.read_file("pg-main", "/app/README.md"), PermissionError) != "")
check("protected open allowed for terminal flag", S.resolve("coolify", allow_protected=True)["name"] == "coolify")

store.save_settings({"protect": ["my*"]})
check("custom protect", "protected" in raises(lambda: S.resolve("myapp"), PermissionError))
store.save_settings({"protect": [], "reach": "list", "allow": ["abc*"]})
check("reach list blocks", "reachable" in raises(lambda: S.resolve("myapp"), PermissionError))
store.save_settings({"reach": "all", "allow": []})
check("bad pattern refused", raises(lambda: store.save_settings({"protect": ["$(rm -rf /)"]}), ValueError) != "")
check("bad terminal user refused", raises(lambda: store.save_settings({"terminalUser": "root; id"}), ValueError) != "")

# --- reads --------------------------------------------------------------------------------------------------------
r = S.read_file("myapp", "/app/src/index.ts")
check("read file", r["content"] == "console.log('hi')\n" and r["encoding"] == "utf8", str(r))
check("read dir refused", "directory" in raises(lambda: S.read_file("myapp", "/app/src"), Exception))
d = S.list_dir("myapp", "/app")
names = {e["name"]: e["type"] for e in d["entries"]}
check("list dir", names.get("src") == "dir" and names.get("README.md") == "file", str(names))
check("list dir sorted dirs first", d["entries"][0]["type"] == "dir")
s = S.search("myapp", "/app", "console.log")
check("search hit", any(h["path"] == "/app/src/index.ts" and h["line"] == 1 for h in s["hits"]), str(s))
check("relative path refused", "absolute" in raises(lambda: S.read_file("myapp", "app/x"), ValueError))
check("workdir", S.workdir("myapp") == "/app")

# --- writes (user) + audit ----------------------------------------------------------------------------------------
w = S.write_file("myapp", "/app/src/new.ts", "export {}\n", actor=USER)
check("user write creates", w["created"] and FS["a" * 64]["/app/src/new.ts"] == b"export {}\n")
w = S.write_file("myapp", "/app/deep/er/x.txt", "x", actor=USER)
check("write creates parents", FS["a" * 64].get("/app/deep/er/x.txt") == b"x")
check("write to / refused", raises(lambda: S.write_file("myapp", "/", "x", actor=USER), ValueError) != "")
check("delete top-level refused", raises(lambda: S.delete_file("myapp", "/app", actor=USER, recursive=True), ValueError) != "")
check("delete folder needs recursive", "recursive" in raises(lambda: S.delete_file("myapp", "/app/deep", actor=USER), ValueError))
S.delete_file("myapp", "/app/deep", actor=USER, recursive=True)
check("recursive delete", not any(k.startswith("/app/deep") for k in FS["a" * 64]))
aud = S.audit(50)
check("audit has write + delete", {"write", "delete"} <= {e["op"] for e in aud}, str([e["op"] for e in aud]))
check("audit never stores content", all("content" not in e for e in aud))

# --- agents need a snapshot ---------------------------------------------------------------------------------------
check("agent write refused", "batch" in raises(lambda: S.write_file("myapp", "/app/x", "x", actor=AGENT), PermissionError))
check("agent exec refused", "batch" in raises(lambda: S.exec("myapp", "ls", actor=AGENT), PermissionError))
check("agent tty refused", raises(lambda: S.tty("myapp", actor=AGENT), PermissionError) != "")

# --- change batches ---------------------------------------------------------------------------------------------
b = S.create_batch([
    {"kind": "write", "container": "myapp", "path": "/app/src/index.ts", "content": "console.log('bye')\n", "reason": "say bye"},
    {"kind": "exec", "container": "myapp", "command": "npm run build"},
    {"kind": "delete", "container": "myapp", "path": "/app/README.md"},
    {"kind": "write", "container": "coolify", "path": "/x", "content": "evil"},
    {"kind": "restart", "container": "myapp"},
], actor=AGENT, conversation="c1", turn="t1", title="Say bye")
check("batch pending", b["status"] == "pending" and len(b["items"]) == 5)
check("write diff", b["items"][0]["diff"]["added"] == 1 and b["items"][0]["diff"]["removed"] == 1 and "+console.log('bye')" in b["items"][0]["diff"]["text"])
check("exec covers workdir", b["items"][1]["paths"] == ["/app"], str(b["items"][1]))
check("protected item invalid", b["items"][3]["status"] == "invalid" and "protected" in b["items"][3]["error"])
check("public batch hides content", all("content" not in it for it in S.public_batch(b)["items"]))
check("approve needs snapshots", "Snapshot Manager" in raises(lambda: S.approve_batch(b["id"], None, USER), PermissionError))
check("batch still pending", S.get_batch(b["id"])["status"] == "pending")


class FakeSnaps:
    taken: list = []
    restored: list = []

    def take(self, container, paths, reason="", actor=None, batch=None, meta=None):
        sid = f"s-{len(self.taken) + 1}"
        self.taken.append({"id": sid, "container": container, "paths": list(paths), "batch": batch, "actor": actor})
        return {"id": sid, "bytes": 123}

    def restore(self, sid, actor=None):
        self.restored.append(sid)
        return {"ok": True, "before": f"pre-{sid}"}


snaps = FakeSnaps()
plugin_services.provide("axf.snapshots@1", snaps, "fake-snapshots")
events: list = []
res = S.approve_batch(b["id"], ["i1", "i2", "i3", "i5"], USER, on_event=events.append)
check("approved", res["status"] == "applied", json.dumps(res)[:400])
check("one snapshot per container", len(snaps.taken) == 1 and snaps.taken[0]["paths"] == ["/app"], str(snaps.taken))
check("snapshot linked to batch", snaps.taken[0]["batch"] == b["id"] and snaps.taken[0]["actor"]["name"] == "Mosses")
check("write applied", FS["a" * 64]["/app/src/index.ts"] == b"console.log('bye')\n")
check("delete applied", "/app/README.md" not in FS["a" * 64])
check("restart applied", RESTARTS[-1] == "a" * 64)
check("exec output captured", "ran: npm run build" in (res["items"][1].get("output") or ""))
check("events stream", [e["type"] for e in events][:2] == ["snapshot-start", "snapshot"] and any(e["type"] == "output" for e in events))
check("invalid item skipped", res["items"][3]["status"] == "invalid")
check("snapshot ids on items", res["items"][0]["snapshot"] == "s-1")
check("audit by agent with snapshot", any(e["op"] == "write" and e["actor"]["name"] == "Mosses" and e["snapshot"] == "s-1" for e in S.audit(50)))
check("re-approve refused", "applied" in raises(lambda: S.approve_batch(b["id"], None, USER), ValueError))

# stop at first failure
b2 = S.create_batch([{"kind": "exec", "container": "myapp", "command": "please fail", "paths": ["/app/src"]},
                     {"kind": "write", "container": "myapp", "path": "/app/src/z.ts", "content": "z"}], actor=AGENT)
r2 = S.approve_batch(b2["id"], None, USER)
check("failure stops the batch", r2["status"] == "failed" and r2["items"][0]["status"] == "failed" and r2["items"][1]["status"] == "skipped", json.dumps(r2)[:300])
check("skipped write not applied", "/app/src/z.ts" not in FS["a" * 64])

# drift: file changed after the proposal
b3 = S.create_batch([{"kind": "write", "container": "myapp", "path": "/app/src/index.ts", "content": "v3"}], actor=AGENT)
FS["a" * 64]["/app/src/index.ts"] = b"changed by someone else"
r3 = S.approve_batch(b3["id"], None, USER)
check("drift refused", r3["items"][0]["status"] == "failed" and "changed since" in r3["items"][0]["error"])
check("drift not written", FS["a" * 64]["/app/src/index.ts"] == b"changed by someone else")

# untick everything → error; reject; undo
b4 = S.create_batch([{"kind": "write", "container": "myapp", "path": "/app/a.txt", "content": "a"}], actor=AGENT)
check("nothing ticked refused", "nothing" in raises(lambda: S.approve_batch(b4["id"], [], USER), ValueError))
b5 = S.create_batch([{"kind": "write", "container": "myapp", "path": "/app/b.txt", "content": "b"}], actor=AGENT)
check("reject", S.reject_batch(b5["id"], USER)["status"] == "rejected")
u = S.undo_batch(b["id"], USER)
check("undo restores batch snapshots", u["status"] == "undone" and snaps.restored == ["s-1"] and u["undoSnapshots"] == ["pre-s-1"])
check("bad batch id", raises(lambda: S.get_batch("../../etc/passwd"), KeyError) != "")
check("undo of a pending batch refused", "pending" in raises(lambda: S.undo_batch(b4["id"], USER), ValueError))
# large existing file: exact base hash, marked unseen, needs an explicit accept, drift still caught
FS["a" * 64]["/app/big.txt"] = b"line\n" * 130_000  # ~650 KB, over the 512 KB text read limit
bb = S.create_batch([{"kind": "write", "container": "myapp", "path": "/app/big.txt", "content": "small now"}], actor=AGENT)
it = bb["items"][0]
check("big file is a replace, not a new file", it["status"] == "pending" and not it["created"] and it["baseHash"] and it["unseen"], json.dumps(it)[:300])
check("unseen change needs an explicit accept", "accept" in raises(lambda: S.approve_batch(bb["id"], None, USER), ValueError))
FS["a" * 64]["/app/big.txt"] = b"line\n" * 130_001
rb = S.approve_batch(bb["id"], None, USER, accept_unseen=True)
check("drift on a big file caught", rb["items"][0]["status"] == "failed" and "changed since" in rb["items"][0]["error"] and FS["a" * 64]["/app/big.txt"].startswith(b"line"))
bn = S.create_batch([{"kind": "exec", "container": "myapp", "command": "rm -rf /tmp/x", "workdir": "/"}], actor=AGENT)
check("exec with nothing to snapshot is invalid", bn["items"][0]["status"] == "invalid" and "paths" in bn["items"][0]["error"])

# tree + restore primitives (used by Snapshot Manager)
t = S.tree("myapp", "/app", ["node_modules"])
check("tree skips excluded", "/app/src/index.ts" in t and not any("node_modules" in x for x in t), str(t))
raw = _tar("a" * 64, "/app/src")
FS["a" * 64]["/app/src/extra.ts"] = b"new"
S.archive_restore("myapp", "/app/src", raw, actor=USER, remove=["/app/src/extra.ts"], snapshot="s-x")
check("restore removes newer files", "/app/src/extra.ts" not in FS["a" * 64])
check("restore keeps node_modules", "/app/node_modules/x.js" in FS["a" * 64])
check("restore outside path refused", "outside" in raises(lambda: S.archive_restore("myapp", "/app/src", raw, actor=USER, remove=["/etc/passwd"]), ValueError))
S.archive_restore("myapp", "/app/tmp-new", None, actor=USER)
check("restore of absent path removes it", "/app/tmp-new" not in FS["a" * 64])

# snapshot failure → nothing applied
class BadSnaps(FakeSnaps):
    def take(self, *a, **k):
        raise OSError("disk full")


plugin_services.provide("axf.snapshots@1", BadSnaps(), "fake-snapshots")
b6 = S.create_batch([{"kind": "write", "container": "myapp", "path": "/app/c.txt", "content": "c"}], actor=AGENT)
r6 = S.approve_batch(b6["id"], None, USER)
check("snapshot failure writes nothing", r6["status"] == "failed" and "/app/c.txt" not in FS["a" * 64] and "nothing was changed" in r6["error"])
plugin_services.provide("axf.snapshots@1", snaps, "fake-snapshots")

# --- end to end with the real snapshot provider, found by capability (never by folder name) ---------------------------
prov = next((d for d in sorted(HERE.parent.iterdir()) if (d / "plugin.json").exists()
             and "service:axf.snapshots@1" in json.loads((d / "plugin.json").read_text()).get("provides", [])), None)
if prov:
    nm = "axf_console_plugins.snapshot_provider_test"
    spec = importlib.util.spec_from_file_location(nm, prov / "server" / "__init__.py", submodule_search_locations=[str(prov / "server")])
    sm = importlib.util.module_from_spec(spec)
    sys.modules[nm] = sm
    spec.loader.exec_module(sm)
    real = plugin_services.get("axf.snapshots@1")
    fs = FS["a" * 64]
    fs["/app/src/index.ts"] = b"v1\n"
    fs.pop("/app/src/new.ts", None)
    b8 = S.create_batch([{"kind": "write", "container": "myapp", "path": "/app/src/index.ts", "content": "v2\n"},
                         {"kind": "write", "container": "myapp", "path": "/app/src/added.ts", "content": "added\n"},
                         {"kind": "exec", "container": "myapp", "command": "touch /app/src/built.js", "paths": ["/app/src"]}], actor=AGENT)
    r8 = S.approve_batch(b8["id"], None, USER)
    check("e2e applied", r8["status"] == "applied" and fs["/app/src/index.ts"] == b"v2\n" and "/app/src/built.js" in fs, json.dumps(r8)[:300])
    snap = real.get(r8["snapshots"][0])
    check("e2e snapshot of covered paths", snap["paths"] == ["/app/src"] and snap["batch"] == b8["id"], str(snap["paths"]))
    dd = real.diff(snap["id"])
    check("e2e diff sees the change", any("/app/src/index.ts" in e.get("changed", []) for e in dd["entries"]), json.dumps(dd)[:300])
    u8 = S.undo_batch(b8["id"], USER)
    check("e2e undo restores", fs["/app/src/index.ts"] == b"v1\n" and "/app/src/added.ts" not in fs and "/app/src/built.js" not in fs, str(sorted(k for k in fs if k.startswith("/app/src"))))
    check("e2e undo is undoable", u8["undoSnapshots"] and real.get(u8["undoSnapshots"][0])["meta"].get("restoreOf") == snap["id"])
    plugin_services.provide("axf.snapshots@1", snaps, "fake-snapshots")
else:
    print("(no snapshot provider installed; end-to-end checks skipped)")

# --- HTTP routes ----------------------------------------------------------------------------------------------------
try:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    app = FastAPI()
    app.include_router(mod.router, prefix="/p")
    cl = TestClient(app)
    st = cl.get("/p/status").json()
    check("route status", st["proxy"]["ok"] and st["snapshots"], str(st)[:200])
    check("route containers", any(c["name"] == "myapp" for c in cl.get("/p/containers").json()["items"]))
    check("route protected file 403", cl.get("/p/containers/coolify/file", params={"path": "/app/README.md"}).status_code == 403)
    check("route dir", cl.get("/p/containers/myapp/dir", params={"path": "/app"}).status_code == 200)
    b7 = S.create_batch([{"kind": "write", "container": "myapp", "path": "/app/d.txt", "content": "d"}], actor=AGENT)
    rr = cl.post(f"/p/batches/{b7['id']}/approve", json={"items": ["i1"]})
    evs = [json.loads(x[6:]) for x in rr.text.split("\n\n") if x.startswith("data: ")]
    check("route approve streams", evs and evs[-1]["type"] == "batch" and evs[-1]["batch"]["status"] == "applied", rr.text[:300])
    check("route batch has no content", all("content" not in it for it in cl.get(f"/p/batches/{b7['id']}").json()["items"]))
    check("route undo needs confirm", cl.post(f"/p/batches/{b7['id']}/undo", json={}).status_code == 400)
    check("route settings validation", cl.put("/p/settings", json={"reach": "everything"}).status_code == 400)
    check("route audit", len(cl.get("/p/audit?limit=5").json()["items"]) == 5)
except ImportError:
    print("(fastapi test client not installed; route checks skipped)")

check("service registered", plugin_services.get("axf.containers@1") is S)
check("data stays in dataDir", all(str(p).startswith(os.environ["AXF_CONTAINER_ACCESS_DIR"]) for p in Path(os.environ["AXF_CONTAINER_ACCESS_DIR"]).rglob("*")))
check("data files private", all((p.stat().st_mode & 0o077) == 0 for p in Path(os.environ["AXF_CONTAINER_ACCESS_DIR"]).rglob("*") if p.is_file()))

srv.shutdown()
print(f"{ok} checks passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
