#!/usr/bin/env python3
"""Self-test for the Claude sessions plugin (agent-pick@1) with the real Agent swarm (axf.crew@1) on scratch data and a fake axHub:
zero tokens (no model anywhere in the plugin), Assign to Claude, settings, ask on / off, the default agent until Brett
answers, headless keeping its brief's agent, only Brett answering (his click or the axHub approval's ticket), the
picker approval round trip through the fake hub, and booking a session's cost and commits on the right card.

    python3 apps/console-web/plugins/claude-session/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
import tempfile
import time
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
os.environ.update(AXF_CLAUDE_DIR=tempfile.mkdtemp(prefix="axf-claude-test-"), AXF_SWARM_DIR=tempfile.mkdtemp(prefix="axf-claude-swarm-"),
                  AXF_SWARM_CHATS_DIR="off", AXHUB_TOKEN="test-token")
sys.path.insert(0, str(HERE.parent.parent / "server"))
import plugin_services  # noqa: E402

sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []


def load(folder: str):
    d = HERE.parent / folder / "server"
    spec = importlib.util.spec_from_file_location(f"axf_console_plugins.{folder.replace('-', '_')}_test", d / "__init__.py", submodule_search_locations=[str(d)])
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    return m


swarm = load("agent-swarm")  # provides axf.crew@1
mod = load("claude-session")

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()


@app.middleware("http")
async def fake_sign_in(request: Request, call_next):  # the console's wall: x-test-brett = Brett signed in in his browser
    if request.headers.get("x-test-brett"):
        request.state.axf_user = types.SimpleNamespace(via="session", admin=True, name="brett")
    return await call_next(request)


app.include_router(mod.router, prefix="/api/plugins/claude-session")
c = TestClient(app)
B = "/api/plugins/claude-session"
BRETT = {"x-test-brett": "1"}
n = failed = 0


def ok(cond: bool, what: str) -> None:
    global n, failed
    n += 1
    if not cond:
        failed += 1
        print(f"FAIL {what}")


# ---- zero tokens: nothing in the plugin can reach a model
LLM = re.compile(r"anthropic|openai|axf\.llm@1|claude\s+-p|['\"]-p['\"]|messages\.create|AXF_CLAUDE_BIN|/v1/messages", re.I)
for f in HERE.rglob("*"):
    if f.is_file() and f.suffix in (".py", ".ts", ".tsx", ".mjs", ".json") and f.name != "test.py":
        hits = [ln for ln in f.read_text().splitlines() if LLM.search(ln) and "No model" not in ln and "no model" not in ln.lower()]
        ok(not hits, f"zero tokens: {f.relative_to(REPO)} has no model call ({hits[:1]})")
ok(plugin_services.get("axf.crew@1") is not None, "the Agent swarm provides axf.crew@1")

# ---- the crew and the picker
p = c.get(f"{B}/picker").json()
ids = [r["id"] for r in p["rows"]]
ok(p["crew"] and "sully" in ids and len(ids) >= 8, f"picker lists the crew ({len(ids)} agents)")
row = next(r for r in p["rows"] if r["id"] == "sully")
ok(all(k in row for k in ("avatar", "working", "currentJob", "todayUsd", "hoursToday", "salary", "rating", "details")), "a row has avatar, status, job, cost, hours, pay, rating, details")
ok(all(k in row["details"] for k in ("stats", "feed", "raises", "writeups", "persona")), "details: stats, runs, raises, write-ups, persona")
ok(p["settings"] == {"defaultAgent": "", "askEverySession": True, "askHeadless": False}, f"defaults: ask every session ON, headless off ({p['settings']})")

# ---- Assign to Claude + settings
ok(c.post(f"{B}/assign", json={"agent": "nobody"}).status_code == 400, "assigning an unknown agent is refused")
r = c.post(f"{B}/assign", json={"agent": "Snap Sully"}).json()
ok(r["defaultAgent"] == "sully", f"Assign to Claude by name sets the default ({r})")
ok(c.get(f"{B}/agent-settings").json()["defaultName"] == "Snap Sully", "settings show the default agent's name")
ok(c.put(f"{B}/agent-settings", json={"askHeadless": "yes"}).status_code == 400, "settings refuse a non-boolean switch")

# ---- persona / voice notes
c.put(f"{B}/persona", json={"agent": "sully", "persona": "Quick and dry; says what he shot.", "voice": "low, Boston"})
me = c.get(f"{B}/agent").json()
ok(me["agent"]["id"] == "sully" and me["agent"]["persona"].startswith("Quick") and me["agent"]["voice"] == "low, Boston", "agent-get with no session = the default agent with persona and voice")
ok(me["agent"]["intro"].startswith("I'm Snap Sully") and me["agent"]["env"] == {"AXF_AGENT": "sully"}, "it says how to introduce itself and AXF_AGENT")

# ---- ask ON: the session works as the default until Brett answers; the fake axHub holds one approval
held: list[dict] = []


def fake_hub(method: str, params: dict, sid):
    if method == "initialize":
        return {}, "hub-session-1"
    held.append(params["arguments"])
    return {"content": [{"type": "text", "text": json.dumps({"held": True, "job_id": "job-42", "runsAt": "later"})}]}, sid


mod.hub.transport = fake_hub
alerts: list[dict] = []
mod.cx.raise_alert = lambda inp: alerts.append(inp) or {}
mod.cx.resolve_alerts = lambda keys: alerts.append({"resolved": keys})

s = c.post(f"{B}/session-start", json={"client": "voice", "summary": "Fix the wake word"}).json()
sid = s["session"]
ok(s["asking"] and s["status"] == "asking" and s["agent"]["id"] == "sully" and s["source"] == "default", f"ask on: asking, default agent meanwhile ({s['status']}, {s['agent']['id']})")
ok("ticket" not in json.dumps(s), "session-start never shows the ticket")
for _ in range(50):
    if held:
        break
    time.sleep(0.05)
ok(len(held) == 1 and held[0]["tool"] == "axf.claude_session_answer" and held[0]["reason"]["title"].startswith("Claude session: work as Snap Sully"), "one held axHub approval with a reason")
ok(any(a.get("key") == f"claude-ask:{sid}" for a in alerts), "the console bell gets the ask")
ok(c.get(f"{B}/agent", params={"session": sid}).json()["asking"], "agent-get: still asking")

# the session (console token only) can't answer itself, nor read the tickets
ok(c.post(f"{B}/answer", json={"session": sid, "agent": "rio"}).status_code == 403, "a session answering itself is refused")
ok(c.post(f"{B}/answer", json={"session": sid, "agent": "rio", "ticket": "guess"}).status_code == 403, "a wrong ticket is refused")
ok(all("ticket" not in a for a in c.get(f"{B}/asks").json()["asks"]), "asks hide tickets from a session")
asks = c.get(f"{B}/asks", headers=BRETT).json()
ok(asks["brett"] and asks["asks"][0]["session"] == sid and asks["asks"][0]["ticket"], "Brett's console sees the ask with its ticket (the pop-up)")
ok("held on axHub (job-42)" in asks["asks"][0]["hub"], f"the ask records the held hub job ({asks['asks'][0]['hub']})")

# Brett picks Rio in the console pop-up (his signed-in click)
a = c.post(f"{B}/answer", json={"session": sid, "agent": "rio"}, headers=BRETT).json()
ok(a["status"] == "picked" and a["agent"]["id"] == "rio" and a["answeredBy"] == "brett", f"Brett's click picks the agent ({a['agent']['id']})")
ok(c.get(f"{B}/agent", params={"session": sid}).json()["agent"]["name"] == "Rio React", "agent-get: the session is Rio React now")
ok({"resolved": [f"claude-ask:{sid}"]} in alerts, "the bell item is resolved")
# the axHub approval arriving later carries the old ticket: no longer valid
ok(c.post(f"{B}/answer", json={"session": sid, **held[0]["arguments"]["input"]}).status_code == 403, "a stale axHub approval after Brett picked changes nothing")

# ---- picker approval round trip through the fake axHub: Brett approves on his phone, the hub runs axf.claude_answer
held.clear()
s2 = c.post(f"{B}/session-start", json={"client": "chat", "summary": "Plan the week"}).json()
for _ in range(50):
    if held:
        break
    time.sleep(0.05)
hub_input = held[0]["arguments"]["input"]
ok(hub_input["session"] == s2["session"] and hub_input["agent"] == "sully" and hub_input["ticket"], "the held call carries session, default agent and ticket")
r = c.post(f"{B}/answer", json=hub_input)  # what axHub runs after Approve (console token + ticket)
ok(r.status_code == 200 and r.json()["answeredBy"] == "axHub approval" and r.json()["agent"]["id"] == "sully", "the axHub approval answers with the default agent")

# ---- ask OFF: no prompt, default straight away
c.put(f"{B}/agent-settings", json={"askEverySession": False})
held.clear()
s3 = c.post(f"{B}/session-start", json={"client": "code", "summary": "quick fix"}).json()
time.sleep(0.2)
ok(not s3["asking"] and s3["status"] == "set" and s3["agent"]["id"] == "sully" and not held, "ask off: default agent, no prompt, no hub call")
c.put(f"{B}/agent-settings", json={"askEverySession": True})

# ---- headless keeps its brief's agent unless Ask for headless too
s4 = c.post(f"{B}/session-start", json={"client": "headless", "summary": "agent-pick build", "agent": "joey"}).json()
ok(not s4["asking"] and s4["agent"]["id"] == "joey" and s4["source"] == "brief", "headless keeps the brief's named agent, no prompt")
s5 = c.post(f"{B}/session-start", json={"client": "headless", "summary": "no brief agent"}).json()
ok(not s5["asking"] and s5["agent"]["id"] == "sully", "headless without a named agent = the default, no prompt")
c.put(f"{B}/agent-settings", json={"askHeadless": True})
s6 = c.post(f"{B}/session-start", json={"client": "headless", "summary": "asked", "agent": "joey"}).json()
ok(s6["asking"] and s6["agent"]["id"] == "joey", "Ask for headless too: headless asks too (brief agent meanwhile)")
ok(c.post(f"{B}/session-start", json={"client": "fax"}).status_code == 400, "an unknown client is refused")
again = c.post(f"{B}/session-start", json={"client": "headless", "session": s4["session"]}).json()
ok(again["agent"]["id"] == "joey", "a session calling again keeps its agent")

# ---- no answer in time: the ask lapses to the default
with mod.store() as d:
    for x in d["sessions"]:
        if x["id"] == s6["session"]:
            x["startedAt"] = "2026-01-01T00:00:00.000Z"
ok(c.get(f"{B}/agent", params={"session": s6["session"]}).json()["status"] == "default", "an unanswered ask lapses to the default agent")

# ---- booking on the right card
b = c.post(f"{B}/book", json={"session": sid, "usd": 0.75, "commits": ["abc1234"], "summary": "wake word fixed"}).json()
ok(b["agent"] == "rio" and b["status"] == "running", f"booked on the picked agent's card, still running ({b})")
b = c.post(f"{B}/book", json={"session": sid, "usd": 1.5, "commits": ["def5678", "not-a-sha"], "final": True}).json()
ok(b["status"] == "done" and b["usd"] == 1.5, "the final booking closes the run")
crew = {a["id"]: a for a in plugin_services.get("axf.crew@1").crew()}
ok(crew["rio"]["spend"]["today"] == 1.5 and crew["rio"]["stats"]["done"] == 1, "Rio's card: today's cost and one job done")
ok("abc1234, def5678" in crew["rio"]["feed"][0]["summary"], "the commits are on the run")
ok(crew["sully"]["spend"]["today"] == 0, "nothing booked on the default agent")
ok(c.post(f"{B}/book", json={"session": "unknown-1"}).status_code == 400, "booking an unknown session with no agent is refused")
b = c.post(f"{B}/book", json={"session": "hl-1", "agent": "joey", "usd": 0.2}).json()
ok(b["agent"] == "joey", "a session that never started books by AXF_AGENT")
rows = {r["id"]: r for r in c.get(f"{B}/picker").json()["rows"]}
ok(rows["joey"]["working"] and rows["rio"]["todayUsd"] == 1.5, "picker: Joey working (open run), Rio's cost today")

# ---- commands: REST + MCP + CLI from the one declaration
import subprocess  # noqa: E402

CMDS = REPO / "apps/console-web/plugins" / "plugin-commands" / "commands.mjs"  # the control@1 plugins domain, when installed
if CMDS.exists():
    out = subprocess.run(["node", str(CMDS), "tools", "--json"], capture_output=True, text=True, cwd=REPO).stdout
    for t in ("claude_session_start", "claude_session_agent", "claude_session_answer", "claude_session_book", "claude_session_assign"):
        ok(f'"{t}"' in out, f"MCP tool {t}")

print(f"claude-session plugin: {n - failed}/{n} passed")
sys.exit(1 if failed else 0)
