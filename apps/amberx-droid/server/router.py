"""AmberX's LLM router: provider profiles kept on the server, an active profile, a fallback order, keep-alive.

The page never holds a key. Profiles live in `<data>/ai.json` (amberx-ai@1, 0600 in a 0700 folder):

    {"$axf": "amberx-ai@1", "profiles": {"<id>": {"id", "kind", "label", "model", "baseUrl", "enabled",
                                                    "key"?, "refresh"?, "expiresAt"?}},
     "order": ["<id>", …], "active": "<id>", "keepAliveMin": 10}

Kinds come from the framework's provider registry (framework/schemas/ai-providers.json through
`axf.assistant_host.providers`, 18 kinds); requests are built with its wire helpers. Keys are write-only: stored here
or read from the environment (AMBERX_<KIND>_API_KEY, e.g. AMBERX_ANTHROPIC_API_KEY, AMBERX_OPENAI_API_KEY,
AMBERX_GEMINI_API_KEY; the Claude plan: AMBERX_CLAUDE_OAUTH_TOKEN [+ AMBERX_CLAUDE_REFRESH_TOKEN]; then the registry's
own variable, e.g. ANTHROPIC_API_KEY) and never returned.

**Claude: plan or API.** One switch (`set_claude("plan" | "api")`) makes the Claude profile of that kind active and
first in the fallback order (one is created when missing):
  * plan = kind `claude-code`: the framework's `claude-cli` protocol, i.e. the Claude Code CLI in this image, run
    headless with no file tools in an empty throwaway folder, authenticated per call with the subscription's OAuth
    token (`claude setup-token` gives a long-lived one; a pair sk-ant-oat… + sk-ant-ort… is refreshed before it
    expires through Anthropic's OAuth refresh grant, the same way the console's AI keys plugin does).
  * api = kind `anthropic`: the Messages API with an API key (sk-ant-api…).

**Calls.** Every HTTP call goes through `axf_server.http`: https (plain http only to loopback or hosts named in
AMBERX_AI_HTTP_HOSTS), redirects never followed (a key never travels to another host), answers capped
(AMBERX_AI_MAX_BYTES, 2 MB), a timeout on every call (AMBERX_AI_TIMEOUT, 45 s). 429 / 5xx / timeouts are retried with
backoff (AMBERX_AI_RETRIES attempts, default 3), then the next profile in the fallback order is tried; who answered is
recorded. A keep-alive thread pings the active profile (and any that failed) every `keepAliveMin` minutes with a
tiny request, caching the result for /api/ai/status.
"""
from __future__ import annotations

import os
import random
import re
import threading
import time
from pathlib import Path
from typing import Any, Callable

from axf.assistant_host import providers
from axf_server import http, storage

FORMAT = "amberx-ai@1"
MAX_PROFILES = 20
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
MODEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$")
KEY_RE = re.compile(r"^[\x21-\x7e]{8,600}$")
EDITABLE_BASE = {"custom", "ollama", "lmstudio", "azure-openai"}
CLAUDE_KIND = {"plan": "claude-code", "api": "anthropic"}
LABELS = {"claude-code": "Claude (plan)", "anthropic": "Claude API"}
OAUTH_URL = os.environ.get("AMBERX_CLAUDE_OAUTH_URL") or "https://console.anthropic.com/v1/oauth/token"
OAUTH_CLIENT_ID = os.environ.get("AMBERX_CLAUDE_OAUTH_CLIENT_ID") or "9d1c250a-e61b-44d9-88ed-5944d1962f5e"  # Claude Code's public client
FRESH_MS = 5 * 60 * 1000      # a call refreshes a pair this close to expiry
AHEAD_MS = 30 * 60 * 1000     # the keep-alive thread refreshes pairs this close to expiry
PING = [{"role": "user", "content": "Reply with exactly: OK"}]

# The framework's provider module is configured once for this host (its hooks, never a copy of it).
providers.USER_AGENT = "AmberX/1"
providers.HOST_LABEL = "the AmberX server"
providers.ENV_PREFIXES_HIDDEN = [*providers.ENV_PREFIXES_HIDDEN, "AMBERX_", "APP_"]
_CURRENT: dict[str, "Router"] = {}


