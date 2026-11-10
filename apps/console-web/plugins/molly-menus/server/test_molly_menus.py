"""Molly menus REST routes against a scratch look folder (no hub, no network for writes).

python apps/console-web/plugins/molly-menus/server/test_molly_menus.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "server"))  # plugin_services
sys.path.insert(0, str(HERE.parent))

TMP = Path(tempfile.mkdtemp(prefix="molly-menus-"))
(TMP / "looks").mkdir()
(TMP / "appearance.json").write_text(json.dumps({"$axf": "appearance@1", "slots": {"color-theme": "hub-night"}}))
os.environ["AXF_APPEARANCE_FILE"] = str(TMP / "appearance.json")
os.environ["AXF_LOOKS_DIR"] = str(TMP / "looks")
os.environ["AXF_MOLLY_URL"] = "https://molly.example"

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import server as molly  # noqa: E402

app = FastAPI()
app.include_router(molly.router, prefix="/api/plugins/molly-menus")
c = TestClient(app)
B = "/api/plugins/molly-menus"
fails: list[str] = []


def check(name: str, ok: bool, detail: object = "") -> None:
    print(("✓ " if ok else "✗ ") + name + ("" if ok else f"  {detail}"))
    if not ok:
        fails.append(name)


r = c.get(f"{B}/choices").json()
ids = [x["id"] for x in r["choices"]]
check("choices lists skin, mode, density, text, motion", ids == ["skin", "mode", "density", "text", "motion"], ids)
check("skin starts as Molly's own look", r["choices"][0]["value"] == "own", r["choices"][0])

r = c.put(f"{B}/choices/density", json={"value": "roomy"})
check("set density", r.status_code == 200 and r.json()["value"] == "roomy", r.text)
r = c.put(f"{B}/choices/density", json={"value": "huge"})
check("a value outside the choice is 422", r.status_code == 422, r.status_code)
r = c.put(f"{B}/choices/nope", json={"value": "x"})
check("an unknown choice is 404", r.status_code == 404, r.status_code)

r = c.put(f"{B}/skin", json={"skin": "molly-flagship-night"})
check("switch skin", r.status_code == 200 and r.json()["skin"]["id"] == "molly-flagship-night", r.text)
check("mode reads night under the night skin", c.get(f"{B}/choices").json()["choices"][1]["value"] == "night")
r = c.put(f"{B}/choices/mode", json={"value": "day"})
check("mode day under a flagship skin picks the day skin", r.json()["skin"]["id"] == "molly-flagship", r.text)
r = c.put(f"{B}/skin", json={"skin": "no-such-skin"})
check("an unknown skin is 404", r.status_code == 404, r.status_code)
look = json.loads((TMP / "looks" / "molly.json").read_text())
check("the look document on axHub carries the change", look["skin"]["use"] is True and look["skin"]["id"] == "molly-flagship", look.get("skin"))

r = c.put(f"{B}/skin", json={"skin": "own"})
check("back to Molly's own look", r.json()["skin"]["id"] == "own", r.text)
r = c.put(f"{B}/choices/mode", json={"value": "night"})
check("mode night without a skin sets the flagship night colours", c.get(f"{B}/choices").json()["choices"][1]["value"] == "night", r.text)

t = c.get(f"{B}/tree").json()
paths: list[str] = []


def walk(items: list[dict]) -> None:
    for i in items:
        paths.append(i["path"])
        walk(i.get("items", []))


for m in t["app-menu"]:
    walk(m["items"])
for m in t["context-menu"]:
    walk(m["items"])
check("tree has the app menu's sub-menus", {"app-menu/molly/apps", "app-menu/molly/appearance", "app-menu/molly/status"} <= set(paths))
check("tree has every context target", {m["id"] for m in t["context-menu"]} == {"default", "molly-app", "nav-item", "app-menu"}, [m["id"] for m in t["context-menu"]])
appearance = next(i for i in t["app-menu"][0]["items"] if i["id"] == "appearance")
check("choice rows carry their current value", next(i for i in appearance["items"] if i["id"] == "density")["value"] == "roomy")
status_rows = next(i for i in t["app-menu"][0]["items"] if i["id"] == "status")["items"]
check("status rows name their source", [i["status"] for i in status_rows] == ["source:hub", "source:molly.look", "source:molly.skin", "source:molly.role"])

r = c.post(f"{B}/invoke", json={"path": "app-menu/molly/apps/go-axhub"}).json()
check("invoke a nav row answers the app link", r["link"] == "https://molly.example/#/axhub", r)
r = c.post(f"{B}/invoke", json={"path": "app-menu/molly/this-app/reload"}).json()
check("invoke an action row answers its #/do link", r["link"] == "https://molly.example/#/do/molly.reload", r)
r = c.post(f"{B}/invoke", json={"path": "context-menu/molly-app/own", "payload": "console"}).json()
check("invoke a payload row fills the payload", r["link"] == "https://molly.example/#/do/molly.own-tab:console", r)
r = c.post(f"{B}/invoke", json={"path": "app-menu/molly/appearance/mode"}).json()
check("invoke a two-way choice flips it", r["ran"] == "set" and r["value"] == "day", r)
r = c.post(f"{B}/invoke", json={"path": "app-menu/molly/nope"})
check("invoke an unknown path is 404", r.status_code == 404, r.status_code)

ln = c.get(f"{B}/links").json()
check("links: skin picker, app menu, sub-menus", ln["skinPicker"] == "https://molly.example/#/skin" and ln["appMenu"][0]["link"] == "https://molly.example/#/menu/molly" and any(s["link"].endswith("#/menu/molly/appearance") for s in ln["subMenus"]), ln)

s = c.get(f"{B}/state").json()
check("state has skin, choices, status and links", all(k in s for k in ("skin", "choices", "status", "links")), list(s))

print(f"\n{'all passed' if not fails else f'{len(fails)} failed'}")
sys.exit(1 if fails else 0)
