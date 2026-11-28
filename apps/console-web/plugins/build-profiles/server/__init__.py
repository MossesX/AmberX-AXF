"""Server part of the Build profiles plugin. Mounted at /api/plugins/build-profiles/.

The console adds the console-token check (every method) and the 404 while disabled. Every read and change goes through
the framework's profiles CLI (framework/cli/profiles.mjs, build-profiles@1): this router only names the commands, checks
the shape of what comes in and hands it over, so the page, the CLI, REST, MCP and voice share one set of rules.

Each route is one command (plugin.json `commands`, plugin-commands@1 → REST /api/control/build-profiles/<command>, MCP
build_profiles_<command>, CLI `axf build-profiles <command>`):

    read         list, get, cleanup                      GET
    change       create, update, select, duplicate, merge, move-builds, archive, remove, restore, cleanup-fix
    data delete  purge                                   owner only, confirm = the profile id

`remove` takes a profile off the list and keeps its data (restore brings it back), so it is a change, not a delete;
its route is /unlist (and restore's /relist) because the commands engine reads delete words in a path as destructive.

What a command takes (the names in plugin.json), and what the CLI gets for it: `state` and `cleanup` for reads,
`act {action, ...fields}` for changes. `engine_change` turns the first into the second:

    command      takes                                             the CLI gets
    select       id
    create       name, id?, description?, copyFrom?, catalog?, select?, colour?, icon?      colour → color
    update       id, name?, description?, catalog?, colour?, icon?                          colour → color
    duplicate    id, name?, newId?, description?, select?
    merge        from, into, removeSource?                         keep = not removeSource (the source stays unless asked)
    move-builds  builds[], to, from?                               builds → ids
    archive      id                (unarchive: the same route with archived = false)
    remove       id, confirm       (confirm defaults to the id here: the caller's policy gate already asked)
    restore      id
    purge        id, confirm       (never defaulted)               owner = true (checked here), confirm = "delete <id>"
    cleanup      profile?          GET: scan only                  `cleanup [--profile <id>]`
    cleanup-fix  profile?, builds[]?                               act cleanup-fix: builds → ids
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import console_context as cx

router = APIRouter()
MAX_BODY = 64 * 1024
PROFILE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
BUILD = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
MAX_BUILDS = 500

# action → the fields it may carry (anything else in the body is dropped, so a typo never reaches the registry)
FIELDS: dict[str, tuple[str, ...]] = {
    "select": ("id",),
    "create": ("name", "id", "description", "copyFrom", "catalog", "select", "colour", "icon"),
    "update": ("id", "name", "description", "catalog", "colour", "icon"),
    "duplicate": ("id", "name", "newId", "description", "select"),
    "merge": ("from", "into", "removeSource"),
    "move-builds": ("builds", "to", "from"),
    "archive": ("id",),
    "unarchive": ("id",),
    "remove": ("id", "confirm"),
    "restore": ("id",),
    "purge": ("id", "confirm"),
    "cleanup": ("fix", "profile", "builds"),
}
ID_FIELDS = ("id", "newId", "copyFrom", "from", "into", "to", "profile")
REQUIRED: dict[str, tuple[str, ...]] = {
    "select": ("id",), "create": ("name",), "update": ("id",), "duplicate": ("id",), "merge": ("from", "into"),
    "move-builds": ("builds", "to"), "archive": ("id",), "unarchive": ("id",), "remove": ("id",), "restore": ("id",),
    "purge": ("id", "confirm"),
}


def _cli(*args: str, actor: str = "build-profiles") -> dict[str, Any]:
    cli = cx.ROOT / "framework" / "cli" / "profiles.mjs"
    try:
        proc = subprocess.run(["node", str(cli), *args, "--json"], cwd=cx.ROOT, capture_output=True, text=True, timeout=120,
                              env={**os.environ, "AXF_ACTOR": actor})
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "error": f"profiles CLI: {type(e).__name__}"}
    out = proc.stdout.strip().splitlines()
    try:
        res = json.loads(out[-1]) if out else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        res = {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}
    return res if isinstance(res, dict) else {"ok": False, "error": "unexpected output"}


async def _body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise HTTPException(413, "change too large")
    try:
        data = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "not JSON")
    if not isinstance(data, dict):
        raise HTTPException(400, "an object is needed")
    return data


def _actor(request: Request) -> str:
    u = getattr(request.state, "axf_user", None)
    name = "".join(ch for ch in str(getattr(u, "name", "") or "") if ch.isalnum() or ch in "-_.")[:48]
    return f"build-profiles:{name}" if name else "build-profiles"


def _is_owner(request: Request) -> bool:
    """The console token or a hub admin. A signed-in user an admin granted this plugin to is not the owner."""
    u = getattr(request.state, "axf_user", None)
    return u is None or getattr(u, "admin", True) is not False


def change(action: str, data: dict[str, Any]) -> dict[str, Any]:
    """The checked change the CLI gets for `action`: known fields only, ids and build lists well-formed."""
    if action not in FIELDS:
        raise HTTPException(400, "unknown action")
    out: dict[str, Any] = {"action": action}
    for k in FIELDS[action]:
        v = data.get(k)
        if v is None:
            continue
        if k in ID_FIELDS:
            if not isinstance(v, str) or not PROFILE.match(v):
                raise HTTPException(400, f"{k}: a profile id (lowercase letters, digits and dashes, up to 40)")
        elif k == "builds":
            if not isinstance(v, list) or len(v) > MAX_BUILDS or not all(isinstance(b, str) and BUILD.match(b) for b in v):
                raise HTTPException(400, f"builds: a list of build ids (up to {MAX_BUILDS})")
        elif k in ("catalog", "select", "removeSource", "fix"):
            if not isinstance(v, bool):
                raise HTTPException(400, f"{k}: true or false")
        elif not isinstance(v, str) or len(v) > 600:
            raise HTTPException(400, f"{k}: text, up to 600 characters")
        out[k] = v
    for k in REQUIRED.get(action, ()):
        if out.get(k) in (None, "", []):
            raise HTTPException(400, f"{action} needs {k}")
    if action == "merge" and out["from"] == out["into"]:
        raise HTTPException(400, "merge needs two different profiles")
    return out


def engine_change(c: dict[str, Any], owner: bool = False) -> dict[str, Any]:
    """A checked change in the names framework/cli/profiles.mjs `act` reads (see the table in the module docstring)."""
    out = {k: v for k, v in c.items() if k != "fix"}
    action = out["action"]
    if "colour" in out:
        out["color"] = out.pop("colour")
    if action == "merge":
        out["keep"] = out.pop("removeSource", False) is not True
    elif action == "move-builds":
        out["ids"] = out.pop("builds")
    elif action == "cleanup":
        out["action"] = "cleanup-fix"
        if "builds" in out:
            out["ids"] = out.pop("builds")
    elif action == "purge":
        # the route has already matched confirm to the id and checked the caller; the CLI asks for both in its own words
        out["owner"] = owner
        out["confirm"] = f"delete {out['id']}"
    return out


def _act(request: Request, action: str, data: dict[str, Any], owner: bool = False) -> dict[str, Any]:
    res = _cli("act", json.dumps(engine_change(change(action, data), owner)), actor=_actor(request))
    for line in res.get("log") or []:
        cx.log("profiles", str(line))
    if not res.get("ok"):
        raise HTTPException(400, str(res.get("error") or "failed"))
    return res


def _state() -> dict[str, Any]:
    res = _cli("state")
    if not res.get("ok"):
        raise HTTPException(500, str(res.get("error") or "failed"))
    return res


@router.get("/list")
def list_profiles() -> dict[str, Any]:
    """Every build profile with its counts, the saved pick (active) and the one in force (effective)."""
    return _state()


@router.get("/get")
def get_profile(id: str) -> dict[str, Any]:
    """One build profile: its details, counts and files, and whether it is the active one."""
    if not PROFILE.match(id):
        raise HTTPException(400, "id: a profile id")
    s = _state()
    # profiles off the list (removed, restorable) are looked up too when the registry reports them
    for group in ("profiles", "removed"):
        for p in s.get(group) or []:
            if isinstance(p, dict) and p.get("id") == id:
                return {"ok": True, "profile": p, "listed": group == "profiles", "active": s.get("active") == id, "effective": s.get("effective") == id}
    raise HTTPException(404, f'no build profile "{id}"')


@router.post("/create")
async def create_profile(request: Request) -> dict[str, Any]:
    """Create a build profile: empty, or a copy of another one (copyFrom)."""
    return _act(request, "create", await _body(request))


@router.post("/update")
async def update_profile(request: Request) -> dict[str, Any]:
    """Change a build profile's name, description, catalog switch, colour or icon."""
    return _act(request, "update", await _body(request))


