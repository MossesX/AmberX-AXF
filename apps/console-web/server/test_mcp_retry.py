"""Console MCP server: engine ops and console commands are retried on the server (retry-ladder@1). A locked store is
retried to success inside one tool call; a caller that goes away mid-retry does not stop the job.

    python apps/console-web/server/test_mcp_retry.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

os.environ["AXF_RETRY_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, str(Path(__file__).resolve().parent))
import mcp_server  # noqa: E402

checks = 0


def ok(v: object, what: str) -> None:
    global checks
    assert v, what
    checks += 1


runner = mcp_server.retry_runner()
runner.delay_scale = 0

# 1. an engine op that finds the builds store locked twice answers normally (the tool call never sees the lock)
n = {"c": 0}


def engine(op: str, **args: object) -> dict:
    n["c"] += 1
    if n["c"] <= 2:
        return {"ok": False, "error": "builds store is locked (/x/_claude/builds/store.json.lock)"}
    return {"ok": True, "generatedAt": "now", "summary": {"built": 7}}


server = mcp_server.build_server(engine)
res = asyncio.run(server.call_tool("tracker_summary", {}))
text = str(res)
ok(n["c"] == 3 and "built" in text, f"locked store retried to success: {n['c']} calls, {text[:200]}")
jobs = [j for j in runner.jobs() if j["title"] == "engine queue" or j["title"].startswith("engine ")]
ok(jobs and jobs[0]["status"] == "fixed" and [a["fix"] for a in jobs[0]["attempts"]] == ["wait", "clear-stale-lock"], jobs)

# 2. the caller disconnects mid-retry: its await is cancelled, the job still completes and lands in the ledger
release = threading.Event()
m = {"c": 0}


def console(command: dict) -> dict:
    m["c"] += 1
    if m["c"] == 1:
        return {"ok": False, "code": "no_console", "message": "no console open"}
    release.wait(5)
    return {"ok": True, "delivered": [{"client": "c1", "ok": True}]}


async def caller() -> None:
    try:
        await asyncio.wait_for(mcp_server.retried("console open plan-studio", "console", lambda ctx: console({"op": "act"}),
                                                  ok=lambda r: None if r.get("ok") else r, fixes=mcp_server.CONSOLE_FIXES), timeout=0.3)
        ok(False, "should still be waiting")
    except asyncio.TimeoutError:
        pass


asyncio.run(caller())
release.set()
job = None
for _ in range(100):
    job = next((j for j in runner.jobs() if j["title"] == "console open plan-studio"), None)
    if job and job["status"] == "fixed":
        break
    time.sleep(0.05)
ok(job and job["status"] == "fixed" and job["attempts"][0]["fix"] == "retry", f"finished without its caller: {job}")

# 3. a permanent error the caller saw is not logged; one it never saw (caller gone) is logged with an FYI
gone = threading.Event()


def nope(ctx: dict) -> dict:
    gone.wait(5)
    return {"ok": False, "code": "not_found", "message": "no screen called zzz"}


async def leaves() -> None:
    try:
        await asyncio.wait_for(mcp_server.retried("console open zzz", "console", nope, ok=lambda r: None if r.get("ok") else r), timeout=0.2)
    except asyncio.TimeoutError:
        pass


asyncio.run(leaves())
gone.set()
for _ in range(100):
    job = next((j for j in runner.jobs() if j["title"] == "console open zzz"), None)
    if job:
        break
    time.sleep(0.05)
ok(job and job["status"] == "failed" and "Not retried" in job.get("fyi", ""), f"unseen permanent error logged + FYI: {job}")

print(f"✓ console MCP retry — {checks} checks")
