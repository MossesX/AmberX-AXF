"""axf_server.retry: the runner side of retry-ladder@1 (the engine itself is replayed by check-retry-ladder.mjs).

    python3 framework/python/axf_server/test_retry.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path[0] = str(Path(__file__).resolve().parents[1])  # not this folder: its http.py would shadow the stdlib
from axf_server import retry as R  # noqa: E402
from axf_server import retry_fixes  # noqa: E402

checks = 0


def ok(v: object, what: str) -> None:
    global checks
    assert v, what
    checks += 1


tmp = Path(tempfile.mkdtemp(prefix="axf-retry-"))
fyis: list[dict] = []
changes: list[str] = []
runner = R.Runner(tmp, on_fyi=fyis.append, on_change=lambda j: changes.append(j["status"]), delay_scale=0)

# 1. a locked store is retried to success: wait, then the stale lock is cleared, then it works
lock = tmp / "store.json.lock"
lock.write_text("")
state = {"calls": 0}


def write_store(ctx: dict) -> dict:
    state["calls"] += 1
    if lock.exists():
        return {"ok": False, "code": "store_locked", "message": f"builds store is locked ({lock})"}
    return {"ok": True, "rev": 7}


job, r = runner.run("builds store write", write_store, ok=lambda r: None if r["ok"] else r,
                    fixes={"clear-stale-lock": lambda ctx, job: lock.unlink()})
ok(r == {"ok": True, "rev": 7}, "locked store ends in a successful write")
ok(job["status"] == "fixed" and [a["fix"] for a in job["attempts"]] == ["wait", "clear-stale-lock"], f"ladder order: {job['attempts']}")
ok(R.step_text(job) == "fixed: cleared a stale lock", R.step_text(job))
ok(runner.get(job["id"])["status"] == "fixed", "ledger has the job")
ok(not fyis, "no FYI for a fixed job")

# 2. the caller disconnects mid-retry: the job still completes and lands in the ledger
gate = threading.Event()
calls = {"n": 0}


def slow(ctx: dict) -> dict:
    calls["n"] += 1
    if calls["n"] < 3:
        return {"ok": False, "status": 503, "message": "service unavailable"}
    gate.wait(5)
    return {"ok": True, "done": True}


async def caller() -> str:
    jid, done, box = runner.submit("hub job", slow, ok=lambda r: None if r["ok"] else r, fixes={"health-check": lambda c, j: None, "restart-container": lambda c, j: None})
    try:
        await asyncio.wait_for(asyncio.to_thread(done.wait), timeout=0.2)
    except asyncio.TimeoutError:
        pass  # the caller gives up and goes away (MCP call cancelled, chat closed)
    return jid


jid = asyncio.run(caller())
gate.set()
for _ in range(100):
    j = runner.get(jid)
    if j and j["status"] == "fixed":
        break
    time.sleep(0.05)
ok(runner.get(jid) and runner.get(jid)["status"] == "fixed", f"job finished without its caller: {runner.get(jid)}")
ok([a["fix"] for a in runner.get(jid)["attempts"]] == ["health-check", "restart-container"], "service-down ladder")

# 3. every rung tried and it still fails: stop, gave-up, exactly one FYI with what was tried and what is missing
n = {"c": 0}


def never(ctx: dict) -> dict:
    n["c"] += 1
    return {"ok": False, "code": "store_locked", "message": "builds store is locked"}


job, _ = runner.run("pending change", never, ok=lambda r: None if r["ok"] else r)
ok(job["status"] == "gave-up" and n["c"] == 4, f"stops after the ladder (3 fixes + first call): {n['c']}")
ok(len(fyis) == 1 and "Tried: waited for the lock, cleared a stale lock, restarted the store writer" in fyis[0]["fyi"], fyis)
ok("Missing: clearing stale lock: no automatic fix for this here; restarting the store writer: no automatic fix for this here" in fyis[0]["fyi"], fyis[0]["fyi"])

# 4. a permanent error is not retried; once the caller has gone it is logged and FYI'd
job, _ = runner.run("open screen", lambda c: {"ok": False, "code": "not_found", "message": "no screen x"}, ok=lambda r: None if r["ok"] else r)
ok(job["status"] == "failed" and runner.get(job["id"]) is None and len(fyis) == 1, "permanent error with a caller: not logged")
job, _ = runner.run("open screen", lambda c: {"ok": False, "code": "not_found", "message": "no screen x"}, ok=lambda r: None if r["ok"] else r, ctx={"_detached": True})
ok(runner.get(job["id"])["status"] == "failed" and len(fyis) == 2 and "Not retried" in fyis[1]["fyi"], "detached permanent error: logged + FYI")

# 5. timeout: longer timeout is built in
seen: list[float] = []
job, _ = runner.run("slow call", lambda c: seen.append(c.get("timeout", 30)) or (len(seen) > 1), ok=lambda r: None if r else {"code": "timeout"})
ok(seen == [30, 90.0] and job["status"] == "fixed", f"timeout tripled: {seen}")

# 6. ready-made fixes say what they need instead of pretending
for k in ("COOLIFY_URL", "COOLIFY_TOKEN", "AXF_COOLIFY_CONSOLE_APP", "AXF_CONSOLE_INTERNAL_URL"):
    os.environ.pop(k, None)
try:
    retry_fixes.restart_container({"service": "console"}, {})
    ok(False, "restart without Coolify settings must raise")
except RuntimeError as e:
    ok("COOLIFY_URL" in str(e) and "AXF_COOLIFY_CONSOLE_APP" in str(e), str(e))
os.environ["AXF_CONSOLE_INTERNAL_URL"] = "http://console:8000/"
c: dict = {"service": "console", "base": "https://console.amberxai.com"}
retry_fixes.internal_address(c, {})
ok(c["base"] == "http://console:8000", c)

# 7. the list view: open first, count for the badge, dismissed hidden
v = R.view(runner.jobs())
ok(v["count"] == 1 and v["gaveUp"] == 1 and v["rows"][0]["status"] == "gave-up", v)
ok(runner.dismiss(v["rows"][0]["id"]) and R.view(runner.jobs())["count"] == 0, "dismiss hides it")

print(f"✓ axf_server.retry — {checks} checks")
