"""Build orchestrator server self-test: the "Console sees the builds" systems check (auto-land s5, Nov 3 2026).

    python apps/console-web/plugins/build-orchestrator/test.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from importlib import import_module
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]  # apps/console-web
sys.path.insert(0, str(ROOT / "server"))
sys.path.insert(0, str(HERE.parent))

os.environ["AXF_OPTIMIZER_SCHEDULE"] = "off"  # no schedule thread in the test
srv = import_module("build-orchestrator.server")
n = 0


def check(ok: bool, name: str) -> None:
    global n
    if not ok:
        raise SystemExit(f"✗ {name}")
    n += 1
    print(f"  ✓ {name}")


now = time.time()
iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))  # noqa: E731
with tempfile.TemporaryDirectory() as d:
    month = Path(d) / time.strftime("%Y/%m", time.gmtime(now))
    month.mkdir(parents=True)
    (month / "chg-1.json").write_text(json.dumps({"status": "running", "lastSeenAt": iso(now - 60), "title": "auto-land"}))
    (month / "chg-2.json").write_text(json.dumps({"status": "running", "lastSeenAt": iso(now - 3 * 3600), "title": "stale"}))
    (month / "chg-3.json").write_text(json.dumps({"status": "done", "lastSeenAt": iso(now), "title": "finished"}))
    run = srv.running_now(now, Path(d))
    check(run == ["auto-land"], "only Build manager entries running with a fresh heartbeat count")

r = srv.sees_probe({"total": 0, "error": "store.json: unexpected end of JSON"}, ["auto-land"])
check(r["status"] == "error" and "0 builds while 1 build(s) run" in r["summary"] and "unexpected end" in r["summary"], "builds running + console sees 0 = red, with why")
check(srv.sees_probe({"total": 0}, [])["status"] == "ok", "nothing running and nothing seen = fine")
r = srv.sees_probe({"total": 276, "running": [{"id": "x"}]}, ["auto-land"])
check(r["status"] == "ok" and "276 build(s)" in r["summary"], "builds seen = green")
r = srv.sees_probe(None, [])
check(r["status"] == "ok" and "build(s)" in r["summary"], "the real read (framework/cli/build-queue.mjs buildsSummary) answers")

# ---- build-package@1: owner-only on the primary, send through Session sync, best-effort chat
class _Req:
    def __init__(self, headers=None, admin=False):
        self.headers = {k.lower(): v for k, v in (headers or {}).items()}
        self.state = type("S", (), {"axf_user": type("U", (), {"via": "session", "admin": True, "name": "brett"})() if admin else None})()


class _Sync:
    def __init__(self, offer_ok=True, has_offer=True):
        self.offers = []
        if has_offer:
            self.offer = self._offer
        self.ok = offer_ok

    def link(self):
        return {"primary": {"session": "s-1", "account": "brett"}, "sessions": {"s-1": {"id": "s-1", "account": "brett"}, "s-2": {"id": "s-2", "account": "helper", "agent": "rio"}, "s-3": {"id": "s-3", "account": "x", "endedAt": "t"}}}

    def role_of(self, session, account=""):
        return "primary" if session == "s-1" or account == "brett" else "secondary"

    def _offer(self, req, who):
        self.offers.append((req, who))
        return {"ok": True, "offer": {"id": "o-1"}} if self.ok else {"ok": False, "message": "no helper"}


real_get = srv.plugin_services.get
try:
    srv.plugin_services.get = lambda cap: None  # no Session sync: everyone here is the primary
    check(srv.package_role(_Req({"X-Axf-Session": "s-2"})) == "primary", "without Session sync the caller is the primary")
    check(srv.send_to_helper("pkg-x", "", True, _Req())["sent"] is False, "without Session sync a package stays in the orchestrator, with why")
    check(srv.post_chat("hi") is False, "no crew chat = nothing posted, no error")
    sync = _Sync()
    srv.plugin_services.get = lambda cap: sync if cap == srv.SYNC_CAP else None
    check(srv.package_role(_Req({"X-Axf-Session": "s-2", "X-Axf-Account": "helper"})) == "secondary", "a helper session is secondary")
    check(srv.package_role(_Req({"X-Axf-Session": "s-2"}, admin=True)) == "primary", "Brett's own click is always the owner")
    check(srv.package_role(_Req({"X-Axf-Session": "s-1"})) == "primary", "the primary session is the owner")
    try:
        srv._owner_only(_Req({"X-Axf-Session": "s-2", "X-Axf-Account": "helper"}))
        check(False, "secondary refused")
    except srv.HTTPException as e:
        check(e.status_code == 403, "a secondary is refused server-side (403), whatever its UI shows")
    check([h["id"] for h in srv.helpers()] == ["s-2"], "helpers = live sessions of other accounts")
    calls = []
    real_pack = srv._pack
    srv._pack = lambda *a, **k: calls.append(a) or {"ok": True}
    r = srv.send_to_helper("pkg-x", "s-2", True, _Req())
    check(r["sent"] and sync.offers[0][0] == {"build": "pkg-x", "mode": "whole", "to": "s-2", "reason": "Build package pkg-x (do it now)", "priority": "now"}, "send = one whole-build offer through axf.session-sync@1, do it now = priority now")
    check(calls and calls[0][0] == "mark-sent" and '"offer": "o-1"' in calls[0][2], "the sent package is recorded on the build (offer id)")
    sync.ok = False
    check(srv.send_to_helper("pkg-x", "s-2", False, _Req())["why"] == "no helper", "a refused offer says why")
    srv._pack = real_pack
    line = srv._chat_line({"id": "pkg-x", "title": "Night", "steps": [{"model": "Fable", "text": "do it", "origin": {"build": "alpha"}}]}, {"sent": True, "to": "s-2"}, {"now": True})
    check(line.startswith('Package pkg-x "Night" sent to s-2 (do it now): 1 step(s).') and "1. [Fable] do it (alpha)" in line, "the Sessions channel line lists the package and its contents")
finally:
    srv.plugin_services.get = real_get

# ---- build optimizer (build-optimize@1): Deep mode with a fake AI, every fallback to Basic, notifications
with tempfile.TemporaryDirectory() as d:
    step = lambda b, i, text, f: {"id": f"s{i}", "uid": f"{b}-s{i}", "text": text, "model": "Opus", "estimate": "20 min", "files": [f]}  # noqa: E731
    builds = [{"id": b, "title": b, "status": "pending", "profiles": ["p"], "order": {"p": i}, "createdAt": "2026-11-01T00:00:00Z", "steps": [step(b, 1, f"{b} grid work", "apps/console-web/plugins/changes-grid/web/a.tsx")]} for i, b in enumerate(["alpha", "beta"])]
    Path(d, "store.json").write_text(json.dumps({"$axf": "builds@1", "rev": 1, "builds": builds}))
    os.environ.update(AXF_BUILDS_STORE=str(Path(d, "store.json")), AXF_OPTIMIZER_FILE=str(Path(d, "opt.json")), AXF_BUILDS_LIVE="0")
    alerts: list[dict] = []
    srv.cx.raise_alert = lambda a: alerts.append(a)  # type: ignore[attr-defined]

    class FakeLlm:
        def __init__(self, text: str = "", fail: bool = False) -> None:
            self.text, self.fail, self.calls = text, fail, 0
        def profiles(self): return [{"id": "fake"}]
        def complete(self, messages, system=None, profile=None, model=None, tools=None, params=None):
            self.calls += 1
            if self.fail:
                raise RuntimeError("provider down")
            return {"text": self.text, "usage": {"input_tokens": 100, "output_tokens": 50}}

    real = srv.plugin_services.get
    try:
        srv.plugin_services.get = lambda name: None  # no AI connection at all
        r = srv.run_optimizer({"mode": "auto"})
        check(r["plan"]["mode"] == "basic" and r["plan"]["run"]["fellBack"] and r["notified"] and "AI wasn't available" in alerts[-1]["title"], "Auto with no AI runs Basic and says so (default notification)")
        check(len(r["plan"]["packs"]) == 1 and len(r["plan"]["packs"][0]["keys"]) == 2, "Basic packs both builds' grid steps into one build")
        key = r["plan"]["packs"][0]["keys"][0]
        ok = FakeLlm("Here you go:\n```json\n" + json.dumps({"packs": [{"id": "pack-1", "name": "Grid polish", "why": "same grid"}], "drops": [{"key": key, "kind": "duplicate", "why": "same as beta"}]}) + "\n```")
        srv.plugin_services.get = lambda name: ok if name == srv.LLM_CAP else None
        n_alerts = len(alerts)
        r = srv.run_optimizer({})
        check(r["plan"]["mode"] == "deep" and r["plan"]["packs"][0]["ai"]["name"] == "Grid polish" and r["plan"]["flags"][key]["ai"], "Deep mode (default with AI) lays the checked AI answer over the plan")
        check(not r["notified"] and len(alerts) == n_alerts, "a Deep run doesn't notify with 'only when AI isn't available'")
        est = srv.run_optimizer({"estimateOnly": True})
        check(est["estimate"] > 0 and est["mode"] == "deep", "Deep mode shows its token estimate before it runs")
        bad = FakeLlm(fail=True)
        srv.plugin_services.get = lambda name: bad if name == srv.LLM_CAP else None
        r = srv.run_optimizer({})
        check(r["plan"]["mode"] == "basic" and "provider down" in r["plan"]["run"]["why"], "an AI error falls back to Basic silently (the plan still comes)")
        junk = FakeLlm("not json at all")
        srv.plugin_services.get = lambda name: junk if name == srv.LLM_CAP else None
        check(srv.run_optimizer({})["plan"]["mode"] == "basic", "an answer that doesn't parse falls back to Basic")
        srv.plugin_services.get = lambda name: ok if name == srv.LLM_CAP else None
        calls = ok.calls
        r = srv.run_optimizer({"settings": {"tokenBudget": 10}})
        check(r["plan"]["mode"] == "basic" and "budget" in r["plan"]["run"]["why"] and ok.calls == calls, "over the token budget = Basic, and the AI is never called")
        r = srv.run_optimizer({"mode": "basic", "settings": {"notify": "every"}})
        check(r["notified"] and alerts[-1]["title"].endswith("Ran in Basic mode"), "'Every run' notifies a chosen Basic run too")
        from datetime import datetime as _dt
        check(srv.schedule_due({"settings": {"schedule": "nightly"}, "scheduled": {}}, "", _dt(2026, 11, 4, 3)) and not srv.schedule_due({"settings": {"schedule": "nightly"}, "scheduled": {"at": "2026-11-04T02:10:00"}}, "", _dt(2026, 11, 4, 3)), "nightly schedule runs once a night")
        check(srv.schedule_due({"settings": {"schedule": "after-new"}, "scheduled": {"at": "2026-11-01"}}, "2026-11-02T00:00:00Z", _dt.now()) and not srv.schedule_due({"settings": {"schedule": "manual"}}, "2099", _dt.now()), "after-new runs after a new build; manual never")
    finally:
        srv.plugin_services.get = real
print(f"build-orchestrator: {n} checks passed")
