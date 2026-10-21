"""Developer alerts for the Dev Console: the server half of the alerts library (framework/libs/alerts).

- **Engine:** a Python port of framework/core/engines/alerts.ts (same results; checked against
  framework/spec/fixtures/alerts.json by test_alerts.py): one alert per key, repeats bump the count, worse severity
  escalates, resolved alerts reopen; delivery rules per channel with per-source overrides.
- **Store:** `.axf-console/alerts.json`, config in `alerts-config.json`, the ntfy token in `alerts-secrets.json`, web
  push subscriptions in `alerts-push.json` and the VAPID key in `alerts-vapid.pem` (all 0600, never in git, the token
  and subscriptions are never sent to the browser).
- **Delivery:** the bell (the stored list, streamed to the console), ntfy (JSON publish to any ntfy server) and web
  push (pywebpush + a VAPID key made on first use). Delivery runs on a worker thread so raising never waits on a phone.
- **Sources** (each can be switched off in Settings → Alerts): GitHub Actions on the watched repos (`ci`, and `deploys`
  for workflows whose name or file says deploy), the systems check, the pending build list (an item failing, breaking
  or completing), plugins that fail to load or share an id, API crashes (middleware) and unclean restarts. Conflicts
  and page crashes come from the browser through POST /api/alerts.
"""
from __future__ import annotations

import base64
import json
import os
import queue
import re
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import http as axf_http, storage

# ---------------------------------------------------------------- engine (mirror of core/engines/alerts.ts)

SEVERITIES = ["info", "success", "warning", "error", "critical"]
DEFAULT_RULES: dict[str, Any] = {"channels": {"bell": {"min": "info"}, "ntfy": {"min": "error"}, "webpush": {"min": "error"}}}
LIMIT = 500
TITLE_MAX, BODY_MAX, KEY_MAX = 200, 2000, 200


def rank(s: str) -> int:
    return SEVERITIES.index(s) if s in SEVERITIES else 0


def alert_key(source: str, title: str, key: str | None = None) -> str:
    k = (key.strip() if isinstance(key, str) else "") or f"{source.strip()}:{title.strip()}"
    return k[:KEY_MAX]


def apply_alert(items: list[dict[str, Any]], inp: dict[str, Any], now: int) -> tuple[list[dict[str, Any]], dict[str, Any], str]:
    key = alert_key(inp["source"], inp["title"], inp.get("key"))
    severity = inp["severity"] if inp.get("severity") in SEVERITIES else "info"
    idx = next((i for i, a in enumerate(items) if a["key"] == key), -1)
    title = (inp.get("title") or "")[:TITLE_MAX]
    if idx < 0:
        alert = {"id": key, "key": key, "source": inp["source"], "severity": severity, "title": title,
                 "body": (inp.get("body") or "")[:BODY_MAX], "link": inp.get("link") or "", "meta": dict(inp.get("meta") or {}),
                 "firstAt": now, "lastAt": now, "count": 1, "ack": False, "resolved": False, "resolvedAt": None}
        event = "new"
        out = [*items, alert]
    else:
        old = items[idx]
        worse = rank(severity) > rank(old["severity"])
        event = "reopened" if old["resolved"] else "escalated" if worse else "repeat"
        alert = {
            **old,
            "severity": severity if (old["resolved"] or worse) else old["severity"],
            "title": title or old["title"],
            "body": (inp["body"] or "")[:BODY_MAX] if inp.get("body") is not None else old["body"],
            "link": inp["link"] if inp.get("link") is not None else old["link"],
            "meta": {**old["meta"], **(inp.get("meta") or {})},
            "firstAt": now if old["resolved"] else old["firstAt"],
            "lastAt": now,
            "count": 1 if old["resolved"] else old["count"] + 1,
            "ack": old["ack"] if event == "repeat" else False,
            "resolved": False,
            "resolvedAt": None,
        }
        out = [alert if i == idx else a for i, a in enumerate(items)]
    return trim_alerts(out), alert, event


def resolve_alerts(items: list[dict[str, Any]], keys: list[str], now: int) -> list[dict[str, Any]]:
    ks = set(keys)
    return [{**a, "resolved": True, "resolvedAt": now, "ack": True} if a["key"] in ks and not a["resolved"] else a for a in items]


def ack_alerts(items: list[dict[str, Any]], ids: list[str] | None) -> list[dict[str, Any]]:
    s = None if ids is None else set(ids)
    return [{**a, "ack": True} if not a["ack"] and (s is None or a["id"] in s) else a for a in items]


def dismiss_alerts(items: list[dict[str, Any]], ids: list[str]) -> list[dict[str, Any]]:
    s = set(ids)
    return [a for a in items if a["id"] not in s]


def unread_count(items: list[dict[str, Any]]) -> int:
    return sum(1 for a in items if not a["ack"] and not a["resolved"])


