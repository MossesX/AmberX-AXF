"""Memory scan (memory-manager@1): every Claude memory file, where it lives, and what reads and writes it.

Two sources, merged per file:

- the audit map, `memory-map.json` next to this package (memory-map@1): each location (CLAUDE.md, rules, THREADS.md,
  STATUS.md, decisions, docs, chunks, session logs, build reports, the builds store, the hub copy, ~/.claude) with
  globs, a category, a kind (memory | builds | log | generated), whether Claude loads it at start, and its known
  readers and writers;
- a code scan (refresh = `POST /scan`): every code file in the checkout that names a memory path, marked as a writer
  when it also writes files (writeFile, appendFile, write_text, open(..., "w"), os.replace, rm…), else a reader.
  The result is cached in the data folder (`scan.json`) with its time.

Files are listed with the MemStore ids (`repo:`, `hub:`), so the editor opens, saves, versions, moves and deletes
them with the same conflict-safe rules. Files outside the editor's roots (~/.claude) are listed read-only.
"""
from __future__ import annotations

import fnmatch
import json
import os
import re
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .store import MemError, MemStore, _atomic, _read_json, _safe_text, _snippet, tokens_of

HERE = Path(__file__).resolve().parent
MAP_FILE = HERE.parent / "memory-map.json"
CODE_EXT = (".mjs", ".js", ".cjs", ".ts", ".tsx", ".py", ".sh", ".yml", ".yaml")
CODE_SKIP_DIRS = {".git", "node_modules", "dist", "build", ".gradle", "__pycache__", ".axf-console", "_claude", "changes", "sessions", ".venv", "venv", "coverage", "out", ".next"}
CODE_SKIP_PREFIX = ("apps/console-web/src/axf/", "apps/demo/src/axf/", "apps/axhub-web/src/axf/", "apps/amberx-droid/src/axf/", "apps/walkthrough-studio/src/axf/", "apps/expenses/src/axf/", "apps/molly/src/axf/")
CODE_MAX_BYTES = 400 * 1024
TEXT_EXT = (".md", ".json", ".jsonl", ".txt", ".yml", ".yaml")  # memory files listed (screenshots and other binaries are not)
TEST_FILE = re.compile(r"(^|/)(test[._][^/]*|[^/]*\.test\.[^/]+|fixtures/.*)$|^framework/spec/check-[^/]+$")  # tests and CI checks name paths as data
MEM_PATH = re.compile(r"(_claude/[\w./*<>{}-]+|\bCLAUDE\.md\b|\bTHREADS\.md\b|\bSTATUS\.md\b|\bdecisions\.md\b|\bMEMORY\.md\b)")
WRITE_CALL = re.compile(r"\b(writeFileSync|writeFile|appendFileSync|appendFile|renameSync|rmSync|unlinkSync|write_text|_atomic|os\.replace|shutil\.move|\.unlink\(|open\([^)]*['\"][wa]b?['\"])")
_LOCK = threading.RLock()

