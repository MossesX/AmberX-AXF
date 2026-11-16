"""plugin_options: a plugin's config as console control's server-run settings service (plugin-settings@1 options)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import plugin_options  # noqa: E402
import plugin_services  # noqa: E402

store = {"tab": "logos", "tile": "md", "names": True}


def write(patch):
    for k, v in patch.items():
        if k == "tile" and v not in ("sm", "md", "lg"):
            continue  # the plugin's own clean-up keeps the old value
        store[k] = v
    return dict(store)


svc = plugin_options.provide("demo", read=lambda: dict(store), write=write, fields={"demo.tab": "tab", "demo.tile": "tile", "demo.names": "names"})
assert plugin_options.service_name("demo") == "axf.plugin-options.demo@1"
assert plugin_services.get("axf.plugin-options.demo@1") is svc, "provided under its service name"
assert svc.get() == {"values": {"demo.tab": "logos", "demo.tile": "md", "demo.names": True}}, "get: keys → config fields"
assert svc.set({"demo.tab": "packs"}) == {"ok": True} and store["tab"] == "packs", "set writes through the plugin"
r = svc.set({"demo.tile": "huge"})
assert r["ok"] is False and r["code"] == "validation" and store["tile"] == "md", "a value the plugin drops is reported, not claimed"
assert svc.set({"other": 1})["code"] == "not_found", "unknown keys refused"
assert svc.set({"demo.names": False}) == {"ok": True} and store["names"] is False, "toggles"
print("plugin_options: 7 checks passed")
