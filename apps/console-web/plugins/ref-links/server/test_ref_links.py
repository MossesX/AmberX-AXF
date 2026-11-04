"""Reference links server part: targets merge the open console's catalog, agents and UI Review items; find / resolve;
open sends refs.<how> to the console through console-commands@1 (encoded id, `to`, `by`); missing refs and a missing
Console commands plugin answer clearly; the capability.

    python apps/console-web/plugins/ref-links/server/test_ref_links.py
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "server"))  # plugin_services

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import plugin_services  # noqa: E402

CATALOG = {"console.screens": [{"kind": "screen", "id": "plan-studio", "label": "Plan Studio"}, {"kind": "screen", "id": "terminal", "label": "Terminal"}],
           "console.dialogs": [{"kind": "dialog", "id": "about", "label": "About this console"}],
           "console.settings": [{"kind": "settings", "id": "terminal", "label": "Terminal"}]}


class FakeConsole:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    def run(self, command: dict, grants=None, by: str = "", audience: str = "owner") -> dict:
        if command.get("op") == "list":
            return {"ok": True, "data": {"items": CATALOG.get(command["target"], [])}}
        self.sent.append({**command, "_by": by})
        return {"ok": True, "delivered": [{"client": "cc-test", "ok": True, "message": "opened"}]}


class FakeAgents:
    def list_agents(self) -> list[dict]:
        return [{"id": "paulie", "name": "Ping Paulie", "role": "builder"}]


class FakeReview:
    def items(self, branch: str = "", pr=None) -> list[dict]:
        return [{"id": "rv-1", "name": "Terminal tabs", "status": "waiting", "branch": branch}] if branch == "claude/banner-ref-links" else []


console = FakeConsole()
plugin_services.provide("console-commands@1", console, folder="fake-console")
plugin_services.provide("axf.agents@1", FakeAgents(), folder="fake-agents")
plugin_services.provide("ui-review@1", FakeReview(), folder="fake-review")

spec = importlib.util.spec_from_file_location("ref_links_server", HERE / "__init__.py")
rl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rl)  # type: ignore[union-attr]
app = FastAPI()
app.include_router(rl.router, prefix="/api/plugins/ref-links")
client = TestClient(app)

fails = 0
n = 0


def check(name: str, ok: bool, detail: object = "") -> None:
    global fails, n
    n += 1
    if not ok:
        fails += 1
        print(f"✗ {name}\n  {detail}")


r = client.get("/api/plugins/ref-links/targets").json()
ids = {t["id"]: t for t in r.get("targets", [])}
check("targets: the console catalog", "screen:plan-studio" in ids and "settings:terminal" in ids and "dialog:about" in ids, list(ids)[:10])
check("targets: agents", ids.get("agent:paulie", {}).get("label") == "Ping Paulie")
check("targets: builds from the store", "build:banner-ref-links" in ids)
b = ids.get("build:banner-ref-links", {})
check("targets: a build in progress has its UI Review items", b.get("status") not in ("running", "built", "pending") or b.get("reviews", [{}])[0].get("id") == "rv-1", b)

r = client.post("/api/plugins/ref-links/find", json={"text": "Ping Paulie moved the Plan Studio screen and Terminal settings"}).json()
refs = [s["ref"] for s in r.get("spans", [])]
check("find: agent, screen, settings", refs == ["agent:paulie", "screen:plan-studio", "settings:terminal"], refs)
check("find: empty text = 422", client.post("/api/plugins/ref-links/find", json={"text": ""}).status_code == 422)

r = client.post("/api/plugins/ref-links/resolve", json={"ref": "about console"}).json()
check("resolve: by words", r.get("target", {}).get("id") == "dialog:about", r)
check("resolve: nothing = 404", client.post("/api/plugins/ref-links/resolve", json={"ref": "zzz nothing"}).status_code == 404)

res = client.post("/api/plugins/ref-links/open", json={"ref": "settings.terminal", "how": "open", "to": "all", "by": "test"})
sent = console.sent[-1] if console.sent else {}
check("open: 200 with the consoles' acks", res.status_code == 200 and res.json().get("delivered", [{}])[0].get("client") == "cc-test", res.text)
check("open: runs refs.open with the encoded id", sent.get("target") == "console.actions" and sent.get("path") == "refs.open" and sent.get("input", {}).get("args") == ["settings%3Aterminal"], sent)
check("open: to + by pass through", sent.get("input", {}).get("to") == "all" and sent.get("by") == "test", sent)
client.post("/api/plugins/ref-links/open", json={"ref": "plan studio", "how": "window"})
check("open: how=window", console.sent[-1].get("path") == "refs.window" and console.sent[-1]["input"]["args"] == ["screen%3Aplan-studio"], console.sent[-1])
before = len(console.sent)
check("open: a bad how = 422", client.post("/api/plugins/ref-links/open", json={"ref": "plan studio", "how": "delete"}).status_code == 422)
check("open: nothing to open = 404, nothing sent", client.post("/api/plugins/ref-links/open", json={"ref": "zzz nothing"}).status_code == 404 and len(console.sent) == before)
client.post("/api/plugins/ref-links/open", json={"ref": "#4242"})
check("open: a PR not in the store still opens (GitHub link)", console.sent[-1]["input"]["args"] == ["pr%3A4242"], console.sent[-1])

svc = plugin_services.get("ref-links@1")
check("capability ref-links@1", svc is not None and svc.resolve("plan studio").get("target", {}).get("id") == "screen:plan-studio")

plugin_services.provide("console-commands@1", None, folder="fake-console")  # Console commands removed
r = rl.open_ref("plan studio")
check("open without Console commands says so", r.get("ok") is False and "Console commands" in r.get("message", ""), r)

print(f"{'✗' if fails else '✓'} ref-links server: {n - fails}/{n} checks")
sys.exit(1 if fails else 0)
