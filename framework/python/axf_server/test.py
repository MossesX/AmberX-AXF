#!/usr/bin/env python3
"""Self-test for axf_server (stdlib only; no network beyond a fake server on 127.0.0.1).

    python3 framework/python/axf_server/test.py

1. wall: replays framework/spec/fixtures/wall-signature.json (the Node checker replays the same file), Wall prefixes,
   same-origin, user_may
2. plugin_package: replays framework/spec/fixtures/plugin-package.json (= framework/cli/plugin-catalog.mjs results)
3. storage: modes 0600/0700 under any umask, atomic replace, no tmp files left, safe reads, JSONL rotation
4. http: target rules, no redirects / credential-stripping redirects against a fake server, size cap, timeout, HttpClient
5. credentials + console_client: env-file store, token file (mtime cache, reset survives), console calls
"""
from __future__ import annotations

import sys
from pathlib import Path

# Run as a script, this folder is sys.path[0] and its http.py would shadow the standard library's http package.
_HERE = Path(__file__).resolve().parent
sys.path[:] = [p for p in sys.path if Path(p or ".").resolve() != _HERE]

import json  # noqa: E402
import os  # noqa: E402
import stat  # noqa: E402
import tempfile  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer  # noqa: E402
from types import SimpleNamespace  # noqa: E402

HERE = Path(__file__).resolve().parent
PY = HERE.parent
sys.path.insert(0, str(PY))
from axf_server import console_client, credentials, http, plugin_package, storage, wall  # noqa: E402

FIX = PY.parent / "spec" / "fixtures"
n = 0


def check(cond: object, what: str) -> None:
    global n
    if not cond:
        raise AssertionError(what)
    n += 1


def mode(p: Path) -> int:
    return stat.S_IMODE(p.stat().st_mode)


# ---------------------------------------------------------------- 1. wall
W = json.loads((FIX / "wall-signature.json").read_text())
for c in W["cases"]:
    got = wall.verify(c.get("secret", W["secret"]), c["sig"], c["user"], c["role"], c["perms"], c["host"], now=W["now"])
    check(got == c["expect"], f"wall fixture: {c['name']}")
check(wall.sign(W["secret"], "conrad", "user", "console.themes,assistant.chat", "console.amberxai.com", W["now"]) == W["cases"][0]["sig"], "sign() = fixture")
for c in W["callers"]:
    env = {f"BP_{k}": v for k, v in c["env"].items()}
    got = wall.Wall("BP_", env=env.get).caller(c["headers"], now=W["now"])
    want = c["expect"]
    check((got.public() if got else None) == (dict(want, perms=sorted(want["perms"])) if want else None), f"wall caller fixture: {c['name']}")
check(W["maxAgeS"] == wall.MAX_AGE_S and W["minSecret"] == wall.MIN_SECRET, "fixture limits = module limits")

# prefixes: the console's AXF_ never reads Build Pilot's BP_ and vice versa
env = {"AXF_TRUST_WALL": "1", "AXF_WALL_SECRET": W["secret"]}
check(wall.Wall("AXF_", env=env.get).trusted() and not wall.Wall("BP_", env=env.get).trusted(), "env prefix picks the vars")
check(not wall.Wall("AXF_", env={"AXF_TRUST_WALL": "1", "AXF_WALL_SECRET": "x" * 31}.get).trusted(), "31-char secret: not trusted")
try:
    wall.Wall("axf")
    check(False, "bad prefix refused")
except ValueError:
    check(True, "bad prefix refused")
now_sig = wall.sign(W["secret"], "conrad", "user", "", "h.test", int(time.time()))
hdrs = {"x-auth-via": "session", "x-auth-user": "conrad", "x-auth-role": "user", "x-auth-perms": "", "host": "h.test", "x-auth-sig": now_sig}
w = wall.Wall("AXF_", env=env.get)
check(w.caller(hdrs) is not None and not w.malformed_session(hdrs), "live signature accepted")
check(w.malformed_session({**hdrs, "x-auth-user": "admin"}), "tampered session is malformed (refused, not anonymous)")
check(not w.malformed_session({**hdrs, "x-auth-via": "token"}), "token requests are not sessions")


def req(method: str, headers: dict[str, str]) -> SimpleNamespace:
    return SimpleNamespace(method=method, headers=headers, state=SimpleNamespace())


