"""Plugin inventory engine, Python port (plugin-inventory@1).

Mirrors ``framework/core/engines/plugins.ts`` (reference) and the Kotlin ``PluginInventoryEngine`` exactly; all three replay
``framework/spec/fixtures/plugin-inventory.json`` (``test.py`` does it here). Pure functions over plain dicts in the same
shape as the TypeScript types, so the console server resolves dependencies the same way the web and Android ports do.
"""
from __future__ import annotations

from typing import Any

FRAME = "plugin-inventory@1"
HEALTHS = ["ok", "partial", "off", "blocked", "error"]
HEALTH_RANK = {"error": 0, "blocked": 1, "partial": 2, "off": 3, "ok": 4}
DEPENDENCY_LABEL = {
    "ok": "satisfied", "missing": "missing", "disabled": "provider off", "optional-missing": "not installed", "set": "set", "unset": "not set",
    "granted": "granted", "declared": "declared", "unsupported": "unsupported", "error": "error", "not loaded": "not loaded",
}
BLOCKING = ("missing", "disabled", "unsupported")
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
OPTIONAL_DETAIL = "Optional: the plugin works without it; the features that use it stay hidden or greyed out."


def service_of(entry: str) -> str | None:
    return entry[8:] if isinstance(entry, str) and entry.startswith("service:") else None


def plugin_of(entry: str) -> str | None:
    return entry[7:] if isinstance(entry, str) and entry.startswith("plugin:") else None


def record(**r: Any) -> dict[str, Any]:
    """A record with every field filled (web: ``pluginRecord``)."""
    out: dict[str, Any] = {
        "folder": "", "id": "", "name": "", "version": "", "apiLevel": None, "targets": [], "provides": [], "requires": [], "optional": [],
        "uiEditor": [], "scopes": [], "enabled": True, "error": None, "serverPart": False, "server": "none", "env": [], "dataDir": None,
        "dataDirProblem": None, "services": [],
    }
    out.update(r)
    return out


