"""Notes store: Brett's saved notes in the hub's shared Claude files, `/projects/_shared/_claude/notes/`.

Same on-disk semantics as axHub's memory store (axHub `packages/storage-sqlite/src/memory-dir.ts`, project `shared`,
area `claude`), so the hub's history, `axhub.memory_read` and `claude-sync` see exactly what this plugin writes:

- current files under `<root>/_shared/_claude/notes/<folder>/<name>.md`
- attribution in `<root>/.axhub/claude/shared/meta.json` (`{path: {updatedAt, updatedBy}}`, paths start `notes/`)
- every replaced or deleted content kept in `<root>/.axhub/claude/shared/versions/<urlencoded path>.json`
  (newest first, 50 per file, `reason` write | delete)
- version = first 16 hex chars of the content's sha256; `if_version` "" = must not exist yet

Paths are `<folder>/<name>.md` (or `.txt`) or a top-level `<name>.md`; segments are plain names, never `..`, links or
hidden files. Nothing is read or written outside the notes folder and the hub's state folder.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

PREFIX = "notes/"
FILE_BYTES = 512 * 1024
VERSIONS_PER_FILE = 50
SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$")
NOTE_EXT = (".md", ".txt")
_LOCK = threading.RLock()  # one lock for every store on the same process (writes are read-check-write)


class NotesError(Exception):
    """A plain-language problem; `status` is the HTTP status the route answers with."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def version_of(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


