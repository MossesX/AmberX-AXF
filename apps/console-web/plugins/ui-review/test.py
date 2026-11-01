#!/usr/bin/env python3
"""Self-test for the UI Review plugin (routes through FastAPI's test client, scratch data folder).

Covers: migration of the old Design packs data folder, kinds, submit (base64 shots), items, shots, decide (single,
bulk, design packs), remove, picks, state per branch / PR and the ui-review@1 capability.

    python3 apps/console-web/plugins/ui-review/test.py
"""
from __future__ import annotations

import base64
import importlib.util
import json
import os
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
TMP = Path(tempfile.mkdtemp(prefix="axf-ui-review-test-"))
os.environ["AXF_UI_REVIEW_DIR"] = str(TMP / "ui-review")
os.environ["AXF_UI_REVIEW_OLD_DIR"] = str(TMP / "design-packs")
# the old Design packs data folder, with Brett's picks: migrated on import
(TMP / "design-packs").mkdir()
(TMP / "design-packs" / "picks.json").write_text(json.dumps({"picked": ["graphite-pro", "amber-noir"], "at": "2026-10-29T20:00:00Z"}))

sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.ui_review_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
ok = 0
fails: list[str] = []


def check(cond: bool, what: str) -> None:
    global ok
    if cond:
        ok += 1
    else:
        fails.append(what)
        print("FAIL", what)


# ---- migration
check(not (TMP / "design-packs").exists(), "old Design packs data folder removed after migration")
check(c.get("/p/picks").json()["picked"] == ["graphite-pro", "amber-noir"], "picks migrated into the UI Review data folder")
check((TMP / "ui-review" / "migrated.json").exists(), "migration leaves a note")
check(mod.migrate() == {"migrated": False}, "migration runs once")

# ---- kinds + packs
k = c.get("/p/kinds").json()
check([x["id"] for x in k["base"]][:2] == ["design-pack", "app"] and len(k["base"]) == 8, "kinds registry has the 8 sections")
(TMP / "ui-review" / "kinds.json").write_text(json.dumps({"kinds": [{"id": "home-card", "label": "Home cards"}]}))
check(c.get("/p/kinds").json()["extra"][0]["id"] == "home-card", "data-folder kinds add sections without code")
it = c.get("/p/items").json()
check(len(it["packs"]["packs"]) == 18 and all(len(p["files"]) == 12 for p in it["packs"]["packs"]), "18 design packs, 12 shots each")
check(it["items"] == [] and it["picks"]["picked"] == ["graphite-pro", "amber-noir"], "items start empty; picks come with them")
first = it["packs"]["packs"][0]["files"][0]["src"]
r = c.get("/p/shot", params={"path": first})
check(r.status_code == 200 and r.headers["content-type"] == "image/png", "pack screenshot served")
check(c.get("/p/shot", params={"path": "../plugin.json"}).status_code == 400, "bad shot path refused")
check(c.get("/p/shot", params={"path": "items/x/../../items.json"}).status_code == 400, "traversal refused")

# ---- submit
png = (HERE / "packs" / first).read_bytes()
b64 = base64.b64encode(png).decode()
r = c.post("/p/submit", json={"kind": "settings", "title": "Level bar", "app": "Console", "branch": "claude/t", "pr": "#42",
                              "files": [{"name": "settings-phone.png", "data": b64}, {"name": "settings-desktop.png", "data": "data:image/png;base64," + b64}]})
check(r.status_code == 200, f"submit ok ({r.status_code} {r.text[:200]})")
item = r.json()["item"]
check(item["status"] == "waiting" and item["pr"] == 42 and item["source"] == "api", "submitted item waiting, PR parsed")
check([s["device"] for s in item["shots"]] == ["phone", "desktop"], "devices from file names")
check(c.get("/p/shot", params={"path": item["shots"][0]["src"]}).status_code == 200, "submitted screenshot served")
check(c.post("/p/submit", json={"kind": "Bad Kind", "title": ""}).status_code == 400, "bad kind / no title refused")
check(c.post("/p/submit", json={"title": "x", "files": [{"name": "a.png", "data": base64.b64encode(b"not an image").decode()}]}).status_code == 400, "non-image refused")
r2 = c.post("/p/submit", json={"kind": "walkthrough", "title": "Molly steps", "branch": "claude/t"}).json()["item"]
check(r2["kind"] == "walkthrough", "a kind nobody listed is accepted (its own section)")

