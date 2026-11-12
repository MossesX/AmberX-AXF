#!/usr/bin/env python3
"""amberx-import: moves what the AmberX web app's server held into console storage (amberx-import@1).

Build move-amberx-web-app-into-the-console-amberx-andr, step s2. The contract is docs/contracts/amberx-console-api.md;
the data design is README.md beside this file. Seven data sets, one section each:

    ai             $AMBERX_DATA_DIR/ai.json (amberx-ai@1) + .app/ai.env  →  profiles (no secrets) in the amberx-ai plugin's
                   data folder; every key and refresh token into the console credential store (.axf-console/secrets.env)
    walkthrough    $AMBERX_DATA_DIR/walkthrough/**  →  the Molly guide plugin's data folder, amberx-walkthrough/**
    notes          hub tables lists + items (amberx-notes@1, hub-table@1) under /projects: checked and counted, kept in place
    recordings     audio-recording@1 + audio-part@1 under /projects: checked and counted, kept in place
    settings       hub-settings@1 app document + appearance under /projects: checked and counted, kept in place
    approvals      axHub's ledger: nothing moves, recorded as such
    notifications  the console's alerts-history.jsonl (alert-history@1) is created and back-filled with one legacy
                   delivery record per alert the AmberX app polled from the console

Idempotent: a second apply changes nothing and says so. `--check` writes nothing at all. `rollback` undoes exactly what
apply created (files, credential entries, history lines) and puts back what it replaced, from the manifest it keeps at
<console>/migrations/amberx-import.json. No secret is ever printed: output names credential entries, never values.

    python migrate.py [apply] [--from DIR] [--ai-env FILE] [--console DIR] [--projects DIR] [--only a,b] [--check] [--json]
    python migrate.py rollback [--console DIR] [--check] [--json]
    python migrate.py status   [--console DIR] [--json]

Exit codes: 0 done (or nothing to do), 2 credential conflicts left in place (see the `conflicts` list), 1 error.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO = Path(os.environ["AXF_ROOT"]).resolve() if os.environ.get("AXF_ROOT") else HERE.parents[3]
_PY = REPO / "framework" / "python"
if not (_PY / "axf_server").is_dir():  # AXF_ROOT pointing elsewhere (a test): this checkout's copy
    REPO = HERE.parents[3]
    _PY = REPO / "framework" / "python"
for _p in (_PY, REPO / "apps" / "console-web" / "server"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from axf_server import storage  # noqa: E402
from axf_server.credentials import KEY_RE, CredStore as _CredStore  # noqa: E402
from credentials import HEADER as CONSOLE_HEADER  # noqa: E402  (the console's store: the file the systems check writes)


def CredStore(path: Path) -> _CredStore:
    """The console's credential file, read and written without touching this process's environment."""
    return _CredStore(path, header=CONSOLE_HEADER, environ={})

FORMAT = "amberx-import@1"
HISTORY_FORMAT = "alert-history@1"
AI_FORMAT = "amberx-ai@1"
TABLE_FORMAT = "hub-table@1"
SETTINGS_FORMAT = "hub-settings@1"
RECORDING_FORMAT = "audio-recording@1"
PART_FORMAT = "audio-part@1"

SECTIONS = ("ai", "walkthrough", "notes", "recordings", "settings", "approvals", "notifications")
DEFAULT_FROM = "/opt/amberx-web/.app/data"  # apps/amberx-droid/deploy/install.sh: STATE=$DIR/.app, AMBERX_DATA_DIR=/data ← $STATE/data
DEFAULT_PROJECTS = os.environ.get("AXHUB_PROJECTS_DIR") or "/projects"
AI_PLUGIN = "amberx-ai"  # s3 brings the plugin; its data folder is read from its plugin.json when it exists
WALK_PLUGIN = "molly-guide"  # Molly's guide serves the walkthrough media (contract C22)
WALK_SUBDIR = "amberx-walkthrough"
LEGACY_DEVICE = "amberx-web"  # the history device name for alerts the AmberX app polled before per-device history existed
LEGACY_CHANNEL = "legacy-poll"
RUNS_KEPT = 20

ENV_KEY = re.compile(r"^AMBERX_([A-Z0-9_]+_API_KEY|CLAUDE_OAUTH_TOKEN|CLAUDE_REFRESH_TOKEN)$")
PROFILE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
RECORDING_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$")


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def iso_ms(v: Any) -> str | None:
    """An alert clock value (ms since the epoch; seconds tolerated) as ISO time."""
    if not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0:
        return None
    secs = v / 1000 if v > 1e11 else v
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(secs))


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def secret_name(pid: str, what: str) -> str:
    name = f"AMBERX_AI_{what}_{re.sub(r'[^A-Z0-9]', '_', pid.upper())}"
    if not KEY_RE.match(name):
        raise ValueError(f"profile id {pid!r} can't be a credential name")
    return name


def plugin_data_dir(console: Path, folder: str) -> Path:
    """A console plugin's data folder (plugin.json lifecycle.dataDir, always under .axf-console/), by default
    <console>/plugins/<folder> as plugin-lifecycle@1 prescribes."""
    manifest = REPO / "apps" / "console-web" / "plugins" / folder / "plugin.json"
    try:
        rel = (json.loads(manifest.read_text("utf-8")).get("lifecycle") or {}).get("dataDir")
    except (OSError, ValueError, AttributeError):
        rel = None
    prefix = ".axf-console/"
    if isinstance(rel, str) and rel.startswith(prefix) and ".." not in rel:
        return console / rel[len(prefix):]
    return console / "plugins" / folder


# ---------------------------------------------------------------- the manifest (what apply did, so rollback can undo it)


class Manifest:
    def __init__(self, console: Path) -> None:
        self.console = console
        self.path = console / "migrations" / "amberx-import.json"
        self.bak_dir = console / "migrations" / "amberx-import.bak"
        raw = storage.read_json(self.path, None)
        if not (isinstance(raw, dict) and raw.get("$axf") == FORMAT):
            raw = {}
        self.data: dict[str, Any] = {
            "$axf": FORMAT,
            "runs": [r for r in (raw.get("runs") or []) if isinstance(r, dict)],
            "created": {"files": [], "secrets": [], "history": [], **(raw.get("created") or {})},
            "backups": dict(raw.get("backups") or {}),
            "appliedAt": raw.get("appliedAt"),
            "rolledBackAt": raw.get("rolledBackAt"),
        }
        self.dirty = False

    # paths are kept relative to the console folder so the manifest survives a move of the checkout
    def rel(self, p: Path) -> str:
        return str(p.resolve().relative_to(self.console.resolve()))

    def abs(self, rel: str) -> Path:
        return self.console / rel

    def owns_file(self, p: Path) -> bool:
        r = self.rel(p)
        return any(f.get("path") == r for f in self.data["created"]["files"])

    def owns_secret(self, name: str) -> bool:
        return name in self.data["created"]["secrets"]

    def created_file(self, p: Path, size: int, sha: str | None) -> None:
        if not self.owns_file(p):
            self.data["created"]["files"].append({"path": self.rel(p), "size": size, "sha256": sha, "at": now_iso()})
            self.dirty = True

    def created_secret(self, name: str) -> None:
        if not self.owns_secret(name):
            self.data["created"]["secrets"].append(name)
            self.dirty = True

    def created_history(self, alert_id: str) -> None:
        self.data["created"]["history"].append(alert_id)
        self.dirty = True

    def backup(self, target: Path) -> None:
        """Keep the pre-migration original of a file apply is about to replace (first time only, moved not copied)."""
        r = self.rel(target)
        if r in self.data["backups"] or self.owns_file(target) or not target.exists():
            return
        storage.private_dir(self.bak_dir)
        dest = self.bak_dir / (re.sub(r"[^A-Za-z0-9._-]+", "_", r) + f".{int(time.time())}")
        shutil.move(str(target), str(dest))
        self.data["backups"][r] = self.rel(dest)
        self.dirty = True

    def record_run(self, run: dict[str, Any]) -> None:
        self.data["runs"] = ([*self.data["runs"], run])[-RUNS_KEPT:]
        self.dirty = True

    def save(self) -> None:
        storage.write_json(self.path, self.data)
        self.dirty = False


# ---------------------------------------------------------------- the run context


class Ctx:
    def __init__(self, *, src: Path, ai_env: Path, console: Path, projects: Path, check: bool, manifest: Manifest) -> None:
        self.src, self.ai_env, self.console, self.projects, self.check, self.manifest = src, ai_env, console, projects, check, manifest
        self.conflicts: list[str] = []

    def store(self) -> CredStore:
        return CredStore(self.console / "secrets.env")


# ---------------------------------------------------------------- sections


def run_ai(ctx: Ctx) -> dict[str, Any]:
    """Profiles stay amberx-ai@1 (minus `key` / `refresh`, plus `keyRef` / `refreshRef`: the credential names); the
    secrets go to the console credential store, which the console loads into its environment at start."""
    src = ctx.src / "ai.json"
    raw = storage.read_json(src, None)
    env_vals = {k: v for k, v in (CredStore(ctx.ai_env).read() if ctx.ai_env.is_file() else {}).items() if ENV_KEY.match(k) and v}
    db = raw if isinstance(raw, dict) and raw.get("$axf") == AI_FORMAT else None
    if db is None and not env_vals:
        return {"state": "empty", "detail": "no ai.json and no AMBERX_* keys in ai.env"}
    profiles: dict[str, Any] = {}
    secrets: dict[str, str] = {}
    for pid, p in ((db or {}).get("profiles") or {}).items():
        pid = str(pid)
        if not isinstance(p, dict) or not PROFILE_ID.match(pid):
            continue
        meta = {k: v for k, v in p.items() if k not in ("key", "refresh")}
        meta["id"] = pid
        for field, what, ref in (("key", "KEY", "keyRef"), ("refresh", "REFRESH", "refreshRef")):
            val = p.get(field)
            if isinstance(val, str) and val:
                name = secret_name(pid, what)
                secrets[name] = val
                meta[ref] = name
            else:
                meta.pop(ref, None)
        profiles[pid] = meta
    order = [i for i in ((db or {}).get("order") or []) if isinstance(i, str) and i in profiles]
    order += [i for i in profiles if i not in order]
    active = (db or {}).get("active")
    active = active if isinstance(active, str) and active in profiles else (order[0] if order else "")
    keep = (db or {}).get("keepAliveMin")
    keep = int(keep) if isinstance(keep, (int, float)) and not isinstance(keep, bool) and 0 <= keep <= 60 else 10
    doc = {"$axf": AI_FORMAT, "profiles": profiles, "order": order, "active": active, "keepAliveMin": keep}
    secrets.update(env_vals)  # per-kind fallbacks (AMBERX_<KIND>_API_KEY, the Claude plan pair) keep their names

    target = plugin_data_dir(ctx.console, AI_PLUGIN) / "ai.json"
    existing = storage.read_json(target, None)
    changed: list[str] = []
    if db is not None and existing != doc:
        changed.append("profiles")
        if not ctx.check:
            ctx.manifest.backup(target)
            storage.write_json(target, doc, indent=None)
            if not (target.exists() and ctx.manifest.rel(target) in ctx.manifest.data["backups"]):
                ctx.manifest.created_file(target, target.stat().st_size, sha256_file(target))
    store = ctx.store()
    have = store.read()
    added: list[str] = []
    conflicts: list[str] = []
    for name in sorted(secrets):
        cur = have.get(name)
        if cur == secrets[name]:
            continue
        if cur and not ctx.manifest.owns_secret(name):
            conflicts.append(name)  # someone typed a different value into the console: theirs stays
            continue
        added.append(name)
        if not ctx.check:
            store.set(name, secrets[name])
            ctx.manifest.created_secret(name)
    ctx.conflicts += conflicts
    state = "conflict" if conflicts else ("moved" if (changed or added) else "unchanged")
    return {"state": state, "profiles": len(profiles), "active": active, "target": str(target),
            "secretsWritten": added, "secretsKept": len(secrets) - len(added) - len(conflicts), "conflicts": conflicts}


def _same_file(a: Path, b: Path) -> bool:
    try:
        if os.path.samefile(a, b):
            return True
        sa, sb = a.stat(), b.stat()
        return sa.st_size == sb.st_size and sa.st_mtime_ns == sb.st_mtime_ns
    except OSError:
        return False


def _place(src: Path, dst: Path) -> None:
    """A hard link when the two folders share a filesystem (no second copy of 300 MB of video), else an atomic copy
    that keeps the source's times so the next run sees it as the same file."""
    storage.private_dir(dst.parent)
    tmp = dst.with_name(dst.name + f".tmp-{os.getpid()}")
    try:
        if dst.exists():
            dst.unlink()
        os.link(src, dst)
        return
    except OSError:
        pass
    shutil.copy2(src, tmp)
    os.replace(tmp, dst)


