"""Self-test for axf.anthropic_keys: classification of every Anthropic key prefix and the live check, with fake keys and a
fake transport only (nothing reaches Anthropic). Run: python framework/python/axf/test_anthropic_keys.py"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from axf import anthropic_keys as ak  # noqa: E402

ok = 0


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


print("anthropic_keys self-test")
F = "x" * 40  # fake key body
CASES = [
    ("sk-ant-api03-" + F, "anthropic", True),
    ("sk-ant-api04-" + F, "anthropic", True),
    ("sk-ant-usr01-" + F, "anthropic", True),
    ("sk-ant-usr" + F, "anthropic", True),
    ("sk-ant-zzz99-" + F, "anthropic", False),  # a prefix nobody has seen yet: accepted as an API key, verified live
    ("sk-ant-oat01-" + F, "claude-code", True),
    ("sk-ant-ort01-" + F, "refresh", True),
    ("sk-ant-admin01-" + F, "admin", True),
    ("sk-ant-sid01-" + F, "session", True),
]
for key, kind, known in CASES:
    c = ak.classify(key)
    check(c["kind"] == kind and c["known"] is known and c["wellFormed"], f"{key[:13]}… → {kind}{'' if known else ' (unknown prefix fallback)'}")
check(ak.is_api_key("sk-ant-usr01-" + F) and ak.is_api_key("sk-ant-api03-" + F), "sk-ant-usr and sk-ant-api03 are both API keys")
check(not ak.is_api_key("sk-ant-oat01-" + F) and ak.is_subscription("sk-ant-oat01-" + F), "sk-ant-oat stays a subscription login, not an API key")
check(ak.kind_of("hello") == "" and ak.kind_of("sk-proj-" + F) == "", "not an Anthropic key")
check(ak.kind_of("sk-ant-usr01-abc") == "", "a cut-off key is not well formed")
check(ak.kind_of(" sk-ant-usr01-" + "y" * 20 + "\n" + "y" * 20 + " ") == "anthropic", "pasted whitespace and line breaks are ignored")
check(ak.refusal("sk-ant-usr01-" + F) == "", "no refusal for a new-format API key")
check(ak.refusal("sk-ant-zzz99-" + F) == "", "no refusal for an unknown sk-ant- API format")
check("subscription" in ak.refusal("sk-ant-oat01-" + F), "subscription token where an API key is wanted: says so")
check("Admin" in ak.refusal("sk-ant-admin01-" + F), "admin key: refused with a plain reason")
check("cut off" in ak.refusal("sk-ant-usr01-abc"), "cut-off key: says copy it again")
check(ak.refusal("sk-ant-oat01-" + F, "claude-code") == "", "subscription wanted, subscription given")
check(ak.mask("sk-ant-usr01-" + "y" * 36 + "WXYZ") == "…WXYZ", "mask = last 4 only")
secret = "sk-ant-usr01-" + "Q" * 40
check(secret not in ak.scrub(f"bad key {secret} and sk-ant-api03-{'R' * 30}") and "…QQQQ" in ak.scrub(f"k={secret}"), "scrub hides every key")

# ---- live check against a fake transport
calls: list[tuple] = []


def fake(script):
    def send(method, url, headers, body):
        calls.append((method, url, headers, body))
        st, j = script[0] if method == "GET" else script[1]
        if isinstance(st, Exception):
            raise st
        return st, j
    return send


MODELS = (200, {"data": [{"id": "claude-opus-x"}, {"id": "claude-haiku-x"}]})
KEY = "sk-ant-usr01-" + "k" * 40
calls.clear()
r = ak.live_check(KEY, fake([MODELS, (200, {"content": []})]))
check(r["ok"] and r["status"] == "ok" and r["models"] == 2, "live: models listed + 1-token turn → OK")
check(calls[0][1].endswith("/v1/models?limit=100") and calls[0][2]["x-api-key"] == KEY and "authorization" not in calls[0][2], "live: models list sent with x-api-key")
check(len(calls) == 2 and calls[1][3]["model"] == "claude-haiku-x" and calls[1][3]["max_tokens"] == 1, "live: credit checked with a 1-token turn on the cheapest model")
r = ak.live_check(KEY, fake([(401, {"error": {"message": f"invalid x-api-key {KEY}"}}), None]))
check(not r["ok"] and r["status"] == "invalid" and KEY not in json.dumps(r), "live: 401 → invalid, key not echoed")
r = ak.live_check(KEY, fake([MODELS, (400, {"error": {"message": "Your credit balance is too low to access the Anthropic API."}})]))
check(not r["ok"] and r["status"] == "no-credit", "live: credit balance too low → no credit")
r = ak.live_check(KEY, fake([(402, {"error": {"message": "payment required"}}), None]))
check(r["status"] == "no-credit", "live: 402 on models → no credit")
r = ak.live_check(KEY, fake([(OSError(f"connection refused for {KEY}"), None), None]))
check(not r["ok"] and r["status"] == "error" and KEY not in r["error"], "live: network failure → error, key scrubbed")
r = ak.live_check(KEY, fake([MODELS, (429, {"error": {"message": "rate limited"}})]))
check(r["ok"] and r["status"] == "ok", "live: rate limited on the turn still counts as a working key")
print(f"all {ok} checks passed")
