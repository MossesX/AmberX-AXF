#!/usr/bin/env python3
"""Icon map server part: the routes against a scratch data folder (the map itself comes from the framework CLI).

    python3 apps/console-web/plugins/icon-map/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = Path(tempfile.mkdtemp(prefix="axf-icon-map-test-"))
os.environ["AXF_ICON_MAP_DIR"] = str(DATA)

sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.icon_map_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
B = "/api/plugins/icon-map"
app.include_router(mod.router, prefix=B)
c = TestClient(app)
n = 0


def ok(cond: bool, what: str) -> None:
    global n
    if not cond:
        print(f"✗ {what}")
        sys.exit(1)
    n += 1


st = c.get(f"{B}/state").json()
ok(st["ok"] and st["pack"] == "" and st["slots"] == {} and st["packKey"] == "axf.icons.pack.app", "state: empty to start, names the runtime key")

m = c.get(f"{B}/map", params={"owner": "icon-map", "limit": 50}).json()
ok(m["ok"] and m["$axf"] == "icon-map@1" and m["total"] >= 8 and all(s["owner"] == "icon-map" for s in m["slots"]) and m["counts"]["slots"] > 1000, "map: this plugin's slots, filtered, with the whole map's counts")
first = m["slots"][0]["id"]
ok(c.get(f"{B}/map", params={"q": "save", "surface": "button", "limit": 5}).json()["total"] >= 1, "map: words + surface filter")
ok(c.get(f"{B}/map", params={"surface": "Bad Surface"}).json()["ok"], "map: a bad filter value is ignored, not an error")

ok(len(c.get(f"{B}/tree").json()["tree"]) >= 3, "tree: apps")
ok("save" in c.get(f"{B}/roles").json()["roles"], "roles")
g = c.get(f"{B}/glyphs").json()
ok("home" in g["names"] and g["aliases"]["close"] == "x", "glyphs + aliases")
packs = c.get(f"{B}/packs").json()
ok(packs["ok"] and len(packs["packs"]) >= 3 and packs["active"] == "", "packs: the shipped icon-pack@1 assets, none active")
dup = next(p for p in packs["packs"])

s = c.get(f"{B}/slot/{first}").json()
ok(s["ok"] and s["slot"]["id"] == first and s["draws"]["via"] in ("framework", "role", "fallback") and s["picked"] is None, "slot: one slot with what it draws")
ok(c.get(f"{B}/slot/not-a-slot").status_code == 400 and c.get(f"{B}/slot/a/b/button/nope").status_code == 404, "slot: bad id 400, unknown 404")
r = c.get(f"{B}/resolve", params={"name": "save"}).json()
ok(r["glyph"] == "save" and r["via"] == "framework", "resolve: a framework glyph")
ok(c.get(f"{B}/resolve").status_code == 400, "resolve needs something")

# pack by words
w = c.put(f"{B}/pack", json={"pack": "no such pack anywhere"})
ok(w.status_code == 404 and "packs" in w.json(), "pack: unknown words are 404 and list the packs")
w = c.put(f"{B}/pack", json={"pack": dup["id"], "by": "test", "reason": "trying it"}).json()
ok(w["ok"] and w["pack"] == dup["id"] and w["applied"]["id"] == dup["id"], "pack: set by id")
st = c.get(f"{B}/state").json()
ok(st["pack"] == dup["id"] and st["history"][-1]["what"] == "pack-set" and st["history"][-1]["by"] == "test" and st["history"][-1]["reason"] == "trying it", "state: pack + history with by / reason")
word = dup["style"]
w2 = c.put(f"{B}/pack", json={"pack": f"the {word} icon pack"}).json()
ok(w2["ok"] and w2["applied"]["style"] == word, "pack: found by a style word with filler stripped")
ok(c.get(f"{B}/packs").json()["active"] == w2["pack"], "packs: active follows")
ok(c.put(f"{B}/pack", json={"pack": 5}).status_code == 400, "pack: must be a string")
d = c.delete(f"{B}/pack").json()
ok(d["ok"] and c.get(f"{B}/state").json()["pack"] == "", "pack: cleared")
ok(c.put(f"{B}/pack", json={"pack": ""}).json()["pack"] == "", "pack: '' clears too")

# per-slot picks
ok(c.put(f"{B}/slot/bad", json={"glyph": "star"}).status_code == 400 and c.put(f"{B}/slot/{first}", json={"glyph": "Bad!"}).status_code == 400, "slot: id and glyph validated")
p = c.put(f"{B}/slot/{first}", json={"glyph": "star"}).json()
ok(p["ok"] and p["known"] is True and "warning" not in p, "slot: pick a framework glyph")
p2 = c.put(f"{B}/slot/{first}", json={"glyph": "floppy"}).json()
ok(p2["ok"] and p2["known"] is False and "warning" in p2, "slot: a pack-only glyph is allowed with a warning")
s = c.get(f"{B}/slot/{first}").json()
ok(s["picked"] == "floppy" and s["draws"] == {"glyph": "floppy", "via": "override"}, "slot: the pick wins and says so")
ok(c.get(f"{B}/map", params={"owner": "icon-map", "limit": 50}).json()["slots"][0].get("picked") == "floppy", "map rows carry the pick")
ok(c.get(f"{B}/resolve", params={"slot": first, "name": "grid"}).json()["via"] == "override", "resolve: override first")
d = c.delete(f"{B}/slot/{first}").json()
ok(d["ok"] and d["cleared"] is True and c.get(f"{B}/state").json()["slots"] == {}, "slot: cleared")
ok(c.delete(f"{B}/slot/{first}").json()["cleared"] is False, "slot: clearing twice is fine")

# template + restore (Restore previous edit / Restore from axHub)
t = c.get(f"{B}/template", params={"from": dup["id"], "name": "Mine"}).json()
ok(t["ok"] and t["pack"]["type"] == "icon-pack" and t["pack"]["name"] == "Mine" and t["roles"] >= 100 and "save" in t["pack"]["data"]["roles"], "template: every role mapped, from a pack")
ok(c.get(f"{B}/template", params={"from": "no-such-pack"}).status_code == 404, "template: unknown base pack is 404")
ok(c.get(f"{B}/template", params={"fixed": "1"}).json()["pack"]["data"]["themable"] is False, "template: fixed-colour")
c.put(f"{B}/slot/{first}", json={"glyph": "star"}); c.put(f"{B}/slot/{first}", json={"glyph": "heart"})
r1 = c.post(f"{B}/slot/{first}/restore", json={"from": "previous"}).json()
ok(r1["ok"] and r1["glyph"] == "star" and c.get(f"{B}/state").json()["slots"][first] == "star", "restore previous edit: back one step")
ok(c.post(f"{B}/slot/{first}/restore", json={"from": "previous"}).json()["glyph"] == "heart", "restore previous twice toggles (the restore is an edit too)")
ok(c.post(f"{B}/slot/a/b/button/never/restore", json={"from": "previous"}).status_code == 404, "restore previous: no earlier edit is 404")
ok(c.post(f"{B}/slot/{first}/restore", json={"from": "hub"}).status_code == 503, "restore from axHub: no hub copy yet is 503 with the steps")
ok(c.post(f"{B}/slot/{first}/restore", json={"from": "elsewhere"}).status_code == 400, "restore: from is validated")
ok(c.put(f"{B}/hub-copy", json={"pack": dup["id"], "slots": {first: "bell", "BAD": "x"}}).json()["slots"] == 1, "hub-copy: the console's read of axHub, cleaned")
r2 = c.post(f"{B}/slot/{first}/restore", json={"from": "hub"}).json()
ok(r2["ok"] and r2["glyph"] == "bell", "restore from axHub: the hub's glyph")
ok(c.post(f"{B}/pack/restore", json={"from": "hub"}).json()["pack"] == dup["id"], "pack restore from axHub")
ok(c.post(f"{B}/pack/restore", json={"from": "previous"}).json()["pack"] == "", "pack restore previous")
c.delete(f"{B}/slot/{first}")
other = m["slots"][1]["id"]
ok(c.post(f"{B}/slot/{other}/restore", json={"from": "hub"}).json()["glyph"] is None, "restore from axHub: not on the hub = follows the pack")

# packs are assets: import / export / per-skin defaults / axHub list
tpl = c.get(f"{B}/template", params={"id": "test-imported", "name": "Test imported"}).json()["pack"]
imp = c.post(f"{B}/packs/import", json={"pack": tpl}).json()
ok(imp["ok"] and imp["pack"]["id"] == "test-imported" and imp["pack"]["roles"] >= 100, "import: a template comes back in as a pack")
ok(c.post(f"{B}/packs/import", json={"pack": tpl}).status_code == 409, "import: twice needs replace")
ok(c.post(f"{B}/packs/import", json={"pack": tpl, "replace": True}).json()["ok"], "import: replace")
ok(c.post(f"{B}/packs/import", json={"pack": {**tpl, "id": dup["id"]}}).status_code == 409, "import: a shipped id is refused")
bad = c.post(f"{B}/packs/import", json={"pack": {"type": "icon-pack"}})
ok(bad.status_code == 400 and bad.json()["errors"], "import: an invalid pack says why")
ok(any(p["id"] == "test-imported" for p in c.get(f"{B}/packs/imported").json()["packs"]), "imported packs listed whole")
ok(any(p["id"] == "test-imported" and p.get("source") == "imported" for p in c.get(f"{B}/packs").json()["packs"]), "imported packs join the pack list")
ok(c.put(f"{B}/pack", json={"pack": "test-imported"}).json()["pack"] == "test-imported", "an imported pack can be used")
ex = c.get(f"{B}/packs/test-imported/export").json()
ok(ex["ok"] and ex["pack"]["id"] == "test-imported" and ex["source"] == "imported", "export an imported pack")
ok(c.get(f"{B}/packs/{dup['id']}/export").json()["pack"]["type"] == "icon-pack", "export a shipped pack")
ok(c.get(f"{B}/packs/nope-nope/export").status_code == 404, "export: unknown is 404")
sk = c.get(f"{B}/skin-packs").json()
ok(sk["ok"] and len(sk["skins"]) >= 1 and "iconPack" in sk["skins"][0], "skin-packs: every skin and the pack it names")
skin = sk["skins"][0]["id"]
ok(c.put(f"{B}/skin-packs/{skin}", json={"pack": "test-imported"}).json()["pack"] == "test-imported", "per-skin default set")
ok(next(k for k in c.get(f"{B}/skin-packs").json()["skins"] if k["id"] == skin)["draws"] == "test-imported", "skin-packs: the default is what the skin draws")
ok(c.put(f"{B}/skin-packs/{skin}", json={"pack": "no such pack at all"}).status_code == 404, "per-skin default: unknown pack 404")
d = c.delete(f"{B}/packs/imported/test-imported").json()
ok(d["ok"] and c.get(f"{B}/state").json()["pack"] == "" and skin not in c.get(f"{B}/state").json()["skinPacks"], "removing an imported pack drops it from the pack in force and the skin defaults")
ok(c.delete(f"{B}/skin-packs/{skin}").json()["cleared"] is False, "skin default clear is idempotent")
ok(c.put(f"{B}/hub-packs", json={"packs": [{"id": "shared-one", "name": "Shared one", "style": "outline", "themable": True, "by": "x"}, {"id": "BAD"}]}).json()["packs"] == 1, "hub-packs: the console's read of axHub, cleaned")
ok(c.get(f"{B}/hub-packs").json()["packs"][0]["id"] == "shared-one", "hub-packs listed")

raw = json.loads((DATA / "icons.json").read_text())
ok(raw["pack"] == "" and raw["slots"] == {} and len(raw["history"]) >= 6 and raw["hub"]["slots"], "the state file is the only thing written, with its history")
ok(not [f for f in DATA.iterdir() if f.name not in ("icons.json", "packs")], "nothing else in the data folder (icons.json + imported packs)")

chk = c.get(f"{B}/check").json()
ok(chk["ok"] is True and "slots" in chk and "failures" in chk, "check: the CI verdict")

print(f"icon-map server tests: {n} passed")