def _override(profile: dict[str, Any]) -> str:
    """providers.key_override: the key the router holds for this profile (stored or from the environment)."""
    r = _CURRENT.get("router")
    pid = profile.get("amberxProfile")
    return r.key_for(pid) if r and isinstance(pid, str) else ""


providers.key_override = _override


def _now_ms() -> int:
    return int(time.time() * 1000)


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name) or default)
    except ValueError:
        return default


class CallError(Exception):
    def __init__(self, message: str, retryable: bool = False, status: int = 0):
        super().__init__(message)
        self.retryable = retryable
        self.status = status


class AllFailed(Exception):
    def __init__(self, tried: list[dict[str, Any]], message: str):
        super().__init__(message)
        self.tried = tried


def _scrub(msg: str, *secret_values: str) -> str:
    for s in secret_values:
        if s:
            msg = msg.replace(s, "…")
    msg = re.sub(r"sk-[A-Za-z0-9_-]{8,}", "sk-…", msg)
    return msg[:300]


def default_refresh(refresh: str) -> dict[str, Any]:
    """Anthropic's OAuth refresh grant (= the console's AI keys plugin): → {access, refresh, expiresAt}. Raises."""
    r = http.request("POST", OAUTH_URL, json_body={"grant_type": "refresh_token", "refresh_token": refresh, "client_id": OAUTH_CLIENT_ID},
                     headers={"Accept": "application/json"}, timeout=20, max_bytes=64_000)
    try:
        d = r.json() or {}
    except ValueError:
        d = {}
    if not r.ok:
        raise RuntimeError(f"refresh refused ({r.status})")
    access = str(d.get("access_token") or "")
    if not access.startswith("sk-ant-oat"):
        raise RuntimeError("the refresh answer had no access token")
    return {"access": access, "refresh": str(d.get("refresh_token") or refresh),
            "expiresAt": _now_ms() + int(d.get("expires_in") or 28800) * 1000}


def default_cli(profile: dict[str, Any], messages: list[dict[str, Any]], system: str, model: str, max_tokens: int) -> str:
    """The Claude plan through the framework's claude-cli protocol: no file tools, an empty folder (read_files=False)."""
    out = providers.collect(providers.stream_chat(profile, messages, system=system, model=model, params={"max_tokens": max_tokens}, read_files=False))
    return str(out.get("text") or "")


