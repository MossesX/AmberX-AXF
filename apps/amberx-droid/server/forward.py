"""Forwarding the AmberX web app's old addresses to the console (build move-amberx-web-app-into-the-console-amberx-andr,
s11; contract docs/contracts/amberx-console-api.md section 5).

Every address this server answers is in TABLE with where it lives on the console and how it is handled now:

  proxy     the request goes to the console route as it is (the console token signs it) and the answer comes back
  relayed   the handler here already calls the console for it (Molly, the walkthrough re-voice)
  redirect  a page: with AMBERX_FORWARD_PAGES=redirect the browser is sent to the console page (302)
  local     answered here: the console has no route of the same shape yet, or only the person's own browser may call it
            (the approvals decide); `why` says which

Every request that matches is written to the request log (`$AMBERX_DATA_DIR/forward-log.jsonl`, one line per request:
time, method, path, route id, mode, status, user agent; rotated at 5 MB) so `GET /api/forward/log` (admins) and
`python forward.py summary` show what still hits the old addresses and from where. AMBERX_FORWARD=off turns the log off.

Nothing here changes what the current phone app gets: proxy entries keep the same answers, pages are only redirected
when AMBERX_FORWARD_PAGES=redirect, and every local entry is answered as before.
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

LOG_NAME = "forward-log.jsonl"
LOG_MAX = 5 * 1024 * 1024
RECENT = 100


@dataclass(frozen=True)
class Route:
    id: str
    methods: tuple[str, ...]
    pattern: str
    console: str  # the console address it maps to ('' = none yet)
    mode: str     # proxy | relayed | redirect | local
    why: str = ""

    def match(self, method: str, path: str) -> dict[str, str] | None:
        if self.methods and method.upper() not in self.methods:
            return None
        m = re.fullmatch(self.pattern, path)
        return m.groupdict() if m else None

    def target(self, params: dict[str, str]) -> str:
        return self.console.format(**params) if self.console else ""


ANY = ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD")
TABLE: tuple[Route, ...] = (
    Route("health", ("GET",), r"/api/health", "/api/health", "local", "answers about this server; the console's own health says app: console"),
    Route("me", ("GET",), r"/api/me", "/api/me", "local", "who is signed in here; the console's /api/me has the same fields plus amberx.api"),
    Route("ai.status", ("GET",), r"/api/ai/status", "/api/plugins/amberx-ai/status", "local", "the amberx-ai console plugin is not built yet"),
    Route("ai.parse", ("POST",), r"/api/ai/parse", "/api/plugins/amberx-ai/parse", "local", "the amberx-ai console plugin is not built yet"),
    Route("ai.summarize", ("POST",), r"/api/ai/summarize", "/api/plugins/amberx-ai/summarize", "local", "the amberx-ai console plugin is not built yet"),
    Route("ai.ask", ("POST",), r"/api/ai/ask", "/api/plugins/amberx-ai/ask", "local", "the amberx-ai console plugin is not built yet"),
    Route("ai.prompt", ("POST",), r"/api/ai/prompt", "/api/plugins/amberx-ai/prompt", "local", "the amberx-ai console plugin is not built yet"),
    Route("ai.molly.status", ("GET",), r"/api/ai/molly/status", "/api/plugins/molly-guide/walkthroughs", "relayed"),
    Route("ai.molly", ("POST",), r"/api/ai/molly", "/api/plugins/molly-guide/ask", "relayed"),
    Route("ai.config", ("GET", "PUT"), r"/api/ai/config", "/api/plugins/amberx-ai/config", "local", "the amberx-ai console plugin is not built yet"),
    Route("ai.keys", ("POST",), r"/api/ai/keys/(?P<pid>[^/]+)", "/api/plugins/amberx-ai/keys/{pid}", "local", "the amberx-ai console plugin is not built yet"),
    Route("ai.profiles", ("POST",), r"/api/ai/profiles", "/api/plugins/amberx-ai/profiles", "local", "the amberx-ai console plugin is not built yet"),
    Route("ai.primary", ("POST",), r"/api/ai/primary/(?P<pid>[^/]+)", "/api/plugins/amberx-ai/primary/{pid}", "local", "the amberx-ai console plugin is not built yet"),
    Route("ai.test", ("POST",), r"/api/ai/test/(?P<pid>[^/]+)", "/api/plugins/amberx-ai/test/{pid}", "local", "the amberx-ai console plugin is not built yet"),
    Route("walkthrough.render", ("POST",), r"/api/walkthrough/(?P<wid>[^/]+)/render", "/api/plugins/molly-guide/amberx-walkthrough/rerecord", "relayed"),
    Route("walkthrough.chapters", ("GET", "HEAD"), r"/api/walkthrough/(?P<wid>[^/]+)/chapters/(?P<name>[^/]+)", "/api/plugins/molly-guide/amberx-walkthrough/{wid}/chapters/{name}", "local", "the console has no walkthrough media route yet"),
    Route("walkthrough.file", ("GET", "HEAD"), r"/api/walkthrough/(?P<wid>[^/]+)/(?P<name>[^/]+)", "/api/plugins/molly-guide/amberx-walkthrough/{wid}/{name}", "local", "the console has no walkthrough media route yet"),
    Route("walkthrough.top", ("GET", "HEAD"), r"/api/walkthrough/(?P<name>[^/]+)", "/api/plugins/molly-guide/amberx-walkthrough/amberx-app/{name}", "local", "the console has no walkthrough media route yet"),
    Route("approvals.relay", ("GET",), r"/api/approvals/relay", "/api/plugins/approvals-banner/relay", "local", "it answers for the calling browser's own hub session, which only reaches this server"),
    Route("approvals.decide", ("POST",), r"/api/approvals/decide", "/api/plugins/approvals-banner/decide", "local", "a person's tap: the console refuses a forwarded (token) decision by design"),
    Route("console.plugins", ANY, r"/api/console/plugins/(?P<folder>[a-z0-9-]+)/(?P<rest>.*)", "/api/plugins/{folder}/{rest}", "proxy"),
    Route("forward.log", ("GET",), r"/api/forward/log", "", "local", "this log"),
    Route("api.other", ANY, r"/api(/.*)?", "", "local", "not an AmberX route"),
    Route("page", ("GET", "HEAD"), r"/(?!api(/|$)).*", "/", "redirect"),
)


def route_of(method: str, path: str) -> tuple[Route, dict[str, str]] | None:
    for r in TABLE:
        p = r.match(method, path)
        if p is not None:
            return r, p
    return None


def page_target(console_url: str, path: str, query: str) -> str:
    """Where a page of the old site goes on the console (the console is one page: every old page opens its home)."""
    return console_url.rstrip("/") + "/" + (f"?{query}" if query else "")


class Log:
    """The request log: one JSON line per request that hit an old address, plus counters for the summary."""

    def __init__(self, data_dir: Path) -> None:
        self.file = data_dir / LOG_NAME
        self.lock = threading.Lock()

    def on(self) -> bool:
        return (os.environ.get("AMBERX_FORWARD") or "log").lower() != "off"

    def write(self, rec: dict[str, Any]) -> None:
        if not self.on():
            return
        line = json.dumps(rec, separators=(",", ":")) + "\n"
        with self.lock:
            try:
                self.file.parent.mkdir(parents=True, exist_ok=True)
                if self.file.exists() and self.file.stat().st_size > LOG_MAX:
                    os.replace(self.file, self.file.with_suffix(".jsonl.1"))
                with self.file.open("a") as f:
                    f.write(line)
            except OSError:
                pass  # a log that can't be written never stops a request

    def rows(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for p in (self.file.with_suffix(".jsonl.1"), self.file):
            try:
                lines = p.read_text().splitlines()
            except OSError:
                continue
            for ln in lines:
                try:
                    r = json.loads(ln)
                except ValueError:
                    continue
                if isinstance(r, dict):
                    out.append(r)
        return out


def summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Per route: how many requests, the last one, the clients (user agents) and the console address it maps to."""
    by: dict[str, dict[str, Any]] = {}
    for r in rows:
        rid = str(r.get("route") or "?")
        s = by.setdefault(rid, {"route": rid, "count": 0, "lastAt": "", "lastPath": "", "mode": r.get("mode"), "console": r.get("console") or "", "clients": {}})
        s["count"] += 1
        if str(r.get("at") or "") >= s["lastAt"]:
            s["lastAt"], s["lastPath"], s["mode"] = str(r.get("at") or ""), str(r.get("path") or ""), r.get("mode")
        ua = client_of(str(r.get("ua") or ""))
        s["clients"][ua] = s["clients"].get(ua, 0) + 1
    routes = sorted(by.values(), key=lambda s: s["lastAt"], reverse=True)
    still = [s["route"] for s in routes if s["mode"] == "local" and s["route"] not in ("forward.log", "api.other")]
    return {"routes": routes, "total": len(rows), "stillLocal": still}


