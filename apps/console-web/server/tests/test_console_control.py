"""console-control@1 server half: REST routes, guards, voice and the MCP tools, against a fake open console.

    python apps/console-web/server/tests/test_console_control.py      (pytest picks up the test_* functions too)

Covers targets / state / do / search / focus / scroll, plugin enable / disable (core refusal, dependency effects),
owner-only and deciding refusals, destructive confirm, the no-console error with openUrl, the rate limit, the audit
line, the voice route (and its Python twin against spec/fixtures/console-control-voice.json), and the MCP tools.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
os.environ["AXF_CONSOLE_CONTROL_DATA_DIR"] = tempfile.mkdtemp(prefix="cc-test-")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import console_control as cc  # noqa: E402
import console_control_api as api  # noqa: E402
import mcp_server  # noqa: E402

ROOT = HERE.parents[3]


class FakeConsole:
    """What the console-commands relay answers when one console is open: the console's own envelope plus its state."""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.open = True
        self.screen = "home"

    def control(self, cmd: dict[str, Any], by: str = "", audience: str = "owner", to: str = "recent") -> dict[str, Any]:
        self.sent.append({**cmd, "_by": by, "_to": to})
        if not self.open:
            return {"$axf": cc.FRAME, "ok": False, "code": "unavailable", "because": "no console open", "message": "no console open", "openUrl": "https://console.example/"}
        verb = cmd["verb"]
        if verb in ("open", "focus") and str(cmd.get("address", "")).startswith("view:"):
            self.screen = cmd["address"].split("/")[0][5:]
        state = {"screen": self.screen, "screenLabel": self.screen.title(), "tabs": {}, "focused": cmd.get("address") if verb in ("open", "focus") else None, "focusedRow": None, "targets": 3}
        out: dict[str, Any] = {"$axf": cc.FRAME, "ok": True, "verb": verb, "state": state, "client": "cc-test"}
        if cmd.get("address"):
            out["address"] = cmd["address"]
        if verb == "search":
            out["hits"] = [{"address": "row:b1", "kind": "row", "label": "Loaded build", "score": 120, "source": "loaded"}]
        if verb == "list":
            out["targets"] = [{"address": "view:home", "kind": "view", "label": "Home"}, {"address": "view:home/button:refresh", "kind": "button", "label": "Refresh"}]
            out["view"] = self.screen
        if verb == "scroll":
            out["scroll"] = {"container": "main", "top": 400, "fraction": 0.5, "atTop": False, "atBottom": False}
        if verb == "focus":
            out["focused"] = cmd["address"]
        return out


fake = FakeConsole()
api._relay = lambda: fake  # type: ignore[assignment]  # the relay is a capability; the test owns it
enabled: dict[str, bool] = {}


class Ctx:
    """console_context's plugin table (enable / disable without the console server)."""

    @staticmethod
    def plugin_enabled(folder: str) -> bool:
        return enabled.get(folder, True)

    @staticmethod
    def set_plugin_enabled(folder: str, on: bool) -> None:
        enabled[folder] = on


cc._ctx = lambda: Ctx  # type: ignore[assignment]

app = FastAPI()
app.include_router(api.router_for(lambda: None))
client = TestClient(app)
U = "/api/console-control"


def reset() -> None:
    fake.sent.clear()
    fake.open = True
    api._rate.clear()


def test_targets_inventory_and_console() -> None:
    reset()
    r = client.get(f"{U}/targets?source=inventory&kinds=plugin")
    assert r.status_code == 200 and r.json()["source"] == "inventory"
    ts = r.json()["targets"]
    assert ts and all(t["kind"] == "plugin" and t["address"].startswith("plugin:") for t in ts)
    r = client.get(f"{U}/targets")
    assert r.json()["source"] == "console" and r.json()["targets"][0]["address"] == "view:home"
    fake.open = False
    r = client.get(f"{U}/targets")
    assert r.status_code == 200 and r.json()["source"] == "inventory", "no console: the static inventory answers"
    r = client.get(f"{U}/targets?source=console")
    assert r.status_code == 503 and r.json()["openUrl"]


