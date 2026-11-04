"""GitHub App plugin (github-app@1, Nov 1 2026): one-click GitHub App setup and the console's token keeper.

Brett's personal tokens kept dying (401s, 403s on the banner) and the fine-grained one can't create repos. The console
now makes its own GitHub App through GitHub's manifest flow, mints installation tokens from the app's private key
(1 h each, renewed at 50 min, so they never die for good) and keeps a user access token from the same app for what
installation tokens can't do on a personal account (creating repos).

Everything token-related runs in the framework broker, `framework/cli/github-token.mjs` (library `github-app.mjs`);
this module only calls it (`node … <cmd> --json`, codes on stdin) and never sees a private key or client secret.

  Keeper     every 5 min: `GITHUB_TOKEN` in the console's environment = the app's installation token (so every
             plugin, the push banner, CI reads, the activity feed and every subprocess use the app); the old personal
             token stays in `GITHUB_TOKEN_PAT` and takes over again if the app can't mint. User token refreshed too.
  Routes     status · manifest · convert · installation · authorize · authorized · keep · forget (admin only: the
             console token or a wall admin, the default for plugin routes).
  Health     axf.health@1 checks `github-app` (key, installation, token, rate limit, file modes) and
             `github-app-user` (user token refreshes); red with the exact fix.

Credentials: <console>/.axf-console/github-app/ (0700, files 0600), never in git, never sent to a browser.
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, HTTPException

import console_context as cx
import plugin_services

router = APIRouter()

FOLDER = "github-app"
HEALTH_CAP = "axf.health@1"
KEEP_EVERY_S = max(60, int(os.environ.get("AXF_GITHUB_APP_KEEP_S", "300") or 300))
STATUS_TTL_S = 60
APP_PREFIX = "ghs_"  # installation tokens


class BrokerError(RuntimeError):
    pass


def _root() -> Path:
    return Path(getattr(cx, "ROOT", None) or os.environ.get("AXF_ROOT") or Path(__file__).resolve().parents[5])


def broker_path() -> Path:
    return _root() / "framework" / "cli" / "github-token.mjs"


def run_broker(*args: str, stdin: dict[str, Any] | None = None, timeout: float = 45) -> dict[str, Any]:
    """`node github-token.mjs <args> --json` → its JSON answer; BrokerError (secret-free message) when it fails."""
    env = {**os.environ, "AXF_ROOT": str(_root())}
    try:
        r = subprocess.run(["node", str(broker_path()), *args, "--json"], input=json.dumps(stdin or {}), capture_output=True,
                           text=True, timeout=timeout, env=env)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise BrokerError(f"the token broker didn't answer ({type(e).__name__})") from None
    lines = [ln for ln in (r.stdout or "").strip().splitlines() if ln.strip()]
    try:
        out = json.loads(lines[-1]) if lines else {}
    except ValueError:
        out = {}
    if r.returncode != 0 or (isinstance(out, dict) and out.get("ok") is False and "error" in out):
        raise BrokerError(str((out or {}).get("error") or "the token broker failed")[:300])
    return out if isinstance(out, dict) else {}


Broker = Callable[..., dict[str, Any]]


# ─── keeper: GITHUB_TOKEN = the app's installation token, the old token as the fallback ───────────────────────────

class Keeper:
    def __init__(self, broker: Broker = run_broker, environ: Any = None, legacy: Callable[[], str] | None = None,
                 clock: Callable[[], float] = time.time) -> None:
        self.broker = broker
        self.env = os.environ if environ is None else environ
        start = self.env.get("GITHUB_TOKEN", "")
        self._initial = "" if start.startswith(APP_PREFIX) else start  # the personal token the console started with
        self._legacy = legacy
        self.clock = clock
        self.state: dict[str, Any] = {"source": "legacy" if self._initial else "none", "at": None}
        self._lock = threading.Lock()

    def legacy(self) -> str:
        """The old personal token: what the Keys banner saved (secrets.env), else what the console started with."""
        if self._legacy is not None:
            return self._legacy()
        try:
            import credentials  # core console module
            if credentials.STORE is not None:
                v = credentials.STORE.read().get("GITHUB_TOKEN", "")
                if v:
                    return v
        except Exception:  # noqa: BLE001 — fall back to the start value
            pass
        return self._initial

    def tick(self) -> dict[str, Any]:
        with self._lock:
            pat = self.legacy()
            if pat:
                self.env["GITHUB_TOKEN_PAT"] = pat
            else:
                self.env.pop("GITHUB_TOKEN_PAT", None)
            try:
                r = self.broker("keep")
            except BrokerError as e:
                r = {"installation": {"ok": False, "why": str(e)}, "user": None}
            inst = r.get("installation") or None
            if inst and inst.get("ok") and inst.get("token"):
                self.env["GITHUB_TOKEN"] = inst["token"]
                source = "app"
            elif pat:
                self.env["GITHUB_TOKEN"] = pat
                source = "legacy"
            else:
                if self.env.get("GITHUB_TOKEN", "").startswith(APP_PREFIX):
                    self.env.pop("GITHUB_TOKEN", None)
                source = "none"
            self.env["AXF_GITHUB_TOKEN_SOURCE"] = source
            self.state = {"source": source, "at": self.clock(),
                          "installation": {k: v for k, v in (inst or {}).items() if k != "token"} or None,
                          "user": r.get("user"), "legacy": bool(pat)}
            return dict(self.state)


KEEPER = Keeper()


def _keep_loop() -> None:
    time.sleep(3)
    while True:
        try:
            KEEPER.tick()
            ensure_health()
        except Exception:  # noqa: BLE001 — never take the server down
            pass
        time.sleep(KEEP_EVERY_S)


if os.environ.get("AXF_GITHUB_APP_KEEPER", "").lower() != "off":
    threading.Thread(target=_keep_loop, name="github-app-keeper", daemon=True).start()


# ─── health@1 ───────────────────────────────────────────────────────────────────────────────────────────────────────

_status_cache: tuple[float, dict[str, Any]] | None = None


def live_status(broker: Broker = run_broker, refresh: bool = False) -> dict[str, Any]:
    global _status_cache
    if _status_cache and not refresh and time.time() - _status_cache[0] < STATUS_TTL_S:
        return _status_cache[1]
    s = broker("status", "--live")
    _status_cache = (time.time(), s)
    return s


def _hhmm(iso: str | None) -> str:
    return (iso or "")[11:16] + " UTC" if iso else ""


def app_check(s: dict[str, Any]) -> dict[str, Any]:
    """health@1 run() for `github-app`: is the app key valid, installed, minting tokens, with rate limit left?"""
    c = s.get("checks") or {}
    app = s.get("app") or {}
    if not s.get("configured"):
        return {"status": "warn", "summary": "No GitHub App yet: GitHub still runs on the personal token, which can die. "
                                             "Settings → Plugins → GitHub → Create GitHub App (3 taps)."}
    if not (c.get("files") or {}).get("ok", True):
        return {"status": "error", "summary": "The GitHub App's credential files aren't private: " + "; ".join((c["files"].get("problems") or [])[:3]),
                "details": [f"chmod 700 {s.get('dir', '')}; chmod 600 {s.get('dir', '')}/*"]}
    key = c.get("key") or {}
    if not key.get("ok", True):
        return {"status": "unknown" if "reachable" in str(key.get("why", "")) else "error",
                "summary": f"GitHub App key: {key.get('why') or 'not accepted'}. Create the app again (Settings → Plugins → GitHub)."}
    inst = c.get("installation") or {}
    if not inst.get("ok"):
        return {"status": "error", "summary": f"The GitHub App isn't installed: {inst.get('why') or 'no installation'}. Install it on All repositories.",
                "link": app.get("installUrl") or ""}
    tok = c.get("token") or {}
    if not tok.get("ok"):
        return {"status": "error", "summary": f"The GitHub App can't mint a token: {tok.get('why') or 'unknown error'}."}
    rl = c.get("rateLimit") or {}
    if rl and not rl.get("ok") and rl.get("remaining") is not None:
        return {"status": "warn", "summary": f"GitHub App rate limit low: {rl.get('remaining')}/{rl.get('limit')} left until {_hhmm(rl.get('resetAt'))}."}
    rate = f", rate limit {rl.get('remaining')}/{rl.get('limit')}" if rl.get("remaining") is not None else ""
    return {"status": "ok", "summary": f"{app.get('name') or 'GitHub App'} installed on {inst.get('account') or 'the account'} "
                                       f"({inst.get('repositorySelection') or 'repos'}); token good until {_hhmm(tok.get('expiresAt'))}{rate}."}


def user_check(s: dict[str, Any]) -> dict[str, Any]:
    """health@1 run() for `github-app-user`: does the user token (repo creation) still refresh?"""
    if not s.get("configured"):
        return {"status": "info", "summary": "No GitHub App yet, so no user token."}
    u = (s.get("checks") or {}).get("user") or {}
    if u.get("state") == "none":
        return {"status": "warn", "summary": "Not authorized as Brett yet: creating repos needs it (Settings → Plugins → GitHub → Authorize as Brett)."}
    if not u.get("ok"):
        why = u.get("why") or (u.get("lastError") or {}).get("message") or "refresh failed"
        return {"status": "error", "summary": f"GitHub user token stopped refreshing: {why}. Tap Authorize as Brett again."}
    return {"status": "ok", "summary": f"User token for {u.get('login') or 'Brett'} refreshes (refresh token good until {(u.get('refreshExpiresAt') or '')[:10]})."}


_health_done = False


def ensure_health() -> bool:
    """Registers both checks on axf.health@1 once the systems check provides it (plugins load in any order)."""
    global _health_done
    if _health_done:
        return True
    reg = plugin_services.get(HEALTH_CAP)
    if reg is None:
        return False
    fix = {"type": "settings", "tab": FOLDER, "label": "Open GitHub settings"}
    try:
        reg.register({"id": "github-app", "label": "GitHub App", "service": "github", "order": 9, "severity": "error",
                      "run": lambda: app_check(live_status()), "fix": fix,
                      "breaks": "Pushes, PRs, auto-merge, CI reads and the activity feed fall back to the old personal token (or stop when it dies).",
                      "links": [{"label": "GitHub → Your GitHub Apps", "url": "https://github.com/settings/apps"}],
                      "instructions": ["Settings → Plugins → GitHub: Create GitHub App, then Install (All repositories).",
                                       "If the key was revoked or the app deleted, create it again: the console stores the new one by itself."]}, FOLDER)
        reg.register({"id": "github-app-user", "label": "GitHub App user token", "service": "github", "order": 9, "severity": "error",
                      "run": lambda: user_check(live_status()), "fix": fix,
                      "breaks": "New repos can't be created (installation tokens can't create repos on a personal account).",
                      "instructions": ["Settings → Plugins → GitHub → Authorize as Brett, then tap Authorize on GitHub."]}, FOLDER)
    except Exception:  # noqa: BLE001 — the plugin works without its health items
        return False
    _health_done = True
    return True


# ─── routes ─────────────────────────────────────────────────────────────────────────────────────────────────────────

def _call(*args: str, stdin: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        return run_broker(*args, stdin=stdin)
    except BrokerError as e:
        raise HTTPException(409, str(e)) from None


def _text(v: Any, n: int = 300) -> str:
    return v.strip()[:n] if isinstance(v, str) else ""


@router.get("/status")
def status(live: bool = False) -> dict[str, Any]:
    ensure_health()
    s = live_status(refresh=True) if live else _call("status")
    return {"status": s, "keeper": KEEPER.state}


@router.post("/manifest")
def manifest(body: dict[str, Any]) -> dict[str, Any]:
    """{origin, name?} → {action, manifest, state}: the browser POSTs the manifest to github.com itself."""
    args = ["manifest", "--origin", _text(body.get("origin"), 200)]
    if _text(body.get("name"), 34):
        args += ["--name", _text(body.get("name"), 34)]
    return _call(*args)


@router.post("/convert")
def convert(body: dict[str, Any]) -> dict[str, Any]:
    """Back from github.com with ?ghapp=created&code&state: store the app, then the browser goes to its install page."""
    app = _call("convert", stdin={"code": _text(body.get("code"), 128), "state": _text(body.get("state"), 64), "origin": _text(body.get("origin"), 200)})
    return {"app": app, "next": app.get("installUrl")}


@router.post("/installation")
def installation(body: dict[str, Any] | None = None) -> dict[str, Any]:
    """After the install page (?ghapp=installed&installation_id=…), or Check installation: find it, mint a token."""
    b = body or {}
    args = ["find-installation"]
    if str(b.get("id") or "").isdigit():
        args += ["--id", str(b["id"])]
    r = _call(*args)
    st = KEEPER.tick() if r.get("installation") else KEEPER.state
    return {**r, "keeper": st}


@router.post("/authorize")
def authorize(body: dict[str, Any]) -> dict[str, Any]:
    return _call("authorize-url", "--origin", _text(body.get("origin"), 200))


@router.post("/authorized")
def authorized(body: dict[str, Any]) -> dict[str, Any]:
    user = _call("exchange", stdin={"code": _text(body.get("code"), 128), "state": _text(body.get("state"), 64), "origin": _text(body.get("origin"), 200)})
    return {"user": user}


@router.post("/keep")
def keep() -> dict[str, Any]:
    """Mint / refresh now and put the result in the console's environment."""
    return {"keeper": KEEPER.tick(), "status": live_status(refresh=True)}


@router.post("/forget")
def forget(body: dict[str, Any] | None = None) -> dict[str, Any]:
    """{all: false} signs the user token out; {all: true} forgets the app here (it stays on GitHub until deleted there)."""
    _call("forget", *(["--all"] if (body or {}).get("all") else []))
    return {"keeper": KEEPER.tick()}


plugin_services.provide("axf.github-app@1", KEEPER, FOLDER)
