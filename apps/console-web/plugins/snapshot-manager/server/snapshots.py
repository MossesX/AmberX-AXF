"""axf.snapshots@1 — file snapshots of containers, taken before every approved change, restorable in one step.

Layout (all inside the plugin's dataDir):
  settings.json                         retention (keep N days, cap N GB), per-snapshot cap, excluded folder names
  snaps/<id>/manifest.json              container, paths, who, when, why, batch, linked chat turn, sizes
  snaps/<id>/<n>.tar.gz                 the files of path n as they were (excluded folders skipped)
  snaps/<id>/<n>.files.json             [name, type, size, sha256|null] for every member (diff + exact restore)

Restore takes a fresh snapshot of the same paths first, so an undo can itself be undone. Files that are newer than the
snapshot are removed; excluded folders (node_modules…) are never touched by a restore.
"""
from __future__ import annotations

import difflib
import gzip
import hashlib
import json
import os
import posixpath
import re
import secrets
import shutil
import tarfile
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

import plugin_services

ROOT = Path(os.environ.get("AXF_ROOT", Path(__file__).resolve().parents[5])).resolve()
DATA = Path(os.environ.get("AXF_SNAPSHOT_MANAGER_DIR", ROOT / ".axf-console" / "plugins" / "snapshot-manager"))
SNAPS = DATA / "snaps"
HASH_LIMIT = 2 * 1024 * 1024
FILES_LIMIT = 100_000
_ID = re.compile(r"^s-[0-9]{14}-[a-f0-9]{8}$")
_lock = threading.RLock()

DEFAULTS: dict[str, Any] = {"$axf": "snapshot-settings@1", "keepDays": 30, "maxGb": 5.0, "maxSnapshotMb": 1024,
                            "exclude": ["node_modules", "__pycache__", ".cache", ".pnpm-store", ".venv", ".gradle", ".turbo"]}


def _actor(a: dict[str, Any] | None) -> dict[str, Any]:
    a = dict(a or {})
    return {"kind": a.get("kind") or "user", "id": str(a.get("id") or "console")[:80], "name": str(a.get("name") or a.get("id") or "console")[:80]}