def test_state_and_no_console() -> None:
    reset()
    r = client.get(f"{U}/state")
    assert r.status_code == 200 and r.json()["state"]["screen"] == "home"
    assert r.json()["policy"]["tag"] == "allow" and r.headers["x-axf-policy"] == "allow"
    fake.open = False
    r = client.get(f"{U}/state")
    assert r.status_code == 503 and r.json()["code"] == "unavailable" and r.json()["openUrl"]
    r = client.post(f"{U}/focus", json={"address": "view:settings"})
    assert r.status_code == 503 and "no console" in r.json()["message"]


def test_do_focus_scroll_search() -> None:
    reset()
    r = client.post(f"{U}/focus", json={"address": "view:settings/tab:settings.tabs=plugins", "options": {"expand": True}})
    j = r.json()
    assert r.status_code == 200 and j["focused"] == "view:settings/tab:settings.tabs=plugins" and j["state"]["screen"] == "settings"
    assert fake.sent[-1]["options"] == {"expand": True}
    r = client.post(f"{U}/scroll", json={"dir": "down", "amount": 0.5})
    assert r.status_code == 200 and r.json()["scroll"]["fraction"] == 0.5 and fake.sent[-1]["scroll"] == {"dir": "down", "amount": 0.5}
    assert client.post(f"{U}/scroll", json={"dir": "sideways"}).status_code == 400
    r = client.get(f"{U}/search?q=loaded build")
    assert r.json()["hits"][0]["address"] == "row:b1", "a console open: its search (loaded rows too)"
    fake.open = False
    r = client.get(f"{U}/search?q=build orchestrator&limit=3")
    j = r.json()
    assert r.status_code == 200 and j["source"] == "inventory" and j["console"] is False and len(j["hits"]) <= 3
    assert j["hits"][0]["address"] == "view:build-orchestrator"
    assert client.get(f"{U}/search?q=").status_code == 400
    r = client.post(f"{U}/do", json={"verb": "nope"})
    assert r.status_code == 400 and r.json()["field"] == "verb"
    assert client.post(f"{U}/do", json={"verb": "press"}).json()["field"] == "address"


def test_plugins_enable_disable() -> None:
    reset()
    core = next(p for p in cc.inventory()["plugins"] if p.get("core"))
    r = client.post(f"{U}/plugins/{core['id']}/disable", json={})
    assert r.status_code == 400 and r.json()["reason"] == "core", "core plugins refuse"
    # a plugin someone requires refuses unless forced, and names who needs it
    needed = next((p for p in cc.inventory()["plugins"] if not p.get("core") and any(d["required"] for d in cc.plugin_dependents(p, Ctx.plugin_enabled))), None)
    if needed is not None:
        r = client.post(f"{U}/plugins/{needed['id']}/disable", json={})
        assert r.status_code == 400 and r.json()["reason"] == "needed" and r.json()["neededBy"]
        r = client.post(f"{U}/plugins/{needed['id']}/disable", json={"force": True})
        assert r.status_code == 200 and r.json()["effects"]["stopsWorking"]
        enabled.clear()
    free = next(p for p in cc.inventory()["plugins"] if not p.get("core") and not any(d["required"] for d in cc.plugin_dependents(p, Ctx.plugin_enabled)))
    r = client.post(f"{U}/plugins/{free['folder']}/disable", json={"by": "test"})
    j = r.json()
    assert r.status_code == 200 and j["enabled"] is False and enabled[free["folder"]] is False and j["changed"] == [free["address"]]
    assert j["source"] == "server" and j["policy"]["tag"] == "veto", "a plugin toggle runs server-side and is a write"
    r = client.post(f"{U}/plugins/{free['folder']}/enable", json={})
    assert r.status_code == 200 and enabled[free["folder"]] is True
    assert client.post(f"{U}/plugins/nope-nope/enable", json={}).status_code == 404
    assert not any(s["verb"].startswith("plugin.") for s in fake.sent), "plugin toggles never need the browser"


