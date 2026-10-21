"""Each person's sandbox files: a private folder per hub account inside the plugin's data folder.

    <dataDir>/workspaces/<user-slug>/files/<path>      the editable files
    <dataDir>/workspaces/<user-slug>/meta.json         who, created, last used

Files stay until an admin clears them (Settings → Plugins → Sandbox → Workspaces); a person can delete their own.
Every path is checked by `shield.file_path_ok`, resolved, and must stay inside the person's `files/` folder; symlinks are
never followed or created; writes are atomic and 0600 (folders 0700) through the framework's `axf_server.storage`.
"""
from __future__ import annotations

import os
import shutil
import threading
import time
from pathlib import Path
from typing import Any

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import storage

from .shield import ShieldError, file_path_ok, user_slug

_lock = threading.RLock()


class Workspaces:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    # ---------- folders
    def _base(self, user: str) -> Path:
        return self.root / "workspaces" / user_slug(user)

    def _files(self, user: str) -> Path:
        return self._base(user) / "files"

    def _target(self, user: str, path: str) -> Path:
        if not file_path_ok(path):
            raise ShieldError("not a sandbox file name (plain names and folders, no dot files, no ..)")
        base = self._files(user)
        p = base.joinpath(*path.split("/"))
        # every existing step must be a real folder/file, never a link
        cur = base
        for seg in path.split("/"):
            cur = cur / seg
            if cur.is_symlink():
                raise ShieldError("links aren't allowed in the sandbox")
        if base.exists() and base.is_symlink():
            raise ShieldError("links aren't allowed in the sandbox")
        try:
            p.resolve(strict=False).relative_to(base.resolve(strict=False))
        except ValueError:
            raise ShieldError("that path leaves the sandbox") from None
        return p

    def _touch(self, user: str) -> None:
        meta_p = self._base(user) / "meta.json"
        meta = storage.read_json(meta_p, {})
        if not isinstance(meta, dict):
            meta = {}
        now = time.time()
        meta.setdefault("user", user)
        meta.setdefault("createdAt", now)
        meta["lastUsedAt"] = now
        storage.write_json(meta_p, meta)

    # ---------- reading
    def list(self, user: str) -> list[dict[str, Any]]:
        base = self._files(user)
        out: list[dict[str, Any]] = []
        if not base.is_dir() or base.is_symlink():
            return out
        for dirpath, dirnames, filenames in os.walk(base, followlinks=False):
            dirnames[:] = sorted(d for d in dirnames if not (Path(dirpath) / d).is_symlink())
            for f in sorted(filenames):
                fp = Path(dirpath) / f
                if fp.is_symlink() or not fp.is_file():
                    continue
                rel = fp.relative_to(base).as_posix()
                st = fp.stat()
                out.append({"path": rel, "size": st.st_size, "modifiedAt": st.st_mtime})
        return out

    def usage(self, user: str) -> dict[str, int]:
        files = self.list(user)
        return {"files": len(files), "bytes": sum(f["size"] for f in files)}

    def read(self, user: str, path: str) -> dict[str, Any]:
        p = self._target(user, path)
        if not p.is_file():
            raise ShieldError("no such file in your sandbox")
        data = p.read_bytes()
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            raise ShieldError("that file isn't text") from None
        return {"path": path, "text": text, "size": len(data), "modifiedAt": p.stat().st_mtime}

    # ---------- writing (only ever inside the person's folder)
    def write(self, user: str, path: str, text: str, cfg: dict[str, Any], *, create_only: bool = False) -> dict[str, Any]:
        if not isinstance(text, str):
            raise ShieldError("send the file's text")
        data = text.encode("utf-8")
        if len(data) > int(cfg["maxFileKb"]) * 1024:
            raise ShieldError(f"files are at most {cfg['maxFileKb']} KB in the sandbox")
        with _lock:
            p = self._target(user, path)
            if p.exists() and not p.is_file():
                raise ShieldError("there's a folder with that name")
            if create_only and p.exists():
                raise ShieldError("a file with that name already exists")
            files = self.list(user)
            old = next((f["size"] for f in files if f["path"] == path), None)
            if old is None and len(files) >= int(cfg["maxFiles"]):
                raise ShieldError(f"at most {cfg['maxFiles']} files per sandbox")
            total = sum(f["size"] for f in files) - (old or 0) + len(data)
            if total > int(cfg["maxTotalMb"]) * 1024 * 1024:
                raise ShieldError(f"your sandbox is full ({cfg['maxTotalMb']} MB)")
            # parent folders: create step by step, refusing any existing non-folder or link
            for d in (self.root, self.root / "workspaces", self._base(user)):
                storage.private_dir(d)
            cur = self._files(user)
            storage.private_dir(cur)
            for seg in path.split("/")[:-1]:
                cur = cur / seg
                if cur.is_symlink() or (cur.exists() and not cur.is_dir()):
                    raise ShieldError("a file is in the way of that folder")
                storage.private_dir(cur)
            storage.write_bytes(p, data)
            self._touch(user)
        return {"path": path, "size": len(data)}

    def rename(self, user: str, src: str, dst: str) -> dict[str, Any]:
        with _lock:
            a, b = self._target(user, src), self._target(user, dst)
            if not a.is_file():
                raise ShieldError("no such file in your sandbox")
            if b.exists():
                raise ShieldError("a file with the new name already exists")
            cur = self._files(user)
            for seg in dst.split("/")[:-1]:
                cur = cur / seg
                if cur.is_symlink() or (cur.exists() and not cur.is_dir()):
                    raise ShieldError("a file is in the way of that folder")
                storage.private_dir(cur)
            os.replace(a, b)
            self._prune(user, a.parent)
            self._touch(user)
        return {"path": dst}

    def delete(self, user: str, path: str) -> None:
        with _lock:
            p = self._target(user, path)
            if not p.is_file():
                raise ShieldError("no such file in your sandbox")
            p.unlink()
            self._prune(user, p.parent)
            self._touch(user)

    def _prune(self, user: str, folder: Path) -> None:
        base = self._files(user)
        cur = folder
        while cur != base and base in cur.parents:
            try:
                cur.rmdir()  # only empty folders
            except OSError:
                break
            cur = cur.parent

    # ---------- admin
    def all(self) -> list[dict[str, Any]]:
        root = self.root / "workspaces"
        out: list[dict[str, Any]] = []
        if not root.is_dir():
            return out
        for d in sorted(root.iterdir()):
            if d.is_symlink() or not d.is_dir():
                continue
            meta = storage.read_json(d / "meta.json", {})
            meta = meta if isinstance(meta, dict) else {}
            name = str(meta.get("user") or d.name)
            u = self.usage(name) if user_slug(name) == d.name else {"files": 0, "bytes": 0}
            out.append({"id": d.name, "user": name, "files": u["files"], "bytes": u["bytes"],
                        "createdAt": meta.get("createdAt"), "lastUsedAt": meta.get("lastUsedAt")})
        return out

    def clear(self, slug: str | None) -> int:
        """Delete one workspace (by folder id) or every workspace (None). Returns how many were removed."""
        root = self.root / "workspaces"
        if not root.is_dir():
            return 0
        with _lock:
            targets = [d for d in root.iterdir() if d.is_dir() and not d.is_symlink()] if slug is None else [root / slug]
            n = 0
            for d in targets:
                if d.parent != root or user_slug(d.name) != d.name or not d.is_dir() or d.is_symlink():
                    continue
                shutil.rmtree(d)  # rmtree never follows links inside the tree
                n += 1
            return n
