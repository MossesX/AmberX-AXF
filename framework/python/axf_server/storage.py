"""Private files for AXF servers: owner-only folders, atomic writes, reads that never crash.

    from axf_server import storage
    storage.write_json(path, data)                  # tmp file in the same folder → fsync → os.replace, mode 0600
    storage.read_json(path, default)                # default (a copy) when missing, unreadable or not JSON
    storage.write_text(path, text)                  # same rules for text (env files, tokens)
    storage.append_jsonl(path, entry, rotate_at=…)  # 0600 append-only log, rotated to <name>.1.jsonl
    storage.private_dir(path)                       # create a folder 0700 (parents with the default mode)

Rules every copy in the console agreed on (and the stricter one where they differed):
  * the temporary file gets a unique name next to the target (two writers never share one), is created with
    O_EXCL and the final mode from the start (never briefly world-readable), flushed and fsynced, then swapped in
    with os.replace, so a reader sees the old file or the new one, never half of one; it is removed on failure;
  * the mode is set with fchmod, so a umask (the console runs with 002) can't widen or narrow it;
  * a missing parent folder is created 0700 unless the caller passes another `dir_mode`; existing folders are left
    as they are (shared folders such as /projects keep their group bits);
  * reads return a deep copy of the default, so a caller mutating the result never changes the shared default.
"""
from __future__ import annotations

import copy
import json
import os
import secrets
import threading
from pathlib import Path
from typing import Any, TypeVar

__all__ = ["PRIVATE_FILE", "PRIVATE_DIR", "private_dir", "write_bytes", "write_text", "write_json", "read_json",
           "read_text", "append_jsonl"]

PRIVATE_FILE = 0o600
PRIVATE_DIR = 0o700
T = TypeVar("T")


def private_dir(path: str | os.PathLike[str], mode: int = PRIVATE_DIR) -> Path:
    """Create `path` (and missing parents) if needed; a folder this call creates gets `mode`. Returns the Path."""
    p = Path(path)
    if not p.is_dir():
        p.parent.mkdir(parents=True, exist_ok=True)
        try:
            p.mkdir(mode=mode)
        except FileExistsError:
            pass
        else:
            os.chmod(p, mode)  # mkdir's mode is masked by the umask; this is the mode asked for
    return p


def _tmp_name(p: Path) -> Path:
    return p.with_name(f".{p.name}.{os.getpid()}.{threading.get_ident()}.{secrets.token_hex(4)}.tmp")


def write_bytes(path: str | os.PathLike[str], data: bytes, *, mode: int = PRIVATE_FILE, dir_mode: int | None = PRIVATE_DIR) -> Path:
    """Atomically replace `path` with `data` (mode `mode`, default 0600). `dir_mode=None` = the parent must exist."""
    p = Path(path)
    if dir_mode is not None:
        private_dir(p.parent, dir_mode)
    tmp = _tmp_name(p)
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), mode)
    try:
        with os.fdopen(fd, "wb") as fh:
            os.fchmod(fh.fileno(), mode)
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, p)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    _fsync_dir(p.parent)
    return p


def _fsync_dir(d: Path) -> None:
    """Make the rename itself durable where the platform allows it (best effort)."""
    try:
        fd = os.open(d, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def write_text(path: str | os.PathLike[str], text: str, *, mode: int = PRIVATE_FILE, dir_mode: int | None = PRIVATE_DIR,
               encoding: str = "utf-8") -> Path:
    return write_bytes(path, text.encode(encoding), mode=mode, dir_mode=dir_mode)


def write_json(path: str | os.PathLike[str], data: Any, *, indent: int | None = 2, ensure_ascii: bool = True,
               trailing_newline: bool = False, mode: int = PRIVATE_FILE, dir_mode: int | None = PRIVATE_DIR) -> Path:
    """Atomically write `data` as JSON (0600 unless `mode` says otherwise). Serialising happens before any file is
    touched, so a value that isn't JSON leaves the old file alone."""
    text = json.dumps(data, indent=indent, ensure_ascii=ensure_ascii)
    if trailing_newline:
        text += "\n"
    return write_text(path, text, mode=mode, dir_mode=dir_mode)


def read_json(path: str | os.PathLike[str], default: T) -> Any | T:
    """The file's JSON, or a deep copy of `default` when it is missing, unreadable or not JSON."""
    try:
        return json.loads(Path(path).read_text("utf-8"))
    except (OSError, ValueError):
        return copy.deepcopy(default)


def read_text(path: str | os.PathLike[str], default: str = "") -> str:
    try:
        return Path(path).read_text("utf-8")
    except (OSError, ValueError):
        return default


def append_jsonl(path: str | os.PathLike[str], entry: Any, *, rotate_at: int | None = None, ensure_ascii: bool = True,
                 dir_mode: int | None = PRIVATE_DIR) -> None:
    """Append one JSON line to an owner-only log. With `rotate_at` (bytes), a log already that big is moved to
    `<stem>.1.jsonl` first (one old generation kept)."""
    p = Path(path)
    if dir_mode is not None:
        private_dir(p.parent, dir_mode)
    if rotate_at is not None:
        try:
            if p.stat().st_size > rotate_at:
                os.replace(p, p.with_suffix(".1.jsonl"))
        except FileNotFoundError:
            pass
    line = json.dumps(entry, ensure_ascii=ensure_ascii) + "\n"
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0), PRIVATE_FILE)
    with os.fdopen(fd, "a", encoding="utf-8") as fh:
        fh.write(line)
