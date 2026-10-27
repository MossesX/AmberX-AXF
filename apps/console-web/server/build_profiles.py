"""Build profiles (build-profiles@1) on the console server: the Python mirror of framework/cli/persist.mjs.

A build profile is one complete set of work data (pending builds, plan + media, build queue, catalog status,
tracker, the Build orchestrator's tracker). The Node side (framework/cli/profiles.mjs, persist.mjs → dataPath)
owns the registry and every write; this module only answers "which file does the active profile read?" for the
server's own direct reads (pending file for alerts, plan media, plugin readers through console_context.data_path).
test_build_profiles.py checks it against the Node resolver.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Callable

PROFILES_REL = "framework/plan/profiles.json"
PROFILES_DIR_REL = "framework/plan/profiles/"
BASE_PROFILE = "main-framework"
PROFILED = (
    "framework/plan/pending.json",
    "framework/plan/plan.json",
    "framework/plan/build-queue.json",
    "framework/plan/media/",
    "framework/catalog/status.json",
    "tracker.json",
)
PROFILE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


class BuildProfiles:
    def __init__(self, root: Path, persist_root: Callable[[], Path | None]):
        self.root = Path(root)
        self.persist_root = persist_root

    def _base(self, rel: str) -> Path:
        """Plain location: the hub copy when it exists, else the repo copy (what the server always did)."""
        pr = self.persist_root()
        hub = Path(pr) / rel if pr else None
        return hub if hub and hub.exists() else self.root / rel

    def registry(self) -> dict[str, Any]:
        try:
            reg = json.loads(self._base(PROFILES_REL).read_text("utf-8"))
        except (OSError, ValueError):
            reg = {}
        items = [p for p in (reg.get("profiles") if isinstance(reg, dict) else None) or [] if isinstance(p, dict) and PROFILE_ID.match(str(p.get("id", "")))]
        if not any(p["id"] == BASE_PROFILE for p in items):
            items.insert(0, {"id": BASE_PROFILE, "name": "Main framework"})
        for p in items:
            p["base"] = p["id"] == BASE_PROFILE
        active = reg.get("active") if isinstance(reg, dict) else None
        if not any(p["id"] == active for p in items):
            active = BASE_PROFILE
        return {"$axf": "build-profiles@1", "active": active, "profiles": items}

    def active(self) -> dict[str, Any]:
        reg = self.registry()
        env = os.environ.get("AXF_BUILD_PROFILE")
        pid = env if env and any(p["id"] == env for p in reg["profiles"]) else reg["active"]
        return next(p for p in reg["profiles"] if p["id"] == pid)

    @staticmethod
    def profiled(rel: str) -> str | None:
        for p in PROFILED:
            if (rel == p or rel.startswith(p)) if p.endswith("/") else rel == p:
                return p
        return None

    def data_path(self, rel: str) -> Path:
        """Where the active profile keeps `rel` (may not exist yet: the Node side creates profile files)."""
        rel = rel.lstrip("/")
        if not self.profiled(rel):
            return self._base(rel)
        prof = self.active()
        if prof["base"]:
            return self._base(rel)
        prel = f"{PROFILES_DIR_REL}{prof['id']}/{rel}"
        pr = self.persist_root()
        hub = Path(pr) / prel if pr else None
        return hub if hub and hub.exists() else self.root / prel
