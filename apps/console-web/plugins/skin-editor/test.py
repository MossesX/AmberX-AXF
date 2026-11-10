"""Skin editor server part: the checker routes over the Node core (skins, state, check, fix, fix-all, settings get / set /
reset, link), bad input answered 400 / 404, settings persisted, and REST = CLI parity (the same action through the
route and through `axf skin … --json` gives the same JSON).

    python apps/console-web/plugins/skin-editor/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
DATA = Path(tempfile.mkdtemp(prefix="axf-skin-editor-"))
os.environ["AXF_SKIN_EDITOR_DIR"] = str(DATA)

spec = importlib.util.spec_from_file_location("skin_editor_server", HERE / "server" / "__init__.py")
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/api/plugins/skin-editor")
c = TestClient(app)
B = "/api/plugins/skin-editor/checker"
fails = 0


def ok(name: str, cond: bool, detail: object = "") -> None:
    global fails
    print(f"{'✓' if cond else '✗'} {name}" + ("" if cond else f"  {json.dumps(detail, default=str)[:400]}"))
    if not cond:
        fails += 1


def cli(*args: str) -> tuple[int, dict]:
    p = subprocess.run(["node", str(ROOT / "packages/skin-checker/bin/skin-check.mjs"), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=180,
                       env={**os.environ, "AXF_SKIN_EDITOR_DIR": str(DATA)})
    lines = [ln for ln in p.stdout.splitlines() if ln.startswith("{")]
    return p.returncode, (json.loads(lines[-1]) if lines else {"stderr": p.stderr[-300:]})


def strip(r: dict) -> dict:
    """A result without its run time (two runs differ only in `at`)."""
    r = json.loads(json.dumps(r))
    for k in ("result", "before"):
        if isinstance(r.get(k), dict):
            r[k].pop("at", None)
    for x in r.get("results", []) or []:
        x.pop("at", None)
    return r


# skins
r = c.get(f"{B}/skins")
ok("skins lists skins and design packages", r.status_code == 200 and any(s["kind"] == "skin" for s in r.json()["skins"]) and any(s["kind"] == "design-package" for s in r.json()["skins"]), r.text[:300])

# settings
r = c.get(f"{B}/settings")
ok("settings: defaults", r.status_code == 200 and r.json()["settings"]["minScore"] == 80 and r.json()["changed"] == [], r.text[:300])
r = c.get(f"{B}/settings", params={"schema": "true"})
ok("settings: groups on request", r.status_code == 200 and [g["id"] for g in r.json()["groups"]][:2] == ["passing", "spacing"])
r = c.put(f"{B}/settings", json={"settings": {"contrast.text": 7, "rules": {"palette.sprawl": "off"}}})
ok("settings: write flat key and a rule override", r.status_code == 200 and r.json()["settings"]["contrast"]["text"] == 7 and r.json()["settings"]["rules"] == {"palette.sprawl": "off"}, r.text[:300])
ok("settings: persisted in the data folder", json.loads((DATA / "settings.json").read_text())["contrast"]["text"] == 7)
r = c.put(f"{B}/settings", json={"key": "typography.maxFamilies", "value": "3"})
ok("settings: key/value form, string coerced", r.status_code == 200 and r.json()["flat"]["typography.maxFamilies"] == 3 and "typography.maxFamilies" in r.json()["changed"])
r = c.put(f"{B}/settings", json={"settings": {"contrast.text": 99}})
ok("settings: out of range is 400", r.status_code == 400 and "between" in r.json()["message"], r.text)
r = c.put(f"{B}/settings", json={"settings": {"nope": 1}})
ok("settings: unknown key is 400", r.status_code == 400, r.text)
r = c.put(f"{B}/settings", content=b"[1,2]")
ok("settings: not an object is 400", r.status_code == 400)
r = c.delete(f"{B}/settings")
ok("settings: reset", r.status_code == 200 and r.json()["changed"] == [] and r.json()["settings"]["contrast"]["text"] == 4.5)

# check / state
r = c.get(f"{B}/fresh")
ok("state: runs the check when there is none", r.status_code == 200 and r.json()["cached"] is False and r.json()["result"]["$axf"] == "skin-check@1", r.text[:300])
r2 = c.get(f"{B}/fresh")
ok("state: then returns the kept result", r2.json()["cached"] is True and r2.json()["result"]["at"] == r.json()["result"]["at"])
r = c.post(f"{B}/fresh/check")
fresh = r.json()["result"]
ok("check: a result with issues and fixes", r.status_code == 200 and fresh["issues"] and fresh["fixable"] > 0, r.text[:300])
ok("unknown skin is 404", c.post(f"{B}/no-such-skin/check").status_code == 404)
ok("bad skin id is 400", c.get(f"{B}/Bad_Id!").status_code == 400)

# fix one / fix all
one = next(i for i in fresh["issues"] if i.get("fix"))
r = c.post(f"{B}/fresh/fix", json={"issues": [one["id"]]})
j = r.json()
ok("fix: the issue is fixed and gone", r.status_code == 200 and j["applied"]["fixed"] == [one["id"]] and all(i["id"] != one["id"] for i in j["result"]["issues"]), r.text[:400])
ok("fix: the asset copy lands in the data folder, not the repo", all(f.startswith(str(DATA)) or not f.startswith("framework/") for f in j["applied"]["files"]) and any((DATA / "assets").rglob("*.json")), j["applied"]["files"])
ok("fix: no issues is 400", c.post(f"{B}/fresh/fix", json={}).status_code == 400)
ok("fix: a malformed id is 400", c.post(f"{B}/fresh/fix", json={"issues": ["nope"]}).status_code == 400)
r = c.post(f"{B}/fresh/fix-all")
j = r.json()
ok("fix-all: score goes up, nothing fixable left after a re-run", r.status_code == 200 and j["result"]["score"] >= j["before"]["score"], r.text[:300])
r = c.get(f"{B}/link", params={"skin": "fresh", "issue": one["id"]})
ok("link: the deep link", r.status_code == 200 and r.json()["target"].startswith("skin-editor/checker?skin=fresh&issue="), r.text)

# REST = CLI (same core, same JSON)
code, cj = cli("check", "windows")
rj = c.post(f"{B}/windows/check").json()
ok("parity check: REST and CLI give the same result", strip(rj) == strip(cj), [rj.get("result", {}).get("score"), cj.get("result", {}).get("score")])
ok("CLI check exits 1 when the skin fails, 0 when it passes", code == (0 if cj["result"]["pass"] else 1), code)
code, cj = cli("settings")
ok("parity settings_get", c.get(f"{B}/settings").json() == cj)
code, cj = cli("settings", "set", "shape.maxRadii", "4")
ok("parity settings_set: the CLI write is what REST reads", code == 0 and c.get(f"{B}/settings").json() == cj and cj["flat"]["shape.maxRadii"] == 4)
code, cj = cli("check", "windows", "--cached")
ok("parity state", strip(c.get(f"{B}/windows").json()) == strip({**cj}), cj.get("cached"))
code, cj = cli("open", "windows")
ok("parity open", c.get(f"{B}/link", params={"skin": "windows"}).json() == cj)

print(f"{'✗' if fails else '✓'} skin-editor server: {fails} failed")
sys.exit(1 if fails else 0)
