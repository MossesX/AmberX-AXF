"""Plugin inventory for the Plugin Manager: every console plugin, what it needs, who needs it, what clashes.

Pure functions over the plugins folder, the console's plugin table, the live service registry and the terminal, so
the self-test can drive them with fakes. Read-only: nothing here writes, and environment variables are reported as
set / not set, never their values.

Dependency records (``dependencies`` on each plugin) are the "details" view of what a plugin needs:

    {"kind": "service", "name": "axf.llm@1", "required": false, "status": "ok|missing|disabled|optional-missing",
     "providers": [{"folder", "name", "enabled"}], "detail": "...why it matters / what to do..."}
    {"kind": "env", "name": "GITHUB_TOKEN", "required": false, "status": "set|unset", "detail": "..."}
    {"kind": "framework", "name": "plugin@1 apiLevel 1", "required": true, "status": "ok|unsupported", "detail": "..."}
    {"kind": "scope", "name": "NETWORK", "required": true, "status": "granted", "detail": "..."}
    {"kind": "core", "name": "credential store", ...}   # console features a plugin leans on (declared, not guessed)
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Callable, Iterable

FOLDER_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,47}$")
API_LEVELS = {1}  # plugin@1 API levels this console runs
SKIP_DIRS = {"node_modules", "__pycache__", ".git", "dist", ".venv"}

SCOPE_NOTES = {
    "ROUTES": "adds server routes under /api/plugins/<folder>/ (console token on every method, 404 while disabled)",
    "NETWORK": "makes outbound network calls from the console server",
    "FILES": "reads or writes files on the console server",
    "SETTINGS": "adds settings groups or tabs",
    "ASSETS": "registers assets",
    "ACTIONS": "registers actions",
    "MENU_ITEMS": "adds menu or context-menu items",
    "BACKGROUND": "runs background work in the console server",
    "NOTIFICATIONS": "sends notifications",
    "DEVICE": "talks to devices or containers",
    "IDENTITY": "reads who is signed in",
    "BILLING": "touches billing",
}


def _service_of(entry: str) -> str | None:
    return entry[len("service:"):] if isinstance(entry, str) and entry.startswith("service:") else None


def _as_list(v: Any) -> list[str]:
    return [x for x in v if isinstance(x, str)] if isinstance(v, list) else []


def read_manifest(folder: Path) -> tuple[dict[str, Any] | None, str | None]:
    try:
        raw = json.loads((folder / "plugin.json").read_text())
    except FileNotFoundError:
        return None, "no plugin.json"
    except (OSError, ValueError) as e:
        return None, f"plugin.json unreadable: {type(e).__name__}"
    if not isinstance(raw, dict) or raw.get("$axf") != "plugin@1":
        return None, "plugin.json is not a plugin@1 manifest"
    return raw, None


def tree_size(path: Path, limit: int = 20000) -> dict[str, int]:
    """Files and bytes under a folder, never following symlinks, skipping build/dependency folders."""
    files = size = 0
    if not path.is_dir() or path.is_symlink():
        return {"files": 0, "bytes": 0}
    stack = [path]
    while stack and files < limit:
        d = stack.pop()
        try:
            entries = list(os.scandir(d))
        except OSError:
            continue
        for e in entries:
            if e.is_symlink():
                continue
            if e.is_dir(follow_symlinks=False):
                if e.name not in SKIP_DIRS:
                    stack.append(Path(e.path))
            elif e.is_file(follow_symlinks=False):
                files += 1
                try:
                    size += e.stat(follow_symlinks=False).st_size
                except OSError:
                    pass
    return {"files": files, "bytes": size}


def file_list(folder: Path, limit: int = 400) -> list[dict[str, Any]]:
    """Relative paths + sizes in a plugin folder (no symlinks, no dependency folders), for the detail pane."""
    out: list[dict[str, Any]] = []
    if not folder.is_dir() or folder.is_symlink():
        return out
    for root, dirs, files in os.walk(folder, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not os.path.islink(os.path.join(root, d)))
        for f in sorted(files):
            p = Path(root) / f
            if p.is_symlink():
                continue
            try:
                size = p.stat().st_size
            except OSError:
                continue
            out.append({"path": str(p.relative_to(folder)), "bytes": size})
            if len(out) >= limit:
                return out
    return out


def _env_detail(name: str, plugin: str) -> str:
    return f"{plugin} reads {name} from the console server's environment (Settings → Connections or the systems check can set it)."


def build_inventory(
    plugins_dir: Path,
    root: Path,
    table: dict[str, dict[str, Any]],
    is_enabled: Callable[[str], bool],
    services: Iterable[dict[str, Any]],
    terminal: Iterable[dict[str, Any]] = (),
    env: dict[str, str] | None = None,
    backups_dir: Path | None = None,
) -> dict[str, Any]:
    """Everything the Plugin Manager shows. ``table`` is the console's PLUGINS dict, ``services`` its live registry."""
    env = os.environ if env is None else env
    live = [s for s in services if isinstance(s, dict)]
    terminal = list(terminal)
    folders = sorted(p for p in plugins_dir.iterdir() if p.is_dir() and not p.name.startswith("_") and not p.is_symlink()) if plugins_dir.is_dir() else []

    items: list[dict[str, Any]] = []
    for folder in folders:
        m, problem = read_manifest(folder)
        info = table.get(folder.name, {})
        m = m or {}
        lc = m.get("lifecycle") if isinstance(m.get("lifecycle"), dict) else {}
        data_rel = lc.get("dataDir") or f".axf-console/plugins/{folder.name}"
        data_abs = (root / data_rel).resolve()
        own = (root / ".axf-console" / "plugins" / folder.name).resolve()
        data_ok = data_abs == own or str(data_abs).startswith(str(own) + os.sep)
        item: dict[str, Any] = {
            "folder": folder.name,
            "id": m.get("id", info.get("id", folder.name)),
            "name": m.get("name", info.get("name", folder.name)),
            "version": m.get("version", info.get("version", "")),
            "description": m.get("description", ""),
            "author": m.get("author", ""),
            "kind": m.get("kind", ""),
            "apiLevel": m.get("apiLevel"),
            "targets": _as_list(m.get("targets")),
            "scopes": _as_list(m.get("scopes")),
            "provides": _as_list(m.get("provides")),
            "requires": _as_list(m.get("requires")),
            "optional": _as_list(m.get("optional")),
            "uiEditor": _as_list(m.get("uiEditor")),
            "builtWith": m.get("builtWith") if isinstance(m.get("builtWith"), dict) else None,
            "enabledByDefault": m.get("enabledByDefault", True) is not False,
            "enabled": bool(is_enabled(folder.name)),
            "server": info.get("server", "none"),
            "error": info.get("error") or problem,
            "removed": bool(info.get("removed")),
            "loaded": folder.name in table,
            "parts": {
                "web": (folder / "web" / "index.tsx").exists(),
                "server": (folder / "server" / "__init__.py").exists(),
                "install": (folder / "install.mjs").exists(),
                "uninstall": (folder / "uninstall.mjs").exists(),
                "hooks": (folder / "hooks.mjs").exists(),
                "selfTest": any((folder / t).exists() for t in ("test.py", "test.mjs")),
                "readme": (folder / "README.md").exists(),
            },
            "lifecycle": {
                "managed": bool(lc),
                "dataDir": data_rel if data_ok else None,
                "dataDirProblem": None if data_ok else f"dataDir {data_rel} is outside .axf-console/plugins/{folder.name}",
                "data": tree_size(data_abs) if data_ok else {"files": 0, "bytes": 0},
                "mentions": _as_list(lc.get("mentions")),
            },
            "code": tree_size(folder),
            "env": [{"name": n, "set": bool(env.get(n))} for n in _as_list(lc.get("env"))],
            "services": [s["name"] for s in live if s.get("folder") == folder.name],
            "logCount": sum(1 for line in terminal if _line_is(line, folder.name, m.get("name", ""))),
            "lastLog": next((line for line in reversed(terminal) if _line_is(line, folder.name, m.get("name", ""))), None),
            "backups": _backups(backups_dir, folder.name),
        }
        items.append(item)

    providers = _providers(items, live)
    for it in items:
        it["dependencies"] = _dependencies(it, providers, items)
        it["dependents"] = _dependents(it, items)
        it["health"] = _health(it)
    conflicts = _conflicts(items, live)
    for it in items:
        it["conflicts"] = [c["id"] for c in conflicts if it["folder"] in c["folders"]]
    return {
        "items": items,
        "services": live,
        "conflicts": conflicts,
        "counts": {
            "total": len(items),
            "enabled": sum(1 for i in items if i["enabled"]),
            "errors": sum(1 for i in items if i["error"]),
            "missingDeps": sum(1 for i in items if any(d["status"] in ("missing", "disabled") and d["required"] for d in i["dependencies"])),
            "conflicts": len(conflicts),
            "editors": sum(1 for i in items if i["uiEditor"]),
        },
    }


