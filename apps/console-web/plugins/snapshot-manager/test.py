#!/usr/bin/env python3
"""Self-test for Snapshot Manager (no Docker: an in-memory fake of axf.containers@1).

    python3 apps/console-web/plugins/snapshot-manager/test.py

Checks take (files, folders, missing paths, excluded folders, the per-snapshot cap), list / get / usage, diff
(added / removed / changed + a per-file diff), restore (snapshot of the current state first, newer files removed,
excluded folders untouched, missing paths removed, files replaced), undo of a restore, retention by age and size,
delete, settings validation, the routes and that every byte stays in the data folder.
"""
from __future__ import annotations

import importlib.util
import io
import json
import os
import sys
import tarfile
import tempfile
import time
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.environ["AXF_SNAPSHOT_MANAGER_DIR"] = tempfile.mkdtemp(prefix="axf-snap-test-")
sys.path.insert(0, str(HERE.parent.parent / "server"))
import plugin_services  # noqa: E402

sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []


class FakeContainers:
    """In-memory axf.containers@1: one container 'web', path -> bytes (file) | None (folder)."""

    def __init__(self):
        self.fs: dict[str, bytes | None] = {"/": None, "/srv": None, "/srv/app": None, "/srv/app/a.txt": b"one\n", "/srv/app/b.txt": b"bee\n",
                                            "/srv/app/sub": None, "/srv/app/sub/c.txt": b"sea\n", "/srv/app/node_modules": None,
                                            "/srv/app/node_modules/big.js": b"x" * 1000, "/srv/app/.env": b"SECRET=1\n", "/srv/conf.ini": b"[a]\n"}
        self.restores: list = []

    def _tar(self, path: str) -> bytes:
        base = path.rsplit("/", 1)[-1]
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w") as tf:
            for p in sorted(self.fs):
                if p == path or p.startswith(path + "/"):
                    ti = tarfile.TarInfo(base + p[len(path):])
                    if self.fs[p] is None:
                        ti.type = tarfile.DIRTYPE
                        tf.addfile(ti)
                    else:
                        ti.size = len(self.fs[p])
                        tf.addfile(ti, io.BytesIO(self.fs[p]))
        return buf.getvalue()

    def stat(self, container, path):
        return None if path not in self.fs else {"isDir": self.fs[path] is None}

    def archive_open(self, container, path):
        if container != "web":
            raise PermissionError("protected")
        if path not in self.fs:
            return None

        class Conn:
            def close(self):
                pass
        return {"container": "web", "id": "w" * 64, "path": path, "stat": {"isDir": self.fs[path] is None}}, Conn(), io.BytesIO(self._tar(path))

    def read_file(self, container, path, max_bytes=None):
        if path not in self.fs or self.fs[path] is None:
            raise KeyError(path)
        return {"content": self.fs[path].decode(), "encoding": "utf8"}

    def tree(self, container, path, exclude=None):
        return [p for p in self.fs if (p == path or p.startswith(path + "/")) and not any(f"/{x}/" in p + "/" for x in exclude or [])]

    def archive_restore(self, container, path, tar_data, actor=None, snapshot=None, remove=None, replace=False):
        self.restores.append({"path": path, "remove": list(remove or []), "replace": replace, "none": tar_data is None})
        doomed = [path] if tar_data is None or replace else list(remove or [])
        for d in doomed:
            for k in [k for k in self.fs if k == d or k.startswith(d + "/")]:
                del self.fs[k]
        if tar_data is not None:
            parent = path.rsplit("/", 1)[0] or "/"
            data = tar_data if isinstance(tar_data, bytes) else tar_data.read()
            with tarfile.open(fileobj=io.BytesIO(data)) as tf:
                for m in tf.getmembers():
                    full = parent.rstrip("/") + "/" + m.name
                    self.fs[full] = None if m.isdir() else tf.extractfile(m).read()
        return {"ok": True}

    def list(self):
        return [{"name": "web", "reachable": True}, {"name": "coolify", "reachable": False}]

    def audit(self, limit=200, container="", op="", batch=""):
        return [{"op": "write", "at": 1}]


FC = FakeContainers()
plugin_services.provide("axf.containers@1", FC, "fake-containers")


