"""Shared read cache and spawn guard for the console server (urgent-console-perf, Nov 4 2026).

Before this, every screen and Home card read spawned its own Node process (engine-rpc, builds.mjs progress, ...) per
request and per client; with two consoles open the container ran 20+ node processes and the VPS swapped. Now:

- ``cached(key, produce, ttl, watch)``: one cached value per source, shared by every client. A read inside ``ttl``
  is a hit; a stale read (``ttl`` passed, watched files unchanged) returns the last value at once and refreshes it in
  the background; a read after a watched file changed (or after ``invalidate``) waits for a fresh value. Concurrent
  misses are single-flight: one producer runs, the others wait for its result. Errors are kept for ``ERROR_TTL`` only,
  so a failing source is not retried by every poll.
- ``install_spawn_guard()``: every ``subprocess.run`` of ``node`` waits for one of ``AXF_MAX_SPAWNS`` slots (default 4).
  A call that waits longer than ``SPAWN_WAIT_S`` runs anyway (counted as ``overflow``) so a node script that calls
  back into the console can never deadlock it.
- ``stats()``: hits, misses, stale serves, spawns, peak concurrency (``GET /api/perf``).
"""
from __future__ import annotations

import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable, Iterable

ERROR_TTL = 2.0
MAX_STALE = 120.0  # beyond this a stale value is not served; the read waits for a fresh one
SPAWN_WAIT_S = 30.0


def _int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, "") or default))
    except ValueError:
        return default


class _Entry:
    __slots__ = ("value", "at", "sig", "error", "refreshing")

    def __init__(self, value: Any, at: float, sig: tuple[Any, ...], error: bool) -> None:
        self.value, self.at, self.sig, self.error, self.refreshing = value, at, sig, error, False


_entries: dict[str, _Entry] = {}
_key_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()
_counters: dict[str, int] = {"hits": 0, "misses": 0, "stale": 0, "refreshes": 0, "errors": 0}


def _key_lock(key: str) -> threading.Lock:
    with _guard:
        return _key_locks.setdefault(key, threading.Lock())


def _count(name: str) -> None:
    with _guard:
        _counters[name] = _counters.get(name, 0) + 1


def signature(paths: Iterable[str | Path]) -> tuple[Any, ...]:
    """(mtime_ns, size) of each path; a folder's mtime changes when a file in it is replaced (atomic writes)."""
    out: list[Any] = []
    for p in paths:
        try:
            st = os.stat(p)
            out.append((st.st_mtime_ns, st.st_size))
        except OSError:
            out.append(None)
    return tuple(out)


def _is_error(value: Any) -> bool:
    return isinstance(value, dict) and (value.get("ok") is False or bool(value.get("error")))


def _produce(key: str, produce: Callable[[], Any], watch: tuple[str | Path, ...]) -> Any:
    sig = signature(watch)  # taken before: a write during produce shows up as a change on the next read
    value = produce()
    err = _is_error(value)
    if err:
        _count("errors")
    with _guard:
        _entries[key] = _Entry(value, time.monotonic(), sig, err)
    return value


def _refresh_bg(key: str, produce: Callable[[], Any], watch: tuple[str | Path, ...]) -> None:
    lock = _key_lock(key)
    if not lock.acquire(blocking=False):
        return  # a refresh is already running
    try:
        _count("refreshes")
        _produce(key, produce, watch)
    except Exception:  # noqa: BLE001 - keep serving the old value
        pass
    finally:
        with _guard:
            e = _entries.get(key)
            if e:
                e.refreshing = False
        lock.release()


def cached(key: str, produce: Callable[[], Any], ttl: float = 5.0, watch: Iterable[str | Path] = (), max_stale: float = MAX_STALE) -> Any:
    """The value of ``produce()`` shared by every caller (see the module docstring); ``max_stale=0`` never serves stale."""
    watch_t = tuple(watch)
    sig = signature(watch_t)
    now = time.monotonic()
    with _guard:
        e = _entries.get(key)
    if e is not None and e.sig == sig:
        age = now - e.at
        if age < (min(ttl, ERROR_TTL) if e.error else ttl):
            _count("hits")
            return e.value
        if not e.error and age < max_stale:
            _count("stale")
            with _guard:
                start = not e.refreshing
                e.refreshing = True
            if start:
                threading.Thread(target=_refresh_bg, args=(key, produce, watch_t), daemon=True, name=f"readcache:{key}").start()
            return e.value
    with _key_lock(key):  # single-flight: the first caller produces, the rest take its value
        with _guard:
            e = _entries.get(key)
        if e is not None and e.sig == signature(watch_t) and time.monotonic() - e.at < (min(ttl, ERROR_TTL) if e.error else ttl):
            _count("hits")
            return e.value
        _count("misses")
        return _produce(key, produce, watch_t)


def invalidate(prefix: str = "") -> None:
    """Drop cached values (all, or those whose key starts with ``prefix``): the next read waits for a fresh one."""
    with _guard:
        for k in [k for k in _entries if k.startswith(prefix)]:
            del _entries[k]


# ---------------------------------------------------------------- spawn guard

MAX_SPAWNS = _int_env("AXF_MAX_SPAWNS", 4)
_spawn_sem = threading.BoundedSemaphore(MAX_SPAWNS)
_spawn: dict[str, int] = {"total": 0, "running": 0, "peak": 0, "waited": 0, "overflow": 0}
_orig_run = subprocess.run


def _is_node(args: Any) -> bool:
    try:
        first = args[0] if isinstance(args, (list, tuple)) else str(args).split()[0]
        return Path(str(first)).name in ("node", "nodejs")
    except (IndexError, TypeError):
        return False


def _guarded_run(*popenargs: Any, **kwargs: Any) -> subprocess.CompletedProcess[Any]:
    args = popenargs[0] if popenargs else kwargs.get("args")
    if not _is_node(args):
        return _orig_run(*popenargs, **kwargs)
    got = _spawn_sem.acquire(blocking=False)
    if not got:
        with _guard:
            _spawn["waited"] += 1
        got = _spawn_sem.acquire(timeout=SPAWN_WAIT_S)
        if not got:
            with _guard:
                _spawn["overflow"] += 1
    with _guard:
        _spawn["total"] += 1
        _spawn["running"] += 1
        _spawn["peak"] = max(_spawn["peak"], _spawn["running"])
    try:
        return _orig_run(*popenargs, **kwargs)
    finally:
        with _guard:
            _spawn["running"] -= 1
        if got:
            _spawn_sem.release()


def install_spawn_guard() -> None:
    """Route every ``subprocess.run(["node", ...])`` in the server and its plugins through the slots (idempotent)."""
    subprocess.run = _guarded_run  # type: ignore[assignment]


def stats() -> dict[str, Any]:
    with _guard:
        return {"cache": {**_counters, "entries": len(_entries)}, "spawns": {**_spawn, "max": MAX_SPAWNS}}