def sort_alerts(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # code-point order on ties, like the TS and Kotlin engines
    return sorted(items, key=lambda a: (1 if a["resolved"] else 0, -a["lastAt"], a["key"]))


def trim_alerts(items: list[dict[str, Any]], limit: int = LIMIT) -> list[dict[str, Any]]:
    if len(items) <= limit:
        return list(items)
    tier = lambda a: 0 if a["resolved"] else 1 if a["ack"] else 2  # noqa: E731
    drop = {a["key"] for a in sorted(items, key=lambda a: (tier(a), a["lastAt"], a["key"]))[: len(items) - limit]}
    return [a for a in items if a["key"] not in drop]


def channel_min(rules: dict[str, Any], channel: str, source: str) -> str:
    r = rules.get("channels", {}).get(channel)
    if not r:
        return "off"
    return (r.get("sources") or {}).get(source, r.get("min", "off"))


def delivery_targets(alert: dict[str, Any], event: str, rules: dict[str, Any] = DEFAULT_RULES) -> list[str]:
    out = []
    for channel in sorted(rules.get("channels", {})):
        m = channel_min(rules, channel, alert["source"])
        if m == "off" or rank(alert["severity"]) < rank(m):
            continue
        if event == "repeat" and channel != "bell":
            continue
        out.append(channel)
    return out


def ntfy_priority(severity: str) -> int:
    return {"info": 2, "success": 2, "warning": 3, "error": 4, "critical": 5}.get(severity, 3)


# ---------------------------------------------------------------- the hub

SOURCES: list[dict[str, str]] = [
    {"id": "ci", "label": "CI failures", "description": "GitHub Actions runs on the watched repos: a failing workflow raises an error, the next green run resolves it."},
    {"id": "deploys", "label": "Deploys", "description": "Workflows named or filed as deploy: finished (success, bell only) or failed (error)."},
    {"id": "system", "label": "Systems check", "description": "Every problem the console's systems check finds; resolved when it passes again."},
    {"id": "builds", "label": "Pending builds", "description": "An item on the pending build list goes to failed, broken or complete."},
    {"id": "plugins", "label": "Plugins", "description": "A plugin fails to load, or two plugins share an id."},
    {"id": "crashes", "label": "Crashes", "description": "Unhandled API errors, an unclean console restart, and errors in the page (from the browser)."},
    {"id": "conflicts", "label": "Conflicts", "description": "Two modules registering the same asset id, setting key or settings tab (from the browser)."},
]
SOURCE_IDS = {s["id"] for s in SOURCES}
SOURCE_RE = re.compile(r"^[a-z][a-z0-9._-]{0,39}$")
REPO_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$")


def _now() -> int:
    return int(time.time() * 1000)


def _target_ok(url: str) -> bool:
    """https anywhere; plain http only to this machine (a local ntfy, tests). (axf_server.http.target_ok)"""
    return axf_http.target_ok(url)


ALERT_FIELDS: dict[str, tuple[type, ...]] = {
    "id": (str,), "key": (str,), "source": (str,), "severity": (str,), "title": (str,), "body": (str,), "link": (str,), "meta": (dict,),
    "firstAt": (int,), "lastAt": (int,), "count": (int,), "ack": (bool,), "resolved": (bool,),
}


def _valid_alert(a: Any) -> bool:
    """A stored alert with every field the engine needs (a damaged alerts.json must not break every raise)."""
    if not isinstance(a, dict) or a.get("severity") not in SEVERITIES:
        return False
    if any(not isinstance(a.get(k), t) or (t == (int,) and isinstance(a.get(k), bool)) for k, t in ALERT_FIELDS.items()):
        return False
    return a.get("resolvedAt") is None or (isinstance(a["resolvedAt"], int) and not isinstance(a["resolvedAt"], bool))


def _read_json(p: Path, default: Any) -> Any:
    return storage.read_json(p, default)


def _write_private(p: Path, data: Any) -> None:
    """Atomic, 0600 (axf_server.storage). The data folder (.axf-console) keeps its mode when it exists."""
    storage.write_json(p, data, dir_mode=None if p.parent.is_dir() else storage.PRIVATE_DIR)


def _valid_rules(r: Any) -> dict[str, Any]:
    if not isinstance(r, dict) or not isinstance(r.get("channels"), dict):
        raise HTTPException(400, "rules need channels")
    out: dict[str, Any] = {"channels": {}}
    for ch, rule in r["channels"].items():
        if not isinstance(ch, str) or not re.match(r"^[a-z][a-z0-9-]{0,19}$", ch) or not isinstance(rule, dict):
            raise HTTPException(400, f"bad channel {ch!r}")
        mins = ["off", *SEVERITIES]
        m = rule.get("min", "off")
        if m not in mins:
            raise HTTPException(400, f"bad min {m!r}")
        srcs = rule.get("sources") or {}
        if not isinstance(srcs, dict) or any(not SOURCE_RE.match(str(k)) or v not in mins for k, v in srcs.items()):
            raise HTTPException(400, f"bad source overrides for {ch}")
        out["channels"][ch] = {"min": m, **({"sources": dict(srcs)} if srcs else {})}
    return out


class AlertHub:
    def __init__(self, data_dir: Path, *, log: Callable[[str, str, str], None] = lambda *_: None,
                 github_token: Callable[[], str] = lambda: os.environ.get("GITHUB_TOKEN", ""),
                 default_repos: list[str] | None = None,
                 systems: Callable[[], list[dict[str, Any]]] | None = None,
                 pending_file: Callable[[], Path | None] | None = None,
                 plugins: dict[str, dict[str, Any]] | None = None,
                 github_api: str | None = None) -> None:
        self.dir = data_dir
        self.f_alerts = data_dir / "alerts.json"
        self.f_config = data_dir / "alerts-config.json"
        self.f_secrets = data_dir / "alerts-secrets.json"
        self.f_push = data_dir / "alerts-push.json"
        self.f_vapid = data_dir / "alerts-vapid.pem"
        self.f_run = data_dir / "alerts-run.json"
        self.log = log
        self.github_token = github_token
        self.github_api = (github_api or os.environ.get("GITHUB_API_URL") or "https://api.github.com").rstrip("/")
        self.systems = systems
        self.pending_file = pending_file
        self.plugins = plugins if plugins is not None else {}
        self.default_repos = [r for r in (default_repos or []) if REPO_RE.match(r)]
        self.lock = threading.RLock()
        loaded = _read_json(self.f_alerts, [])
        self.items: list[dict[str, Any]] = trim_alerts([a for a in (loaded if isinstance(loaded, list) else []) if _valid_alert(a)])
        self.version = 0
        # bounded: if phones can't keep up, new deliveries are dropped (the bell still has every alert)
        self._outbox: queue.Queue[tuple[dict[str, Any], list[str]] | None] = queue.Queue(maxsize=100)
        self.f_seen = data_dir / "alerts-seen.json"
        self._crash_times: list[float] = []
        self._crash_last: dict[str, float] = {}
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []
        seen = _read_json(data_dir / "alerts-seen.json", None)
        # CI runs already looked at, kept across restarts so a dismissed failure doesn't push again after an update
        self._seen_runs: set[int] | None = {int(x) for x in seen if isinstance(x, int)} if isinstance(seen, list) else None
        self._pending_seen: dict[str, str] | None = None
        self.delivery_log: list[dict[str, Any]] = []

    # ---- config

    def config(self) -> dict[str, Any]:
        c = _read_json(self.f_config, {})
        rules = c.get("rules") if isinstance(c.get("rules"), dict) else DEFAULT_RULES
        return {
            "rules": rules,
            "ntfy": {"enabled": bool(c.get("ntfy", {}).get("enabled", False)), "server": c.get("ntfy", {}).get("server") or "https://ntfy.sh", "topic": c.get("ntfy", {}).get("topic") or "",
                     # off: phones get the title and a link only; details (tracebacks, CI output) stay in the bell
                     "details": bool(c.get("ntfy", {}).get("details", False))},
            "webpush": {"enabled": bool(c.get("webpush", {}).get("enabled", False))},
            "sources": {s: bool(c.get("sources", {}).get(s, True)) for s in SOURCE_IDS},
            "repos": [r for r in c.get("repos", self.default_repos) if isinstance(r, str) and REPO_RE.match(r)],
            "publicUrl": c.get("publicUrl") or os.environ.get("AXF_PUBLIC_URL", ""),
            "pollSeconds": max(60, min(int(c.get("pollSeconds", 180) or 180), 3600)),
        }

    def public_config(self) -> dict[str, Any]:
        c = self.config()
        return {
            "rules": c["rules"],
            "ntfy": {**c["ntfy"], "hasToken": bool(self._secrets().get("ntfyToken"))},
            "webpush": {"enabled": c["webpush"]["enabled"], "publicKey": self.vapid_public_key(), "available": _webpush_available(), "devices": len(self._subs())},
            "sources": [{**s, "enabled": c["sources"][s["id"]]} for s in SOURCES],
            "repos": c["repos"],
            "publicUrl": c["publicUrl"],
            "pollSeconds": c["pollSeconds"],
        }

    def set_config(self, patch: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            c = _read_json(self.f_config, {})
            if "rules" in patch and patch["rules"] is not None:
                c["rules"] = _valid_rules(patch["rules"])
            if isinstance(patch.get("ntfy"), dict):
                n = {**c.get("ntfy", {})}
                p = patch["ntfy"]
                if "enabled" in p and p["enabled"] is not None:
                    n["enabled"] = bool(p["enabled"])
                if p.get("server") is not None:
                    srv = str(p["server"]).strip().rstrip("/")
                    if srv and (not re.match(r"^https?://[A-Za-z0-9.\[\]:-]+(/[A-Za-z0-9._~/-]*)?$", srv) or not _target_ok(srv)):
                        raise HTTPException(400, "ntfy server must be an https:// URL (plain http only on this machine)")
                    n["server"] = srv or "https://ntfy.sh"
                if p.get("details") is not None:
                    n["details"] = bool(p["details"])
                if p.get("topic") is not None:
                    topic = str(p["topic"]).strip()
                    if topic and not re.match(r"^[A-Za-z0-9_-]{1,64}$", topic):
                        raise HTTPException(400, "ntfy topic: letters, digits, - and _ (up to 64)")
                    n["topic"] = topic
                c["ntfy"] = n
                if "token" in p:
                    s = self._secrets()
                    if p["token"]:
                        tok = str(p["token"]).strip()
                        if len(tok) > 200 or not re.match(r"^[A-Za-z0-9_.:-]+$", tok):
                            raise HTTPException(400, "that doesn't look like an ntfy token")
                        s["ntfyToken"] = tok
                    else:
                        s.pop("ntfyToken", None)
                    _write_private(self.f_secrets, s)
            if isinstance(patch.get("webpush"), dict) and patch["webpush"].get("enabled") is not None:
                c["webpush"] = {"enabled": bool(patch["webpush"]["enabled"])}
            if isinstance(patch.get("sources"), dict):
                src = {**c.get("sources", {})}
                for k, v in patch["sources"].items():
                    if k in SOURCE_IDS:
                        src[k] = bool(v)
                c["sources"] = src
            if isinstance(patch.get("repos"), list):
                bad = [r for r in patch["repos"] if not isinstance(r, str) or not REPO_RE.match(r)]
                if bad:
                    raise HTTPException(400, f"repos must look like owner/name: {bad[:3]}")
                c["repos"] = list(dict.fromkeys(patch["repos"]))[:30]
            if patch.get("publicUrl") is not None:
                u = str(patch["publicUrl"]).strip().rstrip("/")
                if u and not re.match(r"^https?://[A-Za-z0-9.-]+(:\d+)?$", u):
                    raise HTTPException(400, "public URL: scheme and host only, e.g. https://console.example.com")
                c["publicUrl"] = u
            _write_private(self.f_config, c)
        return self.public_config()

    def _secrets(self) -> dict[str, Any]:
        return _read_json(self.f_secrets, {})

    def source_on(self, source: str) -> bool:
        return self.config()["sources"].get(source, True)

    # ---- alerts

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {"alerts": sort_alerts(self.items), "unread": unread_count(self.items), "version": self.version}

    def _changed(self) -> None:
        self.version += 1
        _write_private(self.f_alerts, self.items)

    def raise_alert(self, inp: dict[str, Any], deliver: bool = True) -> tuple[dict[str, Any], str, list[str]]:
        if not self.source_on(inp["source"]):
            return {}, "off", []
        with self.lock:
            self.items, alert, event = apply_alert(self.items, inp, _now())
            self._changed()
            targets = delivery_targets(alert, event, self.config()["rules"])
        pushes = [t for t in targets if t != "bell"]
        if deliver and pushes:
            try:
                self._outbox.put_nowait((alert, pushes))
            except queue.Full:
                self.log("alerts", f"phone delivery queue full: {alert['key'][:60]} only in the bell", "warn")
        return alert, event, targets

    def resolve(self, keys: list[str]) -> None:
        with self.lock:
            before = self.items
            self.items = resolve_alerts(self.items, keys, _now())
            if self.items != before:
                self._changed()

    def ack(self, ids: list[str] | None) -> None:
        with self.lock:
            self.items = ack_alerts(self.items, ids)
            self._changed()

    def dismiss(self, ids: list[str]) -> None:
        with self.lock:
            self.items = dismiss_alerts(self.items, ids)
            self._changed()

    def open_keys(self, prefix: str) -> list[str]:
        with self.lock:
            return [a["key"] for a in self.items if a["key"].startswith(prefix) and not a["resolved"]]

    # ---- delivery

    def _deliver(self, alert: dict[str, Any], channels: list[str]) -> None:
        for ch in channels:
            try:
                ok, detail = (self.send_ntfy(alert) if ch == "ntfy" else self.send_webpush(alert) if ch == "webpush" else (False, "unknown channel"))
            except Exception as e:  # noqa: BLE001 — a dead channel must not stop the others
                ok, detail = False, str(e)[:200]
            self.delivery_log = (self.delivery_log + [{"at": _now(), "channel": ch, "key": alert["key"], "ok": ok, "detail": detail}])[-50:]
            if not ok:
                self.log("alerts", f"{ch}: {detail}", "warn")

    def _click_url(self, alert: dict[str, Any]) -> str:
        if re.match(r"^https?://", alert.get("link") or ""):
            return alert["link"]
        base = self.config()["publicUrl"]
        return f"{base}/" if base else ""

    def send_ntfy(self, alert: dict[str, Any]) -> tuple[bool, str]:
        c = self.config()["ntfy"]
        if not c["enabled"] or not c["topic"]:
            return False, "ntfy is off or has no topic"
        if not _target_ok(c["server"]):
            return False, "ntfy server must be https"
        message = (alert.get("body") or alert["title"])[:3000] if c.get("details") else f"{alert['severity']} · {alert['source']} — open the console for details"
        body: dict[str, Any] = {"topic": c["topic"], "title": alert["title"][:200], "message": message,
                                "priority": ntfy_priority(alert["severity"]), "tags": [alert["severity"], alert["source"]]}
        click = self._click_url(alert)
        if click:
            body["click"] = click
        headers = {"Content-Type": "application/json"}
        tok = self._secrets().get("ntfyToken")
        if tok:
            headers["Authorization"] = f"Bearer {tok}"
        try:  # validated in set_config; redirects are never followed (axf_server.http)
            r = axf_http.request("POST", c["server"].rstrip("/") + "/", headers=headers, body=json.dumps(body).encode(), timeout=10, max_bytes=65536)
        except axf_http.HttpError as e:
            return False, f"ntfy unreachable: {e}"
        if 200 <= r.status < 300:
            return True, f"sent to ntfy ({r.status})"
        return False, f"ntfy answered {r.status}"

    # web push

    def _subs(self) -> list[dict[str, Any]]:
        return [s for s in _read_json(self.f_push, []) if isinstance(s, dict) and isinstance(s.get("endpoint"), str)]

    def vapid_public_key(self) -> str | None:
        if not _webpush_available():
            return None
        try:
            from cryptography.hazmat.primitives import serialization
            from cryptography.hazmat.primitives.asymmetric import ec
        except ImportError:
            return None
        with self.lock:
            if not self.f_vapid.exists():
                key = ec.generate_private_key(ec.SECP256R1())
                pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
                storage.write_bytes(self.f_vapid, pem, dir_mode=None if self.dir.is_dir() else storage.PRIVATE_DIR)
            key = serialization.load_pem_private_key(self.f_vapid.read_bytes(), password=None)
        raw = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)  # type: ignore[union-attr]
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    def add_subscription(self, sub: dict[str, Any]) -> int:
        ep = sub.get("endpoint")
        keys = sub.get("keys") or {}
        if not isinstance(ep, str) or not re.match(r"^https://[A-Za-z0-9.-]+(:\d+)?/", ep) or len(ep) > 1000 or not isinstance(keys.get("p256dh"), str) or not isinstance(keys.get("auth"), str):
            raise HTTPException(400, "not a push subscription")
        with self.lock:
            subs = [s for s in self._subs() if s["endpoint"] != ep] + [{"endpoint": ep, "keys": {"p256dh": keys["p256dh"][:200], "auth": keys["auth"][:100]}, "added": _now()}]
            _write_private(self.f_push, subs[-20:])
            return len(subs[-20:])

    def remove_subscription(self, endpoint: str) -> int:
        with self.lock:
            subs = [s for s in self._subs() if s["endpoint"] != endpoint]
            _write_private(self.f_push, subs)
            return len(subs)

    def send_webpush(self, alert: dict[str, Any]) -> tuple[bool, str]:
        if not self.config()["webpush"]["enabled"]:
            return False, "web push is off"
        if not _webpush_available():
            return False, "the cryptography package isn't installed on the console server"
        subs = self._subs()
        if not subs:
            return False, "no device has turned on web push"
        self.vapid_public_key()  # makes the key on first use
        payload = _push_payload(alert, self._click_url(alert) or "/")
        urgency = "high" if alert["severity"] in ("error", "critical") else "normal"
        sent, gone, errors = 0, [], []
        for s in subs:
            try:
                code = webpush_send(s, payload, self.f_vapid, os.environ.get("AXF_VAPID_SUB", "mailto:alerts@amberxai.com"), urgency)
            except Exception as e:  # noqa: BLE001
                errors.append(str(e)[:80])
                continue
            if 200 <= code < 300:
                sent += 1
            elif code in (404, 410):
                gone.append(s["endpoint"])
            else:
                errors.append(f"push service answered {code}")
        for ep in gone:
            self.remove_subscription(ep)
        if sent:
            return True, f"sent to {sent} device(s)" + (f", {len(gone)} expired removed" if gone else "")
        return False, "; ".join(errors) or ("every device's subscription had expired" if gone else "nothing sent")

    def test(self, channel: str) -> tuple[bool, str]:
        alert = {"key": f"test:{channel}", "title": "Test alert from the AXF Dev Console", "body": "If you can read this, alerts reach this device.", "severity": "info", "source": "alerts", "link": ""}
        if channel == "ntfy":
            return self.send_ntfy(alert)
        if channel == "webpush":
            return self.send_webpush(alert)
        if channel == "bell":
            self.raise_alert({"source": "alerts", "severity": "info", "key": "test:bell", "title": "Test alert", "body": "Raised from Settings → Alerts."}, deliver=False)
            return True, "added to the bell"
        raise HTTPException(400, "channel is bell, ntfy or webpush")

    # ---- sources

    def _gh(self, path: str) -> Any:
        tok = self.github_token()
        if not tok:
            raise RuntimeError("no GitHub token")
        hdrs = {"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "axf-console-alerts"}
        # fixed API host; redirects not followed (they'd carry the token); https only (loopback http for tests)
        r = axf_http.request("GET", f"{self.github_api}{path}", headers=hdrs, timeout=15)
        if not r.ok:
            raise RuntimeError(f"GitHub answered {r.status}")
        return r.json()

    def poll_github(self) -> None:
        cfg = self.config()
        if not (cfg["sources"]["ci"] or cfg["sources"]["deploys"]) or not self.github_token():
            return
        first = self._seen_runs is None
        seen = self._seen_runs or set()
        for repo in cfg["repos"]:
            try:
                runs = self._gh(f"/repos/{repo}/actions/runs?per_page=30&status=completed").get("workflow_runs", [])
            except Exception as e:  # noqa: BLE001 — one repo failing doesn't stop the others
                self.log("alerts", f"GitHub {repo}: {str(e)[:120]}", "warn")
                continue
            latest: dict[tuple[str, str], dict[str, Any]] = {}
            for run in runs:  # newest first
                k = (str(run.get("path") or run.get("name") or ""), str(run.get("head_branch") or ""))
                latest.setdefault(k, run)
            for (wf, branch), run in latest.items():
                name = str(run.get("name") or wf.rsplit("/", 1)[-1])
                deploy = "deploy" in (wf + " " + name).lower()
                source = "deploys" if deploy else "ci"
                key = f"{source}:{repo}:{wf}:{branch}"
                rid = int(run.get("id") or 0)
                fresh = rid not in seen
                seen.add(rid)
                if run.get("conclusion") in ("failure", "timed_out", "startup_failure"):
                    # once per failing run: a dismissed alert stays gone until the next failing run
                    if fresh:
                        self.raise_alert({"source": source, "severity": "error", "key": key, "title": f"{name} failed on {branch} ({repo})",
                                          "body": f"{run.get('display_title') or ''}\nConclusion: {run.get('conclusion')}. Commit {str(run.get('head_sha') or '')[:7]}.".strip(),
                                          "link": run.get("html_url") or "", "meta": {"repo": repo, "workflow": name, "branch": branch, "run": rid}})
                elif run.get("conclusion") == "success":
                    self.resolve([key])
                    if deploy and fresh and not first:
                        self.raise_alert({"source": "deploys", "severity": "success", "key": f"deployed:{repo}:{wf}:{branch}", "title": f"{name} finished on {branch} ({repo})",
                                          "body": str(run.get("display_title") or ""), "link": run.get("html_url") or "", "meta": {"repo": repo, "run": rid}})
        self._seen_runs = set(sorted(seen)[-5000:])
        try:
            _write_private(self.f_seen, sorted(self._seen_runs))
        except OSError:
            pass

    def poll_systems(self) -> None:
        if not self.systems or not self.source_on("system"):
            return
        try:
            checks = self.systems()
        except Exception as e:  # noqa: BLE001
            self.log("alerts", f"systems check failed: {str(e)[:120]}", "warn")
            return
        good = []
        for c in checks:
            key = f"system:{c.get('id')}"
            st = c.get("status")
            if st in ("error", "warn"):
                self.raise_alert({"source": "system", "severity": "error" if st == "error" else "warning", "key": key, "title": f"{c.get('title')}: {c.get('summary') or st}"[:200],
                                  "body": "\n".join(str(d) for d in (c.get("details") or [])[:8]), "link": "settings:system", "meta": {"check": str(c.get("id"))}})
            elif st == "ok":
                good.append(key)
        self.resolve(good)

    def poll_pending(self) -> None:
        if not self.pending_file or not self.source_on("builds"):
            return
        f = self.pending_file()
        data = _read_json(f, None) if f else None
        if not isinstance(data, dict):
            return
        now = {str(i.get("id")): str(i.get("status")) for i in data.get("items", []) if isinstance(i, dict)}
        before, self._pending_seen = self._pending_seen, now
        if before is None:
            return  # first look: remember, don't alert on the existing list
        for iid, st in now.items():
            if before.get(iid) == st:
                continue
            title = next((str(i.get("title")) for i in data.get("items", []) if str(i.get("id")) == iid), iid)
            if st in ("failed", "broken"):
                self.raise_alert({"source": "builds", "severity": "error", "key": f"builds:{iid}", "title": f"Build {st}: {title}"[:200], "link": "view:pending", "meta": {"item": iid}})
            elif st == "complete":
                self.resolve([f"builds:{iid}"])
                self.raise_alert({"source": "builds", "severity": "success", "key": f"built:{iid}", "title": f"Built: {title}"[:200], "link": "view:pending", "meta": {"item": iid}})

    def poll_plugins(self) -> None:
        if not self.source_on("plugins"):
            return
        broken, ids = [], {}
        for folder, info in list(self.plugins.items()):
            key = f"plugins:{folder}"
            if info.get("error"):
                self.raise_alert({"source": "plugins", "severity": "error", "key": key, "title": f"Plugin {info.get('name') or folder} failed to load", "body": str(info["error"])[:1500], "link": "settings:plugins", "meta": {"folder": folder}})
                broken.append(key)
            pid = info.get("id")
            if pid:
                ids.setdefault(pid, []).append(folder)
        dups = {f"plugins:dup:{pid}" for pid, folders in ids.items() if len(folders) > 1}
        self.resolve([k for k in self.open_keys("plugins:") if k not in broken and k not in dups])
        for pid, folders in ids.items():
            if len(folders) > 1:
                self.raise_alert({"source": "conflicts", "severity": "warning", "key": f"plugins:dup:{pid}", "title": f"Plugins {', '.join(folders)} share the id {pid}", "body": "Each plugin needs its own id in plugin.json.", "link": "settings:plugins"})

    def crash(self, where: str, exc: BaseException) -> None:
        """At most one alert per crash key a minute and 20 crash alerts in 10 minutes, so nobody can flood phones."""
        now = time.time()
        key = f"crash:{where}:{type(exc).__name__}"
        with self.lock:
            self._crash_times = [t for t in self._crash_times if now - t < 600]
            if len(self._crash_times) >= 20 or now - self._crash_last.get(key, 0) < 60:
                return
            self._crash_times.append(now)
            self._crash_last[key] = now
            if len(self._crash_last) > 500:
                self._crash_last = dict(sorted(self._crash_last.items(), key=lambda kv: kv[1])[-250:])
        tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))[-1500:]
        try:
            self.raise_alert({"source": "crashes", "severity": "error", "key": f"crash:{where}:{type(exc).__name__}", "title": f"Crash in {where}: {type(exc).__name__}", "body": f"{exc}\n{tb}"[:2000], "meta": {"where": where}})
        except Exception:  # noqa: BLE001 — reporting a crash must never crash
            pass

    def poll_all(self) -> None:
        for fn in (self.poll_plugins, self.poll_pending, self.poll_systems, self.poll_github):
            try:
                fn()
            except Exception as e:  # noqa: BLE001
                self.crash(f"alerts.{fn.__name__}", e)

    # ---- lifecycle

    def start(self) -> None:
        prev = _read_json(self.f_run, None)
        if isinstance(prev, dict) and prev.get("clean") is False and self.source_on("crashes"):
            self.raise_alert({"source": "crashes", "severity": "warning", "key": "crash:restart", "title": "The console restarted without shutting down cleanly",
                              "body": f"Previous start {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(prev.get('startedAt', 0) / 1000))} UTC. Out of memory, a killed container or a host reboot can cause this."})
        _write_private(self.f_run, {"startedAt": _now(), "pid": os.getpid(), "clean": False})
        self._stop.clear()
        for target, name in ((self._worker, "alerts-delivery"), (self._poller, "alerts-sources")):
            t = threading.Thread(target=target, name=name, daemon=True)
            t.start()
            self._threads.append(t)

    def stop(self) -> None:
        self._stop.set()
        self._outbox.put(None)
        run = _read_json(self.f_run, {})
        if isinstance(run, dict) and run.get("pid") == os.getpid():
            _write_private(self.f_run, {**run, "clean": True, "stoppedAt": _now()})

    def _worker(self) -> None:
        while not self._stop.is_set():
            item = self._outbox.get()
            if item is None:
                break
            self._deliver(*item)

    def _poller(self) -> None:
        if self._stop.wait(5):  # let the API come up first
            return
        while not self._stop.is_set():
            self.poll_all()
            if self._stop.wait(self.config()["pollSeconds"]):
                break


