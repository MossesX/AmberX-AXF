"""The held-prs systems-check item (server/held_prs_health.py, held-prs@1): the verdict from a `gate.mjs api held_prs` answer,
the Land now rows, the Auto fix that lands the PR held longest, and the registration.
  python3 apps/console-web/plugins/gate/test_held_prs.py
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("held_prs_health", HERE / "server" / "held_prs_health.py")
hp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hp)  # type: ignore[union-attr]

n = 0


def ok(cond: bool, what: str) -> None:
    global n
    if not cond:
        print(f"✗ {what}")
        sys.exit(1)
    n += 1


HELD = {"ok": True, "$axf": "held-prs@1", "at": "2026-11-18T10:00:00Z", "limitMin": 60, "count": 3, "over": [816, 704], "items": [
    {"pr": 816, "build": "orchestrator-live-demo", "title": "Orchestrator: live demo", "state": "held", "rule": "ui-review", "reviewFlag": "waiting",
     "holdReason": "its screenshots wait for Brett in UI Review", "heldSince": "2026-11-18T04:00:00Z", "heldMin": 360, "over": True, "link": "row:held-prs/pr:816"},
    {"pr": 704, "build": "dock", "title": "Dock sizes", "state": "kicked", "rule": "ci-green", "reviewFlag": "", "holdReason": "kicked out: broke CI", "heldSince": "2026-11-18T08:30:00Z", "heldMin": 90, "over": True, "link": "row:held-prs/pr:704"},
    {"pr": 705, "build": "shots", "title": "Phone shots", "state": "held", "rule": "", "reviewFlag": "", "holdReason": "it is a draft", "heldSince": "2026-11-18T09:50:00Z", "heldMin": 10, "over": False, "link": "row:held-prs/pr:705"},
]}

# ---- the verdict
v = hp.check(HELD)
ok(v["status"] == "error", "red once a PR is held past the limit")
ok("#816 (orchestrator-live-demo) has been held 6 h 00 and 1 more, longer than the 60 min limit" in v["summary"] and "Land now" in v["summary"], f"the summary names the PR held longest, how long, and the fix: {v['summary']}")
ok(len(v["details"]) == 2 and v["details"][0].startswith("#816 orchestrator-live-demo: held 6 h 00 since 2026-11-18 04:00 UTC (held) · UI Review waiting — its screenshots") and "#704 dock: held 90 min" in v["details"][1], f"one line per PR past the limit: {v['details']}")
ok(v["link"] == "view:gate/tab:gate.tabs=auto-lander" and "unmerged" in v["breaks"], "the item links to the Auto-lander tab and says what it breaks")
fix = v["fix"]
ok(fix["type"] == "prs" and fix["label"] == "Land now" and [x["pr"] for x in fix["items"]] == [816, 704], "the fix carries one Land now row per PR, longest held first")
row = fix["items"][0]
ok(row["action"] == "gate.land-now:816" and row["target"] == "row:held-prs/pr:816" and row["route"] == "POST /api/plugins/gate/land-now" and row["cli"] == "axf gate land-now 816" and row["reviewFlag"] == "waiting" and row["heldMin"] == 360, f"each row names its action, console-control address, REST route and CLI: {row}")

# ---- green and unknown
under = {**HELD, "over": [], "items": [{**x, "over": False} for x in HELD["items"]]}
g = hp.check(under)
ok(g["status"] == "ok" and g["summary"] == "3 PRs held by the lander, none older than 60 min." and len(g["details"]) == 3 and "fix" not in g, "green while nothing is past the limit; the held ones are still listed")
ok(hp.check({**HELD, "items": [], "over": []})["summary"] == "Nothing is held by the lander (alert after 60 min).", "nothing held = green, says the limit")
u = hp.check({"ok": False, "message": "the gate could not run"})
ok(u["status"] == "unknown" and u.get("unreachable") and "could not run" in u["summary"], "no answer = unknown, never red")
ok(hp.check({})["status"] == "unknown", "an empty answer is unknown")

# ---- the Auto fix lands the PR held longest, two steps done server-side
calls: list[tuple[int, str]] = []
r = hp.land_oldest(HELD, lambda pr, by: (calls.append((pr, by)), {"ok": True, "pr": pr, "position": 0, "via": "merge-queue"})[1])
ok(calls == [(816, "systems-check")] and r["state"] == "started" and "#816 is at the front of the merge queue" in r["message"] and r["link"] == "row:held-prs/pr:816", f"Auto fix lands #816 (held longest) with the override: {r}")
r2 = hp.land_oldest(HELD, lambda pr, by: {"ok": False, "code": "failed", "message": "the merge queue refused #816"})
ok(r2["state"] == "failed" and "refused" in r2["message"], "a refused landing is a failed fix with the reason")
ok(hp.land_oldest(under, lambda pr, by: {"ok": True})["state"] == "done", "nothing past the limit = nothing to land")

# ---- registration
class Reg:
    def __init__(self) -> None:
        self.spec: dict | None = None
        self.owner = ""

    def register(self, spec: dict, owner: str = "") -> str:
        self.spec, self.owner = spec, owner
        return spec["id"]


class Services:
    def __init__(self, reg: Reg | None) -> None:
        self.reg = reg

    def get(self, cap: str) -> Reg | None:
        return self.reg if cap == "axf.health@1" else None


reg = Reg()
ok(hp.ensure(Services(reg), lambda: HELD, lambda pr, by: {"ok": True}) is True and reg.owner == "gate", "registers with the health registry as the gate plugin")
ok(reg.spec["id"] == "held-prs" and reg.spec["service"] == "github" and reg.spec.get("push") is not False and reg.spec["autoFix"]["mode"] == "ask" and reg.spec["autoFix"]["label"] == "Land now (held longest)", "the check pushes once when red (push on) and its Auto fix asks first")
ok(reg.spec["run"]()["status"] == "error" and reg.spec["autoFix"]["run"]()["state"] == "started", "run and the fix go through the lambdas")
ok(any("axf gate land-now" in i and "POST /api/plugins/gate/land-now" in i and "gate_land_now" in i for i in reg.spec["instructions"]), "the instructions name the CLI, REST and MCP ways")
ok(hp.ensure(Services(None), lambda: HELD, lambda pr, by: {}) is False, "no health registry yet = not registered (asked again later)")

print(f"✓ held-prs — {n} checks")
