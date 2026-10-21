"""axf.containers@1 — the only code in the console that touches other containers.

Every call names an ``actor`` ({kind: user|agent|plugin, id, name}). Rules enforced here, server side:
  * protected containers (Coolify, Traefik/coolify-proxy, the console itself, the proxy, databases, plus your own
    patterns) are never read, written or run in; only an interactive terminal may open one, after an explicit confirm;
  * with reach = list, only allowed containers are reachable;
  * an agent never writes, deletes or runs a command without a snapshot id (Snapshot Manager), and only through an
    approved change batch;
  * every write, delete, command, restart, redeploy and terminal session goes to the audit log.
"""
from __future__ import annotations

import difflib
import hashlib
import json
import os
import posixpath
import re
import threading
import time
import urllib.request
from typing import Any, Callable

import plugin_services

from . import store
from .docker_api import Docker, DockerError

TEXT_LIMIT = 512 * 1024
HASH_LIMIT = 20_000_000  # files up to this size can be replaced (exact base hash); bigger ones are refused
_SKIP_DIRS = ("node_modules", ".git")


def _actor(a: dict[str, Any] | None) -> dict[str, Any]:
    a = dict(a or {})
    kind = a.get("kind") if a.get("kind") in ("user", "agent", "plugin") else "user"
    return {"kind": kind, "id": str(a.get("id") or ("console" if kind == "user" else "unknown"))[:80],
            "name": str(a.get("name") or a.get("id") or kind)[:80]}


def norm_path(p: str) -> str:
    p = str(p or "").strip()
    if not p.startswith("/"):
        raise ValueError(f"paths are absolute inside the container (got {p!r})")
    if "\x00" in p:
        raise ValueError("bad path")
    n = posixpath.normpath(p)
    if n.startswith("//"):
        n = "/" + n.lstrip("/")
    return n


_DANGEROUS = {"/", "/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/root", "/sbin", "/sys", "/usr", "/var"}


def _sha(b: bytes | None) -> str | None:
    return hashlib.sha256(b).hexdigest() if b is not None else None


