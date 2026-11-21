"""Plan Studio 2.0 (server part). Mounted at /api/plugins/plan-studio-2/ (console token on every route, 404 while off,
never on the console MCP directly: plugin-commands@1 exposes every route below as an MCP tool, a REST command and an
`axf plan-studio-2 <command>` CLI call). Every read and write goes through the plugin's CLI (tree.mjs api), so the console
page, the CLI, claude.ai sessions and AmberX share one set of rules (web/tree-core.mjs).

  GET    state            the whole tree + trash + progress + the allowed values
  GET    tree             nested rows (id = one branch)
  GET    item/{id}        one item (id or words) with path, children, ancestors
  GET    find             q, kind, under, limit → hits (each with the focus that opens it)
  GET    export           format=md|json, id = one branch
  POST   add | rename | edit | move | nudge | indent | outdent | duplicate | undo | link | unlink | collapse | import | build | say
  POST   emergency        send an item as an EMERGENCY build: Brett's own signed-in console only (403 for the console
                          token, MCP, voice and sessions)
  DELETE item/{id}        to the trash (undo brings it back)
  DELETE all              everything gone, the trash too (confirm)

Capability plan-tree@1: other plugins' server parts read and add items through plugin_services.get("plan-tree@1").
Capability plans@1 (list / get / park): the tree's `plan` items as plans, for plugins that only need "the plans"
(the orchestrator's priority rows, "put it in a plan for later"); control@1 planner.plans uses plans.mjs directly.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import plugin_services

router = APIRouter()
FOLDER = "plan-studio-2"
CLI = Path(__file__).resolve().parent.parent / "tree.mjs"
ROOT = CLI.parents[4]
MAX_BODY = 1024 * 1024


APPROVER_KEYS = ("AXF_APPROVER", "AXF_APPROVER_VIA")
AGENT_HEADERS = ("x-axhub-session", "x-axhub-source")


def brett_click(request: Request) -> str:
    """The signed-in hub admin's name when this request is Brett's own click in the console, else ''."""
    c = getattr(request.state, "axf_user", None)
    if c is None or getattr(c, "via", "token") != "session" or not getattr(c, "admin", False):
        return ""
    for h in AGENT_HEADERS:
        v = (request.headers.get(h) or "").strip()
        if v and v != "console":
            return ""
    return str(getattr(c, "name", "") or "")[:120]


def run(req: dict[str, Any], timeout: int = 60, approver: str = "") -> dict[str, Any]:
    env = {k: v for k, v in os.environ.items() if k not in APPROVER_KEYS}  # never inherited: only Brett's click sets them
    if approver:
        env.update(AXF_APPROVER=approver, AXF_APPROVER_VIA="console")
    try:
        proc = subprocess.run(["node", str(CLI), "api"], input=json.dumps(req), cwd=ROOT, capture_output=True, text=True, timeout=timeout, env=env)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "error": f"Plan Studio 2.0 could not run: {str(e)[:200]}"}
    lines = proc.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}


def _by(request: Request) -> str:
    user = getattr(request.state, "axf_user", None)
    return str(getattr(user, "name", "") or "console")


async def _body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise HTTPException(413, "body too large")
    try:
        body = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "the body must be JSON") from None
    if not isinstance(body, dict):
        raise HTTPException(400, "the body must be a JSON object")
    return body


def _answer(r: dict[str, Any]) -> dict[str, Any]:
    if r.get("ok") or r.get("understood") is False:
        return r
    code = str(r.get("code") or "")
    raise HTTPException(404 if code == "not_found" else 409 if code == "confirm" else 403 if code == "forbidden" else 400, str(r.get("error") or "Plan Studio 2.0 refused"))


def _write(op: str, request: Request, body: dict[str, Any]) -> dict[str, Any]:
    return _answer(run({**body, "op": op, "by": _by(request)}))


@router.get("/state")
def state() -> dict[str, Any]:
    """The whole tree: items, trash, progress and the allowed kinds, statuses, priorities, models and link types."""
    return _answer(run({"op": "state"}))


@router.get("/tree")
def tree(id: str = "") -> dict[str, Any]:
    """Nested rows; `id` (an item id or words in its title) limits it to one branch."""
    return _answer(run({"op": "tree", "id": id}))


@router.get("/item/{id}")
def item(id: str) -> dict[str, Any]:
    """One item by id or by words in its title, with its path, children and ancestors."""
    return _answer(run({"op": "get", "id": id}))


@router.get("/find")
def find(q: str = "", kind: str = "", under: str = "", limit: int = 20) -> dict[str, Any]:
    """Words → matching items, best first. Each hit's `focus` (plan-studio-2.focus:<id>) opens it in the console."""
    return _answer(run({"op": "find", "q": q, "kind": kind, "under": under, "limit": max(1, min(limit, 200))}))


@router.get("/export")
def export(format: str = "md", id: str = "") -> dict[str, Any]:
    """The tree (or one branch) as Markdown or as a plan-tree-export@1 JSON."""
    return _answer(run({"op": "export", "format": "json" if format == "json" else "md", "id": id}))


@router.post("/add")
async def add(request: Request) -> dict[str, Any]:
    """Add a plan, section, step, note, list or list item inside `parent` (empty = top level) at `index`."""
    return _write("add", request, await _body(request))


@router.post("/rename")
async def rename(request: Request) -> dict[str, Any]:
    """Rename an item: {id, title}."""
    return _write("rename", request, await _body(request))


@router.post("/edit")
async def edit(request: Request) -> dict[str, Any]:
    """Edit an item: {id, patch: {title, body, status, done, priority, tags, model, minutes, kind, collapsed}}."""
    return _write("edit", request, await _body(request))


