"""axf.github@1 — the console's GitHub client, through axHub first (Oct 30 2026: the console's GITHUB_TOKEN went dead while
axHub's github service kept working).

Plugins get a client with `plugin_services.get("axf.github@1").client(user_agent="axf-console-<plugin>")`: a drop-in
`axf_server.github.GitHubClient` (framework lib `axf_server.github_hub`) that sends every read the hub has a tool for to
axHub's github service with the console's AXHUB_TOKEN, and falls back to the local GITHUB_TOKEN (or the other way round:
Settings → Plugins → Systems check → GitHub route). The hub's GitHub token stays in the hub vault.

  route() / set_route(mode, by)   "hub" | "local" (saved in the plugin's settings)
  status(refresh=False)           does the hub route work right now? (GET /user through axHub; cached 5 min)
  client(user_agent, token=None)  the client (token: a callable for the local fallback, default GITHUB_TOKEN)

The push banner (listing, auto-merge, branch cleanup) builds its client from it (Nov 1 2026); its writes have no hub
route and use the local token.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Any, Callable

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import github, github_hub

from . import store

STATUS_TTL_S = 5 * 60


class GitHubService:
    version = github_hub.VERSION

    def __init__(self, log: Callable[..., None] = lambda *a, **k: None, hub: github_hub.HubLink | None = None,
                 token: Callable[[], str] | None = None) -> None:
        self.log = log
        self.hub = hub or github_hub.HubLink.from_env(client_name="axf-console-github")
        self._token = token or (lambda: os.environ.get("GITHUB_TOKEN", ""))
        self._status: tuple[float, dict[str, Any]] | None = None
        self._lock = threading.Lock()

    # ---- route
    def route(self) -> str:
        """hub | local; "auto" (the default since Nov 1 2026) = the local token first while it is the GitHub App's
        (github-app@1: minted, never dies), else axHub first."""
        saved = store.settings().get("githubRoute")
        if saved in github_hub.ROUTE_MODES:
            return saved
        return "local" if os.environ.get("AXF_GITHUB_TOKEN_SOURCE") == "app" else "hub"

    def set_route(self, mode: str, by: str = "console") -> str:
        if mode not in (*github_hub.ROUTE_MODES, "auto"):
            raise ValueError("route is hub, local or auto")
        before = store.settings().get("githubRoute")
        store.save_settings({"githubRoute": mode})
        if before != mode:
            self.log("system", f"GitHub route: {before} → {mode} ({by})", "info")
        return mode

    # ---- clients
    def client(self, user_agent: str = "axf-console", token: Callable[[], str] | None = None, **kw: Any) -> github_hub.HubGitHubClient:
        return github_hub.HubGitHubClient(token or self._token, hub=self.hub, route=self.route, base_url=github.api_base_from_env(),
                                          user_agent=user_agent, **kw)

    def hub_client(self) -> github_hub.HubGitHubClient:
        """Hub only (no local token): what the health check tests."""
        return github_hub.HubGitHubClient(lambda: "", hub=self.hub, route="hub", base_url=github.api_base_from_env(), user_agent="axf-console-health")

    # ---- does the hub route work?
    def status(self, refresh: bool = False) -> dict[str, Any]:
        with self._lock:
            if self._status and not refresh and time.time() - self._status[0] < STATUS_TTL_S:
                return dict(self._status[1])
        out = probe_hub(self.hub_client(), self.hub.configured())
        out["route"] = self.route()
        with self._lock:
            self._status = (time.time(), out)
        return dict(out)


def probe_hub(gh: github_hub.HubGitHubClient, configured: bool) -> dict[str, Any]:
    """{ok, login?, why?} for GET /user through axHub (pure apart from the client; the self-test feeds a fake hub)."""
    if not configured:
        return {"ok": False, "why": "axHub isn't connected on the console (no AXHUB_TOKEN)"}
    try:
        me = gh.get("/user", timeout=10)
    except github.GitHubError as e:
        return {"ok": False, "why": str(e)[:200]}
    if gh.last_route != "axhub":
        return {"ok": False, "why": gh.last_fallback or "the call didn't go through axHub"}
    return {"ok": True, "login": str((me or {}).get("login") or "") if isinstance(me, dict) else ""}