def _backups(backups_dir: Path | None, folder: str) -> int:
    if not backups_dir or not backups_dir.is_dir():
        return 0
    try:
        # plugin-lifecycle.mjs names them <folder>-<stamp>.tar.gz; the stamp starts with a digit, so a folder named ai never counts the backups of a folder whose name merely starts with ai-.
        return sum(1 for p in backups_dir.iterdir() if re.match(re.escape(folder) + r"-\d", p.name))
    except OSError:
        return 0


def _line_is(line: dict[str, Any], folder: str, name: str) -> bool:
    ch = str(line.get("channel", ""))
    if ch == folder or ch.startswith(folder + ":") or ch.startswith(folder + "."):
        return True
    if ch == "plugins":
        text = str(line.get("text", ""))
        # "<folder> …" / "<folder>: …" / "<Name> …" — never a longer folder that merely starts the same ("llm-extra")
        return bool(re.match(re.escape(folder) + r"(:|\s|$)", text)) or (bool(name) and text.startswith(name + " "))
    return False


def logs_for(terminal: Iterable[dict[str, Any]], folder: str, name: str = "", limit: int = 200, level: str = "") -> list[dict[str, Any]]:
    out = [line for line in terminal if _line_is(line, folder, name) and (not level or line.get("level") == level)]
    return out[-max(1, min(limit, 1000)):]