# ---- state + capability
s = c.get("/p/state", params={"pr": "42"}).json()
check(s["state"] == "waiting" and s["holds"] and s["counts"]["waiting"] == 1, "state: waiting holds")
check(c.get("/p/state").status_code == 400, "state needs a branch or PR")
svc = plugin_services.get("ui-review@1")
check(svc is not None and svc.holds("claude/t") is True, "capability ui-review@1 provided, holds the branch")
check(len(svc.items(branch="claude/t")) == 2, "capability lists a branch's items")

# ---- decide (single, bulk, packs) + history
r = c.post("/p/decide", json={"ids": [item["id"]], "decision": "changes", "comment": "tighter"}).json()
check(r["changed"] == [item["id"]], "decide one")
check(svc.state(pr=42)["state"] == "changes", "changes asked still holds")
r = c.post("/p/decide", json={"ids": [item["id"], r2["id"], "pack:graphite-pro", "nope"], "decision": "approve"}).json()
check(sorted(r["changed"]) == sorted([item["id"], r2["id"], "pack:graphite-pro"]) and r["missing"] == ["nope"], "bulk decide incl. a design pack")
s = svc.state("claude/t")
check(s["state"] == "approved" and not s["holds"], "all approved: no hold")
got = {x["id"]: x for x in c.get("/p/items").json()["items"]}
check([h["action"] for h in got[item["id"]]["history"]] == ["submitted", "changes", "approve"], "history kept")
check(c.get("/p/items").json()["overlay"]["pack:graphite-pro"]["status"] == "approved", "design-pack decision saved as overlay")
check(c.post("/p/decide", json={"ids": [item["id"]], "decision": "maybe"}).status_code == 400, "unknown decision refused")
c.post("/p/decide", json={"ids": [r2["id"]], "decision": "reject"})
check(svc.state("claude/t")["state"] == "rejected", "rejected wins")

# ---- picks + remove
check(c.put("/p/picks", json={"picked": ["a", "b", "c"]}).json()["picked"] == ["a", "b", "c"], "picks saved")
check(c.put("/p/picks", json={"picked": ["../x"]}).status_code == 400, "bad pick refused")
check(c.post("/p/remove", json={"ids": ["pack:graphite-pro"]}).status_code == 400, "design packs can't be removed")
c.post("/p/remove", json={"ids": [item["id"]]})
check(item["id"] not in {x["id"] for x in c.get("/p/items").json()["items"]} and not (TMP / "ui-review" / "shots" / item["id"]).exists(), "remove drops the item and its shots")

# ---- Screenshots (ui-screenshot@1): own store, never in the approve / reject queue
queue_before = [x["id"] for x in c.get("/p/items").json()["items"]]
r = c.post("/p/shots", json={"title": "Breakroom home", "app": "Breakroom", "screen": "/breakroom", "source": "check", "session": "sess-1",
                             "viewport": "phone", "pair": "BR 1", "data": "data:image/png;base64," + b64, "branch": "claude/shots", "pr": "77"})
