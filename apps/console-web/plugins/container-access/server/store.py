"""Container access — settings, the protected list, the audit log and change batches, all inside the plugin's dataDir."""
from __future__ import annotations

import fnmatch
import json
import os
import re
import secrets
import socket
import threading
import time
from pathlib import Path
from typing import Any

ROOT = Path(os.environ.get("AXF_ROOT", Path(__file__).resolve().parents[5])).resolve()
DATA = Path(os.environ.get("AXF_CONTAINER_ACCESS_DIR", ROOT / ".axf-console" / "plugins" / "container-access"))
BATCHES = DATA / "batches"
AUDIT = DATA / "audit.jsonl"
AUDIT_MAX = 5_000_000
_lock = threading.RLock()

# ---------------------------------------------------------------- protected list (built-ins are locked)
_DB = (r"postgres|postgresql|postgis|timescaledb|mysql|mariadb|percona|redis|valkey|keydb|dragonfly|mongo|mongodb|couchdb|"
       r"cassandra|scylla|clickhouse|cockroach|influxdb|elasticsearch|opensearch|neo4j|memcached|surrealdb|questdb|rethinkdb|arangodb")
BUILTIN: list[dict[str, Any]] = [
    {"id": "traefik", "label": "Traefik / coolify-proxy", "name": r"traefik|^coolify-proxy$", "image": r"(^|/)traefik(:|$)"},
    {"id": "coolify", "label": "Coolify", "name": r"^coolify(-|$)", "image": r"coollabsio/coolify"},
    {"id": "console", "label": "the Dev Console itself"},
    {"id": "docker-proxy", "label": "the Docker socket proxy", "labelKey": "axf.docker-proxy"},
    {"id": "database", "label": "database (writes would corrupt it; use a database tool with a dump instead)",
     "image": rf"(^|/)({_DB})[^/]*(:|$)", "coolifyDatabase": True},
]


def _self_ids() -> set[str]:
    out = {socket.gethostname()}
    for k in ("AXF_CONSOLE_CONTAINER", "HOSTNAME"):
        if os.environ.get(k):
            out.add(os.environ[k])
    return {x for x in out if x}


def protection(c: dict[str, Any], settings: dict[str, Any]) -> dict[str, Any] | None:
    """Why a container is protected, or None. ``c`` = {id, name, image, labels}."""
    name, image, labels = c.get("name", ""), c.get("image", ""), c.get("labels") or {}
    for rule in BUILTIN:
        if rule["id"] == "console":
            if any(c.get("id", "").startswith(x) and len(x) >= 12 for x in _self_ids()) or name in _self_ids() \
                    or labels.get("axf.console") == "1" or name == os.environ.get("AXF_CONSOLE_NAME", "axf-console"):
                return {"rule": "console", "label": rule["label"], "locked": True}
            continue
        if rule.get("labelKey") and rule["labelKey"] in labels:
            return {"rule": rule["id"], "label": rule["label"], "locked": True}
        if rule.get("name") and re.search(rule["name"], name, re.I):
            return {"rule": rule["id"], "label": rule["label"], "locked": True}
        if rule.get("image") and re.search(rule["image"], image, re.I):
            return {"rule": rule["id"], "label": rule["label"], "locked": True}
        if rule.get("coolifyDatabase") and (labels.get("coolify.type") == "database"
                                            or any(k.startswith("coolify.") and "database" in k.lower() for k in labels)):
            return {"rule": rule["id"], "label": rule["label"], "locked": True}
    for pat in settings.get("protect", []):
        if fnmatch.fnmatch(name, pat) or fnmatch.fnmatch(image, pat):
            return {"rule": "custom", "label": f"protected by you ({pat})", "locked": False}
    return None


def reachable(c: dict[str, Any], settings: dict[str, Any]) -> bool:
    if settings.get("reach") == "list":
        return any(fnmatch.fnmatch(c.get("name", ""), p) for p in settings.get("allow", []))
    return True


