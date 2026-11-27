"""The build watchdog's console routes (build-watchdogs@1, server/watchdogs.py) against a scratch folder.

  python3 apps/console-web/plugins/build-orchestrator/server/test_watchdogs.py

Status lists every watch; settings are one flat map, each key checked (a bad key or value is a 400); from the console
container (AXF_WATCHDOG_HOST=request) Run asks the host for a pass and Scan answers with the host's last pass; the
systems check item is amber when off, red when no pass ran, green after one. Runs the real watchdog.mjs CLI.
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
sys.path.insert(0, str(ROOT / "apps/console-web/server"))

from fastapi import HTTPException  # noqa: E402

n = 0


def check(ok: bool, name: str) -> None:
    global n
    if not ok:
        raise SystemExit(f"✗ {name}")
    n += 1
    print(f"  ✓ {name}")


class Req:
    def __init__(self, body: dict | None = None):
        self._body = body

    async def json(self):
        if self._body is None:
            raise ValueError("no body")
        return self._body


def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="axf-watchdogs-api-"))
    os.environ.update({
        "AXF_WATCHDOGS_DIR": str(tmp / "wd"), "AXF_WATCHDOG_DIR": str(tmp / "rows"), "AXF_PIPELINE_DIR": str(tmp / "pipe"), "AXF_WATCHDOG_NOTIFY_LOG": str(tmp / "alerts.jsonl"),
        "AXF_BUILDS_STORE": str(tmp / "store.json"), "AXF_BUILDS_LIVE": "0", "AXF_BUILD_HOOKS": "off", "AXF_SHIPPED": "off", "AXF_DATA_DIR": "off", "AXF_BUILD_PROFILE": "all",
        "AXF_PIPELINE_CONSOLE": "off", "AXF_CREW_SAY": "off", "AXF_WATCHDOG_CRON": "off", "AXF_WATCHDOG_HOST": "request",
    })
    (tmp / "store.json").write_text(json.dumps({"$axf": "builds@1", "version": 1, "builds": []}))
    spec = importlib.util.spec_from_file_location("orch_watchdogs", HERE / "watchdogs.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    router = mod.router_for("build-orchestrator", lambda request: "brett")
    route = {(next(iter(r.methods)), r.path): r.endpoint for r in router.routes}
    run = asyncio.run

    st = route[("GET", "/watchdogs")]()
    check([w["id"] for w in st["watches"]] == ["sessions", "stale", "rows"] and all(w["available"] for w in st["watches"]), "status lists the three watches, all loadable")
    check(st["host"] is False and st["stale"] is True and st["lastPass"] == "", "no pass yet: stale, and the console knows it is not the host")

    s = route[("GET", "/watchdogs/settings")]()
    check(s["values"]["enabled"] is True and s["values"]["alerts"] == "batch" and s["values"]["stale.limit.fixing"] == 60 and s["schema"]["sessions.maxRetries"]["watch"] == "sessions", "settings: one flat map with every watch's keys and their schema")
    out = run(route[("PUT", "/watchdogs/settings")](Req({"stale.limit.fixing": 45, "alerts": "each", "sessions.maxRetries": 5, "rows.intervalMin": 10})))
    check(out["ok"] and out["values"]["stale.limit.fixing"] == 45 and out["values"]["alerts"] == "each" and out["values"]["sessions.maxRetries"] == 5 and out["values"]["rows.intervalMin"] == 10, "PUT saves host and per-watch settings in one call")
    for body, why in (({"nope": 1}, "an unknown key"), ({"stale.limit.fixing": 1}, "a value out of range"), ({"alerts": "loud"}, "a bad choice"), ({}, "an empty patch")):
        try:
            run(route[("PUT", "/watchdogs/settings")](Req(body)))
            check(False, f"{why} is refused")
        except HTTPException as e:
            check(e.status_code == 400, f"{why} is a 400")
    check(route[("GET", "/watchdogs/settings")]()["values"]["stale.limit.fixing"] == 45, "a refused patch changes nothing")

    check(route[("GET", "/watchdogs/caught")]()["caught"] == [], "nothing caught yet")
    for q, why in (({"watch": "Bad Watch"}, "a bad watch id"), ({"build": "../etc"}, "a bad build id")):
        try:
            route[("GET", "/watchdogs/caught")](**q)
            check(False, f"{why} is refused")
        except HTTPException as e:
            check(e.status_code == 400, f"{why} is a 400")

    r = run(route[("POST", "/watchdogs/run")](Req({"watch": "stale", "build": "some-build"})))
    check(r["requested"] is True and r["watch"] == "stale" and r["build"] == "some-build" and r["by"] == "console:brett", "from the console container Run asks the host for the pass")
    check(route[("GET", "/watchdogs")]()["request"]["build"] == "some-build", "the request waits for the host's next cron minute")
    sc = route[("GET", "/watchdogs/scan")]()
    check(sc["source"] == "host-last-pass" and "last pass" in sc["note"], "Scan from the container answers with the host's last pass")

    check(mod.health_probe({"enabled": False})["status"] == "warn", "systems check: amber when the watchdog is off")
    red = mod.health_probe({"enabled": True, "stale": True, "ageMin": 42, "watches": []})
    check(red["status"] == "error" and "42 min" in red["summary"] and any("install-cron" in d for d in red["details"]), "red when no pass ran, with the fix command")
    amber = mod.health_probe({"enabled": True, "stale": False, "ageMin": 1, "watches": [{"id": "stale", "label": "Stuck statuses", "enabled": True, "lastError": "GitHub 502"}]})
    check(amber["status"] == "warn" and "GitHub 502" in amber["summary"], "amber when a watch's last run failed")
    ok = mod.health_probe({"enabled": True, "stale": False, "ageMin": 1, "watches": [{"id": "rows", "label": "Left-over rows", "enabled": True}, {"id": "sessions", "label": "Build sessions", "enabled": False}], "caught": [{}]})
    check(ok["status"] == "ok" and "1 of 2 watches on" in ok["summary"] and "Off: Build sessions" in ok["summary"], "green after a pass, naming any watch that is off")
    print(f"watchdogs api: {n} checks passed")


if __name__ == "__main__":
    main()
