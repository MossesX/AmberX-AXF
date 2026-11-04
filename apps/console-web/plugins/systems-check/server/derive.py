"""Checks declared by the codebase itself, found by reading it (no AI, no guessing).

  * every console plugin (apps/console-web/plugins/*/plugin.json): its server loaded, the capability services it
    `requires` are provided, its data folder is private, and its own declared self-checks (hooks.mjs → checks(ctx),
    run through framework/cli/plugin-lifecycle.mjs checks <folder>);
  * every project manifest in the repo (framework/cli/project.mjs validate --all);
  * every app whose baked framework copy (src/axf) is behind the framework (framework/cli/rebake.mjs): one row each,
    Auto fix re-bakes it on branch rebake/<app> and opens a pull request (an app with edited baked files gets none);
  * the shared data files the root manifest declares (data.shared) exist where the console reads them.

New plugins, projects and shared files are picked up automatically: nothing here names one.
"""
from __future__ import annotations

import json
import os
import stat
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable

import console_context as cx
import plugin_services

Check = dict[str, Any]

# Auto fixes for the checks found here, rebuilt on every run (check id → fn returning what it did); /fix/{id} reads it.
FIXES: dict[str, Callable[[], str]] = {}
AUTO = {"type": "action", "label": "Fix automatically"}


def _lock_down(path: Path) -> str:
    """A plugin's data folder: owner only (folders 700, files 600), never following links."""
    n = 0
    for p in [path, *path.rglob("*")]:
        if p.is_symlink():
            continue
        os.chmod(p, 0o700 if p.is_dir() else 0o600)
        n += 1
    return f"made {path.name} owner-only ({n} entries)"


def _enable(folders: list[str]) -> Callable[[], str]:
    def run() -> str:
        for f in folders:
            cx.set_plugin_enabled(f, True)
        return "switched on " + ", ".join(folders)
    return run