check(r.status_code == 200, f"screenshot upload (base64 JSON) ok ({r.status_code} {r.text[:200]})")
sa = r.json()["shots"][0]
check(sa["source"] == "check" and sa["viewport"] == "phone" and sa["pair"] == "br-1" and sa["side"] == "before" and sa["pr"] == 77, "fields kept, pair cleaned, first of a pair is before")
check(sa["file"].endswith(".png") and (TMP / "ui-review" / "screenshots" / "files" / sa["file"]).exists(), "file on the data volume (screenshots/files)")
# multipart (curl -F) with no title: from the file name; second of the pair = after
bnd = "axfboundary"
mp = (f"--{bnd}\r\nContent-Disposition: form-data; name=\"app\"\r\n\r\nBreakroom\r\n"
      f"--{bnd}\r\nContent-Disposition: form-data; name=\"pair\"\r\n\r\nbr-1\r\n"
      f"--{bnd}\r\nContent-Disposition: form-data; name=\"source\"\r\n\r\npr\r\n"
      f"--{bnd}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"breakroom-home-desktop.png\"\r\nContent-Type: image/png\r\n\r\n").encode() + png + f"\r\n--{bnd}--\r\n".encode()
r = c.post("/p/shots", content=mp, headers={"content-type": f"multipart/form-data; boundary={bnd}"})
check(r.status_code == 200, f"multipart upload ok ({r.status_code} {r.text[:200]})")
sb = r.json()["shots"][0]
check(sb["title"] == "Breakroom home" and sb["viewport"] == "desktop" and sb["side"] == "after" and sb["source"] == "pr", "multipart: title + device from the file name, second of a pair is after")
check(c.post("/p/shots", json={"title": "x", "data": base64.b64encode(b"GIF89a....").decode()}).status_code == 400, "non-image screenshot refused")
check(c.post("/p/shots", json={"title": "x"}).status_code == 400, "upload without a picture refused")
check(c.post("/p/shots", json={"title": "x", "pr": "abc", "data": b64}).status_code == 400, "bad PR refused")
lst = c.get("/p/shots").json()
check([x["id"] for x in lst["shots"]] == [sa["id"], sb["id"]] and {x["id"] for x in lst["sources"]} >= {"build", "check", "pr", "manual", "watch-live"}, "list + sources")
check([x["id"] for x in c.get("/p/items").json()["items"]] == queue_before, "screenshots never enter the approve / reject queue")
check(c.get("/p/state", params={"pr": "77"}).json()["state"] == "none" and not svc.holds("claude/shots"), "a screenshot never holds a PR")
r = c.get("/p/shots/file", params={"id": sa["id"]})
check(r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content == png, "screenshot served")
check(c.get("/p/shots/file", params={"id": "../items.json"}).status_code == 404, "bad screenshot id refused")
r = c.post("/p/shots/update", json={"id": sa["id"], "note": "the clock overlaps", "file": "../../x.png", "screen": "/breakroom/home"}).json()["shot"]
check(r["note"] == "the clock overlaps" and r["screen"] == "/breakroom/home" and r["file"] == sa["file"], "update edits fields, never the file")
# send to review: a normal review item with the picture copied; the screenshot stays
r = c.post("/p/shots/promote", json={"ids": [sa["id"]], "kind": "screen"})
check(r.status_code == 200, f"promote ok ({r.status_code} {r.text[:200]})")
pit = r.json()["items"][0]
check(pit["status"] == "waiting" and pit["title"] == "Breakroom home" and pit["fromShot"] == sa["id"] and pit["shots"][0]["device"] == "phone", "Send to review makes a waiting review item")
check(c.get("/p/shot", params={"path": pit["shots"][0]["src"]}).status_code == 200, "promoted picture copied into the review item")
check(c.get("/p/state", params={"pr": "77"}).json()["state"] == "waiting", "the promoted item holds its PR like any review item")
check(any(x["id"] == sa["id"] and x["promoted"] == [pit["id"]] for x in c.get("/p/shots").json()["shots"]), "screenshot stays, remembers the review item")
check(c.post("/p/shots/promote", json={"ids": ["nope"]}).status_code == 404, "promote unknown refused")
c.post("/p/remove", json={"ids": [pit["id"]]})

