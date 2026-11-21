#!/usr/bin/env python3
"""Self-test for the wall token gate and plugin device routes in server/main.py (fable-full-audit-ui-overhaul-conso s6).

    python3 apps/console-web/server/test_wall_device.py

Behind axHub's wall a bearer request arrives with X-Auth-Via: token. Every route then needs the console token, except a
plugin's device routes (manifest "deviceRoutes": true): their caller is the paired device, with its own token, which
those routes check themselves. Before this, the gate refused the device's token, so a paired phone never connected.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

dist = Path(tempfile.mkdtemp(prefix="axf-wall-")) / "dist"
(dist / "assets").mkdir(parents=True)
(dist / "index.html").write_text("<html>console</html>")
os.environ.setdefault("AXF_CONSOLE_DIST", str(dist))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

n = 0


def t(name: str, ok: bool) -> None:
    global n
    if not ok:
        print(f"✗ {name}")
        sys.exit(1)
    n += 1


t("no device prefix outside /api/plugins/<folder>/device/",
  all(p.startswith("/api/plugins/") and p.endswith("/device/") for p in main._DEVICE_PREFIXES))
t("a path that only starts like a device prefix is not one", not main._device_route("/api/plugins/x/devices"))
if not main._DEVICE_PREFIXES:
    print(f"wall-device: {n} checks passed (no plugin with device routes is loaded; route checks skipped)")
    sys.exit(0)

prefix = sorted(main._DEVICE_PREFIXES)[0]
base = prefix[: -len("device/")]
c = TestClient(main.app)
wall = {"x-auth-via": "token", "authorization": "Bearer not-the-console-token"}
r = c.post(prefix + "hello", json={}, headers=wall)
t(f"behind the wall a device route reaches its plugin, not the console token gate ({r.status_code})", r.status_code != 401)
r = c.get(base + "devices", headers=wall)
t("behind the wall the plugin's other routes still need the console token", r.status_code == 401)
r = c.get(base.rstrip("/") + "/deviceX", headers=wall)
t("a sibling path of the device prefix still needs the console token", r.status_code == 401)

print(f"wall-device: {n} checks passed")
