"""Project wizard — server part. Mounted at /api/plugins/project-wizard/.

The console adds two checks to every route: the console token (every method, reads included) and 404 while the
plugin is disabled. Plugin routes are never exposed through the console's MCP server.

Everything runs through the plugin's Node engine (wizard.mjs --json), which builds on AmberX AXF's claude-project, so
the console and the `claude-project` terminal command make projects the same way. Tokens (GITHUB_TOKEN) stay in the
server's environment; nothing secret is returned to the browser or written to the wizard's list.
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

try:  # the console's capability registry (absent in a bare test import)
    import plugin_services  # type: ignore
except ImportError:  # pragma: no cover
    plugin_services = None  # type: ignore

router = APIRouter()

_PLUGIN = Path(__file__).resolve().parents[1]
_ROOT = _PLUGIN.parents[3]
_ENGINE = _PLUGIN / "wizard.mjs"
# One writing action at a time (runs, kit rebuilds, links, forgets: they commit, push and rewrite the wizard's list).
# The console runs one API process, so a process-wide lock is enough.
_WRITE_LOCK = threading.Lock()


@contextmanager
def _writing():
    if not _WRITE_LOCK.acquire(blocking=False):
        raise HTTPException(409, "the wizard is busy with another project right now; try again when it finishes")
    try:
        yield
    finally:
        _WRITE_LOCK.release()


def _engine(req: dict[str, Any], timeout: int = 60) -> dict[str, Any]:
    # Own process group, so a timeout also stops the git / ssh / axf children it started.
    p = subprocess.Popen(["node", str(_ENGINE), "--json", json.dumps(req)], cwd=_ROOT, stdin=subprocess.DEVNULL,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env={**os.environ}, start_new_session=True)
    try:
        out, err = p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        p.communicate()
        raise HTTPException(504, f"the wizard took longer than {timeout} s and was stopped")
    lines = out.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "error": (err or "no output").strip()[-600:]}
    except json.JSONDecodeError:
        return {"ok": False, "error": (err or out).strip()[-600:]}


def _ok(r: dict[str, Any]) -> dict[str, Any]:
    if not r.get("ok"):
        raise HTTPException(400, r.get("error", "the wizard failed"))
    return r


class Source(BaseModel):
    kind: Literal["github", "vps", "folder", "new"]
    repo: str = Field(default="", max_length=300)
    path: str = Field(default="", max_length=1000)
    template: str = Field(default="", max_length=40)
    boilerplate: str = Field(default="", max_length=60)


class Home(BaseModel):
    mode: Literal["new", "existing", "skip", "keep"] = "skip"
    owner: str = Field(default="", max_length=39)
    name: str = Field(default="", max_length=100)
    path: str = Field(default="", max_length=1000)


class Homes(BaseModel):
    github: Home = Field(default_factory=Home)
    vps: Home = Field(default_factory=Home)
    local: Home = Field(default_factory=lambda: Home(mode="keep"))


class Plan(BaseModel):
    source: Source
    display: str = Field(default="", max_length=80)
    name: str = Field(default="", max_length=63)
    description: str = Field(default="", max_length=300)
    kind: str = Field(default="app", max_length=30)
    visibility: Literal["private", "public"] = "private"
    port: Literal["bake", "rebuild", "no"] = "no"
    homes: Homes = Field(default_factory=Homes)
    sync: bool = True
    commitAll: bool = False  # a folder that isn't a git repo yet: commit everything in it (the user checked it)


class Starter(BaseModel):
    id: Literal["console-app", "template", "framework", "none"] = "console-app"
    template: str = Field(default="", max_length=40)
    boilerplate: str = Field(default="", max_length=60)


class FrameworkImport(BaseModel):
    repo: str = Field(default="", max_length=300)
    path: str = Field(default="", max_length=1000)
    boilerplate: str = Field(default="", max_length=200)


class Framework(BaseModel):
    mode: Literal["axf", "own", "import"] = "axf"
    libraries: list[str] = Field(default_factory=list, max_length=40)
    privateLibraries: list[str] = Field(default_factory=list, max_length=20)
    name: str = Field(default="", max_length=60)
    import_: FrameworkImport = Field(default_factory=FrameworkImport, alias="import")

    model_config = {"populate_by_name": True}


class Skin(BaseModel):
    id: str = Field(default="", max_length=80)
    color: str = Field(default="", max_length=80)


class Models(BaseModel):
    plan: Literal["opus", "fable"] = "fable"
    build: Literal["opus", "fable"] = "opus"
    review: Literal["opus", "fable"] = "opus"


class Claude(BaseModel):
    account: str = Field(default="", max_length=80)
    ownAccount: bool = True
    models: Models = Field(default_factory=Models)


class FirstPlan(BaseModel):
    text: str = Field(default="", max_length=8000)
    builds: list[str] = Field(default_factory=list, max_length=20)
    spoken: bool = False


class Inherit(BaseModel):
    """A step left locked follows the current project's value (the grayed-out field in the wizard)."""
    starter: bool | None = None
    framework: bool | None = None
    skin: bool | None = None
    accounts: bool | None = None