def load():
    name = "axf_console_plugins.snapshot_manager_test"
    spec = importlib.util.spec_from_file_location(name, HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


ok = 0
fails: list[str] = []


def check(name, cond, detail=""):
    global ok
    if cond:
        ok += 1
    else:
        fails.append(name)
        print(f"FAIL {name} {detail}")


def raises(fn, exc) -> str:
    try:
        fn()
    except exc as e:
        return str(e) or exc.__name__
    except Exception as e:  # noqa: BLE001
        return f"WRONG {type(e).__name__}: {e}"
    return ""


mod = load()
S = mod.SERVICE
snapmod = sys.modules["axf_console_plugins.snapshot_manager_test.snapshots"]
AG = {"kind": "agent", "id": "coder", "name": "Mosses"}
check("service registered", plugin_services.get("axf.snapshots@1") is S)

# --- take ---------------------------------------------------------------------------------------------------------
m = S.take("web", ["/srv/app", "/srv/conf.ini", "/srv/new-thing", "/srv/app"], reason="before batch b-1", actor=AG, batch="b-1", meta={"turn": "t1"})
check("manifest", m["container"] == "web" and m["paths"] == ["/srv/app", "/srv/conf.ini", "/srv/new-thing"] and m["batch"] == "b-1" and m["actor"]["name"] == "Mosses")
e0, e1, e2 = m["entries"]
check("folder entry", e0["existed"] and e0["isDir"] and e0["skipped"] >= 1, str(e0))
check("node_modules skipped", not any("node_modules" in f[0] for f in json.loads((snapmod.SNAPS / m["id"] / "0.files.json").read_text())))
check("dotfiles kept", any(f[0] == "app/.env" for f in json.loads((snapmod.SNAPS / m["id"] / "0.files.json").read_text())))
check("file entry", e1["existed"] and not e1["isDir"])
check("missing path recorded", e2 == {"n": 2, "path": "/srv/new-thing", "existed": False})
check("bad path refused", raises(lambda: S.take("web", ["relative"]), ValueError) != "" and raises(lambda: S.take("web", ["/"]), ValueError) != "")
check("protected container refused", raises(lambda: S.take("coolify", ["/x"]), PermissionError) != "")
check("failed take leaves nothing", len(list(snapmod.SNAPS.iterdir())) == 1)
check("list", [x["id"] for x in S.list()] == [m["id"]] and S.list(batch="b-1") and not S.list(container="other"))
check("usage", S.usage()["count"] == 1 and S.usage()["bytes"] > 0)

# --- diff ---------------------------------------------------------------------------------------------------------
FC.fs["/srv/app/a.txt"] = b"one\ntwo\n"
FC.fs["/srv/app/d.txt"] = b"new\n"
del FC.fs["/srv/app/b.txt"]
FC.fs["/srv/app/node_modules/more.js"] = b"y"
FC.fs["/srv/new-thing"] = b"appeared"
d = S.diff(m["id"])
de = d["entries"][0]
check("diff changed", de["changed"] == ["/srv/app/a.txt"], str(de))
check("diff added", de["added"] == ["/srv/app/d.txt"], str(de))
check("diff removed", de["removed"] == ["/srv/app/b.txt"], str(de))
check("diff missing path now exists", d["entries"][2] == {"path": "/srv/new-thing", "existed": False, "existsNow": True})
fd = S.diff(m["id"], "/srv/app/a.txt")
check("file diff", "+two" in fd["diff"]["text"] and fd["then"] and fd["now"], str(fd))
fd2 = S.diff(m["id"], "/srv/app/.env")
check("dotfile diff resolves", fd2["then"], str(fd2))
check("file outside snapshot", raises(lambda: S.diff(m["id"], "/etc/passwd"), KeyError) != "")

# --- restore --------------------------------------------------------------------------------------------------------
r = S.restore(m["id"], actor={"kind": "user", "id": "brett", "name": "Brett"})
check("restore ok", r["ok"] and r["before"] != m["id"])
check("restored content", FC.fs["/srv/app/a.txt"] == b"one\n" and FC.fs["/srv/app/b.txt"] == b"bee\n")
check("newer file removed", "/srv/app/d.txt" not in FC.fs)
check("node_modules untouched", FC.fs.get("/srv/app/node_modules/more.js") == b"y" and "/srv/app/node_modules/big.js" in FC.fs)
check("missing path removed again", "/srv/new-thing" not in FC.fs)
check("file replaced", any(x["path"] == "/srv/conf.ini" and x["replace"] for x in FC.restores))
before = S.get(r["before"])
check("before-restore snapshot has the changed state", before["meta"].get("restoreOf") == m["id"])
check("restore recorded", S.get(m["id"])["restores"][0]["before"] == r["before"])
r2 = S.restore(r["before"])
check("undo of the restore", FC.fs.get("/srv/app/d.txt") == b"new\n" and FC.fs.get("/srv/new-thing") == b"appeared" and "/srv/app/b.txt" not in FC.fs, str(sorted(FC.fs)))
check("restore id validated", raises(lambda: S.restore("../x"), KeyError) != "")

# --- cap, settings, retention ---------------------------------------------------------------------------------------
snapmod.save_settings({"maxSnapshotMb": 10})
FC.fs["/srv/app/huge.bin"] = b"z" * (11 * 1024 * 1024)
n_before = len(list(snapmod.SNAPS.iterdir()))
check("per-snapshot cap", "cap" in raises(lambda: S.take("web", ["/srv/app"]), ValueError))
check("capped take cleaned up", len(list(snapmod.SNAPS.iterdir())) == n_before)
del FC.fs["/srv/app/huge.bin"]
check("bad exclude refused", raises(lambda: snapmod.save_settings({"exclude": ["../etc"]}), ValueError) != "")
check("bad exclude refused (glob)", raises(lambda: snapmod.save_settings({"exclude": ["*"]}), ValueError) != "")
old = S.list()[-1]
mp = snapmod.SNAPS / old["id"] / "manifest.json"
mm = json.loads(mp.read_text()); mm["createdAt"] = int((time.time() - 40 * 86400) * 1000); mp.write_text(json.dumps(mm))
pr = S.prune()
check("prune by age", old["id"] in pr["removed"], str(pr))
for _ in range(3):
    S.take("web", ["/srv/app"], reason="filler")
total = S.usage()["bytes"]
sp = snapmod.DATA / "settings.json"
sp.write_text(json.dumps({**snapmod.settings(), "maxGb": (total / 2) / 1024 ** 3}))  # below the UI minimum, on purpose
pr = S.prune()
check("prune by size, oldest first", pr["removed"] and S.usage()["bytes"] <= (total / 2) + 1, str(pr))
snapmod.save_settings({"maxGb": 5, "keepDays": 30})
one = S.list()[0]["id"]
S.delete(one)
check("delete", raises(lambda: S.get(one), KeyError) != "")

# --- routes ---------------------------------------------------------------------------------------------------------
try:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    app = FastAPI()
    app.include_router(mod.router, prefix="/p")
    cl = TestClient(app)
    st = cl.get("/p/status").json()
    check("route status", st["containers"] and st["usage"]["count"] >= 1)
    t = cl.post("/p/snapshots", json={"container": "web", "paths": ["/srv/conf.ini"], "reason": "by hand"}).json()
    check("route take", t["reason"] == "by hand" and t["actor"]["kind"] == "user")
    check("route restore needs confirm", cl.post(f"/p/snapshots/{t['id']}/restore", json={}).status_code == 400)
    check("route restore", cl.post(f"/p/snapshots/{t['id']}/restore", json={"confirm": "restore"}).json()["ok"])
    check("route diff", cl.get(f"/p/snapshots/{t['id']}/diff").status_code == 200)
    check("route 404", cl.get("/p/snapshots/s-nope").status_code == 404)
    check("route containers reachable only", [c["name"] for c in cl.get("/p/containers").json()["items"]] == ["web"])
    check("route changes", cl.get("/p/changes").json()["items"][0]["op"] == "write")
    check("route settings validation", cl.put("/p/settings", json={"exclude": ["a/b"]}).status_code == 400)
    check("route delete", cl.delete(f"/p/snapshots/{t['id']}").json()["ok"])
except ImportError:
    print("(fastapi test client not installed; route checks skipped)")

# --- without container access -----------------------------------------------------------------------------------
plugin_services.withdraw("fake-containers")
check("needs container access", "Container access" in raises(lambda: S.take("web", ["/srv/app"]), PermissionError))

root = os.environ["AXF_SNAPSHOT_MANAGER_DIR"]
check("data stays in dataDir", all(str(p).startswith(root) for p in Path(root).rglob("*")))
check("data files private", all((p.stat().st_mode & 0o077) == 0 for p in Path(root).rglob("*") if p.is_file()))
print(f"{ok} checks passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
