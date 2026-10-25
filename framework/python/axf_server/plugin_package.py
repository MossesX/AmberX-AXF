"""plugin-package@1 checks — the Python port of framework/cli/plugin-catalog.mjs (the reference).

A package is `{"$axf": "plugin-package@1", "kind", "folder", "id"?, "version"?, "sha256"?, "files": [{path, b64}]}`.
Any server that receives one (Build Pilot installing a pilot plugin read through the console, a future Python app)
checks it again on its own side, whatever the sender says:

    pkg = verify_package(raw, expect_sha256=entry["sha256"], kind="pilot", folder="extra-steps")
    for path, data in decode_files(pkg): …   # only after verify_package passed

Python's `$` also matches before a trailing newline (JS's doesn't), so the patterns here end in \\Z.
Same rules, same messages and same content hash as the .mjs, pinned by `framework/spec/fixtures/plugin-package.json`
(replayed by `framework/spec/check-axf-server.mjs` against the .mjs and by `framework/python/axf_server/test.py`):
  * kinds are an open registry (`KINDS`; add one with `register_kind`); folder names ^[a-z0-9][a-z0-9-]{1,47}$
  * file paths: relative, plain segments, no "..", no dot-files, no backslash/NUL, ≤ 200 characters, never
    node_modules/dist/caches, never secret-looking files (.env*, keys, *.pem, credentials.json, secrets.env), and
    only what the kind allows (pilot: plugin.json, README.md, web/**)
  * at most 600 files, 2 MB per file, 8 MB per plugin; a path listed twice (any case) or both file and folder
  * plugin.json must parse and match the kind's manifest tag, a dotted lowercase id, a name, a version like 1.2.3
  * content hash = sha256 over every file in path order: path \\0 size \\0 bytes
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Iterable, Pattern

__all__ = ["PACKAGE_SCHEMA", "LIMITS", "FOLDER_RE", "VERSION_RE", "SEGMENT_RE", "SECRET_RE", "SKIP", "KINDS", "Kind",
           "PackageError", "register_kind", "check_kind", "check_folder", "path_problem", "check_manifest",
           "content_hash", "verify_package", "decode_files", "b64_decode"]

PACKAGE_SCHEMA = "plugin-package@1"
LIMITS = {"files": 600, "fileBytes": 2 * 1024 * 1024, "totalBytes": 8 * 1024 * 1024, "pathChars": 200}
FOLDER_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,47}\Z")
VERSION_RE = re.compile(r"^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,40})?\Z", re.ASCII)
SEGMENT_RE = re.compile(r"^[A-Za-z0-9_@+][A-Za-z0-9._@+-]{0,99}\Z")
SECRET_RE = re.compile(r"(^|/)(\.env(\..*)?|secrets?\.env|credentials\.json|id_(rsa|ed25519|ecdsa|dsa)(\.pub)?|[^/]*\.(pem|key|p12|pfx|keystore|jks))\Z", re.I)
SKIP = frozenset({"node_modules", "dist", "dist-single", "__pycache__", ".git", "build", ".gradle", ".pytest_cache", ".mypy_cache", ".venv"})
_B64_RE = re.compile(r"^[A-Za-z0-9+/]*={0,2}\Z")
_ID_RE = re.compile(r"^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+\Z")


@dataclass(frozen=True)
class Kind:
    label: str
    manifest: str
    allow: Pattern[str] | None
    allow_source: str = ""
    id_pattern: Pattern[str] = _ID_RE


KINDS: dict[str, Kind] = {
    "console": Kind("Dev Console plugin", "plugin@1", None),
    "pilot": Kind("Build Pilot plugin", "pilot-plugin@1", re.compile(r"^(plugin\.json|README\.md|web\/.+)\Z"), r"^(plugin\.json|README\.md|web\/.+)$"),
    "axhub": Kind("axHub web plugin", "axhub-plugin@1", re.compile(r"^(plugin\.json|README\.md|web\/.+)\Z"), r"^(plugin\.json|README\.md|web\/.+)$"),
    "amberx": Kind("AmberX plugin", "amberx-plugin@1", re.compile(r"^(plugin\.json|README\.md|web\/.+)\Z"), r"^(plugin\.json|README\.md|web\/.+)$"),
}


class PackageError(ValueError):
    pass


def register_kind(name: str, kind: Kind) -> None:
    """Open registry: add a plugin kind (mirror the entry in plugin-catalog.mjs KINDS)."""
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,31}", name):
        raise ValueError("bad kind name")
    KINDS[name] = kind


def _js(v: Any) -> str:
    """`${v}` / JSON.stringify(v) as the .mjs prints them, for identical messages."""
    if v is None:
        return "null"
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def _tpl(v: Any) -> str:
    """JS template-literal string conversion."""
    if isinstance(v, str):
        return v
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)


def _u16len(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


def check_kind(kind: Any) -> Kind:
    if not isinstance(kind, str) or kind not in KINDS:
        raise PackageError(f'unknown plugin kind "{_tpl(kind) if kind is not _MISSING else "undefined"}" (known: {", ".join(KINDS)})')
    return KINDS[kind]


class _Missing:
    pass


_MISSING: Any = _Missing()


def check_folder(folder: Any) -> str:
    if not isinstance(folder, str) or not FOLDER_RE.match(folder):
        shown = "undefined" if folder is _MISSING else _tpl(folder)
        raise PackageError(f'"{shown}" is not a plugin folder name (lowercase letters, digits, dashes)')
    return folder


def path_problem(kind: str, path: Any) -> str:
    """Problems with one file path inside a plugin ("" = fine)."""
    if not isinstance(path, str) or not path:
        return "empty path"
    if _u16len(path) > LIMITS["pathChars"]:
        return f"{path[:40]}…: path too long"
    if "\\" in path or "\0" in path or path.startswith("/"):
        return f"{path}: not a plain relative path"
    for seg in path.split("/"):
        if seg in (".", "..") or not SEGMENT_RE.match(seg):
            return f'{path}: "{seg}" is not allowed in a plugin path'
        if seg in SKIP:
            return f"{path}: {seg} is never shipped"
    if SECRET_RE.search(path):
        return f"{path}: looks like a secret and is never shipped"
    k = KINDS.get(kind)
    if k and k.allow and not k.allow.search(path):
        return f"{path}: a {k.label} may only carry {k.allow_source or k.allow.pattern}"
    return ""


def check_manifest(kind: str, m: Any, folder: str | None = None) -> list[str]:
    k = check_kind(kind)
    if not isinstance(m, dict):
        return ["plugin.json is not an object"]
    problems: list[str] = []
    if m.get("$axf") != k.manifest:
        got = "undefined" if "$axf" not in m else _js(m["$axf"])
        problems.append(f"plugin.json must be {k.manifest} (got {got})")
    mid = m.get("id")
    if not isinstance(mid, str) or not k.id_pattern.search(mid) or _u16len(mid) > 120:
        problems.append("plugin.json id must be a dotted lowercase id (e.g. ai.amberx.pilot.my-plugin)")
    name = m.get("name")
    if not isinstance(name, str) or not name.strip() or _u16len(name) > 80:
        problems.append("plugin.json needs a name (≤ 80 characters)")
    ver = m.get("version")
    if not isinstance(ver, str) or not VERSION_RE.search(ver):
        problems.append("plugin.json needs a version like 1.2.3")
    mf = m.get("folder")
    if folder and mf and mf != folder:
        problems.append(f'plugin.json folder "{_tpl(mf)}" differs from "{folder}"')
    return problems


def b64_decode(s: str) -> bytes:
    """Decode the way Node's Buffer.from(s, 'base64') does for strings matching ^[A-Za-z0-9+/]*={0,2}$."""
    core = s.rstrip("=")
    if len(core) % 4 == 1:
        core = core[:-1]
    try:
        return base64.b64decode(core + "=" * (-len(core) % 4))
    except (binascii.Error, ValueError):
        return b""


