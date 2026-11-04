"""github@1 — GitHub through axHub, with the local GITHUB_TOKEN as the fallback (Brett, Oct 30 2026: the console's own
token went dead while axHub's github service kept working; "Why do I have to tell you to fix something when you have
the tools to do it?").

    from axf_server import github, github_hub
    gh = github_hub.HubGitHubClient(lambda: os.environ.get("GITHUB_TOKEN", ""), hub=github_hub.HubLink.from_env(),
                                    route=lambda: "hub", user_agent="axf-console-push-banner")
    prs = gh.get(github.repo_path("MossesX/AmberX-AXF", "pulls", query={"state": "open"}))   # same calls as GitHubClient

`HubGitHubClient` is a drop-in `GitHubClient`: `get`, `json`, `paginate`, `download`, `check_token` and the rest work
as before. Each API call is matched against `ROUTES` (REST method + path → the hub's `github.<tool>`); a matched call
goes to axHub's MCP `call` tool with the console's AXHUB_TOKEN, and axHub answers with its own GitHub token, kept
encrypted in the hub vault (this side never sees it, never asks for it, never copies it).

Routes (`route()` read on every call, so a setting applies at once):
  * **hub** (default): the hub first. The local token is used only when the call has no hub route (writes such as
    merge or branch delete, check-runs, artifact downloads), when axHub can't be reached or refuses the console's hub
    token, when axHub's own GitHub token is refused (401/403 downstream), or when the hub holds the call for approval.
  * **local**: the local token first; the hub when there is no local token, it's refused (401/403), or GitHub can't
    be reached.
A downstream answer that isn't an auth problem (404, 409, 422 …) is GitHub's real answer and comes back as-is: no
fallback, so a missing PR is never asked twice.

Every answer is a normal `Response` with `x-axf-route: axhub | local`; `last_route` keeps the latest. The hub's
"more pages" trailer becomes a Link rel="next" header on the same API origin, so `paginate()` works through the hub.
Only read-only hub tools are routed (axHub's write tools need Brett's approval, which a background helper can't wait
for); `ROUTES` is an open table, so a write the hub later allows is one more line.

Python only for now: the Node twin (`framework/cli/github.mjs`) is a placeholder, listed in the lib's README.
"""
from __future__ import annotations

import json
import os
import re
import threading
import uuid
from typing import Any, Callable, Mapping
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit

from . import http, hub_session
from .github import API_BASE, GitHubClient, GitHubError
from .http import HttpError, Response, Transport

__all__ = ["CAPABILITY", "VERSION", "ROUTES", "ROUTE_MODES", "HubError", "HubUnreachable", "HubDownstream", "HubNeedsApproval",
           "match_route", "hub_args", "parse_hub_text", "next_page", "HubLink", "HubGitHubClient"]

CAPABILITY = "axf.github@1"
VERSION = 1
ROUTE_MODES = ("hub", "local")
MCP_PROTOCOL = "2025-06-18"

# (method, path template, hub tool). `{x}` = one path segment, `{+x}` = the rest of the path. axHub's github service
# takes path and query parameters as top-level arguments and a request body under "body" (its REST connector).
ROUTES: list[tuple[str, str, str]] = [
    ("GET", "/user", "users/get-authenticated"),
    ("GET", "/user/repos", "repos/list-for-authenticated-user"),
    ("GET", "/repos/{owner}/{repo}", "repos/get"),
    ("GET", "/repos/{owner}/{repo}/pulls", "pulls/list"),
    ("GET", "/repos/{owner}/{repo}/pulls/{pull_number}", "pulls/get"),
    ("GET", "/repos/{owner}/{repo}/pulls/{pull_number}/commits", "pulls/list-commits"),
    ("GET", "/repos/{owner}/{repo}/pulls/{pull_number}/files", "pulls/list-files"),
    ("GET", "/repos/{owner}/{repo}/pulls/{pull_number}/reviews", "pulls/list-reviews"),
    ("GET", "/repos/{owner}/{repo}/actions/runs", "actions/list-workflow-runs-for-repo"),
    ("GET", "/repos/{owner}/{repo}/actions/runs/{run_id}", "actions/get-workflow-run"),
    ("GET", "/repos/{owner}/{repo}/actions/runs/{run_id}/jobs", "actions/list-jobs-for-workflow-run"),
    ("GET", "/repos/{owner}/{repo}/actions/workflows", "actions/list-repo-workflows"),
    ("GET", "/repos/{owner}/{repo}/branches", "repos/list-branches"),
    ("GET", "/repos/{owner}/{repo}/branches/{branch}", "repos/get-branch"),
    ("GET", "/repos/{owner}/{repo}/commits", "repos/list-commits"),
    ("GET", "/repos/{owner}/{repo}/commits/{ref}", "repos/get-commit"),
    ("GET", "/repos/{owner}/{repo}/compare/{basehead}", "repos/compare-commits"),
    ("GET", "/repos/{owner}/{repo}/contents/{+path}", "repos/get-content"),
    ("GET", "/repos/{owner}/{repo}/issues", "issues/list-for-repo"),
    ("GET", "/repos/{owner}/{repo}/issues/{issue_number}", "issues/get"),
    ("GET", "/repos/{owner}/{repo}/issues/{issue_number}/comments", "issues/list-comments"),
    ("GET", "/repos/{owner}/{repo}/releases", "repos/list-releases"),
    ("GET", "/repos/{owner}/{repo}/tags", "repos/list-tags"),
    ("GET", "/search/issues", "search/issues-and-pull-requests"),
]
INT_PARAMS = frozenset({"pull_number", "run_id", "issue_number", "per_page", "page", "check_suite_id"})
BOOL_PARAMS = frozenset({"exclude_pull_requests"})
_TRAILER_RE = re.compile(r"\n*More pages are available\..*\Z", re.S)
_NEXT_RE = re.compile(r"next:[^·]*?\bpage=(\d+)")
_STATUS_RE = re.compile(r"\bHTTP (\d{3})\b")


