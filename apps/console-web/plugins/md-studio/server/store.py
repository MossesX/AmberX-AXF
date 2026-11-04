"""MD Studio store: every Markdown file Brett works with, by scope, with conflict-safe writes and kept versions.

A file is named by an id `<root>:<path>`:

- `repo:<path>`     a .md file in the AmberX-AXF checkout (AXF_ROOT), path relative to the repo root. The Project scope
                    (grouped by project manifest) and the Repo scope (grouped by top folder) both list these.
                    Replaced content is kept in the plugin's data folder (`versions/<urlencoded path>.json`).
- `hub:<project>/<path>`  a Claude file on the hub, `/projects/<project>/_claude/<path>` (`_shared` = the files every
                    project shares). Written with axHub's memory semantics, so the hub's history, `axhub.memory_read`
                    and `claude-sync` see exactly what was saved: attribution in `.axhub/claude/<p>/meta.json`, every
                    replaced or deleted content in `.axhub/claude/<p>/versions/<urlencoded path>.json` (p = `shared`
                    for `_shared`). The notes folder (`_shared/_claude/notes`) is the Notes scope's, not listed here.
- `notes:<folder>/<name>.md`  a note in the Notes Vault, through the capability `axf.notes@1` (the Notes plugin). Its
                    kept versions are read from the hub's history for `_shared/_claude/notes/…` (same files).

version = first 16 hex chars of the content's sha256 (axHub's memoryVersion); `if_version` "" = create only.
Nothing is read or written outside those roots, never through a link, hidden files or `..`, and only .md files.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

FILE_BYTES = 512 * 1024
VERSIONS_PER_FILE = 50
LIST_MAX = 6000
SEGMENT = re.compile(r"^[A-Za-z0-9_@][A-Za-z0-9._ @+-]{0,159}$")
HUB_PROJECT = re.compile(r"^(_shared|[a-z0-9][a-z0-9._-]{0,63})$")
# folders a repo listing never walks (builds, vendored and baked copies, VCS, caches, the builds journal)
SKIP_DIRS = {".git", "node_modules", "dist", "build", ".gradle", ".idea", ".venv", "venv", "__pycache__", ".axf-console", ".next", "out", "coverage", "journal", ".pytest_cache"}
SKIP_PATHS = ("apps/console-web/src/axf/", "apps/demo/src/axf/", "apps/axhub-web/src/axf/", "apps/amberx-droid/src/axf/")
DOT_DIRS = {".claude"}  # the one hidden folder MD Studio lists and writes (skills, commands, agents)
_LOCK = threading.RLock()


class MdError(Exception):
    """A plain-language problem; `status` is the HTTP status the route answers with."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def version_of(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


def tokens_of(text: str) -> int:
    """Rough token count (about four characters a token), the same heuristic the swarm packer reports."""
    return (len(text) + 3) // 4