class Router:
    def __init__(self, data_dir: str | os.PathLike[str], *, transport: http.Transport | None = None,
                 cli: Callable[..., str] | None = None, refresher: Callable[[str], dict[str, Any]] | None = None,
                 sleep: Callable[[float], None] = time.sleep, env: Callable[[str], str | None] | None = None) -> None:
        self.dir = Path(data_dir)
        self.file = self.dir / "ai.json"
        self.transport = transport
        self.cli = cli or default_cli
        self.refresher = refresher or default_refresh
        self.sleep = sleep
        self.env = env or os.environ.get
        self.lock = threading.RLock()
        self.health: dict[str, dict[str, Any]] = {}
        self.last: dict[str, Any] | None = None
        self.timeout = _env_float("AMBERX_AI_TIMEOUT", 45)
        self.max_bytes = int(_env_float("AMBERX_AI_MAX_BYTES", 2 * 1024 * 1024))
        self.retries = max(1, min(5, int(_env_float("AMBERX_AI_RETRIES", 3))))
        self.http_hosts = tuple(h.strip().lower() for h in (self.env("AMBERX_AI_HTTP_HOSTS") or "").split(",") if h.strip())
        providers.CLI_DEADLINE = max(self.timeout, 30.0)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        _CURRENT["router"] = self

    # ------------------------------------------------------------ the store

    def _load(self) -> dict[str, Any]:
        raw = storage.read_json(self.file, {})
        raw = raw if isinstance(raw, dict) else {}
        profs = {k: v for k, v in (raw.get("profiles") or {}).items() if isinstance(v, dict) and ID_RE.match(str(k)) and providers.kind(str(v.get("kind")))} \
            if isinstance(raw.get("profiles"), dict) else {}
        order = [i for i in raw.get("order") or [] if isinstance(i, str) and i in profs]
        order += [i for i in profs if i not in order]
        active = raw.get("active") if raw.get("active") in profs else (order[0] if order else "")
        every = raw.get("keepAliveMin")
        every = int(every) if isinstance(every, (int, float)) and not isinstance(every, bool) and 0 <= every <= 60 else 10
        return {"$axf": FORMAT, "profiles": profs, "order": order, "active": active, "keepAliveMin": every}

    def _save(self, db: dict[str, Any]) -> None:
        storage.write_json(self.file, db, indent=None)

    # ------------------------------------------------------------ keys (write-only)

    def _env_key_names(self, kind: str) -> list[str]:
        if kind == "claude-code":
            names = ["AMBERX_CLAUDE_OAUTH_TOKEN"]
        else:
            names = [f"AMBERX_{re.sub(r'[^A-Z0-9]', '_', kind.upper())}_API_KEY"]
        reg = providers.kind(kind).get("keyEnv")
        return names + ([reg] if reg else [])

    def key_for(self, pid: str) -> str:
        db = self._load()
        p = db["profiles"].get(pid)
        if not p:
            return ""
        if p.get("key"):
            return str(p["key"])
        for n in self._env_key_names(str(p["kind"])):
            v = (self.env(n) or "").strip()
            if v:
                return v
        return ""

    def key_source(self, p: dict[str, Any]) -> str:
        if p.get("key"):
            return "saved"
        if any((self.env(n) or "").strip() for n in self._env_key_names(str(p["kind"]))):
            return "env"
        cat = providers.kind(str(p["kind"]))
        if cat.get("local") or cat.get("auth") == "none":
            return "not needed"
        return "none"

    def usable(self, p: dict[str, Any]) -> bool:
        return bool(p.get("enabled", True)) and self.key_source(p) != "none"

    def set_key(self, pid: str, key: str | None, refresh: str | None = None) -> dict[str, Any]:
        """Save (or with key None / "" clear) a profile's key. A refresh token makes it a subscription pair."""
        with self.lock:
            db = self._load()
            p = db["profiles"].get(pid)
            if not p:
                raise KeyError(pid)
            for f in ("key", "refresh", "expiresAt"):
                p.pop(f, None)
            if key:
                key = re.sub(r"\s+", "", key)
                if not KEY_RE.match(key):
                    raise ValueError("that doesn't look like a key")
                if p["kind"] == "anthropic" and key.startswith("sk-ant-oat"):
                    raise ValueError("that is a Claude subscription token: put it on the Claude plan profile")
                if p["kind"] == "claude-code" and key.startswith("sk-ant-api"):
                    raise ValueError("that is an Anthropic API key: put it on the Claude API profile")
                p["key"] = key
                if refresh:
                    refresh = re.sub(r"\s+", "", refresh)
                    if p["kind"] != "claude-code" or not re.match(r"^sk-ant-ort[A-Za-z0-9_-]{20,400}$", refresh):
                        raise ValueError("a refresh token (sk-ant-ort…) goes with a Claude plan token only")
                    p["refresh"] = refresh
                    p["expiresAt"] = 0  # unknown: refreshed before the first call
            self._save(db)
            self.health.pop(pid, None)
            return self.public_profile(p)

    def _fresh_token(self, pid: str, ahead_ms: int = FRESH_MS) -> None:
        """A Claude plan pair close to expiry gets a new access token (the rotated pair is stored)."""
        with self.lock:
            db = self._load()
            p = db["profiles"].get(pid)
            if not p or p.get("kind") != "claude-code":
                return
            if p.get("refresh"):
                refresh = str(p["refresh"])
                exp = int(p.get("expiresAt") or 0)
                if exp and exp - _now_ms() > ahead_ms:
                    return
            else:
                # a saved single token (claude setup-token, long-lived) is used as is; an env pair is traded once for
                # a stored, rotated pair (the stored one wins from then on)
                refresh = (self.env("AMBERX_CLAUDE_REFRESH_TOKEN") or "").strip()
                if p.get("key") or not refresh:
                    return
            try:
                new = self.refresher(refresh)
            except Exception as e:  # noqa: BLE001
                p["refreshError"] = _scrub(str(e), refresh)
                self._save(db)
                return
            p.update({"key": new["access"], "refresh": new.get("refresh") or refresh, "expiresAt": int(new.get("expiresAt") or 0)})
            p.pop("refreshError", None)
            self._save(db)

    # ------------------------------------------------------------ config

    def label_of(self, p: dict[str, Any]) -> str:
        return str(p.get("label") or LABELS.get(str(p["kind"])) or providers.kind(str(p["kind"])).get("label") or p["kind"])

    def model_of(self, p: dict[str, Any]) -> str:
        return str(p.get("model") or (providers.kind(str(p["kind"])).get("models") or [""])[0])

    def public_profile(self, p: dict[str, Any]) -> dict[str, Any]:
        src = self.key_source(p)
        h = self.health.get(p["id"])
        return {"id": p["id"], "kind": p["kind"], "label": self.label_of(p), "model": self.model_of(p), "baseUrl": str(p.get("baseUrl") or ""),
                "enabled": bool(p.get("enabled", True)), "hasKey": src != "none", "keySource": src, "pair": bool(p.get("refresh")),
                "expiresAt": p.get("expiresAt") or None, "refreshError": p.get("refreshError") or None,
                "health": {k: h[k] for k in ("ok", "at", "ms", "error") if k in h} if h else None}

    def config(self) -> dict[str, Any]:
        db = self._load()
        active = db["profiles"].get(db["active"])
        claude = next((m for m, k in CLAUDE_KIND.items() if active and active["kind"] == k), "")
        kinds = [{"kind": c["kind"], "label": LABELS.get(c["kind"], c.get("label") or c["kind"]), "protocol": c.get("protocol"), "models": c.get("models") or [],
                  "baseUrl": c.get("baseUrl") or "", "editableBaseUrl": c["kind"] in EDITABLE_BASE, "needsKey": not (c.get("local") or c.get("auth") == "none"),
                  "keyUrl": c.get("keyUrl") or "", "envNames": self._env_key_names(c["kind"])} for c in providers.CATALOG]
        return {"format": FORMAT, "profiles": [self.public_profile(db["profiles"][i]) for i in db["order"]], "order": db["order"], "active": db["active"],
                "claude": claude, "keepAliveMin": db["keepAliveMin"], "kinds": kinds, "cli": providers.cli_available(), "last": self.last}

    def _clean_profile(self, raw: dict[str, Any], old: dict[str, Any] | None, taken: set[str]) -> dict[str, Any]:
        kind = str(raw.get("kind") or (old or {}).get("kind") or "")
        if not providers.kind(kind):
            raise ValueError(f"unknown provider kind {kind[:40]!r}")
        if old and old["kind"] != kind:
            raise ValueError("a profile's kind can't change: add a new profile instead")
        pid = str(raw.get("id") or "")
        if not old:
            if not pid:
                n = 1
                while f"{kind}-{n}" in taken:
                    n += 1
                pid = f"{kind}-{n}"
            if not ID_RE.match(pid) or pid in taken:
                raise ValueError(f"bad or duplicate profile id {pid[:40]!r}")
        label = re.sub(r"\s+", " ", str(raw.get("label") or "")).strip()[:60]
        model = str(raw.get("model") or "").strip()
        if model and not MODEL_RE.match(model):
            raise ValueError("bad model name")
        base = str(raw.get("baseUrl") or "").strip()
        if base:
            if kind not in EDITABLE_BASE:
                raise ValueError(f"{kind} uses its own address")
            if not http.target_ok(base, self.http_hosts) or len(base) > 300:
                raise ValueError("the address must be https (plain http only to this machine or a host in AMBERX_AI_HTTP_HOSTS)")
        p = dict(old or {})
        p.update({"id": old["id"] if old else pid, "kind": kind, "label": label, "model": model, "baseUrl": base.rstrip("/"),
                  "enabled": raw.get("enabled") is not False})
        return p

    def update_config(self, body: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            db = self._load()
            if "profiles" in body:
                if not isinstance(body["profiles"], list) or len(body["profiles"]) > MAX_PROFILES:
                    raise ValueError(f"profiles is a list of at most {MAX_PROFILES}")
                new: dict[str, dict[str, Any]] = {}
                for raw in body["profiles"]:
                    if not isinstance(raw, dict):
                        raise ValueError("each profile is an object")
                    old = db["profiles"].get(str(raw.get("id") or ""))
                    p = self._clean_profile(raw, old, set(new) | set(db["profiles"]) if not old else set(new))
                    if p["id"] in new:
                        raise ValueError("duplicate profile id")
                    new[p["id"]] = p
                for gone in set(db["profiles"]) - set(new):
                    self.health.pop(gone, None)  # its key goes with it
                db["profiles"] = new
                db["order"] = [i for i in db["order"] if i in new] + [i for i in new if i not in db["order"]]
            if "order" in body:
                order = body["order"]
                if not isinstance(order, list) or not all(isinstance(i, str) for i in order):
                    raise ValueError("order is a list of profile ids")
                db["order"] = [i for i in dict.fromkeys(order) if i in db["profiles"]] + [i for i in db["order"] if i not in order]
            if "active" in body:
                a = str(body["active"] or "")
                if a and a not in db["profiles"]:
                    raise ValueError("no such profile")
                db["active"] = a
            if "keepAliveMin" in body:
                v = body["keepAliveMin"]
                if not isinstance(v, (int, float)) or isinstance(v, bool) or not 0 <= v <= 60:
                    raise ValueError("keepAliveMin is 0 (off) to 60 minutes")
                db["keepAliveMin"] = int(v)
            if db["active"] not in db["profiles"]:
                db["active"] = db["order"][0] if db["order"] else ""
            self._save(db)
            if body.get("claude") in CLAUDE_KIND:
                return self.set_claude(str(body["claude"]))
            return self.config()

    def set_claude(self, mode: str) -> dict[str, Any]:
        """The Claude switch: plan (subscription, claude-code) or API (anthropic) becomes active and first in line."""
        if mode not in CLAUDE_KIND:
            raise ValueError("claude is plan or api")
        kind = CLAUDE_KIND[mode]
        with self.lock:
            db = self._load()
            pid = next((i for i in db["order"] if db["profiles"][i]["kind"] == kind and db["profiles"][i].get("enabled", True)), "") \
                or next((i for i in db["order"] if db["profiles"][i]["kind"] == kind), "")
            if not pid:
                if len(db["profiles"]) >= MAX_PROFILES:
                    raise ValueError("too many profiles")
                pid = f"claude-{mode}"
                n = 1
                while pid in db["profiles"]:
                    n += 1
                    pid = f"claude-{mode}-{n}"
                db["profiles"][pid] = {"id": pid, "kind": kind, "label": "", "model": "", "baseUrl": "", "enabled": True}
            db["profiles"][pid]["enabled"] = True
            db["active"] = pid
            db["order"] = [pid] + [i for i in db["order"] if i != pid]
            self._save(db)
        return self.config()

    # ------------------------------------------------------------ calling

    def chain(self) -> list[dict[str, Any]]:
        """Who is asked, in order: the active profile, then the fallback order; ones known to be down go last."""
        db = self._load()
        ids = list(dict.fromkeys([db["active"], *db["order"]]))
        profs = [db["profiles"][i] for i in ids if i in db["profiles"] and self.usable(db["profiles"][i])]
        down = [p for p in profs if (self.health.get(p["id"]) or {}).get("ok") is False]
        return [p for p in profs if p not in down] + down

    def _wire_profile(self, p: dict[str, Any]) -> dict[str, Any]:
        """What the framework's provider helpers see: no key (the key_override hook supplies it)."""
        return {"kind": p["kind"], "baseUrl": p.get("baseUrl") or "", "defaultModel": self.model_of(p), "amberxProfile": p["id"]}

    def _http(self, url: str, headers: dict[str, str], body: dict[str, Any], key: str) -> Any:
        try:
            r = http.request("POST", url, headers=headers, json_body=body, timeout=self.timeout, max_bytes=self.max_bytes,
                             redirects="never", allow_http_hosts=self.http_hosts, transport=self.transport)
        except http.ResponseTooLarge as e:
            raise CallError(f"the answer was too big ({e})") from None
        except http.TargetRefused as e:
            raise CallError(str(e)) from None
        except http.HttpError as e:
            raise CallError(f"no answer ({_scrub(str(e), key)})", retryable=True) from None
        if r.redirect:
            raise CallError(f"the provider redirected (HTTP {r.status}); redirects are never followed with a key", status=r.status)
        if not r.ok:
            detail = ""
            try:
                j = r.json() or {}
                err = j.get("error", j) if isinstance(j, dict) else j
                detail = str(err.get("message") if isinstance(err, dict) else err)
            except ValueError:
                detail = r.text()[:200]
            retry = r.status in (408, 409, 425, 429) or r.status >= 500
            raise CallError(f"HTTP {r.status}: {_scrub(detail, key)}", retryable=retry, status=r.status)
        try:
            return r.json()
        except ValueError:
            raise CallError("the provider's answer wasn't JSON", retryable=True) from None

    def call_profile(self, p: dict[str, Any], messages: list[dict[str, Any]], system: str, max_tokens: int) -> str:
        """One request to one profile (no retries)."""
        wp = self._wire_profile(p)
        proto = providers.protocol_of(wp)
        model = self.model_of(p)
        if not model:
            raise CallError("no model set for this provider")
        if proto == "claude-cli":
            self._fresh_token(p["id"])
            try:
                return self.cli(wp, messages, system, model, max_tokens)
            except providers.ProviderError as e:
                raise CallError(_scrub(str(e)), retryable=e.status >= 500, status=e.status) from None
            except OSError as e:
                raise CallError(f"the Claude Code CLI couldn't start ({e})") from None
        key = self.key_for(p["id"])
        base = providers._base(wp)  # noqa: SLF001 — the framework's own URL rule for a profile
        headers = providers._headers(wp, key)  # noqa: SLF001 — auth header style per kind (x-api-key, bearer, api-key)
        if proto == "anthropic":
            if key.startswith("sk-ant-oat"):
                raise CallError("this is a Claude plan token: use the Claude plan profile")
            body: dict[str, Any] = {"model": model, "max_tokens": max_tokens, "messages": providers._to_anthropic(messages)}  # noqa: SLF001
            if system:
                body["system"] = system
            j = self._http(f"{base}/v1/messages", headers, body, key)
            parts = (j or {}).get("content") if isinstance(j, dict) else None
            return "".join(str(b.get("text") or "") for b in parts or [] if isinstance(b, dict) and b.get("type") == "text")
        if proto == "openai":
            field = providers.kind(p["kind"]).get("maxTokensField") or "max_tokens"
            body = {"model": model, "messages": providers._to_openai(messages, system), field: max_tokens}  # noqa: SLF001
            j = self._http(f"{base}/chat/completions", headers, body, key)
            try:
                msg = j["choices"][0]["message"]["content"]
            except (KeyError, IndexError, TypeError):
                raise CallError("the provider's answer had no message", retryable=True) from None
            if isinstance(msg, list):  # some compatible APIs answer with parts
                msg = "".join(str(x.get("text") or "") for x in msg if isinstance(x, dict))
            return str(msg or "")
        raise CallError(f"no driver for protocol {proto}")

    def _with_retries(self, p: dict[str, Any], messages: list[dict[str, Any]], system: str, max_tokens: int) -> tuple[str, int]:
        last: CallError | None = None
        for attempt in range(self.retries):
            started = time.monotonic()
            try:
                text = self.call_profile(p, messages, system, max_tokens)
                return text, int((time.monotonic() - started) * 1000)
            except CallError as e:
                last = e
                if not e.retryable or attempt == self.retries - 1:
                    break
                self.sleep(min(8.0, 0.5 * (3 ** attempt)) * (0.8 + 0.4 * random.random()))
        assert last is not None
        raise last

    def complete(self, messages: list[dict[str, Any]], system: str = "", max_tokens: int = 1024) -> dict[str, Any]:
        """Ask the first profile in line that answers. → {text, profile, label, model, ms, tried}. Raises AllFailed."""
        chain = self.chain()
        if not chain:
            raise AllFailed([], "No AI provider is set up yet (Settings → Plugins → AI connection).")
        tried: list[dict[str, Any]] = []
        for p in chain:
            try:
                text, ms = self._with_retries(p, messages, system, max_tokens)
            except CallError as e:
                self.health[p["id"]] = {"ok": False, "at": _now_ms(), "error": str(e)}
                tried.append({"profile": p["id"], "label": self.label_of(p), "error": str(e)})
                continue
            self.health[p["id"]] = {"ok": True, "at": _now_ms(), "ms": ms}
            self.last = {"profile": p["id"], "label": self.label_of(p), "model": self.model_of(p), "at": _now_ms(), "ms": ms,
                         "fallback": bool(tried)}
            return {"text": text, "profile": p["id"], "label": self.label_of(p), "model": self.model_of(p), "ms": ms, "tried": tried}
        raise AllFailed(tried, "No provider answered: " + "; ".join(f"{t['label']}: {t['error']}" for t in tried)[:600])

    # ------------------------------------------------------------ health

    def check(self, pid: str) -> dict[str, Any]:
        """One tiny request to one profile (no fallback); the result is cached for the status."""
        db = self._load()
        p = db["profiles"].get(pid)
        if not p:
            raise KeyError(pid)
        if self.key_source(p) == "none":
            h = {"ok": False, "at": _now_ms(), "error": "no key saved and none in the environment"}
        else:
            try:
                text, ms = self._with_retries(p, PING, "You are a connection test.", 16)
                h = {"ok": True, "at": _now_ms(), "ms": ms, "reply": text.strip()[:40]}
            except CallError as e:
                h = {"ok": False, "at": _now_ms(), "error": str(e)}
        self.health[pid] = h
        return {**h, "profile": pid, "label": self.label_of(p), "model": self.model_of(p)}

    def _window_ms(self) -> int:
        every = self._load()["keepAliveMin"] or 10
        return max(2 * every, 5) * 60_000

    def status(self) -> dict[str, Any]:
        """{ok, provider, model, reason, checkedAt, answeredBy}: from the cache, checking the first few when it's cold."""
        chain = self.chain()
        if not chain:
            db = self._load()
            head = db["profiles"].get(db["active"])
            why = (f"{self.label_of(head)} has no key yet (Settings → Plugins → AI connection)." if head and head.get("enabled", True)
                   else "No AI provider is set up yet (Settings → Plugins → AI connection).")
            return {"ok": False, "provider": self.label_of(head) if head else "", "model": self.model_of(head) if head else "", "reason": why, "checkedAt": "", "answeredBy": None}
        now = _now_ms()
        win = self._window_ms()
        for p in chain[:3]:
            h = self.health.get(p["id"])
            if h and now - h["at"] < win:
                if h["ok"]:
                    break
                continue
            if h and now - h["at"] < 20_000:
                continue  # just checked: don't hammer it
            if self.check(p["id"])["ok"]:
                break
        db = self._load()
        head = db["profiles"].get(db["active"])
        for p in self.chain():
            h = self.health.get(p["id"])
            if h and h["ok"]:
                reason = ""
                if head and head["id"] != p["id"]:
                    hh = self.health.get(head["id"]) or {}
                    reason = f"{self.label_of(head)} isn't answering ({hh.get('error') or 'not checked'}); {self.label_of(p)} is." if self.usable(head) else f"{self.label_of(head)} has no key; {self.label_of(p)} answers."
                return {"ok": True, "provider": self.label_of(p), "model": self.model_of(p), "reason": reason,
                        "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(h["at"] / 1000)), "answeredBy": p["id"]}
        first = chain[0]
        h = self.health.get(first["id"]) or {}
        return {"ok": False, "provider": self.label_of(first), "model": self.model_of(first),
                "reason": f"No provider answers ({self.label_of(first)}: {h.get('error') or 'not checked'}).",
                "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime((h.get("at") or now) / 1000)), "answeredBy": None}

    def keep_alive_once(self) -> None:
        """Refresh Claude plan pairs near expiry; ping the active profile and any that failed (≤ 4)."""
        db = self._load()
        for pid, p in db["profiles"].items():
            if p.get("kind") == "claude-code" and p.get("refresh"):
                self._fresh_token(pid, AHEAD_MS)
        chain = self.chain()
        targets = chain[:1] + [p for p in chain[1:] if (self.health.get(p["id"]) or {}).get("ok") is False]
        for p in targets[:4]:
            self.check(p["id"])

    def start(self) -> None:
        if self._thread:
            return

        def loop() -> None:
            last = 0.0
            while not self._stop.wait(30):
                every = self._load()["keepAliveMin"]
                if every and time.monotonic() - last >= every * 60:
                    last = time.monotonic()
                    try:
                        self.keep_alive_once()
                    except Exception:  # noqa: BLE001 — the loop never dies
                        pass

        self._thread = threading.Thread(target=loop, name="amberx-ai-keepalive", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
