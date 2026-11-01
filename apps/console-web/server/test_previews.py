"""Watch live (watch-live@1) console side: registry, signed keys, routing, and the /preview proxy's auth (HTTP + WebSocket).

    python apps/console-web/server/test_previews.py
"""
from __future__ import annotations

import http.server
import json
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import previews  # noqa: E402

checks = 0


def ok(v: object, what: str) -> None:
    global checks
    assert v, what
    checks += 1


def eq(a: object, b: object, what: str) -> None:
    global checks
    assert a == b, f"{what}: {a!r} != {b!r}"
    checks += 1


class Echo(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        body = json.dumps({"path": self.path, "host": self.headers.get("host"), "cookie": self.headers.get("cookie"),
                           "auth": self.headers.get("authorization")}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("set-cookie", "leak=1")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a: object) -> None:
        pass


def serve() -> int:
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Echo)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1]


def main() -> None:
    tmp = Path(tempfile.mkdtemp())
    reg = tmp / ".axf-console" / "previews"
    reg.mkdir(parents=True)
    now = time.time() * 1000

    # ---- pure parts
    (reg / "axf-old.json").write_text(json.dumps({"contract": previews.CONTRACT, "session": "axf-old", "updatedAt": now - previews.STALE_MS - 1, "apps": {}}))
    (reg / "broken.json").write_text("{")
    (reg / "evil.json").write_text(json.dumps({"contract": previews.CONTRACT, "session": "../x", "updatedAt": now, "apps": {}}))
    eq(previews.list_entries(reg), [], "stale, broken and badly named entries are skipped")
    key = previews.sign("tok", "axf-s", "demo", now=1000)
    ok(previews.key_ok("tok", "axf-s", "demo", key, now=1000), "key checks")
    ok(not previews.key_ok("tok", "axf-s", "console-web", key, now=1000), "a key is for one app only")
    ok(not previews.key_ok("tok", "axf-t", "demo", key, now=1000), "and one session only")
    ok(not previews.key_ok("other", "axf-s", "demo", key, now=1000), "and one console token")
    ok(not previews.key_ok("tok", "axf-s", "demo", key, now=1000 + previews.KEY_TTL + 1), "keys expire")
    ok(not previews.key_ok("tok", "axf-s", "demo", key[:-1] + ("0" if key[-1] != "0" else "1"), now=1000), "tampered key refused")
    ok(not previews.key_ok("", "axf-s", "demo", key), "no token, no key")
    eq(previews.strip_key("a=1&axfKey=x&axfFocus=.b"), "a=1&axfFocus=.b", "the key never reaches the preview")
    e = {"session": "axf-s", "host": "127.0.0.1"}
    eq(previews.upstream(e, {"app": "demo", "status": "ready", "port": 5, "assetsPort": 6}, "/preview/axf-s/demo/src/main.tsx"), ("127.0.0.1", 5, "/preview/axf-s/demo/src/main.tsx"), "app path → vite with the full path")
    eq(previews.upstream(e, {"app": "demo", "status": "ready", "port": 5, "assetsPort": 6}, "/preview/axf-s/demo/__axf/assets/events"), ("127.0.0.1", 6, "/events"), "assets path → axf dev")
    eq(previews.upstream(e, {"app": "demo", "status": "starting", "port": 5}, "/preview/axf-s/demo/"), None, "not ready → nothing")
    eq(previews.upstream({**e, "host": "a b"}, {"app": "demo", "status": "ready", "port": 5}, "/preview/axf-s/demo/"), None, "odd host refused")
    eq(previews.focus_for({"focus": {"app": "demo", "selector": ".x"}}, "console-web"), None, "focus for another app is not shown")
    eq(previews.focus_for({"focus": {"selector": ".x", "note": "n"}}, "demo"), {"selector": ".x", "note": "n"}, "focus without an app applies")

    # ---- the proxy, behind auth
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    port = serve()
    (reg / "axf-s.json").write_text(json.dumps({
        "contract": previews.CONTRACT, "session": "axf-s", "host": "127.0.0.1", "branch": "claude/x", "change": "chg-1", "updatedAt": now,
        "focus": {"app": "demo", "route": "#/home", "selector": ".fx-toolbar", "note": "toolbar"},
        "apps": {"demo": {"status": "ready", "port": port, "label": "Demo"}, "console": {"status": "ready", "port": port, "assetsPort": port, "android": True},
                 "axhub-web": {"status": "failed", "why": "npm install failed"}},
    }))
    token = "secret-token"
    app = FastAPI()
    previews.mount(app, tmp, lambda: token, lambda conn, s, a: conn.headers.get("authorization") == f"Bearer {token}")
    c = TestClient(app)
    hdr = {"authorization": f"Bearer {token}"}

    eq(c.get("/api/previews").status_code, 401, "list needs auth")
    items = c.get("/api/previews", headers=hdr).json()["items"]
    by = {i["app"]: i for i in items}
    eq(sorted(by), ["axhub-web", "console", "demo"], "every app of the session")
    ok(by["demo"]["url"].startswith("/preview/axf-s/demo/?axfKey=") and by["demo"]["url"].endswith("#/home"), "proxied url: key in the query, hash route last")
    ok("axfKey=" in by["demo"]["url"], "url carries a signed key (iframes can't send the token)")
    eq(by["demo"]["focus"]["selector"], ".fx-toolbar", "focus passed on")
    eq(by["axhub-web"]["url"], "", "failed preview has no url")
    eq(by["axhub-web"]["why"], "npm install failed", "and says why")
    ok(by["console"]["android"] and "next APK" in by["console"]["note"], "android preview carries the next-APK note")
    eq([by["demo"]["branch"], by["demo"]["change"]], ["claude/x", "chg-1"], "match fields")

    eq(c.get("/preview/axf-s/demo/").status_code, 401, "no auth, no preview")
    eq(c.get("/preview/axf-s/demo/?axfKey=1.abc").status_code, 401, "a forged key is refused")
    r = c.get("/preview/axf-s/demo/src/x.ts?a=1", headers=hdr)
    eq(r.status_code, 200, "token works")
    j = r.json()
    eq(j["path"], "/preview/axf-s/demo/src/x.ts?a=1", "full path forwarded")
    eq([j["cookie"], j["auth"]], [None, None], "console cookies and token never reach the preview")
    eq(j["host"], f"localhost:{port}", "host rewritten for the dev server")
    ok("leak" not in r.headers.get("set-cookie", ""), "the preview can't set cookies on the console")

    url = by["demo"]["url"].split("#")[0]
    k = url.split("axfKey=")[1]
    r = c.get(f"/preview/axf-s/demo/?axfKey={k}")
    eq(r.status_code, 200, "the signed key works")
    eq(r.json()["path"], "/preview/axf-s/demo/", "the key is stripped before forwarding")
    sc = r.headers.get("set-cookie", "")
    ok(f"{previews.COOKIE}=" in sc and "Path=/preview/axf-s/demo/" in sc and "HttpOnly" in sc, "a cookie scoped to this one preview")
    eq(c.get("/preview/axf-s/demo/src/main.tsx").status_code, 200, "then the page's own requests ride the cookie")
    c.cookies.clear()
    eq(c.get(f"/preview/axf-s/console/?axfKey={k}").status_code, 401, "the demo key doesn't open another app")
    eq(c.get("/preview/axf-s/console/__axf/assets/events?since=0", headers=hdr).json()["path"], "/events?since=0", "assets requests go to axf dev")
    eq(c.get("/preview/axf-nope/demo/", headers=hdr).status_code, 404, "unknown session")
    eq(c.get("/preview/axf-s/axhub-web/", headers=hdr).status_code, 503, "failed preview: 503 with why")
    eq(c.get("/preview/axf-s/demo", headers=hdr, follow_redirects=False).status_code, 307, "no trailing slash → redirect")

    # ---- WebSocket (Vite's HMR channel) through the proxy
    try:
        from websockets.sync.server import serve as ws_serve
    except ImportError:
        ws_serve = None
    if ws_serve:
        def echo(conn: object) -> None:
            for m in conn:  # type: ignore[attr-defined]
                conn.send(f"echo:{m}")  # type: ignore[attr-defined]

        wss = ws_serve(echo, "127.0.0.1", 0, subprotocols=["vite-hmr"])
        threading.Thread(target=wss.serve_forever, daemon=True).start()
        wport = wss.socket.getsockname()[1]
        data = json.loads((reg / "axf-s.json").read_text())
        data["apps"]["demo"]["port"] = wport
        data["updatedAt"] = time.time() * 1000
        (reg / "axf-s.json").write_text(json.dumps(data))
        from starlette.websockets import WebSocketDisconnect
        try:
            with c.websocket_connect("/preview/axf-s/demo/"):
                ok(False, "a websocket without auth must be refused")
        except WebSocketDisconnect:
            ok(True, "websocket refused without auth")
        with c.websocket_connect(f"/preview/axf-s/demo/?axfKey={k}", subprotocols=["vite-hmr"]) as ws:
            ws.send_text("ping")
            eq(ws.receive_text(), "echo:ping", "HMR websocket proxied both ways")
        wss.shutdown()

    print(f"✓ previews (watch-live@1) — {checks} checks")


if __name__ == "__main__":
    main()