def resolve_providers(records: list[dict[str, Any]], live: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    by: dict[str, list[dict[str, Any]]] = {}
    for r in records:
        for p in r["provides"]:
            svc = service_of(p)
            if svc:
                by.setdefault(svc, []).append({"folder": r["folder"], "name": r["name"], "enabled": r["enabled"], "live": svc in r["services"]})
    for s in live:
        name, folder = s.get("name"), s.get("folder")
        if not name or not folder:
            continue
        lst = by.setdefault(name, [])
        if any(p["folder"] == folder for p in lst):
            continue
        r = next((x for x in records if x["folder"] == folder), None)
        lst.append({"folder": folder, "name": r["name"] if r else folder, "enabled": bool(s.get("enabled")), "live": True})
    return by


def _enable_it(required: bool) -> str:
    return " or this plugin can't work." if required else " to turn this feature on."


def dependencies_of(r: dict[str, Any], providers: dict[str, list[dict[str, Any]]], records: list[dict[str, Any]], ctx: dict[str, Any]) -> list[dict[str, Any]]:
    deps: list[dict[str, Any]] = []
    levels = sorted(ctx["apiLevels"])
    level = r["apiLevel"]
    deps.append({"kind": "framework", "name": f"plugin@1 API level {level if level is not None else '?'}", "required": True,
                 "status": "ok" if level is not None and level in levels else "unsupported",
                 "detail": "The host runs plugin@1 API level " + ", ".join(str(x) for x in levels) + "."})
    target = ctx.get("target")
    if target and r["targets"] and target not in r["targets"] and "*" not in r["targets"]:
        deps.append({"kind": "framework", "name": f"target {target}", "required": True, "status": "unsupported",
                     "detail": f'plugin.json "targets" must include "{target}" for this host to load it.'})
    seen: set[str] = set()
    for required, entries in ((True, r["requires"]), (False, r["optional"])):
        for entry in entries:
            svc, pid = service_of(entry), plugin_of(entry)
            if pid:
                if f"plugin:{pid}" in seen:
                    continue
                seen.add(f"plugin:{pid}")
                other = next((x for x in records if x["id"] == pid and x["folder"] != r["folder"]), None)
                if other is None:
                    status = "missing" if required else "optional-missing"
                    detail = "Not installed, so this plugin can't do its job until it is." if required else OPTIONAL_DETAIL
                elif other["enabled"]:
                    status, detail = "ok", f"Installed: {other['name']}."
                else:
                    status, detail = "disabled", f"{other['name']} is installed but switched off. Enable it" + _enable_it(required)
                deps.append({"kind": "plugin", "name": pid, "required": required, "status": status, "detail": detail,
                             "providers": [{"folder": other["folder"], "name": other["name"], "enabled": other["enabled"], "live": other["enabled"]}] if other else []})
                continue
            if not svc:
                deps.append({"kind": "other", "name": entry, "required": required, "status": "declared", "detail": "Declared in the manifest; the host doesn't check this kind of dependency yet."})
                continue
            if svc in seen:
                continue
            seen.add(svc)
            provs = [p for p in providers.get(svc, []) if p["folder"] != r["folder"]]
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
                detail = f"Provided by {who}, which is switched off. Enable it" + _enable_it(required)
            elif required:
                detail = "No installed plugin provides it, so this plugin can't do its job until one is installed."
            else:
                detail = OPTIONAL_DETAIL
            deps.append({"kind": "service", "name": svc, "required": required, "status": status, "providers": provs, "detail": detail})
    for e in r["env"]:
        deps.append({"kind": "env", "name": e["name"], "required": False, "status": "set" if e["set"] else "unset",
                     "detail": f"{r['name']} reads {e['name']} from the host's environment (Settings → Connections or the systems check can set it)."})
    for s in r["scopes"]:
        deps.append({"kind": "scope", "name": s, "required": True, "status": "granted", "detail": SCOPE_NOTES.get(s.upper(), "Declared scope.")})
    if r["serverPart"]:
        deps.append({"kind": "core", "name": "console API", "required": True,
                     "status": "ok" if r["server"] == "loaded" else ("error" if r["server"] == "error" else "not loaded"),
                     "detail": f"Its server part runs inside the console API and is mounted at /api/plugins/{r['folder']}/."})
    return deps


def dependents_of(r: dict[str, Any], records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    mine = {s for s in (service_of(p) for p in r["provides"]) if s} | set(r["services"])
    out: list[dict[str, Any]] = []
    for other in records:
        if other["folder"] == r["folder"]:
            continue
        for required, entries in ((True, other["requires"]), (False, other["optional"])):
            for e in entries:
                svc = service_of(e)
                service = svc if svc and svc in mine else (e if plugin_of(e) == r["id"] else None)
                if service and not any(d["folder"] == other["folder"] and d["service"] == service for d in out):
                    out.append({"folder": other["folder"], "name": other["name"], "service": service, "required": required, "enabled": other["enabled"]})
    return out


def health_of(r: dict[str, Any], deps: list[dict[str, Any]]) -> str:
    if r["error"] or r["server"] == "error":
        return "error"
    if any(d["required"] and d["status"] in BLOCKING for d in deps):
        return "blocked"
    if not r["enabled"]:
        return "off"
    if any(d["status"] in ("optional-missing", "unset") for d in deps) or r["dataDirProblem"]:
        return "partial"
    return "ok"


def conflicts_of(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    def add(kind: str, key: str, folders: list[str], detail: str, severity: str = "warn") -> None:
        out.append({"id": f"{kind}:{key}", "kind": kind, "key": key, "folders": sorted(set(folders)), "detail": detail, "severity": severity})

    by_id: dict[str, list[str]] = {}
    for r in records:
        by_id.setdefault(r["id"], []).append(r["folder"])
    for pid, fs in by_id.items():
        if len(fs) > 1:
            add("plugin-id", pid, fs, "Two plugins declare the same id; the host can't tell them apart.", "error")
    contrib: dict[str, list[str]] = {}
    for r in records:
        for p in r["provides"]:
            contrib.setdefault(p, []).append(r["folder"])
    for key, fs in contrib.items():
        if len(set(fs)) < 2:
            continue
        svc = service_of(key)
        if svc:
            add("service", svc, fs, "More than one plugin provides this capability; the last one loaded wins (the host keeps one provider).")
        else:
            add("contribution", key, fs, "Two plugins contribute the same id; the last one installed replaces the other's.")
    data: dict[str, list[str]] = {}
    for r in records:
        if r["dataDir"]:
            data.setdefault(r["dataDir"], []).append(r["folder"])
    for d, fs in data.items():
        if len(fs) > 1:
            add("data-dir", d, fs, "Two plugins share a data folder; uninstalling one would delete the other's data.", "error")
    editors: dict[str, list[str]] = {}
    for r in records:
        if r["enabled"]:
            for kind in r["uiEditor"]:
                editors.setdefault(kind, []).append(r["folder"])
    for kind, fs in editors.items():
        if len(fs) > 1:
            add("ui-editor", kind, fs, "More than one enabled plugin edits these values. Allowed: the last save wins, and each editor reloads current values when it opens or regains focus.", "info")
    return out


def counts_of(items: list[dict[str, Any]], conflicts: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "total": len(items),
        "enabled": sum(1 for i in items if i["enabled"]),
        "errors": sum(1 for i in items if i["error"]),
        "missingDeps": sum(1 for i in items if any(d["required"] and d["status"] in ("missing", "disabled") for d in i["dependencies"])),
        "conflicts": len(conflicts),
        "editors": sum(1 for i in items if i["uiEditor"]),
    }


def build(records: list[dict[str, Any]], ctx: dict[str, Any]) -> dict[str, Any]:
    providers = resolve_providers(records, ctx.get("live", []))
    conflicts = conflicts_of(records)
    items: list[dict[str, Any]] = []
    for r in records:
        deps = dependencies_of(r, providers, records, ctx)
        items.append({**r, "dependencies": deps, "dependents": dependents_of(r, records), "health": health_of(r, deps),
                      "conflicts": [c["id"] for c in conflicts if r["folder"] in c["folders"]]})
    return {"items": items, "conflicts": conflicts, "counts": counts_of(items, conflicts)}


def graph(items: list[dict[str, Any]], live: list[dict[str, Any]]) -> dict[str, Any]:
    svc: dict[str, dict[str, int]] = {}
    edges: list[dict[str, Any]] = []
    for r in items:
        for p in r["provides"]:
            n = service_of(p)
            if n:
                svc.setdefault(n, {"providers": 0, "consumers": 0})["providers"] += 1
                edges.append({"from": f"p:{r['folder']}", "to": f"s:{n}", "kind": "provides", "broken": not r["enabled"]})
        for d in r["dependencies"]:
            if d["kind"] == "service":
                svc.setdefault(d["name"], {"providers": 0, "consumers": 0})["consumers"] += 1
                edges.append({"from": f"p:{r['folder']}", "to": f"s:{d['name']}", "kind": "requires" if d["required"] else "optional", "broken": d["status"] != "ok"})
    providers = [r for r in items if any(service_of(p) for p in r["provides"])]
    consumers = [r for r in items if r not in providers and any(d["kind"] == "service" for d in r["dependencies"])]
    alone = [r for r in items if r not in providers and r not in consumers]
    services = sorted(svc)
    nodes: list[dict[str, Any]] = []
    for i, r in enumerate(consumers + alone):
        nodes.append({"id": f"p:{r['folder']}", "kind": "plugin", "label": r["name"], "column": 0, "row": i * 2 + (1 if i >= len(consumers) and consumers else 0), "folder": r["folder"], "providers": 0})
    for i, s in enumerate(services):
        nodes.append({"id": f"s:{s}", "kind": "service", "label": s, "column": 1, "row": i * 2, "missing": svc[s]["providers"] == 0 and not any(x.get("name") == s for x in live), "providers": svc[s]["providers"]})
    for i, r in enumerate(providers):
        nodes.append({"id": f"p:{r['folder']}", "kind": "plugin", "label": r["name"], "column": 2, "row": i * 2, "folder": r["folder"], "providers": 0})
    rows = max(len(consumers + alone) * 2 + (1 if alone and consumers else 0), len(services) * 2, len(providers) * 2, 2)
    return {"nodes": nodes, "edges": edges, "rows": rows}