def run_walkthrough(ctx: Ctx) -> dict[str, Any]:
    src = ctx.src / "walkthrough"
    if not src.is_dir():
        return {"state": "empty", "detail": "no walkthrough folder (walkthrough/rebuild.sh writes it)"}
    dst = plugin_data_dir(ctx.console, WALK_PLUGIN) / WALK_SUBDIR
    copied: list[str] = []
    kept = 0
    size = 0
    for f in sorted(p for p in src.rglob("*") if p.is_file()):
        rel = f.relative_to(src)
        if any(part.startswith(".") or part.endswith(".tmp") or not SAFE_NAME.match(part) for part in rel.parts):
            continue
        to = dst / rel
        size += f.stat().st_size
        if to.exists() and _same_file(f, to):
            kept += 1
            continue
        copied.append(str(rel))
        if ctx.check:
            continue
        ctx.manifest.backup(to)
        _place(f, to)
        if ctx.manifest.rel(to) not in ctx.manifest.data["backups"]:  # a replaced original comes back on rollback instead
            ctx.manifest.created_file(to, to.stat().st_size, None if to.stat().st_size > (64 << 20) else sha256_file(to))
    return {"state": "moved" if copied else "unchanged", "target": str(dst), "files": kept + len(copied), "copied": copied,
            "bytes": size}