def test_person_only_and_confirm() -> None:
    reset()
    r = client.post(f"{U}/do", json={"verb": "press", "address": "function:approvals.approve"})
    assert r.status_code == 403 and r.json()["personOnly"] is True and r.json()["policy"]["tag"] == "person"
    r = client.post(f"{U}/do", json={"verb": "press", "address": "function:snapshots.delete"})
    assert r.status_code == 409 and r.json()["code"] == "confirmation_required" and r.json()["policy"]["tag"] == "confirm"
    r = client.post(f"{U}/do", json={"verb": "press", "address": "function:snapshots.delete", "confirm": True})
    assert r.status_code == 200 and fake.sent[-1]["confirm"] is True
    owner = next((s for s in cc.inventory().get("settings", []) if s.get("personOnly")), None)
    if owner is not None:
        r = client.post(f"{U}/do", json={"verb": "set", "address": owner["address"], "value": True})
        assert r.status_code == 403 and r.json()["personOnly"] is True, "owner-only settings are refused"
    assert not any(s["verb"] == "press" and "approve" in s.get("address", "") for s in fake.sent), "a deciding press never reaches the console"


def test_rate_limit_and_audit() -> None:
    reset()
    codes = [client.post(f"{U}/do", json={"verb": "press", "address": "button:x"}).status_code for _ in range(api.RATE_MAX_WRITE + 2)]
    assert codes[: api.RATE_MAX_WRITE] == [200] * api.RATE_MAX_WRITE and codes[-1] == 429
    r = client.post(f"{U}/do", json={"verb": "press", "address": "button:x"})
    assert r.headers.get("retry-after") and r.json()["because"] == "rate limit"
    assert client.get(f"{U}/state").status_code == 200, "reads have their own, larger allowance"
    lines = [json.loads(x) for x in api.AUDIT_FILE.read_text().splitlines()]
    assert lines and {"at", "by", "verb", "policy", "ok"} <= set(lines[-1])


def test_voice() -> None:
    reset()
    fx = json.loads((ROOT / "framework/spec/fixtures/console-control-voice.json").read_text())
    for phrase, intent in fx["intents"].items():
        assert cc.voice_intent(phrase) == intent, phrase
    for phrase, cmd in fx["commands"].items():
        i = cc.voice_intent(phrase)
        assert cc.intent_command(i, "view:build-orchestrator/grid:builds/row:b1" if i.get("find") else None) == cmd, phrase
    rep = fx["replies"]
    assert cc.voice_reply({"verb": "state", "help": True}, {"ok": True}) == rep["help"], "what can I say: the same line in both twins"
    assert cc.voice_reply({"verb": "press", "decision": "approve"}, {"ok": True}, "Approve") == rep["decided"]
    assert cc.screen_line({"view": "projects", "title": "Projects", "dialog": {"id": "new-project", "title": "New project"}, "fields": [{"label": "Name", "required": True, "value": ""}, {"label": "Template", "value": "blank"}],
                           "buttons": [{"label": "Create"}, {"label": "Cancel"}, {"label": "Off", "disabled": True}]}) == rep["screen"], "screen read-back line: the same in both twins"
    r = client.post(f"{U}/voice", json={"text": "what can I say"})
    assert r.status_code == 200 and r.json()["say"] == rep["help"] and r.json()["command"] is None
    r = client.post(f"{U}/voice", json={"text": "scroll down"})
    assert r.status_code == 200 and r.json()["command"] == {"verb": "scroll", "scroll": {"dir": "down"}} and r.json()["say"].startswith("Scrolled")
    r = client.post(f"{U}/voice", json={"text": "what time is it"})
    assert r.status_code == 400 and r.json()["intent"] is None and r.json()["say"]
    r = client.post(f"{U}/voice", json={"text": "show step 3 of loaded build"})
    assert r.json()["command"]["address"] == "row:b1/step:s3", "a build's step: search the build, then its step"