def _providers(items: list[dict[str, Any]], live: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Capability → plugins that provide it (declared in plugin.json, plus whatever registered live)."""
    by: dict[str, list[dict[str, Any]]] = {}
    for it in items:
        for p in it["provides"]:
            svc = _service_of(p)
            if svc:
                by.setdefault(svc, []).append({"folder": it["folder"], "name": it["name"], "enabled": it["enabled"], "live": svc in it["services"]})
    for s in live:
        name, folder = s.get("name"), s.get("folder")
        if name and folder and not any(p["folder"] == folder for p in by.get(name, [])):
            it = next((i for i in items if i["folder"] == folder), None)
            by.setdefault(name, []).append({"folder": folder, "name": it["name"] if it else folder, "enabled": bool(s.get("enabled")), "live": True})
    return by


def _dependencies(it: dict[str, Any], providers: dict[str, list[dict[str, Any]]], items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deps: list[dict[str, Any]] = []
    level = it.get("apiLevel")
    deps.append({
        "kind": "framework", "name": f"plugin@1 API level {level}", "required": True,
        "status": "ok" if level in API_LEVELS else "unsupported",
        "detail": "The console runs plugin@1 API level " + ", ".join(str(x) for x in sorted(API_LEVELS)) + ".",
    })
    if "axf-console" not in it["targets"]:
        deps.append({"kind": "framework", "name": "target axf-console", "required": True, "status": "unsupported",
                     "detail": 'plugin.json "targets" must include "axf-console" for the console to load it.'})
    seen: set[str] = set()
    for required, entries in ((True, it["requires"]), (False, it["optional"])):
        for entry in entries:
            svc = _service_of(entry)
            if not svc:
                deps.append({"kind": "other", "name": entry, "required": required, "status": "declared",
                             "detail": "Declared in plugin.json; the console doesn't check this kind of dependency yet."})
                continue
            if svc in seen:
                continue
            seen.add(svc)
            provs = [p for p in providers.get(svc, []) if p["folder"] != it["folder"]]
            if any(p["enabled"] for p in provs):
                status = "ok"
            elif provs:
                status = "disabled"
            else:
                status = "missing" if required else "optional-missing"
            who = ", ".join(p["name"] for p in provs) or "no installed plugin"
            if status == "ok":
                detail = f"Provided by {who}."
            elif status == "disabled":
                detail = f"Provided by {who}, which is switched off. Enable it" + (" or this plugin can't work." if required else " to turn this feature on.")
            elif required:
                detail = "No installed plugin provides it, so this plugin can't do its job until one is installed."
            else:
                detail = "Optional: the plugin works without it; the features that use it stay hidden or greyed out."
            deps.append({"kind": "service", "name": svc, "required": required, "status": status, "providers": provs, "detail": detail})
    for e in it["env"]:
        deps.append({"kind": "env", "name": e["name"], "required": False, "status": "set" if e["set"] else "unset", "detail": _env_detail(e["name"], it["name"])})
    for s in it["scopes"]:
        deps.append({"kind": "scope", "name": s, "required": True, "status": "granted", "detail": SCOPE_NOTES.get(s.upper(), "Declared scope.")})
    if it["parts"]["server"]:
        deps.append({"kind": "core", "name": "console API", "required": True, "status": "ok" if it["server"] == "loaded" else ("error" if it["server"] == "error" else "not loaded"),
                     "detail": "Its server part runs inside the console API (FastAPI) and is mounted at /api/plugins/" + it["folder"] + "/."})
    return deps


def _dependents(it: dict[str, Any], items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    mine = {s for s in (_service_of(p) for p in it["provides"]) if s} | set(it["services"])
    out: list[dict[str, Any]] = []
    for other in items:
        if other["folder"] == it["folder"]:
            continue
        for required, entries in ((True, other["requires"]), (False, other["optional"])):
            for e in entries:
                svc = _service_of(e)
                if svc and svc in mine:
                    out.append({"folder": other["folder"], "name": other["name"], "service": svc, "required": required, "enabled": other["enabled"]})
    return out


def _health(it: dict[str, Any]) -> str:
    if it["error"] or it["server"] == "error":
        return "error"
    if any(d["required"] and d["status"] in ("missing", "disabled", "unsupported") for d in it["dependencies"]):
        return "blocked"
    if not it["enabled"]:
        return "off"
    if any(d["status"] in ("optional-missing", "unset") for d in it["dependencies"]) or it["lifecycle"]["dataDirProblem"]:
        return "partial"
    return "ok"


def _conflicts(items: list[dict[str, Any]], live: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Read-only clash report (the patching/uninstall flow is pending item plugin-conflicts, parked as unsafe)."""
    out: list[dict[str, Any]] = []

    def add(kind: str, key: str, folders: list[str], detail: str, severity: str = "warn") -> None:
        out.append({"id": f"{kind}:{key}", "kind": kind, "key": key, "folders": sorted(set(folders)), "detail": detail, "severity": severity})

    by_id: dict[str, list[str]] = {}
    for it in items:
        by_id.setdefault(it["id"], []).append(it["folder"])
    for pid, fs in by_id.items():
        if len(fs) > 1:
            add("plugin-id", pid, fs, "Two folders declare the same plugin id; the console can't tell them apart.", "error")
    contrib: dict[str, list[str]] = {}
    for it in items:
        for p in it["provides"]:
            contrib.setdefault(p, []).append(it["folder"])
    for key, fs in contrib.items():
        if len(set(fs)) > 1:
            svc = _service_of(key)
            if svc:
                add("service", svc, fs, "More than one plugin provides this capability; the last one loaded wins (plugin_services keeps one provider).")
            else:
                add("contribution", key, fs, "Two plugins contribute the same id; the last one installed replaces the other's.")
    data: dict[str, list[str]] = {}
    for it in items:
        d = it["lifecycle"]["dataDir"]
        if d:
            data.setdefault(d, []).append(it["folder"])
    for d, fs in data.items():
        if len(fs) > 1:
            add("data-dir", d, fs, "Two plugins share a data folder; uninstalling one would delete the other's data.", "error")
    editors: dict[str, list[str]] = {}
    for it in items:
        if it["enabled"]:
            for kind in it["uiEditor"]:
                editors.setdefault(kind, []).append(it["folder"])
    for kind, fs in editors.items():
        if len(fs) > 1:
            add("ui-editor", kind, fs, "More than one enabled plugin edits these values. Allowed: the last save wins, and each editor reloads current values when it opens or regains focus.", "info")
    return out