class HubError(Exception):
    """Something between the console and axHub went wrong (never carries a secret)."""


class HubUnreachable(HubError):
    """axHub couldn't be reached, isn't configured here, or refused the console's hub token: try the other route."""


class HubNeedsApproval(HubError):
    """axHub holds this call for Brett's approval: a background helper can't wait for it."""


class HubDownstream(HubError):
    """GitHub (through axHub) answered an error; `status` is GitHub's HTTP status."""

    def __init__(self, status: int, message: str) -> None:
        self.status = status
        super().__init__(message)


# ---------------------------------------------------------------- routing (pure; the self-test pins these)

def match_route(method: str, path: str) -> tuple[str, dict[str, str]] | None:
    """('pulls/get', {'owner': 'MossesX', 'repo': 'AmberX-AXF', 'pull_number': '12'}) for a path without its query,
    or None when the hub has no tool for it."""
    segs = [unquote(s) for s in path.split("?")[0].strip("/").split("/")] if path.strip("/") else []
    for m, tpl, tool in ROUTES:
        if m != method.upper():
            continue
        parts = tpl.strip("/").split("/")
        params: dict[str, str] = {}
        ok = True
        for i, t in enumerate(parts):
            if t.startswith("{+"):
                rest = segs[i:]
                if not rest:
                    ok = False
                else:
                    params[t[2:-1]] = "/".join(rest)
                break
            if i >= len(segs):
                ok = False
                break
            if t.startswith("{"):
                params[t[1:-1]] = segs[i]
            elif t != segs[i]:
                ok = False
                break
        else:
            ok = ok and len(segs) == len(parts)
        if ok:
            return tool, params
    return None


def _coerce(k: str, v: Any) -> Any:
    if k in INT_PARAMS and isinstance(v, str) and v.isdigit():
        return int(v)
    if k in BOOL_PARAMS and isinstance(v, str) and v in ("true", "false"):
        return v == "true"
    return v


def hub_args(params: Mapping[str, str], query: str, body: Any = None) -> dict[str, Any]:
    """The hub tool's arguments: path parameters + query parameters (numbers and booleans typed) + body."""
    args: dict[str, Any] = {k: _coerce(k, v) for k, v in params.items()}
    for k, v in parse_qsl(query, keep_blank_values=False):
        args.setdefault(k, _coerce(k, v))
    if body is not None:
        args["body"] = body
    return args


def parse_hub_text(text: str) -> tuple[Any, int | None]:
    """(GitHub's JSON, next page or None) from the text axHub answers: the JSON, optionally followed by its
    "More pages are available … next: … page=N" trailer."""
    nxt = next_page(text)
    body = _TRAILER_RE.sub("", text).strip()
    if not body:
        return None, nxt
    try:
        return json.JSONDecoder().raw_decode(body)[0], nxt
    except ValueError:
        raise HubError("axHub's answer isn't GitHub JSON") from None


def next_page(text: str) -> int | None:
    m = _TRAILER_RE.search(text or "")
    if not m:
        return None
    n = _NEXT_RE.search(m.group(0))
    return int(n.group(1)) if n else None


# ---------------------------------------------------------------- the hub link (MCP over https, the console's own token)