def _table(dir_: Path) -> tuple[dict[str, Any], dict[str, Any]] | None:
    head = storage.read_json(dir_ / "head.json", None)
    if not isinstance(head, dict) or head.get("$axf") != TABLE_FORMAT:
        return None
    if isinstance(head.get("rows"), dict):
        return head, dict(head["rows"])
    rows: dict[str, Any] = {}
    for i in range(int(head.get("chunks") or 0)):
        part = storage.read_json(dir_ / f"rows-{i}.json", None)
        if isinstance(part, dict):
            rows.update(part)
    return head, rows


def run_notes(ctx: Ctx) -> dict[str, Any]:
    """Notes, to-dos, tasks and lists already live where the console reads them (token-control's amberx targets):
    nothing moves; the tables are checked and counted so the cut-over has a before picture."""
    root = ctx.projects / "amberx-axf" / "_data" / "amberx-notes"
    tables: dict[str, Any] = {}
    for name in ("lists", "items"):
        t = _table(root / name)
        if t is None:
            tables[name] = {"present": False}
            continue
        head, rows = t
        info: dict[str, Any] = {"present": True, "count": len(rows), "declared": head.get("count"), "chunks": head.get("chunks") or 0,
                                "updatedAt": head.get("updatedAt"), "sha256": sha256_file(root / name / "head.json")}
        if name == "items":
            by: dict[str, int] = {}
            for r in rows.values():
                k = str(r.get("kind") or "note") if isinstance(r, dict) else "note"
                by[k] = by.get(k, 0) + 1
            info["byKind"] = by
        tables[name] = info
    if not any(t.get("present") for t in tables.values()):
        return {"state": "empty", "where": str(root)}
    return {"state": "in-place", "where": str(root), "tables": tables}


