"""Plugin inventory for the Plugin Manager: every console plugin, what it needs, who needs it, what clashes.

The console-specific part: it gathers facts (manifests, parts, data folder sizes, env set/unset without values, live
services, terminal lines, backups) into plugin-inventory@1 records and lets the shared engine (``engine.py`` =
``framework/core/engines/plugins.ts`` = Kotlin ``PluginInventoryEngine``) resolve dependencies, dependents, health and
clashes, so the web console, any AXF web app and Android agree. Pure functions over the plugins folder, the console's
plugin table, the live service registry and the terminal, so the self-test can drive them with fakes. Read-only.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Callable, Iterable

from . import engine

FOLDER_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,47}$")
API_LEVELS = [1]  # plugin@1 API levels this console runs
TARGET = "axf-console"
SKIP_DIRS = {"node_modules", "__pycache__", ".git", "dist", ".venv"}
SCOPE_NOTES = engine.SCOPE_NOTES


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


def plugin_record(folder: Path, root: Path, info: dict[str, Any], enabled: bool, live: list[dict[str, Any]], env: dict[str, str]) -> tuple[dict[str, Any], dict[str, Any]]:
    """One plugin folder → (plugin-inventory@1 record, console extras merged into the item)."""
    m, problem = read_manifest(folder)
    m = m or {}
    lc = m.get("lifecycle") if isinstance(m.get("lifecycle"), dict) else {}
    data_rel = lc.get("dataDir") or f".axf-console/plugins/{folder.name}"
    data_abs = (root / data_rel).resolve()
    own = (root / ".axf-console" / "plugins" / folder.name).resolve()
    data_ok = data_abs == own or str(data_abs).startswith(str(own) + os.sep)
    server_part = (folder / "server" / "__init__.py").exists()
    rec = engine.record(
        folder=folder.name,
        id=m.get("id", info.get("id", folder.name)),
        name=m.get("name", info.get("name", folder.name)),
        version=m.get("version", info.get("version", "")),
        apiLevel=m.get("apiLevel") if isinstance(m.get("apiLevel"), int) else None,
        targets=_as_list(m.get("targets")),
        provides=_as_list(m.get("provides")),
        requires=_as_list(m.get("requires")),
        optional=_as_list(m.get("optional")),
        uiEditor=_as_list(m.get("uiEditor")),
        scopes=_as_list(m.get("scopes")),
        enabled=bool(enabled),
        error=info.get("error") or problem,
        serverPart=server_part,
        server=info.get("server", "none") if server_part else "none",
        env=[{"name": n, "set": bool(env.get(n))} for n in _as_list(lc.get("env"))],
        dataDir=data_rel if data_ok else None,
        dataDirProblem=None if data_ok else f"dataDir {data_rel} is outside .axf-console/plugins/{folder.name}",
        services=[s["name"] for s in live if s.get("folder") == folder.name],
    )
    extras = {
        "description": m.get("description", ""),
        "author": m.get("author", ""),
        "kind": m.get("kind", ""),
        "builtWith": m.get("builtWith") if isinstance(m.get("builtWith"), dict) else None,
        "enabledByDefault": m.get("enabledByDefault", True) is not False,
        "removed": bool(info.get("removed")),
        "loaded": folder.name in info.get("_table", {}),
        "parts": {
            "web": (folder / "web" / "index.tsx").exists(),
            "server": server_part,
            "install": (folder / "install.mjs").exists(),
            "uninstall": (folder / "uninstall.mjs").exists(),
            "hooks": (folder / "hooks.mjs").exists(),
            "selfTest": any((folder / t).exists() for t in ("test.py", "test.mjs")),
            "readme": (folder / "README.md").exists(),
        },
        "lifecycle": {
            "managed": bool(lc),
            "dataDir": rec["dataDir"],
            "dataDirProblem": rec["dataDirProblem"],
            "data": tree_size(data_abs) if data_ok else {"files": 0, "bytes": 0},
            "mentions": _as_list(lc.get("mentions")),
        },
        "code": tree_size(folder),
    }
    return rec, extras


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
    records: list[dict[str, Any]] = []
    extras: dict[str, dict[str, Any]] = {}
    for folder in folders:
        info = dict(table.get(folder.name, {}))
        info["_table"] = table
        rec, ex = plugin_record(folder, root, info, is_enabled(folder.name), live, env)
        name = rec["name"]
        ex["logCount"] = sum(1 for line in terminal if _line_is(line, folder.name, name))
        ex["lastLog"] = next((line for line in reversed(terminal) if _line_is(line, folder.name, name)), None)
        ex["backups"] = _backups(backups_dir, folder.name)
        records.append(rec)
        extras[folder.name] = ex
    resolved = engine.build(records, context(live))
    items = [{**it, **extras[it["folder"]]} for it in resolved["items"]]
    return {"frame": engine.FRAME, "items": items, "services": live, "conflicts": resolved["conflicts"], "counts": resolved["counts"]}


def context(live: list[dict[str, Any]]) -> dict[str, Any]:
    """What this console resolves against (web: ``InventoryContext``)."""
    return {"apiLevels": list(API_LEVELS), "target": TARGET, "live": live}


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