@router.post("/select")
async def select_profile(request: Request) -> dict[str, Any]:
    """Make a build profile the active one, for every device and session."""
    return _act(request, "select", await _body(request))


@router.post("/duplicate")
async def duplicate_profile(request: Request) -> dict[str, Any]:
    """Copy a build profile and its work data into a new profile."""
    return _act(request, "duplicate", await _body(request))


@router.post("/merge")
async def merge_profiles(request: Request) -> dict[str, Any]:
    """Merge one build profile into another: its builds move to the target."""
    return _act(request, "merge", await _body(request))


@router.post("/move-builds")
async def move_builds(request: Request) -> dict[str, Any]:
    """Move builds to another build profile."""
    return _act(request, "move-builds", await _body(request))


@router.post("/archive")
async def archive_profile(request: Request) -> dict[str, Any]:
    """Archive a build profile (hidden from the pickers, nothing deleted); archived = false brings it back."""
    data = await _body(request)
    archived = data.get("archived", True)
    if not isinstance(archived, bool):
        raise HTTPException(400, "archived: true or false")
    return _act(request, "archive" if archived else "unarchive", data)


@router.post("/unlist")
async def remove_profile(request: Request) -> dict[str, Any]:
    """Take a build profile off the list. Its data stays; restore brings it back."""
    data = await _body(request)
    if data.get("confirm") is None and isinstance(data.get("id"), str):
        data["confirm"] = data["id"]
    return _act(request, "remove", data)


