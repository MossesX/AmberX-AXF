#!/usr/bin/env python3
"""Self-test of the Claude accounts manager: the pure model (rows, dollars, order, moves, widget, settings) and the
routes against fake capabilities (axf.claude-accounts@1, axf.claude-usage@1, axf.build-dispatch@1).

  python3 apps/console-web/plugins/claude-accounts-manager/test.py
"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
os.environ["AXF_CLAUDE_ACCOUNTS_MANAGER_DIR"] = tempfile.mkdtemp(prefix="axf-cam-test-")
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.claude_accounts_manager_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)
M = mod.model

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
ok = 0


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


print("claude-accounts-manager self-test")

# ---------------- model
S = M.norm_settings({})
check(S["widget"]["show"] == ["number", "name", "left", "kind"] and S["overlay"]["scope"] == "console" and S["overlay"]["buttons"], "defaults: widget parts, console overlay with buttons")
bad = M.norm_settings({"overlay": {"scope": "moon", "dock": "middle", "w": 5, "buttons": [{"label": "", "action": "x"}, {"label": "Go", "icon": "Bad Icon!", "list": "nope", "menu": [{"label": "A", "action": "nav:x"}, {"action": "y"}]}]}, "widget": {"show": ["name", "secret"]}})
check(bad["overlay"]["scope"] == "console" and bad["overlay"]["dock"] == "free" and bad["overlay"]["w"] == 160, "overlay: unknown scope / dock fall back, size clamped")
check(len(bad["overlay"]["buttons"]) == 1 and bad["overlay"]["buttons"][0]["icon"] == "badicon" and bad["overlay"]["buttons"][0]["list"] == "" and len(bad["overlay"]["buttons"][0]["menu"]) == 1, "buttons: unlabeled dropped, icon cleaned, sub-menu items checked")
check(bad["widget"]["show"] == ["name"], "widget parts: unknown ones dropped")
m = M.merge_settings(S, {"overlay": {"locked": True}, "widget": {"account": "Account 2"}})
check(m["overlay"]["locked"] and m["overlay"]["buttons"] == S["overlay"]["buttons"] and m["widget"]["account"] == "account-2", "merge: one level deep; spoken names cleaned")

check(M.plan_price("max", "x", S) == 100 and M.plan_price("Claude Max 20x", "x", S) == 200 and M.plan_price("pro", "x", S) == 20 and M.plan_price("", "x", S) is None, "plan prices: Max, Max 20x, Pro, unknown")
check(M.plan_price("max", "hulu", M.norm_settings({"accountPrices": {"hulu": 200}})) == 200, "a per-account price beats the plan")

view = {"ready": True, "active": "console-acct", "accounts": [
    {"name": "console-acct", "active": True, "kind": "subscription", "role": "interactive", "plan": "max", "email": "b@x.com", "label": "", "running": [], "limited": None},
    {"name": "w-max", "active": False, "kind": "subscription", "role": "worker", "plan": "max", "email": "w@x.com", "label": "Hulu", "running": ["s1"], "limited": None},
    {"name": "w-out", "active": False, "kind": "subscription", "role": "worker", "plan": "pro", "email": "", "label": "", "running": [], "limited": None},
    {"name": "hulu-api", "active": False, "kind": "api", "role": "api-worker", "plan": "", "hasKey": True, "running": [], "limited": None,
     "spend": {"day": 2, "week": 12.5, "dayCap": 10, "weekCap": 50, "state": "ok", "why": ""}},
    {"name": "cap-api", "active": False, "kind": "api", "role": "api-worker", "hasKey": True, "running": [], "limited": None,
     "spend": {"day": 10, "week": 10, "dayCap": 10, "weekCap": 0, "state": "capped", "why": "daily cap $10 reached"}},
]}
usage = {"accounts": [
    {"name": "console-acct", "fiveHour": {"used": 10, "resetsAt": "2026-11-10T20:00:00Z"}, "weekly": {"used": 40, "resetsAt": "2026-11-14T00:00:00Z"}},
    {"name": "w-max", "fiveHour": {"used": 80}, "weekly": {"used": 25}},
    {"name": "w-out", "fiveHour": {"used": 100, "resetsAt": "2026-11-10T18:00:00Z"}, "weekly": {"used": 60}},
]}
dispatch = [{"name": "console-acct", "usable": False, "why": "not a worker", "running": 0}, {"name": "w-max", "usable": True, "running": 1},
            {"name": "hulu-api", "usable": False, "why": "API key (billed per token): not in the account order", "running": 0}]
R = M.rows(view, usage, dispatch, [], S)
by = {r["name"]: r for r in R["accounts"]}
check(R["order"] == ["console-acct", "w-max", "w-out"] and not R["orderSaved"], "no saved order: the subscriptions in host order")
check(by["hulu-api"]["n"] is None and not by["hulu-api"]["inOrder"], "API accounts sit out of an unset order")
check(by["w-max"]["status"] == "builder" and by["w-max"]["display"] == "Hulu" and by["w-out"]["status"] == "worker" and by["console-acct"]["status"] == "console", "builder / worker / console account; labels shown")
check(by["w-out"]["outOfCredits"] and "usage limit" in by["w-out"]["creditsWhy"], "a full 5-hour window = out of credits")
check(by["cap-api"]["outOfCredits"] and "daily cap" in by["cap-api"]["creditsWhy"], "an API key at its cap = out of credits")
wk = round(100 * 7 / M.DAYS_PER_MONTH, 2)
check(by["console-acct"]["totalUsd"] == wk and by["console-acct"]["usedUsd"] == round(wk * 0.4, 2) and by["console-acct"]["leftPct"] == 60, "subscription dollars: plan price over the week × weekly percent")
check(by["w-max"]["leftPct"] == 20, "percent left = the tighter of the 5-hour and weekly windows")
check(by["hulu-api"]["totalUsd"] == 50 and by["hulu-api"]["usedUsd"] == 12.5 and by["hulu-api"]["leftUsd"] == 37.5 and by["hulu-api"]["usdBasis"] == "weekly spend cap", "API dollars: spend against the weekly cap")
check(by["cap-api"]["totalUsd"] == 10 and by["cap-api"]["leftPct"] == 0, "API without a weekly cap: the daily cap")
check(R["totals"]["accounts"] == 5 and R["totals"]["out"] == 2 and R["totals"]["api"] == 2 and R["totals"]["builders"] == 1, "totals")
R2 = M.rows(view, usage, dispatch, ["hulu-api", "w-max", "gone"], S)
check(R2["order"] == ["hulu-api", "w-max"] and R2["accounts"][0]["name"] == "hulu-api" and R2["accounts"][0]["n"] == 1 and R2["orderSaved"], "a saved order: API first is #1; unknown names dropped")
check([r["n"] for r in R2["accounts"][2:]] == [None, None, None], "accounts left out of a saved order carry no number")
R3 = M.rows(view, usage, dispatch, ["hulu-api", "w-max"], S, "auto")
check(R3["mode"] == "auto" and R3["order"] == ["console-acct", "w-max", "w-out", "hulu-api", "cap-api"], "automatic: every subscription, then every API account")
check(all(r["inOrder"] for r in R3["accounts"]) and R3["customOrder"] == ["hulu-api", "w-max"], "automatic numbers every account; the saved drag-and-drop order is kept")
check("only when every subscription is full" in {r["name"]: r for r in R3["accounts"]}["hulu-api"]["why"], "automatic: an API row says when it takes a build")
check(R2["mode"] == "custom" and M.rows(view, usage, dispatch, [], S, "bogus")["mode"] == "custom", "custom by default")
check(M.clean_mode("Automatic") == "auto" and M.clean_mode("manual") == "custom" and M.clean_mode(True) == "auto" and M.clean_mode("sideways") == "", "mode words")

check(M.moved(["a", "b", "c"], "c", "top") == ["c", "a", "b"] and M.moved(["a", "b", "c"], "a", "down") == ["b", "a", "c"] and M.moved(["a", "b", "c"], "b", "up") == ["b", "a", "c"], "moves: top, down, up")
check(M.moved(["a", "b"], "x", "bottom") == ["a", "b", "x"] and M.moved(["a", "b", "c"], "c", 1) == ["c", "a", "b"] and M.moved(["a", "b"], "a", "out") == ["b"], "moves: add at the bottom, a position, out")
try:
    M.moved(["a"], "a", "sideways")
    check(False, "a bad move is refused")
except ValueError:
    check(True, "a bad move is refused")
check(M.widget_text(by["hulu-api"], ["number", "name", "left", "kind"]) == "hulu-api · $37.50 left · API", "widget line from the picked parts")
check(M.widget_text(R2["accounts"][0], ["number", "email", "status"]) == "#1 · worker", "widget: number, no email, status")
check(M.session_open("w-max", "subscription") == {"kind": "claude", "via": "vps", "account": "w-max", "title": "Claude: w-max"}, "Claude Code as an account: a VPS tab with that account")
check(M.add_open("hulu-api", "api")["setup"] == "savekey:hulu-api" and M.add_open("account-6", "subscription")["setup"] == "login:account-6", "add: the key prompt or the login")


# ---------------- routes over fake capabilities
class Accounts:
    labels: list = []
    signins: list = []

    def view(self):
        return view

    def label(self, name, label, by):
        self.labels.append((name, label, by))
        return {"ok": True, "name": name, "label": label, "message": f"{name} is shown as {label}."}

    def signin(self, name, by):
        self.signins.append((name, by))
        return {"ok": True, "state": "waiting"}


class Usage:
    def usage(self, refresh=False):
        return usage


class Dispatch:
    cur: list = ["w-max", "console-acct"]
    calls: list = []

    def accounts(self):
        return dispatch

    def order(self):
        return list(self.cur)

    def set_order(self, names, brett=""):
        self.calls.append((list(names), brett))
        api = {"hulu-api", "cap-api"}
        if not brett and any(n in api and (n not in self.cur or names.index(n) < self.cur.index(n)) for n in names):
            raise HTTPException(403, "Brett's own click")
        self.cur = list(names)
        return list(names)

    mode = "custom"

    def order_mode(self):
        return self.mode

    def set_order_mode(self, mode, brett=""):
        if mode == "auto" and not brett and any(n not in self.cur for n in ("hulu-api", "cap-api")):
            raise HTTPException(403, "Brett's own click")
        self.mode = mode
        return mode


r = c.get("/p/accounts")
check(r.status_code == 503, "no axf.claude-accounts@1: 503 says what is missing")
acc, disp = Accounts(), Dispatch()
plugin_services.provide("axf.claude-accounts@1", acc, "fake-accounts")
plugin_services.provide("axf.claude-usage@1", Usage(), "fake-badges")
plugin_services.provide("axf.build-dispatch@1", disp, "fake-orchestrator")
j = c.get("/p/accounts").json()
check(j["ok"] and j["order"] == ["w-max", "console-acct"] and j["accounts"][0]["n"] == 1 and j["usage"] and j["dispatch"], "GET accounts: the dispatcher's order, numbered")
j = c.post("/p/move", json={"name": "console-acct", "to": "top"}).json()
check(j["order"] == ["console-acct", "w-max"] and disp.calls[-1] == (["console-acct", "w-max"], ""), "move to the top: the whole order goes to the dispatcher")
r = c.post("/p/move", json={"name": "hulu-api", "to": "top"})
check(r.status_code == 403, "a session adding an API account to the order: 403 (Brett's click)")
r = c.post("/p/order", json={"order": ["w-max", "Console Acct"]})
check(r.status_code == 200 and disp.cur == ["w-max", "console-acct"], "POST order: names cleaned")
check(c.get("/p/mode").json()["mode"] == "custom", "GET mode: custom by default")
check(c.post("/p/mode", json={"mode": "auto"}).status_code == 403, "a session switching to automatic with API keys outside the order: 403 (Brett's click)")
check(c.post("/p/mode", json={"mode": "sideways"}).status_code == 400, "a bad mode is 400")
disp.mode = "auto"
j = c.get("/p/accounts").json()
check(j["mode"] == "auto" and j["order"][-2:] == ["hulu-api", "cap-api"] and j["customOrder"] == ["w-max", "console-acct"], "GET accounts in automatic: subscriptions then API; the custom order kept")
j = c.post("/p/move", json={"name": "console-acct", "to": "top"}).json()
check(disp.cur == ["console-acct", "w-max"] and "Automatic" in j["message"], "a move in automatic edits the saved custom order and says it waits for Custom")
j = c.post("/p/mode", json={"mode": "toggle"}).json()
check(j["mode"] == "custom" and disp.mode == "custom" and "drag-and-drop order exactly" in j["message"], "toggle: back to custom")
c.post("/p/order", json={"order": ["w-max", "console-acct"]})
check(c.post("/p/move", json={"name": "nobody", "to": "up"}).status_code == 404 and c.post("/p/move", json={"name": "w-max", "to": "left"}).status_code == 400, "move: unknown account 404, bad place 400")
j = c.post("/p/rename", json={"name": "w-max", "label": "Hulu"}).json()
check(j["ok"] and acc.labels[-1][:2] == ("w-max", "Hulu"), "rename goes through axf.claude-accounts@1")
j = c.post("/p/add", json={"name": "account-6", "kind": "subscription"}).json()
check(j["open"]["setup"] == "login:account-6" and j["action"] == "claude-accounts-manager.add:subscription:account-6" and not acc.signins, "add (console): the Terminal tab, no held call")
j = c.post("/p/add", json={"name": "account-6", "kind": "subscription", "signin": True}).json()
check(acc.signins[-1][0] == "account-6" and j["terminal"] == "axf-signin-account-6", "add from MCP / voice: the held sign-in and its tmux session")
j = c.post("/p/add", json={"name": "new-api", "kind": "api"}).json()
check(j["open"]["setup"] == "savekey:new-api" and "hidden prompt" in j["message"], "add an API key: the host's hidden prompt, never here")
check(c.post("/p/add", json={"name": "Bad Name!", "kind": "api"}).status_code == 400, "add: a bad name is 400")
j = c.post("/p/session", json={"name": "hulu-api"}).json()
check(j["open"]["account"] == "hulu-api" and j["action"] == "claude-accounts-manager.session:hulu-api", "session: the tab and the console action")
check(c.post("/p/session", json={"name": "nobody"}).status_code == 404, "session: unknown account 404")
j = c.post("/p/settings", json={"overlay": {"open": True, "scope": "os", "dock": "right"}, "widget": {"account": "hulu-api", "show": ["name", "left"]}}).json()
check(j["settings"]["overlay"]["open"] and j["settings"]["overlay"]["scope"] == "os" and j["settings"]["overlay"]["dock"] == "right", "settings: the overlay is opened, scoped and docked by API")
check(c.get("/p/settings").json()["settings"]["widget"]["account"] == "hulu-api", "settings persist in the data folder")
j = c.get("/p/widget").json()
check(j["account"] == "hulu-api" and j["text"] == "hulu-api · $37.50 left", "GET widget: what the banner shows now")


class User:
    via, admin, name = "session", False, "guest"


guest_app = FastAPI()


@guest_app.middleware("http")
async def guest(request, call_next):  # noqa: ANN001
    request.state.axf_user = User()
    return await call_next(request)

guest_app.include_router(mod.router, prefix="/p")
check(TestClient(guest_app).get("/p/accounts").status_code == 403, "a signed-in non-owner gets 403")
check(plugin_services.get("axf.claude-accounts-manager@1") is not None, "axf.claude-accounts-manager@1 is provided")
print(f"claude-accounts-manager: {ok} checks passed")
