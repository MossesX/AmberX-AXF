"""Runs on the VPS host (sent by the Badges plugin through axf.headless@1): every saved Claude login's usage, as one JSON line.

Plain HTTP, no model call, so it costs no tokens. The token is read here and sent only to api.anthropic.com; what is
printed is a fixed list of fields, never the token or the answer's raw text. An expired token is not refreshed and not
sent: a refresh would rotate a login other sessions are using.
"""
import json
import os
import time
import urllib.error
import urllib.request

BASE = os.path.expanduser("~/.claude-accounts")
LIVE = os.path.expanduser("~/.claude/.credentials.json")
URL = "https://api.anthropic.com/api/oauth/usage"


def login(path):
    try:
        with open(path) as f:
            o = json.load(f).get("claudeAiOauth") or {}
    except (OSError, ValueError):
        return {}
    return o if isinstance(o, dict) else {}


def window(v):
    if not isinstance(v, dict):
        return None
    return {"used": v.get("utilization"), "resetsAt": v.get("resets_at"), "locked": bool(v.get("locked_reason"))}


def read(token):
    req = urllib.request.Request(URL, headers={"Authorization": "Bearer " + token, "anthropic-beta": "oauth-2025-04-20"})
    try:
        with urllib.request.urlopen(req, timeout=6) as r:
            b = json.load(r)
        return {"http": 200, "fiveHour": window(b.get("five_hour")), "weekly": window(b.get("seven_day"))}
    except urllib.error.HTTPError as e:
        return {"http": e.code}
    except Exception:  # no network, no answer: the row says so, the others still run
        return {"http": 0}


def main():
    try:
        with open(os.path.join(BASE, ".active")) as f:
            active = f.read().strip()
    except OSError:
        active = ""
    rows = []
    names = sorted(n for n in os.listdir(BASE) if os.path.isdir(os.path.join(BASE, n))) if os.path.isdir(BASE) else []
    for name in names:
        d = os.path.join(BASE, name)
        row = {"name": name, "active": name == active, "http": None, "plan": "", "kind": "login"}
        if os.path.getsize(os.path.join(d, "apikey")) if os.path.exists(os.path.join(d, "apikey")) else 0:
            rows.append({**row, "kind": "api-key"})
            continue
        o = login(LIVE if name == active else os.path.join(d, ".credentials.json"))
        token, expires = o.get("accessToken") or "", o.get("expiresAt") or 0
        if not token and os.path.exists(os.path.join(d, "token")):
            with open(os.path.join(d, "token")) as f:
                token = f.read().strip()
            row["kind"] = "token"
        row["plan"] = str(o.get("subscriptionType") or "")[:40]
        if not token:
            rows.append({**row, "http": -1})
        elif expires and expires <= time.time() * 1000:
            rows.append({**row, "http": 401})
        else:
            rows.append({**row, **read(token)})
    print(json.dumps({"active": active, "rows": rows}))


main()