def run_recordings(ctx: Ctx) -> dict[str, Any]:
    root = ctx.projects / "amberx-recordings" / "_data" / "output-recorder"
    recs = root / "recordings"
    if not recs.is_dir():
        return {"state": "empty", "where": str(root)}
    count = parts_total = 0
    incomplete: list[str] = []
    for f in sorted(recs.glob("*.json")):
        rec = storage.read_json(f, None)
        if not isinstance(rec, dict) or rec.get("$axf") != RECORDING_FORMAT or not RECORDING_ID.match(str(rec.get("id") or "")):
            continue
        count += 1
        want = int(rec.get("parts") or 0)
        have = sum(1 for n in range(want) if (root / "parts" / str(rec["id"]) / f"{n:04d}.json").is_file())
        parts_total += have
        if have < want:
            incomplete.append(str(rec["id"]))
    return {"state": "in-place" if count else "empty", "where": str(root), "count": count, "parts": parts_total, "incomplete": incomplete}


def run_settings(ctx: Ctx) -> dict[str, Any]:
    base = ctx.projects / "_shared" / "_data" / "settings"
    app = storage.read_json(base / "apps" / "amberx-droid.json", None)
    look = storage.read_json(base / "appearance.json", None)
    out: dict[str, Any] = {"where": str(base)}
    if isinstance(app, dict) and app.get("$axf") == SETTINGS_FORMAT and isinstance(app.get("values"), dict):
        out["app"] = {"present": True, "keys": len(app["values"]), "updatedAt": app.get("updatedAt"), "updatedBy": app.get("updatedBy")}
    else:
        out["app"] = {"present": False}
    out["appearance"] = {"present": isinstance(look, dict) and bool(look)}
    out["state"] = "in-place" if out["app"]["present"] or out["appearance"]["present"] else "empty"
    return out