check(wall.same_origin(req("GET", {"host": "a.test"})), "GET always same-origin")
check(wall.same_origin(req("POST", {"host": "a.test", "origin": "https://a.test"})), "POST from own origin")
check(not wall.same_origin(req("POST", {"host": "a.test", "origin": "https://b.a.test"})), "POST from a sibling subdomain refused")
check(not wall.same_origin(req("POST", {"host": "a.test", "origin": "null"})), "null origin refused")
check(not wall.same_origin(req("POST", {"host": "a.test"})), "no origin refused")
check(wall.same_origin(req("POST", {"host": "a.test", "referer": "https://a.test/page"})), "referer fallback")
adm = {**hdrs, "x-auth-user": "admin", "x-auth-role": "admin", "x-auth-sig": wall.sign(W["secret"], "admin", "admin", "", "h.test", int(time.time()))}
check(w.admin(req("GET", adm)) is not None and w.admin(req("POST", adm)) is None, "Wall.admin needs same origin for writes")
check(w.admin(req("POST", {**adm, "origin": "https://h.test"})) is not None, "Wall.admin write from own origin")
u = wall.Caller("u", "user", frozenset({"console.plugin.*", "assistant.*"}))
check(u.can("assistant.chat") and not u.can("console.themes"), "Caller.can wildcards")
check(not wall.user_may(u, "GET", "/api/plugins/sample-plugin/x", grantable=frozenset({"sample-plugin"})), "wildcard never grants a plugin")
check(wall.user_may(wall.Caller("u", "user", frozenset({"console.plugin.sample-plugin"})), "POST", "/api/plugins/sample-plugin/x", grantable=frozenset({"sample-plugin"})), "exact grant")
check(not wall.user_may(u, "GET", "/api/plugins/../token/reset"), "dotted plugin path")
check(not wall.user_may(u, "GET", "/api/plugins/x%2f..%2ftoken"), "encoded plugin path")
check(wall.user_may(u, "GET", "/api/catalog") and not wall.user_may(u, "POST", "/api/catalog"), "read-only allowlist")
check(not wall.user_may(u, "GET", "/panel") and not wall.user_may(u, "GET", "/data/x.json") and not wall.user_may(u, "GET", "/mcp"), "admin pages + MCP")
check(wall.user_may(u, "GET", "/assets/app.js"), "static page files")
check(wall.ui_role(wall.Caller("t", "user", frozenset({"console.themes"}))) == "themes", "ui role")

# ---------------------------------------------------------------- 2. plugin_package
P = json.loads((FIX / "plugin-package.json").read_text())
check(P["limits"] == plugin_package.LIMITS, "limits match the .mjs")
for k, v in P["kinds"].items():
    pk = plugin_package.KINDS[k]
    check(pk.label == v["label"] and pk.manifest == v["manifest"] and ((pk.allow_source or None) == v["allow"]), f"kind {k} matches")
for c in P["pathProblems"]:
    check(plugin_package.path_problem(c["kind"], c["path"]) == c["expect"], f"path problem {c['kind']} {c['path']!r}")
for c in P["cases"]:
    try:
        v = plugin_package.verify_package(json.loads(json.dumps(c["pkg"])), c.get("expectSha256"))
        got = {"ok": True, "id": v["id"], "name": v["name"], "version": v["version"], "sha256": v["sha256"], "bytes": v["bytes"]}
    except plugin_package.PackageError as e:
        got = {"ok": False, "error": str(e)}
    check(got == c["expect"], f"package fixture: {c['name']}: {got} vs {c['expect']}")
good = next(c for c in P["cases"] if c["name"] == "valid pilot plugin")
try:
    plugin_package.verify_package(good["pkg"], kind="console")
    check(False, "kind filter")
except plugin_package.PackageError:
    check(True, "kind filter")
try:
    plugin_package.verify_package(good["pkg"], kind="pilot", folder="other")
    check(False, "folder filter")
except plugin_package.PackageError as e:
    check("folder" in str(e), "folder filter")
ok_pkg = plugin_package.verify_package(good["pkg"], kind="pilot", folder="extra-steps")
check([p for p, _ in plugin_package.decode_files(ok_pkg)] == ["plugin.json", "README.md", "web/index.tsx"], "decode_files")
check(plugin_package.path_problem("pilot", "web/x.ts\n") != "", "a trailing newline is not a valid path (\\Z, not $)")