# ---------------------------------------------------------------- files
def _write_json(p: Path, data: Any) -> None:
    p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = p.with_suffix(p.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.chmod(tmp, 0o600)
    os.replace(tmp, p)


def _read_json(p: Path, default: Any) -> Any:
    try:
        return json.loads(p.read_text("utf-8"))
    except (OSError, ValueError):
        return default


DEFAULTS: dict[str, Any] = {"$axf": "container-access-settings@1", "reach": "all", "allow": [], "protect": [],
                            "maxReadKb": 512, "execTimeout": 300, "terminalUser": "0"}


def settings() -> dict[str, Any]:
    with _lock:
        return {**DEFAULTS, **_read_json(DATA / "settings.json", {})}


_PAT = re.compile(r"^[A-Za-z0-9_.:/*?\[\]-]{1,120}$")


def save_settings(patch: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        s = settings()
        if "reach" in patch:
            if patch["reach"] not in ("all", "list"):
                raise ValueError("reach is 'all' or 'list'")
            s["reach"] = patch["reach"]
        for k in ("allow", "protect"):
            if k in patch:
                vals = [str(v).strip() for v in patch[k] or [] if str(v).strip()]
                bad = [v for v in vals if not _PAT.match(v)]
                if bad:
                    raise ValueError(f"not a container name pattern: {bad[0]!r}")
                s[k] = sorted(set(vals))[:200]
        if "maxReadKb" in patch:
            s["maxReadKb"] = max(16, min(int(patch["maxReadKb"]), 8192))
        if "execTimeout" in patch:
            s["execTimeout"] = max(10, min(int(patch["execTimeout"]), 3600))
        if "terminalUser" in patch:
            u = str(patch["terminalUser"]).strip() or "0"
            if not re.match(r"^[A-Za-z0-9_.-]{1,32}(:[A-Za-z0-9_.-]{1,32})?$", u):
                raise ValueError("terminal user is a name or uid (optionally user:group)")
            s["terminalUser"] = u
        _write_json(DATA / "settings.json", s)
        return s


# ---------------------------------------------------------------- audit log
def audit(entry: dict[str, Any]) -> dict[str, Any]:
    e = {"at": int(time.time() * 1000), **entry}
    with _lock:
        DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
        if AUDIT.exists() and AUDIT.stat().st_size > AUDIT_MAX:
            os.replace(AUDIT, AUDIT.with_suffix(".1.jsonl"))
        fd = os.open(AUDIT, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "a", encoding="utf-8") as f:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")
    return e


def read_audit(limit: int = 200, container: str = "", op: str = "", batch: str = "") -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for p in (AUDIT, AUDIT.with_suffix(".1.jsonl")):
        if not p.exists():
            continue
        for line in reversed(p.read_text("utf-8", "replace").splitlines()):
            try:
                e = json.loads(line)
            except ValueError:
                continue
            c = e.get("container") or {}
            if container and container not in (c.get("name"), c.get("id")):
                continue
            if op and e.get("op") != op:
                continue
            if batch and e.get("batch") != batch:
                continue
            out.append(e)
            if len(out) >= limit:
                return out
    return out


# ---------------------------------------------------------------- batches
_ID = re.compile(r"^b-[0-9]{14}-[a-f0-9]{8}$")


def new_batch_id() -> str:
    return f"b-{time.strftime('%Y%m%d%H%M%S')}-{secrets.token_hex(4)}".lower()


def save_batch(b: dict[str, Any]) -> dict[str, Any]:
    b["updatedAt"] = int(time.time() * 1000)
    with _lock:
        _write_json(BATCHES / f"{b['id']}.json", b)
    return b


def get_batch(bid: str) -> dict[str, Any]:
    if not _ID.match(bid or ""):
        raise KeyError("no such batch")
    b = _read_json(BATCHES / f"{bid}.json", None)
    if not b:
        raise KeyError("no such batch")
    return b


def list_batches(status: str = "", conversation: str = "", limit: int = 50) -> list[dict[str, Any]]:
    if not BATCHES.exists():
        return []
    out = []
    for p in sorted(BATCHES.glob("b-*.json"), reverse=True):
        b = _read_json(p, None)
        if not b or (status and b.get("status") != status) or (conversation and b.get("conversation") != conversation):
            continue
        out.append(b)
        if len(out) >= limit:
            break
    return out


def prune_batches(days: int = 30) -> int:
    if not BATCHES.exists():
        return 0
    cut = time.time() - days * 86400
    n = 0
    for p in BATCHES.glob("b-*.json"):
        if p.stat().st_mtime < cut:
            p.unlink(missing_ok=True)
            n += 1
    return n