class HubLink:
    """One axHub MCP endpoint (`<url>/mcp`) and the console's hub token (a callable, read on every call). https only
    (plain http only to this machine, for tests), never follows a redirect, the token goes to the hub origin only."""

    def __init__(self, url: str | Callable[[], str], token: Callable[[], str] | str, *, transport: Transport | None = None,
                 client_name: str = "axf-console-github") -> None:
        self._url = url if callable(url) else (lambda: url)
        self._token = token if callable(token) else (lambda: token)
        self.transport = transport
        self.client_name = client_name
        self._sid: str | None = None
        self._lock = threading.Lock()

    @classmethod
    def from_env(cls, **kw: Any) -> "HubLink":
        """AXHUB_URL (else AXF_WALL_HUB, else https://axhub.amberxai.com) + AXHUB_TOKEN, read on every call."""
        return cls(lambda: (os.environ.get("AXHUB_URL") or os.environ.get("AXF_WALL_HUB") or "https://axhub.amberxai.com").rstrip("/"),
                   lambda: os.environ.get("AXHUB_TOKEN", ""), **kw)

    def url(self) -> str:
        try:
            return (self._url() or "").rstrip("/")
        except Exception:  # noqa: BLE001
            return ""

    def token(self) -> str:
        try:
            return (self._token() or "").strip()
        except Exception:  # noqa: BLE001
            return ""

    def configured(self) -> bool:
        return bool(self.url() and self.token())

    def _rpc(self, sid: str | None, method: str, params: dict[str, Any], timeout: float) -> tuple[dict[str, Any], str | None]:
        url, tok = self.url(), self.token()
        if not url or not tok:
            raise HubUnreachable("axHub isn't connected here (no AXHUB_TOKEN)")
        headers = {"authorization": f"Bearer {tok}", "content-type": "application/json", "accept": "application/json, text/event-stream"}
        headers.update(hub_session.headers())  # axHub 109: approvals say who asked (console, or the agent acting)
        if sid:
            headers["mcp-session-id"] = sid
        body = json.dumps({"jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": method, "params": params}).encode()
        try:
            r = http.request("POST", f"{url}/mcp", headers=headers, body=body, timeout=timeout, max_bytes=8_000_000,
                             truncate=False, redirects="never", transport=self.transport)
        except HttpError as e:
            raise HubUnreachable(f"couldn't reach axHub ({type(e).__name__})") from None
        if r.status == 404 and sid:
            raise _SessionGone()
        if r.status in (401, 403):
            raise HubUnreachable(f"axHub refused the console's hub token ({r.status})")
        if not r.ok:
            raise HubUnreachable(f"axHub answered {r.status}")
        raw = r.text()
        try:
            if "text/event-stream" in r.headers.get("content-type", ""):
                msgs = [json.loads(ln[5:].strip()) for ln in raw.splitlines() if ln.startswith("data:") and ln[5:].strip()]
                msg = next((m for m in reversed(msgs) if "result" in m or "error" in m), {})
            else:
                msg = json.loads(raw or "{}")
        except ValueError:
            raise HubUnreachable("axHub's answer isn't JSON-RPC") from None
        if "error" in msg:
            raise HubUnreachable(str((msg["error"] or {}).get("message") or "axHub error")[:200])
        return msg.get("result") or {}, r.headers.get("mcp-session-id") or sid

    def _session(self, timeout: float) -> str | None:
        with self._lock:
            if self._sid is None:
                _, self._sid = self._rpc(None, "initialize", {"protocolVersion": MCP_PROTOCOL, "capabilities": {},
                                                              "clientInfo": {"name": self.client_name, "version": "1"}}, timeout)
                self._sid = self._sid or ""
            return self._sid or None

    def call(self, tool: str, arguments: dict[str, Any], timeout: float = 30) -> str:
        """axHub `call` (hold: false, so nothing is ever left waiting on the hub): the tool's text answer, or
        HubDownstream / HubNeedsApproval / HubUnreachable."""
        for attempt in (0, 1):
            sid = self._session(timeout)
            try:
                res, _ = self._rpc(sid, "tools/call", {"name": "call", "arguments": {"tool": tool, "arguments": arguments, "hold": False,
                                                                                       "timeout_seconds": int(max(5, timeout))}}, timeout + 10)
                break
            except _SessionGone:
                with self._lock:
                    self._sid = None
                if attempt:
                    raise HubUnreachable("axHub keeps dropping the session") from None
        texts = [c.get("text", "") for c in res.get("content", []) if isinstance(c, dict)]
        text = "\n".join(texts)
        if not res.get("isError"):
            return text
        try:
            err = (json.loads(text) or {}).get("error") or {}
        except ValueError:
            err = {"message": text}
        code = str(err.get("code") or "")
        msg = str(err.get("message") or "axHub error")
        if code == "confirmation_required":
            raise HubNeedsApproval("axHub holds this call for approval")
        status = (err.get("details") or {}).get("status")
        if not isinstance(status, int):
            m = _STATUS_RE.search(msg)
            status = int(m.group(1)) if m else None
        if status:
            raise HubDownstream(status, msg[:300])
        raise HubUnreachable(f"axHub couldn't run {tool}: {msg[:160]}")


