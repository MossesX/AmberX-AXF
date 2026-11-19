"""The console server's data layer: the same calls as `axf_server.storage`, routed by data-store-mode@1.

Brett, Nov 15 2026: "the console goes down, all the data is still available, all the notes are available, and the
builds keep running. That's what I need."

    import data_store as ds
    ds.read_json(path, default)      ds.write_json(path, data, …)      ds.append_jsonl(path, entry, …)
    ds.read_text(path, default)      ds.write_text(path, text, …)      ds.write_bytes(path, data, …)
    ds.private_dir(path)             ds.plugin(folder).read_json("items.json", [])   (a plugin's lifecycle dataDir)
    ds.key_for(path)                 the data-store@1 key a file maps to (None = it always stays local)

Every call takes the same arguments as storage.* and answers the same way. What happens underneath depends on the
mode of the key's namespace (framework/core/data-store-mode.mjs, the document at <data>/data-store/mode.json):

  local     storage.* on the file, nothing else (the default: no behaviour change until a namespace is moved)
  shadow    the file first (its answer is the caller's answer), then the same write to axf-data; reads come from the
            file and a background check compares its hash with axf-data's. A difference or a failed mirror write is a
            data-drift@1 line in <data>/data-store/drift/<ns>.jsonl, never an error for the caller
  cutover   axf-data only. Writes re-read the etag and retry on a conflict; if axf-data can't be reached a read falls
            back to the local read-only copy (logged) and a write raises DataStoreError('unavailable')
  rollback  reads from axf-data, writes raise DataStoreError('read_only') until the rollback finishes

Paths map to keys through framework/schemas/data-store-paths.json (the migration map as rules). axf-data is reached at
AXF_DATA_URL with AXF_DATA_TOKEN (conf/env/console.env from deploy/install-data.sh). No token or body is ever logged.
"""
from __future__ import annotations

import hashlib
import json
import os
import queue
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Callable

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import storage

private_dir = storage.private_dir
ROOT = Path(os.environ.get("AXF_ROOT") or Path(__file__).resolve().parents[3])
MODES = ("local", "shadow", "cutover", "rollback")
_SEGMENT = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._-]{0,79}$")
_FOLDER = re.compile(r"^[a-z0-9][a-z0-9-]*$")


class DataStoreError(Exception):
    def __init__(self, code: str, message: str = "", status: int = 0, **extra: Any):
        super().__init__(message or code)
        self.code, self.status, self.extra = code, status, extra


# ── where things are ──────────────────────────────────────────────────────────────────────────────────────────────────

def _roots() -> dict[str, Path]:
    data = Path(os.environ["AXF_STATE"]).parent if os.environ.get("AXF_STATE") else ROOT / ".axf-console"
    return {"plugins": Path(os.environ.get("AXF_PLUGINS_DATA_DIR") or data / "plugins"), "data": data, "repo": ROOT,
            "projects": Path(os.environ.get("AXHUB_PROJECTS_DIR") or "/projects")}


def _registry() -> tuple[dict, dict]:
    # the registry is code, not data: read it from AXF_ROOT when that checkout has it, else from this module's own checkout
    # (tests and tools point AXF_ROOT at a scratch tree without framework/schemas)
    base = ROOT if (ROOT / "framework/schemas/data-store.json").is_file() else Path(__file__).resolve().parents[3]
    reg = json.loads((base / "framework/schemas/data-store.json").read_text("utf-8"))
    paths = json.loads((base / "framework/schemas/data-store-paths.json").read_text("utf-8"))
    return reg, paths


_REG, _PATHS = _registry()
_RULES = {root: [(re.compile(r["re"]), r["to"]) for r in rules] for root, rules in _PATHS["rules"].items()}
NAMESPACES: dict = _REG["namespaces"]


def valid_key(key: str) -> bool:
    ns, _, path = key.partition("/")
    if ns not in NAMESPACES or NAMESPACES[ns].get("internal") or not path or len(key) > _REG["limits"]["keyChars"]:
        return False
    segs = path.split("/")
    if not all(_SEGMENT.match(s) and s not in (".", "..") for s in segs):
        return False
    return not NAMESPACES[ns].get("open") or (len(segs) >= 2 and bool(_FOLDER.match(segs[0])))


