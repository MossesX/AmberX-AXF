"""Build profiles: the console server's resolver (build_profiles.py) agrees with the Node one (persist.mjs).

    python3 apps/console-web/server/test_build_profiles.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
import build_profiles as bp  # noqa: E402

CLI = ROOT / "framework" / "cli" / "profiles.mjs"
passed = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global passed
    if not cond:
        raise SystemExit(f"FAIL {name} {detail}")
    passed += 1


def node(*args: str, env: dict[str, str]) -> dict:
    out = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)
    return json.loads(out.stdout.strip().splitlines()[-1])


def node_path(rel: str, env: dict[str, str]) -> str:
    js = f"import('{(ROOT / 'framework/cli/persist.mjs').as_posix()}').then(m=>console.log(m.dataPath({json.dumps(rel)})))"
    return subprocess.run(["node", "-e", js], cwd=ROOT, env=env, capture_output=True, text=True, timeout=60).stdout.strip()


with tempfile.TemporaryDirectory() as tmp:
    data = Path(tmp) / "data"
    data.mkdir()
    env = {**os.environ, "AXF_DATA_DIR": str(data)}
    env.pop("AXF_BUILD_PROFILE", None)
    os.environ.pop("AXF_BUILD_PROFILE", None)  # CI pins the base profile for its checks; this test picks its own
    prof = bp.BuildProfiles(ROOT, lambda: data)

    st = node("state", env=env)
    check("state ok", st.get("ok") is True, str(st))
    ids = [p["id"] for p in st["profiles"]]
    check("all is the one (base) profile", ids == ["all"] and st["profiles"][0].get("base") is True, str(ids))
    check("retired profiles gone (main-framework too)", not any(i in ids for i in bp.RETIRED_PROFILES) and "main-framework" in bp.RETIRED_PROFILES, str(ids))
    check("python registry matches", [p["id"] for p in prof.registry()["profiles"]] == ids)
    check("all takes the framework's sources", prof.active().get("catalog") is True)

    # a second profile still works (profiles stay an open list); `all` keeps the original paths
    # (its orchestrator tracker is a repo file: taken away again at the end, so the checkout keeps one profile)
    side_dir = ROOT / "_claude/builds/profiles/side"
    made_side = not side_dir.exists()
    r = node("act", json.dumps({"action": "create", "name": "Side", "id": "side"}), env=env)
    check("create side", r.get("ok") is True, str(r))
    for pid in ("side", "all"):
        r = node("act", json.dumps({"action": "select", "id": pid}), env=env)
        check(f"select {pid}", r.get("ok") is True, str(r))
        check(f"python sees {pid}", prof.active()["id"] == pid)
        for rel in [*bp.PROFILED, "framework/catalog/libraries.json", "framework/schemas/project-rules.json"]:
            n = node_path(rel, env)
            py = str(prof.data_path(rel))
            check(f"{pid} {rel}", Path(n).resolve() == Path(py).resolve(), f"node={n} py={py}")
            if pid == "all":
                check(f"all keeps the original path {rel}", "/profiles/" not in n, n)

    # a retired id means all (old briefs, AXF_BUILD_PROFILE=urgent or main-framework, a hub registry not yet saved again)
    check("retired env id resolves", node("current", env={**env, "AXF_BUILD_PROFILE": "urgent"})["profile"]["id"] == "all")
    check("main-framework env id resolves", node("current", env={**env, "AXF_BUILD_PROFILE": "main-framework"})["profile"]["id"] == "all")
    os.environ["AXF_BUILD_PROFILE"] = "breakroom"
    check("python retired env id resolves", prof.active()["id"] == "all")
    os.environ["AXF_BUILD_PROFILE"] = "main-framework"
    check("python main-framework env id resolves", prof.active()["id"] == "all")
    del os.environ["AXF_BUILD_PROFILE"]
    old_reg = {"active": "current", "profiles": [{"id": "main-framework", "name": "Main"}, {"id": "current", "name": "Current"}, {"id": "angel", "name": "Angel"}]}
    (data / "framework/plan/profiles.json").write_text(json.dumps(old_reg))
    st_old = node("state", env=env)
    check("old registry reads folded", [p["id"] for p in st_old["profiles"]] == ["all"] and st_old["active"] == "all", str(st_old))
    check("python folds the old registry too", [p["id"] for p in prof.registry()["profiles"]] == ["all"] and prof.registry()["active"] == "all")
    old_all = {"active": "main-framework", "profiles": [{"id": "main-framework", "name": "Main"}, {"id": "all", "name": "All builds", "catalog": False}]}
    (data / "framework/plan/profiles.json").write_text(json.dumps(old_all))
    st_old = node("state", env=env)
    check("registry from before the base moved reads folded", [(p["id"], p.get("base"), p.get("catalog")) for p in st_old["profiles"]] == [("all", True, True)] and st_old["active"] == "all", str(st_old))
    check("python too", [(p["id"], p["base"], p.get("catalog")) for p in prof.registry()["profiles"]] == [("all", True, True)])
    for rid in ("urgent", "main-framework"):
        check(f"{rid} can't be created again", node("act", json.dumps({"action": "create", "name": "X", "id": rid}), env=env).get("ok") is False)
    node("act", json.dumps({"action": "select", "id": "all"}), env=env)

    # guards
    check("base can't go", node("act", json.dumps({"action": "remove", "id": "all", "confirm": "all"}), env=env).get("ok") is False)
    check("bad id refused", node("act", json.dumps({"action": "create", "name": "x", "id": "Bad Id"}), env=env).get("ok") is False)
    check("duplicate refused", node("act", json.dumps({"action": "create", "name": "All", "id": "all"}), env=env).get("ok") is False)

    if made_side:
        import shutil
        shutil.rmtree(side_dir, ignore_errors=True)
        try:
            side_dir.parent.rmdir()  # only when empty
        except OSError:
            pass

print(f"build profiles: {passed} checks passed")