# ---- migration: "Breakroom check:" review items move into Screenshots
bc = c.post("/p/submit", json={"kind": "screen", "title": "Breakroom check: home", "app": "Breakroom", "build": "check-1",
                               "files": [{"name": "home-phone.png", "data": b64}, {"name": "home-desktop.png", "data": b64}]}).json()["item"]
keep = c.post("/p/submit", json={"kind": "screen", "title": "Breakroom lobby (real review)"}).json()["item"]
r = c.post("/p/shots/migrate").json()
check(r["moved"] == [bc["id"]] and len(r["shots"]) == 2, "migrate moves the check item, one screenshot per picture")
ids_now = [x["id"] for x in c.get("/p/items").json()["items"]]
check(bc["id"] not in ids_now and keep["id"] in ids_now and not (TMP / "ui-review" / "shots" / bc["id"]).exists(), "check item + its folder gone, real review items kept")
moved = [x for x in c.get("/p/shots").json()["shots"] if x.get("migratedFrom") == bc["id"]]
check(len(moved) == 2 and all(x["source"] == "check" and x["app"] == "Breakroom" for x in moved) and {x["viewport"] for x in moved} == {"phone", "desktop"}, "migrated screenshots: source check, app, devices")
check(all(c.get("/p/shots/file", params={"id": x["id"]}).status_code == 200 for x in moved), "migrated pictures served")
check(c.post("/p/shots/migrate").json()["moved"] == [], "migration is idempotent")
check((TMP / "ui-review" / "screenshots" / "migrated.json").exists(), "migration leaves a note")

# ---- remove
c.post("/p/shots/remove", json={"ids": [sb["id"]]})
check(sb["id"] not in {x["id"] for x in c.get("/p/shots").json()["shots"]} and not (TMP / "ui-review" / "screenshots" / "files" / sb["file"]).exists(), "delete drops record + file")
check(c.post("/p/shots/remove", json={"ids": ["../x"]}).status_code == 400, "bad ids refused")

# ---- intake auth through the real console (token required; plugin routes mounted by main.py)
import subprocess  # noqa: E402
auth_script = r"""
import os, sys, tempfile, base64
from pathlib import Path
t = tempfile.mkdtemp()
os.environ.update(AXF_STATE=str(Path(t) / "state.json"), AXF_DATA_DIR="off", AXF_TOKEN="k" * 32, AXF_UI_REVIEW_DIR=str(Path(t) / "ui"))
sys.path.insert(0, sys.argv[1])
from fastapi.testclient import TestClient
import main
c = TestClient(main.app, raise_server_exceptions=False)
png = open(sys.argv[2], "rb").read()
body = {"title": "auth", "data": base64.b64encode(png).decode()}
a = c.post("/api/plugins/ui-review/shots", json=body).status_code
b = c.post("/api/plugins/ui-review/shots", json=body, headers={"Authorization": "Bearer wrong"}).status_code
g = c.get("/api/plugins/ui-review/shots").status_code
ok = c.post("/api/plugins/ui-review/shots", json=body, headers={"Authorization": "Bearer " + "k" * 32})
items = c.get("/api/plugins/ui-review/items", headers={"Authorization": "Bearer " + "k" * 32}).json()["items"]
print(a, b, g, ok.status_code, ok.json()["shots"][0]["by"], len(items))
"""
pr_ = subprocess.run([sys.executable, "-c", auth_script, str(HERE.parent.parent / "server"), str(HERE / "packs" / first)], capture_output=True, text=True, cwd=str(HERE.parent.parent / "server"), timeout=300)
last = (pr_.stdout.strip().splitlines() or [""])[-1].split()
check(last[:3] == ["401", "401", "401"], f"intake refuses no token / a wrong token, reads too ({last} {pr_.stderr[-300:]})")
check(last[3:6] == ["200", "console-token", "0"], f"intake takes the console token, records who, review queue untouched ({last})")

print(f"ui-review: {ok} checks ok" + (f", {len(fails)} failed" if fails else ""))
sys.exit(1 if fails else 0)
