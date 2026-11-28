"""Sent plans through the server: the lock, the steps the orchestrator filed, and its actions on a plan or a step.

  python3 apps/console-web/plugins/plan-studio-2/server/test_orchestrate.py

Runs the real CLIs against a scratch builds store and a scratch tree (no git, no tmux, a fake launcher). The
orchestrator is found by its capability (axf.build-dispatch@1), never by folder name; skipped when no installed plugin
provides it. A tap goes: POST /orchestrate → the build is looked up in the builds store → the orchestrator decides.
"""
from __future__ import annotations

import asyncio
import json
import os
import stat
import sys
import tempfile
from importlib import import_module
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
PLUGINS = HERE.parent.parent
sys.path.insert(0, str(ROOT / "apps/console-web/server"))
sys.path.insert(0, str(PLUGINS))

from fastapi import HTTPException  # noqa: E402

import plugin_services  # noqa: E402

CAP = "axf.build-dispatch@1"
n = 0


def check(ok: bool, name: str) -> None:
    global n
    if not ok:
        raise SystemExit(f"✗ {name}")
    n += 1


class Req:
    def __init__(self, body: dict | None = None):
        self.state = SimpleNamespace(axf_user=SimpleNamespace(name="Brett", via="session", admin=True))
        self.headers: dict[str, str] = {}
        self._body = json.dumps(body or {}).encode()

    async def body(self) -> bytes:
        return self._body

    async def json(self) -> dict:
        return json.loads(self._body)


def call(fn, *a) -> tuple[int, dict | str]:
    try:
        r = fn(*a)
        return 200, asyncio.run(r) if asyncio.iscoroutine(r) else r
    except HTTPException as e:
        return e.status_code, str(e.detail)


def script(path: Path, text: str) -> str:
    path.write_text(text)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return str(path)


