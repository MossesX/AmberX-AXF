"""GitHub REST helpers for AXF servers (lib-github, `x.lib.github`; stdlib only, built on `axf_server.http`).

    from axf_server import github
    gh = github.GitHubClient(lambda: os.environ.get("GITHUB_TOKEN", ""), user_agent="axf-console")
    runs = gh.get(github.repo_path("MossesX/AmberX-AXF", "actions", "workflows", "android.yml", "runs",
                                   query={"branch": "main", "status": "success", "per_page": 1}))
    blob = gh.download(art["archive_download_url"], max_bytes=200 << 20)   # artifact zip: redirect fetched without the token
    apk = github.zip_member(blob, lambda n: n.endswith(".apk"), max_bytes=200 << 20)
    env = {**os.environ, **github.git_env(token)}                          # token to git through the environment only

The Node twin is `framework/cli/github.mjs` (same names in camelCase). Both replay `framework/spec/fixtures/github.json`
(repo names, URL building, Link pagination, run states, token/redirect decisions, git auth config, scrubbing).

Rules (the strictest of the copies this replaced: console app_ci, app_catalog, main._gh/release_download, alerts,
the activity and systems-check plugins, claude-project.mjs, the project wizard):
  * **The token goes to the API origin only** (default https://api.github.com; `base_url` may name another https
    API or a loopback one for tests). Paths are joined to that origin and an absolute URL from an API answer
    (`artifacts_url`, `archive_download_url`, Link `next`) is refused unless it is on the same origin.
  * **API calls never follow redirects** (a 3xx is an error). `download()` follows up to MAX_REDIRECTS hops for
    artifact zips and job logs: every hop must be https (no plain http, no user:password) and is fetched **without**
    any credential, so the token never reaches blob storage or another host.
  * **Size caps and timeouts** on every call (JSON 8 MB by default; downloads take an explicit cap); `zip_member`
    also caps the unzipped size (a zip bomb can't fill the disk or memory).
  * **Owner / repo names are checked** before they reach a URL or git: owner `[A-Za-z0-9][A-Za-z0-9-]{0,38}`,
    repo `[A-Za-z0-9_][A-Za-z0-9._-]{0,99}` with no `..` (no leading `.` or `-`, so git can't read it as an option).
  * **git gets the token through the environment only** (`GIT_CONFIG_*`: an Authorization header scoped to
    https://github.com/ and `http.followRedirects=false`), never on a command line, in a URL or in .git/config.
  * **No secrets in errors or logs:** messages go through `scrub` (the token, its Basic form and anything that
    looks like a GitHub token are replaced by ***).

Placeholders (not built yet, open for later): uploads.github.com (release assets — the token would be allowed there
explicitly), GitHub App installation tokens, GraphQL, ETag caching / rate-limit backoff.
"""
from __future__ import annotations

import base64
import io
import os
import re
import zipfile
from typing import Any, Callable, Iterable, Mapping
from urllib.parse import quote, urlencode, urljoin, urlsplit

from . import http
from .http import HttpClient, HttpError, ResponseTooLarge, Response, Transport, origin_of, target_ok

__all__ = ["API_BASE", "GIT_BASE", "UPLOADS_BASE", "API_VERSION", "ACCEPT", "MAX_REDIRECTS", "FAILURE_CONCLUSIONS",
           "RUN_STATES", "GitHubError", "valid_owner", "valid_name", "valid_repo", "parse_repo", "repo_path", "api_path",
           "next_link", "run_state", "token_allowed", "redirect_step", "git_auth_config", "git_env", "scrub",
           "zip_member", "api_base_from_env", "GitHubClient"]

API_BASE = "https://api.github.com"
GIT_BASE = "https://github.com"
UPLOADS_BASE = "https://uploads.github.com"  # placeholder: release asset uploads (not used yet)
API_VERSION = "2022-11-28"
ACCEPT = "application/vnd.github+json"
MAX_REDIRECTS = 5
ERROR_MESSAGE_MAX = 200

OWNER_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}\Z")
NAME_RE = re.compile(r"(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9._-]{0,99}\Z")
SEGMENT_RE = re.compile(r"[A-Za-z0-9_][A-Za-z0-9._-]{0,199}\Z")
_PARSE_RE = re.compile(r"(?:https?://(?:www\.)?github\.com/|git@github\.com:)?([^/\s:]+)/([^/\s]+)\Z", re.IGNORECASE)
_TOKEN_RE = re.compile(r"(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})")
_LINK_RE = re.compile(r'<([^>]*)>\s*((?:;\s*[^;,]+)*)')