@router.post("/move")
async def move(request: Request) -> dict[str, Any]:
    """Move an item and everything under it: {id, parent (empty = top level), index}."""
    return _write("move", request, await _body(request))


@router.post("/nudge")
async def nudge(request: Request) -> dict[str, Any]:
    """Move an item one place up (delta -1) or down (delta 1) among its siblings."""
    return _write("nudge", request, await _body(request))


@router.post("/indent")
async def indent(request: Request) -> dict[str, Any]:
    """Indent an item into the sibling above it."""
    return _write("indent", request, await _body(request))


@router.post("/outdent")
async def outdent(request: Request) -> dict[str, Any]:
    """Outdent an item to after its parent."""
    return _write("outdent", request, await _body(request))


@router.post("/duplicate")
async def duplicate(request: Request) -> dict[str, Any]:
    """Duplicate an item and everything under it, right after it."""
    return _write("duplicate", request, await _body(request))


@router.delete("/item/{id}")
async def delete_item(id: str, request: Request) -> dict[str, Any]:
    """Delete an item to the trash (with everything under it); undo brings it back where it was."""
    return _write("delete", request, {"id": id})


@router.post("/undo")
async def undo(request: Request) -> dict[str, Any]:
    """Undo the newest delete, or one by {trashId}."""
    return _write("undo", request, await _body(request))


@router.post("/link")
async def link(request: Request) -> dict[str, Any]:
    """Link an item to a to-do, build, note, Shipped feature, another plan item or a URL: {id, type, ref, label}."""
    return _write("link", request, await _body(request))


@router.post("/unlink")
async def unlink(request: Request) -> dict[str, Any]:
    """Remove a link: {id, type, ref}."""
    return _write("unlink", request, await _body(request))


@router.post("/collapse")
async def collapse(request: Request) -> dict[str, Any]:
    """Collapse or expand one item ({id}) or everything ({all: true}); {collapsed: false} expands."""
    return _write("collapse", request, await _body(request))


@router.post("/import")
async def import_items(request: Request) -> dict[str, Any]:
    """Import a plan-tree-export@1 (or a list of items) under {parent}; every id is made new."""
    return _write("import", request, await _body(request))


@router.post("/build")
async def build(request: Request) -> dict[str, Any]:
    """Send an item to the build orchestrator: {id, profile, buildId, preview, said}. Its open steps become the build's."""
    body = await _body(request)
    body.pop("emergency", None)  # an emergency build goes through POST /emergency (Brett's signed-in console only)
    return _write("build", request, body)


@router.post("/emergency")
async def emergency(request: Request) -> dict[str, Any]:
    """Send an item as an EMERGENCY build: {id, profile, buildId, said}. Brett only, from his own signed-in console
    session (403 for the console token, MCP, voice and sessions). Like Send to the orchestrator, and the build is tagged
    emergency: it skips the line, builds in the 2 emergency slots and lands first."""
    who = brett_click(request)
    if not who:
        raise HTTPException(403, "Only Brett sends a build to emergency, from his own signed-in console. The console token, MCP, voice and sessions cannot.")
    body = await _body(request)
    body.pop("preview", None)
    return _answer(run({**body, "op": "build", "emergency": True, "by": who}, approver=who))


@router.post("/say")
async def say(request: Request) -> dict[str, Any]:
    """One spoken plan command ({text}) → the change it means, with what to say back (AmberX voice, the page's mic)."""
    return _write("say", request, await _body(request))


@router.delete("/all")
async def clear_all(request: Request) -> dict[str, Any]:
    """Everything gone, the trash too: the store starts empty again."""
    return _write("clear", request, {"confirm": True})


class PlanTreeService:
    """plan-tree@1: other plugins' server parts read and add items without naming this folder."""

    contract = "plan-tree@1"

    def state(self) -> dict[str, Any]:
        return run({"op": "state"})

    def find(self, q: str, kind: str = "", limit: int = 20) -> list[dict[str, Any]]:
        return run({"op": "find", "q": q, "kind": kind, "limit": limit}).get("hits", [])

    def add(self, kind: str, title: str, parent: str = "", body: str = "", by: str = "") -> dict[str, Any]:
        return run({"op": "add", "kind": kind, "title": title, "parent": parent or None, "body": body, "by": by})

    def link(self, item: str, type: str, ref: str, label: str = "") -> dict[str, Any]:
        return run({"op": "link", "id": item, "type": type, "ref": ref, "label": label})

    def say(self, text: str, by: str = "") -> dict[str, Any]:
        return run({"op": "say", "text": text, "by": by})


plugin_services.provide("plan-tree@1", PlanTreeService(), FOLDER)


def _as_plan(item: dict[str, Any]) -> dict[str, Any]:
    build = next((link for link in item.get("links") or [] if link.get("type") == "build"), None)
    out = {k: item.get(k) for k in ("id", "title", "status", "priority", "tags", "body", "updatedAt")}
    if build:
        out["build"] = {"id": str(build.get("ref") or "").split(":", 1)[-1]}
    return out


class PlansService:
    """plans@1: the tree's plans (items of kind `plan`), without naming this folder."""

    contract = "plans@1"

    def list(self) -> list[dict[str, Any]]:
        return [_as_plan(i) for i in run({"op": "state"}).get("items", []) if i.get("kind") == "plan"]

    def get(self, plan_id: str) -> dict[str, Any] | None:
        return next((p for p in self.list() if p["id"] == plan_id), None)

    def park(self, title: str, summary: str = "", category: str = "", by: str = "") -> dict[str, Any]:
        """"Put it in a plan for later": a parked top-level plan (or inside the item `category` names), never a build."""
        return run({"op": "add", "kind": "plan", "title": title, "body": summary, "status": "parked", "parent": category or None, "by": by})


plugin_services.provide("plans@1", PlansService(), FOLDER)