with tempfile.TemporaryDirectory() as d:
    tmp = Path(d)
    (tmp / "wt").mkdir()
    os.environ.update(
        AXF_BUILDS_STORE=str(tmp / "store.json"), AXF_PLAN_TREE_DIR=str(tmp / "tree"), AXF_BUILDS_LIVE="0", AXF_BUILD_HOOKS="off", AXF_BUILDS_EXPORT="0",
        AXF_DATA_DIR="off", AXF_SHIPPED="off", AXF_CREW_SAY="off", AXF_BUILD_LIMIT="off", AXF_PIPELINE_DIR=str(tmp / "pipe"), AXF_DISPATCH_DIR=str(tmp / "pipe"),
        AXF_SLOTS_DIR=str(tmp / "slots"), AXF_SLOTS_TMUX="off", AXF_BUILD_LOCK_TMUX="off", AXF_PIPELINE_CONSOLE="off", AXF_PIPELINE_WORKTREES=str(tmp / "wt"),
        AXF_PIPELINE_WORKTREE_MODE="mkdir", AXF_PIPELINE_LOCKED="1", AXF_PLAN_BUILDS_TTL="0", AXF_P2_SLOTS="4", AXF_P2_ALIVE="", AXF_P2_LANDER="off",
        AXF_P2_ACCOUNTS=json.dumps([{"name": "a", "usable": True, "free": 8, "running": 0, "usageLeft": 0.9}]),
        AXF_PIPELINE_LAUNCHER=script(tmp / "launcher.sh", '#!/bin/bash\nname=""\nwhile [ $# -gt 0 ]; do case "$1" in --name) name="$2"; shift 2;; --) break;; *) shift;; esac; done\necho "started axf-$name in $PWD"\n'),
        AXF_PIPELINE_SPLITTER=script(tmp / "no-fable.sh", '#!/bin/bash\necho "out of credits" >&2\nexit 1\n'),  # the split falls back to one step per planning step
    )
    ps = import_module(f"{HERE.parent.name}.server")

    # no orchestrator: the action answers 503, nothing else breaks
    plan = ps.run({"op": "add", "kind": "plan", "title": "Launch"})["item"]["id"]
    for title in ("Write the page", "Write the tests"):
        ps.run({"op": "add", "kind": "step", "title": title, "parent": plan})
    code, why = call(ps.orchestrate, Req({"id": plan, "action": "queue"}))
    check(code == 400 and "not sent to the orchestrator yet" in str(why), "an item that was not sent has no orchestrator actions (400)")
    code, why = call(ps.orchestrate, Req({"id": plan, "action": "explode"}))
    check(code == 400 and "action is one of" in str(why), "an unknown action is refused (400)")
    code, res = call(ps.build, Req({"id": plan}))
    check(code == 200 and res["build"]["id"] == "launch", "the plan is sent as one pending build")
    check(res.get("status") == "pending" and "in Pending" in str(res.get("say")), f"a send files the build in Pending, never in the Queue: {res}")

    # shipped-manifest@1 through the routes: an invalid one is refused (400, the fields named) and flags the plan
    good = {"$axf": "shipped-manifest@1", "id": "sm-launch", "rev": 1, "build": {"id": "launch", "title": "Launch"}, "said": {"text": "Ship the launch.", "verbatim": True}, "pr": {"number": 7}, "steps": []}
    code, why = call(ps.shipped, Req({"manifest": {**good, "said": {"text": ""}, "landedCommit": "nope"}}))
    check(code == 400 and "said.text" in str(why) and "landedCommit" in str(why), f"an invalid shipped manifest is refused with its field errors (400): {why}")
    code, res = call(ps.shipped_get, "launch")
    check(code == 200 and res["problem"] and res["shipped"] is None and res["item"] == plan, "the plan is flagged and carries no manifest; found by its build id")
    code, res = call(ps.shipped, Req({"manifest": good}))
    check(code == 200 and res["ok"] and res["item"]["shipped"]["build"]["id"] == "launch" and res["item"]["problem"] is None, "a valid one is stored on the plan it was sent from and clears the flag")
    code, why = call(ps.shipped, Req({"manifest": {**good, "build": {"id": "nobody-sent-this"}}}))
    check(code == 404, "a build no plan sent is a 404: nothing is synced into the tree")
    check(isinstance(ps.check_shipped().get("problems"), list) and ps.shipped_log()["entries"][-1]["ok"], "check-shipped and the receipt log answer")
    if plugin_services.get(CAP) is None:
        code, why = call(ps.orchestrate, Req({"id": plan, "action": "queue"}))
        check(code == 503 and "switched off or not installed" in str(why), "without the orchestrator's capability an action answers 503")

    # the plugin that provides the capability (found by what it provides, never by name)
    provider = next((p.name for p in sorted(PLUGINS.iterdir()) if (p / "server/__init__.py").exists() and f'plugin_services.provide("{CAP}"' in (p / "server/__init__.py").read_text()), None)
    if provider is None:
        print(f"plan-studio-2 orchestrate: {n} checks passed (no plugin provides {CAP}: the rest is skipped)")
        raise SystemExit(0)
    import_module(f"{provider}.server")
    check(hasattr(plugin_services.get(CAP), "act"), f"{CAP} offers act()")

    def rows() -> list[dict]:
        return ps.state()["items"]

    def row(title: str) -> dict:
        return next(i for i in rows() if i["title"] == title)

    # the lock, through the routes
    check(row("Launch").get("locked") is True and row("Launch")["live"]["state"] == "sent" and row("Write the page")["live"]["state"] == "sent", "sent: locked, shown as Sent to orchestrator")
    code, why = call(ps.edit, Req({"id": plan, "patch": {"title": "Renamed"}}))
    check(code == 409 and "locked until the build lands or is cancelled" in str(why), "editing a sent plan answers 409 with the reason")
    code, why = call(ps.add, Req({"kind": "step", "title": "One more", "parent": plan}))
    check(code == 409, "adding to a sent plan answers 409")
    code, why = call(ps.delete_item, "Write the page", Req())
    check(code == 409, "deleting a step of a sent plan answers 409")

    # queue: the orchestrator splits it and starts it; Plan Studio lists what it filed
    code, res = call(ps.orchestrate, Req({"id": plan, "action": "queue"}))
    check(code == 200 and res["build"] == "launch" and res["action"] == "queue" and "active place" in res["say"], f"queue goes to the orchestrator, which moves the build on: {res}")
    orch = [i for i in rows() if i.get("origin") == "orchestrator"]
    check([i["title"] for i in orch] == ["Write the page", "Write the tests"] and all(i["live"]["build"] == "launch" and i["locked"] for i in orch), "the orchestrator's steps are listed, marked From orchestrator")
    check(len([i for i in rows() if i["title"] == "Write the page"]) == 1 and not json.loads((tmp / "tree/tree.json").read_text())["items"][0].get("origin"), "the sent planning steps were replaced; the tree stores none of the orchestrator's")
    check(all(i["live"]["state"] == "building" and not i["done"] for i in orch) and row("Launch")["live"]["state"] == "building", "live: the steps are Building")
    check([h["steps"][0]["title"] for h in ps.history(plan)["history"]] == ["Write the page"], "the planning steps are kept in the plan's history")

    # a tap that does not fit is refused by the orchestrator, with its reason
    code, why = call(ps.orchestrate, Req({"id": plan, "action": "hold"}))
    check(code == 400 and "only a build still waiting its turn" in str(why), f"hold on a build that is being built is refused by the orchestrator: {why}")
    code, why = call(ps.orchestrate, Req({"id": orch[0]["id"], "action": "rebuild"}))
    check(code == 400 and "only a failed step is built again" in str(why), "an action on a step row names that step")
    code, why = call(ps.restore_steps, Req({"id": plan}))
    check(code == 409, "the planning steps are not brought back while the plan is locked")

    # cancel: out of the flow, the plan unlocks and its planning steps are back at once
    code, res = call(ps.orchestrate, Req({"id": orch[1]["id"], "action": "cancel", "why": "changed my mind"}))
    check(code == 200 and res["status"] == "archived" and res["step"] == "s2", "cancel from a step row cancels its build")
    after = rows()
    check(sorted(i["title"] for i in after) == ["Launch", "Write the page", "Write the tests"] and not any(i.get("locked") or i.get("origin") or i.get("live") for i in after), "cancelled: unlocked, the orchestrator's steps gone, the planning steps back")
    code, res = call(ps.edit, Req({"id": plan, "patch": {"title": "Launch again"}}))
    check(code == 200 and res["item"]["title"] == "Launch again", "and it can be edited again")

print(f"plan-studio-2 orchestrate: {n} checks passed")
