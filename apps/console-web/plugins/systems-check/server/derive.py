"""Checks declared by the codebase itself, found by reading it (no AI, no guessing).

  * every console plugin (apps/console-web/plugins/*/plugin.json): its server loaded, the capability services it
    `requires` are provided, its data folder is private, and its own declared self-checks (hooks.mjs → checks(ctx),
    run through framework/cli/plugin-lifecycle.mjs checks <folder>; a failing one may name a terminal fix that
    Auto fix runs once Brett approves it);
  * every project manifest in the repo (framework/cli/project.mjs validate --all);
  * the shared data files the root manifest declares (data.shared) exist where the console reads them.

New plugins, projects and shared files are picked up automatically: nothing here names one.
"""
from __future__ import annotations

import json
import os
import re
import stat
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable

import console_context as cx
import plugin_services

Check = dict[str, Any]


def _node(args: list[str], timeout: float = 30) -> Any:
    r = subprocess.run(["node", *args], cwd=str(cx.ROOT), capture_output=True, text=True, timeout=timeout)
    return json.loads(r.stdout or "null")


def plugin_manifests() -> list[dict[str, Any]]:
    out = []
    d = cx.ROOT / "apps" / "console-web" / "plugins"
    for f in sorted(d.glob("*/plugin.json")) if d.is_dir() else []:
        if f.parent.name.startswith("_"):
            continue
        try:
            m = json.loads(f.read_text("utf-8"))
        except (OSError, ValueError) as e:
            out.append({"folder": f.parent.name, "error": f"plugin.json unreadable: {e}"})
            continue
        out.append({"folder": f.parent.name, **m, "hasHooks": (f.parent / "hooks.mjs").exists()})
    return out


def _settings_tab(m: dict[str, Any]) -> str | None:
    return next((p.split(":", 1)[1] for p in m.get("provides", []) if isinstance(p, str) and p.startswith("settings-tab:")), None)