def _write_json(p: Path, data: Any) -> None:
    p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = p.with_suffix(p.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.chmod(tmp, 0o600)
    os.replace(tmp, p)


def _read_json(p: Path, default: Any) -> Any:
    try:
        return json.loads(p.read_text("utf-8"))
    except (OSError, ValueError):
        return default


def settings() -> dict[str, Any]:
    return {**DEFAULTS, **_read_json(DATA / "settings.json", {})}


def save_settings(patch: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        s = settings()
        if "keepDays" in patch:
            s["keepDays"] = max(1, min(int(patch["keepDays"]), 3650))
        if "maxGb" in patch:
            s["maxGb"] = max(0.1, min(float(patch["maxGb"]), 1000.0))
        if "maxSnapshotMb" in patch:
            s["maxSnapshotMb"] = max(10, min(int(patch["maxSnapshotMb"]), 20480))
        if "exclude" in patch:
            ex = [str(x).strip() for x in patch["exclude"] or [] if str(x).strip()]
            bad = [x for x in ex if not re.match(r"^[A-Za-z0-9_.-]{1,64}$", x) or x in (".", "..")]
            if bad:
                raise ValueError(f"excluded entries are folder names (letters, digits, . _ -): {bad[0]!r}")
            s["exclude"] = sorted(set(ex))[:50]
        _write_json(DATA / "settings.json", s)
        return s


def _excluded(name: str, exclude: list[str]) -> bool:
    parts = name.strip("/").split("/")
    return any(p in exclude for p in parts[1:] if p)  # never the snapshotted path itself


def _dir_size(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())


class SnapshotsService:
    version = 1

    def __init__(self) -> None:
        self._busy = threading.Lock()

    @staticmethod
    def _containers():
        c = plugin_services.get("axf.containers@1")
        if not c:
            raise PermissionError("Container access isn't installed or enabled; snapshots need it to read containers")
        return c

    # ------------------------------------------------------------ take
    def take(self, container: str, paths: list[str], reason: str = "", actor: dict[str, Any] | None = None, batch: str | None = None,
             meta: dict[str, Any] | None = None) -> dict[str, Any]:
        cs = self._containers()
        s = settings()
        cap = int(s["maxSnapshotMb"]) * 1024 * 1024
        clean = []
        for p in paths or []:
            n = posixpath.normpath(str(p))
            if not n.startswith("/") or n == "/":
                raise ValueError(f"snapshot paths are absolute and not / (got {p!r})")
            if n not in clean:
                clean.append(n)
        sid = f"s-{time.strftime('%Y%m%d%H%M%S')}-{secrets.token_hex(4)}"
        d = SNAPS / sid
        d.mkdir(parents=True, mode=0o700)
        entries: list[dict[str, Any]] = []
        total = 0
        cname = container
        try:
            for i, p in enumerate(clean):
                opened = cs.archive_open(container, p)
                if opened is None:
                    entries.append({"n": i, "path": p, "existed": False})
                    continue
                info, conn, resp = opened
                cname = info["container"]
                files: list[list[Any]] = []
                skipped = 0
                raw = 0
                try:
                    with tarfile.open(fileobj=resp, mode="r|") as src, gzip.open(d / f"{i}.tar.gz", "wb", compresslevel=6) as gz, \
                            tarfile.open(fileobj=gz, mode="w|", format=tarfile.PAX_FORMAT) as out:
                        for m in src:
                            if _excluded(m.name, s["exclude"]):
                                skipped += 1
                                continue
                            sha = None
                            if m.isfile():
                                f = src.extractfile(m)
                                if m.size <= HASH_LIMIT:
                                    data = f.read() if f else b""
                                    sha = hashlib.sha256(data).hexdigest()
                                    out.addfile(m, __import__("io").BytesIO(data))
                                else:
                                    out.addfile(m, f)
                                raw += m.size
                            else:
                                out.addfile(m)
                            if len(files) < FILES_LIMIT:
                                files.append([m.name, "d" if m.isdir() else "l" if (m.issym() or m.islnk()) else "f", m.size, sha])
                            if raw > cap:
                                raise ValueError(f"{p} is bigger than the per-snapshot cap ({s['maxSnapshotMb']} MB); add excluded folders or raise the cap")
                finally:
                    conn.close()
                os.chmod(d / f"{i}.tar.gz", 0o600)
                _write_json(d / f"{i}.files.json", files)
                size = (d / f"{i}.tar.gz").stat().st_size
                total += size
                entries.append({"n": i, "path": p, "existed": True, "isDir": bool(info["stat"].get("isDir")), "files": len(files),
                                "filesTruncated": len(files) >= FILES_LIMIT, "skipped": skipped, "rawBytes": raw, "bytes": size})
        except Exception:
            shutil.rmtree(d, ignore_errors=True)
            raise
        m = {"$axf": "snapshot@1", "id": sid, "container": cname, "paths": clean, "entries": entries, "bytes": total,
             "createdAt": int(time.time() * 1000), "actor": _actor(actor), "reason": str(reason or "")[:500], "batch": batch,
             "meta": {k: v for k, v in (meta or {}).items() if isinstance(v, (str, int, float, bool, dict, type(None)))}, "exclude": s["exclude"]}
        _write_json(d / "manifest.json", m)
        self.prune(keep={sid})
        return m

    # ------------------------------------------------------------ read
    def get(self, sid: str) -> dict[str, Any]:
        if not _ID.match(sid or ""):
            raise KeyError("no such snapshot")
        m = _read_json(SNAPS / sid / "manifest.json", None)
        if not m:
            raise KeyError("no such snapshot")
        return m

    def list(self, container: str = "", batch: str = "", limit: int = 200) -> list[dict[str, Any]]:
        if not SNAPS.exists():
            return []
        out = []
        for d in sorted(SNAPS.iterdir(), reverse=True):
            if not _ID.match(d.name):
                continue
            m = _read_json(d / "manifest.json", None)
            if not m or (container and m.get("container") != container) or (batch and m.get("batch") != batch):
                continue
            out.append(m)
            if len(out) >= limit:
                break
        return out

    def usage(self) -> dict[str, Any]:
        items = self.list(limit=100_000)
        s = settings()
        return {"count": len(items), "bytes": sum(m.get("bytes", 0) for m in items), "capBytes": int(s["maxGb"] * 1024 ** 3),
                "keepDays": s["keepDays"], "oldest": min((m["createdAt"] for m in items), default=None)}

    def _files(self, sid: str, n: int) -> list[list[Any]]:
        return _read_json(SNAPS / sid / f"{n}.files.json", [])

    def _member(self, sid: str, n: int, name: str) -> bytes | None:
        p = SNAPS / sid / f"{n}.tar.gz"
        with tarfile.open(p, mode="r:gz") as tf:
            for m in tf:
                if m.name == name and m.isfile():
                    f = tf.extractfile(m)
                    return f.read(HASH_LIMIT * 4) if f else b""
        return None

    # ------------------------------------------------------------ diff
    def diff(self, sid: str, file: str = "") -> dict[str, Any]:
        """What changed since the snapshot: per path, files added / removed / changed. With ``file``: a unified diff."""
        m = self.get(sid)
        cs = self._containers()
        if file:
            f = posixpath.normpath(file)
            for e in m["entries"]:
                base = posixpath.dirname(e["path"])
                if f == e["path"] or f.startswith(e["path"].rstrip("/") + "/"):
                    name = posixpath.relpath(f, base) if base != "/" else f.lstrip("/")
                    old = self._member(sid, e["n"], name) if e["existed"] else None
                    try:
                        cur = cs.read_file(m["container"], f, max_bytes=HASH_LIMIT * 4)
                        new = cur["content"].encode() if cur["encoding"] == "utf8" else None
                    except Exception:  # noqa: BLE001 — gone now
                        new = None
                    return {"file": f, "then": old is not None, "now": new is not None, "diff": _udiff(old, new, f)}
            raise KeyError(f"{file} isn't in this snapshot")
        out = []
        for e in m["entries"]:
            if not e["existed"]:
                now = cs.stat(m["container"], e["path"])
                out.append({"path": e["path"], "existed": False, "existsNow": now is not None})
                continue
            then = {x[0]: x for x in self._files(sid, e["n"]) if x[1] == "f"}
            now = self._current(cs, m["container"], e["path"], m.get("exclude", []))
            if now is None:
                out.append({"path": e["path"], "existed": True, "existsNow": False})
                continue
            base = posixpath.dirname(e["path"])
            pref = lambda n: (base.rstrip("/") + "/" + n) if base != "/" else "/" + n  # noqa: E731
            added = sorted(pref(k) for k in now if k not in then)
            removed = sorted(pref(k) for k in then if k not in now)
            changed = sorted(pref(k) for k in now if k in then and (now[k][2] != then[k][2] or (now[k][3] and then[k][3] and now[k][3] != then[k][3])))
            out.append({"path": e["path"], "existed": True, "existsNow": True, "added": added[:500], "removed": removed[:500],
                        "changed": changed[:500], "counts": {"added": len(added), "removed": len(removed), "changed": len(changed)}})
        return {"id": sid, "container": m["container"], "entries": out}

    def _current(self, cs, container: str, path: str, exclude: list[str]) -> dict[str, list[Any]] | None:
        opened = cs.archive_open(container, path)
        if opened is None:
            return None
        _info, conn, resp = opened
        out: dict[str, list[Any]] = {}
        seen = 0
        try:
            with tarfile.open(fileobj=resp, mode="r|") as tf:
                for mm in tf:
                    if _excluded(mm.name, exclude) or not mm.isfile():
                        continue
                    sha = None
                    if mm.size <= HASH_LIMIT:
                        f = tf.extractfile(mm)
                        sha = hashlib.sha256(f.read() if f else b"").hexdigest()
                    out[mm.name] = [mm.name, "f", mm.size, sha]
                    seen += mm.size
                    if seen > 512 * 1024 * 1024 or len(out) > FILES_LIMIT:
                        break
        finally:
            conn.close()
        return out

    # ------------------------------------------------------------ restore
    def restore(self, sid: str, actor: dict[str, Any] | None = None) -> dict[str, Any]:
        m = self.get(sid)
        cs = self._containers()
        if not self._busy.acquire(timeout=1):
            raise ValueError("another restore is running")
        try:
            before = self.take(m["container"], m["paths"], reason=f"before restoring {sid}", actor=actor, batch=m.get("batch"),
                               meta={"restoreOf": sid})
            results = []
            for e in m["entries"]:
                if not e["existed"]:
                    cs.archive_restore(m["container"], e["path"], None, actor=actor, snapshot=sid)
                    results.append({"path": e["path"], "removed": True})
                    continue
                base = posixpath.dirname(e["path"])
                pref = lambda n: (base.rstrip("/") + "/" + n) if base != "/" else "/" + n  # noqa: E731
                with tempfile.TemporaryFile(dir=DATA) as tmp:
                    with gzip.open(SNAPS / sid / f"{e['n']}.tar.gz", "rb") as gz:
                        shutil.copyfileobj(gz, tmp, 1024 * 1024)
                    tmp.seek(0)
                    if e.get("isDir"):
                        keep = {pref(x[0]) for x in self._files(sid, e["n"])}
                        now = cs.tree(m["container"], e["path"], m.get("exclude", []))
                        extra = []
                        if now is not None and not e.get("filesTruncated"):
                            for x in sorted(now):
                                if x not in keep and not any(x.startswith(y + "/") for y in extra):
                                    extra.append(x)
                        cs.archive_restore(m["container"], e["path"], tmp, actor=actor, snapshot=sid, remove=extra)
                        results.append({"path": e["path"], "removed": len(extra)})
                    else:
                        cs.archive_restore(m["container"], e["path"], tmp, actor=actor, snapshot=sid, replace=True)
                        results.append({"path": e["path"], "replaced": True})
            mm = self.get(sid)
            mm.setdefault("restores", []).append({"at": int(time.time() * 1000), "by": _actor(actor), "before": before["id"]})
            _write_json(SNAPS / sid / "manifest.json", mm)
            return {"ok": True, "restored": sid, "before": before["id"], "results": results}
        finally:
            self._busy.release()

    # ------------------------------------------------------------ delete / retention
    def delete(self, sid: str) -> dict[str, Any]:
        self.get(sid)
        shutil.rmtree(SNAPS / sid, ignore_errors=True)
        return {"ok": True, "deleted": sid}

    def prune(self, keep: set[str] | None = None) -> dict[str, Any]:
        """Drop snapshots older than keepDays, then the oldest until the total fits under maxGb."""
        with _lock:
            s = settings()
            keep = keep or set()
            items = sorted(self.list(limit=1_000_000), key=lambda m: m["createdAt"])
            cut = (time.time() - s["keepDays"] * 86400) * 1000
            removed = []
            for m in items:
                if m["createdAt"] < cut and m["id"] not in keep:
                    shutil.rmtree(SNAPS / m["id"], ignore_errors=True)
                    removed.append(m["id"])
            left = [m for m in items if m["id"] not in removed]
            total = sum(m.get("bytes", 0) for m in left)
            cap = s["maxGb"] * 1024 ** 3
            for m in left:
                if total <= cap:
                    break
                if m["id"] in keep:
                    continue
                shutil.rmtree(SNAPS / m["id"], ignore_errors=True)
                removed.append(m["id"])
                total -= m.get("bytes", 0)
            # leftovers of interrupted snapshots (no manifest) older than an hour
            if SNAPS.exists():
                for d in SNAPS.iterdir():
                    if d.is_dir() and not (d / "manifest.json").exists() and d.stat().st_mtime < time.time() - 3600:
                        shutil.rmtree(d, ignore_errors=True)
            return {"removed": removed, "bytes": total}


def _udiff(old: bytes | None, new: bytes | None, path: str) -> dict[str, Any]:
    try:
        a = old.decode("utf-8").splitlines() if old is not None else []
        b = new.decode("utf-8").splitlines() if new is not None else []
    except UnicodeDecodeError:
        return {"binary": True, "text": "", "added": 0, "removed": 0}
    d = list(difflib.unified_diff(a, b, f"{path} (snapshot)" if old is not None else "/dev/null", f"{path} (now)" if new is not None else "/dev/null", lineterm=""))
    return {"text": "\n".join(d[:1500]), "truncated": len(d) > 1500, "added": sum(1 for x in d if x.startswith("+") and not x.startswith("+++")),
            "removed": sum(1 for x in d if x.startswith("-") and not x.startswith("---"))}