def test_mcp_tools() -> None:
    reset()

    def run(body: dict[str, Any]) -> dict[str, Any]:
        if body.get("verb") == "targets":
            return api.targets(str(body.get("under") or ""), None, str(body.get("source") or "auto"), "mcp")
        if body.get("verb") == "voice":
            return api.voice(str(body["text"]), "voice")
        return api.command(body, "mcp")

    srv = mcp_server.build_server(lambda op, **a: {}, console=lambda c: {"ok": True}, console_control=run)
    tools = {t.name: t for t in asyncio.run(srv.list_tools())}
    for name in mcp_server.CONSOLE_CONTROL_TOOLS:
        assert name in tools, name
    for name in ("console_control_targets", "console_control_state", "console_control_search", "console_control_focus", "console_control_scroll"):
        assert tools[name].annotations.read_only_hint is True, f"{name} reads or navigates"
    for name in ("console_control_do", "console_control_plugin", "console_control_voice"):
        assert tools[name].annotations.read_only_hint is not True, f"{name} writes"

    def call(name: str, args: dict[str, Any]) -> dict[str, Any]:
        res = asyncio.run(srv.call_tool(name, args))
        if isinstance(res, tuple):  # (content, structured) on older SDKs
            res = res[1]
        if isinstance(res, dict):
            return res.get("result", res)
        assert not getattr(res, "is_error", False), f"{name} failed: {res.content[0].text if res.content else ''}"
        if getattr(res, "structured_content", None):
            sc = res.structured_content
            return sc.get("result", sc)
        return json.loads(res.content[0].text)

    assert call("console_control_state", {})["state"]["screen"]
    assert call("console_control_focus", {"address": "view:settings"})["focused"] == "view:settings"
    assert call("console_control_search", {"q": "loaded"})["hits"][0]["address"] == "row:b1"
    assert call("console_control_targets", {"source": "inventory"})["source"] == "inventory"
    r = call("console_control_do", {"verb": "press", "address": "function:snapshots.delete"})
    assert r["code"] == "confirmation_required", "returned, not raised: the caller sees what to confirm"
    free = next(p for p in cc.inventory()["plugins"] if not p.get("core") and not any(d["required"] for d in cc.plugin_dependents(p, Ctx.plugin_enabled)))
    assert call("console_control_plugin", {"plugin": free["folder"], "enabled": False})["enabled"] is False
    call("console_control_plugin", {"plugin": free["folder"], "enabled": True})
    assert call("console_control_voice", {"text": "scroll down"})["say"]
    call("console_open", {"screen": "view:settings/tab:settings.tabs=plugins"})
    assert fake.sent[-1]["verb"] == "focus" and fake.sent[-1]["address"] == "view:settings/tab:settings.tabs=plugins", "console_open takes an address"
    fake.open = False
    r = call("console_control_state", {})
    assert r["code"] == "unavailable" and r["openUrl"], "no console: unavailable with the link, not an exception"



class WizardConsole(FakeConsole):
    """The Projects dialog with its New project form, as the open console's field discovery reports it."""

    def __init__(self) -> None:
        super().__init__()
        self.form: dict[str, Any] = {"name": "", "description": "", "switch-to-it-right-away": True}
        self.created: list[dict[str, Any]] = []
        self.pressed: list[str] = []

    def report(self) -> dict[str, Any]:
        base = "view:home/panel:dialog:projects"
        fields = [{"address": f"{base}/setting:field.name", "id": "field.name", "label": "Name", "type": "text", "value": self.form["name"], "required": False, "disabled": False},
                  {"address": f"{base}/setting:field.description", "id": "field.description", "label": "Description", "type": "textarea", "value": self.form["description"], "required": False, "disabled": False},
                  {"address": f"{base}/setting:field.switch-to-it-right-away", "id": "field.switch-to-it-right-away", "label": "Switch to it right away", "type": "switch", "value": self.form["switch-to-it-right-away"], "required": False, "disabled": False}]
        buttons = [{"address": f"{base}/button:create", "id": "create", "label": "Create", "role": "button", "disabled": not self.form["name"].strip()},
                   {"address": f"{base}/button:cancel", "id": "cancel", "label": "Cancel", "role": "button", "disabled": False},
                   {"address": f"{base}/button:approve", "id": "approve", "label": "Approve", "role": "button", "disabled": False}]
        return {"view": "home", "title": "Home", "dialog": {"id": "projects", "title": "Projects", "address": base}, "surface": base, "headings": ["Projects"], "fields": fields, "buttons": buttons, "text": "Projects New project"}

    def control(self, cmd: dict[str, Any], by: str = "", audience: str = "owner", to: str = "recent") -> dict[str, Any]:
        out = super().control(cmd, by, audience, to)
        verb, address = cmd["verb"], str(cmd.get("address") or "")
        leaf = address.rsplit("/", 1)[-1]
        if verb == "state" and not address:
            out["state"] = {**out["state"], "report": self.report()}
        elif verb == "set" and leaf.startswith("setting:field."):
            key = leaf[len("setting:field."):]
            if key not in self.form:
                return {"$axf": cc.FRAME, "ok": False, "code": "not_found", "message": f"{address} is not on the screen", "nearest": []}
            v = cmd.get("value")
            self.form[key] = (str(v).lower() in ("on", "true", "yes", "1")) if isinstance(self.form[key], bool) and not isinstance(v, bool) else v
            out["value"] = self.form[key]
        elif verb == "search":
            words = cc.slug(str((cmd.get("query") or {}).get("q") or ""))
            out["hits"] = [{"address": f["address"], "kind": "setting", "label": f["label"], "score": 100} for f in self.report()["fields"] if words and words in f["id"]] + \
                          [{"address": b["address"], "kind": "button", "label": b["label"], "score": 90} for b in self.report()["buttons"] if words and words in b["id"]]
        elif verb == "press":
            self.pressed.append(leaf)
            if leaf == "button:create":
                if not self.form["name"].strip():
                    return {"$axf": cc.FRAME, "ok": False, "code": "unavailable", "because": "disabled", "message": f"{address} is disabled right now"}
                self.created.append(dict(self.form))
        return out


