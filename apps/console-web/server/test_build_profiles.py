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
    prof = bp.BuildProfiles(ROOT, lambda: data)

    st = node("state", env=env)
    check("state ok", st.get("ok") is True, str(st))
    ids = [p["id"] for p in st["profiles"]]
    check("main + refactor listed", "main-framework" in ids and "refactor" in ids, str(ids))
    check("python registry matches", [p["id"] for p in prof.registry()["profiles"]] == ids)

    for pid in ("main-framework", "refactor"):
        r = node("act", json.dumps({"action": "select", "id": pid}), env=env)
        check(f"select {pid}", r.get("ok") is True, str(r))
        check(f"python sees {pid}", prof.active()["id"] == pid)
        for rel in [*bp.PROFILED, "framework/catalog/libraries.json", "framework/schemas/project-rules.json"]:
            n = node_path(rel, env)
            py = str(prof.data_path(rel))
            check(f"{pid} {rel}", Path(n).resolve() == Path(py).resolve(), f"node={n} py={py}")

    # refactor starts empty, never a copy of main
    pend = json.loads(Path(node_path("framework/plan/pending.json", env)).read_text())
    check("refactor pending empty", pend["items"] == [])

    # override for one process
    env2 = {**env, "AXF_BUILD_PROFILE": "main-framework"}
    check("env override", node("current", env=env2)["profile"]["id"] == "main-framework")
    os.environ["AXF_BUILD_PROFILE"] = "main-framework"
    check("python env override", prof.active()["id"] == "main-framework")
    del os.environ["AXF_BUILD_PROFILE"]

    # guards
    check("base can't go", node("act", json.dumps({"action": "remove", "id": "main-framework", "confirm": "main-framework"}), env=env).get("ok") is False)
    check("active can't go", node("act", json.dumps({"action": "remove", "id": "refactor", "confirm": "refactor"}), env=env).get("ok") is False)
    check("bad id refused", node("act", json.dumps({"action": "create", "name": "x", "id": "Bad Id"}), env=env).get("ok") is False)
    check("duplicate refused", node("act", json.dumps({"action": "create", "name": "Refactor", "id": "refactor"}), env=env).get("ok") is False)
    node("act", json.dumps({"action": "select", "id": "main-framework"}), env=env)

print(f"build profiles: {passed} checks passed")