# GitHub Actions run / job / step: (status, conclusion) → one of these
RUN_STATES = ("queued", "waiting", "running", "success", "failure", "cancelled")
FAILURE_CONCLUSIONS = frozenset({"failure", "timed_out", "startup_failure"})
_CANCELLED_CONCLUSIONS = frozenset({"cancelled", "skipped", "neutral"})
_QUEUED_STATUSES = frozenset({"queued", "requested", "pending"})


class GitHubError(Exception):
    """A GitHub call that failed. `status` is the HTTP status (0 = not reachable / refused before sending).
    The message never carries a secret."""

    def __init__(self, status: int, message: str) -> None:
        self.status = status
        super().__init__(message)


# ---------------------------------------------------------------- names and paths (pure; fixture-pinned)

def valid_owner(s: Any) -> bool:
    return isinstance(s, str) and bool(OWNER_RE.match(s))


def valid_name(s: Any) -> bool:
    return isinstance(s, str) and bool(NAME_RE.match(s))


def valid_repo(s: Any) -> bool:
    """`owner/name` with both parts valid."""
    if not isinstance(s, str) or s.count("/") != 1:
        return False
    owner, name = s.split("/")
    return valid_owner(owner) and valid_name(name)


def parse_repo(s: Any) -> str | None:
    """'owner/name', 'https://github.com/owner/name(.git)' or 'git@github.com:owner/name.git' → 'owner/name' (None if
    it isn't one)."""
    if not isinstance(s, str):
        return None
    t = s.strip()[:300]
    t = re.sub(r"\.git\Z", "", t)
    t = re.sub(r"/+\Z", "", t)
    m = _PARSE_RE.match(t)
    if not m or not valid_owner(m.group(1)) or not valid_name(m.group(2)):
        return None
    return f"{m.group(1)}/{m.group(2)}"


def _query(query: Mapping[str, Any] | None) -> str:
    if not query:
        return ""
    pairs = [(k, ("true" if v else "false") if isinstance(v, bool) else str(v)) for k, v in query.items() if v is not None]
    return ("?" + urlencode(pairs)) if pairs else ""


def _segment(p: Any) -> str:
    s = str(p) if isinstance(p, (str, int)) and not isinstance(p, bool) else ""
    if not SEGMENT_RE.match(s) or ".." in s:
        raise ValueError(f"bad path part: {s[:40]!r}")
    return quote(s, safe="")


def api_path(*parts: Any, query: Mapping[str, Any] | None = None) -> str:
    """'/user/repos?per_page=100' from ('user', 'repos'), {'per_page': 100}. Every part is checked (no '/', no '..')."""
    return "/" + "/".join(_segment(p) for p in parts) + _query(query)


def repo_path(repo: str, *parts: Any, query: Mapping[str, Any] | None = None) -> str:
    """'/repos/<owner>/<name>/<parts…>?<query>' — the repo is checked first (ValueError when it isn't owner/name)."""
    if not valid_repo(repo):
        raise ValueError("repo must look like owner/name")
    owner, name = repo.split("/")
    return api_path("repos", owner, name, *parts, query=query)


def next_link(header: Any) -> str | None:
    """The rel="next" URL of a Link header (RFC 8288), or None."""
    if not isinstance(header, str):
        return None
    for m in _LINK_RE.finditer(header):
        url, params = m.group(1).strip(), m.group(2)
        for p in params.split(";"):
            k, _, v = p.strip().partition("=")
            if k.strip().lower() == "rel" and "next" in v.strip().strip('"').lower().split():
                return url or None
    return None


def run_state(status: Any, conclusion: Any) -> str:
    """GitHub Actions (status, conclusion) of a run, job or step → queued | waiting | running | success | failure |
    cancelled. A completed run that is neither success nor cancelled/skipped/neutral counts as failure."""
    st = str(status or "")
    if st == "in_progress":
        return "running"
    if st == "waiting":
        return "waiting"
    if st in _QUEUED_STATUSES:
        return "queued"
    if conclusion == "success":
        return "success"
    if conclusion in _CANCELLED_CONCLUSIONS:
        return "cancelled"
    return "failure"


# ---------------------------------------------------------------- token + redirect decisions (pure; fixture-pinned)