def short_segment(seg: str) -> str:
    """A segment over 80 characters → its start + '--' + 16 hex of its SHA-256 + its extension, 80 in all (longSegments)."""
    if len(seg) <= 80:
        return seg
    m = re.search(r"(\.[A-Za-z0-9]{1,8})$", seg)
    ext = m.group(1) if m else ""
    return f"{seg[:62 - len(ext)]}--{hashlib.sha256(seg.encode('utf-8')).hexdigest()[:16]}{ext}"


def map_rel(root: str, rel: str) -> str | None:
    """`root` + a path relative to it → its key, or None (stays local). Same rules as data-store-paths.mjs."""
    for rx, to in _RULES.get(root, []):
        m = rx.match(rel)
        if m:
            if to is None:
                return None
            key = "/".join(short_segment(x) for x in re.sub(r"\{(\d)\}", lambda g: m.group(int(g.group(1))), to).split("/"))
            return key if valid_key(key) else None
    return None


def key_for(path: str | os.PathLike[str]) -> str | None:
    p = Path(path).resolve() if Path(path).is_absolute() else (ROOT / path).resolve()
    roots = _roots()
    for name in _PATHS["order"]:
        base = roots[name].resolve()
        try:
            rel = p.relative_to(base).as_posix()
        except ValueError:
            continue
        return map_rel(name, rel)
    return None


def kind_of(key: str) -> str:
    s = key.lower()
    kind = "record" if s.endswith(".json") else "journal" if s.endswith((".jsonl", ".ndjson")) or _is_journal_key(key) else "blob"
    ns = key.split("/", 1)[0]
    if kind not in NAMESPACES[ns]["kinds"]:
        kind = "blob"
    return kind


def _is_journal_key(key: str) -> bool:
    # keys whose .jsonl extension the map drops (builds/journal/<month>, planner/shipped-log, console/deploys/log)
    return bool(re.match(r"^(builds/journal/[^/]+|planner/shipped-log|console/deploys/log|phone/log|notes/_history/.+)$", key))


def nsid_of(key: str) -> str:
    ns, _, path = key.partition("/")
    return f"{ns}/{path.split('/')[0]}" if NAMESPACES.get(ns, {}).get("open") else ns


# ── mode document ─────────────────────────────────────────────────────────────────────────────────────────────────────

def _store_dir() -> Path:
    return Path(os.environ.get("AXF_DATA_STORE_DIR") or _roots()["data"] / "data-store")


_mode_cache: dict[str, Any] = {"mtime": None, "size": None, "file": None, "doc": None}
_MODE_FRESH_NS = 2_000_000_000  # a mode file written in the last 2 s is always read again (framework/core/data-files.mjs)


def mode_doc() -> dict:
    f = _store_dir() / "mode.json"
    try:
        st = f.stat()
    except OSError:
        return {"mode": "local", "namespaces": {}}
    recent = time.time_ns() - st.st_mtime_ns < _MODE_FRESH_NS
    if recent or _mode_cache["file"] != str(f) or _mode_cache["mtime"] != st.st_mtime_ns or _mode_cache["size"] != st.st_size:
        _mode_cache.update(mtime=st.st_mtime_ns, size=st.st_size, file=str(f), doc=storage.read_json(f, {"mode": "local", "namespaces": {}}))
    return _mode_cache["doc"]


def mode_of(key: str) -> str:
    """The key's mode: a key-level override on its namespace entry (exact path or the longest prefix ending in '/'; the
    path is relative to the namespace id, so `builds/store.json` → `store.json`), else the namespace entry, else the store."""
    doc = mode_doc()
    nsid = nsid_of(key)
    e = (doc.get("namespaces") or {}).get(nsid) or {}
    rel = key[len(nsid) + 1:] if key.startswith(nsid + "/") else ""
    best = ""
    m = ""
    for p, k in (e.get("keys") or {}).items() if rel and isinstance(e.get("keys"), dict) else []:
        hit = rel.startswith(p) if p.endswith("/") else rel == p
        if hit and len(p) > len(best) and isinstance(k, dict):
            best, m = p, str(k.get("mode") or "")
    m = m or e.get("mode") or doc.get("mode") or "local"
    return m if m in MODES else "local"