def run_approvals(ctx: Ctx) -> dict[str, Any]:
    return {"state": "stays-on-axhub", "detail": "approvals are axHub's ledger (contract section 4.4); the console relays, nothing is stored here"}


def _history_lines(p: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for line in storage.read_text(p).splitlines():
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if isinstance(rec, dict) and rec.get("$axf") == HISTORY_FORMAT:
            out.append(rec)
    return out


def run_notifications(ctx: Ctx) -> dict[str, Any]:
    """The AmberX server kept no notification history: the phone polled the console's alerts (T17). The console's
    history store (C35b) starts here, with one legacy record per alert the phone could have shown."""
    alerts = storage.read_json(ctx.console / "alerts.json", [])
    alerts = [a for a in alerts if isinstance(a, dict) and isinstance(a.get("id"), str) and a.get("id")] if isinstance(alerts, list) else []
    hist = ctx.console / "alerts-history.jsonl"
    have = {(r.get("alert"), r.get("device")) for r in _history_lines(hist)} if hist.exists() else set()
    new = [a for a in alerts if (a["id"], LEGACY_DEVICE) not in have]
    if not ctx.check and new:
        created = not hist.exists()
        for a in new:
            rec = {"$axf": HISTORY_FORMAT, "alert": a["id"], "key": a.get("key") or a["id"], "device": LEGACY_DEVICE, "channel": LEGACY_CHANNEL,
                   "deliveredAt": iso_ms(a.get("firstAt")) or now_iso(), "readAt": iso_ms(a.get("lastAt")) if a.get("ack") else None,
                   "tappedAt": None, "legacy": True}
            storage.append_jsonl(hist, rec)
            ctx.manifest.created_history(a["id"])
        if created:
            ctx.manifest.created_file(hist, hist.stat().st_size, None)
    return {"state": "moved" if new else ("unchanged" if alerts else "empty"), "target": str(hist), "alerts": len(alerts), "backfilled": len(new)}


RUNNERS = {"ai": run_ai, "walkthrough": run_walkthrough, "notes": run_notes, "recordings": run_recordings,
           "settings": run_settings, "approvals": run_approvals, "notifications": run_notifications}


# ---------------------------------------------------------------- apply / rollback / status


def apply(ctx: Ctx, only: tuple[str, ...]) -> dict[str, Any]:
    results: dict[str, Any] = {}
    for name in SECTIONS:
        if name not in only:
            results[name] = {"state": "skipped"}
            continue
        try:
            results[name] = RUNNERS[name](ctx)
        except Exception as e:  # one broken section never stops the others; the manifest records the failure
            results[name] = {"state": "error", "detail": f"{type(e).__name__}: {str(e)[:300]}"}
    run = {"at": now_iso(), "mode": "check" if ctx.check else "apply", "from": str(ctx.src), "projects": str(ctx.projects),
           "sections": {k: v.get("state") for k, v in results.items()}, "conflicts": list(ctx.conflicts)}
    if not ctx.check:
        ctx.manifest.record_run(run)
        if any(v.get("state") == "moved" for v in results.values()):
            ctx.manifest.data["appliedAt"] = now_iso()
            ctx.manifest.data["rolledBackAt"] = None
        ctx.manifest.save()
    return {"$axf": FORMAT, "mode": run["mode"], "sections": results, "conflicts": ctx.conflicts, "manifest": str(ctx.manifest.path)}


def rollback(ctx: Ctx) -> dict[str, Any]:
    m = ctx.manifest
    created = m.data["created"]
    console = ctx.console.resolve()
    # The history store: only the legacy lines this import added go; lines the console wrote since stay, and the file
    # goes only when it was ours and nothing else is left in it.
    hist = ctx.console / "alerts-history.jsonl"
    hist_rel = m.rel(hist)
    dropped = 0
    hist_removed = False
    legacy_ids = set(created["history"])
    if hist.is_file() and (legacy_ids or m.owns_file(hist)):
        keep: list[str] = []
        for line in storage.read_text(hist).splitlines():
            try:
                rec = json.loads(line)
            except ValueError:
                keep.append(line)
                continue
            if isinstance(rec, dict) and rec.get("legacy") is True and rec.get("device") == LEGACY_DEVICE and rec.get("alert") in legacy_ids:
                dropped += 1
                continue
            keep.append(line)
        hist_removed = not keep and m.owns_file(hist)
        if not ctx.check:
            if hist_removed:
                hist.unlink()
            elif dropped:
                storage.write_text(hist, "".join(l + "\n" for l in keep))
    removed: list[str] = [hist_rel] if hist_removed else []
    for f in reversed(created["files"]):
        p = m.abs(f["path"])
        if f["path"] == hist_rel or not p.is_file():
            continue
        removed.append(f["path"])
        if not ctx.check:
            p.unlink()
            parent = p.parent.resolve()
            while parent != console and console in parent.parents and parent.is_dir() and not any(parent.iterdir()):
                parent.rmdir()
                parent = parent.parent
    store = ctx.store()
    have = store.read()
    cleared = [n for n in created["secrets"] if n in have]
    if not ctx.check:
        for n in cleared:
            store.clear(n)
    restored: list[str] = []
    for target, bak in m.data["backups"].items():
        b = m.abs(bak)
        if b.exists():
            restored.append(target)
            if not ctx.check:
                storage.private_dir(m.abs(target).parent)
                shutil.move(str(b), str(m.abs(target)))
    if not ctx.check:
        m.data["created"] = {"files": [], "secrets": [], "history": []}
        m.data["backups"] = {}
        m.data["rolledBackAt"] = now_iso()
        m.record_run({"at": now_iso(), "mode": "rollback", "removed": len(removed), "secretsCleared": len(cleared), "historyDropped": dropped, "restored": len(restored)})
        m.save()
    return {"$axf": FORMAT, "mode": "rollback-check" if ctx.check else "rollback", "removed": removed, "secretsCleared": cleared,
            "historyDropped": dropped, "restored": restored, "manifest": str(m.path)}


def status(ctx: Ctx) -> dict[str, Any]:
    m = ctx.manifest
    return {"$axf": FORMAT, "manifest": str(m.path), "exists": m.path.is_file(), "appliedAt": m.data.get("appliedAt"),
            "rolledBackAt": m.data.get("rolledBackAt"), "created": {k: len(v) for k, v in m.data["created"].items()},
            "backups": len(m.data["backups"]), "lastRun": (m.data["runs"] or [None])[-1]}


# ---------------------------------------------------------------- CLI


def _print(result: dict[str, Any]) -> None:
    mode = result.get("mode", "status")
    if "sections" in result:
        print(f"amberx-import {mode}:")
        for name, r in result["sections"].items():
            extra = ""
            if name == "ai" and r.get("state") not in ("skipped", "empty", "error"):
                extra = f" ({r.get('profiles')} profiles, {len(r.get('secretsWritten') or [])} credentials written, {len(r.get('conflicts') or [])} conflicts)"
            elif name == "walkthrough" and r.get("files") is not None:
                extra = f" ({len(r.get('copied') or [])} of {r.get('files')} files copied, {r.get('bytes', 0) // (1 << 20)} MB)"
            elif name == "notes" and r.get("tables"):
                t = r["tables"]
                extra = f" ({t.get('lists', {}).get('count', 0)} lists, {t.get('items', {}).get('count', 0)} items {t.get('items', {}).get('byKind', {})})"
            elif name == "recordings" and r.get("count") is not None:
                extra = f" ({r.get('count')} recordings, {len(r.get('incomplete') or [])} incomplete)"
            elif name == "settings" and r.get("app"):
                extra = f" ({r['app'].get('keys', 0)} app settings, appearance {'yes' if r.get('appearance', {}).get('present') else 'no'})"
            elif name == "notifications" and r.get("alerts") is not None:
                extra = f" ({r.get('backfilled')} of {r.get('alerts')} alerts back-filled)"
            detail = f": {r['detail']}" if r.get("detail") and r.get("state") in ("error", "empty") else ""
            print(f"  {name:14} {r.get('state')}{extra}{detail}")
        if result.get("conflicts"):
            print("  credential conflicts (the console's value stays; clear it in Settings → Systems check to take AmberX's): " + ", ".join(result["conflicts"]))
    elif mode.startswith("rollback"):
        print(f"amberx-import {mode}: {len(result['removed'])} files removed, {len(result['secretsCleared'])} credentials cleared, "
              f"{result['historyDropped']} history lines dropped, {len(result['restored'])} originals restored")
    else:
        print(json.dumps(result, indent=2))
    print(f"  manifest: {result.get('manifest')}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Move the AmberX web app's data into console storage (amberx-import@1).")
    ap.add_argument("command", nargs="?", default="apply", choices=("apply", "rollback", "status"))
    ap.add_argument("--from", dest="src", default=os.environ.get("AMBERX_DATA_DIR") or DEFAULT_FROM, help="the AmberX server's data folder (ai.json, walkthrough/)")
    ap.add_argument("--ai-env", default=None, help="the AmberX install's ai.env (default: <from>/../ai.env)")
    ap.add_argument("--console", default=str(REPO / ".axf-console"), help="the console's state folder (.axf-console)")
    ap.add_argument("--projects", default=DEFAULT_PROJECTS, help="axHub's projects volume (/projects)")
    ap.add_argument("--only", default=",".join(SECTIONS), help="comma list of sections: " + ", ".join(SECTIONS))
    ap.add_argument("--check", action="store_true", help="show what would change; write nothing")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    only = tuple(s for s in re.split(r"[\s,]+", a.only) if s)
    bad = [s for s in only if s not in SECTIONS]
    if bad:
        print(f"unknown section(s): {', '.join(bad)}", file=sys.stderr)
        return 1
    src = Path(a.src)
    console = Path(a.console)
    ctx = Ctx(src=src, ai_env=Path(a.ai_env) if a.ai_env else src.parent / "ai.env", console=console, projects=Path(a.projects),
              check=a.check, manifest=Manifest(console))
    if a.command == "status":
        result = status(ctx)
    elif a.command == "rollback":
        result = rollback(ctx)
    else:
        if not src.is_dir() and any(s in only for s in ("ai", "walkthrough")):
            print(f"the AmberX data folder isn't there: {src} (use --from)", file=sys.stderr)
            return 1
        result = apply(ctx, only)
    if a.json:
        print(json.dumps(result, indent=2))
    else:
        _print(result)
    return 2 if result.get("conflicts") else 0


if __name__ == "__main__":
    sys.exit(main())