# ---------------------------------------------------------------- 3. storage
with tempfile.TemporaryDirectory() as tmp:
    d = Path(tmp)
    old = os.umask(0o002)
    try:
        f = storage.write_json(d / "new" / "deep" / "a.json", {"x": 1})
        check(mode(f) == 0o600, "file 0600 under umask 002")
        check(mode(d / "new" / "deep") == 0o700, "new folder 0700")
        check(storage.read_json(f, None) == {"x": 1}, "round trip")
        storage.write_json(f, {"x": 2}, indent=None)
        check(f.read_text() == '{"x": 2}', "replaced, compact")
        check([p.name for p in f.parent.iterdir()] == ["a.json"], "no tmp files left")
        shared = d / "shared"
        shared.mkdir(mode=0o775)
        os.chmod(shared, 0o2775)
        g = storage.write_json(shared / "c.json", [], mode=0o664, dir_mode=None)
        check(mode(g) == 0o664 and mode(shared) == 0o2775, "explicit mode; existing folder untouched")
        os.umask(0o077)
        h = storage.write_bytes(d / "b.bin", b"\0\1", mode=0o644)
        check(mode(h) == 0o644, "fchmod beats a narrow umask too")
    finally:
        os.umask(old)
    try:
        storage.write_json(d / "bad.json", {"x": object()})
        check(False, "non-JSON refused")
    except TypeError:
        check(not (d / "bad.json").exists() and not list(d.glob(".bad.json*")), "non-JSON value leaves nothing behind")
    try:
        storage.write_text(d / "nofolder" / "x", "y", dir_mode=None)
        check(False, "dir_mode=None needs the folder")
    except FileNotFoundError:
        check(True, "dir_mode=None needs the folder")
    default = {"list": []}
    r = storage.read_json(d / "missing.json", default)
    r["list"].append(1)
    check(default == {"list": []}, "read_json returns a copy of the default")
    (d / "broken.json").write_text("{nope")
    check(storage.read_json(d / "broken.json", 7) == 7, "damaged JSON → default")
    log = d / "logs" / "a.jsonl"
    for i in range(30):
        storage.append_jsonl(log, {"i": i, "pad": "x" * 40}, rotate_at=500)
    check(mode(log) == 0o600 and log.with_suffix(".1.jsonl").exists(), "jsonl 0600 + rotated")
    check(all(json.loads(x) for x in log.read_text().splitlines()), "jsonl lines parse")
    os.symlink(d / "target", d / "link.jsonl")
    try:
        storage.append_jsonl(d / "link.jsonl", {})
        check(False, "append refuses a symlink")
    except OSError:
        check(not (d / "target").exists(), "append refuses a symlink")
    # concurrent writers never share a tmp file
    errs: list[BaseException] = []

    def hammer(k: int) -> None:
        try:
            for j in range(40):
                storage.write_json(d / "race.json", {"k": k, "j": j})
        except BaseException as e:  # noqa: BLE001
            errs.append(e)

    ts = [threading.Thread(target=hammer, args=(k,)) for k in range(6)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    check(not errs and isinstance(storage.read_json(d / "race.json", None), dict) and not list(d.glob(".race.json*")), "concurrent writers")

# ---------------------------------------------------------------- 4. http
check(http.target_ok("https://example.com/x"), "https ok")
for bad in ("http://example.com", "file:///etc/passwd", "ftp://x", "http://169.254.169.254/", "https://user:pw@example.com/",
            "gopher://x", "https://", "https://exa mple.com", "https://example.com:99999/", "javascript:alert(1)", "http://127.0.0.1.evil.test/"):
    check(not http.target_ok(bad), f"refused {bad}")
for good_url in ("http://127.0.0.1:8080/", "http://localhost/", "http://[::1]:1/"):
    check(http.target_ok(good_url), f"loopback {good_url}")
check(http.target_ok("http://axf-console:7090/api", allow_http_hosts=["axf-console"]), "named http host")
check(http.origin_of("https://API.github.com:443/x") == "https://api.github.com", "origin normalised")

hits: list[tuple[str, str, dict[str, str]]] = []


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a: object) -> None:
        pass

    def _go(self) -> None:
        n_ = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(n_) if n_ else b""
        hits.append((self.command, self.path, {k.lower(): v for k, v in self.headers.items()}))
        if "/redir-same" in self.path:
            self.send_response(302); self.send_header("location", "/ok"); self.end_headers(); return
        if "/redir-other" in self.path:
            self.send_response(302); self.send_header("location", f"http://localhost:{self.server.server_port}/ok"); self.end_headers(); return
        if "/redir-evil" in self.path:
            self.send_response(301); self.send_header("location", "http://example.com/steal"); self.end_headers(); return
        if "/loop" in self.path:
            self.send_response(302); self.send_header("location", "/loop"); self.end_headers(); return
        if "/big" in self.path:
            data = b"x" * 5000
        elif "/slow" in self.path:
            time.sleep(1.5); data = b"{}"
        elif "/err" in self.path:
            self.send_response(418); self.end_headers(); self.wfile.write(b'{"detail":"teapot"}'); return
        else:
            data = json.dumps({"path": self.path, "method": self.command, "body": body.decode()}).encode()
        self.send_response(200); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(data))); self.end_headers(); self.wfile.write(data)

    do_GET = do_POST = do_PUT = _go


srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_port}"
try:
    r = http.request("GET", base + "/ok", headers={"Authorization": "Bearer t"})
    check(r.ok and r.json()["path"] == "/ok", "plain GET to loopback")
    r = http.request("GET", base + "/redir-same", headers={"Authorization": "Bearer t"})
    check(r.status == 302 and r.redirect and len([h for h in hits if h[1] == "/ok"]) == 1, "never: 3xx is the answer, not followed")
    hits.clear()
    r = http.request("GET", base + "/redir-same", headers={"Authorization": "Bearer t", "Cookie": "c=1"}, redirects="strip-auth")
    check(r.ok and hits[-1][2].get("authorization") == "Bearer t", "strip-auth: same origin keeps the token")
    hits.clear()
    r = http.request("GET", base + "/redir-other", headers={"Authorization": "Bearer t", "Cookie": "c=1", "X-Custom-Key": "k"},
                     redirects="strip-auth", secret_headers=["x-custom-key"])
    last = hits[-1][2]
    check(r.ok and "authorization" not in last and "cookie" not in last and "x-custom-key" not in last, "strip-auth: other origin loses credentials")
    hits.clear()
    r = http.request("GET", base + "/redir-other", headers={"Authorization": "Bearer t"}, redirects="strip-auth", auth_origins=[f"http://localhost:{srv.server_port}"])
    check(hits[-1][2].get("authorization") == "Bearer t", "strip-auth: allow-listed origin keeps the token")
    try:
        http.request("GET", base + "/redir-evil", headers={"Authorization": "Bearer t"}, redirects="strip-auth")
        check(False, "redirect to plain http refused")
    except http.TargetRefused:
        check(True, "redirect to plain http refused")
    try:
        http.request("GET", base + "/loop", redirects="strip-auth", max_redirects=3)
        check(False, "redirect loop")
    except http.HttpError as e:
        check("too many" in str(e), "redirect loop")
    try:
        http.request("GET", base + "/big", max_bytes=1000)
        check(False, "size cap")
    except http.ResponseTooLarge:
        check(True, "size cap")
    check(len(http.request("GET", base + "/big", max_bytes=1000, truncate=True).body) == 1000, "truncate")
    try:
        http.request("GET", base + "/slow", timeout=0.3)
        check(False, "timeout")
    except http.HttpError:
        check(True, "timeout")
    r = http.request("GET", base + "/err")
    check(r.status == 418 and not r.ok and r.json()["detail"] == "teapot", "error answer is a Response")
    try:
        http.get_json(base + "/err")
        check(False, "get_json raises on 4xx")
    except http.HttpStatusError as e:
        check(e.status == 418, "get_json raises on 4xx")
    check(http.post_json(base + "/echo", {"a": 1})["body"] == '{"a": 1}', "post_json")
    try:
        http.request("GET", "http://example.com/")
        check(False, "plain http refused before connecting")
    except http.TargetRefused:
        check(True, "plain http refused before connecting")
    try:
        http.request("GET", "http://127.0.0.1:1/")
        check(False, "connection refused")
    except http.HttpError:
        check(True, "connection refused → HttpError")
    # HttpClient: base + auth + origin lock
    cl = http.HttpClient(base, auth=lambda: "Bearer k", headers={"Accept": "application/json"})
    hits.clear()
    check(cl.get_json("/ok")["path"] == "/ok" and hits[-1][2]["authorization"] == "Bearer k" and hits[-1][2]["user-agent"] == "axf-server", "HttpClient auth + UA")
    check(cl.post_json("echo", {"b": 2})["method"] == "POST", "HttpClient post_json")
    try:
        cl.get_json("https://evil.example/x")
        check(False, "HttpClient origin lock")
    except http.TargetRefused:
        check(True, "HttpClient origin lock")
    hits.clear()
    cl.request("GET", "/ok", auth=False)
    check("authorization" not in hits[-1][2], "HttpClient auth=False")
    # transport injection
    seen: list[http.Request] = []
    r = http.request("GET", "https://api.example/x", transport=lambda q: (seen.append(q), http.Response(200, {}, b"[]", q.url))[1])
    check(r.json() == [] and seen[0].url == "https://api.example/x", "injected transport")

    # ---------------------------------------------------------------- 5. credentials + console client
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        envmap: dict[str, str] = {}
        cs = credentials.CredStore(d / "c" / "secrets.env", environ=envmap)
        cs.set("GITHUB_TOKEN", "ghp_x")
        cs.set("AXHUB_URL", "https://hub")
        check(mode(d / "c" / "secrets.env") == 0o600 and mode(d / "c") == 0o700, "cred file 0600 / folder 0700")
        check(cs.read() == {"AXHUB_URL": "https://hub", "GITHUB_TOKEN": "ghp_x"} and envmap["GITHUB_TOKEN"] == "ghp_x", "cred read + env")
        check((d / "c" / "secrets.env").read_text().startswith("# "), "header line")
        cs.clear("GITHUB_TOKEN")
        check("GITHUB_TOKEN" not in cs.read() and "GITHUB_TOKEN" not in envmap, "cred clear")
        for k, v in (("lower", "x"), ("OK_KEY", "a\nEVIL=1")):
            try:
                cs.set(k, v)
                check(False, f"refused {k}")
            except credentials.CredentialError:
                check(True, f"refused {k}")
        (d / "c" / "secrets.env").write_text("# c\nGOOD_ONE=1\nbad=2\n  # X=3\nNO_EQUALS\n")
        envmap.clear()
        cs.load_into_env()
        check(envmap == {"GOOD_ONE": "1"}, "load_into_env ignores junk")

        tf_path = d / "env"
        tf = console_client.TokenFile(tf_path, fallback="from-env", allow_bare=False)
        check(tf() == "from-env", "no file → fallback")
        tf_path.write_text("GITHUB_TOKEN=g\nAXF_TOKEN=abc\nDOMAIN=x\n")
        check(tf() == "abc", "token line")
        tf.write("newtok")
        check(tf() == "newtok" and tf_path.read_text().startswith("AXF_TOKEN=newtok\n") and "GITHUB_TOKEN=g" in tf_path.read_text(), "write keeps other lines")
        check(mode(tf_path) == 0o600, "token file 0600")
        tf_path.write_text("AXF_TOKEN=\nDOMAIN=x\n")
        os.utime(tf_path, ns=(time.time_ns(), time.time_ns() + 10**9))
        check(tf() == "newtok", "a file without a token keeps the last one (never the stale env value)")
        bare = d / "bare"
        bare.write_text("justthetoken\n")
        check(console_client.TokenFile(bare)() == "justthetoken", "bare token file")
        check(console_client.TokenFile(bare, allow_bare=False, fallback="f")() == "f", "bare refused when not allowed")
        check(console_client.read_token_text('AXF_TOKEN="q1"\n') == "q1", "quotes stripped")
        for bad in ("", "a\nb", "a=b"):
            try:
                tf.write(bad)
                check(False, f"bad token {bad!r}")
            except ValueError:
                check(True, f"bad token {bad!r}")

    tok = {"v": "T"}
    cc = console_client.ConsoleClient(base, token=lambda: tok["v"], token_hint="BP_CONSOLE_TOKEN")
    hits.clear()
    check(cc.call("GET", "/api/ok")["path"] == "/api/ok" and hits[-1][2]["authorization"] == "Bearer T", "console call + bearer")
    check(cc.call("POST", "/api/echo", {"z": 1})["body"] == '{"z": 1}', "console POST JSON")
    for bad in ("/x", "/api/../token", "/api\\x"):
        try:
            cc.call("GET", bad)
            check(False, f"bad path {bad}")
        except console_client.ConsoleError:
            check(True, f"bad path {bad}")
    try:
        cc.call("GET", "/api/redir-same")
        check(False, "console redirect")
    except console_client.ConsoleError as e:
        check("redirected" in str(e) and "BP_CONSOLE_TOKEN" in str(e), "console redirect = sign-in wall, never followed")
    try:
        cc.call("GET", "/api/err")
        check(False, "console error")
    except console_client.ConsoleError as e:
        check("418" in str(e) and "teapot" in str(e), "console error detail")
    try:
        cc.raw("/api/big", limit=100)
        check(False, "raw limit")
    except console_client.ConsoleError as e:
        check("too large" in str(e), "raw limit")
    check(len(cc.raw("/api/big")) == 5000, "raw bytes")
    named = console_client.ConsoleClient("http://axf-console:7090", token=lambda: "", transport=lambda q: http.Response(200, {}, b'{"ok":1}', q.url))
    check(named.call("GET", "/api/health") == {"ok": 1}, "plain http allowed to the configured console host only")
    other = console_client.ConsoleClient("http://evil.example", token=lambda: "", allow_http_hosts=())
    try:
        other.call("GET", "/api/x")
        check(False, "plain http to another host")
    except console_client.ConsoleError as e:
        check("refused" in str(e), "plain http to another host refused")
finally:
    srv.shutdown()

print(f"axf_server self-test ok: {n} checks")