# ── axf-data over HTTP ────────────────────────────────────────────────────────────────────────────────────────────────

Transport = Callable[[str, str, dict, bytes | None], tuple[int, dict, bytes]]


def _urllib(method: str, url: str, headers: dict, body: bytes | None) -> tuple[int, dict, bytes]:
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=float(os.environ.get("AXF_DATA_TIMEOUT", "10"))) as r:  # noqa: S310
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in (e.headers or {}).items()}, e.read() or b""


class Remote:
    """A small data-store@1 client (the reference is framework/core/data-store.mjs httpBackend)."""

    def __init__(self, url: str = "", token: str = "", transport: Transport | None = None, actor: str = ""):
        self.url = (url or os.environ.get("AXF_DATA_URL", "")).rstrip("/")
        self.token = token or os.environ.get("AXF_DATA_TOKEN", "")
        self.transport = transport or _urllib
        self.actor = actor

    @property
    def configured(self) -> bool:
        return bool(self.url)

    def _send(self, method: str, path: str, *, headers: dict | None = None, body: bytes | None = None, q: dict | None = None) -> tuple[int, dict, bytes]:
        if not self.configured:
            raise DataStoreError("unavailable", "axf-data isn't configured (AXF_DATA_URL)")
        qs = "?" + urllib.parse.urlencode({k: v for k, v in (q or {}).items() if v not in (None, "")}) if q else ""
        h = {"accept": "application/json", "authorization": f"Bearer {self.token}", **({"x-axf-actor": self.actor} if self.actor else {}), **(headers or {})}
        last: Exception | None = None
        for attempt in range(5):
            try:
                status, rh, data = self.transport(method, f"{self.url}/v1/{path}{qs}", h, body)
            except OSError as e:
                last = DataStoreError("unavailable", f"axf-data can't be reached ({e})", 503)
                time.sleep(min(8.0, 0.25 * 2 ** attempt))
                continue
            if status in (429, 503) and attempt < 4:
                time.sleep(min(8.0, 0.25 * 2 ** attempt))
                continue
            if status >= 400 and status != 304:
                try:
                    f = json.loads(data)
                except ValueError:
                    f = {}
                raise DataStoreError(f.get("code") or "internal", f.get("message") or f"axf-data answered {status}", status, rev=f.get("rev"), etag=f.get("etag"))
            return status, rh, data
        raise last or DataStoreError("unavailable", "axf-data kept answering busy", 503)

    def get(self, key: str) -> tuple[dict, bytes] | None:
        try:
            _s, h, data = self._send("GET", urllib.parse.quote(key))
        except DataStoreError as e:
            if e.code == "not_found":
                return None
            raise
        return {"etag": (h.get("etag") or "").strip('"'), "rev": int(h.get("x-axf-rev") or 0), "kind": h.get("x-axf-kind") or "record",
                "contentType": h.get("content-type") or ""}, data

    def put(self, key: str, body: bytes, content_type: str, *, if_match: str = "", create: bool = False) -> dict:
        h = {"content-type": content_type, **({"if-match": if_match} if if_match else {}), **({"if-none-match": "*"} if create else {})}
        return json.loads(self._send("PUT", urllib.parse.quote(key), headers=h, body=body)[2])

    def put_latest(self, key: str, body: bytes, content_type: str, tries: int = 5) -> dict:
        """Write `body` as the new value whatever is there now (re-read the etag, retry on a conflict)."""
        for i in range(tries):
            cur = self.get(key)
            try:
                return self.put(key, body, content_type, if_match=cur[0]["etag"] if cur else "", create=cur is None)
            except DataStoreError as e:
                if e.code not in ("conflict", "exists") or i == tries - 1:
                    raise
        raise DataStoreError("conflict", key)

    def append(self, key: str, entries: list, idem: str = "") -> dict:
        h = {"content-type": "application/json", **({"idempotency-key": idem} if idem else {})}
        return json.loads(self._send("POST", urllib.parse.quote(key) + ":append", headers=h, body=json.dumps({"entries": entries}).encode())[2])

    def read_all(self, key: str) -> list[dict] | None:
        out, since = [], 0
        while True:
            try:
                r = json.loads(self._send("GET", urllib.parse.quote(key), q={"since": since, "limit": 5000})[2])
            except DataStoreError as e:
                if e.code == "not_found":
                    return None
                raise
            out.extend(e["entry"] for e in r["entries"])
            if not r.get("next"):
                return out
            since = r["next"]

    def json(self, method: str, path: str, body: Any = None, q: dict | None = None) -> Any:
        b = json.dumps(body).encode() if body is not None else None
        return json.loads(self._send(method, path, headers={"content-type": "application/json"} if b else None, body=b, q=q)[2] or b"null")


