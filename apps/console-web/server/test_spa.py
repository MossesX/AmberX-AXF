#!/usr/bin/env python3
"""Self-test for the console's SPA fallback in server/main.py (fable-full-audit-ui-overhaul-conso s6).

    python3 apps/console-web/server/test_spa.py

index.html is always revalidated (a deploy replaces the hashed chunks it names), other dist files are served as they
are, and an /api or /mcp path no route answered is a JSON 404, not the console page.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

dist = Path(tempfile.mkdtemp(prefix="axf-spa-")) / "dist"
(dist / "assets").mkdir(parents=True)
(dist / "index.html").write_text("<html>console</html>")
(dist / "robots.txt").write_text("ok")
os.environ["AXF_CONSOLE_DIST"] = str(dist)
sys.path.insert(0, str(Path(__file__).resolve().parent))
import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

if main.DIST.resolve() != dist.resolve():
    print("skip: a built dist/ exists next to the server; the test needs its own")
    sys.exit(0)

c = TestClient(main.app)
n = 0


def t(name: str, ok: bool) -> None:
    global n
    if not ok:
        print(f"✗ {name}")
        sys.exit(1)
    n += 1


for p in ("/", "/settings/plugins", "/index.html"):
    r = c.get(p)
    t(f"{p} serves index.html", r.status_code == 200 and "console" in r.text)
    t(f"{p} is revalidated on every load", r.headers.get("cache-control") == "no-cache")
r = c.get("/robots.txt")
t("a dist file is served as is", r.status_code == 200 and r.text == "ok" and r.headers.get("cache-control") is None)
for p in ("/api/no-such-route", "/api/plugins/no-such-plugin/x", "/mcp/x"):
    r = c.get(p)
    t(f"{p} is a JSON 404", r.status_code == 404 and r.headers.get("content-type", "").startswith("application/json"))
r = c.get("/apiary")
t("a screen whose name only starts with api is still the console", r.status_code == 200 and "console" in r.text)
r = c.get("/../../etc/passwd")
t("a path outside dist/ is never served", "root:" not in r.text)

print(f"spa: {n} checks passed")