class _SessionGone(HubError):
    pass


# ---------------------------------------------------------------- the client

class HubGitHubClient(GitHubClient):
    """`GitHubClient` whose API calls go through axHub first (or the local token first, by `route()`)."""

    def __init__(self, token: Callable[[], str] | str = "", *, hub: HubLink | None = None, route: Callable[[], str] | str = "hub",
                 base_url: str = API_BASE, **kw: Any) -> None:
        super().__init__(token, base_url=base_url, **kw)
        self.hub = hub or HubLink.from_env()
        self._route = route if callable(route) else (lambda: route)
        self.last_route = ""
        self.last_fallback = ""  # why the last call used the other route ('' when it didn't)

    def route(self) -> str:
        try:
            r = self._route()
        except Exception:  # noqa: BLE001
            r = "hub"
        return r if r in ROUTE_MODES else "hub"

    def has_token(self) -> bool:
        """A call can be made when either route has credentials (call() picks)."""
        return bool(self.token()) or self.hub.configured()

    def _hub_call(self, method: str, full: str, body: Any, timeout: float | None) -> Response:
        split = urlsplit(full)
        path = split.path
        hit = match_route(method, path)
        if not hit:
            raise _NoRoute()
        tool, params = hit
        args = hub_args(params, split.query, body)
        url = self.url(full, allow_other_origins=True)
        try:
            text = self.hub.call(f"github.{tool}", args, timeout or self.timeout)
        except HubDownstream as e:
            return Response(e.status, {"content-type": "application/json", "x-axf-route": "axhub"},
                            json.dumps({"message": self._scrub(str(e))[:200]}).encode(), url)
        data, nxt = parse_hub_text(text)
        headers = {"content-type": "application/json", "x-axf-route": "axhub"}
        if nxt:
            q = dict(parse_qsl(split.query))
            q["page"] = str(nxt)
            headers["link"] = f'<{self.base_url}{path}?{urlencode(q)}>; rel="next"'
        return Response(200, headers, json.dumps(data).encode(), url)

    def _local(self, method: str, path: str, body: Any, **kw: Any) -> Response:
        r = super().call(method, path, body, **kw)
        r.headers["x-axf-route"] = "local"
        return r

    def call(self, method: str, path: str, body: Any = None, *, query: Mapping[str, Any] | None = None,
             auth_required: bool = True, timeout: float | None = None, max_bytes: int | None = None,
             truncate: bool = False) -> Response:
        kw = dict(query=query, auth_required=auth_required, timeout=timeout, max_bytes=max_bytes, truncate=truncate)
        q = urlencode([(k, ("true" if v else "false") if isinstance(v, bool) else str(v)) for k, v in (query or {}).items() if v is not None])
        full = path + (("&" if "?" in path else "?") + q if q else "")
        hub_first = self.route() == "hub"
        self.last_fallback = ""

        def via_hub() -> Response:
            r = self._hub_call(method, full, body, timeout)
            self.last_route = "axhub"
            return r

        def via_local() -> Response:
            r = self._local(method, path, body, **kw)
            self.last_route = "local"
            return r

        if hub_first:
            try:
                r = via_hub()
                if r.status not in (401, 403) or not self.token():
                    return r
                self.last_fallback = f"axHub's GitHub token was refused ({r.status})"
            except _NoRoute:
                self.last_fallback = "the hub has no tool for this call"
            except (HubUnreachable, HubNeedsApproval) as e:
                self.last_fallback = str(e)
            except HubError as e:
                self.last_fallback = str(e)
            if not self.token():
                raise GitHubError(0, f"GitHub through axHub didn't work ({self.last_fallback}) and {self.token_hint} isn't set")
            return via_local()

        # local first
        loc: Response | None = None
        if self.token():
            try:
                loc = via_local()
                if loc.status not in (401, 403):
                    return loc
                self.last_fallback = f"{self.token_hint} was refused ({loc.status})"
            except GitHubError as e:
                if e.status != 0:
                    raise
                self.last_fallback = str(e)
        else:
            self.last_fallback = f"{self.token_hint} isn't set"
        try:
            return via_hub()
        except _NoRoute:
            if loc is not None:
                return loc  # nothing better: the local answer stands
            raise GitHubError(0, f"{self.token_hint} isn't set and the hub has no tool for this call") from None
        except HubError as e:
            if loc is not None:
                return loc
            raise GitHubError(0, f"GitHub didn't work locally ({self.last_fallback}) or through axHub ({e})") from None


class _NoRoute(HubError):
    pass
