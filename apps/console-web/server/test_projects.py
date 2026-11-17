"""Projects (projects@1): the console server's mirror (projects.py) agrees with the Node side (projects.mjs).

    python3 apps/console-web/server/test_projects.py
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
import build_profiles as bp  # noqa: E402
import projects as pj  # noqa: E402

CLI = ROOT / "framework" / "cli" / "projects.mjs"
passed = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global passed
    if not cond:
        raise SystemExit(f"FAIL {name} {detail}")
    passed += 1


def node(*args: str, env: dict[str, str]) -> dict:
    out = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise SystemExit(f"FAIL node {' '.join(args)}: {out.stderr or out.stdout}")
    return json.loads(out.stdout.strip().splitlines()[-1])


# ---- pure rules (same as projects-core.mjs)
reg = pj.normalize_registry(None)
check("base always there", [p["id"] for p in reg["projects"]] == ["amberx-axf"] and reg["projects"][0]["base"])
reg = pj.normalize_registry({"projects": [{"id": "garden", "name": "Garden"}, {"id": "Bad Id"}, {"id": "garden"}]})
check("bad and duplicate ids dropped, base first", [p["id"] for p in reg["projects"]] == ["amberx-axf", "garden"])
check("profile defaults to the id", reg["projects"][1]["profile"] == "garden")
check("project_dir base", pj.project_dir("/d/x", reg["projects"][0]) == Path("/d/x"))
check("project_dir other", pj.project_dir("/d/x", reg["projects"][1]) == Path("/d/x/projects/garden"))
check("notes folder", pj.notes_folder(reg["projects"][0]) == "notes" and pj.notes_folder(reg["projects"][1]) == "project-notes/garden")
reg = pj.normalize_registry({"projects": [{"id": "amberx-axf", "owns": ["credentials"]}, {"id": "garden", "owns": ["hub", "bogus", "credentials"], "accounts": {"members": ["a", "Bad!"], "active": "zz"}}]})
g = reg["projects"][1]
check("owns: known scopes, SCOPES order", g["owns"] == ["credentials", "hub"], json.dumps(g))
check("owns: base never owns", reg["projects"][0]["owns"] == [])
check("scope_dir: shared unless owned", pj.scope_dir("/c", g, "plugins") == Path("/c") and pj.scope_dir("/c", g, "credentials") == Path("/c/projects/garden"))
check("account set: only owners have one", pj.account_set(g) is None and pj.account_set({**g, "owns": ["claude-accounts"]}) == {"members": ["a"], "active": ""})

# ---- agrees with Node on a scratch data folder
tid = f"t-pyproj-{os.getpid()}"
data = Path(tempfile.mkdtemp(prefix="axf-projects-py-"))
env = {**os.environ, "AXF_DATA_DIR": str(data), "AXF_BUILDS_LIVE": "0", "AXF_ACTOR": "test_projects", "AXHUB_PROJECTS_DIR": str(data / "no-hub")}
env.pop("AXF_BUILD_PROFILE", None)
old = {k: os.environ.get(k) for k in ("AXF_BUILD_PROFILE",)}
os.environ.pop("AXF_BUILD_PROFILE", None)
try:
    profiles = bp.BuildProfiles(ROOT, lambda: data)
    projects = pj.Projects(ROOT, lambda: data, profiles.active)
    check("server: AmberX AXF at first", projects.active()["id"] == "amberx-axf")
    node("new", f"Py {tid}", "--id", tid, env=env)
    check("server: follows the Node switch", projects.active()["id"] == tid, json.dumps(projects.active()))
    check("server: plugin data goes to projects/<id>", projects.dir(data / "plug") == data / "plug" / "projects" / tid)
    # The credential vault follows the project: own credentials, switch, the environment swaps; switch back, it swaps back.
    import credentials  # noqa: E402
    cons = data / "console"
    cons.mkdir()
    (cons / "secrets.env").write_text("GITHUB_TOKEN=shared-token-123\n")
    env_c = {**env, "AXF_CONSOLE_DIR": str(cons)}
    os.environ.pop("GITHUB_TOKEN", None)
    store = credentials.init(cons, lambda: projects.scope_dir(cons, "credentials"))
    check("vault: own copy starts as the shared one", node("own", tid, "credentials", env=env_c)["ok"] and (cons / "projects" / tid / "secrets.env").read_text().strip() == "GITHUB_TOKEN=shared-token-123")
    check("vault: own copy is 0600", (cons / "projects" / tid / "secrets.env").stat().st_mode & 0o777 == 0o600)
    store.set("GITHUB_TOKEN", "project-token-456")
    check("vault: a change lands in the project's own file", "project-token-456" in (cons / "projects" / tid / "secrets.env").read_text() and "shared-token-123" in (cons / "secrets.env").read_text())
    node("select", "amberx-axf", env=env)
    check("switch swaps credentials (to shared)", store.read().get("GITHUB_TOKEN") == "shared-token-123" and os.environ.get("GITHUB_TOKEN") == "shared-token-123")
    node("select", tid, env=env)
    check("switch swaps credentials (to own)", store.read().get("GITHUB_TOKEN") == "project-token-456" and os.environ.get("GITHUB_TOKEN") == "project-token-456")
    node("share", tid, "credentials", env=env_c)
    check("share: back on the shared vault, own file kept", store.read().get("GITHUB_TOKEN") == "shared-token-123" and (cons / "projects" / tid / "secrets.env").exists())
    os.environ.pop("GITHUB_TOKEN", None)
    node("select", "amberx-axf", env=env)
    check("server: back to AmberX AXF", projects.active()["id"] == "amberx-axf" and projects.dir(data / "plug") == data / "plug")
    check("server: a build's project", (projects.of_build(next(iter(projects.build_profiles()), "")) or {}).get("id") == "amberx-axf")
    node("delete", tid, "--confirm", tid, env=env)
    check("server: deleted project gone", all(p["id"] != tid for p in projects.registry()["projects"]))
finally:
    shutil.rmtree(data, ignore_errors=True)
    shutil.rmtree(ROOT / "_claude" / "builds" / "profiles" / tid, ignore_errors=True)
    for k, v in old.items():
        if v is not None:
            os.environ[k] = v

print(f"projects (server): {passed} checks passed")