def _install(folder: str) -> Callable[[], str]:
    def run() -> str:
        r = subprocess.run(["node", "framework/cli/plugin-lifecycle.mjs", "install", folder], cwd=str(cx.ROOT), capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            raise RuntimeError((r.stderr or r.stdout or "install failed").strip().splitlines()[-1][:200])
        return f"ran {folder}'s install script"
    return run


def _rebake(app_dir: str) -> Callable[[], str]:
    """Re-bake one app on branch rebake/<app> from origin's main and open a PR (the checkout here is never touched)."""
    def run() -> str:
        r = _node(["framework/cli/rebake.mjs", "publish", app_dir, "--json"], timeout=180) or {}
        if r.get("error"):
            raise RuntimeError(str(r["error"])[:200])
        return f"re-baked {app_dir}: pull request {r['pr']}" if r.get("pushed") else str(r.get("note") or "already current")
    return run


def _rebake_row(item: Callable[..., Check], a: dict[str, Any]) -> Check:
    d, app, state = a.get("dir", "?"), a.get("app") or a.get("dir", "?"), a.get("state")
    cid = f"rebake:{d}"
    files = [f"changed {f}" for f in a.get("changed", [])] + [f"new {f}" for f in a.get("missing", [])] + [f"removed {f}" for f in a.get("extra", [])]
    if state == "current":
        return item(cid, "data", f"{app}: baked framework", "ok", "current", details=[d], order=65)
    if state == "stale":
        FIXES[cid] = _rebake(d)
        n = len(files)
        row = item(cid, "data", f"{app}: needs a re-bake", "warn", f"{n} framework file{'s' * (n != 1)} behind; Auto fix re-bakes it on a branch and opens a pull request",
                   details=[d, *files[:12]], fix=AUTO, instructions=[f"node framework/cli/rebake.mjs apply {d}"], order=65)
        row["autoFix"] = True
        return row
    if state == "edited":
        return item(cid, "data", f"{app}: needs a re-bake (edited copy)", "warn",
                    "its baked framework was edited in the app, so it isn't re-baked automatically: move the edits into the framework, then re-bake",
                    details=[d, *[f"edited {f}" for f in a.get("edited", [])][:12]], instructions=[f"node framework/cli/rebake.mjs apply {d} --force   (drops the edits)"], order=65)
    return item(cid, "data", f"{app}: baked framework", "unknown", str(a.get("error") or "couldn't read it")[:200], details=[d], order=65)


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
    FIXES.clear()

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
        row_fix = fix
        if missing:
            status, summary = "warn", "needs " + ", ".join(missing) + " (install a plugin that provides it)"
            # a plugin here that provides it but is switched off: Auto fix switches it on
            off = [x["folder"] for x in mans if x["folder"] != f and not cx.plugin_enabled(x["folder"]) and not cx.PLUGINS.get(x["folder"], {}).get("error")
                   and any(f"service:{cap}" in (x.get("provides") or []) for cap in missing)]
            if off:
                summary = f"needs {', '.join(missing)}: {', '.join(off)} provides it but is switched off"
                FIXES[cid], row_fix = _enable(off), AUTO
        if data_dir:
            p = cx.ROOT / data_dir
            if p.is_dir():
                mode = stat.S_IMODE(p.stat().st_mode)
                details.append(f"data {data_dir} ({oct(mode)})")
                # traverse-only for others (0711) is still private: nothing in it can be listed or read (the Activity
                # banner's drop folders for other machine users' Claude Code hooks need it)
                if mode & 0o066 and status == "ok":
                    status, summary = "warn", f"data folder {data_dir} is readable by other users ({oct(mode)}); Auto fix makes it owner-only"
                    FIXES[cid], row_fix = (lambda q=p: _lock_down(q)), AUTO
        row = item(cid, "plugins", f"{name} plugin", status, summary, details=details, fix=row_fix, order=71)
        row["autoFix"] = cid in FIXES
        res.append(row)
        if m.get("hasHooks"):
            try:
                r = _node(["framework/cli/plugin-lifecycle.mjs", "checks", f, "--json"], timeout=20) or {}
                for c in r.get("checks", []):
                    if c["id"] == "data-folder" and not c["ok"]:  # never installed: its data folder appears on first use
                        FIXES[f"{cid}:{c['id']}"] = _install(f)
                        res.append({**item(f"{cid}:{c['id']}", "plugins", f"{name}: install script", "info", "not run yet: Auto fix runs it",
                                           fix=AUTO, order=72), "autoFix": True})
                        continue
                    sub = item(f"{cid}:{c['id']}", "plugins", f"{name}: {c['id'].replace('-', ' ')}", "ok" if c["ok"] else "warn",
                               c.get("detail") or ("ok" if c["ok"] else "failed"), fix=AUTO if f"{cid}:{c['id']}" in FIXES else fix, order=72)
                    sub["autoFix"] = f"{cid}:{c['id']}" in FIXES
                    res.append(sub)
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

    # apps whose baked framework copy (src/axf, from `axf init`) is behind the framework: one row each
    try:
        for a in _node(["framework/cli/rebake.mjs", "status", "--json"], timeout=30) or []:
            out.append(_rebake_row(item, a))
    except Exception as e:  # noqa: BLE001
        out.append(item("rebake:all", "data", "Baked framework in apps", "unknown", f"couldn't compare: {str(e)[:160]}", order=65))

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

    # items other plugins contribute (axf.syscheck.items@1:<name>: items() → [{id, title, status, summary, details?, autoFix?}],
    # fix(id) → what it did); Auto fix runs the plugin's own fix
    for svc_info in plugin_services.available():
        name = svc_info["name"]
        svc = plugin_services.get(name) if name.startswith("axf.syscheck.items@1:") else None
        if svc is None:
            continue
        try:
            for it in (svc.items() or [])[:50]:
                if not isinstance(it, dict) or not isinstance(it.get("id"), str):
                    continue
                cid = f"plugin:{svc_info['folder']}:{it['id'][:120]}"
                st = it.get("status") if it.get("status") in ("ok", "info", "warn", "error", "unknown") else "unknown"
                if it.get("autoFix"):
                    FIXES[cid] = (lambda s=svc, i=it["id"]: str(s.fix(i)))
                row = item(cid, "plugins", str(it.get("title") or it["id"])[:120], st, str(it.get("summary") or "")[:400],
                           details=[str(d)[:600] for d in (it.get("details") or [])][:8], fix=AUTO if cid in FIXES else None, order=73)
                row["autoFix"] = cid in FIXES
                out.append(row)
        except Exception as e:  # noqa: BLE001
            out.append(item(f"plugin:{svc_info['folder']}:items", "plugins", f"{svc_info['folder']}: checks", "unknown", f"couldn't read them: {str(e)[:160]}", order=73))
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