def _now() -> str:
    t = datetime.now(timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


def _title(content: str, fallback: str) -> str:
    for line in content.splitlines()[:20]:
        s = line.strip()
        if s.startswith("#"):
            return s.lstrip("#").strip()[:160] or fallback
    return fallback


class NotesStore:
    def __init__(self, root: str | os.PathLike[str] | None = None, by: str = "console:notes-browser"):
        self.root = Path(root or os.environ.get("AXHUB_PROJECTS_DIR") or "/projects")
        self.by = by

    # ---- where things are -------------------------------------------------------------------------------------
    @property
    def claude_dir(self) -> Path:
        return self.root / "_shared" / "_claude"

    @property
    def notes_dir(self) -> Path:
        return self.claude_dir / "notes"

    @property
    def state_dir(self) -> Path:
        return self.root / ".axhub" / "claude" / "shared"

    def available(self) -> bool:
        return self.claude_dir.is_dir()

    def _require(self) -> None:
        if not self.available():
            raise NotesError(f"The hub's shared Claude files ({self.claude_dir}) aren't mounted on this console.", 503)

    # ---- paths ------------------------------------------------------------------------------------------------
    @staticmethod
    def clean(path: Any, *, note: bool = True) -> str:
        """`folder/name.md` (or `name.md`) relative to the notes folder; raises NotesError when it isn't a plain path."""
        if not isinstance(path, str):
            raise NotesError("A note path is needed, e.g. plans/my-plan.md.")
        p = path.strip().replace("\\", "/")
        if p.startswith("/"):
            raise NotesError(f'"{path}" isn\'t a note path: paths are relative to the notes folder, e.g. plans/my-plan.md.')
        p = p.strip("/")
        if p.startswith(PREFIX):
            p = p[len(PREFIX):]
        parts = [s for s in p.split("/")]
        if not p or len(parts) > (2 if note else 1) or any(not SEGMENT.match(s) or s.endswith(".") for s in parts):
            raise NotesError(f'"{path}" isn\'t a note path: use folder/name.md with letters, digits, spaces, dots, dashes or underscores.')
        if note and not parts[-1].lower().endswith(NOTE_EXT):
            raise NotesError(f'"{path}": a note ends in .md or .txt.')
        return "/".join(parts)

    def _file(self, rel: str) -> Path:
        f = self.notes_dir.joinpath(*rel.split("/"))
        # Refuse anything that leaves the notes folder through a link (the hub's own guard does the same).
        cur = self.notes_dir
        for part in rel.split("/"):
            cur = cur / part
            if cur.is_symlink():
                raise NotesError(f'"{rel}" goes through a link.')
        return f

    # ---- low-level IO -----------------------------------------------------------------------------------------
    def _owner(self) -> tuple[int, int] | None:
        try:
            st = self.claude_dir.stat()
            return st.st_uid, st.st_gid
        except OSError:
            return None

    def _chown(self, p: Path) -> None:
        own = self._owner()
        if own and hasattr(os, "chown"):
            try:
                os.chown(p, *own)
            except OSError:
                pass

    def _mkdir(self, d: Path) -> None:
        missing = []
        cur = d
        while not cur.exists():
            missing.append(cur)
            cur = cur.parent
        for m in reversed(missing):
            m.mkdir(mode=0o2775)
            self._chown(m)

    def _atomic(self, f: Path, text: str, mode: int = 0o660) -> None:
        self._mkdir(f.parent)
        tmp = f.with_name(f".{f.name}.tmp-{os.getpid()}-{threading.get_ident()}")
        tmp.write_text(text, encoding="utf-8")
        os.chmod(tmp, mode)
        self._chown(tmp)
        os.replace(tmp, f)

    def _read_json(self, f: Path, default: Any) -> Any:
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return default

    def _meta(self) -> dict[str, Any]:
        m = self._read_json(self.state_dir / "meta.json", {})
        return m if isinstance(m, dict) else {}

    def _save_meta(self, meta: dict[str, Any]) -> None:
        self._atomic(self.state_dir / "meta.json", json.dumps(meta, separators=(",", ":")), 0o600)

    def _versions_file(self, rel: str) -> Path:
        return self.state_dir / "versions" / f"{quote(PREFIX + rel, safe='')}.json"

    def _keep(self, rel: str, content: str, reason: str, now: str) -> None:
        f = self._versions_file(rel)
        kept = self._read_json(f, [])
        kept = kept if isinstance(kept, list) else []
        kept.insert(0, {"version": version_of(content), "size": len(content.encode("utf-8")), "savedAt": now, "reason": reason, "content": content, "savedBy": self.by})
        self._atomic(f, json.dumps(kept[:VERSIONS_PER_FILE], separators=(",", ":")), 0o600)

    @staticmethod
    def _check(cur: str | None, if_version: str | None, rel: str) -> None:
        if if_version is None:
            return
        have = None if cur is None else version_of(cur)
        if if_version == "" and have is not None:
            raise NotesError(f'"{rel}" already exists.', 409)
        if if_version != "" and have != if_version:
            raise NotesError(f'"{rel}" changed since you opened it (someone else saved it). Reload it, then save again.' if have else f'"{rel}" no longer exists.', 409)

    # ---- reads ------------------------------------------------------------------------------------------------
    def _info(self, rel: str, f: Path, meta: dict[str, Any], content: str | None = None) -> dict[str, Any]:
        text = f.read_text(encoding="utf-8", errors="replace") if content is None else content
        m = meta.get(PREFIX + rel) or {}
        st = f.stat()
        folder, _, name = rel.rpartition("/")
        return {
            "path": rel, "folder": folder, "name": name, "title": _title(text, name.rsplit(".", 1)[0]),
            "size": st.st_size, "version": version_of(text),
            "updatedAt": m.get("updatedAt") or datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat().replace("+00:00", "Z"),
            "updatedBy": m.get("updatedBy", ""),
        }

    def list(self, q: str = "") -> dict[str, Any]:
        """Every folder and note; with `q`, only notes whose name, title or text contains every word (with a snippet)."""
        self._require()
        meta = self._meta()
        folders: list[str] = []
        notes: list[dict[str, Any]] = []
        words = [w for w in q.lower().split() if w][:8]
        if self.notes_dir.is_dir():
            for entry in sorted(self.notes_dir.iterdir()):
                if entry.name.startswith(".") or entry.is_symlink():
                    continue
                if entry.is_dir() and SEGMENT.match(entry.name):
                    folders.append(entry.name)
                    files = [(f"{entry.name}/{f.name}", f) for f in sorted(entry.iterdir())]
                else:
                    files = [(entry.name, entry)]
                for rel, f in files:
                    if f.is_symlink() or not f.is_file() or f.name.startswith(".") or not f.name.lower().endswith(NOTE_EXT):
                        continue
                    text = f.read_text(encoding="utf-8", errors="replace")
                    info = self._info(rel, f, meta, text)
                    if words:
                        hay = f"{rel}\n{info['title']}\n{text}".lower()
                        if not all(w in hay for w in words):
                            continue
                        info["snippet"] = _snippet(text, words[0])
                    notes.append(info)
        return {"root": str(self.notes_dir), "available": True, "folders": folders, "notes": notes}

    def read(self, path: Any) -> dict[str, Any]:
        self._require()
        rel = self.clean(path)
        f = self._file(rel)
        if not f.is_file():
            raise NotesError(f'"{rel}" doesn\'t exist.', 404)
        text = f.read_text(encoding="utf-8", errors="replace")
        return {**self._info(rel, f, self._meta(), text), "content": text}

    def history(self, path: Any) -> list[dict[str, Any]]:
        rel = self.clean(path)
        kept = self._read_json(self._versions_file(rel), [])
        return [{k: v for k, v in e.items() if k != "content"} for e in kept if isinstance(e, dict)]

    # ---- writes -----------------------------------------------------------------------------------------------
    def write(self, path: Any, content: Any, if_version: str | None = None) -> dict[str, Any]:
        self._require()
        rel = self.clean(path)
        if not isinstance(content, str):
            raise NotesError("The note's text is needed.")
        if len(content.encode("utf-8")) > FILE_BYTES:
            raise NotesError(f"A note can be at most {FILE_BYTES // 1024} KB.", 413)
        with _LOCK:
            f = self._file(rel)
            cur = f.read_text(encoding="utf-8", errors="replace") if f.is_file() else None
            self._check(cur, if_version, rel)
            if cur == content:
                return self._info(rel, f, self._meta(), cur)
            now = _now()
            if cur is not None:
                self._keep(rel, cur, "write", now)
            self._atomic(f, content)
            meta = self._meta()
            meta[PREFIX + rel] = {"updatedAt": now, "updatedBy": self.by}
            self._save_meta(meta)
            return self._info(rel, f, meta, content)

    def remove(self, path: Any, if_version: str | None = None) -> bool:
        self._require()
        rel = self.clean(path)
        with _LOCK:
            f = self._file(rel)
            if not f.is_file():
                return False
            cur = f.read_text(encoding="utf-8", errors="replace")
            self._check(cur, if_version, rel)
            self._keep(rel, cur, "delete", _now())
            f.unlink()
            meta = self._meta()
            meta.pop(PREFIX + rel, None)
            self._save_meta(meta)
            return True

    def move(self, src: Any, dst: Any, if_version: str | None = None) -> dict[str, Any]:
        """Rename or move a note: write the new path, then delete the old one with its history kept (hub semantics)."""
        self._require()
        a, b = self.clean(src), self.clean(dst)
        if a == b:
            return self.read(a)
        with _LOCK:
            fa = self._file(a)
            if not fa.is_file():
                raise NotesError(f'"{a}" doesn\'t exist.', 404)
            text = fa.read_text(encoding="utf-8", errors="replace")
            self._check(text, if_version, a)
            info = self.write(b, text, "")
            self.remove(a)
            return info

    def make_folder(self, name: Any) -> str:
        self._require()
        rel = self.clean(name, note=False)
        if "." in rel:
            raise NotesError("A folder name has no dots.")
        self._mkdir(self._file(rel))
        return rel

    def remove_folder(self, name: Any) -> bool:
        """Only an empty folder is removed (notes are deleted one by one, each with its history kept)."""
        self._require()
        rel = self.clean(name, note=False)
        d = self._file(rel)
        if not d.is_dir():
            return False
        if any(not p.name.startswith(".") for p in d.iterdir()):
            raise NotesError(f'"{rel}" still has notes in it.', 409)
        for p in d.iterdir():
            p.unlink()
        d.rmdir()
        return True


def _snippet(text: str, word: str, width: int = 90) -> str:
    i = text.lower().find(word)
    if i < 0:
        return text[:width].replace("\n", " ")
    start = max(0, i - width // 3)
    return ("…" if start else "") + text[start:start + width].replace("\n", " ") + ("…" if start + width < len(text) else "")