class ContainersService:
    version = 1

    def __init__(self, docker: Docker | None = None):
        self._docker = docker
        self._apply_lock = threading.Lock()

    @property
    def docker(self) -> Docker:
        if self._docker is None or self._docker.url != os.environ.get("AXF_DOCKER_PROXY", self._docker.url):
            self._docker = Docker()
        return self._docker

    # ------------------------------------------------------------ discovery
    def status(self) -> dict[str, Any]:
        try:
            v = self.docker.ping()
            return {"ok": True, "url": self.docker.url, "docker": v.get("Version"), "api": v.get("ApiVersion")}
        except (DockerError, OSError, ValueError) as e:
            return {"ok": False, "url": os.environ.get("AXF_DOCKER_PROXY", ""), "error": str(e)}

    def list(self, include_hidden: bool = True) -> list[dict[str, Any]]:
        s = store.settings()
        out = []
        for c in self.docker.containers():
            name = (c.get("Names") or ["/?"])[0].lstrip("/")
            labels = c.get("Labels") or {}
            e = {"id": c.get("Id", "")[:64], "name": name, "image": c.get("Image", ""), "state": c.get("State", ""),
                 "status": c.get("Status", ""), "labels": {k: v for k, v in labels.items() if k.startswith(("coolify.", "axf.", "com.docker.compose."))}}
            prot = store.protection({**e, "labels": labels}, s)
            e["protected"] = prot
            e["reachable"] = not prot and store.reachable(e, s)
            e["coolify"] = _coolify_uuid(name, labels)
            if include_hidden or e["reachable"]:
                out.append(e)
        out.sort(key=lambda x: (not x["reachable"], x["name"]))
        return out

    def resolve(self, container: str, allow_protected: bool = False) -> dict[str, Any]:
        key = str(container or "").strip().lstrip("/")
        if not key:
            raise ValueError("container is required")
        cands = self.list()
        hit = next((c for c in cands if c["name"] == key), None) or next((c for c in cands if len(key) >= 6 and c["id"].startswith(key)), None)
        if not hit:
            raise KeyError(f"no container named {key!r}")
        if hit["protected"] and not allow_protected:
            raise PermissionError(f"{hit['name']} is protected ({hit['protected']['label']}); nothing in the console may touch it")
        if not hit["protected"] and not hit["reachable"]:
            raise PermissionError(f"{hit['name']} isn't on the reachable list (Settings → Plugins → Container access)")
        if hit["state"] != "running":
            raise PermissionError(f"{hit['name']} is {hit['state'] or 'not running'}")
        return hit

    def workdir(self, container: str) -> str:
        c = self.resolve(container)
        return (self.docker.inspect(c["id"]).get("Config") or {}).get("WorkingDir") or "/"

    # ------------------------------------------------------------ reads
    def stat(self, container: str, path: str) -> dict[str, Any] | None:
        c = self.resolve(container)
        return self.docker.stat(c["id"], norm_path(path))

    def read_file(self, container: str, path: str, max_bytes: int | None = None) -> dict[str, Any]:
        c = self.resolve(container)
        p = norm_path(path)
        lim = max_bytes or store.settings()["maxReadKb"] * 1024
        data, trunc, info = self.docker.read_file(c["id"], p, lim)
        try:
            text, enc = data.decode("utf-8"), "utf8"
        except UnicodeDecodeError:
            import base64
            text, enc = base64.b64encode(data).decode(), "base64"
        return {"container": c["name"], "path": p, "content": text, "encoding": enc, "truncated": trunc, **info}

    def _base(self, cid: str, path: str) -> tuple[bytes | None, bool]:
        """(content, exists) of a file about to be replaced, read in full up to HASH_LIMIT so its hash is exact. A file
        bigger than that can't be replaced safely (its change couldn't be checked) and raises."""
        try:
            data, trunc, _ = self.docker.read_file(cid, path, HASH_LIMIT)
        except DockerError as e:
            if e.status == 404:
                return None, False
            raise
        if trunc:
            raise ValueError(f"{path} is larger than {HASH_LIMIT // 1_000_000} MB; it can't be replaced through a change batch")
        return data, True

    def _read_bytes(self, cid: str, path: str) -> bytes | None:
        try:
            data, trunc, _ = self.docker.read_file(cid, path, TEXT_LIMIT)
            return None if trunc else data
        except DockerError as e:
            if e.status == 404:
                return None
            raise

    def list_dir(self, container: str, path: str, limit: int = 500) -> dict[str, Any]:
        c = self.resolve(container)
        p = norm_path(path)
        script = ('cd -- "$1" || exit 3; for f in * .*; do case "$f" in .|..) continue;; esac; '
                  '[ -e "$f" ] || [ -L "$f" ] || continue; if [ -L "$f" ]; then t=l; elif [ -d "$f" ]; then t=d; else t=f; fi; '
                  's=$(stat -c %s -- "$f" 2>/dev/null || echo 0); printf "%s\\t%s\\t%s\\n" "$t" "$s" "$f"; done')
        r = self.docker.run(c["id"], ["sh", "-c", script, "sh", p], env=["AXF_OP=listdir"], timeout=20, max_output=400_000)
        if r["exitCode"] == 3:
            raise KeyError(f"{p} is not a folder in {c['name']}")
        entries = []
        for line in r["output"].splitlines():
            parts = line.split("\t", 2)
            if len(parts) == 3:
                t, size, name = parts
                entries.append({"name": name, "type": {"d": "dir", "l": "link"}.get(t, "file"), "size": int(size) if size.isdigit() else 0})
        if r["exitCode"] not in (0, None) and not entries:
            raise DockerError(502, f"couldn't list {p}: {r['output'][:300]}")
        entries.sort(key=lambda e: (e["type"] != "dir", e["name"].lower()))
        return {"container": c["name"], "path": p, "entries": entries[:limit], "truncated": len(entries) > limit}

    def search(self, container: str, path: str, pattern: str, limit: int = 200) -> dict[str, Any]:
        c = self.resolve(container)
        p = norm_path(path)
        if not pattern or len(pattern) > 300:
            raise ValueError("pattern is 1–300 characters (searched literally)")
        excl = " ".join(f"--exclude-dir={d}" for d in _SKIP_DIRS)
        script = f'grep -rInIF {excl} -e "$1" -- "$2" 2>/dev/null | head -n "$3" | cut -c1-400'
        r = self.docker.run(c["id"], ["sh", "-c", script, "sh", pattern, p, str(limit)], env=["AXF_OP=search"], timeout=60, max_output=300_000)
        hits = []
        for line in r["output"].splitlines():
            f, _, rest = line.partition(":")
            ln, _, text = rest.partition(":")
            if ln.isdigit():
                hits.append({"path": f, "line": int(ln), "text": text})
        return {"container": c["name"], "path": p, "pattern": pattern, "hits": hits, "truncated": len(hits) >= limit}

    # ------------------------------------------------------------ writes (audited; agents need a snapshot)
    def _guard_agent(self, actor: dict[str, Any], snapshot: str | None) -> None:
        if actor["kind"] == "agent" and not snapshot:
            raise PermissionError("agents change containers only through an approved batch with a snapshot")

    def write_file(self, container: str, path: str, content: str, actor: dict[str, Any] | None = None, encoding: str = "utf8",
                   snapshot: str | None = None, batch: str | None = None, mode: int | None = None) -> dict[str, Any]:
        a = _actor(actor)
        self._guard_agent(a, snapshot)
        c = self.resolve(container)
        p = norm_path(path)
        if p in _DANGEROUS or p.endswith("/"):
            raise ValueError(f"refusing to write {p}")
        data = content.encode("utf-8") if encoding == "utf8" else __import__("base64").b64decode(content)
        st = self.docker.stat(c["id"], p)
        if st and st.get("isDir"):
            raise ValueError(f"{p} is a folder")
        uid = gid = 0
        own = self.docker.run(c["id"], ["sh", "-c", 'stat -c "%u %g" -- "$1" 2>/dev/null || stat -c "%u %g" -- "$(dirname -- "$1")"', "sh", p],
                              env=["AXF_OP=owner"], timeout=10)
        bits = own["output"].split()
        if len(bits) == 2 and all(b.isdigit() for b in bits):
            uid, gid = int(bits[0]), int(bits[1])
        perm = mode if mode is not None else (st.get("perm") if st else 0o644) or 0o644
        parent = posixpath.dirname(p)
        if not self.docker.stat(c["id"], parent):
            r = self.docker.run(c["id"], ["mkdir", "-p", "--", parent], env=["AXF_OP=mkdir"], timeout=15)
            if r["exitCode"] not in (0, None):
                raise DockerError(502, f"couldn't create {parent}: {r['output'][:200]}")
        try:
            self.docker.write_file(c["id"], p, data, mode=perm, uid=uid, gid=gid)
        except Exception as e:
            store.audit({"op": "write", "actor": a, "container": {"id": c["id"][:12], "name": c["name"]}, "path": p, "ok": False,
                         "error": str(e)[:300], "snapshot": snapshot, "batch": batch})
            raise
        store.audit({"op": "write", "actor": a, "container": {"id": c["id"][:12], "name": c["name"]}, "path": p, "bytes": len(data),
                     "created": not st, "ok": True, "snapshot": snapshot, "batch": batch})
        return {"ok": True, "path": p, "bytes": len(data), "created": not st}

    def delete_file(self, container: str, path: str, actor: dict[str, Any] | None = None, recursive: bool = False,
                    snapshot: str | None = None, batch: str | None = None) -> dict[str, Any]:
        a = _actor(actor)
        self._guard_agent(a, snapshot)
        c = self.resolve(container)
        p = norm_path(path)
        if p in _DANGEROUS or p.count("/") < 2:
            raise ValueError(f"refusing to delete {p} (top-level and system folders are off limits)")
        st = self.docker.stat(c["id"], p)
        if st is None:
            return {"ok": True, "path": p, "existed": False}
        if st.get("isDir") and not recursive:
            raise ValueError(f"{p} is a folder; set recursive to delete it and everything in it")
        r = self.docker.run(c["id"], ["rm", "-rf" if recursive else "-f", "--", p], env=["AXF_OP=delete"], timeout=120)
        ok = r["exitCode"] in (0, None)
        store.audit({"op": "delete", "actor": a, "container": {"id": c["id"][:12], "name": c["name"]}, "path": p, "recursive": recursive,
                     "ok": ok, "error": None if ok else r["output"][:300], "snapshot": snapshot, "batch": batch})
        if not ok:
            raise DockerError(502, f"rm failed: {r['output'][:300]}")
        return {"ok": True, "path": p, "existed": True}

    def exec(self, container: str, command: str, actor: dict[str, Any] | None = None, workdir: str = "", user: str = "",
             timeout: int | None = None, snapshot: str | None = None, batch: str | None = None,
             on_output: Callable[[str, str], None] | None = None) -> dict[str, Any]:
        a = _actor(actor)
        self._guard_agent(a, snapshot or ("none-needed" if a["kind"] != "agent" else None))
        c = self.resolve(container)
        cmd = str(command or "").strip()
        if not cmd or len(cmd) > 8000:
            raise ValueError("command is 1–8000 characters")
        wd = norm_path(workdir) if workdir else ""
        t = int(timeout or store.settings()["execTimeout"])
        started = time.time()
        r = self.docker.run(c["id"], ["sh", "-c", cmd], user=user, workdir=wd, timeout=t, on_output=on_output)
        store.audit({"op": "exec", "actor": a, "container": {"id": c["id"][:12], "name": c["name"]}, "command": cmd[:2000],
                     "workdir": wd, "user": user, "exitCode": r["exitCode"], "ok": r["exitCode"] == 0, "seconds": round(time.time() - started, 1),
                     "snapshot": snapshot, "batch": batch})
        return {**r, "container": c["name"]}

    def restart(self, container: str, actor: dict[str, Any] | None = None, batch: str | None = None) -> dict[str, Any]:
        a = _actor(actor)
        c = self.resolve(container)
        self.docker.restart(c["id"])
        store.audit({"op": "restart", "actor": a, "container": {"id": c["id"][:12], "name": c["name"]}, "ok": True, "batch": batch})
        return {"ok": True, "container": c["name"]}

    def redeploy(self, container: str, actor: dict[str, Any] | None = None, batch: str | None = None) -> dict[str, Any]:
        """Coolify-managed apps redeploy through Coolify's API so Coolify stays in sync; others can only restart."""
        a = _actor(actor)
        c = self.resolve(container)
        uuid = c.get("coolify")
        if not uuid:
            raise ValueError(f"{c['name']} isn't a Coolify app; restart it instead")
        url, tok = os.environ.get("COOLIFY_URL", "").rstrip("/"), os.environ.get("COOLIFY_TOKEN", "")
        if not url or not tok:
            raise PermissionError("set COOLIFY_URL and COOLIFY_TOKEN (Systems check → Coolify) to redeploy through Coolify")
        from axf_server import http as axf_http  # framework/python is on the path (store.py imports axf_framework)
        if not axf_http.target_ok(url, ("coolify",)):  # https, or Coolify's own container on the Docker network
            raise PermissionError(f"{url} isn't https: use http://coolify:8080 or Coolify's https address so the token isn't sent in the clear")
        req = urllib.request.Request(f"{url}/api/v1/deploy?uuid={uuid}&force=false", headers={"Authorization": f"Bearer {tok}", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310 — admin-configured Coolify URL
                body = json.loads(r.read() or b"{}")
        except Exception as e:  # noqa: BLE001
            store.audit({"op": "redeploy", "actor": a, "container": {"id": c["id"][:12], "name": c["name"]}, "ok": False, "error": str(e)[:300], "batch": batch})
            raise DockerError(502, f"Coolify refused the redeploy: {e}") from e
        store.audit({"op": "redeploy", "actor": a, "container": {"id": c["id"][:12], "name": c["name"]}, "coolify": uuid, "ok": True, "batch": batch})
        return {"ok": True, "container": c["name"], "coolify": body}

    # ------------------------------------------------------------ raw archives (for Snapshot Manager)
    def archive_open(self, container: str, path: str):
        """(info, conn, resp) for a tar stream of ``path`` (None when the path doesn't exist). The caller closes conn."""
        c = self.resolve(container)
        p = norm_path(path)
        st = self.docker.stat(c["id"], p)
        if st is None:
            return None
        conn, resp = self.docker.get_archive(c["id"], p, timeout=600)
        return {"container": c["name"], "id": c["id"], "path": p, "stat": st}, conn, resp

    def tree(self, container: str, path: str, exclude: list[str] | None = None, limit: int = 100_000) -> list[str] | None:
        """Absolute paths under ``path`` (itself included), skipping excluded folder names. None when it can't be listed."""
        c = self.resolve(container)
        p = norm_path(path)
        ex = [x for x in (exclude or []) if re.match(r"^[A-Za-z0-9_.-]{1,64}$", x)]
        prune = " -o ".join(f"-name {x}" for x in ex)
        script = f'find "$1" \\( {prune} \\) -prune -o -print 2>/dev/null | head -n "$2"' if ex else 'find "$1" -print 2>/dev/null | head -n "$2"'
        r = self.docker.run(c["id"], ["sh", "-c", script, "sh", p, str(limit)], env=["AXF_OP=tree"], timeout=120, max_output=50_000_000)
        if r["exitCode"] not in (0, None) and not r["output"]:
            return None
        return [x for x in r["output"].splitlines() if x.startswith("/")]

    def archive_restore(self, container: str, path: str, tar_data: Any, actor: dict[str, Any] | None = None,
                        snapshot: str | None = None, remove: list[str] | None = None, replace: bool = False) -> dict[str, Any]:
        """Put ``path`` back from a snapshot's tar (bytes or an open uncompressed tar file).
        ``tar_data`` None: the path didn't exist at snapshot time, so it's removed. ``replace``: remove the path first
        (a single file, or a type change). ``remove``: paths under ``path`` that are newer than the snapshot."""
        a = _actor(actor)
        c = self.resolve(container)
        p = norm_path(path)
        if p in _DANGEROUS:
            raise ValueError(f"refusing to restore over {p}")
        doomed = [p] if tar_data is None or replace else [norm_path(x) for x in (remove or [])]
        for x in doomed:
            if x != p and not x.startswith(p.rstrip("/") + "/"):
                raise ValueError(f"{x} is outside {p}")
        for i in range(0, len(doomed), 200):
            chunk = doomed[i:i + 200]
            r = self.docker.run(c["id"], ["rm", "-rf", "--", *chunk], env=["AXF_OP=delete"], timeout=300)
            if r["exitCode"] not in (0, None):
                raise DockerError(502, f"couldn't clear {chunk[0]} before restoring: {r['output'][:200]}")
        if tar_data is not None:
            parent = posixpath.dirname(p) or "/"
            if not self.docker.stat(c["id"], parent):
                self.docker.run(c["id"], ["mkdir", "-p", "--", parent], env=["AXF_OP=mkdir"], timeout=15)
            self.docker.put_archive(c["id"], parent, tar_data, timeout=900)
        store.audit({"op": "restore", "actor": a, "container": {"id": c["id"][:12], "name": c["name"]}, "path": p,
                     "removed": len(doomed) if tar_data is not None else "all", "ok": True, "snapshot": snapshot})
        return {"ok": True, "path": p, "removed": len(doomed)}

    # ------------------------------------------------------------ terminal
    def tty(self, container: str, actor: dict[str, Any] | None = None, cwd: str = "", user: str = "", allow_protected: bool = False,
            cols: int = 100, rows: int = 30, command: list[str] | None = None, env: list[str] | None = None):
        a = _actor(actor)
        if a["kind"] == "agent":
            raise PermissionError("agents don't get interactive terminals")
        c = self.resolve(container, allow_protected=allow_protected)
        wd = norm_path(cwd) if cwd else ""
        if wd:
            st = self.docker.stat(c["id"], wd)
            if not st:
                wd = ""
            elif not st.get("isDir"):
                wd = posixpath.dirname(wd)
        u = user or store.settings()["terminalUser"]
        cmd = command or ["sh", "-c", "if command -v bash >/dev/null 2>&1; then exec bash -l; else exec sh -l; fi"]
        sess = self.docker.tty(c["id"], cmd, user=u, workdir=wd, env=["TERM=xterm-256color", *(env or [])], cols=cols, rows=rows)
        store.audit({"op": "terminal", "actor": a, "container": {"id": c["id"][:12], "name": c["name"]}, "workdir": wd, "user": u,
                     "protected": bool(c["protected"]), "ok": True})
        return sess, c

    # ------------------------------------------------------------ audit
    def audit(self, limit: int = 200, container: str = "", op: str = "", batch: str = "") -> list[dict[str, Any]]:
        return store.read_audit(limit, container, op, batch)

    # ------------------------------------------------------------ change batches (approval cards)
    def create_batch(self, items: list[dict[str, Any]], actor: dict[str, Any] | None = None, conversation: str = "", turn: str = "",
                     title: str = "") -> dict[str, Any]:
        """Stage proposed changes for approval. Validates targets now, computes diffs; nothing is changed."""
        a = _actor(actor)
        if not items:
            raise ValueError("a batch needs at least one change")
        out = []
        for i, raw in enumerate(items[:50]):
            kind = raw.get("kind")
            it: dict[str, Any] = {"id": f"i{i + 1}", "kind": kind, "status": "pending", "reason": str(raw.get("reason") or "")[:500]}
            try:
                c = self.resolve(raw.get("container", ""))
                it["container"] = c["name"]
                if kind == "write":
                    p = norm_path(raw.get("path", ""))
                    content = str(raw.get("content") or "")
                    if len(content.encode()) > 2_000_000:
                        raise ValueError("file too large for one change (2 MB)")
                    cur, exists = self._base(c["id"], p)
                    it.update(path=p, content=content, baseHash=_sha(cur) if exists else None, created=not exists, bytes=len(content.encode()))
                    it["diff"] = _diff(cur, content.encode(), p) if (cur is None or len(cur) <= 2_000_000) else {"added": 0, "removed": 0, "text": "", "tooLarge": True}
                    d = it["diff"]
                    it["unseen"] = bool(d.get("truncated") or d.get("binary") or d.get("tooLarge"))
                elif kind == "delete":
                    p = norm_path(raw.get("path", ""))
                    st = self.docker.stat(c["id"], p)
                    it.update(path=p, recursive=bool(raw.get("recursive")), exists=st is not None, isDir=bool(st and st.get("isDir")))
                elif kind == "exec":
                    cmd = str(raw.get("command") or "").strip()
                    if not cmd:
                        raise ValueError("command is required")
                    wd = norm_path(raw["workdir"]) if raw.get("workdir") else ""
                    paths = [norm_path(x) for x in (raw.get("paths") or [])][:20]
                    if not paths:
                        d = wd or self.workdir(c["name"])
                        paths = [d] if d != "/" else []
                    if not paths:
                        raise ValueError("say which folders the command changes (paths), so they can be snapshotted first; the whole filesystem can't be")
                    it.update(command=cmd, workdir=wd, paths=paths, timeout=int(raw.get("timeout") or 0) or None)
                elif kind in ("restart", "redeploy"):
                    if kind == "redeploy" and not c.get("coolify"):
                        raise ValueError(f"{c['name']} isn't a Coolify app; use restart")
                else:
                    raise ValueError(f"unknown change kind {kind!r}")
            except (ValueError, KeyError, PermissionError, DockerError) as e:
                it.update(status="invalid", error=str(e).strip("'\""), container=str(raw.get("container") or ""), path=raw.get("path"))
            out.append(it)
        b = {"$axf": "change-batch@1", "id": store.new_batch_id(), "createdAt": int(time.time() * 1000), "actor": a,
             "conversation": str(conversation or "")[:80], "turn": str(turn or "")[:80], "title": str(title or "")[:200],
             "status": "pending", "items": out, "snapshots": []}
        store.prune_batches()
        return store.save_batch(b)

    def get_batch(self, bid: str) -> dict[str, Any]:
        return store.get_batch(bid)

    def list_batches(self, status: str = "", conversation: str = "", limit: int = 50) -> list[dict[str, Any]]:
        return store.list_batches(status, conversation, limit)

    def reject_batch(self, bid: str, approver: dict[str, Any] | None = None) -> dict[str, Any]:
        b = store.get_batch(bid)
        if b["status"] != "pending":
            raise ValueError(f"batch is {b['status']}")
        b["status"] = "rejected"
        b["decidedBy"] = _actor(approver)
        for it in b["items"]:
            if it["status"] == "pending":
                it["status"] = "rejected"
        store.audit({"op": "batch-reject", "actor": _actor(approver), "batch": bid, "ok": True})
        return store.save_batch(b)

    def approve_batch(self, bid: str, item_ids: list[str] | None, approver: dict[str, Any] | None = None,
                      on_event: Callable[[dict[str, Any]], None] | None = None, accept_unseen: bool = False) -> dict[str, Any]:
        """Snapshot first (one snapshot per container, all linked to the batch), then apply the ticked items in order.
        Stops at the first failure; the rest are skipped. Nothing is written when the snapshot fails."""
        emit = on_event or (lambda e: None)
        if not self._apply_lock.acquire(timeout=1):
            raise ValueError("another batch is being applied; wait for it to finish")
        try:
            b = store.get_batch(bid)
            if b["status"] != "pending":
                raise ValueError(f"batch is {b['status']}")
            snaps = plugin_services.get("axf.snapshots@1")
            if not snaps:
                raise PermissionError("Snapshot Manager isn't installed or enabled, so nothing is written (every change needs a snapshot first)")
            who = _actor(approver)
            chosen = set(item_ids) if item_ids is not None else {it["id"] for it in b["items"]}
            sel = [it for it in b["items"] if it["id"] in chosen and it["status"] == "pending"]
            for it in b["items"]:
                if it["status"] == "pending" and it not in sel:
                    it["status"] = "skipped"
            if not sel:
                raise ValueError("nothing ticked to apply")
            if not accept_unseen and any(it.get("unseen") for it in sel):
                raise ValueError("some changes can't be fully shown (diff cut short, binary or very large file); tick “accept what I can't see” to apply them")
            agent = b["actor"]
            b.update(status="applying", decidedBy=who, approvedAt=int(time.time() * 1000))
            store.save_batch(b)
            # 1. snapshots
            cover: dict[str, list[str]] = {}
            for it in sel:
                paths = [it["path"]] if it["kind"] in ("write", "delete") else it.get("paths", []) if it["kind"] == "exec" else []
                for p in paths:
                    lst = cover.setdefault(it["container"], [])
                    if p not in lst:
                        lst.append(p)
            for cname, paths in cover.items():  # a path inside another covered folder is already in its snapshot
                cover[cname] = [p for p in paths if not any(q != p and p.startswith(q.rstrip("/") + "/") for q in paths)]
            snap_for: dict[str, str] = {}
            for cname, paths in cover.items():
                emit({"type": "snapshot-start", "container": cname, "paths": paths})
                try:
                    self.resolve(cname)
                    s = snaps.take(cname, paths, reason=f"before change batch {bid}" + (f": {b['title']}" if b.get("title") else ""),
                                   actor=agent, batch=bid, meta={"conversation": b.get("conversation"), "turn": b.get("turn"), "approvedBy": who})
                except Exception as e:  # noqa: BLE001
                    for it in sel:
                        it["status"] = "skipped"
                    b.update(status="failed", error=f"snapshot of {cname} failed, nothing was changed: {e}")
                    store.audit({"op": "batch-approve", "actor": who, "batch": bid, "ok": False, "error": b["error"][:300]})
                    emit({"type": "error", "error": b["error"]})
                    return store.save_batch(b)
                snap_for[cname] = s["id"]
                b["snapshots"].append(s["id"])
                emit({"type": "snapshot", "container": cname, "id": s["id"], "bytes": s.get("bytes", 0)})
            store.save_batch(b)
            # 2. apply in order
            failed = False
            for it in sel:
                if failed:
                    it["status"] = "skipped"
                    continue
                emit({"type": "item-start", "item": it["id"]})
                sid = snap_for.get(it["container"])
                if it["kind"] in ("write", "delete", "exec") and not sid:
                    it.update(status="failed", error="no snapshot covers this change, so it wasn't applied")
                    failed = True
                    emit({"type": "item-done", "item": it["id"], "ok": False, "error": it["error"]})
                    store.save_batch(b)
                    continue
                try:
                    if it["kind"] == "write":
                        cur, exists = self._base(self.resolve(it["container"])["id"], it["path"])
                        if (_sha(cur) if exists else None) != it.get("baseHash"):
                            raise ValueError("the file changed since this was proposed; ask for a fresh proposal")
                        r = self.write_file(it["container"], it["path"], it["content"], actor=agent, snapshot=sid, batch=bid)
                    elif it["kind"] == "delete":
                        r = self.delete_file(it["container"], it["path"], actor=agent, recursive=it.get("recursive", False), snapshot=sid, batch=bid)
                    elif it["kind"] == "exec":
                        r = self.exec(it["container"], it["command"], actor=agent, workdir=it.get("workdir", ""), timeout=it.get("timeout"),
                                      snapshot=sid, batch=bid, on_output=lambda st, tx, iid=it["id"]: emit({"type": "output", "item": iid, "stream": st, "text": tx}))
                        it["exitCode"], it["output"] = r["exitCode"], r["output"][-20000:]
                        if r["exitCode"] != 0:
                            raise ValueError(f"command exited with {r['exitCode']}")
                    elif it["kind"] == "restart":
                        r = self.restart(it["container"], actor=agent, batch=bid)
                    else:
                        r = self.redeploy(it["container"], actor=agent, batch=bid)
                    it["status"] = "applied"
                    it["snapshot"] = snap_for.get(it["container"])
                    emit({"type": "item-done", "item": it["id"], "ok": True})
                except Exception as e:  # noqa: BLE001
                    it.update(status="failed", error=str(e).strip("'\"")[:500])
                    failed = True
                    emit({"type": "item-done", "item": it["id"], "ok": False, "error": it["error"]})
                store.save_batch(b)
            done = [it for it in sel if it["status"] == "applied"]
            b["status"] = "applied" if len(done) == len(sel) else ("partial" if done else "failed")
            store.audit({"op": "batch-approve", "actor": who, "batch": bid, "ok": b["status"] == "applied", "items": len(sel),
                         "applied": len(done), "snapshots": b["snapshots"]})
            emit({"type": "done", "status": b["status"]})
            return store.save_batch(b)
        finally:
            self._apply_lock.release()

    def undo_batch(self, bid: str, approver: dict[str, Any] | None = None) -> dict[str, Any]:
        """Restore every snapshot of the batch (newest first). Snapshot Manager snapshots the current state first."""
        if not self._apply_lock.acquire(timeout=1):
            raise ValueError("a batch is being applied; undo once it has finished")
        try:
            b = store.get_batch(bid)
            if b["status"] not in ("applied", "partial", "failed"):
                raise ValueError(f"batch is {b['status']}; only an applied, partial or failed batch can be undone")
            if not b.get("snapshots"):
                raise ValueError("this batch has no snapshots to restore")
            snaps = plugin_services.get("axf.snapshots@1")
            if not snaps:
                raise PermissionError("Snapshot Manager isn't installed or enabled")
            who = _actor(approver)
            results = [snaps.restore(sid, actor=who) for sid in reversed(b["snapshots"])]
            b["status"] = "undone"
            b["undoneAt"] = int(time.time() * 1000)
            b["undoSnapshots"] = [r.get("before") for r in results]
            store.audit({"op": "batch-undo", "actor": who, "batch": bid, "ok": True, "snapshots": b["snapshots"]})
            return store.save_batch(b)
        finally:
            self._apply_lock.release()


    # ------------------------------------------------------------ approval as a stream (for routes)
    def approve_stream(self, bid: str, items: list[str] | None, who: dict[str, Any] | None, accept_unseen: bool = False):
        """Server-sent events for an approval: snapshot-start, snapshot, item-start, output, item-done, done | error, then
        ``batch`` (public form). Used by this plugin's route and by consumers that proxy it (the assistant's chat card)."""
        import queue
        q: queue.Queue = queue.Queue()

        def run() -> None:
            try:
                q.put({"type": "batch", "batch": self.public_batch(self.approve_batch(bid, items, who, on_event=q.put, accept_unseen=accept_unseen))})
            except Exception as e:  # noqa: BLE001
                q.put({"type": "error", "error": str(e).strip("'\"")})
            q.put(None)

        threading.Thread(target=run, daemon=True).start()
        while True:
            ev = q.get()
            if ev is None:
                return
            yield f"data: {json.dumps(ev)}\n\n"

    @staticmethod
    def public_batch(b: dict[str, Any]) -> dict[str, Any]:
        """The batch as a browser sees it: the full new content stays server-side (the diff shows the change)."""
        out = dict(b)
        out["items"] = [{k: v for k, v in it.items() if k not in ("content", "baseHash")} for it in b.get("items", [])]
        return out


def _coolify_uuid(name: str, labels: dict[str, str]) -> str | None:
    for k in ("coolify.applicationUuid", "coolify.uuid", "coolify.resourceUuid"):
        if labels.get(k):
            return labels[k]
    if labels.get("coolify.managed") == "true" and labels.get("coolify.type", "application") == "application":
        head = name.split("-", 1)[0]
        if 16 <= len(head) <= 40 and head.isalnum():
            return head
    return None


def _diff(old: bytes | None, new: bytes, path: str, max_lines: int = 600) -> dict[str, Any]:
    if old is None:
        try:
            lines = new.decode("utf-8").splitlines()
        except UnicodeDecodeError:
            return {"binary": True, "added": 0, "removed": 0, "text": ""}
        text = "\n".join(["--- /dev/null", f"+++ {path}", f"@@ -0,0 +1,{len(lines)} @@", *["+" + x for x in lines]])
        return {"added": len(lines), "removed": 0, "text": "\n".join(text.splitlines()[:max_lines]), "truncated": len(lines) + 3 > max_lines}
    try:
        a, b = old.decode("utf-8").splitlines(), new.decode("utf-8").splitlines()
    except UnicodeDecodeError:
        return {"binary": True, "added": 0, "removed": 0, "text": ""}
    d = list(difflib.unified_diff(a, b, path, path, lineterm="", n=3))
    add = sum(1 for x in d if x.startswith("+") and not x.startswith("+++"))
    rem = sum(1 for x in d if x.startswith("-") and not x.startswith("---"))
    return {"added": add, "removed": rem, "text": "\n".join(d[:max_lines]), "truncated": len(d) > max_lines}