def client_of(ua: str) -> str:
    """A short client name from a user agent: the phone's native side, the AmberX app's page, a browser, a script."""
    if ua.startswith("Dalvik/") or "okhttp" in ua.lower():
        return "phone (native)"
    if "wv)" in ua or "AmberX" in ua:
        return "phone (AmberX page)"
    if "Mozilla/" in ua:
        return "browser"
    return ua.split("/")[0][:30] or "unknown"


def record(method: str, path: str, status: int, ua: str, found: tuple[Route, dict[str, str]] | None) -> dict[str, Any]:
    r, p = found if found else (None, {})
    return {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "method": method, "path": path[:300], "route": r.id if r else "?",
            "mode": r.mode if r else "local", "console": r.target(p) if r else "", "status": status, "ua": ua[:160]}


if __name__ == "__main__":  # python forward.py summary [log file] | table
    if len(sys.argv) > 1 and sys.argv[1] == "table":
        for r in TABLE:
            print(f"{r.id:22} {','.join(r.methods) or '*':14} {r.mode:9} {r.console or '-':60} {r.why}")
        sys.exit(0)
    f = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(os.environ.get("AMBERX_DATA_DIR") or Path(__file__).resolve().parent.parent / "data") / LOG_NAME
    s = summary(Log(f.parent).rows() if f.name == LOG_NAME else [])
    for r in s["routes"]:
        print(f"{r['route']:22} {r['count']:6}  last {r['lastAt']}  {r['mode']:8} → {r['console'] or '-'}  {', '.join(f'{k} {v}' for k, v in r['clients'].items())}")
    print(f"{s['total']} requests; still answered here: {', '.join(s['stillLocal']) or 'none'}")
