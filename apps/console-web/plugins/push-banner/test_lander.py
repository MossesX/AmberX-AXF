#!/usr/bin/env python3
"""Self-test for the push banner's server lander (server/lander.py): the gate, the alerts and the retry ladder,
with a fake Pushes (no GitHub, no console).

    python3 apps/console-web/plugins/push-banner/test_lander.py
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from fastapi import HTTPException

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("push_banner_lander", HERE / "server" / "lander.py")
L = importlib.util.module_from_spec(spec)
spec.loader.exec_module(L)

ok = 0


def check(cond: bool, what: str) -> None:
    global ok
    if not cond:
        print(f"FAIL: {what}")
        sys.exit(1)
    ok += 1
    print(f"  ✓ {what}")


R = "MossesX/axHub"
K = f"{R}#5"


class FakePushes:
    def __init__(self) -> None:
        self.refuse: list[tuple[int, str]] = []
        self.calls: list[str] = []
        self.queued = False

    def merge(self, body, wait_ui=True):
        self.calls.append("merge")
        if body.get("confirm") != f"{body['repo']}#{body['number']}":
            raise HTTPException(400, "confirm")
        if self.refuse:
            code, why = self.refuse.pop(0)
            raise HTTPException(code, why)
        return {"merged": not self.queued, "queued": self.queued}

    def update(self, body):
        self.calls.append("pull")
        return {"updated": True}

    def claude_fix(self, body):
        self.calls.append("resolve")
        return {"job": {"state": "waiting"}}


store: dict = {}
alerts: list[dict] = []
resolved: list[str] = []
clock = {"t": 1_000_000.0}
P = FakePushes()
lander = L.Lander(P, read=lambda: store.get("d"), write=lambda d: store.__setitem__("d", d), alert=alerts.append,
                  resolve=resolved.extend, clock=lambda: clock["t"])
lander.rerun = lambda repo, head: (P.calls.append("rerun"), "re-ran 1 run")[1]


def item():
    return lander._items().get(K) or {}


def facts(**kw):
    base = {"state": "open", "draft": False, "head": "aaa111", "behind": 0, "mergeable": True, "ci": "success", "failing": [], "held": "", "queued": False}
    base.update(kw)
    return lambda repo, n: base


print("server lander self-test")

# ---- classify
check(L.classify(409, "it's behind main: pull main in first")["kind"] == "behind", "behind is classified")
check(L.classify(409, "GitHub can't merge it: it has conflicts")["kind"] == "conflict", "conflicts are classified")
check(L.classify(409, "its CI failed. Handed to Claude")["kind"] == "ci-failed", "red CI is classified")
check(L.classify(409, "held by UI Review (waiting): Brett approves")["kind"] == "held", "a UI Review hold is classified")
check(L.classify(400, "confirm with ...")["retry"] is False, "a bad request is not a merge failure")
check(L.classify(502, "boom")["kind"] == "github", "anything else is a GitHub refusal")

# ---- the gate: a bad request is not tracked, a failure alerts at once
try:
    lander.attempt(R, 5, "console", confirm="nope")
except HTTPException as e:
    check(e.status_code == 400, "the caller still sees the refusal")
check(not alerts and not lander._items(), "a bad request raises no alert and isn't on the ladder")

P.refuse = [(409, "its CI failed")]
try:
    lander.attempt(R, 5, "cli")
    check(False, "a refused merge raises")
except HTTPException as e:
    check(e.status_code == 409 and "CI failed" in str(e.detail), "the refusal is raised again unchanged")
a = alerts[-1]
check(a["key"] == f"merge:{K}" and a["severity"] == "error" and a["meta"]["notifyType"] == "merge.failed", "a failure raises a phone alert at once (merge.failed, error)")
check("its CI failed" in a["body"] and "(cli)" in a["body"] and "re-run" in a["body"], "the alert says what failed, why, who asked and what comes next")
check(item()["state"] == "retrying" and item()["via"] == "cli" and item()["attempts"][-1]["ok"] is False, "the PR is on the ladder with the attempt logged")

# ---- ladder: red CI → rerun once → Claude → stuck with what's missing
n_alerts = len(alerts)
out = lander.round(facts(ci="failure", failing=["Python tests"]))
check(out[0]["do"] == "rerun" and P.calls[-1] == "rerun", "red CI: the failed jobs are re-run once")
fyi = alerts[-1]
check(fyi["key"] == f"merge-fyi:{K}" and fyi["severity"] == "info" and fyi["meta"]["notifyType"] == "merge.retry", "each attempt is sent as an FYI (info, never buzzes)")
check(item()["attempts"][-1]["rung"] == "rerun", "each attempt is logged on the PR")
out = lander.round(facts(ci="failure", failing=["Python tests"]))
check(out[0]["do"] == "resolve" and P.calls[-1] == "resolve", "still red after the re-run: handed to Claude Code")
out = lander.round(facts(ci="failure", failing=["Python tests"]))
check("wait" in out[0], "the hand-over gets time to push a fix")
clock["t"] += L.RESOLVE_WAIT_S + 1
out = lander.round(facts(ci="failure", failing=["Python tests"]))
check(out[0].get("stop") == "stuck" and "Python tests" in out[0]["missing"][0], "every way failed: stuck, with exactly what is missing")
st = alerts[-1]
check(st["key"] == f"merge:{K}" and st["severity"] == "error" and "Missing:" in st["body"] and "rerun x1" in st["body"], "the stuck alert says what was tried and what is missing")
check(item()["state"] == "stuck" and lander.round(facts()) == [], "a stuck PR leaves the ladder until retried")

# ---- a new head (a fix was pushed) after retry: green → merge → resolved
lander.retry(R, 5)  # runs one step with self.facts: give it ours instead
check(item()["state"] in ("retrying", "stuck"), "retry by hand puts it back on the ladder")
lander._save({**lander._items(), K: {**item(), "state": "retrying", "tries": {}, "head": "aaa111"}})
P.refuse = []
out = lander.round(facts(head="bbb222"))
check(out[0]["do"] == "merge" and out[0]["ok"] and item()["state"] == "merged", "new head, green: merged on the next round")
check(any(x["rung"] == "head" for x in item()["attempts"]), "a new head starts the ladder again")
check(f"merge:{K}" in resolved and "Merged after" in alerts[-1]["body"], "merged: the alert is resolved and one FYI says so")

# ---- behind → pull; conflicts → Claude; blocked on UI Review told once and resumed
K2 = f"{R}#6"
P.refuse = [(409, "it's behind main: pull main in first")]
try:
    lander.attempt(R, 6, "auto-merge")
except HTTPException:
    pass
out = lander.round(facts(behind=3), only=K2)
check(out[0]["do"] == "pull" and P.calls[-1] == "pull", "behind main: main is pulled in")
out = lander.round(facts(mergeable=False), only=K2)
check(out[0]["do"] == "resolve", "conflicts: handed to Claude Code")
n = len(alerts)
lander.round(facts(held="waiting"), only=K2)
lander.round(facts(held="waiting"), only=K2)
blocked = [x for x in alerts[n:] if x["title"].startswith("Merge blocked")]
check(len(blocked) == 1 and "UI Review" in blocked[0]["body"], "blocked on UI Review: told once, with what is missing")
check(lander._items()[K2]["state"] == "blocked", "blocked is its own state")
out = lander.round(facts(mergeable=None, ci="running"), only=K2)
check("wait" in out[0] and lander._items()[K2]["state"] == "retrying", "the hold lifts: the ladder carries on by itself")
clock["t"] += L.WAIT_CI_S + 1
out = lander.round(facts(mergeable=None, ci="running"), only=K2)
check(out[0].get("stop") == "stuck" and "CI to finish" in out[0]["missing"][0], "CI that never finishes ends stuck, saying so")

# ---- merge rung refused every time
K3 = f"{R}#7"
P.refuse = [(502, "GitHub said no")] * (L.LIMITS["merge"] + 1)
try:
    lander.attempt(R, 7, "mcp")
except HTTPException:
    pass
for _ in range(L.LIMITS["merge"]):
    lander.round(facts(), only=K3)
out = lander.round(facts(), only=K3)
check(out[0].get("stop") == "stuck" and "refused" in out[0]["missing"][0], "a green PR GitHub keeps refusing: stuck after the merge limit")

# ---- queue kicks join the ladder once each; a merged PR on GitHub ends it
n = len(alerts)
kicks = [{"pr": 8, "at": "2026-11-13T10:00:00Z", "why": "batch CI red: Python tests", "title": "x"}]
check(lander.ingest_kicks(R, kicks) == 1 and lander.ingest_kicks(R, kicks) == 0, "a queue kick is taken once")
check(alerts[n]["key"] == f"merge:{R}#8" and "merge queue kicked" in alerts[n]["body"], "a kick alerts at once")
out = lander.round(facts(state="merged"), only=f"{R}#8")
check(out[0].get("stop") == "merged" and lander._items()[f"{R}#8"]["state"] == "merged", "merged on GitHub: off the ladder")

# ---- queued repo: a retry merge puts it back in the queue and waits
K4 = f"{R}#9"
P.refuse, P.queued = [(409, "its CI failed")], True
try:
    lander.attempt(R, 9, "console")
except HTTPException:
    pass
lander._save({**lander._items(), K4: {**lander._items()[K4], "tries": {"rerun": 1, "resolve": 1}}})
out = lander.round(facts(), only=K4)
check(out[0]["do"] == "merge" and out[0]["text"] == "put in the merge queue", "merge queue repo: the retry re-queues it")
out = lander.round(facts(queued=True), only=K4)
check("wait" in out[0], "queued: waits for its batch")

# ---- forget + state
check(lander.forget(R, 9)["removed"] and K4 not in lander._items(), "forget takes it off and clears its alerts")
s = lander.state()
check(s["$axf"] == "merge-lander@1" and s["counts"].get("stuck", 0) >= 2 and s["limits"] == L.LIMITS, "state: items, counts per state and the limits")

print(f"server lander: {ok} checks passed")