REMOTE = Remote()


def set_remote(r: Remote) -> None:
    """Tests and the data-store plugin swap the client (e.g. a transport into an in-process axf-data)."""
    global REMOTE
    REMOTE = r


# ── drift (shadow) ────────────────────────────────────────────────────────────────────────────────────────────────────

def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int(time.time() * 1000) % 1000:03d}Z"


def _hash16(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()[:16]


def canonical(v: Any) -> str:
    def norm(x: Any) -> Any:
        if isinstance(x, float) and x.is_integer() and abs(x) < 2 ** 53:
            return int(x)
        if isinstance(x, list):
            return [norm(i) for i in x]
        if isinstance(x, dict):
            return {k: norm(i) for k, i in x.items()}
        return x
    return json.dumps(norm(v), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def log_drift(op: str, key: str, kind: str, local: dict | None, remote: dict | None, error: str = "") -> dict:
    e = {"$axf": "data-drift@1", "at": _now(), "op": op, "key": key, "kind": kind, "local": local, "remote": remote}
    if error:
        e["error"] = error[:300]
    storage.append_jsonl(_store_dir() / "drift" / f"{nsid_of(key).replace('/', '__')}.jsonl", e)
    return e


_checks: queue.Queue = queue.Queue(maxsize=256)


def _checker() -> None:
    while True:
        key, local_hash = _checks.get()
        try:
            r = REMOTE.get(key)
            if r is None:
                log_drift("read", key, "missing-remote", {"etag": f"0-{local_hash}"}, None)
            elif r[0]["etag"].split("-", 1)[-1] != local_hash:
                log_drift("read", key, "etag", {"etag": f"0-{local_hash}"}, {"rev": r[0]["rev"], "etag": r[0]["etag"]})
        except DataStoreError as e:
            log_drift("read", key, "write-failed", {"etag": f"0-{local_hash}"}, None, f"{e.code}: {e}")
        except Exception:  # noqa: BLE001 — a background compare never takes the server down
            pass
        finally:
            _checks.task_done()


def drain() -> None:
    """Wait for the shadow compares queued so far (tests, and the CLI before it reports drift)."""
    if _checker_started.is_set():
        _checks.join()


_checker_started = threading.Event()


def _compare_later(key: str, body: bytes) -> None:
    if not _checker_started.is_set():
        _checker_started.set()
        threading.Thread(target=_checker, name="data-store-shadow", daemon=True).start()
    try:
        _checks.put_nowait((key, _hash16(body)))
    except queue.Full:
        pass  # sampling: a busy console checks what it can


def _record_body(text_or_bytes: bytes) -> tuple[bytes, str] | None:
    try:
        return canonical(json.loads(text_or_bytes)).encode("utf-8"), "application/json"
    except ValueError:
        return None


def _remote_body(key: str, raw: bytes) -> tuple[bytes, str]:
    if kind_of(key) == "record":
        rb = _record_body(raw)
        if rb:
            return rb
    ext = key.rsplit(".", 1)[-1].lower() if "." in key.rsplit("/", 1)[-1] else ""
    ct = {"md": "text/markdown", "txt": "text/plain", "png": "image/png", "jpg": "image/jpeg", "webp": "image/webp", "sqlite": "application/vnd.sqlite3",
          "db": "application/vnd.sqlite3", "html": "text/html", "json": "application/octet-stream"}.get(ext, "application/octet-stream")
    return raw, ct


# ── the storage-shaped API ────────────────────────────────────────────────────────────────────────────────────────

def _route(path: str | os.PathLike[str]) -> tuple[str | None, str]:
    key = key_for(path)
    return key, (mode_of(key) if key else "local")


def _read_bytes(path: str | os.PathLike[str]) -> bytes | None:
    key, mode = _route(path)
    if mode in ("cutover", "rollback"):
        try:
            if kind_of(key) == "journal":
                entries = REMOTE.read_all(key)
                return None if entries is None else "".join(json.dumps(e) + "\n" for e in entries).encode("utf-8")
            r = REMOTE.get(key)
            return None if r is None else r[1]
        except DataStoreError as e:
            if e.code != "unavailable":
                raise
            log_drift("read", key, "write-failed", None, None, f"axf-data unreachable in {mode}: served the local read-only copy")
    try:
        data = Path(path).read_bytes()
    except OSError:
        return None
    if mode == "shadow" and kind_of(key) != "journal":
        body = _record_body(data) if kind_of(key) == "record" else None
        _compare_later(key, body[0] if body else data)
    return data


def read_json(path: str | os.PathLike[str], default: Any) -> Any:
    import copy
    raw = _read_bytes(path)
    if raw is None:
        return copy.deepcopy(default)
    try:
        return json.loads(raw)
    except ValueError:
        return copy.deepcopy(default)


def read_text(path: str | os.PathLike[str], default: str = "") -> str:
    raw = _read_bytes(path)
    if raw is None:
        return default
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return default


def read_bytes(path: str | os.PathLike[str]) -> bytes | None:
    return _read_bytes(path)


def _write(path: str | os.PathLike[str], raw: bytes, local: Callable[[], Path]) -> Path:
    key, mode = _route(path)
    if mode == "rollback":
        raise DataStoreError("read_only", f"{nsid_of(key)} is rolling back: writes wait until it is local again", 423)
    if mode == "cutover":
        body, ct = _remote_body(key, raw)
        REMOTE.put_latest(key, body, ct)
        return Path(path)
    out = local()
    if mode == "shadow":
        body, ct = _remote_body(key, raw)
        try:
            REMOTE.put_latest(key, body, ct)
        except DataStoreError as e:
            log_drift("write", key, "write-failed", {"etag": f"0-{_hash16(body)}"}, None, f"{e.code}: {e}")
    return out


def write_bytes(path: str | os.PathLike[str], data: bytes, **kw: Any) -> Path:
    return _write(path, data, lambda: storage.write_bytes(path, data, **kw))


def write_text(path: str | os.PathLike[str], text: str, **kw: Any) -> Path:
    return _write(path, text.encode(kw.get("encoding") or "utf-8"), lambda: storage.write_text(path, text, **kw))


def write_json(path: str | os.PathLike[str], data: Any, **kw: Any) -> Path:
    text = json.dumps(data, indent=kw.get("indent", 2), ensure_ascii=kw.get("ensure_ascii", True))
    return _write(path, text.encode("utf-8"), lambda: storage.write_json(path, data, **kw))


def append_jsonl(path: str | os.PathLike[str], entry: Any, **kw: Any) -> None:
    key, mode = _route(path)
    if key and kind_of(key) != "journal":
        key = None  # a .jsonl that maps onto a non-journal namespace stays a local file
        mode = "local"
    if mode == "rollback":
        raise DataStoreError("read_only", f"{nsid_of(key)} is rolling back", 423)
    if mode == "cutover":
        REMOTE.append(key, [entry], idem=uuid.uuid4().hex)
        return
    storage.append_jsonl(path, entry, **kw)
    if mode == "shadow":
        try:
            REMOTE.append(key, [entry], idem=uuid.uuid4().hex)
        except DataStoreError as e:
            log_drift("append", key, "append-failed", None, None, f"{e.code}: {e}")


def remote_mode(path: str | os.PathLike[str]) -> bool:
    """True when the file's namespace is in cutover or rollback (axf-data is the store, the file is a backup)."""
    return _route(path)[1] in ("cutover", "rollback")


def mirror(path: str | os.PathLike[str], raw: bytes) -> None:
    """For callers that keep their own local write (modes, owners): in shadow, the same bytes to axf-data."""
    key, mode = _route(path)
    if mode != "shadow":
        return
    body, ct = _remote_body(key, raw)
    try:
        REMOTE.put_latest(key, body, ct)
    except DataStoreError as e:
        log_drift("write", key, "write-failed", {"etag": f"0-{_hash16(body)}"}, None, f"{e.code}: {e}")


def exists(path: str | os.PathLike[str]) -> bool:
    if remote_mode(path):
        key = key_for(path)
        try:
            return REMOTE.get(key) is not None
        except DataStoreError as e:
            if e.code != "unavailable":
                raise
    return Path(path).is_file()


def remove(path: str | os.PathLike[str]) -> bool:
    """Delete a file (a tombstone on axf-data in cutover; mirrored in shadow). False when it wasn't there."""
    key, mode = _route(path)
    if mode == "rollback":
        raise DataStoreError("read_only", f"{nsid_of(key)} is rolling back", 423)

    def remote_delete() -> bool:
        try:
            REMOTE._send("DELETE", urllib.parse.quote(key), q={"force": 1})
            return True
        except DataStoreError as e:
            if e.code == "not_found":
                return False
            raise
    if mode == "cutover":
        return remote_delete()
    try:
        Path(path).unlink()
        was = True
    except FileNotFoundError:
        was = False
    if mode == "shadow":
        try:
            remote_delete()
        except DataStoreError as e:
            log_drift("write", key, "write-failed", None, None, f"delete: {e.code}: {e}")
    return was


def list_files(directory: str | os.PathLike[str]) -> list[str]:
    """Every file under `directory`, as posix paths relative to it (from axf-data in cutover / rollback)."""
    d = Path(directory)
    probe = key_for(d / "__probe__.md")
    if probe and mode_of(probe) in ("cutover", "rollback"):
        ns, _, rest = probe.partition("/")
        prefix = rest[: -len("__probe__.md")]
        out, after = [], ""
        try:
            while True:
                r = REMOTE.json("GET", ns, q={"prefix": prefix, "after": after, "limit": 1000})
                out += [i["path"][len(prefix):] for i in r["items"]]
                if not r.get("next"):
                    return sorted(out)
                after = r["next"]
        except DataStoreError as e:
            if e.code != "unavailable":
                raise
    if not d.is_dir():
        return []
    return sorted(p.relative_to(d).as_posix() for p in d.rglob("*") if p.is_file())


def sqlite_hydrate(path: str | os.PathLike[str]) -> bool:
    """A SQLite file kept as one blob (blob-sqlite): in cutover / rollback, fetch axf-data's newer copy before opening it
    (same `<file>.axf-etag` marker as framework/core/data-files.mjs sqliteHydrate)."""
    if not remote_mode(path):
        return False
    key, f = key_for(path), Path(path)
    tag = Path(f"{f}.axf-etag")
    have = tag.read_text().strip() if tag.is_file() else ""
    try:
        r = REMOTE.get(key)
    except DataStoreError as e:
        if e.code != "unavailable":
            raise
        log_drift("read", key, "write-failed", None, None, "axf-data unreachable: opened the local copy")
        return False
    if r is None or r[0]["etag"] == have:
        return False
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_name(f"{f.name}.axf-fetch-{os.getpid()}")
    tmp.write_bytes(r[1])
    for x in ("-wal", "-shm"):
        Path(f"{f}{x}").unlink(missing_ok=True)
    os.replace(tmp, f)
    tag.write_text(r[0]["etag"])
    return True


def sqlite_upload(path: str | os.PathLike[str], conn: Any) -> bool:
    """After a write transaction on a blob-sqlite file: in shadow / cutover, a consistent copy (VACUUM INTO) to axf-data.
    A newer copy found there is logged as drift and overwritten; in shadow any failure is drift only."""
    key, mode = _route(path)
    if not key or mode == "local":
        return False
    if mode == "rollback":
        raise DataStoreError("read_only", f"{nsid_of(key)} is rolling back", 423)
    f = Path(path)
    tmp = f.with_name(f"{f.name}.axf-upload-{os.getpid()}")
    tmp.unlink(missing_ok=True)
    try:
        conn.execute("VACUUM INTO ?", (str(tmp),))
        raw = tmp.read_bytes()
    finally:
        tmp.unlink(missing_ok=True)
    tag = Path(f"{f}.axf-etag")
    have = tag.read_text().strip() if tag.is_file() else ""
    try:
        try:
            r = REMOTE.put(key, raw, "application/vnd.sqlite3", if_match=have) if have else json.loads(REMOTE._send("PUT", urllib.parse.quote(key), headers={"content-type": "application/vnd.sqlite3"}, body=raw, q={"force": 1})[2])
        except DataStoreError as e:
            if e.code != "conflict":
                raise
            log_drift("write", key, "etag", {"etag": have}, {"rev": e.extra.get("rev"), "etag": e.extra.get("etag")}, "a newer copy was on axf-data: overwritten")
            r = json.loads(REMOTE._send("PUT", urllib.parse.quote(key), headers={"content-type": "application/vnd.sqlite3"}, body=raw, q={"force": 1})[2])
        tag.write_text(r["etag"])
        return True
    except DataStoreError as e:
        if mode == "shadow":
            log_drift("write", key, "write-failed", None, None, f"{e.code}: {e}")
            return False
        raise


class PluginData:
    """A plugin's lifecycle dataDir through the data layer: relative paths, same calls."""

    def __init__(self, folder: str):
        if not _FOLDER.match(folder or ""):
            raise ValueError(f"bad plugin folder {folder!r}")
        self.folder = folder
        self.dir = _roots()["plugins"] / folder

    def path(self, rel: str) -> Path:
        p = (self.dir / rel).resolve()
        if self.dir.resolve() not in p.parents and p != self.dir.resolve():
            raise ValueError(f"{rel!r} leaves the plugin's data folder")
        return p

    def read_json(self, rel: str, default: Any) -> Any:
        return read_json(self.path(rel), default)

    def read_text(self, rel: str, default: str = "") -> str:
        return read_text(self.path(rel), default)

    def write_json(self, rel: str, data: Any, **kw: Any) -> Path:
        return write_json(self.path(rel), data, **kw)

    def write_text(self, rel: str, text: str, **kw: Any) -> Path:
        return write_text(self.path(rel), text, **kw)

    def write_bytes(self, rel: str, data: bytes, **kw: Any) -> Path:
        return write_bytes(self.path(rel), data, **kw)

    def append_jsonl(self, rel: str, entry: Any, **kw: Any) -> None:
        append_jsonl(self.path(rel), entry, **kw)

    def key(self, rel: str) -> str | None:
        return key_for(self.path(rel))


def plugin(folder: str) -> PluginData:
    return PluginData(folder)


def status() -> dict:
    """What Settings → Plugins → Data store and `axf data status` show about this console's side."""
    doc = mode_doc()
    drift_dir = _store_dir() / "drift"
    drift = {}
    if drift_dir.is_dir():
        for f in drift_dir.glob("*.jsonl"):
            try:
                drift[f.stem.replace("__", "/")] = sum(1 for _ in f.open("rb"))
            except OSError:
                pass
    return {"$axf": "data-store-status@1", "configured": REMOTE.configured, "url": REMOTE.url, "mode": doc.get("mode") or "local",
            "namespaces": doc.get("namespaces") or {}, "driftLines": drift, "modeFile": str(_store_dir() / "mode.json")}