DEFAULTS: dict[str, Any] = {
    "scan.includeChunks": False,     # list the generated chunks one by one (else one summary row)
    "scan.includeLogs": False,       # list each change-log entry and session record (else one summary row each)
    "scan.includeHub": True,         # the hub's /projects copy when it is mounted
    "scan.includeUser": True,        # ~/.claude/CLAUDE.md of the machine the console runs on
    "scan.includeBuilds": True,      # builds data (reports, the store) shown for reference
    "scan.codeScan": True,           # look for readers and writers in the code
    "list.groupBy": "category",      # category | location | root | kind
    "list.sort": "path",             # path | size | updated | tokens
    "safety.confirmDelete": True,    # the UI asks before a delete (versions are always kept)
    "chunks.rebuildOnSave": False,   # rebuild _claude/chunks after saving a chunk source
}
CHOICES = {"list.groupBy": ["category", "location", "root", "kind"], "list.sort": ["path", "size", "updated", "tokens"]}
SETTINGS_META = [
    {"category": "Scan", "keys": ["scan.includeChunks", "scan.includeLogs", "scan.includeHub", "scan.includeUser", "scan.includeBuilds", "scan.codeScan"]},
    {"category": "List", "keys": ["list.groupBy", "list.sort"]},
    {"category": "Safety", "keys": ["safety.confirmDelete"]},
    {"category": "Chunks", "keys": ["chunks.rebuildOnSave"]},
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat().replace("+00:00", "Z")


def load_map() -> dict[str, Any]:
    m = _read_json(MAP_FILE, {})
    return m if isinstance(m, dict) and isinstance(m.get("locations"), list) else {"locations": []}


def _glob_hit(rel: str, globs: list[str]) -> bool:
    for g in globs:
        if g.endswith("/**"):
            if rel.startswith(g[:-3] + "/") or rel == g[:-3]:
                return True
        elif fnmatch.fnmatchcase(rel, g):
            return True
    return False


def normalize_settings(raw: Any) -> dict[str, Any]:
    out = dict(DEFAULTS)
    if isinstance(raw, dict):
        for k, v in raw.items():
            if k not in DEFAULTS:
                continue
            d = DEFAULTS[k]
            if isinstance(d, bool):
                out[k] = v if isinstance(v, bool) else str(v).lower() in ("1", "true", "on", "yes")
            elif k in CHOICES:
                out[k] = v if v in CHOICES[k] else d
            else:
                out[k] = v
    return out


class MemoryIndex:
    def __init__(self, store: MemStore, home: str | os.PathLike[str] | None = None):
        self.store = store
        self.home = Path(home or os.environ.get("AXF_MEMORY_HOME") or Path.home())

    # ---- settings ---------------------------------------------------------------------------------------------
    def settings(self) -> dict[str, Any]:
        return normalize_settings(_read_json(self.store.data / "settings.json", {}))

    def set_settings(self, patch: Any) -> dict[str, Any]:
        if not isinstance(patch, dict) or not any(k in DEFAULTS for k in patch):
            raise MemError(f"Nothing to save. Settings: {', '.join(DEFAULTS)}.")
        unknown = [k for k in patch if k not in DEFAULTS]
        if unknown:
            raise MemError(f"Unknown setting {unknown[0]}. Settings: {', '.join(DEFAULTS)}.")
        with _LOCK:
            merged = normalize_settings({**self.settings(), **patch})
            _atomic(self.store.data / "settings.json", json.dumps(merged, indent=1), 0o600)
        return merged

    def settings_doc(self) -> dict[str, Any]:
        return {"settings": self.settings(), "defaults": DEFAULTS, "choices": CHOICES, "categories": SETTINGS_META}

    # ---- code scan --------------------------------------------------------------------------------------------
    def code_scan(self) -> dict[str, Any]:
        """Every code file naming a memory path: {file: {paths, writes}}. Cached in scan.json."""
        repo = self.store.repo
        hits: dict[str, dict[str, Any]] = {}
        for d, dirs, files in os.walk(repo):
            rel_d = os.path.relpath(d, repo).replace(os.sep, "/")
            rel_d = "" if rel_d == "." else rel_d + "/"
            dirs[:] = sorted(x for x in dirs if x not in CODE_SKIP_DIRS and not x.startswith(".") or x in (".github", ".claude"))
            dirs[:] = [x for x in dirs if not (rel_d + x + "/").startswith(CODE_SKIP_PREFIX) and not os.path.islink(os.path.join(d, x))]
            for f in files:
                if not f.endswith(CODE_EXT) or f.startswith(".") or TEST_FILE.search(rel_d + f) or (rel_d + f).startswith("apps/console-web/plugins/memory-manager/"):
                    continue
                p = Path(d) / f
                try:
                    if p.is_symlink() or p.stat().st_size > CODE_MAX_BYTES:
                        continue
                    text = p.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    continue
                paths = sorted({m.group(1).rstrip(".,;:'\"`)") for m in MEM_PATH.finditer(text)})
                if paths:
                    hits[rel_d + f] = {"paths": paths[:40], "writes": bool(WRITE_CALL.search(text))}
        out = {"$axf": "memory-scan@1", "scannedAt": _now(), "files": hits}
        with _LOCK:
            _atomic(self.store.data / "scan.json", json.dumps(out, separators=(",", ":")), 0o600)
        return out

    def cached_scan(self) -> dict[str, Any]:
        s = _read_json(self.store.data / "scan.json", None)
        return s if isinstance(s, dict) and isinstance(s.get("files"), dict) else self.code_scan()

    @staticmethod
    def _mentions(path_lit: str, rel: str, globs: list[str]) -> bool:
        """Does a path literal in code point at this file (or its location)?"""
        lit = path_lit.replace("<", "*").replace(">", "*").replace("{", "*").replace("}", "*")
        if lit in (rel, rel.rsplit("/", 1)[-1]):
            return True
        if "*" in lit and fnmatch.fnmatchcase(rel, lit + ("*" if lit.endswith("/") else "")):
            return True
        if lit.endswith("/") and rel.startswith(lit):
            return True
        return any(g.startswith(lit.rstrip("/")) and lit.startswith("_claude/") and len(lit.rstrip("/")) > len("_claude/") for g in globs) and _glob_hit(rel, globs)

    # ---- listing ----------------------------------------------------------------------------------------------
    def _location(self, rel: str, root: str, locs: list[dict[str, Any]]) -> dict[str, Any] | None:
        for loc in locs:
            if loc.get("root") == root and _glob_hit(rel, loc.get("globs", [])):
                return loc
        return None

    def scan(self, q: str = "", category: str = "", kind: str = "", root: str = "", writer: str = "", loaded: str = "", refresh: bool = False) -> dict[str, Any]:
        st = self.settings()
        mm = load_map()
        locs = [x for x in mm["locations"] if isinstance(x, dict)]
        code = (self.code_scan() if refresh else self.cached_scan()) if st["scan.codeScan"] else {"files": {}, "scannedAt": ""}
        repo = self.store.repo
        files: list[dict[str, Any]] = []
        folded: dict[str, list[Any]] = {}  # location id -> [location, count]: shown as one summary row
        repo_locs = [x for x in locs if x.get("root") == "repo"]
        seen: set[str] = set()
        for loc in repo_locs:
            if loc.get("kind") == "builds" and not st["scan.includeBuilds"]:
                continue
            for g in loc.get("globs", []):
                base = g[:-3] if g.endswith("/**") else None
                cands = []
                if base is not None:
                    bp = repo / base
                    if bp.is_dir():
                        for d, dirs, fs in os.walk(bp):
                            dirs[:] = sorted(x for x in dirs if not x.startswith(".") and x not in ("journal", "node_modules") and not os.path.islink(os.path.join(d, x)))
                            for f in sorted(fs):
                                if not f.startswith(".") and f.endswith(TEXT_EXT) and not os.path.islink(os.path.join(d, f)):
                                    cands.append(os.path.relpath(os.path.join(d, f), repo).replace(os.sep, "/"))
                else:
                    cands = sorted(os.path.relpath(p, repo).replace(os.sep, "/") for p in repo.glob(g) if p.is_file() and not p.is_symlink() and p.name.endswith(TEXT_EXT))
                for rel in cands:
                    if rel in seen:
                        continue
                    seen.add(rel)
                    fold = (loc.get("id") == "chunks" and not st["scan.includeChunks"]) or (loc.get("kind") == "log" and loc.get("id") != "session-notes" and not st["scan.includeLogs"])
                    if fold:
                        folded.setdefault(loc["id"], [loc, 0])[1] += 1
                        continue
                    files.append(self._file_entry("repo", rel, repo / rel, loc, code))
        for lid, (loc, n) in folded.items():
            files.append({"id": "", "root": "repo", "path": loc["globs"][0].replace("/**", "/"), "name": f"{n} files", "openable": False, "location": lid, "label": loc.get("label"), "category": loc.get("category"), "kind": loc.get("kind"), "loadedAtStart": False, "size": 0, "tokens": 0, "updatedAt": "", "readers": [dict(r, source="map") for r in loc.get("readers", [])], "writers": [dict(w, source="map") for w in loc.get("writers", [])], "summary": True, "count": n})
        if st["scan.includeHub"] and self.store.hub_available():
            loc = next((x for x in locs if x.get("root") == "hub"), None)
            if loc:
                for proj in ("amberx-axf", "_shared"):
                    base = self.store.hub / proj / "_claude"
                    for rel, f in self.store._walk(base, lambda r, proj=proj: r in ("builds/journal/", "chunks/") or (proj == "_shared" and r == "notes/")):
                        files.append(self._file_entry("hub", f"{proj}/{rel}", f, loc, {"files": {}}))
        if st["scan.includeUser"]:
            u = self.home / ".claude" / "CLAUDE.md"
            loc = next((x for x in locs if x.get("root") == "user"), None)
            if loc and u.is_file() and not u.is_symlink():
                e = self._file_entry("user", "~/.claude/CLAUDE.md", u, loc, {"files": {}})
                e["openable"] = False
                files.append(e)
        # filters
        words = [w for w in q.lower().split() if w][:8]
        def keep(e: dict[str, Any]) -> bool:
            if category and e["category"] != category:
                return False
            if kind and e["kind"] != kind:
                return False
            if root and e["root"] != root:
                return False
            if loaded in ("1", "true", "yes") and not e["loadedAtStart"]:
                return False
            if writer and not any(writer.lower() in (w.get("who", "") + " " + w.get("path", "")).lower() for w in e["writers"]):
                return False
            if words:
                hay = f"{e['path']} {e['label']} {e.get('title', '')}".lower()
                return all(w in hay for w in words)
            return True
        kept = [e for e in files if keep(e)]
        key = {"size": lambda e: -e["size"], "updated": lambda e: e["updatedAt"] and "~" + e["updatedAt"] or "", "tokens": lambda e: -e["tokens"]}.get(st["list.sort"], lambda e: e["path"])
        if st["list.sort"] == "updated":
            kept.sort(key=lambda e: e["updatedAt"], reverse=True)
        else:
            kept.sort(key=key)  # type: ignore[arg-type]
        cats = sorted({e["category"] for e in files})
        return {"$axf": "memory-list@1", "files": kept, "total": len(files), "shown": len(kept), "categories": cats,
                "kinds": sorted({e["kind"] for e in files}), "roots": sorted({e["root"] for e in files}),
                "scannedAt": code.get("scannedAt", ""), "settings": st,
                "locations": [{k: v for k, v in x.items() if k in ("id", "label", "category", "kind", "root", "globs", "loadedAtStart")} for x in locs]}

    def _file_entry(self, root: str, rel: str, f: Path, loc: dict[str, Any], code: dict[str, Any]) -> dict[str, Any]:
        try:
            stt = f.stat()
            size, upd = stt.st_size, _iso(stt.st_mtime)
        except OSError:
            size, upd = 0, ""
        readers = [dict(r, source="map") for r in loc.get("readers", [])]
        writers = [dict(w, source="map") for w in loc.get("writers", [])]
        known = {x.get("path") for x in readers + writers if x.get("path")}
        if root == "repo":
            for cf, info in code.get("files", {}).items():
                if cf in known:
                    continue
                if any(self._mentions(p, rel, loc.get("globs", [])) for p in info.get("paths", [])):
                    (writers if info.get("writes") else readers).append({"who": cf.rsplit("/", 1)[-1], "path": cf, "how": "names it in code" + (" and writes files" if info.get("writes") else ""), "source": "scan"})
        md = rel.lower().endswith(".md")
        fid = f"{root}:{rel}" if root in ("repo", "hub") and md else ""
        return {"id": fid, "root": root, "path": rel, "name": rel.rsplit("/", 1)[-1], "openable": bool(fid), "location": loc.get("id"),
                "label": loc.get("label"), "category": loc.get("category", "Other"), "kind": loc.get("kind", "memory"),
                "loadedAtStart": bool(loc.get("loadedAtStart")), "size": size, "tokens": (size + 3) // 4, "updatedAt": upd,
                "readers": readers[:60], "writers": writers[:60]}

    def detail(self, fid: str) -> dict[str, Any]:
        root, rel, _f = self.store.parse(fid)
        for e in self.scan()["files"]:
            if e["id"] == f"{root}:{rel}":
                return e
        # chunks are folded into one row unless listed: still answer for one
        st = self.settings()
        if rel.startswith("_claude/chunks/") and not st["scan.includeChunks"]:
            loc = next((x for x in load_map()["locations"] if x.get("id") == "chunks"), {"id": "chunks", "globs": []})
            return self._file_entry(root, rel, self.store.repo / rel, loc, {"files": {}})
        raise MemError(f'"{fid}" isn\'t a memory file (see GET /memory).', 404)

    # ---- search -----------------------------------------------------------------------------------------------
    def search(self, q: str, limit: int = 100) -> dict[str, Any]:
        words = [w for w in q.lower().split() if w][:8]
        if not words:
            raise MemError("Say what to search for (q).")
        out = []
        st = self.settings()
        prev = st["scan.includeChunks"]
        for e in self.scan()["files"]:
            if not e["openable"]:
                continue
            try:
                _r, _rel, f = self.store.parse(e["id"])
            except MemError:
                continue
            t = _safe_text(f) if f is not None else ""
            low = t.lower()
            if all(w in low or w in e["path"].lower() for w in words):
                n = sum(low.count(w) for w in words)
                out.append({"id": e["id"], "path": e["path"], "category": e["category"], "hits": n, "snippet": _snippet(t, words[0])})
        out.sort(key=lambda x: -x["hits"])
        return {"q": q, "results": out[:max(1, min(limit, 500))], "count": len(out), "chunksIncluded": prev}

    # ---- move / delete ----------------------------------------------------------------------------------------
    def move(self, fid: Any, to: Any, if_version: str | None = None) -> dict[str, Any]:
        root, rel, f = self.store.parse(fid)
        troot, trel, tf = self.store.parse(to)
        if root == "notes" or troot == "notes":
            raise MemError("Notes move in the Notes Vault (Notes plugin).")
        if root != troot:
            raise MemError("A file moves within its own scope (repo → repo, hub → hub).")
        assert f is not None and tf is not None
        if not f.is_file():
            raise MemError(f'"{fid}" doesn\'t exist.', 404)
        if tf.exists():
            raise MemError(f'"{to}" already exists.', 409)
        with _LOCK:
            cur = _safe_text(f)
            if if_version is not None and if_version != "" and self.store.read(fid)["version"] != if_version:
                raise MemError(f'"{fid}" changed since you opened it. Reload it, then move it again.', 409)
            self.store._keep(root, rel, cur, f"move → {trel}", _now())
            self.store.write(f"{troot}:{trel}", cur, "")
            f.unlink()
            self._hub_forget(root, rel)
        return {"moved": f"{root}:{rel}", "to": f"{troot}:{trel}", "file": self.store.read(f"{troot}:{trel}")}

    def delete(self, fid: Any, if_version: str | None = None) -> dict[str, Any]:
        root, rel, f = self.store.parse(fid)
        if root == "notes":
            raise MemError("Notes are deleted in the Notes Vault (Notes plugin).")
        assert f is not None
        if not f.is_file():
            raise MemError(f'"{fid}" doesn\'t exist.', 404)
        with _LOCK:
            cur = _safe_text(f)
            if if_version is not None and if_version != "" and self.store.read(fid)["version"] != if_version:
                raise MemError(f'"{fid}" changed since you opened it. Reload it, then delete it again.', 409)
            self.store._keep(root, rel, cur, "delete", _now())
            f.unlink()
            self._hub_forget(root, rel)
        return {"deleted": f"{root}:{rel}", "kept": True, "restore": f"POST /restore {{id: '{root}:{rel}', version: '{self.store.history(fid)[0]['version']}'}}"}

    def _hub_forget(self, root: str, rel: str) -> None:
        if root != "hub":
            return
        meta = self.store._hub_meta(rel)
        meta.pop(self.store._hub_key(rel), None)
        _atomic(self.store._hub_state(rel) / "meta.json", json.dumps(meta, separators=(",", ":")), 0o600)

    # ---- chunks + session load --------------------------------------------------------------------------------
    def _node(self, script: str, *args: str, timeout: int = 60) -> dict[str, Any]:
        cli = self.store.repo / "framework" / "cli" / script
        if not cli.is_file():
            raise MemError(f"{script} isn't in this checkout.", 503)
        try:
            r = subprocess.run(["node", str(cli), *args, "--json"], cwd=self.store.repo, capture_output=True, text=True, timeout=timeout, env={**os.environ, "AXF_ROOT": str(self.store.repo)})
        except (OSError, subprocess.TimeoutExpired) as e:
            raise MemError(f"{script} didn't run: {e}", 503) from e
        if r.returncode not in (0, 1):
            raise MemError(f"{script} failed: {(r.stderr or r.stdout).strip()[:300]}", 500)
        try:
            return json.loads(r.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            return {"ok": r.returncode == 0, "output": r.stdout.strip()[:2000]}

    def chunks(self, q: str = "", source: str = "") -> dict[str, Any]:
        idx = _read_json(self.store.repo / "_claude" / "chunks" / "index.json", None)
        if not isinstance(idx, dict):
            return {"built": False, "chunks": [], "count": 0}
        cs = idx.get("chunks", [])
        if source:
            cs = [c for c in cs if source in c.get("source", "")]
        if q:
            ql = q.lower()
            cs = [c for c in cs if ql in (c.get("id", "") + " " + c.get("title", "")).lower()]
        return {"built": True, "count": idx.get("count", 0), "sources": idx.get("sources", []), "shown": len(cs), "chunks": cs[:2000]}

    def build_chunks(self) -> dict[str, Any]:
        return self._node("memory-chunks.mjs", "build")

    def load(self, hours: int = 24) -> dict[str, Any]:
        return self._node("memory-load.mjs", "--hours", str(max(1, min(int(hours), 24 * 14))))
