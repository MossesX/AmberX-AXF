"""The console server as the test suite runs it: the real `main:app`, plus one read-only probe route.

GET /__suite/threads lists every Python thread (name, native id, daemon, the frame it is in now) and the process'
CPU time, so the load test (server-load.mjs) can name the loop behind a busy thread. Nothing in the server changes;
this module only exists inside the sandbox container (scripts/suite/sandbox.mjs mounts it).
"""
from __future__ import annotations

import os
import sys
import threading
import time
import traceback

sys.path.insert(0, os.getcwd())  # apps/console-web/server

import subprocess  # noqa: E402
from collections import Counter  # noqa: E402

# Every process the server starts, counted by the thread that started it and the command (before main is imported,
# so module-level spawns count too). Read and reset by GET /__suite/spawns.
_SPAWNS: Counter[str] = Counter()
_SPAWN_LOCK = threading.Lock()
_popen_init = subprocess.Popen.__init__


def _cmd_key(argv: object) -> str:
    if isinstance(argv, (list, tuple)):
        parts = [os.path.relpath(str(a), "/axf") if str(a).startswith("/axf/") else str(a) for a in argv[:4]]
        parts = [p for p in parts if not p.startswith("{") and len(p) < 120]
        return " ".join(parts)[:160]
    return str(argv)[:160]


def _counting_init(self, args, *a, **kw):  # type: ignore[no-untyped-def]
    with _SPAWN_LOCK:
        _SPAWNS[f"{threading.current_thread().name} :: {_cmd_key(args)}"] += 1
    return _popen_init(self, args, *a, **kw)


subprocess.Popen.__init__ = _counting_init  # type: ignore[method-assign]

from main import app  # noqa: E402  the real console server

from starlette.responses import JSONResponse  # noqa: E402
from starlette.routing import Route  # noqa: E402


def _task_cpu(tid: int) -> float:
    """CPU seconds (user + system) a thread has used, from /proc (Linux)."""
    try:
        with open(f"/proc/self/task/{tid}/stat") as f:
            parts = f.read().rsplit(")", 1)[1].split()
        return (int(parts[11]) + int(parts[12])) / os.sysconf("SC_CLK_TCK")
    except (OSError, IndexError, ValueError):
        return 0.0


async def _threads(_request):  # type: ignore[no-untyped-def]
    frames = sys._current_frames()
    out = []
    for t in threading.enumerate():
        fr = frames.get(t.ident or -1)
        where = ""
        if fr is not None:
            stack = traceback.extract_stack(fr)[-3:]
            where = " < ".join(f"{os.path.relpath(s.filename, '/axf') if s.filename.startswith('/axf') else os.path.basename(s.filename)}:{s.lineno} {s.name}" for s in reversed(stack))
        out.append({"name": t.name, "tid": t.native_id, "daemon": t.daemon, "cpu": round(_task_cpu(t.native_id or 0), 3), "where": where})
    return JSONResponse({"pid": os.getpid(), "cpu": round(time.process_time(), 3), "threads": out, "at": time.time()})


async def _spawns(_request):  # type: ignore[no-untyped-def]
    with _SPAWN_LOCK:
        out = dict(_SPAWNS.most_common())
        _SPAWNS.clear()
    return JSONResponse({"spawns": out, "at": time.time()})


app.router.routes.insert(0, Route("/__suite/threads", _threads))
app.router.routes.insert(0, Route("/__suite/spawns", _spawns))
