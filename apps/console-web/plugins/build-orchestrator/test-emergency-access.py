"""Claude may send a build to emergency (Brett, Nov 24 2026; build claude-emergency-access): the contract, end to end.

    python3 apps/console-web/plugins/build-orchestrator/test-emergency-access.py

The contract this file is written against (not against one step's code):

1. POST /pipeline/emergency with the console token (MCP, REST, the CLI, voice) + `reason` + `askedBy` is allowed. The
   build carries `emergency: { by, via: 'console-token', askedBy, reason, at }` and a note, and one
   `build-emergency-by-claude` notification is asked of axf.notify@1 (through the alert hub).
2. The console token without a reason: 400.
3. The Claude setting `builds.claudeEmergency` off: 403.
4. Brett's own signed-in session still works with no reason (and with the setting off).
5. Approve / deny and upgrade actions are still refused for the token.
6. `pipeline.mjs emergency <id>` from a session without `--reason` exits non-zero.

Everything runs on a scratch builds store, slots folder, pipeline folder, alert folder and Claude settings file in a
temp directory: the live ones are never read or written. The build's steps land together; where a sibling step's code
is not on this worktree yet, its checks are skipped with the step named, and the rest still run.
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import tempfile
from importlib import import_module
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / "apps/console-web/server"))
sys.path.insert(0, str(HERE.parent))

from fastapi import HTTPException  # noqa: E402

AGENT_ENV = ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "AI_AGENT", "AXF_SURFACE", "AXF_SESSION", "AXF_AGENT", "AXF_APPROVER", "AXF_APPROVER_VIA", "AXF_ACTOR",
             "AXF_BUILD_ID", "AXF_ORCH_FILE", "AXF_PENDING_FILE")
SETTING = "builds.claudeEmergency"
NOTIFY_TYPE = "build-emergency-by-claude"
passed = 0
skipped: list[str] = []


def check(ok: bool, name: str) -> None:
    global passed
    if not ok:
        raise SystemExit(f"✗ {name}")
    passed += 1
    print(f"  ✓ {name}")


def skip(what: str, why: str) -> None:
    skipped.append(what)
    print(f"  - skipped: {what} ({why})")


class Req:
    """A console request: via 'session' = signed in at the hub, 'token' = the console token (MCP, REST, the CLI, voice)."""

    def __init__(self, via: str, body: dict | None = None, admin: bool = True, headers: dict[str, str] | None = None):
        self.state = SimpleNamespace(axf_user=SimpleNamespace(name="Brett", via=via, admin=admin))
        self.headers = {k.lower(): v for k, v in (headers or {}).items()}
        self._body = json.dumps(body or {}).encode()

    async def body(self) -> bytes:
        return self._body

    async def json(self) -> dict:
        return json.loads(self._body)


def call(fn, req: Req) -> tuple[int, dict | str]:
    try:
        return 200, asyncio.run(fn(req))
    except HTTPException as e:
        return e.status_code, str(e.detail)


class Gate:
    """A stand-in for the notification registry (axf.notify@1): it records every notification the alert hub asks it about."""

    def __init__(self) -> None:
        self.asked: list[dict] = []

    def check(self, inp: dict) -> None:
        self.asked.append(dict(inp))
        return None

    def view(self, items: list, phone: bool = False) -> list:
        return items

    def device_off(self) -> list:
        return []


class Settings:
    """A stand-in for the Claude settings plugin (axf.claude-settings@1)."""

    def __init__(self) -> None:
        self.values: dict = {}

    def get(self) -> dict:
        return {"ok": True, "values": dict(self.values)}


with tempfile.TemporaryDirectory() as d:
    tmp = Path(d)
    for k in AGENT_ENV:
        os.environ.pop(k, None)
    store = tmp / "store.json"
    slots = tmp / "slots"
    settings_file = tmp / "claude-settings.json"
    os.environ.update(AXF_BUILDS_STORE=str(store), AXF_SLOTS_DIR=str(slots), AXF_PLAN_TREE_DIR=str(tmp / "tree"), AXF_PIPELINE_DIR=str(tmp / "pipeline"),
                      AXF_PIPELINE_CONSOLE="off", AXF_CLAUDE_SETTINGS_FILE=str(settings_file), AXF_FABLE_UPGRADE_APPROVAL="1", AXF_BUILDS_LIVE="0",
                      AXF_BUILD_HOOKS="off", AXF_BUILDS_EXPORT="0", AXF_DATA_DIR="off", AXF_SHIPPED="off", AXF_CREW_SAY="off")
    srv = import_module("build-orchestrator.server")
    import console_context  # noqa: E402
    import plugin_services  # noqa: E402
    import alerts as alert_hub  # noqa: E402

    def builds() -> list[dict]:
        return json.loads(store.read_text())["builds"]

    def build(bid: str) -> dict:
        return next(b for b in builds() if b["id"] == bid)

    def grants() -> list[str]:
        f = slots / "build-limit-emergency.json"
        return [g["id"] for g in json.loads(f.read_text())["builds"]] if f.exists() else []

    def node(*args: str, env: dict | None = None, stdin: str | None = None) -> subprocess.CompletedProcess:
        return subprocess.run(["node", *args], cwd=ROOT, capture_output=True, text=True, timeout=120, input=stdin, env={**os.environ, **(env or {})})

    # ---- which steps of the build are on this worktree
    manifest = json.loads((HERE / "plugin.json").read_text())
    has_server = hasattr(srv, "claude_emergency_on")  # s1: the server rule
    has_cli = "sendEmergency" in (HERE / "pipeline.mjs").read_text()  # s2: pipeline.mjs emergency <id>
    registry = None  # s3: the owner-only switch, found by its capability (never by folder name)
    for f in sorted(HERE.parent.iterdir()):
        m = f / "plugin.json"
        if m.exists() and "service:axf.claude-settings@1" in (json.loads(m.read_text()).get("provides") or []) and (f / "registry.json").exists():
            registry = json.loads((f / "registry.json").read_text())
    switch = next((s for s in (registry or {}).get("settings", []) if s.get("key") == SETTING), None)

    def commands(node_: object) -> list[dict]:
        if isinstance(node_, dict):
            return ([node_] if isinstance(node_.get("id"), str) and isinstance(node_.get("route"), str) else []) + [c for v in node_.values() for c in commands(v)]
        return [c for v in node_ for c in commands(v)] if isinstance(node_, list) else []

    command = next((c for c in commands(manifest) if c["id"] == "pipeline-emergency"), None)
    has_command = bool(command and "reason" in ((command.get("input") or {}).get("properties") or {}))  # s4: MCP, console control, voice
    S1 = "step s1 (the server rule) is not on this worktree yet"
    S2 = "step s2 (pipeline.mjs emergency) is not on this worktree yet"
    S3 = "step s3 (the Claude setting) is not on this worktree yet"
    S4 = "step s4 (the command for MCP, console control and voice) is not on this worktree yet"

    # ---- a scratch store: three Pipeline 2.0 builds, made the way Plan Studio makes one
    seed = ("import('./framework/cli/builds-store.mjs').then(async (BS) => { const core = await import('./framework/plan/builds-store-core.mjs'); const P2 = await import('./framework/core/pipeline-status.mjs');"
            " BS.withStore((s) => { for (const id of ['rush', 'calm', 'shell']) s.builds.push(core.normBuild(P2.transition({ id, title: id, flow: P2.FLOW, steps: [] }, 'pending', { by: 'test' }).rec)); return s; }, { by: 'test' }); })")
    p = node("-e", seed)
    check(p.returncode == 0 and store.is_file() and {b["id"] for b in builds()} == {"rush", "calm", "shell"} and build("rush")["flow"] == "pipeline-2",
          f"a scratch builds store in a temp folder is seeded (the live store is never used) {p.stderr[-200:]}")
    where = node(str(HERE / "orchestrator.mjs"), "where")
    check(where.stdout.strip() == str(store), "the orchestrator CLI works on the scratch store")

    # the real alert hub on a scratch folder, asking a recording axf.notify@1; a recording Claude settings service
    gate, settings = Gate(), Settings()
    kept = {k: plugin_services._services.pop(k, None) for k in ("axf.notify@1", "axf.claude-settings@1")}
    plugin_services.provide("axf.notify@1", gate, folder="test-notify")
    plugin_services.provide("axf.claude-settings@1", settings, folder="test-settings")
    hub = alert_hub.AlertHub(tmp / "alerts")
    raised: list[dict] = []

    def raise_alert(inp: dict) -> dict:
        raised.append(dict(inp))
        return hub.raise_alert(inp, deliver=False)[0]

    console_context.raise_alert = raise_alert
    send = srv.pipeline_emergency
    ask = {"reason": "Login is down and Brett said send it to emergency", "askedBy": "agent:Vinny"}

    # ---- 1. the console token with a reason and a name: allowed, logged, one FYI
    if not has_server:
        code, why = call(send, Req("token", {"id": "calm", **ask}))
        check(code == 403 and "emergency" not in build("calm") and grants() == [], "the old rule is what this worktree has: the console token is refused with 403, nothing tagged")
        for what in ("the console token with a reason and a name sends the build", "the build carries emergency: { by, via: 'console-token', askedBy, reason, at } and a note",
                     "one build-emergency-by-claude notification is asked of axf.notify@1", "the console token without a reason gets 400",
                     "builds.claudeEmergency off gets 403"):
            skip(what, S1)
    else:
        # ---- 2. no reason = 400 (and nothing happens)
        for name, body in [("no reason", {"id": "calm", "askedBy": "agent:Vinny"}), ("a blank reason", {"id": "calm", "reason": "  \n ", "askedBy": "agent:Vinny"})]:
            code, why = call(send, Req("token", body))
            check(code == 400 and "reason" in str(why), f"the console token with {name} gets 400 naming the reason ({code} {why})")
        # ---- 3. the setting off = 403 (even with a reason and a name)
        settings.values[SETTING] = False
        code, why = call(send, Req("token", {"id": "calm", **ask}))
        check(code == 403 and SETTING in str(why), f"{SETTING} off: the console token gets 403 saying where Brett switches it on ({code} {why})")
        check("emergency" not in build("calm") and grants() == [] and gate.asked == [] and raised == [], "after every refusal nothing is tagged, granted or notified")
        # ---- 4. Brett's own signed-in click: no reason needed, even with the setting off
        code, res = call(send, Req("session", {"id": "rush"}))
        check(code == 200 and res["ok"] and not res["already"] and res["emergency"]["by"] == "Brett" and res["emergency"].get("via") == "person",
              f"Brett's signed-in session still sends a build with no reason, even with the setting off ({code} {res})")
        check(build("rush")["emergency"]["by"] == "Brett" and not build("rush")["emergency"].get("reason") and grants() == ["rush"] and gate.asked == [],
              "his build is tagged emergency and holds the slot grant; no FYI for his own click")
        # ---- 1. allowed
        settings.values[SETTING] = True
        code, res = call(send, Req("token", {"id": "calm", **ask}))
        tag = build("calm").get("emergency") or {}
        check(code == 200 and res["ok"] and not res["already"] and res["emergency"] == tag, f"the console token with a reason and a name sends the build ({code} {res})")
        check(set(tag) == {"by", "via", "askedBy", "reason", "at"} and tag["via"] == "console-token" and tag["askedBy"] == "agent:Vinny" and tag["by"] == "agent:Vinny"
              and tag["reason"] == ask["reason"] and tag["at"].startswith("20"), f"the build carries emergency: {{ by, via: 'console-token', askedBy, reason, at }} ({tag})")
        note = (build("calm").get("notes") or [{}])[-1].get("text", "")
        check("agent:Vinny" in note and ask["reason"] in note and "emergency" in note.lower(), f"the send is a note on the build with who asked and why ({note})")
        check(grants() == ["rush", "calm"], "the emergency slot grant is on file for it")
        mine = [a for a in gate.asked if (a.get("meta") or {}).get("type") == NOTIFY_TYPE]
        check(len(mine) == 1 and len(gate.asked) == 1 and len(raised) == 1, f"one {NOTIFY_TYPE} notification is asked of axf.notify@1 ({len(mine)} of {len(gate.asked)})")
        fyi = mine[0]
        check("calm" in fyi["title"] and "agent:Vinny" in fyi["body"] and ask["reason"] in fyi["body"] and fyi["severity"] == "info", f"the FYI names the build, who asked and why ({fyi['title']}: {fyi['body']})")
        types = json.loads((HERE / "notify.json").read_text())["types"]
        t = next((x for x in types if x["id"] == NOTIFY_TYPE), None)
        check(bool(t) and t["match"]["source"] == fyi["source"] and fyi["key"].startswith(t["match"]["keyPrefix"]) and t["push"] is True,
              f"notify.json declares {NOTIFY_TYPE} (it may reach the phone) and the FYI's key lands on it")
        stored = [a for a in hub.snapshot()["alerts"] if a.get("key") == fyi["key"]] if hasattr(hub, "snapshot") else [fyi]
        check(len(stored) == 1, "the alert hub holds that one FYI")
        code, res = call(send, Req("token", {"id": "calm", **ask}))
        check(code == 200 and res["already"] and len(gate.asked) == 1 and build("calm")["emergency"] == tag, "sending it again changes nothing and asks for no second notification")
        code, why = call(send, Req("session", {"id": "shell", **ask}, admin=False))
        check(code == 403 and "emergency" not in build("shell"), "a signed-in hub user who is not an admin is still refused with 403")
        lst = srv.pipeline_emergency_list(Req("token"))
        check(sorted(b["id"] for b in lst["builds"]) == ["calm", "rush"] and lst["canSend"] is False and lst.get("claudeCanSend") is True, "the list shows both builds; canSend is Brett's click only, claudeCanSend says the setting is on")

    if not has_server:
        code, res = call(send, Req("session", {"id": "rush"}))
        check(code == 200 and res["ok"] and res["emergency"]["by"] == "Brett" and grants() == ["rush"], "Brett's signed-in session sends a build with no reason")

    # ---- 3b. the switch itself: owner-only, on by default
    if switch is None:
        skip(f"{SETTING} is an owner-only Claude setting, on by default", S3)
    else:
        check(switch.get("kind") == "toggle" and switch.get("default") is True and switch.get("owner") is True and switch.get("group") == "builds",
              f"{SETTING} is an owner-only toggle in the Builds group, on by default (only Brett's own click changes it)")

    # ---- 5. approve / deny and upgrade actions are still Brett's alone
    for step in ({"action": "add", "title": "Up", "steps": [{"text": "a", "model": "Opus", "estimate": "5 min"}, {"text": "b", "model": "Fable", "estimate": "5 min"}]},
                 {"action": "step", "id": "up", "step": "s1"}, {"action": "request-upgrade", "id": "up", "phase": 1, "by": "build:up"}):
        code, res = call(srv.act, Req("token", step))
        check(code == 200 and res.get("ok") is True, f"scratch build 'up': {step['action']} ({res.get('error', 'ok')})")
    up = lambda: build("up")  # noqa: E731
    check(len(up()["upgradeRequests"]) == 1 and up()["upgradeRequests"][0]["state"] not in ("approved", "denied") and not up()["approvals"], "it waits on an Opus → Fable upgrade request")
    for name, change in [("approve an upgrade", {"action": "approve", "id": "up", "phase": 1}),
                         ("approve with an approver in the body", {"action": "approve", "id": "up", "phase": 1, "approver": {"by": "Brett", "via": "console"}}),
                         ("deny an upgrade", {"action": "deny-upgrade", "id": "up", "phase": 1})]:
        code, res = call(srv.act, Req("token", change))
        refused = code in (400, 403) or (isinstance(res, dict) and res.get("ok") is False and "Brett" in str(res.get("error")))
        check(refused and not up()["approvals"] and up()["upgradeRequests"][0]["state"] not in ("approved", "denied"),
              f"the console token cannot {name} ({code} {res if not isinstance(res, dict) else res.get('error')})")
    code, res = call(srv.act, Req("session", {"action": "approve", "id": "up", "phase": 1}, headers={"X-Axhub-Session": "agent:Vinny"}))
    check(isinstance(res, dict) and res.get("ok") is False and not up()["approvals"], "nor can an agent riding Brett's signed-in session")
    p = node(str(HERE / "orchestrator.mjs"), "act", "approve", "up", "1", "--json", env={"CLAUDECODE": "1", "AXF_APPROVER": "Brett", "AXF_APPROVER_VIA": "console"})
    check(p.returncode != 0 and not up()["approvals"], "nor can a session that sets the approver itself on the CLI")
    code, res = call(srv.act, Req("session", {"action": "approve", "id": "up", "phase": 1}))
    check(code == 200 and res.get("ok") is True and up()["approvals"][0]["via"] == "console" and up()["upgradeRequests"][0]["state"] == "approved", "Brett's own signed-in click approves it (the refusals above were about who asked)")
    try:
        import console_control as cc
    except Exception as e:  # noqa: BLE001 — the console-control engine is the framework's; without it only this part is skipped
        cc = None
        skip("console control keeps approve / deny for Brett's own tap", f"console_control did not load: {e}")
    if cc is not None:
        for address in ("function:build-orchestrator.approve", "function:build-orchestrator.approve-upgrade", "function:build-orchestrator.deny-upgrade", "function:build-orchestrator.deny"):
            try:
                cc.check_press(None, address, True)
                check(False, f"console control refuses {address}")
            except cc.ControlError as e:
                check(getattr(e, "code", "denied") == "denied" or "Brett" in str(e), f"console control refuses {address}: Brett's own tap only")
        try:
            cc.check_press(None, "function:build-orchestrator.emergency", None)
            check(True, "console control does not hold send to emergency back as a deciding action")
        except cc.ControlError as e:
            check(False, f"console control does not hold send to emergency back as a deciding action ({e})")
    if not has_command:
        skip("the pipeline-emergency command takes reason and askedBy (MCP, console control, voice)", S4)
    else:
        spec = command["input"]
        check("reason" in spec["required"] and "id" in spec["required"] and "askedBy" in spec["properties"] and not command.get("personOnly"),
              "the pipeline-emergency command takes id + reason (required) and askedBy, and is not marked person-only")
        check("Brett only" not in command["description"] and SETTING in command["description"], "its description states the new rule and names the switch")
    deciding = [c for c in commands(manifest) if any(w in c["id"].split("-") for w in ("approve", "deny")) and not c.get("readOnly")]
    check(all(c.get("personOnly") or (cc is not None and cc.DECIDING_RE.search(c["id"])) for c in deciding), f"every approve / deny command of the plugin is still a deciding action ({len(deciding)} declared)")

    # ---- 6. the CLI: pipeline.mjs emergency <id>
    if not has_cli:
        skip("pipeline.mjs emergency <id> from a session without --reason exits non-zero", S2)
        skip("pipeline.mjs emergency <id> --reason … from a session tags the build via console-token", S2)
    else:
        pipeline = str(HERE / "pipeline.mjs")
        session = {"CLAUDECODE": "1", "AXF_SESSION": "axf-test--s6"}
        p = node(pipeline, "emergency", "shell", "--json", env=session)
        check(p.returncode != 0 and "reason" in p.stdout and "emergency" not in build("shell") and "shell" not in grants(), f"pipeline.mjs emergency <id> from a session without --reason exits non-zero (exit {p.returncode}: {p.stdout.strip()[:120]})")
        p = node(pipeline, "emergency", "shell", env=session)
        check(p.returncode != 0 and "reason" in p.stderr, "and says so in plain words without --json")
        settings_file.write_text(json.dumps({"values": {SETTING: False}}))
        p = node(pipeline, "emergency", "shell", "--reason", "Brett said so", "--json", env=session)
        check(p.returncode == 3 and SETTING in p.stdout and "emergency" not in build("shell"), f"with {SETTING} off the session's send is refused (exit {p.returncode})")
        settings_file.write_text(json.dumps({"values": {SETTING: True}}))
        p = node(pipeline, "emergency", "shell", "--reason", "Checkout is broken, Brett said go", "--asked-by", "agent:Sully", "--json", env=session)
        tag = build("shell").get("emergency") or {}
        check(p.returncode == 0 and tag.get("via") == "console-token" and tag.get("askedBy") == "agent:Sully" and tag.get("by") == "agent:Sully" and tag.get("reason") == "Checkout is broken, Brett said go" and tag.get("at"),
              f"with --reason and --asked-by the session sends it: emergency {{ by, via: 'console-token', askedBy, reason, at }} ({p.stdout.strip()[:160]} {tag})")
        note = (build("shell").get("notes") or [{}])[-1].get("text", "")
        check("agent:Sully" in note and "Checkout is broken" in note and "shell" in grants(), "the CLI's send is a note on the build too, and the slot grant is on file")
        p = node(pipeline, "emergency", "no-such-build-here", "--reason", "x", "--asked-by", "y", "--json", env=session)
        check(p.returncode == 2, "an unknown build exits 2")

    # ---- the live store was never the target; put the services back
    check(os.environ["AXF_BUILDS_STORE"] == str(store) and store.parent == tmp and srv.EMERGENCY_CLI.is_file(), "every write went to the scratch store")
    for k, v in kept.items():
        plugin_services._services.pop(k, None)
        if v is not None:
            plugin_services._services[k] = v

print(f"claude emergency access: {passed} checks passed, {len(skipped)} skipped")
