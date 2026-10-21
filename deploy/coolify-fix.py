#!/usr/bin/env python3
"""coolify-fix: change a Coolify app from the VPS shell, through the Coolify API (Oct 21 2026).

Used by the console's Auto fix (systems-check plugin): axHub runs it with `vps.run` only after Brett approves the exact
command. Also fine by hand in mosh. Stdlib only.

  python3 /opt/axf/deploy/coolify-fix.py --app <uuid|name> [--service] <op>… [deploy|restart]

  env-set KEY=value           create or update a variable (plain values only: they're visible in the command)
  env-from KEY=<source>       set a variable from a secret the VPS holds, never printed:
                                console-wall-secret → /opt/axf/.axf-console/wall-secret
  env-unset KEY               remove a variable
  deploy | restart            redeploy (applies new variables) or restart the app afterwards
  --dry-run                   say what would change, change nothing
  --list                      list apps and services (uuid, name) and exit

Token: COOLIFY_TOKEN from the environment, else the console's credential file /opt/axf/.axf-console/secrets.env
(0600, saved from the console's Keys banner). Address: COOLIFY_HOST_URL, else the console's COOLIFY_URL when it is
https, else http://127.0.0.1:8000 (Coolify's port on the VPS; the console's http://coolify:8080 only resolves inside
Docker). Plain http only to this machine. Redirects are never followed (the token stays with Coolify). Values are
never printed: only variable names and what happened.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

AXF = os.environ.get("AXF_DIR", "/opt/axf")
SECRETS_FILE = os.path.join(AXF, ".axf-console", "secrets.env")
SOURCES = {"console-wall-secret": os.path.join(AXF, ".axf-console", "wall-secret")}
KEY_RE = re.compile(r"^[A-Z_][A-Z0-9_]{0,127}$")
APP_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.-]{0,127}$")


class Fail(Exception):
    pass


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):  # noqa: ANN002, ANN003
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def _creds() -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        with open(SECRETS_FILE, encoding="utf-8") as fh:
            for line in fh:
                if "=" in line and not line.lstrip().startswith("#"):
                    k, v = line.split("=", 1)
                    out[k.strip()] = v.strip()
    except OSError:
        pass
    return out


def connection() -> tuple[str, str]:
    c = _creds()
    tok = os.environ.get("COOLIFY_TOKEN") or c.get("COOLIFY_TOKEN", "")
    if not tok:
        raise Fail("no Coolify token: add it in the console (Keys needed → Coolify) or set COOLIFY_TOKEN")
    url = os.environ.get("COOLIFY_HOST_URL", "")
    if not url:
        cu = c.get("COOLIFY_URL", "")
        url = cu if cu.startswith("https://") else "http://127.0.0.1:8000"
    url = url.rstrip("/")
    u = urllib.parse.urlsplit(url)
    if u.scheme == "http" and u.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise Fail(f"refusing plain http to {u.hostname}: use https or this machine")
    if u.scheme not in ("http", "https") or u.username or u.password:
        raise Fail("bad Coolify address")
    return url, tok


def api(method: str, path: str, body: dict | None = None) -> tuple[int, object]:
    url, tok = connection()
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{url}/api/v1{path}", data=data, method=method,
                                 headers={"authorization": f"Bearer {tok}", "accept": "application/json", "content-type": "application/json"})
    try:
        with _OPENER.open(req, timeout=30) as r:
            raw = r.read(2_000_000)
            code = r.status
    except urllib.error.HTTPError as e:
        raw, code = e.read(20_000), e.code
    except urllib.error.URLError as e:
        raise Fail(f"couldn't reach Coolify at {url} ({e.reason})") from None
    try:
        return code, json.loads(raw or b"null")
    except ValueError:
        return code, None


def _ok(code: int, what: str, data: object) -> object:
    if 200 <= code < 300:
        return data
    msg = data.get("message") if isinstance(data, dict) else None
    hint = " (check the Coolify token's permissions)" if code in (401, 403) else ""
    raise Fail(f"{what}: Coolify answered {code}{hint}{': ' + str(msg)[:200] if msg else ''}")


def resolve(app: str, service: bool) -> tuple[str, str, str]:
    """(uuid, name, base path) for an app given by uuid or exact name."""
    kind = "services" if service else "applications"
    code, rows = api("GET", f"/{kind}")
    _ok(code, f"list {kind}", rows)
    rows = rows if isinstance(rows, list) else []
    hit = [r for r in rows if isinstance(r, dict) and (r.get("uuid") == app or str(r.get("name", "")).lower() == app.lower())]
    if len(hit) != 1:
        raise Fail(f"no single {kind[:-1]} matches {app!r} ({len(hit)} found); --list shows them")
    return str(hit[0]["uuid"]), str(hit[0].get("name") or app), f"/{kind}/{hit[0]['uuid']}"


def envs(base: str) -> dict[str, dict]:
    code, rows = api("GET", f"{base}/envs")
    _ok(code, "read variables", rows)
    return {str(r["key"]): r for r in rows if isinstance(r, dict) and r.get("key") and not r.get("is_preview")} if isinstance(rows, list) else {}


def set_env(base: str, key: str, value: str, existing: dict[str, dict]) -> str:
    if key in existing:
        if existing[key].get("value") == value:
            return "already set"
        code, data = api("PATCH", f"{base}/envs", {"key": key, "value": value})
        _ok(code, f"update {key}", data)
        return "updated"
    for body in ({"key": key, "value": value, "is_preview": False, "is_build_time": False}, {"key": key, "value": value, "is_preview": False}):
        code, data = api("POST", f"{base}/envs", body)
        if code != 422:  # older/newer Coolify versions name the build flag differently: retry without it
            break
    _ok(code, f"create {key}", data)
    return "created"


def unset_env(base: str, key: str, existing: dict[str, dict]) -> str:
    if key not in existing:
        return "not there"
    code, data = api("DELETE", f"{base}/envs/{existing[key].get('uuid')}")
    _ok(code, f"remove {key}", data)
    return "removed"


def read_source(src: str) -> str:
    p = SOURCES.get(src)
    if not p:
        raise Fail(f"unknown secret source {src!r}")
    try:
        v = open(p, encoding="utf-8").read().strip()
    except OSError:
        raise Fail(f"{src}: {p} doesn't exist on this VPS yet") from None
    if not v:
        raise Fail(f"{src}: {p} is empty")
    return v


def after(base: str, uuid: str, what: str, service: bool) -> str:
    if what == "deploy" and not service:
        # Newer Coolify takes POST here (GET answers 405 "This endpoint has changed to a POST request"); older ones GET.
        code, data = api("POST", f"/deploy?uuid={urllib.parse.quote(uuid)}&force=false")
        if code in (404, 405):
            code, data = api("GET", f"/deploy?uuid={urllib.parse.quote(uuid)}&force=false")
        _ok(code, "redeploy", data)
        return "redeploy started"
    code, data = api("POST", f"{base}/restart")
    if code in (404, 405):
        code, data = api("GET", f"{base}/restart")
    _ok(code, "restart", data)
    return "restart started"


def parse(argv: list[str]) -> dict:
    o: dict = {"app": None, "service": False, "ops": [], "then": None, "dry": False, "list": False}
    it = iter(argv)
    for a in it:
        if a == "--app":
            o["app"] = next(it, "")
        elif a == "--service":
            o["service"] = True
        elif a == "--dry-run":
            o["dry"] = True
        elif a == "--list":
            o["list"] = True
        elif a in ("env-set", "env-from"):
            kv = next(it, "")
            if "=" not in kv:
                raise Fail(f"{a} needs KEY=value")
            k, v = kv.split("=", 1)
            if not KEY_RE.match(k):
                raise Fail(f"bad variable name {k!r}")
            o["ops"].append((a, k, v))
        elif a == "env-unset":
            k = next(it, "")
            if not KEY_RE.match(k):
                raise Fail(f"bad variable name {k!r}")
            o["ops"].append((a, k, ""))
        elif a in ("deploy", "restart"):
            o["then"] = a
        elif a in ("-h", "--help"):
            print(__doc__)
            sys.exit(0)
        else:
            raise Fail(f"unknown argument {a!r} (see --help)")
    return o


def main(argv: list[str]) -> int:
    try:
        o = parse(argv)
        if o["list"]:
            for kind in ("applications", "services"):
                code, rows = api("GET", f"/{kind}")
                _ok(code, f"list {kind}", rows)
                for r in rows if isinstance(rows, list) else []:
                    print(f"{kind[:-1]:12} {r.get('uuid')}  {r.get('name')}")
            return 0
        if not o["app"] or not APP_RE.match(o["app"]):
            raise Fail("--app <uuid or name> is required")
        if not o["ops"] and not o["then"]:
            raise Fail("nothing to do (give env-set / env-from / env-unset and/or deploy / restart)")
        uuid, name, base = resolve(o["app"], o["service"])
        print(f"coolify-fix: {name} ({uuid})")
        existing = envs(base)
        changed = False
        for op, key, val in o["ops"]:
            if o["dry"]:
                print(f"  would {op} {key}")
                continue
            if op == "env-unset":
                r = unset_env(base, key, existing)
            else:
                r = set_env(base, key, read_source(val) if op == "env-from" else val, existing)
            changed = changed or r not in ("already set", "not there")
            print(f"  {key}: {r}")
        if o["then"] and not o["dry"]:
            if o["ops"] and not changed:
                print(f"  nothing changed, so no {o['then']}")
            else:
                print(f"  {after(base, uuid, o['then'], o['service'])}")
        return 0
    except Fail as e:
        print(f"coolify-fix: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