def test_new_project_wizard_by_api() -> None:
    """Drive the New project form end to end through REST: read the screen, fill it by label, press Create, read back."""
    global fake
    reset()
    wiz = WizardConsole()
    api._relay = lambda: wiz  # type: ignore[assignment]
    try:
        r = client.get(f"{U}/screen")
        assert r.status_code == 200 and r.json()["screen"]["dialog"]["id"] == "projects", r.text
        assert [f["label"] for f in r.json()["screen"]["fields"]] == ["Name", "Description", "Switch to it right away"]
        assert r.json()["say"].startswith("You're on Projects dialog on Home."), r.json()["say"]
        assert "text" not in client.get(f"{U}/fields").json()["screen"], "fields: the same report without the text"
        # Create is disabled while the name is empty
        r = client.post(f"{U}/fill", json={"values": {}, "submit": "Create"})
        assert r.status_code != 200 and r.json()["pressed"]["ok"] is False and not wiz.created
        # by label (slug), by a label that needs search, and a switch
        r = client.post(f"{U}/fill", json={"values": {"Name": "Garden planner", "description": "Beds and seeds", "Switch to it right away": "off"}, "submit": "Create", "reason": "e2e: new project by API"})
        assert r.status_code == 200 and r.json()["ok"], r.text
        assert [f["address"].rsplit("/", 1)[-1] for f in r.json()["filled"]] == ["setting:field.name", "setting:field.description", "setting:field.switch-to-it-right-away"]
        assert wiz.created == [{"name": "Garden planner", "description": "Beds and seeds", "switch-to-it-right-away": False}], wiz.created
        assert r.json()["pressed"] == {"button": "Create", "address": "button:create", "ok": True} and r.json()["screen"]["fields"][0]["value"] == "Garden planner"
        # an unknown field stops the fill and names it
        r = client.post(f"{U}/fill", json={"values": {"Colour": "red"}})
        assert r.json()["ok"] is False and r.json()["filled"][0]["field"] == "Colour" and r.json()["message"].startswith("Colour:")
        # voice: type into a field (case kept), read the screen back, press a one-word button
        r = client.post(f"{U}/voice", json={"text": "Amber, type Seed Tracker into the name field"})
        assert r.json()["ok"] and wiz.form["name"] == "Seed Tracker", r.text
        r = client.post(f"{U}/voice", json={"text": "what's on the screen"})
        assert r.json()["ok"] and r.json()["say"].startswith("You're on Projects dialog"), r.text
        r = client.post(f"{U}/voice", json={"text": "create"})
        assert r.json()["ok"] and wiz.created[-1]["name"] == "Seed Tracker", r.text
        # every write is audited with who and why
        lines = client.get(f"{U}/audit?writes=true&limit=20").json()["lines"]
        sets = [x for x in lines if x.get("verb") == "set"]
        assert sets and all(x.get("by") and x.get("reason") for x in sets), sets[:3]
        assert any(x.get("reason") == "e2e: new project by API" for x in sets)
        assert any(str(x.get("reason", "")).startswith("said: ") for x in lines), "a voice command's reason is what was said"
        # the CLI maps to the same requests
        import subprocess
        out = subprocess.run(["node", "-e", "import('./framework/cli/console-control.mjs').then(m => console.log(JSON.stringify([m.toRequest(['fill', 'Name=Garden planner', '--submit', 'Create']), m.toRequest(['press', 'Create']), m.toRequest(['read'])])))"],
                             cwd=ROOT, capture_output=True, text=True, check=True).stdout
        fill_req, press_req, read_req = json.loads(out)
        assert fill_req["path"] == "/fill" and fill_req["body"]["values"] == {"Name": "Garden planner"} and fill_req["body"]["submit"] == "Create"
        assert press_req["body"]["address"] == api.button_address("Create") and read_req["path"] == "/screen"
    finally:
        api._relay = lambda: fake  # type: ignore[assignment]


