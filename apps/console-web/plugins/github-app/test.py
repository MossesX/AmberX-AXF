#!/usr/bin/env python3
"""Self-test for the GitHub App plugin: the keeper's GITHUB_TOKEN swap + fallback, the health states, and the routes
end to end through the real broker (framework/cli/github-token.mjs) on a scratch folder (no GitHub calls).

    python3 apps/console-web/plugins/github-app/test.py
"""
from __future__ import annotations

import importlib.util
import os
import stat
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
SCRATCH = Path(tempfile.mkdtemp(prefix="axf-ghapp-plugin-"))
os.environ["AXF_GITHUB_APP_DIR"] = str(SCRATCH / "github-app")
os.environ["AXF_GITHUB_APP_KEEPER"] = "off"  # no background thread
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.github_app_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

ok = 0


def check(name: str, cond: bool, detail: object = "") -> None:
    global ok
    if not cond:
        raise SystemExit(f"FAIL {name} {detail}")
    ok += 1
    print(f"  ✓ {name}")


INST = "ghs_" + "i" * 36
PAT = "github_pat_" + "p" * 40

# ── keeper ──
answers: list[dict] = []


def fake_broker(*args, **kw):
    assert args[0] == "keep"
    return answers.pop(0)


env: dict[str, str] = {"GITHUB_TOKEN": PAT}
k = mod.Keeper(broker=fake_broker, environ=env, legacy=lambda: PAT)
answers.append({"installation": {"ok": True, "token": INST, "expiresAt": "2026-11-01T09:00:00Z"}, "user": {"ok": True, "login": "MossesX"}})
st = k.tick()
check("keeper: GITHUB_TOKEN = installation token, PAT kept in GITHUB_TOKEN_PAT", env["GITHUB_TOKEN"] == INST and env["GITHUB_TOKEN_PAT"] == PAT and env["AXF_GITHUB_TOKEN_SOURCE"] == "app")
check("keeper: state carries no token", INST not in repr(st) and PAT not in repr(st) and st["source"] == "app")
answers.append({"installation": {"ok": False, "why": "GitHub 500"}, "user": None})
k.tick()
check("keeper: app can't mint → back on the old token", env["GITHUB_TOKEN"] == PAT and env["AXF_GITHUB_TOKEN_SOURCE"] == "legacy")
env2: dict[str, str] = {"GITHUB_TOKEN": INST}
k2 = mod.Keeper(broker=lambda *a, **kw: {"installation": None, "user": None}, environ=env2, legacy=lambda: "")
k2.tick()
check("keeper: no app, no old token → a stale app token is removed", "GITHUB_TOKEN" not in env2 and env2["AXF_GITHUB_TOKEN_SOURCE"] == "none")


def broker_err(*a, **kw):
    raise mod.BrokerError("node missing")


env3: dict[str, str] = {}
mod.Keeper(broker=broker_err, environ=env3, legacy=lambda: PAT).tick()
check("keeper: broker down → old token", env3["GITHUB_TOKEN"] == PAT and env3["AXF_GITHUB_TOKEN_SOURCE"] == "legacy")
check("keeper: a start value that is an app token isn't taken for the old token", mod.Keeper(environ={"GITHUB_TOKEN": INST})._initial == "")

# ── health states ──
base = {"configured": True, "dir": "/x", "app": {"name": "AmberX AXF Bot", "installUrl": "https://github.com/apps/a/installations/new"},
        "checks": {"files": {"ok": True}, "key": {"ok": True}, "installation": {"ok": True, "account": "MossesX", "repositorySelection": "all"},
                   "token": {"ok": True, "expiresAt": "2026-11-01T09:00:00Z"}, "rateLimit": {"ok": True, "remaining": 4990, "limit": 5000},
                   "user": {"ok": True, "state": "ok", "login": "MossesX", "refreshExpiresAt": "2027-05-01T00:00:00Z"}}}


def with_check(name: str, value: dict) -> dict:
    return {**base, "checks": {**base["checks"], name: value}}


check("health: all good → ok", mod.app_check(base)["status"] == "ok" and "4990/5000" in mod.app_check(base)["summary"])
check("health: not set up → warn with the 3 taps", mod.app_check({"configured": False})["status"] == "warn")
check("health: key revoked → error", mod.app_check(with_check("key", {"ok": False, "why": "GitHub rejected the app key (401)"}))["status"] == "error")
inst = mod.app_check(with_check("installation", {"ok": False, "why": "not installed yet"}))
check("health: not installed → error with the install link", inst["status"] == "error" and inst["link"].endswith("/installations/new"))
check("health: token doesn't mint → error", mod.app_check(with_check("token", {"ok": False, "why": "boom"}))["status"] == "error")
check("health: low rate limit → warn", mod.app_check(with_check("rateLimit", {"ok": False, "remaining": 12, "limit": 5000}))["status"] == "warn")
check("health: loose files → error", mod.app_check(with_check("files", {"ok": False, "problems": ["private-key.pem is 644, not 600"]}))["status"] == "error")
check("health: user ok", mod.user_check(base)["status"] == "ok")
check("health: user never authorized → warn", mod.user_check(with_check("user", {"ok": False, "state": "none"}))["status"] == "warn")
check("health: user refresh failed → error", mod.user_check(with_check("user", {"ok": False, "state": "failed", "why": "bad_refresh_token"}))["status"] == "error")

# ── routes through the real broker (scratch folder; nothing reaches GitHub) ──
app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
r = c.get("/p/status")
check("route status: not configured", r.status_code == 200 and r.json()["status"]["configured"] is False, r.text)
r = c.post("/p/manifest", json={"origin": "https://console.amberxai.com", "name": "AmberX AXF Bot"})
j = r.json()
check("route manifest: action + manifest with the console's return URLs", r.status_code == 200 and j["action"].startswith("https://github.com/settings/apps/new?state=")
      and j["manifest"]["redirect_url"] == "https://console.amberxai.com/?ghapp=created" and j["manifest"]["public"] is False, r.text)
d = SCRATCH / "github-app"
check("route manifest: folder 0700, state file 0600", stat.S_IMODE(d.stat().st_mode) == 0o700 and stat.S_IMODE((d / "pending-state.json").stat().st_mode) == 0o600)
r = c.post("/p/manifest", json={"origin": "http://evil.example"})
check("route manifest: a non-https origin is refused", r.status_code == 409, r.text)
r = c.post("/p/convert", json={"code": "abcdefgh123", "state": "0" * 48})
check("route convert: a state that wasn't issued is refused before GitHub is called", r.status_code == 409 and "stale" in r.json()["detail"], r.text)
r = c.post("/p/authorize", json={"origin": "https://console.amberxai.com"})
check("route authorize: needs the app first", r.status_code == 409, r.text)

print(f"all {ok} checks passed")