def _sort_key(f: dict[str, Any]) -> bytes:
    return str(f["path"]).encode("utf-16-be")  # JS compares strings by UTF-16 code units


def content_hash(files: Iterable[dict[str, Any]]) -> str:
    """sha256 over every file, in path order: path \\0 size \\0 bytes (= contentHash in plugin-catalog.mjs)."""
    h = hashlib.sha256()
    for f in sorted(files, key=_sort_key):
        data = b64_decode(f["b64"])
        h.update(str(f["path"]).encode())
        h.update(b"\0")
        h.update(str(len(data)).encode())
        h.update(b"\0")
        h.update(data)
    return h.hexdigest()


def verify_package(pkg: Any, expect_sha256: str | None = None, *, kind: str | None = None, folder: str | None = None) -> dict[str, Any]:
    """Full check of a package (= verifyPackage in the .mjs). Returns it normalised (id, name, version, manifest,
    sha256, bytes) or raises PackageError with every problem joined by "; ". `kind`/`folder` additionally require
    the package to be that kind and folder (an installer asks for exactly one plugin)."""
    if not isinstance(pkg, dict) or pkg.get("$axf") != PACKAGE_SCHEMA:
        raise PackageError(f"not a {PACKAGE_SCHEMA} package")
    check_kind(pkg.get("kind", _MISSING))
    pkind: str = pkg["kind"]
    check_folder(pkg.get("folder", _MISSING))
    if kind is not None and pkind != kind:
        raise PackageError(f"not a {KINDS[kind].label if kind in KINDS else kind} (kind {_js(pkind)})")
    if folder is not None and pkg["folder"] != folder:
        raise PackageError("package folder does not match")
    files = pkg.get("files")
    if not isinstance(files, list) or len(files) == 0:
        raise PackageError("package has no files")
    if len(files) > LIMITS["files"]:
        raise PackageError(f"package has {len(files)} files (max {LIMITS['files']})")
    problems: list[str] = []
    seen: dict[str, None] = {}
    total = 0
    manifest: Any = None
    for f in files:
        if not isinstance(f, dict) or not isinstance(f.get("path"), str) or not isinstance(f.get("b64"), str) or not _B64_RE.match(f["b64"]):
            problems.append("a file entry is malformed")
            continue
        pp = path_problem(pkind, f["path"])
        if pp:
            problems.append(pp)
        lower = f["path"].lower()
        if lower in seen:
            problems.append(f"{f['path']}: listed twice")
        seen[lower] = None
        data = b64_decode(f["b64"])
        if len(data) > LIMITS["fileBytes"]:
            problems.append(f"{f['path']}: {len(data)} bytes (max {LIMITS['fileBytes']})")
        total += len(data)
        if f["path"] == "plugin.json":
            try:
                manifest = json.loads(data.decode("utf-8", "replace"), parse_constant=_no_constant)
            except ValueError:
                problems.append("plugin.json is not valid JSON")
    if total > LIMITS["totalBytes"]:
        problems.append(f"package is {total} bytes (max {LIMITS['totalBytes']})")
    for d in list(seen):
        for other in seen:
            if other.startswith(d + "/"):
                problems.append(f"{d} is both a file and a folder")
    if _js_falsy(manifest):
        problems.append("package has no plugin.json")
    else:
        problems.extend(check_manifest(pkind, manifest, pkg["folder"]))
    if any(not isinstance(f, dict) or not isinstance(f.get("path"), str) or not isinstance(f.get("b64"), str) for f in files):
        # The .mjs throws a TypeError while hashing such a package; refuse it here too, with the problems found.
        raise PackageError("; ".join(problems))
    h = content_hash(files)
    if pkg.get("sha256") and pkg["sha256"] != h:
        problems.append("content hash does not match the files (damaged or altered package)")
    if expect_sha256 and expect_sha256 != h:
        problems.append("package does not match the catalog entry (damaged or altered)")
    if not _js_falsy(manifest):
        mget = manifest.get if isinstance(manifest, dict) else (lambda _k: None)
        if pkg.get("version") and pkg["version"] != mget("version"):
            problems.append("package version differs from plugin.json")
        if pkg.get("id") and pkg["id"] != mget("id"):
            problems.append("package id differs from plugin.json")
    if problems:
        raise PackageError("; ".join(problems))
    assert isinstance(manifest, dict)
    return {**pkg, "id": manifest["id"], "name": manifest["name"], "version": manifest["version"], "manifest": manifest,
            "sha256": h, "bytes": total}


def _no_constant(name: str) -> Any:
    raise ValueError(f"{name} is not JSON")  # JSON.parse refuses NaN/Infinity; so does this port


def _js_falsy(v: Any) -> bool:
    return v is None or v is False or v == "" or (isinstance(v, (int, float)) and not isinstance(v, bool) and v == 0)


def decode_files(pkg: dict[str, Any]) -> list[tuple[str, bytes]]:
    """(path, bytes) for every file of a package that passed verify_package."""
    return [(f["path"], b64_decode(f["b64"])) for f in pkg["files"]]