def _webpush_available() -> bool:
    try:
        import cryptography  # noqa: F401
        return True
    except ImportError:
        return False


# ---------------------------------------------------------------- web push (RFC 8291 aes128gcm + RFC 8292 VAPID)

def _b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def webpush_encrypt(payload: bytes, p256dh: str, auth: str, *, salt: bytes | None = None, server_key: Any = None) -> bytes:
    """Encrypt a push message for one subscription (RFC 8291, content coding aes128gcm, one record)."""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF

    ua_pub_raw = _unb64u(p256dh)
    auth_secret = _unb64u(auth)
    if len(ua_pub_raw) != 65 or len(auth_secret) < 16:
        raise ValueError("bad subscription keys")
    ua_pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_pub_raw)
    as_priv = server_key or ec.generate_private_key(ec.SECP256R1())
    as_pub_raw = as_priv.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    shared = as_priv.exchange(ec.ECDH(), ua_pub)
    ikm = HKDF(hashes.SHA256(), 32, auth_secret, b"WebPush: info\x00" + ua_pub_raw + as_pub_raw).derive(shared)
    salt = salt or os.urandom(16)
    cek = HKDF(hashes.SHA256(), 16, salt, b"Content-Encoding: aes128gcm\x00").derive(ikm)
    nonce = HKDF(hashes.SHA256(), 12, salt, b"Content-Encoding: nonce\x00").derive(ikm)
    cipher = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)  # 0x02 = last (only) record
    return salt + (4096).to_bytes(4, "big") + bytes([len(as_pub_raw)]) + as_pub_raw + cipher


