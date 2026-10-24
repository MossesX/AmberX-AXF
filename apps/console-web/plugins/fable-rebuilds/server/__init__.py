"""Fable rebuilds (server part). Mounted at /api/plugins/fable-rebuilds/ (console token on every route, 404 when off).

One place for every build parked for Fable on the pending list (framework/plan/pending.json, pending@1):
what it replaces (the Opus console plugin it rebuilds, found from plugin.json `builtWith.replacedBy`, the pending
id = plugin folder, or a note naming the plugin), its rebuild branch (`fable/<id>`), its differences report
(`_claude/memory/docs/rebuilds/<id>.md`), Android before/after screenshots (`<id>/android.md`) and its line in
`rebuilds/LOG.md`, plus a ready-to-paste brief for the Fable session. Changes go through the engine (pending-act);
nothing here names another plugin by import.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

import console_context as cx

router = APIRouter()
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
RULES = ("Rules for this rebuild (AmberX-AXF _claude/rules/RULES.md): start by running the Opus version's uninstall script "
         "(uninstall.mjs --all) when it replaces a plugin; work on branch fable/{id} and push it before merging (Android "
         "before/after screenshots run by themselves on that branch); end with the differences report "
         "_claude/memory/docs/rebuilds/{id}.md and a line in rebuilds/LOG.md, then show Brett the differences; mark it "
         "complete with pending_change(action=\"status\", id=\"{id}\", status=\"complete\").")


def engine(op: str, **args: Any) -> dict[str, Any]:
    r = subprocess.run(["node", str(cx.ROOT / "framework" / "cli" / "engine-rpc.mjs"), op, json.dumps(args)], cwd=str(cx.ROOT), capture_output=True, text=True, timeout=120)
    lines = r.stdout.strip().splitlines()
    try:
        out = json.loads(lines[-1]) if lines else {"ok": False, "error": r.stderr.strip()[-400:] or "no output"}
    except ValueError:
        out = {"ok": False, "error": (r.stderr or r.stdout).strip()[-400:]}
    for line in out.get("log", []):
        cx.log("plan", str(line).strip())
    if not out.get("ok"):
        raise HTTPException(400, str(out.get("error") or f"{op} failed")[:300])
    return out


def _rebuilds_dir() -> Path:
    return cx.ROOT / "_claude" / "memory" / "docs" / "rebuilds"


def _plugins() -> list[dict[str, Any]]:
    out = []
    for f in sorted((cx.ROOT / "apps" / "console-web" / "plugins").glob("*/plugin.json")):
        folder = f.parent.name
        if folder.startswith(("_", ".")):
            continue
        try:
            m = json.loads(f.read_text())
        except (OSError, ValueError):
            continue
        out.append({"folder": folder, "id": m.get("id", ""), "name": m.get("name", folder), "replacedBy": str((m.get("builtWith") or {}).get("replacedBy") or ""),
                    "model": str((m.get("builtWith") or {}).get("model") or "")})
    return out


def _replaces(item: dict[str, Any], plugins: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The Opus console plugin this Fable build replaces, if any."""
    iid = item["id"]
    notes = " ".join(str(n.get("text", "")) for n in item.get("notes") or [] if isinstance(n, dict))
    for p in plugins:
        names = {p["folder"], p["folder"] + "-plugin", p["folder"] + "-fable"}
        if iid in names or re.search(rf"\b{re.escape(iid)}\b", p["replacedBy"]) or re.search(rf"`{re.escape(p['folder'])}`|\b{re.escape(p['folder'])} plugin\b", notes):
            return {"folder": p["folder"], "name": p["name"], "model": p.get("model", ""), "uninstall": f"node apps/console-web/plugins/{p['folder']}/uninstall.mjs --all"}
    return None


def _log_lines() -> list[str]:
    try:
        return [ln for ln in (_rebuilds_dir() / "LOG.md").read_text().splitlines() if ln.startswith("|") and not ln.startswith("|---") and not ln.startswith("| Date")]
    except OSError:
        return []


