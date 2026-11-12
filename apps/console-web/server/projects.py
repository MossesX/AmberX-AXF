"""Projects (projects@1) on the console server: the Python mirror of the read side of framework/plan/projects-core.mjs.

A project is one workspace with its own builds, notes, to-dos, tasks, lists and plans. Each project owns one build
profile (build-profiles@1), and the active project is the project owning the active profile (one switch, nothing to
drift). The Node side (framework/cli/projects.mjs) owns the registry and every change; this module answers "which
project is in force, and where does it keep a plugin's data?" for the server and its plugins (console_context:
cx.project(), cx.project_dir(path), cx.project_of_profile(id)).

The base project, AmberX AXF, keeps every original path; any other project keeps a plugin's data in
`<plugin data folder>/projects/<id>/` and its notes in the hub's `_shared/_claude/project-notes/<id>/`.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Callable

PROJECTS_REL = "framework/plan/projects.json"
PROJECTS_SUBDIR = "projects"
PROJECT_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
STATUSES = ("active", "archived")
BASE_PROJECT: dict[str, Any] = {
    "id": "amberx-axf",
    "name": "AmberX AXF",
    "description": "The AmberX framework, its apps and the console: every build, note, to-do and plan from before projects.",
    "profile": "all",
    "status": "active",
    "createdAt": "2026-11-12T00:00:00.000Z",
}


def _s(v: Any, n: int = 200) -> str:
    return v.strip()[:n] if isinstance(v, str) else ""


def normalize_registry(raw: Any, base_profile: str = "all") -> dict[str, Any]:
    """Same rules as projects-core.mjs normalizeRegistry: the base project always there and first."""
    listed = raw.get("projects") if isinstance(raw, dict) and isinstance(raw.get("projects"), list) else []
    seen: set[str] = set()
    projects: list[dict[str, Any]] = []
    for p in listed:
        pid = _s(p.get("id") if isinstance(p, dict) else None, 40)
        if not PROJECT_ID.match(pid) or pid in seen:
            continue
        seen.add(pid)
        prof = _s(p.get("profile"), 40)
        projects.append({
            "id": pid, "name": _s(p.get("name"), 80) or pid, "description": _s(p.get("description"), 600),
            "profile": prof if PROJECT_ID.match(prof) else pid,
            "status": p.get("status") if p.get("status") in STATUSES else "active",
            "createdAt": _s(p.get("createdAt"), 40) or BASE_PROJECT["createdAt"],
            "updatedAt": _s(p.get("updatedAt"), 40) or _s(p.get("createdAt"), 40) or BASE_PROJECT["createdAt"],
            **({"archivedAt": _s(p.get("archivedAt"), 40)} if p.get("archivedAt") else {}),
        })
    base = next((p for p in projects if p["id"] == BASE_PROJECT["id"]), None)
    if base is None:
        base = {**BASE_PROJECT, "updatedAt": BASE_PROJECT["createdAt"]}
        projects.insert(0, base)
    base["profile"] = base_profile
    base["status"] = "active"
    base.pop("archivedAt", None)
    for p in projects:
        p["base"] = p is base
    projects.sort(key=lambda p: not p["base"])
    return {"$axf": "projects@1", "updatedAt": _s(raw.get("updatedAt") if isinstance(raw, dict) else None, 40), "projects": projects}


def project_dir(base_dir: Path | str, project: dict[str, Any] | None) -> Path:
    """Where a plugin keeps `project`'s data, given its own data folder (the base project: the folder itself)."""
    d = Path(base_dir)
    return d if not project or project.get("base") else d / PROJECTS_SUBDIR / project["id"]


def notes_folder(project: dict[str, Any] | None) -> str:
    """The project's notes folder under the hub's `_shared/_claude/` (base project: `notes`)."""
    return "notes" if not project or project.get("base") else f"project-notes/{project['id']}"


class Projects:
    def __init__(self, root: Path, persist_root: Callable[[], Path | None], active_profile: Callable[[], dict[str, Any]]):
        self.root = Path(root)
        self.persist_root = persist_root
        self.active_profile = active_profile

    def _file(self) -> Path:
        pr = self.persist_root()
        hub = Path(pr) / PROJECTS_REL if pr else None
        return hub if hub and hub.exists() else self.root / PROJECTS_REL

    def registry(self) -> dict[str, Any]:
        try:
            raw = json.loads(self._file().read_text("utf-8"))
        except (OSError, ValueError):
            raw = {}
        return normalize_registry(raw)

    def of_profile(self, profile_id: str | None, reg: dict[str, Any] | None = None) -> dict[str, Any]:
        reg = reg or self.registry()
        return next((p for p in reg["projects"] if p["profile"] == profile_id), reg["projects"][0])

    def active(self) -> dict[str, Any]:
        """The project in force: the one owning the active build profile (AXF_BUILD_PROFILE pins it per process)."""
        try:
            prof = self.active_profile().get("id")
        except Exception:  # noqa: BLE001 — a damaged profile registry reads as the base project
            prof = "all"
        return {**self.of_profile(prof), "active": True}

    def dir(self, base_dir: Path | str) -> Path:
        return project_dir(base_dir, self.active())

    # ---- a build's project (the builds store, builds@1: a build's first profile), cached on the store's mtime
    _builds: tuple[float, dict[str, str]] = (-1.0, {})

    def _store_file(self) -> Path:
        return self.root / "_claude" / "builds" / "store.json"

    def build_profiles(self) -> dict[str, str]:
        f = self._store_file()
        try:
            mt = f.stat().st_mtime
        except OSError:
            return {}
        if mt != self._builds[0]:
            try:
                store = json.loads(f.read_text("utf-8"))
                m = {str(b.get("id")): (b.get("profiles") or ["all"])[0] for b in store.get("builds", []) if isinstance(b, dict) and b.get("id")}
            except (OSError, ValueError, AttributeError, TypeError):
                m = {}
            self._builds = (mt, m)
        return self._builds[1]

    def of_build(self, build_id: str | None) -> dict[str, Any] | None:
        """The project a build belongs to (None for no build / an unknown one)."""
        prof = self.build_profiles().get(str(build_id or ""))
        return self.of_profile(prof) if prof else None
