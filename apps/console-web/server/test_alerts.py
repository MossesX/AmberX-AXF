"""Self-test for the console's alert server (CI: python apps/console-web/server/test_alerts.py).

1. The Python engine reproduces framework/spec/fixtures/alerts.json (made from core/engines/alerts.ts).
2. The hub: sources (fake GitHub API, systems check, pending list, plugins, crashes), ntfy delivery to a fake ntfy
   server, config validation, secrets kept out of the API, unclean-restart detection, and the HTTP routes with the
   console token. Everything runs in a temp folder; nothing real is contacted.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import alerts as A  # noqa: E402
from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

FIX = json.loads((HERE.parents[2] / "framework" / "spec" / "fixtures" / "alerts.json").read_text())


def check_fixture() -> None:
    assert A.SEVERITIES == FIX["severities"]
    assert [A.alert_key("ci", "Failed"), A.alert_key(" ci ", " Failed ", "  "), A.alert_key("x", "y", "k1")] == FIX["keys"]
    assert {s: A.ntfy_priority(s) for s in A.SEVERITIES} == FIX["ntfyPriority"]
    items: list[dict] = []
    for i, st in enumerate(FIX["steps"]):
        exp = FIX["events"][i]
        if st["op"] == "raise":
            items, alert, event = A.apply_alert(items, st["input"], st["at"])
            got = {"op": "raise", "key": alert["key"], "event": event, "severity": alert["severity"], "count": alert["count"], "ack": alert["ack"],
                   "targets": A.delivery_targets(alert, event, FIX["rules"]), "defaultTargets": A.delivery_targets(alert, event), "unread": A.unread_count(items)}
            assert got == exp, (i, got, exp)
        elif st["op"] == "resolve":
            items = A.resolve_alerts(items, st["keys"], st["at"])
            assert A.unread_count(items) == exp["unread"], i
        else:
            items = A.ack_alerts(items, None if st["ids"] == "all" else st["ids"])
            assert A.unread_count(items) == exp["unread"], i
    assert A.sort_alerts(items) == FIX["final"], json.dumps(A.sort_alerts(items), indent=1)
    t: list[dict] = []
    for i in range(6):
        t, _, _ = A.apply_alert(t, {"source": "s", "severity": "info", "title": f"a{i}"}, 100 + i)
    t = A.ack_alerts(A.resolve_alerts(t, ["s:a3"], 200), ["s:a1"])
    assert [a["key"] for a in A.trim_alerts(t, 4)] == FIX["trim"]["kept"]
    print("engine matches the fixture")


class Fake(BaseHTTPRequestHandler):
    """ntfy (POST /) and GitHub (GET /repos/...) in one tiny server."""
    posts: list[dict] = []
    runs: list[dict] = []

    def log_message(self, *a):  # noqa: D401
        pass

    def do_POST(self):  # noqa: N802
        n = int(self.headers.get("content-length") or 0)
        Fake.posts.append({"path": self.path, "auth": self.headers.get("authorization"), "body": json.loads(self.rfile.read(n) or b"{}")})
        self.send_response(200); self.end_headers(); self.wfile.write(b"{}")

    def do_GET(self):  # noqa: N802
        if self.headers.get("authorization") != "Bearer gh-test":
            self.send_response(401); self.end_headers(); return
        body = json.dumps({"workflow_runs": Fake.runs}).encode()
        self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(body)


def run(no, conclusion, path=".github/workflows/android.yml", name="Android CI", branch="main"):
    return {"id": no, "name": name, "path": path, "head_branch": branch, "conclusion": conclusion, "html_url": f"https://github.com/MossesX/x/actions/runs/{no}", "head_sha": "abcdef1234", "display_title": "a commit"}


def auth(request: Request) -> None:
    if request.headers.get("authorization") != "Bearer console":
        raise HTTPException(401, "token")


def check_webpush() -> None:
    """Encrypt like the server, decrypt like a browser (RFC 8291), and verify the VAPID token (RFC 8292)."""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF

    ua = ec.generate_private_key(ec.SECP256R1())
    ua_pub = ua.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    auth_secret = os.urandom(16)
    msg = json.dumps({"title": "Hi", "body": "there"}).encode()
    body = A.webpush_encrypt(msg, A._b64u(ua_pub), A._b64u(auth_secret))
    salt, rs, idlen = body[:16], int.from_bytes(body[16:20], "big"), body[20]
    as_pub = body[21:21 + idlen]
    assert rs == 4096 and idlen == 65
    shared = ua.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_pub))
    ikm = HKDF(hashes.SHA256(), 32, auth_secret, b"WebPush: info\x00" + ua_pub + as_pub).derive(shared)
    cek = HKDF(hashes.SHA256(), 16, salt, b"Content-Encoding: aes128gcm\x00").derive(ikm)
    nonce = HKDF(hashes.SHA256(), 12, salt, b"Content-Encoding: nonce\x00").derive(ikm)
    plain = AESGCM(cek).decrypt(nonce, body[21 + idlen:], None)
    assert plain == msg + b"\x02", plain
    with tempfile.TemporaryDirectory() as tmp:
        hub = A.AlertHub(Path(tmp))
        pub = hub.vapid_public_key()
        assert pub and len(A._unb64u(pub)) == 65
        hdr = A.vapid_header("https://fcm.googleapis.com/fcm/send/abc", hub.f_vapid, "mailto:a@b.c")
        t, k = hdr[len("vapid t="):].split(", k=")
        assert k == pub
        head, claims, sig = t.split(".")
        c = json.loads(A._unb64u(claims))
        assert c["aud"] == "https://fcm.googleapis.com" and c["sub"] == "mailto:a@b.c" and c["exp"] > time.time()
        raw = A._unb64u(sig)
        key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), A._unb64u(pub))
        key.verify(encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")), f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256()))
        assert oct(hub.f_vapid.stat().st_mode & 0o777) == "0o600"
    print("web push encryption + VAPID OK")


def check_hub() -> None:
    srv = HTTPServer(("127.0.0.1", 0), Fake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_port}"
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        pending = d / "pending.json"
        pending.write_text(json.dumps({"items": [{"id": "lib-x", "title": "Lib X", "status": "pending"}]}))
        checks = [{"id": "github", "title": "GitHub token", "status": "error", "summary": "missing", "details": ["set it"]}, {"id": "repo", "title": "Repo", "status": "ok"}]
        plugins = {"good": {"id": "ai.x.good", "name": "Good"}, "bad": {"id": "ai.x.bad", "name": "Bad", "error": "ImportError: nope"}}
        hub = A.AlertHub(d, github_token=lambda: "gh-test", default_repos=["MossesX/x"], systems=lambda: checks, pending_file=lambda: pending, plugins=plugins, github_api=base)

        # config: validation, token never echoed, files private
        for bad in ("file:///etc/passwd", "http://example.com", "http://169.254.169.254"):
            try:
                hub.set_config({"ntfy": {"server": bad}}); raise AssertionError(f"bad server accepted: {bad}")
            except A.HTTPException:
                pass
        try:
            hub.set_config({"rules": {"channels": {"bell": {"min": "loud"}}}}); raise AssertionError("bad rule accepted")
        except A.HTTPException:
            pass
        cfg = hub.set_config({"ntfy": {"enabled": True, "server": base, "topic": "axf-test", "token": "tk_secret123"}, "rules": {"channels": {"bell": {"min": "info"}, "ntfy": {"min": "warning"}}}})
        assert cfg["ntfy"]["hasToken"] and "tk_secret123" not in json.dumps(cfg), cfg
        assert oct((d / "alerts-secrets.json").stat().st_mode & 0o777) == "0o600"

        # sources
        Fake.runs = [run(2, "failure"), run(1, "success"), run(5, "success", ".github/workflows/deploy.yml", "Deploy")]
        hub.poll_all()
        keys = {a["key"]: a for a in hub.snapshot()["alerts"]}
        assert "ci:MossesX/x:.github/workflows/android.yml:main" in keys, keys.keys()
        assert not any(k.startswith("deployed:") for k in keys), "no deploy success on the first look"
        assert keys["system:github"]["severity"] == "error" and "system:repo" not in keys
        assert keys["plugins:bad"]["severity"] == "error"
        hub.poll_all()  # same runs again: no new CI alert (count stays 1)
        assert {a["key"]: a for a in hub.snapshot()["alerts"]}["ci:MossesX/x:.github/workflows/android.yml:main"]["count"] == 1
        Fake.runs = [run(3, "success"), run(6, "success", ".github/workflows/deploy.yml", "Deploy"), run(2, "failure")]
        checks[0]["status"] = "ok"
        del plugins["bad"]["error"]
        pending.write_text(json.dumps({"items": [{"id": "lib-x", "title": "Lib X", "status": "failed"}]}))
        hub.poll_all()
        keys = {a["key"]: a for a in hub.snapshot()["alerts"]}
        assert keys["ci:MossesX/x:.github/workflows/android.yml:main"]["resolved"], "green run resolves"
        assert keys["system:github"]["resolved"] and keys["plugins:bad"]["resolved"]
        assert keys["deployed:MossesX/x:.github/workflows/deploy.yml:main"]["severity"] == "success"
        assert keys["builds:lib-x"]["severity"] == "error"
        plugins["dup"] = {"id": "ai.x.good", "name": "Dup"}
        hub.poll_plugins()
        assert {a["key"]: a for a in hub.snapshot()["alerts"]}["plugins:dup:ai.x.good"]["source"] == "conflicts"

        # delivery: warning+ to ntfy (per the rules), with the token, repeats not pushed
        Fake.posts.clear()
        for k, inp in (("a", {"source": "crashes", "severity": "error", "title": "Boom", "link": "https://example.com/x"}), ("b", {"source": "ci", "severity": "info", "title": "fyi"})):
            alert, event, targets = hub.raise_alert(inp)
            hub._deliver(alert, [t for t in targets if t != "bell"])
        assert len(Fake.posts) == 1, Fake.posts
        p = Fake.posts[0]
        assert p["auth"] == "Bearer tk_secret123" and p["body"]["topic"] == "axf-test" and p["body"]["priority"] == 4 and p["body"]["click"] == "https://example.com/x", p
        assert "Boom" not in p["body"]["message"] or p["body"]["message"].endswith("for details"), "details stay in the bell by default"
        Fake.posts.clear()
        hub.set_config({"ntfy": {"details": True}})
        hub.send_ntfy({"key": "k", "title": "T", "body": "Traceback xyz", "severity": "error", "source": "crashes", "link": ""})
        assert Fake.posts[-1]["body"]["message"] == "Traceback xyz"
        hub.set_config({"ntfy": {"details": False}})
        alert, event, targets = hub.raise_alert({"source": "crashes", "severity": "error", "title": "Boom"})
        assert event == "repeat" and targets == ["bell"], (event, targets)
        ok, detail = hub.test("ntfy")
        assert ok, detail
        hub.set_config({"sources": {"crashes": False}})
        assert hub.raise_alert({"source": "crashes", "severity": "error", "title": "Muted"})[1] == "off"
        hub.set_config({"sources": {"crashes": True}})
        hub.crash("unit", ValueError("bad thing"))
        assert any(a["key"] == "crash:unit:ValueError" for a in hub.snapshot()["alerts"])
        for _ in range(5):
            hub.crash("unit", ValueError("again"))
        assert {a["key"]: a for a in hub.snapshot()["alerts"]}["crash:unit:ValueError"]["count"] == 1, "one crash alert per key a minute"
        for i in range(40):
            hub.crash(f"flood{i}", RuntimeError("x"))
        assert sum(1 for a in hub.snapshot()["alerts"] if a["key"].startswith("crash:flood")) <= 19, "at most 20 crash alerts in 10 minutes"
        assert hub._outbox.maxsize == 100

        # CI runs already seen survive a restart: a dismissed failure doesn't come back
        hub.dismiss(["ci:MossesX/x:.github/workflows/android.yml:main"])
        Fake.runs = [run(9, "failure")]
        hub.poll_github()
        hub.dismiss(["ci:MossesX/x:.github/workflows/android.yml:main"])
        again = A.AlertHub(d, github_token=lambda: "gh-test", default_repos=["MossesX/x"], github_api=base, plugins={})
        again.poll_github()
        assert not any(a["key"] == "ci:MossesX/x:.github/workflows/android.yml:main" for a in again.snapshot()["alerts"]), "seen runs are remembered"

        # web push payloads always fit
        big = A._push_payload({"key": "k", "title": "é" * 300, "body": "€" * 3000, "severity": "info"}, "https://x/" + "y" * 600)
        assert len(big) <= A.PUSH_MAX and json.loads(big)["title"]

        # restart detection
        hub.start(); hub.stop()
        assert json.loads((d / "alerts-run.json").read_text())["clean"] is True
        (d / "alerts-run.json").write_text(json.dumps({"startedAt": 1, "pid": 1, "clean": False}))
        hub2 = A.AlertHub(d, github_token=lambda: "", plugins={})
        hub2.start(); hub2.stop()
        assert any(a["key"] == "crash:restart" for a in hub2.snapshot()["alerts"])

        # web push subscriptions are validated and never returned
        try:
            hub.add_subscription({"endpoint": "http://evil/", "keys": {}}); raise AssertionError("bad sub accepted")
        except A.HTTPException:
            pass
        assert hub.add_subscription({"endpoint": "https://push.example.com/abc", "keys": {"p256dh": "k", "auth": "a"}}) == 1
        assert "push.example.com" not in json.dumps(hub.public_config())

        # HTTP routes with the console token
        app = FastAPI()
        app.include_router(A.router_for(hub, auth))
        c = TestClient(app)
        assert c.get("/api/alerts").status_code == 401
        h = {"authorization": "Bearer console"}
        r = c.post("/api/alerts", json={"source": "conflicts", "severity": "warning", "title": "Two themes", "key": "conflict:asset:color-theme/x"}, headers=h).json()
        assert r["ok"] and r["event"] == "new"
        assert c.post("/api/alerts", json={"source": "x", "severity": "warning", "title": "t", "link": "javascript:alert(1)"}, headers=h).status_code == 400
        assert c.post("/api/alerts", json={"source": "BAD SOURCE", "severity": "warning", "title": "t"}, headers=h).status_code == 422
        snap = c.post("/api/alerts/ack", json={"all": True}, headers=h).json()
        assert snap["unread"] == 0
        assert "tk_secret123" not in c.get("/api/alerts/config", headers=h).text
        assert c.post("/api/alerts/test", json={"channel": "bell"}, headers=h).json()["ok"]
    srv.shutdown()
    print("hub, sources, delivery and routes OK")


def check_damaged_store() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        good = A.apply_alert([], {"source": "s", "severity": "info", "title": "ok"}, 1)[0][0]
        (d / "alerts.json").write_text(json.dumps([good, {"key": "half"}, {**good, "key": "bad-sev", "id": "bad-sev", "severity": "loud"}, "junk"]))
        hub = A.AlertHub(d, plugins={})
        assert [a["key"] for a in hub.items] == ["s:ok"]
        hub.raise_alert({"source": "s", "severity": "error", "title": "new"}, deliver=False)
        (d / "alerts.json").write_text("{not json")
        assert A.AlertHub(d, plugins={}).items == []
    print("damaged store OK")


def check_console_app() -> None:
    """The real console app: an overlong path is not a crash, and crash alerts are keyed by route, not by URL."""
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["AXF_STATE"] = str(Path(tmp) / "state.json")
        os.environ.setdefault("AXF_DATA_DIR", "off")
        import main  # noqa: PLC0415
        c = TestClient(main.app, raise_server_exceptions=False)
        before = len(main.ALERTS.items)
        for i in range(3):
            r = c.get("/" + ("a%d" % i) * 150)
            assert r.status_code in (200, 404), r.status_code
        assert len(main.ALERTS.items) == before, "an overlong path must not raise crash alerts"

        def boom(x: str) -> None:
            raise RuntimeError("boom")
        main.app.add_api_route("/api/__test_boom/{x}", boom, methods=["GET"])
        main.app.router.routes.insert(0, main.app.router.routes.pop())  # before the console's catch-all page route
        for x in ("a", "b", "c"):
            assert c.get(f"/api/__test_boom/{x}").status_code == 500
        crashes = [a for a in main.ALERTS.items if a["key"].startswith("crash:api")]
        assert [a["key"] for a in crashes] == ["crash:api GET /api/__test_boom/{x}:RuntimeError"], crashes
    print("console app crash handling OK")


if __name__ == "__main__":
    check_fixture()
    check_webpush()
    check_hub()
    check_damaged_store()
    check_console_app()
    print("alerts: all checks passed")
