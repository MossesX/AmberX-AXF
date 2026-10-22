#!/usr/bin/env python3
"""Self-test for the Main build status plugin (fake GitHub API on loopback, through the real lib-github client).

    python3 apps/console-web/plugins/main-build-status/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import threading
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
TOKEN = "ghp_" + "T" * 36
os.environ["AXF_MAIN_BUILD_STATUS_DIR"] = tempfile.mkdtemp(prefix="axf-mbs-test-")
os.environ["GITHUB_TOKEN"] = TOKEN

# ---------------------------------------------------------------- fake GitHub
SEEN: list[dict] = []
RUNS: dict[str, list[dict]] = {}
JOBS: dict[int, list[dict]] = {}
MODE = {"status": 200, "redirect": False}


def run(i, status="completed", conclusion="success", name="Android framework + console", title="Fix the banner", sha="abc1234def"):
    return {"id": i, "name": name, "display_title": title, "head_sha": sha, "run_number": 100 + i, "event": "push",
            "status": status, "conclusion": conclusion, "html_url": f"https://github.com/MossesX/AmberX-AXF/actions/runs/{i}",
            "run_started_at": "2026-10-21T10:00:00Z", "created_at": "2026-10-21T10:00:00Z", "updated_at": "2026-10-21T10:05:00Z"}


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def do_GET(self):  # noqa: N802
        u = urlsplit(self.path)
        SEEN.append({"path": u.path, "query": parse_qs(u.query), "auth": self.headers.get("Authorization", "")})
        if MODE["redirect"]:
            self.send_response(302)
            self.send_header("Location", "https://evil.example/steal")
            self.end_headers()
            return
        if MODE["status"] != 200:
            body = json.dumps({"message": "Bad credentials"}).encode()
            self.send_response(MODE["status"])
        elif u.path.endswith("/jobs"):
            rid = int(u.path.split("/")[-2])
            body = json.dumps({"jobs": JOBS.get(rid, [])}).encode()
            self.send_response(200)
        else:
            body = json.dumps({"workflow_runs": RUNS.get(u.path, [])}).encode()
            self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ["GITHUB_API_URL"] = f"http://127.0.0.1:{srv.server_address[1]}"

# ---------------------------------------------------------------- load the plugin
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.main_build_status_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

clock = {"t": 1_000_000.0}
mod.MONITOR.clock = lambda: clock["t"]
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


def status(refresh=True):
    return c.get("/p/status" + ("?refresh=true" if refresh else "")).json()


WF = "/repos/MossesX/AmberX-AXF/actions/workflows/android.yml/runs"
print("main-build-status self-test")

cfg = c.get("/p/config").json()
check(cfg["watch"] == [{"repo": "MossesX/AmberX-AXF", "branch": "main", "workflow": "android.yml"}], "default: AmberX-AXF main android.yml")

RUNS[WF] = [run(1)]
it = status()["items"][0]
check(it["state"] == "success" and it["title"] == "Fix the banner" and it["sha"] == "abc1234def" and it["runNumber"] == 101, "success: state, title, commit, run number")
check(it["url"] == "https://github.com/MossesX/AmberX-AXF/actions/runs/1", "link to the run on github.com")
last = SEEN[-1]
check(last["path"] == WF and last["query"].get("branch") == ["main"], "asks the workflow's runs on the branch")
check(last["auth"] == f"Bearer {TOKEN}", "token sent to the API origin only (here: the loopback fake)")
check(TOKEN not in json.dumps(status()), "the token never comes back to the browser")

n = len(SEEN)
status(refresh=False)
status(refresh=False)
check(len(SEEN) == n, "answers cached (~30 s): no new GitHub call")
clock["t"] += 31
status(refresh=False)
check(len(SEEN) == n + 1, "cache expires after 30 s")

RUNS[WF] = [run(2, conclusion="failure", title="Break things"), run(1)]
JOBS[2] = [{"name": "kernel tests", "status": "completed", "conclusion": "failure", "html_url": "https://github.com/MossesX/AmberX-AXF/actions/runs/2/job/9"},
           {"name": "web", "status": "completed", "conclusion": "success", "html_url": "https://github.com/x"}]
it = status()["items"][0]
check(it["state"] == "failure" and [j["name"] for j in it["failedJobs"]] == ["kernel tests"], "failure: failed jobs listed (only the failed ones)")
n = len(SEEN)
status()
check(len(SEEN) == n + 1, "failed jobs of a finished run fetched once (kept)")

RUNS[WF] = [run(3, status="in_progress", conclusion=None), run(2, conclusion="failure")]
it = status()["items"][0]
check(it["state"] == "running" and it["startedAt"] == "2026-10-21T10:00:00Z", "running: state + start time for the elapsed time")
check(it["previous"] and it["previous"]["state"] == "failure", "running: the run before it is reported")
RUNS[WF] = [run(4, status="queued", conclusion=None)]
check(status()["items"][0]["state"] == "running", "queued counts as running")
RUNS[WF] = [run(5, conclusion="cancelled")]
it = status()["items"][0]
check(it["state"] == "unknown" and "cancelled" in it["error"], "cancelled: unknown, says why")
RUNS[WF] = [run(6, conclusion="timed_out")]
check(status()["items"][0]["state"] == "failure", "timed out counts as failure")
RUNS[WF] = []
it = status()["items"][0]
check(it["state"] == "unknown" and "no runs" in it["error"], "no runs: unknown")

bad = run(7)
bad["html_url"] = "javascript:alert(1)"
RUNS[WF] = [bad]
check(status()["items"][0]["url"] == "https://github.com/MossesX/AmberX-AXF/actions", "a link that isn't https://github.com is replaced by the repo's actions page")

MODE["status"] = 401
it = status()["items"][0]
check(it["state"] == "unknown" and "401" in it["error"] and TOKEN not in it["error"], "GitHub error: unknown, status shown, token scrubbed")
MODE["status"] = 200
MODE["redirect"] = True
n = len(SEEN)
it = status()["items"][0]
check(it["state"] == "unknown" and len(SEEN) == n + 1, "a redirect is never followed (one call, no second hop with the token)")
MODE["redirect"] = False

os.environ["GITHUB_TOKEN"] = ""
n = len(SEEN)
it = status()["items"][0]
check(it["state"] == "unknown" and "GITHUB_TOKEN" in it["error"] and len(SEEN) == n, "no token: unknown, GitHub not called")
os.environ["GITHUB_TOKEN"] = TOKEN

# config
r = c.put("/p/config", json={"watch": [{"repo": "MossesX/axHub", "branch": "main", "workflow": "Android framework + console"}, {"repo": "MossesX/Build-Pilot", "branch": "dev", "workflow": "123"}]})
check(r.status_code == 200 and len(r.json()["watch"]) == 2, "config: an open list of watches saved")
f = Path(os.environ["AXF_MAIN_BUILD_STATUS_DIR"]) / "config.json"
check((f.stat().st_mode & 0o777) == 0o600 and TOKEN not in f.read_text(), "config file private (0600), no secrets")
RUNS["/repos/MossesX/axHub/actions/runs"] = [run(8, name="Other"), run(9, name="Android framework + console", conclusion="failure")]
RUNS["/repos/MossesX/Build-Pilot/actions/workflows/123/runs"] = [run(10)]
JOBS[9] = []
items = status()["items"]
check(items[0]["state"] == "failure" and items[0]["runNumber"] == 109, "workflow by name: runs filtered by the name GitHub shows")
check(items[1]["state"] == "success" and SEEN[-1]["query"].get("branch") == ["dev"], "workflow by id + another branch")
for body, why in [({"watch": []}, "empty list"), ({"watch": [{"repo": "../etc", "branch": "main", "workflow": "a.yml"}]}, "bad repo"),
                  ({"watch": [{"repo": "a/b", "branch": "../x", "workflow": "a.yml"}]}, "bad branch"),
                  ({"watch": [{"repo": "a/b", "branch": "main", "workflow": "a\nb"}]}, "bad workflow"),
                  ({"watch": [{"repo": "a/b", "branch": "main", "workflow": "a.yml", "token": "x"}]}, "unknown key"),
                  ({"watch": [{"repo": "a/b", "branch": "main", "workflow": "a.yml"}] * 11}, "too many")]:
    check(c.put("/p/config", json=body).status_code == 400, f"config refused: {why}")
r = c.put("/p/config", json={"reset": True})
check(r.json()["watch"] == mod.DEFAULT_WATCH, "reset goes back to the default")
f.write_text("{not json")
check(c.get("/p/config").json()["watch"] == mod.DEFAULT_WATCH, "a damaged config file falls back to the default")

srv.shutdown()

# ---------------------------------------------------------------- the widget, against the framework runtime
import shutil  # noqa: E402
import subprocess  # noqa: E402

npx = shutil.which("npx")
if not npx:
    print("  - widget checks skipped (no node/npx)")
else:
    out = subprocess.run([npx, "-y", "tsx", str(HERE / "widget-check.mjs"), str(REPO)], capture_output=True, text=True, timeout=300)
    if out.returncode != 0:
        raise SystemExit(f"FAIL: widget check crashed\n{out.stderr[-2000:]}")
    e = json.loads(out.stdout.strip().splitlines()[-1])
    check(e["texts"] == {"success": "main ✓ 2m ago", "failure": "main ✗ 2m ago", "running": "main ⟳ 3m", "unknown": "main ?"}, "banner text per state")
    check(e["tones"] == {"success": "success", "failure": "danger", "running": "accent", "unknown": "muted"}, "dot tone per state: green / red / accent / grey")
    check(all(e["valid"]), "every repaint is a valid framework status widget")
    check(e["none"] == "main …" and e["errorNoItem"] == "main ?", "before the first answer: …; error without an answer: ?")
    check(e["ago"] == ["10s", "3h", "3d", ""], "short times")
    check(e["knownBefore"] == 0 and not e["onBefore"], "no answer yet: counter build.main.known is 0 (muted)")
    check(e["right"] == ["theme-switch:day-night@asset", "clock:digital-12h@asset", "status:main-build@ai.amberx.axf.console.main-build-status"], "attached on the banner's right, just after the clock")
    check(e["counters"] == [1, 0, 1] and e["countersRunning"] == [1, 1, 0], "counters build.main.known / running / failing follow the state")
    check(e["hidden"] == 0, "hidden in settings: taken off the banner")
    check(e["afterDetachAll"] == 0, "switching the plugin off (detachAll by plugin id) removes it")
    check(e["warnings"] == [] and e["conflicts"] == 0, "no widget warnings, repaints never count as asset conflicts")
print(f"all {ok} checks passed")
