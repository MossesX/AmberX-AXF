#!/usr/bin/env python3
"""Self-test for the Pending banner plugin: the list, Queue / Hold / Archive / Send all to Queue on many ids, the
refusals, and the AmberX notice when a build lands in Pending. The dispatcher CLI is replaced by a fake with the same
answers, so nothing touches the real builds store.

    python3 apps/console-web/plugins/pending-banner/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
TMP = Path(tempfile.mkdtemp(prefix="axf-pending-banner-test-"))
os.environ["AXF_PENDING_BANNER_DIR"] = str(TMP / "data")
os.environ["AXF_PENDING_BANNER_NO_WATCH"] = "1"
os.environ["AXF_BUILDS_STORE"] = str(TMP / "store.json")
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

RAISED: list[dict] = []
RESOLVED: list[str] = []
cx.raise_alert = lambda a: RAISED.append(a) or a  # type: ignore[assignment]
cx.resolve_alerts = lambda keys: RESOLVED.extend(keys)  # type: ignore[assignment]

spec = importlib.util.spec_from_file_location("pending_banner_server", HERE / "server" / "__init__.py")
mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
spec.loader.exec_module(mod)  # type: ignore[union-attr]

fails = 0


def ok(cond: bool, what: str) -> None:
    global fails
    print(("✓ " if cond else "✗ ") + what)
    if not cond:
        fails += 1


# ---------------------------------------------------------------- fake dispatcher (pipeline.mjs --json)
BUILDS: dict[str, dict] = {}
CALLS: list[tuple] = []


def build(i: str, title: str, done: int = 0, total: int = 3, last=None, said: str = "", priority: str = "P1", notes=None, detail: str = ""):
    BUILDS[i] = {"id": i, "title": title, "status": "pending", "held": False, "done": done, "total": total, "last": last, "said": said,
                 "priority": priority, "notes": notes or [], "detail": detail}


def write_store() -> None:
    (TMP / "store.json").write_text(json.dumps({"builds": [{"id": b["id"], "notes": b["notes"], "detail": b["detail"]} for b in BUILDS.values()]}))


def fake(*args: str) -> dict:
    CALLS.append(args)
    cmd, rest = args[0], [a for a in args[1:] if not a.startswith("--")]
    if "--by" in args:
        rest = [a for a in rest if a != args[args.index("--by") + 1]]
    if "--why" in args:
        rest = [a for a in rest if a != args[args.index("--why") + 1]]
    if cmd == "tab":
        rows = [{"id": b["id"], "title": b["title"], "status": "pending", "priority": b["priority"], "said": b["said"],
                 "steps": {"done": b["done"], "total": b["total"]}, "minutesLeft": 10, "nextModel": "Opus", "nextStep": "s1 do it",
                 "pipeline": {"lastRun": b["last"]}, "createdAt": "2026-11-16T10:00:00Z"} for b in BUILDS.values() if b["status"] == "pending"]
        return {"ok": True, "tab": "pending", "rows": rows}
    if cmd == "queue":
        b = BUILDS.get(rest[0])
        if not b:
            raise HTTPException(404, f'no build "{rest[0]}"')
        if b["status"] != "pending":
            raise HTTPException(400, f"{b['id']} is {b['status']}: only a Pending build can be queued")
        b["status"] = "queued"
        return {"ok": True}
    if cmd in ("hold", "archive"):
        done, refused = [], []
        for i in rest:
            b = BUILDS.get(i)
            if not b or (cmd == "hold" and b["status"] != "queued"):
                refused.append({"id": i, "error": "refused"})
                continue
            if cmd == "hold":
                b["held"] = True
            else:
                b["status"] = "archived"
            done.append({"id": i, "status": b["status"], "tab": "queue" if cmd == "hold" else "archive"})
        return {"ok": True, "action": cmd, "done": done, "refused": refused}
    raise AssertionError(f"unexpected pipeline call {args}")


mod.pipeline = fake
app = FastAPI()
app.include_router(mod.router, prefix="/api/plugins/pending-banner")
c = TestClient(app)
P = "/api/plugins/pending-banner"

# ---------------------------------------------------------------- the list
build("alpha", "Alpha build", said="Make the alpha thing work.")
build("beta", "Beta build", done=2, total=5, last={"at": "2026-11-16T12:00:00Z", "outcome": "returned", "stepsLeft": 3, "account": "max-1"},
      notes=[{"text": "Queued by Brett.", "at": "x"}, {"text": "Back to Pending (dispatcher): the session ended with 3 steps left.", "at": "y"}], priority="High")
build("gamma", "Gamma build", detail="Adds a gamma. More words follow here.", priority="")
write_store()

r = c.get(f"{P}/list?fresh=true").json()
ok(r["count"] == 3 and [x["id"] for x in r["rows"]] == ["alpha", "beta", "gamma"], "list: every Pending build, in the orchestrator's order")
rows = {x["id"]: x for x in r["rows"]}
ok(rows["alpha"]["what"] == "Make the alpha thing work.", "what it does: Brett's own words first")
ok(rows["gamma"]["what"] == "Adds a gamma.", "what it does: else the first sentence of the detail")
ok(rows["beta"]["done"] == 2 and rows["beta"]["total"] == 5 and rows["beta"]["priority"] == "High", "steps done / total and priority")
ok(rows["beta"]["why"]["kind"] == "fell-back" and "returned on max-1 with 3 steps left" in rows["beta"]["why"]["text"] and "Back to Pending" in rows["beta"]["why"]["text"], "why it fell back: the last run and the orchestrator's note")
ok(rows["alpha"]["why"]["kind"] == "new", "a build that never ran is new")
ok(rows["alpha"]["actions"] == ["queue", "hold", "archive", "open"], "each row offers Queue, Hold, Archive, Open")

# ---------------------------------------------------------------- the moves
ok(c.post(f"{P}/queue", json={}).status_code == 400, "queue: no ids is refused")
ok(c.post(f"{P}/queue", json={"ids": ["Bad Id!"]}).status_code == 400, "queue: a bad id is refused before the dispatcher runs")
ok(c.post(f"{P}/hold", json={"all": True}).status_code == 400, "hold: `all` is only for Send all to Queue")

r = c.post(f"{P}/queue", json={"ids": ["alpha", "nope"]}).json()
ok([d["id"] for d in r["done"]] == ["alpha"] and r["refused"][0]["id"] == "nope" and BUILDS["alpha"]["status"] == "queued", "queue many: one refused never stops the others")
ok(r["pending"] == 2 and "queue: 1 done, 1 refused; 2 left in Pending" == r["line"], "queue: the answer says what is left")
ok("pending-banner:landed:alpha" in RESOLVED, "queue: its AmberX notice is resolved")

r = c.post(f"{P}/hold", json={"ids": ["gamma"], "why": "after the release"}).json()
ok(BUILDS["gamma"]["status"] == "queued" and BUILDS["gamma"]["held"] and r["done"][0].get("held"), "hold: into the Queue, on hold")
ok(any(a[0] == "hold" and "--why" in a for a in CALLS), "hold: the reason reaches the dispatcher")

build("delta", "Delta build")
build("eps", "Eps build")
write_store()
r = c.post(f"{P}/archive", json={"ids": ["delta"]}).json()
ok(BUILDS["delta"]["status"] == "archived" and r["done"][0]["id"] == "delta", "archive: Pending → Archive")

r = c.post(f"{P}/queue", json={"all": True}).json()
ok(sorted(d["id"] for d in r["done"]) == ["beta", "eps"] and r["pending"] == 0, "Send all to Queue: every Pending build goes, none left")
ok(c.get(f"{P}/list").json()["count"] == 0, "list: empty afterwards (the banner hides)")

# ---------------------------------------------------------------- AmberX: landed in Pending
RAISED.clear()
res = c.post(f"{P}/check").json()
ok(res.get("seeded") == 0 and not RAISED, "first check after an install records, never buzzes")
build("zeta", "Zeta build", said="Zeta, please.")
BUILDS["beta"]["status"] = "pending"  # fell back from a run
write_store()
res = c.post(f"{P}/check").json()
keys = {a["key"]: a for a in RAISED}
ok(sorted(res["raised"]) == ["beta", "zeta"] and set(keys) == {"pending-banner:landed:beta", "pending-banner:landed:zeta"}, "a build landing in Pending raises one notice each")
ok(keys["pending-banner:landed:beta"]["title"].startswith("Back in Pending") and keys["pending-banner:landed:beta"]["severity"] == "warning", "a fall-back says so, as a warning")
ok(keys["pending-banner:landed:zeta"]["title"].startswith("New in Pending") and "Zeta, please." in keys["pending-banner:landed:zeta"]["body"], "a new one says what it does")
ok(all(a["source"] == "pending-banner" and a["link"].startswith("action:pending-banner.open:") for a in RAISED), "notices are the registered source and open the build")
RAISED.clear()
c.post(f"{P}/check")
ok(not RAISED, "no second notice for the same build")
BUILDS["zeta"]["status"] = "queued"
RESOLVED.clear()
c.post(f"{P}/check")
ok("pending-banner:landed:zeta" in RESOLVED, "a build that left Pending another way has its notice resolved")

# ---------------------------------------------------------------- the registry and the manifest
notify = json.loads((HERE / "notify.json").read_text())
ok(any(t["match"]["source"] == mod.ALERT_SOURCE for t in notify["types"]), "notify.json names the alert source (notify-control registry)")
manifest = json.loads((HERE / "plugin.json").read_text())
ok(manifest["banner"] == ["pending"] and "banner:pending" in manifest["provides"], "plugin.json declares the banner")
web = (HERE / "web" / "index.tsx").read_text()
ok("settingsTab: 'pending-banner'" in web and "label: 'Pending builds'" in web and "useBannerLaunchOpen" in web, "joins the one Banners settings, launches expanded")
for a in ("open", "queue", "queue-all", "hold", "archive", "check"):
    ok(f"'pending-banner.{a}'" in web, f"action pending-banner.{a} (console control, voice)")

print(f"\n{'all passed' if not fails else f'{fails} failed'}")
sys.exit(1 if fails else 0)
