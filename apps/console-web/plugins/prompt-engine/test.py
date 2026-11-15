"""Prompt engine plugin — server routes over a temp data folder: state, templates, fire → waiting → answer, validation
status codes, delete needs confirm, tool sets (a tool outside the set is 403), direct runs of tools / macros / pipelines
(a gate waits and the answer resumes the same run record), run records, options, history, the webhook, the capability,
and delivery of what the engine hands back (waiting prompts and keys-needed items reach the alert hub; the decision
dialog is used when a plugin provides it).

    python apps/console-web/plugins/prompt-engine/test.py
"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "server"))
os.environ["AXF_PROMPT_ENGINE_DIR"] = tempfile.mkdtemp()
os.environ["AXF_PROMPT_ENGINE_TICK"] = "0"

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

alerts: list[dict] = []
resolved: list[str] = []
cx.set_context(raise_alert=lambda inp: alerts.append(inp) or {}, resolve_alerts=lambda keys: resolved.extend(keys))

spec = importlib.util.spec_from_file_location("prompt_engine_server", HERE / "server" / "__init__.py")
srv = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(srv)

app = FastAPI()
app.include_router(srv.router, prefix="/api/plugins/prompt-engine")
c = TestClient(app)
API = "/api/plugins/prompt-engine"
checks = 0


def ok(v: object, what: str) -> None:
    global checks
    assert v, what
    checks += 1


r = c.get(f"{API}/")
ok(r.status_code == 200 and r.json()["counts"]["rules"] == 0, "state starts empty")
ok(r.json()["registry"]["events"] > 20, "the built-in registry is there")

r = c.get(f"{API}/templates")
ok(r.status_code == 200 and any(t["id"] == "build-failed-retry" for t in r.json()["items"]), "templates listed")
r = c.post(f"{API}/templates/build-failed-retry/use", json={})
ok(r.status_code == 200 and r.json()["rule"]["id"] == "build-failed-retry", "a rule from a template")
r = c.post(f"{API}/templates/build-failed-retry/use", json={})
ok(r.status_code == 400, "the same id twice is refused with 400")
r = c.post(f"{API}/templates/nope/use", json={})
ok(r.status_code == 404, "unknown template is 404")

r = c.post(f"{API}/rules", json={"title": "bad"})
ok(r.status_code == 400 and r.json()["detail"]["errors"][0]["field"] == "trigger.event", "validation names the field, 400")
r = c.post(f"{API}/rules", json={"id": "shipped", "title": "Shipped", "trigger": {"event": "build.shipped"}, "ask": {"kind": "none"},
                                 "on": {"fire": [{"action": "notify.push", "input": {"title": "Shipped {{build.id}}"}}, {"action": "notify.sms", "input": {"text": "x"}}]}})
ok(r.status_code == 200 and r.json()["rule"]["enabled"] is True, "a rule added")
r = c.get(f"{API}/rules/shipped")
ok(r.status_code == 200 and r.json()["summary"].startswith("On Build shipped"), "one rule with its summary")
r = c.post(f"{API}/rules/shipped/update", json={"title": "Shipped!"})
ok(r.status_code == 200 and r.json()["rule"]["title"] == "Shipped!", "update keeps the rest")
r = c.post(f"{API}/rules/shipped/disable")
ok(r.json()["rule"]["enabled"] is False, "disable")
r = c.post(f"{API}/rules/shipped/enable")
ok(r.json()["rule"]["enabled"] is True, "enable")
r = c.post(f"{API}/rules/shipped/delete", json={"confirm": "nope"})
ok(r.status_code == 409, "delete without the right confirm is 409")

# fire: a failed build asks → alert raised (push), waiting lists it, answer resolves the alert and runs the branch
alerts.clear()
r = c.post(f"{API}/fire", json={"source": "builds", "event": "build.status", "payload": {"build": {"id": "b1", "title": "Grid", "status": "failed"}}})
ok(r.status_code == 200 and r.json()["fired"] == [{"rule": "build-failed-retry", "asks": True}], "fire asks")
ok(r.json()["delivered"][0]["kind"] == "ask" and r.json()["delivered"][0]["alert"] is True, "the prompt reached the alert hub")
ok(alerts and alerts[0]["source"] == "prompt-engine" and "Options: 1. Queue it again" in alerts[0]["body"], "the alert carries the options")
ok(alerts[0]["link"].startswith("/?axf-view=prompt-engine&prompt="), "the alert deep-links to the waiting prompt")
r = c.get(f"{API}/waiting")
ok(r.status_code == 200 and r.json()["count"] == 1 and r.json()["items"][0]["n"] == 1, "waiting lists it, numbered")
inst = r.json()["items"][0]["id"]
r = c.post(f"{API}/answer", json={"instance": "1", "answer": "approve"})
ok(r.status_code == 400, "a pick is not approved: 400")
r = c.post(f"{API}/answer", json={"instance": "1", "answer": "pick", "option": "3"})
ok(r.status_code == 200 and r.json()["branch"] == "pick" and r.json()["option"]["id"] == "leave", "pick by number")
ok(r.json()["run"]["ran"][0]["action"] == "log.note", "the branch ran")
ok(f"prompt-engine:ask:{inst}" in resolved, "the alert is resolved on answer")
r = c.post(f"{API}/answer", json={"instance": inst, "answer": "deny"})
ok(r.status_code == 400, "answered twice is refused")
r = c.post(f"{API}/answer", json={"instance": "zzz"})
ok(r.status_code == 400, "answer needs both fields")

# a run-now rule: push goes to the alert hub, sms is keys needed → an alert for the systems check
alerts.clear()
r = c.post(f"{API}/fire", json={"event": "build.shipped", "payload": {"build": {"id": "b2"}}})
kinds = sorted(d["kind"] for d in r.json()["delivered"])
ok(kinds == ["keys-needed", "notify"], f"push delivered, sms is keys needed: {kinds}")
ok(any(a["title"].startswith("Keys needed: sms") for a in alerts), "keys needed alert raised")
ok(any(a["title"] == "Shipped b2" for a in alerts), "push alert raised with the rendered title")

# dry fire delivers nothing
alerts.clear()
r = c.post(f"{API}/fire", json={"event": "build.shipped", "payload": {"build": {"id": "b3"}}, "dry": True})
ok(r.status_code == 200 and r.json()["dry"] is True and not alerts and "delivered" not in r.json(), "dry fire runs and delivers nothing")
r = c.post(f"{API}/fire", json={"payload": {}})
ok(r.status_code == 400, "fire needs an event")

# test-fire (dry) through the route
r = c.post(f"{API}/rules/build-failed-retry/test", json={})
ok(r.status_code == 200 and r.json()["fire"] is True and r.json()["instance"]["kind"] == "pick" and "pick:archive" in r.json()["plans"], "test-fire shows the prompt and the plans")

# macros / pipelines
r = c.post(f"{API}/macros", json={"id": "m1", "title": "M", "steps": [{"action": "log.note", "input": {"text": "x"}}]})
ok(r.status_code == 200, "macro added")
r = c.post(f"{API}/pipelines", json={"id": "p1", "title": "P", "stages": [{"title": "S", "actions": [{"action": "macro.run", "input": {"macro": "m1"}}]}]})
ok(r.status_code == 200 and r.json()["pipeline"]["stages"][0]["id"] == "stage-1", "pipeline added")
ok(c.get(f"{API}/macros").json()["items"][0]["id"] == "m1" and c.get(f"{API}/pipelines").json()["items"][0]["id"] == "p1", "lists")
ok(c.post(f"{API}/macros/m1/delete", json={"confirm": "m1"}).status_code == 200, "macro deleted with confirm")
ok(c.post(f"{API}/pipelines/p1/delete", json={"confirm": "x"}).status_code == 409, "pipeline delete needs confirm")

# tool sets + direct runs + run records
r = c.post(f"{API}/toolsets", json={"id": "review", "title": "Review tools", "tools": ["ui-review.*", "console.open"]})
ok(r.status_code == 200 and r.json()["toolset"]["tools"] == ["ui-review.*", "console.open"], "a tool set added")
r = c.post(f"{API}/toolsets", json={"id": "bad", "tools": ["Nope!"]})
ok(r.status_code == 400 and r.json()["detail"]["errors"][0]["field"] == "tools.0", "a bad pattern is 400 with the entry named")
ok(c.get(f"{API}/toolsets").json()["items"][0]["id"] == "review" and c.get(f"{API}/toolsets/review").json()["toolset"]["enabled"] is True, "tool sets listed and read")
r = c.get(f"{API}/tools?set=review")
ok(r.status_code == 200 and r.json()["open"] is False and all(i["set"] == "review" for i in r.json()["items"]), "tools of one set")
ok(c.get(f"{API}/tools?set=nope").status_code == 404, "unknown set is 404")
r = c.post(f"{API}/tools/run", json={"plugin": "console", "command": "press"})
ok(r.status_code == 403 and "not in a tool set" in r.json()["detail"], "a tool outside the set is 403")
r = c.post(f"{API}/tools/run", json={"plugin": "console", "command": "open", "input": {"address": "builds"}, "dry": True})
ok(r.status_code == 200 and r.json()["dry"] is True and r.json()["tool"] == "console.open" and r.json()["toolset"] == "review", "a tool in the set plans (dry)")
ok(c.post(f"{API}/tools/run", json={"plugin": "x"}).status_code == 400, "run-tool needs plugin and command")
c.post(f"{API}/macros", json={"id": "m2", "title": "M2", "params": ["x"], "steps": [{"action": "log.note", "input": {"text": "hi {{params.x}}"}}]})
r = c.post(f"{API}/macros/m2/run", json={"params": {"x": "there"}})
ok(r.status_code == 200 and r.json()["ran"][0]["result"]["note"] == "hi there" and r.json()["record"]["status"] == "done", "a macro runs now with params")
ok(c.post(f"{API}/macros/nope/run", json={}).status_code == 404, "unknown macro is 404")
c.post(f"{API}/pipelines", json={"id": "p2", "title": "P2", "stages": [{"title": "A", "actions": [{"action": "log.note", "input": {"text": "a"}}]}, {"title": "B", "gate": {"kind": "approve", "title": "Go on?"}, "actions": [{"action": "log.note", "input": {"text": "b"}}]}]})
alerts.clear()
r = c.post(f"{API}/pipelines/p2/run", json={})
ok(r.status_code == 200 and r.json()["record"]["status"] == "waiting" and r.json()["waitingAt"]["stage"] == 1, "a pipeline runs to its gate and waits")
ok(r.json()["delivered"][0]["kind"] == "ask" and alerts and alerts[0]["title"] == "Go on?", "the gate reached the alert hub")
run_id = r.json()["record"]["id"]
gate = r.json()["waitingAt"]["instance"]
r = c.get(f"{API}/runs?status=waiting")
ok(r.status_code == 200 and r.json()["items"][0]["id"] == run_id, "runs filtered by status")
r = c.post(f"{API}/answer", json={"instance": gate, "answer": "approve"})
ok(r.status_code == 200 and r.json()["run"]["record"]["id"] == run_id and r.json()["run"]["record"]["status"] == "done", "the answer resumes the same run")
r = c.get(f"{API}/runs/{run_id}")
ok(r.status_code == 200 and r.json()["run"]["status"] == "done" and [s["action"] for s in r.json()["run"]["ran"]] == ["log.note", "log.note"], "the run record is complete")
ok(c.get(f"{API}/runs/nope").status_code == 404, "unknown run is 404")
ok(c.post(f"{API}/toolsets/review/disable").json()["toolset"]["enabled"] is False and c.get(f"{API}/tools").json()["open"] is True, "disabled set = open tools")
ok(c.post(f"{API}/toolsets/review/delete", json={"confirm": "x"}).status_code == 409, "tool set delete needs confirm")
ok(c.post(f"{API}/toolsets/review/delete", json={"confirm": "review"}).status_code == 200, "tool set deleted")

# options, manifest, history, webhook
r = c.post(f"{API}/options", json={"source": "builds", "event": "build.status", "field": "build.status"})
ok(r.status_code == 200 and "failed" in r.json()["values"] and "in" in r.json()["ops"], "builder options for a field")
r = c.post(f"{API}/manifest", json={"source": "deploy", "events": [{"id": "deploy.done"}]})
ok(r.status_code == 200 and r.json()["manifest"]["source"] == "deploy", "a manifest registered")
ok(c.get(f"{API}/manifest?source=deploy").json()["source"]["events"][0]["id"] == "deploy.done", "one source read back")
ok(c.post(f"{API}/manifest", json={"events": [{}]}).status_code == 400, "a bad manifest is 400")
r = c.get(f"{API}/history?limit=5&kind=fired")
ok(r.status_code == 200 and r.json()["items"] and all(h["kind"] == "fired" for h in r.json()["items"]), "history filtered by kind")
r = c.post(f"{API}/webhook/github", json={"action": "opened"}, headers={"x-github-event": "pull_request"})
ok(r.status_code == 200 and r.json()["event"]["event"] == "webhook.received", "a webhook fires webhook.received")
r = c.post(f"{API}/tick")
ok(r.status_code == 200 and r.json()["ok"] is True, "tick runs")

# the capability and the decision dialog hook
svc = plugin_services.get("axf.prompt-engine@1")
ok(svc is not None and svc.waiting()["ok"] is True, "axf.prompt-engine@1 is provided")
asked: list[dict] = []


class FakeDecisions:
    def ask(self, item: dict) -> bool:
        asked.append(item)
        return True


plugin_services.provide("axf.decisions@1", FakeDecisions(), folder="fake-decisions")
res = svc.fire({"source": "builds", "event": "build.status", "payload": {"build": {"id": "b4", "title": "Other", "status": "failed"}}}, by="test")
ok(res["ok"] and res["delivered"][0]["dialog"] is True and asked[0]["kind"] == "pick" and len(asked[0]["options"]) == 3, "the decision dialog got the prompt with its options")
ans = asked[0]["answer"]({"kind": "pick", "option": "leave"})
ok(ans["ok"] and ans["branch"] == "pick", "the dialog's callback answers it")
plugin_services.withdraw("fake-decisions")

# Brett-only: a model upgrade approval from a session is refused by the runner, never run
r = c.post(f"{API}/rules", json={"id": "up", "title": "Up", "trigger": {"event": "build.upgrade-requested"}, "ask": {"kind": "none"}, "on": {"fire": [{"action": "build.approve-upgrade", "input": {"build": "b", "phase": "1"}}]}})
ok(r.status_code == 200, "upgrade rule added")
r = c.post(f"{API}/fire", json={"event": "build.upgrade-requested", "payload": {"build": {"id": "b"}, "phase": 1, "to": "Fable"}})
ok(r.json()["runs"][0]["failed"][0]["code"] == "denied", "only Brett approves an upgrade")

print(f"prompt-engine server: {checks} checks passed")