def derive(item: Callable[..., Check]) -> list[Check]:
    """``item`` = SysCheck.item (same check format as the built-ins)."""
    out: list[Check] = []
    mans = plugin_manifests()

    def one_plugin(m: dict[str, Any]) -> list[Check]:
        f = m["folder"]
        cid = f"plugin:{f}"
        if m.get("error"):
            return [item(cid, "plugins", f"Plugin {f}", "error", m["error"], order=70)]
        info = cx.PLUGINS.get(f, {})
        enabled = cx.plugin_enabled(f)
        name = m.get("name", f)
        tab = _settings_tab(m)
        fix = {"type": "settings", "tab": tab or "plugins", "label": f"Open {name} settings" if tab else "Open Settings → Plugins"}
        details = [f"version {m.get('version', '?')}", f"server: {info.get('server', 'not loaded')}"]
        res: list[Check] = []
        if info.get("error"):
            return [item(cid, "plugins", f"{name} plugin", "error", f"failed to load: {info['error']}", details=details, fix=fix, order=70)]
        if not enabled:
            return [item(cid, "plugins", f"{name} plugin", "info", "disabled", details=details, fix=fix, order=79)]
        missing = [r.split(":", 1)[1] for r in m.get("requires", []) if isinstance(r, str) and r.startswith("service:") and plugin_services.get(r.split(":", 1)[1]) is None]
        opt_missing = [r.split(":", 1)[1] for r in m.get("optional", []) if isinstance(r, str) and r.startswith("service:") and plugin_services.get(r.split(":", 1)[1]) is None]
        if opt_missing:
            details.append("optional, not installed: " + ", ".join(opt_missing))
        data_dir = (m.get("lifecycle") or {}).get("dataDir")
        status, summary = "ok", "loaded and working"
        if missing:
            status, summary = "warn", "needs " + ", ".join(missing) + " (install a plugin that provides it)"
        if data_dir:
            p = cx.ROOT / data_dir
            if p.is_dir():
                mode = stat.S_IMODE(p.stat().st_mode)
                details.append(f"data {data_dir} ({oct(mode)})")
                if mode & 0o077 and status == "ok":
                    status, summary = "warn", f"data folder {data_dir} is readable by other users ({oct(mode)}); chmod 700 it"
                    if re.match(r"^[A-Za-z0-9._/-]+$", data_dir) and ".." not in data_dir.split("/") and not data_dir.startswith("/"):
                        fix = {"type": "host", "command": f"chmod 700 /opt/axf/{data_dir}"}  # Auto fix (approved on axHub)
        res.append(item(cid, "plugins", f"{name} plugin", status, summary, details=details, fix=fix, order=71))
        if m.get("hasHooks"):
            try:
                r = _node(["framework/cli/plugin-lifecycle.mjs", "checks", f, "--json"], timeout=20) or {}
                for c in r.get("checks", []):
                    if c["id"] == "data-folder" and not c["ok"]:  # never installed: its data folder appears on first use
                        res.append(item(f"{cid}:{c['id']}", "plugins", f"{name}: install script", "info", "not run yet (Install & uninstall → Install)",
                                        fix=fix, order=72))
                        continue
                    res.append(item(f"{cid}:{c['id']}", "plugins", f"{name}: {c['id'].replace('-', ' ')}", "ok" if c["ok"] else "warn",
                                    c.get("detail") or ("ok" if c["ok"] else "failed"), fix=c.get("fix") if isinstance(c.get("fix"), dict) else fix, order=72))
            except Exception as e:  # noqa: BLE001
                res.append(item(f"{cid}:checks", "plugins", f"{name}: self-checks", "unknown", f"couldn't run its declared checks: {str(e)[:160]}", order=72))
        return res

    with ThreadPoolExecutor(max_workers=6) as ex:
        for part in ex.map(one_plugin, mans):
            out.extend(part)

    # project manifests
    try:
        for p in _node(["framework/cli/project.mjs", "validate", "--all", "--json"], timeout=30) or []:
            v = p.get("validation") or {}
            name = p.get("name") or p.get("rel")
            st = "ok" if v.get("ok") and not v.get("warnings") else "warn" if v.get("ok") else "error"
            msgs = [str(x.get("message", x)) if isinstance(x, dict) else str(x) for x in (v.get("errors") or []) + (v.get("warnings") or [])]
            out.append(item(f"project:{p.get('rel')}", "data", f"Project manifest: {name}", st if p.get("exists") else "error",
                            "valid" if st == "ok" else (msgs[0] if msgs else "missing"), details=msgs[:8] + [f"{p.get('rel')}/project.manifest.json"],
                            instructions=[f"node framework/cli/project.mjs validate {p.get('rel')}"], order=63))
    except Exception as e:  # noqa: BLE001
        out.append(item("project:all", "data", "Project manifests", "unknown", f"couldn't validate: {str(e)[:160]}", order=63))

    # shared data declared by the root manifest
    try:
        shared = (json.loads((cx.ROOT / "project.manifest.json").read_text("utf-8")).get("data") or {}).get("shared") or []
        base = cx.persist_root()
        missing = [rel for rel in shared if not ((base and (base / rel).exists()) or (cx.ROOT / rel).exists())]
        out.append(item("shared-data-files", "data", "Shared data files (data.shared)", "warn" if missing else "ok",
                        f"missing: {', '.join(missing)}" if missing else f"all {len(shared)} present" + (f" in {base}" if base else " (repo copies)"),
                        details=[*shared], instructions=["node framework/cli/persist.mjs push   (seeds the shared folder from the repo copies)"], order=64))
    except Exception as e:  # noqa: BLE001
        out.append(item("shared-data-files", "data", "Shared data files (data.shared)", "unknown", str(e)[:200], order=64))
    return out


def requirement_status() -> dict[str, Any]:
    """What the AI switches need: a plugin providing axf.llm@1 (the AI assistant) and the Mosses agent (axf.agents@1 +
    the `coder` add-on agent). For each, which plugin would provide it, found by capability in the manifests."""
    mans = [m for m in plugin_manifests() if not m.get("error")]

    def providers(cap: str) -> list[dict[str, Any]]:
        return [{"folder": m["folder"], "name": m.get("name", m["folder"]), "tab": _settings_tab(m), "loaded": cx.PLUGINS.get(m["folder"], {}).get("server") == "loaded",
                 "enabled": cx.plugin_enabled(m["folder"])} for m in mans if f"service:{cap}" in m.get("provides", [])]

    llm = plugin_services.get("axf.llm@1")
    agents = plugin_services.get("axf.agents@1")
    mosses = None
    if agents:
        try:
            mosses = agents.get_agent(MOSSES)
        except Exception:  # noqa: BLE001
            mosses = None
    ready_llm = False
    if llm:
        try:
            ready_llm = any(p.get("keyReady", True) and p.get("enabled", True) is not False for p in llm.profiles())
        except Exception:  # noqa: BLE001
            ready_llm = False
    return {
        "assistant": {"ok": llm is not None, "ready": ready_llm, "providers": providers("axf.llm@1")},
        "mosses": {"ok": mosses is not None, "agentManager": agents is not None, "providers": providers("axf.agents@1"), "name": (mosses or {}).get("name")},
        "ok": llm is not None and mosses is not None,
    }


MOSSES = os.environ.get("AXF_SYSCHECK_AGENT", "coder")  # the Mosses add-on agent's id