def test_decisions_only_from_owner_session() -> None:
    reset()
    wiz = WizardConsole()
    api._relay = lambda: wiz  # type: ignore[assignment]
    try:
        r = api.command({"verb": "press", "address": "button:approve"}, "mcp")
        assert r["code"] == "denied" and r.get("personOnly") and "button:approve" not in wiz.pressed, "the shared token never decides"
        r = api.voice("approve", "voice")
        assert r["ok"] is False and r["code"] == "denied", "voice without Brett's own session is refused"
        r = api.voice("approve", "voice", owner="brett")
        assert r["ok"] and r["decidedBy"] == "owner:brett" and "button:approve" in wiz.pressed, r
        assert r["say"].endswith("done, as your decision."), r["say"]
        r = api.command({"verb": "press", "address": "button:approve"}, "web", audience="user:guest", owner="brett")
        assert r["code"] == "denied", "only the owner audience decides"
        last = [json.loads(x) for x in api.AUDIT_FILE.read_text().splitlines() if '"decidedBy"' in x]
        assert last and last[-1]["decidedBy"] == "owner:brett"

        class Req:
            class state:  # noqa: N801
                axf_user = None
        Req.state.axf_user = api._TOKEN_CALLER
        assert api.owner_of(Req) is None, "the console token is never a person"
        Req.state.axf_user = type("C", (), {"admin": True, "name": "brett"})()
        assert api.owner_of(Req) == "brett"
        Req.state.axf_user = type("C", (), {"admin": False, "name": "guest"})()
        assert api.owner_of(Req) is None
    finally:
        api._relay = lambda: fake  # type: ignore[assignment]


def test_mcp_fields_tools() -> None:
    reset()
    wiz = WizardConsole()
    api._relay = lambda: wiz  # type: ignore[assignment]
    try:
        srv = mcp_server.build_server(lambda op, **a: {}, console=lambda c: {"ok": True}, console_control=mcp_server.console_control_runner())
        tools = {t.name: t for t in asyncio.run(srv.list_tools())}
        assert tools["console_control_screen"].annotations.read_only_hint is True and tools["console_control_audit"].annotations.read_only_hint is True
        assert tools["console_control_fill"].annotations.read_only_hint is not True

        def call(name: str, args: dict[str, Any]) -> dict[str, Any]:
            res = asyncio.run(srv.call_tool(name, args))
            if isinstance(res, tuple):
                res = res[1]
            if isinstance(res, dict):
                return res.get("result", res)
            assert not getattr(res, "is_error", False), f"{name} failed: {res.content[0].text if res.content else ''}"
            if getattr(res, "structured_content", None):
                return res.structured_content.get("result", res.structured_content)
            return json.loads(res.content[0].text)
        r = call("console_control_screen", {})
        assert r["screen"]["dialog"]["id"] == "projects", r
        r = call("console_control_fill", {"values": {"Name": "From MCP"}, "submit": "Create", "reason": "mcp test"})
        assert r["ok"] and wiz.created[-1]["name"] == "From MCP", r
        r = call("console_control_audit", {"limit": 5})
        assert r["lines"] and r["lines"][0]["by"] == "mcp", r["lines"][:2]
    finally:
        api._relay = lambda: fake  # type: ignore[assignment]


if __name__ == "__main__":
    n = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            n += 1
    print(f"✓ console-control server — {n} tests (REST, guards, plugins, voice, MCP)")
