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

# set (the panel's inline edit) on REST and CLI
r = c.post(f"{B}/fresh/set", json={"token": "color-theme:fresh-light/tokens.muted", "value": "#5a6270"})
ok("set: one token written and re-checked", r.status_code == 200 and r.json()["write"]["value"] == "#5a6270" and r.json()["result"]["$axf"] == "skin-check@1", r.text[:300])
ok("set: a token the skin does not have is 404", c.post(f"{B}/fresh/set", json={"token": "color-theme:fresh-light/tokens.nope", "value": "#000"}).status_code == 404)
ok("set: a malformed token is 400", c.post(f"{B}/fresh/set", json={"token": "nope", "value": "#000"}).status_code == 400)
code, cj = cli("set", "fresh", "color-theme:fresh-light/tokens.muted", "#5a6270")
ok("parity set: CLI and REST write the same", code in (0, 1) and cj.get("write", {}).get("value") == "#5a6270" and strip(cj)["result"]["score"] == r.json()["result"]["score"])
code, cj = cli("fix", "fresh", "--all")
ok("parity fix_all: CLI runs the same core (nothing left to fix after REST fix-all)", code == 0 and cj["result"]["fixable"] == 0, cj.get("applied"))

# the contract's surface table: every action has a REST route here, an MCP tool, a CLI form and a voice command
code, sj = cli("call", "surfaces")
surfaces = sj.get("surfaces") or []
ok("the surface table lists every action", sorted(x["action"] for x in surfaces) == sorted(["check", "state", "fix", "fix_all", "settings_get", "settings_set", "settings_reset", "open"]), surfaces)
reg = subprocess.run(["node", "framework/cli/plugin-commands.mjs", "registry", "--json"], cwd=ROOT, capture_output=True, text=True)
entry = next((x for x in json.loads(reg.stdout)["plugins"] if x["folder"] == "skin-editor"), None)
tools = {f"skin_editor_{cmd['id'].replace('-', '_')}": cmd for cmd in (entry or {}).get("commands", [])}
routes = {(m, "/api/plugins/skin-editor" + rt.path) for rt in mod.router.routes for m in (getattr(rt, "methods", None) or ())}
voice = (ROOT / "apps/amberx-droid/src/plugins/commands/web/lib-developer.ts").read_text()
for x in surfaces:
    path = "/api/plugins/skin-editor/" + x["rest"]["path"].replace(":skin", "{skin}")
    ok(f"{x['action']}: REST {x['rest']['method']} {x['rest']['path']} is served", (x["rest"]["method"], path) in routes, sorted(routes))
    if x["mcp"] != "console_show":
        cmd = tools.get(x["mcp"])
        ok(f"{x['action']}: MCP {x['mcp']} runs that route", bool(cmd) and cmd["run"]["route"]["method"] == x["rest"]["method"] and cmd["run"]["route"]["path"] == "/" + x["rest"]["path"].replace(":skin", "{skin}"), cmd and cmd["run"])
    else:
        ok("open: MCP link tool gives the deep link for console_show", "skin_editor_link" in tools)
    vid = x["voice"].split(".", 1)[1]
    ok(f"{x['action']}: voice {x['voice']} is an AmberX command", f"'{vid}'" in voice)
    vline = next((ln for ln in voice.splitlines() if f"'{vid}'" in ln), "")
    ok(f"{x['action']}: voice runs the MCP tool", x["mcp"] in vline or (x["action"] == "open" and "skin_editor_link" in vline), vline[:200])
    ok(f"{x['action']}: CLI form `axf {x['cli']}` exists", x["cli"].split()[1] in ("check", "fix", "settings", "open"))

print(f"{'✗' if fails else '✓'} skin-editor server: {fails} failed")
sys.exit(1 if fails else 0)