def token_allowed(url: Any, base: str = API_BASE) -> bool:
    """May the token be sent to `url`? Only when it is a valid target on exactly the API base's origin."""
    if not isinstance(url, str) or not target_ok(url) or not target_ok(base):
        return False
    return origin_of(url) == origin_of(base)


def redirect_step(current: str, location: Any, hop: int, max_hops: int = MAX_REDIRECTS) -> dict[str, Any]:
    """What a download does with a 3xx: {follow, url?, auth: False, reason?}. Hop `hop` (1 = the first redirect).
    The target must be https (plain http refused, even to this machine) without user:password; it is always fetched
    without credentials."""
    if not isinstance(location, str) or not location.strip():
        return {"follow": False, "auth": False, "reason": "no location"}
    if hop > max_hops:
        return {"follow": False, "auth": False, "reason": "too many redirects"}
    nxt = urljoin(current, location.strip())
    u = urlsplit(nxt)
    if u.scheme.lower() != "https" or not target_ok(nxt):
        return {"follow": False, "auth": False, "reason": "redirect target must be https"}
    return {"follow": True, "url": nxt, "auth": False}


# ---------------------------------------------------------------- git auth (pure config + env)

def git_auth_config(token: str, base: str = GIT_BASE) -> list[list[str]]:
    """git config pairs that authenticate pushes/fetches to `base` (https only; anything else gets none):
    an Authorization header scoped to that host, and no redirects (the header would follow them)."""
    if not token or not isinstance(base, str) or urlsplit(base).scheme.lower() != "https" or not target_ok(base):
        return []
    basic = base64.b64encode(f"x-access-token:{token}".encode()).decode()
    return [[f"http.{base.rstrip('/')}/.extraheader", f"Authorization: Basic {basic}"], ["http.followRedirects", "false"]]


def git_env(token: str, base: str = GIT_BASE, env: Mapping[str, str] | None = None) -> dict[str, str]:
    """Environment additions for one git command: GIT_TERMINAL_PROMPT=0 plus the auth config as GIT_CONFIG_COUNT /
    GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n (appended after any the environment already has). Never argv, never a URL."""
    out = {"GIT_TERMINAL_PROMPT": "0"}
    pairs = git_auth_config(token, base)
    if not pairs:
        return out
    src = os.environ if env is None else env
    try:
        start = max(0, int(src.get("GIT_CONFIG_COUNT", "0") or "0"))
    except ValueError:
        start = 0
    for i, (k, v) in enumerate(pairs):
        out[f"GIT_CONFIG_KEY_{start + i}"] = k
        out[f"GIT_CONFIG_VALUE_{start + i}"] = v
    out["GIT_CONFIG_COUNT"] = str(start + len(pairs))
    return out


def scrub(text: Any, secrets: Iterable[str] = ()) -> str:
    """`text` with every secret (and its git Basic form) and anything that looks like a GitHub token replaced by ***."""
    s = str(text)
    for t in secrets:
        if t and len(t) >= 4:
            s = s.replace(base64.b64encode(f"x-access-token:{t}".encode()).decode(), "***").replace(t, "***")
    return _TOKEN_RE.sub("***", s)


def zip_member(blob: bytes, pick: Callable[[str], bool], max_bytes: int) -> tuple[str, bytes]:
    """The first file in a zip whose name `pick` accepts (top-level names first), refusing one that unzips to more
    than `max_bytes`. GitHubError(0, …) when it isn't a zip, has no such file or is too large."""
    try:
        z = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile:
        raise GitHubError(0, "the artifact isn't a zip") from None
    with z:
        infos = [i for i in z.infolist() if not i.is_dir() and pick(i.filename)]
        infos.sort(key=lambda i: "/" in i.filename.strip("/"))
        if not infos:
            raise GitHubError(0, "the artifact has no matching file")
        info = infos[0]
        if info.file_size > max_bytes:
            raise GitHubError(0, f"{info.filename.rsplit('/', 1)[-1]} is larger than {max_bytes} bytes")
        with z.open(info) as fp:
            data = fp.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise GitHubError(0, f"{info.filename.rsplit('/', 1)[-1]} is larger than {max_bytes} bytes")
        return info.filename, data


def api_base_from_env(default: str = API_BASE) -> str:
    """GITHUB_API_URL when set (GitHub Enterprise, or a loopback fake in tests), else the default."""
    return (os.environ.get("GITHUB_API_URL") or default).rstrip("/")