def _view(item: dict[str, Any], plugins: list[dict[str, Any]], log: list[str]) -> dict[str, Any]:
    iid = item["id"]
    d = _rebuilds_dir()
    rep = _replaces(item, plugins)
    brief = "\n".join(x for x in [
        f"Fable rebuild: {item['title']} ({iid})",
        f"Plan epic: {item['planId']}" if item.get("planId") else "",
        "", item.get("detail") or "",
        ("\nReplaces the Opus console plugin " + rep["name"] + f" (apps/console-web/plugins/{rep['folder']}). Remove it first: {rep['uninstall']}") if rep else "",
        ("\nNotes:\n" + "\n".join(f"- {n.get('text', '')}" for n in item.get("notes") or [])) if item.get("notes") else "",
        ("\nSub prompts:\n" + "\n".join(f"- {s.get('text', '')}" for s in item.get("subPrompts") or [])) if item.get("subPrompts") else "",
        "", RULES.format(id=iid),
    ] if x is not None).strip()
    return {**{k: item.get(k) for k in ("id", "title", "detail", "status", "model", "planId", "notes", "subPrompts", "createdAt", "builtAt", "source")},
            "replaces": rep, "branch": f"fable/{iid}", "report": (d / f"{iid}.md").is_file(), "android": (d / iid / "android.md").is_file(),
            "log": [ln for ln in log if f"| {iid} " in ln or f"|{iid}|" in ln or f" {iid} |" in ln][:5], "brief": brief}


@router.get("/items")
def items() -> dict[str, Any]:
    st = engine("pending")
    plugins, log = _plugins(), _log_lines()
    fable = [i for i in st.get("items", []) if i.get("model") == "Fable"]
    views = [_view(i, plugins, log) for i in fable]
    counts: dict[str, int] = {}
    for v in views:
        counts[v["status"]] = counts.get(v["status"], 0) + 1
    return {"$axf": "fable-rebuilds@1", "items": views, "counts": counts, "log": log[:20],
            "byPlugin": {v["replaces"]["folder"]: v["id"] for v in views if v["replaces"]},
            "byPlan": {v["planId"]: v["id"] for v in views if v.get("planId")}}


@router.get("/report/{iid}")
def report(iid: str) -> dict[str, Any]:
    """The differences report for a rebuild (markdown), or 404 before it's written."""
    if not ID_RE.match(iid):
        raise HTTPException(404, "no such rebuild")
    f = _rebuilds_dir() / f"{iid}.md"
    if f.is_symlink() or not f.is_file() or f.stat().st_size > 400_000:
        raise HTTPException(404, "no report yet")
    a = _rebuilds_dir() / iid / "android.md"
    return {"id": iid, "markdown": f.read_text(errors="replace"), "android": a.read_text(errors="replace")[:200_000] if a.is_file() and not a.is_symlink() else ""}


@router.post("/park")
def park(body: dict[str, Any]) -> dict[str, Any]:
    """Park a Fable rebuild from a hook: of a console plugin ({plugin: folder}) or a plan feature ({planId, title})."""
    plugin, plan_id = str(body.get("plugin") or ""), str(body.get("planId") or "")
    note = str(body.get("note") or "")[:2000]
    if plugin:
        p = next((x for x in _plugins() if x["folder"] == plugin), None)
        if not p:
            raise HTTPException(404, "no such console plugin")
        change = {"action": "add", "id": f"{plugin}-fable"[:64], "title": f"{p['name']} plugin: Fable rebuild", "model": "Fable", "source": "fable-rebuilds",
                  "detail": f"Rebuild the console plugin {p['name']} (apps/console-web/plugins/{plugin}) on Fable. Start by removing the Opus version: "
                            f"node apps/console-web/plugins/{plugin}/uninstall.mjs --all." + (f"\n\n{note}" if note else "")}
    elif plan_id:
        if not re.match(r"^[a-z0-9][a-z0-9._-]{0,80}$", plan_id):
            raise HTTPException(400, "bad plan id")
        title = str(body.get("title") or plan_id).strip()[:120]
        change = {"action": "add", "title": f"{title}: Fable rebuild", "model": "Fable", "planId": plan_id, "source": "fable-rebuilds",
                  "detail": f"Rebuild plan feature {plan_id} ({title}) on Fable." + (f"\n\n{note}" if note else "")}
    else:
        raise HTTPException(400, "say which plugin or plan feature")
    r = engine("pending-act", change=change)
    return {"ok": True, "item": r.get("item")}