def vapid_header(endpoint: str, key_file: Path, sub: str, ttl: int = 12 * 3600) -> str:
    """`Authorization: vapid t=<ES256 JWT>, k=<public key>` for the endpoint's push service (RFC 8292)."""
    from urllib.parse import urlsplit

    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

    key = serialization.load_pem_private_key(key_file.read_bytes(), password=None)
    u = urlsplit(endpoint)
    head = _b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    claims = _b64u(json.dumps({"aud": f"{u.scheme}://{u.netloc}", "exp": int(time.time()) + ttl, "sub": sub}, separators=(",", ":")).encode())
    r, s = decode_dss_signature(key.sign(f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256())))  # type: ignore[union-attr,call-arg]
    jwt = f"{head}.{claims}.{_b64u(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"
    pub = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)  # type: ignore[union-attr]
    return f"vapid t={jwt}, k={_b64u(pub)}"


PUSH_MAX = 3000  # payload bytes before encryption (push services take 4096 minus the record overhead)


def _push_payload(alert: dict[str, Any], url: str) -> bytes:
    """UTF-8 JSON (not \\u-escaped) that always fits a push message: the body is shortened first, then the title."""
    def enc(title: str, body: str) -> bytes:
        return json.dumps({"title": title, "body": body, "url": url[:300], "tag": alert["key"][:120], "severity": alert["severity"]}, ensure_ascii=False).encode()
    title, body = alert["title"][:120], (alert.get("body") or "")[:400]
    out = enc(title, body)
    while len(out) > PUSH_MAX and body:
        body = body[: len(body) // 2]
        out = enc(title, body)
    while len(out) > PUSH_MAX and len(title) > 10:
        title = title[: len(title) // 2]
        out = enc(title, body)
    return out


def webpush_send(sub: dict[str, Any], payload: bytes, key_file: Path, vapid_sub: str, urgency: str = "normal") -> int:
    """POST one encrypted message to the subscription's push service; returns the HTTP status."""
    body = webpush_encrypt(payload, sub["keys"]["p256dh"], sub["keys"]["auth"])
    headers = {"Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", "TTL": "86400", "Urgency": urgency,
               "Authorization": vapid_header(sub["endpoint"], key_file, vapid_sub)}
    # https endpoint (checked when subscribed); no redirects (axf_server.http)
    return axf_http.request("POST", sub["endpoint"], headers=headers, body=body, timeout=10, max_bytes=65536).status


# ---------------------------------------------------------------- API

class RaiseReq(BaseModel):
    source: str = Field(pattern=SOURCE_RE.pattern)
    severity: str = Field(pattern="^(info|success|warning|error|critical)$")
    title: str = Field(min_length=1, max_length=TITLE_MAX)
    body: str | None = Field(default=None, max_length=BODY_MAX)
    key: str | None = Field(default=None, max_length=KEY_MAX)
    link: str | None = Field(default=None, max_length=500)
    meta: dict[str, str | int | float | bool] | None = None


class IdsReq(BaseModel):
    ids: list[str] | None = Field(default=None, max_length=1000)
    all: bool = False


class KeysReq(BaseModel):
    keys: list[str] = Field(max_length=1000)


class ChannelReq(BaseModel):
    channel: str = Field(pattern="^(bell|ntfy|webpush)$")


class SubReq(BaseModel):
    subscription: dict[str, Any]


class EndpointReq(BaseModel):
    endpoint: str = Field(max_length=1000)


def router_for(hub: AlertHub, auth: Callable[..., None]) -> APIRouter:
    from fastapi import Depends

    r = APIRouter(prefix="/api/alerts", dependencies=[Depends(auth)])

    @r.get("")
    def list_alerts() -> dict[str, Any]:
        return hub.snapshot()

    @r.post("")
    def raise_alert(req: RaiseReq) -> dict[str, Any]:
        if req.link and not re.match(r"^(https?://|view:|settings:)", req.link):
            raise HTTPException(400, "link must be http(s)://, view:<id> or settings:<tab>")
        if req.meta and len(json.dumps(req.meta)) > 2000:
            raise HTTPException(400, "meta too large")
        alert, event, targets = hub.raise_alert(req.model_dump(exclude_none=True))
        return {"ok": True, "event": event, "targets": targets, "alert": alert or None}

    @r.post("/ack")
    def ack(req: IdsReq) -> dict[str, Any]:
        hub.ack(None if req.all else (req.ids or []))
        return hub.snapshot()

    @r.post("/resolve")
    def resolve(req: KeysReq) -> dict[str, Any]:
        hub.resolve(req.keys)
        return hub.snapshot()

    @r.post("/dismiss")
    def dismiss(req: IdsReq) -> dict[str, Any]:
        hub.dismiss(req.ids or [])
        return hub.snapshot()

    @r.get("/stream")
    async def stream(request: Request) -> StreamingResponse:
        import asyncio

        async def gen():  # type: ignore[no-untyped-def]
            last = -1
            idle = 0.0
            while not await request.is_disconnected():
                if hub.version != last:
                    snap = hub.snapshot()
                    last = snap["version"]
                    idle = 0.0
                    yield f"data: {json.dumps(snap)}\n\n"
                elif idle >= 20:
                    idle = 0.0
                    yield ": keep-alive\n\n"
                await asyncio.sleep(1)
                idle += 1

        return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    @r.get("/config")
    def get_config() -> dict[str, Any]:
        return hub.public_config()

    @r.post("/config")
    def set_config(patch: dict[str, Any]) -> dict[str, Any]:
        return hub.set_config(patch)

    @r.post("/test")
    def test(req: ChannelReq) -> dict[str, Any]:
        ok, detail = hub.test(req.channel)
        return {"ok": ok, "detail": detail}

    @r.post("/webpush/subscribe")
    def subscribe(req: SubReq) -> dict[str, Any]:
        return {"ok": True, "devices": hub.add_subscription(req.subscription)}

    @r.post("/webpush/unsubscribe")
    def unsubscribe(req: EndpointReq) -> dict[str, Any]:
        return {"ok": True, "devices": hub.remove_subscription(req.endpoint)}

    @r.post("/webpush/test")
    def webpush_test() -> dict[str, Any]:
        ok, detail = hub.test("webpush")
        return {"ok": ok, "detail": detail}

    @r.post("/poll")
    def poll() -> dict[str, Any]:
        """Run every source now (otherwise they run every few minutes)."""
        hub.poll_all()
        return hub.snapshot()

    @r.get("/deliveries")
    def deliveries() -> dict[str, Any]:
        return {"items": hub.delivery_log[-50:]}

    return r