# ---------------------------------------------------------------- client

class GitHubClient(HttpClient):
    """GitHub REST client on `HttpClient`: token only to the API origin, no redirects on API calls, size caps,
    timeouts, scrubbed errors. `token` is a string or a callable read on every call (a reset token applies at once)."""

    def __init__(self, token: Callable[[], str] | str = "", *, base_url: str = API_BASE, user_agent: str = "axf-server",
                 timeout: float = http.DEFAULT_TIMEOUT, max_bytes: int = http.DEFAULT_MAX_BYTES,
                 transport: Transport | None = None, token_hint: str = "GITHUB_TOKEN") -> None:
        base = (base_url or API_BASE).rstrip("/")
        if not target_ok(base) or urlsplit(base).query or urlsplit(base).fragment:
            raise ValueError("base_url must be an https API origin (plain http only on this machine)")
        self._token: Callable[[], str] = token if callable(token) else (lambda: token)
        self.token_hint = token_hint
        super().__init__(base, auth=self._auth, headers={"Accept": ACCEPT, "X-GitHub-Api-Version": API_VERSION},
                         timeout=timeout, max_bytes=max_bytes, redirects="never", auth_origins=(origin_of(base),),
                         user_agent=user_agent, transport=transport)

    # ---- token
    def token(self) -> str:
        try:
            return (self._token() or "").strip()
        except Exception:  # noqa: BLE001 — a broken provider is "no token"
            return ""

    def has_token(self) -> bool:
        return bool(self.token())

    def _auth(self) -> str:
        t = self.token()
        return f"Bearer {t}" if t else ""

    def _scrub(self, s: Any) -> str:
        return scrub(s, [self.token()])

    # ---- calls
    def call(self, method: str, path: str, body: Any = None, *, query: Mapping[str, Any] | None = None,
             auth_required: bool = True, timeout: float | None = None, max_bytes: int | None = None,
             truncate: bool = False) -> Response:
        """One API call. `path` is '/repos/…' or an absolute URL on the API origin (anything else: GitHubError).
        Without a token: GitHubError when `auth_required`, else the call goes out anonymous."""
        if auth_required and not self.has_token():
            raise GitHubError(0, f"{self.token_hint} isn't set")
        q = _query(query)
        full = path + (("&" + q[1:]) if q and "?" in path else q)
        if not token_allowed(self.url(full, allow_other_origins=True), self.base_url):
            raise GitHubError(0, "refused: that URL isn't on the GitHub API")
        kw: dict[str, Any] = {"truncate": truncate}
        if timeout is not None:
            kw["timeout"] = timeout
        if max_bytes is not None:
            kw["max_bytes"] = max_bytes
        if body is not None:
            kw["json_body"] = body
        try:
            return self.request(method, full, **kw)
        except ResponseTooLarge:
            raise GitHubError(0, "GitHub's answer is too large") from None
        except HttpError as e:
            raise GitHubError(0, f"GitHub not reachable: {self._scrub(e)[:200]}") from None

    def message(self, r: Response) -> str:
        """GitHub's `message` from an error answer (scrubbed, short), or ''."""
        try:
            data = r.json()
        except ValueError:
            return ""
        msg = data.get("message") if isinstance(data, dict) else ""
        return self._scrub(msg)[:ERROR_MESSAGE_MAX] if isinstance(msg, str) else ""

    def json(self, method: str, path: str, body: Any = None, **kw: Any) -> Any:
        """Call and parse JSON. Non-2xx (3xx included: redirects aren't followed) → GitHubError(status,
        'GitHub <status>: <message>'); an empty body is None."""
        r = self.call(method, path, body, **kw)
        if not r.ok:
            msg = self.message(r) or ("redirects aren't followed" if r.redirect else "request failed")
            raise GitHubError(r.status, f"GitHub {r.status}: {msg}")
        try:
            return r.json()
        except ValueError:
            raise GitHubError(r.status, f"GitHub {r.status}: the answer isn't JSON") from None

    def get(self, path: str, **kw: Any) -> Any:
        return self.json("GET", path, **kw)

    def paginate(self, path: str, key: str | None = None, *, max_pages: int = 10, max_items: int = 1000, **kw: Any) -> list[Any]:
        """Every item over Link rel="next" pages (same origin only), up to max_pages / max_items. `key` picks the list
        out of an object answer (e.g. 'workflow_runs')."""
        out: list[Any] = []
        url: str | None = path
        for _ in range(max(1, max_pages)):
            if not url:
                break
            r = self.call("GET", url, **kw)
            if not r.ok:
                raise GitHubError(r.status, f"GitHub {r.status}: {self.message(r) or 'request failed'}")
            data = r.json()
            items = data.get(key, []) if key and isinstance(data, dict) else data
            out.extend(items if isinstance(items, list) else [])
            if len(out) >= max_items:
                return out[:max_items]
            url = next_link(r.headers.get("link"))
            if url and not token_allowed(url, self.base_url):
                break  # a next page elsewhere is never followed (the token would go with it)
        return out

    def download(self, path: str, *, max_bytes: int, timeout: float | None = None, auth_required: bool = True) -> bytes:
        """GET bytes (artifact zip, job log). The first request goes to the API with the token; a redirect is followed
        under `redirect_step` (https only, at most MAX_REDIRECTS, never with a credential)."""
        r = self.call("GET", path, auth_required=auth_required, timeout=timeout, max_bytes=max_bytes)
        url = r.url
        hop = 0
        while r.redirect:
            hop += 1
            step = redirect_step(url, r.headers.get("location"), hop)
            if not step["follow"]:
                raise GitHubError(r.status, f"GitHub download refused: {step['reason']}")
            url = step["url"]
            try:
                r = http.request("GET", url, headers={"User-Agent": self.headers.get("User-Agent", "axf-server")},
                                 timeout=timeout or self.timeout, max_bytes=max_bytes, redirects="never",
                                 transport=self.transport)
            except ResponseTooLarge:
                raise GitHubError(0, f"download larger than {max_bytes} bytes") from None
            except HttpError as e:
                raise GitHubError(0, f"download failed: {self._scrub(e)[:200]}") from None
        if not r.ok:
            raise GitHubError(r.status, f"GitHub {r.status} on the download")
        if len(r.body) > max_bytes:  # a transport that doesn't cap (tests, custom) still can't hand back more
            raise GitHubError(0, f"download larger than {max_bytes} bytes")
        return r.body

    # ---- conveniences (repo checked by repo_path)
    def repo(self, repo: str) -> Any:
        return self.get(repo_path(repo))

    def workflow_runs(self, repo: str, workflow: str | None = None, **query: Any) -> list[Any]:
        parts: tuple[Any, ...] = ("actions", "workflows", workflow, "runs") if workflow else ("actions", "runs")
        data = self.get(repo_path(repo, *parts, query=query))
        runs = data.get("workflow_runs", []) if isinstance(data, dict) else []
        return runs if isinstance(runs, list) else []

    def run_jobs(self, repo: str, run_id: int | str, **query: Any) -> list[Any]:
        data = self.get(repo_path(repo, "actions", "runs", run_id, "jobs", query=query))
        jobs = data.get("jobs", []) if isinstance(data, dict) else []
        return jobs if isinstance(jobs, list) else []

    def run_artifacts(self, repo: str, run_id: int | str, **query: Any) -> list[Any]:
        data = self.get(repo_path(repo, "actions", "runs", run_id, "artifacts", query=query))
        arts = data.get("artifacts", []) if isinstance(data, dict) else []
        return arts if isinstance(arts, list) else []

    def dispatch(self, repo: str, workflow: str, ref: str, inputs: Mapping[str, Any] | None = None) -> None:
        self.json("POST", repo_path(repo, "actions", "workflows", workflow, "dispatches"), {"ref": ref, "inputs": dict(inputs or {})})

    def job_log(self, repo: str, job_id: int | str, *, max_bytes: int = 16 * 1024 * 1024) -> str:
        return self.download(repo_path(repo, "actions", "jobs", job_id, "logs"), max_bytes=max_bytes).decode("utf-8", "replace")

    def check_token(self, repo: str, *, timeout: float = 7) -> tuple[int, dict[str, str]]:
        """Does the token work for `repo`? (status, headers): 200 ok, 401/403 refused, 404 can't see it, 0 not
        reached. Reads at most 4 KB; never follows a redirect."""
        try:
            r = self.call("GET", repo_path(repo), timeout=timeout, max_bytes=4000, truncate=True)
        except GitHubError as e:
            return e.status, {}
        return r.status, r.headers
