#!/usr/bin/env python3
"""Self-test for server/readcache.py (urgent-console-perf, Nov 4 2026). Stdlib only.

    python3 apps/console-web/server/test_readcache.py

Shared cache: hits inside ttl, single-flight under concurrency, stale-while-revalidate, file-change invalidation,
short error caching, invalidate(); spawn guard: node calls capped, other commands untouched, overflow never deadlocks.
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import readcache as rc  # noqa: E402

n = 0


def t(name: str, ok: bool) -> None:
    global n
    if not ok:
        print(f"✗ {name}")
        sys.exit(1)
    n += 1
    print(f"  ✓ {name}")


calls = {"n": 0}


def slow(value: object = "v", delay: float = 0.2):
    def f() -> object:
        calls["n"] += 1
        time.sleep(delay)
        return value
    return f


# hits
calls["n"] = 0
rc.cached("a", slow("one", 0), ttl=10)
rc.cached("a", slow("two", 0), ttl=10)
t("a read inside ttl is a hit (one produce)", calls["n"] == 1 and rc.cached("a", slow("x", 0), ttl=10) == "one")

# single-flight
calls["n"] = 0
out: list[object] = []
ths = [threading.Thread(target=lambda: out.append(rc.cached("sf", slow("shared", 0.3), ttl=10))) for _ in range(12)]
for th in ths:
    th.start()
for th in ths:
    th.join()
t("12 concurrent misses run the producer once and all get its value", calls["n"] == 1 and out == ["shared"] * 12)

# stale-while-revalidate
calls["n"] = 0
rc.cached("swr", slow("old", 0), ttl=0.05)
time.sleep(0.1)
t0 = time.monotonic()
v = rc.cached("swr", slow("new", 0.3), ttl=0.05)
fast = time.monotonic() - t0 < 0.1
time.sleep(0.5)
t("a stale read returns the last value at once and refreshes in the background", v == "old" and fast and rc.cached("swr", slow("x", 0), ttl=10) == "new")
calls["n"] = 0
rc.cached("nostale", slow("old", 0), ttl=0.05, max_stale=0)
time.sleep(0.1)
t("max_stale=0 never serves a stale value", rc.cached("nostale", slow("new", 0), ttl=0.05, max_stale=0) == "new")

# file change
with tempfile.TemporaryDirectory() as d:
    f = Path(d) / "store.json"
    f.write_text("1")
    rc.cached("w", slow("before", 0), ttl=60, watch=[f, d])
    time.sleep(0.01)
    tmp = Path(d) / "store.json.tmp"
    tmp.write_text("22")
    os.replace(tmp, f)  # atomic write, as the store does
    t("a watched file changing makes the next read wait for a fresh value", rc.cached("w", slow("after", 0), ttl=60, watch=[f, d]) == "after")

# errors
calls["n"] = 0
rc.cached("err", slow({"ok": False, "error": "boom"}, 0), ttl=60)
rc.cached("err", slow({"ok": False, "error": "boom"}, 0), ttl=60)
t("an error is kept briefly (a retry storm runs it once) ...", calls["n"] == 1)
time.sleep(rc.ERROR_TTL + 0.1)
t("... and never served stale after that", rc.cached("err", slow({"ok": True}, 0), ttl=60) == {"ok": True})

rc.invalidate("a")
t("invalidate drops the value", rc.cached("a", slow("fresh", 0), ttl=10) == "fresh")

# spawn guard
rc.install_spawn_guard()
rc.install_spawn_guard()  # idempotent
t("subprocess.run is guarded", subprocess.run is rc._guarded_run)
peak = {"now": 0, "max": 0}
lock = threading.Lock()
real = rc._orig_run


def fake_run(*a, **k):  # stands in for a node process
    with lock:
        peak["now"] += 1
        peak["max"] = max(peak["max"], peak["now"])
    time.sleep(0.1)
    with lock:
        peak["now"] -= 1
    return subprocess.CompletedProcess(a[0], 0, "", "")


rc._orig_run = fake_run
try:
    ths = [threading.Thread(target=lambda: subprocess.run(["node", "x.mjs"])) for _ in range(rc.MAX_SPAWNS * 3)]
    for th in ths:
        th.start()
    for th in ths:
        th.join()
    t(f"node calls never run more than AXF_MAX_SPAWNS ({rc.MAX_SPAWNS}) at once", peak["max"] == rc.MAX_SPAWNS)
    peak["max"] = 0
    ths = [threading.Thread(target=lambda: subprocess.run(["git", "status"])) for _ in range(rc.MAX_SPAWNS * 2)]
    for th in ths:
        th.start()
    for th in ths:
        th.join()
    t("other commands are not capped", peak["max"] > rc.MAX_SPAWNS)
    old_wait = rc.SPAWN_WAIT_S
    rc.SPAWN_WAIT_S = 0.05
    held = [rc._spawn_sem.acquire() for _ in range(rc.MAX_SPAWNS)]
    before = rc.stats()["spawns"]["overflow"]
    r = subprocess.run(["/usr/bin/node", "x.mjs"])
    for _ in held:
        rc._spawn_sem.release()
    rc.SPAWN_WAIT_S = old_wait
    t("with every slot held a node call still runs after the wait (overflow, no deadlock)", r.returncode == 0 and rc.stats()["spawns"]["overflow"] == before + 1)
finally:
    rc._orig_run = real
t("real subprocess.run still works through the guard", subprocess.run([sys.executable, "-c", "print(1)"], capture_output=True, text=True).stdout.strip() == "1")
s = rc.stats()
t("stats report cache + spawns", {"hits", "misses", "stale"} <= set(s["cache"]) and {"total", "peak", "max"} <= set(s["spawns"]))

print(f"readcache: {n} checks passed")