def _now() -> str:
    t = datetime.now(timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat().replace("+00:00", "Z")


def title_of(content: str, fallback: str) -> str:
    for line in content.splitlines()[:30]:
        s = line.strip()
        if s.startswith("#"):
            return s.lstrip("#").strip()[:160] or fallback
    return fallback


def _read_json(f: Path, default: Any) -> Any:
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


# ---- references ---------------------------------------------------------------------------------------------------
_REF_AT = re.compile(r"^\s*@([~\w./-]+\.md)\s*$", re.M)                     # CLAUDE.md imports: a line "@path.md"
_REF_LINK = re.compile(r"\[[^\]\n]{0,200}\]\(\s*<?([^)\s>#]+\.md)(?:#[^)\s]*)?>?\s*\)")  # [text](path.md#anchor)
_REF_CODE = re.compile(r"`([~\w./-]+\.md)`")                                    # `path/to/file.md`


def find_refs(text: str) -> list[dict[str, Any]]:
    """Referenced .md paths in order of first appearance: {ref, kind (import|link|code), line}."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    hits: list[tuple[int, str, str]] = []
    for kind, rx in (("import", _REF_AT), ("link", _REF_LINK), ("code", _REF_CODE)):
        for m in rx.finditer(text):
            hits.append((m.start(1), kind, m.group(1)))
    for pos, kind, ref in sorted(hits):
        if ref.startswith(("http:", "https:", "mailto:")) or ref in seen:
            continue
        seen.add(ref)
        out.append({"ref": ref, "kind": kind, "line": text.count("\n", 0, pos) + 1})
    return out[:200]


class MdStore:
    def __init__(self, repo: str | os.PathLike[str] | None = None, hub: str | os.PathLike[str] | None = None,
                 data: str | os.PathLike[str] | None = None, by: str = "console:md-studio",
                 notes: Callable[[], Any] | None = None):
        self.repo = Path(repo or os.environ.get("AXF_ROOT") or Path(__file__).resolve().parents[5]).resolve()
        self.hub = Path(hub or os.environ.get("AXHUB_PROJECTS_DIR") or "/projects")
        self.data = Path(data or os.environ.get("AXF_MD_STUDIO_DATA_DIR") or self.repo / ".axf-console" / "plugins" / "md-studio")
        self.by = by
        self._notes = notes or (lambda: None)

    # ---- roots ------------------------------------------------------------------------------------------------
    def notes(self) -> Any:
        svc = self._notes()
        return svc if svc is not None and getattr(svc, "available", lambda: False)() else None

    def hub_available(self) -> bool:
        return (self.hub / "_shared" / "_claude").is_dir() or any(self._hub_projects())

    def _hub_projects(self) -> list[str]:
        if not self.hub.is_dir():
            return []
        return sorted(p.name for p in self.hub.iterdir() if p.is_dir() and not p.is_symlink() and HUB_PROJECT.match(p.name) and (p / "_claude").is_dir())

    @staticmethod
    def _segments(path: str, what: str) -> list[str]:
        p = path.strip().replace("\\", "/").strip("/")
        parts = p.split("/") if p else []
        if not parts or len(parts) > 12 or any((not SEGMENT.match(s) or s.endswith(".") or s.startswith(".")) and not (s in DOT_DIRS and i < len(parts) - 1) for i, s in enumerate(parts)):
            raise MdError(f'"{path}" isn\'t a {what} path: plain folder and file names only (no "..", hidden files or links).')
        if not parts[-1].lower().endswith(".md"):
            raise MdError(f'"{path}": MD Studio opens .md files only.')
        return parts

    def parse(self, fid: Any) -> tuple[str, str, Path | None]:
        """(root, clean path, file on disk or None for notes) for an id; raises MdError for anything else."""
        if not isinstance(fid, str) or ":" not in fid:
            raise MdError("A file id is needed, e.g. repo:CLAUDE.md, hub:amberx-axf/rules/RULES.md or notes:plans/x.md.")
        root, _, path = fid.partition(":")
        if root == "repo":
            parts = self._segments(path, "repo")
            rel = "/".join(parts)
            if any(s in SKIP_DIRS for s in parts[:-1]):
                raise MdError(f'"{rel}" is in a folder MD Studio doesn\'t open (builds, caches, vendored code).')
            return root, rel, self._guard(self.repo, parts)
        if root == "hub":
            proj, _, rest = path.strip("/").partition("/")
            if not HUB_PROJECT.match(proj):
                raise MdError(f'"{proj}" isn\'t a hub project.')
            parts = self._segments(rest, "Claude file")
            if proj == "_shared" and parts[0] == "notes":
                raise MdError("Notes open through the Notes scope (notes:<folder>/<name>.md).")
            return root, f"{proj}/{'/'.join(parts)}", self._guard(self.hub / proj / "_claude", parts)
        if root == "notes":
            parts = self._segments(path, "note")
            if len(parts) > 2:
                raise MdError(f'"{path}" isn\'t a note path: folder/name.md.')
            return root, "/".join(parts), None
        raise MdError(f'"{root}" isn\'t a scope: repo, hub or notes.')

    @staticmethod
    def _guard(base: Path, parts: list[str]) -> Path:
        cur = base
        for s in parts:
            cur = cur / s
            if cur.is_symlink():
                raise MdError(f'"{"/".join(parts)}" goes through a link.')
        return cur

    # ---- listing ----------------------------------------------------------------------------------------------
    def _walk(self, base: Path, skip_rel: Callable[[str], bool] = lambda _r: False) -> list[tuple[str, Path]]:
        out: list[tuple[str, Path]] = []
        if not base.is_dir():
            return out
        for d, dirs, files in os.walk(base):
            rel_d = os.path.relpath(d, base).replace(os.sep, "/")
            rel_d = "" if rel_d == "." else rel_d + "/"
            dirs[:] = sorted(x for x in dirs if (not x.startswith(".") or x in DOT_DIRS) and x not in SKIP_DIRS and not os.path.islink(os.path.join(d, x)) and not skip_rel(rel_d + x + "/"))
            for f in sorted(files):
                if f.lower().endswith(".md") and not f.startswith(".") and not os.path.islink(os.path.join(d, f)):
                    out.append((rel_d + f, Path(d) / f))
                    if len(out) >= LIST_MAX:
                        return out
        return out

    @staticmethod
    def _entry(fid: str, rel: str, f: Path) -> dict[str, Any]:
        st = f.stat()
        return {"id": fid, "path": rel, "name": f.name, "size": st.st_size, "updatedAt": _iso(st.st_mtime)}

    def _projects(self) -> list[tuple[str, str]]:
        """(manifest name, folder relative to the repo, "" = root), deepest folder first."""
        out: list[tuple[str, str]] = []
        for m in [self.repo / "project.manifest.json", *sorted(self.repo.glob("apps/*/project.manifest.json"))]:
            data = _read_json(m, {})
            name = data.get("name") if isinstance(data, dict) else None
            if isinstance(name, str):
                rel = os.path.relpath(m.parent, self.repo).replace(os.sep, "/")
                out.append((name, "" if rel == "." else rel))
        return sorted(out, key=lambda x: -len(x[1]))

    def list(self, q: str = "", content: bool = False) -> dict[str, Any]:
        """Every scope with its groups and files. `q` keeps files whose path (or, with `content`, text) has every word."""
        words = [w for w in q.lower().split() if w][:8]

        def keep(rel: str, f: Path | None, text: Callable[[], str] | None = None) -> dict[str, Any] | None:
            if not words:
                return {}
            hay = rel.lower()
            if all(w in hay for w in words):
                return {}
            if content and text is not None:
                t = text()
                if all(w in (hay + "\n" + t.lower()) for w in words):
                    return {"snippet": _snippet(t, words[0])}
            return None

        # repo files, once: Project groups them by manifest, Repo by top folder
        repo_files = self._walk(self.repo, lambda r: r.startswith(SKIP_PATHS) or r == "_claude/builds/journal/")
        projects = self._projects()
        by_project: dict[str, list[dict[str, Any]]] = {}
        by_top: dict[str, list[dict[str, Any]]] = {}
        for rel, f in repo_files:
            extra = keep(rel, f, lambda f=f: _safe_text(f))
            if extra is None:
                continue
            e = {**self._entry(f"repo:{rel}", rel, f), **extra}
            proj = next((n for n, d in projects if not d or rel.startswith(d + "/")), "repo")
            by_project.setdefault(proj, []).append(e)
            top = rel.split("/", 1)[0] if "/" in rel else "(top level)"
            by_top.setdefault(top, []).append(e)

        claude_groups: list[dict[str, Any]] = []
        hub_on = self.hub_available()
        if hub_on:
            for proj in ["_shared", *[p for p in self._hub_projects() if p != "_shared"]]:
                base = self.hub / proj / "_claude"
                cats: dict[str, list[dict[str, Any]]] = {}
                for rel, f in self._walk(base, lambda r, proj=proj: (proj == "_shared" and r == "notes/") or r == "builds/journal/"):
                    extra = keep(f"{proj}/{rel}", f, lambda f=f: _safe_text(f))
                    if extra is None:
                        continue
                    cat = rel.split("/", 1)[0] if "/" in rel else "top"
                    cats.setdefault(cat, []).append({**self._entry(f"hub:{proj}/{rel}", rel, f), **extra})
                label = "Shared (every project)" if proj == "_shared" else proj
                for cat, files in sorted(cats.items(), key=lambda kv: (kv[0] != "top", kv[0])):
                    claude_groups.append({"id": f"{proj}/{cat}", "label": label, "category": cat, "files": files})
        else:  # no hub on this machine: the repo's synced copies
            cats = {}
            for e in [x for xs in by_top.values() for x in xs]:
                if e["path"] == "CLAUDE.md" or e["path"].startswith("_claude/"):
                    rest = e["path"][len("_claude/"):] if e["path"].startswith("_claude/") else "top"
                    cat = rest.split("/", 1)[0] if "/" in rest else "top"
                    cats.setdefault(cat, []).append(e)
            claude_groups = [{"id": f"repo/{c}", "label": "This repo (hub not mounted)", "category": c, "files": fs} for c, fs in sorted(cats.items())]

        notes_svc = self.notes()
        notes_groups: list[dict[str, Any]] = []
        if notes_svc is not None:
            listing = notes_svc.list(q if content else "")
            folders: dict[str, list[dict[str, Any]]] = {}
            for n in listing.get("notes", []):
                if not str(n.get("path", "")).lower().endswith(".md"):
                    continue
                if words and not content and not all(w in (n["path"] + " " + n.get("title", "")).lower() for w in words):
                    continue
                e = {"id": f"notes:{n['path']}", "path": n["path"], "name": n["name"], "title": n.get("title"), "size": n.get("size", 0), "updatedAt": n.get("updatedAt", "")}
                if n.get("snippet"):
                    e["snippet"] = n["snippet"]
                folders.setdefault(n.get("folder") or "top", []).append(e)
            notes_groups = [{"id": f"notes/{k}", "label": k, "category": k, "files": v} for k, v in sorted(folders.items(), key=lambda kv: (kv[0] != "top", kv[0]))]

        return {
            "repo": str(self.repo),
            "scopes": [
                {"id": "project", "label": "Project", "available": True, "groups": [{"id": f"project/{k}", "label": k, "category": k, "files": v} for k, v in sorted(by_project.items(), key=lambda kv: (kv[0] != "amberx-axf", kv[0]))]},
                {"id": "claude", "label": "Claude", "available": True, "hub": hub_on, "groups": claude_groups},
                {"id": "repo", "label": "Repo", "available": True, "groups": [{"id": f"repo/{k}", "label": k, "category": k, "files": v} for k, v in sorted(by_top.items(), key=lambda kv: (kv[0] != "(top level)", kv[0]))]},
                {"id": "notes", "label": "Notes", "available": notes_svc is not None, "groups": notes_groups},
            ],
        }

    # ---- reads ------------------------------------------------------------------------------------------------
    def read(self, fid: Any) -> dict[str, Any]:
        root, rel, f = self.parse(fid)
        if root == "notes":
            svc = self._need_notes()
            d = _notes_call(svc.read, rel)
            text = d["content"]
            info = {"updatedAt": d.get("updatedAt", ""), "updatedBy": d.get("updatedBy", "")}
        else:
            assert f is not None
            if not f.is_file():
                raise MdError(f'"{fid}" doesn\'t exist.', 404)
            text = _safe_text(f)
            meta = self._hub_meta(rel).get(self._hub_key(rel), {}) if root == "hub" else {}
            info = {"updatedAt": meta.get("updatedAt") or _iso(f.stat().st_mtime), "updatedBy": meta.get("updatedBy", "")}
        name = rel.rsplit("/", 1)[-1]
        return {"id": f"{root}:{rel}", "root": root, "path": rel, "name": name, "title": title_of(text, name[:-3]),
                "content": text, "version": version_of(text), "size": len(text.encode("utf-8")), "tokens": tokens_of(text),
                "refs": self.resolve_refs(f"{root}:{rel}", text), **info}

    def resolve(self, from_id: str, ref: str) -> str | None:
        """The id a reference in `from_id` points at, when that file exists (relative to the file, then its root)."""
        root, rel, _ = self.parse(from_id)
        r = ref.strip()
        if r.startswith(("~/", "/")):
            if "/projects/" in r and "/_claude/" in r:  # an absolute hub path, e.g. /projects/_shared/_claude/rules/RULES.md
                proj, _, rest = r.split("/projects/", 1)[1].partition("/_claude/")
                return self._exists(f"hub:{proj}/{rest}") if "/" not in proj else None
            r = r.lstrip("~/")
        base_dir = rel.rsplit("/", 1)[0] if "/" in rel else ""
        cands: list[str] = []
        if root == "hub":
            proj, _, inner = rel.partition("/")
            inner_dir = inner.rsplit("/", 1)[0] if "/" in inner else ""
            cands += [f"hub:{proj}/{_norm(inner_dir, r)}", f"hub:{proj}/{_norm('', r.removeprefix('_claude/'))}"]
            if r.startswith("_claude/shared/"):
                cands.append(f"hub:_shared/{r[len('_claude/shared/'):]}")
            cands.append(f"repo:{_norm('', r)}")
        elif root == "notes":
            cands += [f"notes:{_norm(base_dir, r)}", f"repo:{_norm('', r)}"]
        else:
            cands += [f"repo:{_norm(base_dir, r)}", f"repo:{_norm('', r)}"]
        for c in cands:
            hit = self._exists(c)
            if hit:
                return hit
        return None

    def _exists(self, fid: str) -> str | None:
        if fid.endswith(":") or fid.endswith("/"):
            return None
        try:
            root, rel, f = self.parse(fid)
        except MdError:
            return None
        if root == "notes":
            svc = self.notes()
            if svc is None:
                return None
            try:
                svc.read(rel)
                return fid
            except Exception:  # noqa: BLE001 - any notes error = not there
                return None
        return f"{root}:{rel}" if f is not None and f.is_file() else None

    def resolve_refs(self, fid: str, text: str) -> list[dict[str, Any]]:
        return [{**r, "id": self.resolve(fid, r["ref"])} for r in find_refs(text)]

    def chain(self, fid: Any, depth: int = 3, follow: str = "all") -> dict[str, Any]:
        """The file and everything it references, as a tree with token counts per part (each file counted once).
        `follow` = "all" (imports, links and code paths) or "import" (only `@path` imports: what Claude itself loads)."""
        depth = max(0, min(int(depth), 6))
        kinds = {"import"} if follow == "import" else {"import", "link", "code"}
        seen: set[str] = set()
        total = 0

        def node(i: str, d: int, via: dict[str, Any] | None) -> dict[str, Any]:
            nonlocal total
            try:
                doc = self.read(i)
            except MdError as e:
                return {"id": i, "missing": True, "error": str(e), "tokens": 0, "children": [], **({"via": via} if via else {})}
            repeat = doc["id"] in seen
            seen.add(doc["id"])
            if not repeat:
                total += doc["tokens"]
            kids = [] if repeat or d >= depth else [node(r["id"], d + 1, {"ref": r["ref"], "kind": r["kind"], "line": r["line"]}) for r in doc["refs"] if r["id"] and r["kind"] in kinds]
            unresolved = [] if repeat else [r["ref"] for r in doc["refs"] if not r["id"] and r["kind"] in kinds]
            own = {"id": doc["id"], "title": doc["title"], "path": doc["path"], "tokens": doc["tokens"], "repeat": repeat,
                   "unresolved": unresolved, "children": kids}
            own["subtotal"] = (0 if repeat else doc["tokens"]) + sum(k.get("subtotal", 0) for k in kids)
            if via:
                own["via"] = via
            return own

        root = node(self.parse(fid)[0] + ":" + self.parse(fid)[1], 0, None)
        return {"root": root, "files": len(seen), "tokens": total, "depth": depth, "follow": "import" if follow == "import" else "all"}

    # ---- versions ---------------------------------------------------------------------------------------------
    @staticmethod
    def _hub_state_name(proj: str) -> str:
        return "shared" if proj == "_shared" else proj

    def _hub_key(self, rel: str) -> str:
        return rel.partition("/")[2]

    def _hub_state(self, rel: str) -> Path:
        return self.hub / ".axhub" / "claude" / self._hub_state_name(rel.partition("/")[0])

    def _hub_meta(self, rel: str) -> dict[str, Any]:
        m = _read_json(self._hub_state(rel) / "meta.json", {})
        return m if isinstance(m, dict) else {}

    def _versions_file(self, root: str, rel: str) -> Path:
        if root == "hub":
            return self._hub_state(rel) / "versions" / f"{quote(self._hub_key(rel), safe='')}.json"
        if root == "notes":
            return self.hub / ".axhub" / "claude" / "shared" / "versions" / f"{quote('notes/' + rel, safe='')}.json"
        return self.data / "versions" / f"{quote(rel, safe='')}.json"

    def _kept(self, root: str, rel: str) -> list[dict[str, Any]]:
        k = _read_json(self._versions_file(root, rel), [])
        return [e for e in k if isinstance(e, dict)] if isinstance(k, list) else []

    def history(self, fid: Any) -> list[dict[str, Any]]:
        root, rel, _ = self.parse(fid)
        return [{k: v for k, v in e.items() if k != "content"} for e in self._kept(root, rel)]

    def version(self, fid: Any, version: str) -> dict[str, Any]:
        root, rel, _ = self.parse(fid)
        for e in self._kept(root, rel):
            if e.get("version") == version and isinstance(e.get("content"), str):
                return e
        raise MdError(f'No kept version {version} of "{fid}".', 404)

    def restore(self, fid: Any, version: str, if_version: str | None = None) -> dict[str, Any]:
        """Write a kept version back (the current text is kept in turn, so a restore can itself be undone)."""
        return self.write(fid, self.version(fid, version)["content"], if_version)

    # ---- writes -----------------------------------------------------------------------------------------------
    def _need_notes(self) -> Any:
        svc = self.notes()
        if svc is None:
            raise MdError("The Notes Vault isn't available here (the Notes plugin is off or the hub isn't mounted).", 503)
        return svc

    def write(self, fid: Any, content: Any, if_version: str | None = None) -> dict[str, Any]:
        root, rel, f = self.parse(fid)
        if not isinstance(content, str):
            raise MdError("The file's text is needed.")
        if len(content.encode("utf-8")) > FILE_BYTES:
            raise MdError(f"A file can be at most {FILE_BYTES // 1024} KB here.", 413)
        if root == "notes":
            _notes_call(self._need_notes().write, rel, content, if_version, self.by)
            return self.read(f"notes:{rel}")
        assert f is not None
        if root == "hub" and not (self.hub / rel.partition("/")[0] / "_claude").is_dir():
            raise MdError(f"The hub project {rel.partition('/')[0]} isn't mounted on this console.", 503)
        with _LOCK:
            cur = _safe_text(f) if f.is_file() else None
            _check(cur, if_version, fid)
            if cur != content:
                now = _now()
                if cur is not None:
                    self._keep(root, rel, cur, "write", now)
                _atomic(f, content)
                if root == "hub":
                    st = self._hub_state(rel)
                    meta = self._hub_meta(rel)
                    meta[self._hub_key(rel)] = {"updatedAt": now, "updatedBy": self.by}
                    _atomic(st / "meta.json", json.dumps(meta, separators=(",", ":")), 0o600)
        return self.read(f"{root}:{rel}")

    def _keep(self, root: str, rel: str, content: str, reason: str, now: str) -> None:
        vf = self._versions_file(root, rel)
        kept = self._kept(root, rel)
        kept.insert(0, {"version": version_of(content), "size": len(content.encode("utf-8")), "savedAt": now, "reason": reason, "content": content, "savedBy": self.by})
        _atomic(vf, json.dumps(kept[:VERSIONS_PER_FILE], separators=(",", ":")), 0o600)


# ---- helpers ------------------------------------------------------------------------------------------------------
def _norm(base: str, ref: str) -> str:
    """`ref` resolved against folder `base` ("" = the root); "" when it climbs out of the root."""
    parts: list[str] = [p for p in base.split("/") if p] if not ref.startswith("/") else []
    for s in ref.lstrip("/").split("/"):
        if s in ("", "."):
            continue
        if s == "..":
            if not parts:
                return ""
            parts.pop()
        else:
            parts.append(s)
    return "/".join(parts)


def _safe_text(f: Path) -> str:
    try:
        if f.stat().st_size > FILE_BYTES * 4:
            return ""
        return f.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def _check(cur: str | None, if_version: str | None, fid: str) -> None:
    if if_version is None:
        return
    have = None if cur is None else version_of(cur)
    if if_version == "" and have is not None:
        raise MdError(f'"{fid}" already exists.', 409)
    if if_version != "" and have != if_version:
        raise MdError(f'"{fid}" changed since you opened it (someone else saved it). Reload it, then save again.' if have else f'"{fid}" no longer exists.', 409)


def _atomic(f: Path, text: str, mode: int = 0o664) -> None:
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_name(f".{f.name}.tmp-{os.getpid()}-{threading.get_ident()}")
    tmp.write_text(text, encoding="utf-8")
    os.chmod(tmp, mode)
    try:
        st = f.stat() if f.exists() else f.parent.stat()
        os.chown(tmp, st.st_uid, st.st_gid)
    except (OSError, AttributeError):
        pass
    os.replace(tmp, f)


def _notes_call(fn: Callable[..., Any], *args: Any) -> Any:
    try:
        return fn(*args)
    except MdError:
        raise
    except Exception as e:  # axf.notes@1 raises its own NotesError (message + status); keep both
        raise MdError(str(e), int(getattr(e, "status", 400))) from e


def _snippet(text: str, word: str, width: int = 90) -> str:
    i = text.lower().find(word)
    if i < 0:
        return text[:width].replace("\n", " ")
    start = max(0, i - width // 3)
    return ("…" if start else "") + text[start:start + width].replace("\n", " ") + ("…" if start + width < len(text) else "")