class FullPlan(Plan):
    starter: Starter | None = None
    framework: Framework | None = None
    skin: Skin | None = None
    claude: Claude | None = None
    firstPlan: FirstPlan = Field(default_factory=FirstPlan)
    inherit: Inherit = Field(default_factory=Inherit)
    switchTo: bool = True  # make it the active project when it is made


def _plan(p: FullPlan) -> dict[str, Any]:
    """The plan for the engine: unset steps stay out (they follow the current project), `import` keeps its name."""
    d = p.model_dump(by_alias=True, exclude_none=True)
    d["inherit"] = {k: v for k, v in (d.get("inherit") or {}).items() if v is not None}
    return d


class PlanReq(BaseModel):
    plan: FullPlan | None = None
    fromDraft: bool = False  # use the stored draft (built step by step through /draft)


class DraftReq(BaseModel):
    set: dict[str, Any] | None = None
    reset: bool = False


class NameReq(BaseModel):
    name: str = Field(max_length=63)


class KitReq(NameReq):
    rebuild: bool = False


class LinkReq(NameReq):
    url: str = Field(max_length=300)


@router.get("/status")
def status() -> dict[str, Any]:
    return _ok(_engine({"action": "status"}, timeout=40))


@router.post("/inspect")
def inspect(src: Source) -> dict[str, Any]:
    return _ok(_engine({"action": "inspect", "source": src.model_dump()}, timeout=40))


def _plan_req(req: PlanReq) -> dict[str, Any]:
    if req.fromDraft:
        return {"fromDraft": True}
    if req.plan is None:
        raise HTTPException(422, "give a plan, or fromDraft: true")
    return {"plan": _plan(req.plan)}


@router.post("/check")
def check(req: PlanReq) -> dict[str, Any]:
    r = _engine({"action": "check", **_plan_req(req)}, timeout=60)
    if "problems" not in r:
        raise HTTPException(400, r.get("error", "could not check the plan"))
    return r


@router.post("/run")
def run(req: PlanReq) -> dict[str, Any]:
    with _writing():
        # cloning, axf init, pushes and repo creation: give it time; failures come back with the log
        return _engine({"action": "run", **_plan_req(req)}, timeout=900)


@router.post("/create")
def create(req: PlanReq) -> dict[str, Any]:
    """Review and create in one call: the plan (or the draft), checked, made, and switched into."""
    return run(req)


def _accounts() -> list[dict[str, Any]]:
    """The Claude accounts on the VPS through axf.claude-accounts@1: names, kinds and plans only, no credentials."""
    svc = plugin_services.get("axf.claude-accounts@1") if plugin_services else None
    if svc is None:
        return []
    try:
        v = svc.view()
    except Exception:  # noqa: BLE001 - the wizard works without it
        return []
    return [{"name": a.get("name", ""), "kind": a.get("kind", ""), "plan": a.get("plan", ""), "email": a.get("email", ""), "active": bool(a.get("active"))}
            for a in v.get("accounts") or [] if a.get("name")]


@router.get("/options")
def options() -> dict[str, Any]:
    """Every step's choices (starters, frameworks, libraries, skins, models, Claude accounts) and the current project's values."""
    r = _ok(_engine({"action": "options"}, timeout=40))
    r["accounts"] = _accounts()
    return r


@router.get("/current")
def current() -> dict[str, Any]:
    """The active project and the values the wizard's optional steps start on."""
    return _ok(_engine({"action": "current"}, timeout=40))


@router.get("/draft")
def draft_get() -> dict[str, Any]:
    return _ok(_engine({"action": "draft"}, timeout=60))


@router.post("/draft")
def draft_set(req: DraftReq) -> dict[str, Any]:
    """Fill the wizard one step at a time without the UI (voice: 'call the new project Garden')."""
    with _writing():
        return _ok(_engine({"action": "draft", "set": req.set, "reset": req.reset}, timeout=60))


@router.get("/list/{location}")
def listing(location: Literal["github", "vps", "local"]) -> dict[str, Any]:
    return _ok(_engine({"action": "list", "location": location}, timeout=40))


@router.post("/kit")
def kit(req: KitReq) -> dict[str, Any]:
    if not req.rebuild:
        return _ok(_engine({"action": "kit", "name": req.name}, timeout=60))
    with _writing():
        return _ok(_engine({"action": "kit", "name": req.name, "rebuild": True}, timeout=180))


@router.post("/link")
def link(req: LinkReq) -> dict[str, Any]:
    with _writing():
        return _ok(_engine({"action": "link", "name": req.name, "url": req.url}, timeout=120))


@router.post("/forget")
def forget(req: NameReq) -> dict[str, Any]:
    """Drops the project from the wizard's list only; folders and repositories are never deleted."""
    with _writing():
        return _ok(_engine({"action": "forget", "name": req.name}))
