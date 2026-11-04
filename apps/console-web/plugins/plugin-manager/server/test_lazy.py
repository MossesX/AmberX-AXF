#!/usr/bin/env python3
"""Lazy loader config store (server/lazy.py): defaults, partial merges, per-plugin modes, reset, the console's report.

    python3 apps/console-web/plugins/plugin-manager/server/test_lazy.py
"""
from __future__ import annotations

import importlib.util
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("lz", Path(__file__).with_name("lazy.py"))
lz = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(lz)

n = 0


def ok(name: str) -> None:
    global n
    n += 1
    print(f"ok {n} {name}")


with tempfile.TemporaryDirectory() as d:
    st = lz.Store(Path(d) / "pm")
    assert st.get() == lz.DEFAULTS and st.report() is None
    ok("no file = the defaults")
    cfg = st.put(lz.merge(st.get(), {"preloadCount": 8, "cache": {"size": 30}, "modes": {"activity": "start"}}))
    assert cfg["preloadCount"] == 8 and cfg["cache"] == {"size": 30, "offline": True, "offlineMb": 25} and cfg["modes"] == {"activity": "start"}
    ok("partial change merges idle / cache / modes")
    cfg = st.put(lz.merge(st.get(), {"modes": {"todo-manager": "off", "plugin-manager": "off"}, "pins": ["a", "b"]}))
    assert cfg["modes"] == {"activity": "start", "todo-manager": "off"} and cfg["pins"] == ["a", "b"]
    ok("core plugin can't be switched off; lists replace")
    assert st.get() == cfg
    ok("stored and read back")
    st.save_report({"at": "x", "plugins": [{"folder": "activity", "state": "loaded"}, {"folder": "../etc"}], "bootMs": 120})
    assert st.report() == {"at": "x", "startup": None, "bootMs": 120, "plugins": [{"folder": "activity", "state": "loaded"}]}
    ok("report keeps plugin rows only")
    try:
        st.save_report({"plugins": "no"})
        raise AssertionError("bad report accepted")
    except ValueError:
        ok("bad report refused")
    assert st.reset() == lz.DEFAULTS and not st.file.exists()
    ok("reset = defaults, file gone")

print(f"{n} checks passed")
