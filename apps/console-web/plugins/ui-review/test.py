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

print(f"ui-review: {ok} checks ok" + (f", {len(fails)} failed" if fails else ""))
sys.exit(1 if fails else 0)