@router.post("/relist")
async def restore_profile(request: Request) -> dict[str, Any]:
    """Put a removed build profile back on the list with its data."""
    return _act(request, "restore", await _body(request))


@router.post("/purge")
async def purge_profile(request: Request) -> dict[str, Any]:
    """Delete a removed build profile's data for good. Owner only; confirm must be the profile id."""
    if not _is_owner(request):
        raise HTTPException(403, "owner only")
    data = await _body(request)
    if not isinstance(data.get("id"), str) or data.get("confirm") != data.get("id"):
        raise HTTPException(400, "confirm must be the profile id")
    return _act(request, "purge", data, owner=True)


@router.get("/cleanup")
def cleanup_scan(profile: str = "") -> dict[str, Any]:
    """Scan for archived builds that are really complete, and builds in a profile that no longer exists. Changes nothing."""
    if profile and not PROFILE.match(profile):
        raise HTTPException(400, "profile: a profile id")
    res = _cli("cleanup", *(("--profile", profile) if profile else ()))
    if not res.get("ok"):
        raise HTTPException(400, str(res.get("error") or "failed"))
    return res


@router.post("/cleanup")
async def cleanup_fix(request: Request) -> dict[str, Any]:
    """Fix what the cleanup scan found: archived builds that are really finished get the status they earned (complete or
    landed), builds in a profile that no longer exists move to the base profile. `builds` limits it; nothing is deleted."""
    return _act(request, "cleanup", {**(await _body(request)), "fix": True})
