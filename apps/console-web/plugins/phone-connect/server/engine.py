"""phone-connect@1, Python port of framework/core/phone-connect.mjs (the reference engine).

Reads the registry snapshot framework/schemas/phone-connect.json (written by `axf schemas` from the engine) so tables,
limits, patterns and error codes are never copied by hand. Pure: time (`at`, ISO strings) and randomness (`random`,
a callable → [0, 1)) are injected. test.py replays framework/spec/fixtures/phone-connect.json against this module.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[5]
REG: dict[str, Any] = json.loads((ROOT / "framework/schemas/phone-connect.json").read_text())

TAG = REG["tag"]
FRAMES = REG["frames"]
HUB = REG["hub"]
PATTERNS = REG["patterns"]
CAPABILITIES = REG["capabilities"]
DEVICE_STATES = REG["deviceStates"]
PAIRING_STATES = REG["pairingStates"]
PLATFORMS = REG["platforms"]
APPS = REG["apps"]
URL_MODES = REG["urlModes"]
FROM_KINDS = REG["fromKinds"]
VIAS = REG["vias"]
POLICIES = REG["policies"]
STAGES = REG["stages"]
ACK_STATUSES = REG["ackStatuses"]
BY_KINDS = REG["byKinds"]
APPROVAL_ACTIONS = REG["approvalActions"]
NEVER_AUTO = REG["neverAuto"]
NOT_IN_ALL = REG["notInAll"]
LIMITS = REG["limits"]
COMMANDS: dict[str, dict[str, Any]] = REG["commands"]
FORBIDDEN_ARGUMENTS: dict[str, list[str]] = REG["forbiddenArguments"]
URL_SCHEMES = REG["urlSchemes"]
ALIASES: dict[str, str] = REG["aliases"]
DEPRECATED_PREFIX = REG["deprecatedPrefix"]
ERROR_CODES: dict[str, dict[str, Any]] = REG["errors"]
DATA = REG["data"]
LINK = REG["link"]

# JS RegExp → Python: `\d` is ASCII-only in JS, so match with re.ASCII.
RE = {k: re.compile(v, re.ASCII) for k, v in PATTERNS.items()}
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"


def is_obj(v: Any) -> bool:
    return isinstance(v, dict)


def blank(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not v.strip())


def _match(k: str, v: Any) -> bool:
    return isinstance(v, str) and RE[k].search(v) is not None


def sha256hex(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def ms(v: Any) -> float:
    """Date.parse for the ISO shapes PATTERNS.iso allows; NaN when it isn't one."""
    if not isinstance(v, str) or not v:
        return math.nan
    s = v[:-1] + "+00:00" if v.endswith("Z") else v
    try:
        d = datetime.fromisoformat(s)
    except ValueError:
        return math.nan
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.timestamp() * 1000


def iso(t_ms: float) -> str:
    d = datetime.fromtimestamp(t_ms / 1000, tz=timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def now_iso() -> str:
    return iso(datetime.now(timezone.utc).timestamp() * 1000)


def is_timestamp(v: Any) -> bool:
    return _match("iso", v) and not math.isnan(ms(v))


def is_uuid(v: Any) -> bool:
    return _match("uuid", v)


def is_device_id(v: Any) -> bool:
    return _match("deviceId", v)


def is_code(v: Any) -> bool:
    return _match("code", v)


def is_token(v: Any) -> bool:
    return _match("token", v)


def _int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) or (isinstance(v, float) and v.is_integer())


def _err(field: str, code: str, message: str) -> dict[str, str]:
    return {"field": field, "code": code, "message": message}


def _js(v: Any) -> str:
    """How JS template literals print a value (enough for messages)."""
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, list):
        return ",".join(_js(x) for x in v)
    if isinstance(v, dict):
        return "[object Object]"
    return str(v)


def _check_ts(out: list, o: dict, f: str, required: bool = True, or_blank: bool = True) -> None:
    v = o.get(f)
    tail = ' or ""' if or_blank else ""
    if v is None:
        if required:
            out.append(_err(f, "missing", f"{f} is missing — an ISO timestamp{tail}"))
        return
    if not isinstance(v, str) or ((not or_blank) if v == "" else not is_timestamp(v)):
        out.append(_err(f, "invalid", f'{f} "{_js(v)}" is not an ISO timestamp{tail}'))


def _check_enum(out: list, o: dict, f: str, lst: list, required: bool = True) -> None:
    if f not in o:
        if required:
            out.append(_err(f, "missing", f"{f} is missing — one of {', '.join(lst)}"))
        return
    if o[f] not in lst:
        out.append(_err(f, "invalid", f'{f} "{_js(o[f])}" is not one of {", ".join(lst)}'))


def _check_actor(out: list, o: dict, f: str, kinds: list, required: bool = True, person_only: bool = False) -> None:
    a = o.get(f)
    if a is None:
        if required:
            out.append(_err(f, "missing", f"{f} is missing — {{ kind, who }}"))
        return
    if not is_obj(a):
        out.append(_err(f, "invalid", f"{f} must be {{ kind, who }}"))
        return
    if (a.get("kind") != "person") if person_only else (a.get("kind") not in kinds):
        out.append(_err(f"{f}.kind", "invalid", f'{f}.kind must be "person"' if person_only else f"{f}.kind must be one of {', '.join(kinds)}"))
    who = a.get("who")
    if not isinstance(who, str) or not who.strip() or len(who) > LIMITS["who"]:
        out.append(_err(f"{f}.who", "missing" if blank(who) else "invalid", f"{f}.who is missing or too long"))
    if "via" in a and a["via"] not in VIAS:
        out.append(_err(f"{f}.via", "invalid", f"{f}.via must be one of {', '.join(VIAS)}"))


def _verdict(out: list) -> dict[str, Any]:
    return {"ok": not out, "errors": out}


def validate_device(d: Any) -> dict[str, Any]:
    if not is_obj(d):
        return _verdict([_err("device", "invalid", "the device must be a JSON object")])
    out: list = []
    if d.get("$axf") != FRAMES["device"]:
        out.append(_err("$axf", "missing" if "$axf" not in d else "invalid", f'$axf must be "{FRAMES["device"]}"'))
    if blank(d.get("deviceId")):
        out.append(_err("deviceId", "missing", "deviceId is missing"))
    elif not is_device_id(d["deviceId"]):
        out.append(_err("deviceId", "invalid", f"deviceId must match {PATTERNS['deviceId']}"))
    if blank(d.get("name")):
        out.append(_err("name", "missing", "name is missing (manufacturer + model)"))
    elif not isinstance(d["name"], str) or len(d["name"]) > LIMITS["name"]:
        out.append(_err("name", "invalid", f"name is longer than {LIMITS['name']}"))
    _check_enum(out, d, "app", APPS)
    if not isinstance(d.get("appVersion"), str):
        out.append(_err("appVersion", "missing", 'appVersion is missing (a string, "" if unknown)'))
    _check_enum(out, d, "platform", PLATFORMS)
    caps = d.get("capabilities")
    if not isinstance(caps, list):
        out.append(_err("capabilities", "missing", f"capabilities must be a list from {', '.join(CAPABILITIES)}"))
    elif any(c not in CAPABILITIES for c in caps) or len({json.dumps(c) for c in caps}) != len(caps):
        out.append(_err("capabilities", "invalid", f"capabilities must be distinct entries of {', '.join(CAPABILITIES)}"))
    _check_enum(out, d, "state", DEVICE_STATES)
    if "owner" not in d:
        out.append(_err("owner", "missing", 'owner is missing ("" until paired)'))
    elif d["owner"] != "":
        _check_actor(out, d, "owner", ["person"], person_only=True)
    if d.get("state") == "paired" and (d.get("owner") == "" or not is_obj(d.get("owner"))):
        out.append(_err("owner", "invalid", "a paired device has an owner (a person)"))
    if "token" not in d:
        out.append(_err("token", "missing", "token is missing (null until paired; the token at rest, never the token)"))
    elif d["token"] is not None:
        t = d["token"]
        if not is_obj(t):
            out.append(_err("token", "invalid", "token must be null or { prefix, hash, issuedAt, rotatedAt }"))
        else:
            if not RE["tokenPrefix"].search(_js(t.get("prefix", "undefined"))):
                out.append(_err("token.prefix", "invalid", "token.prefix is the first 8 characters of the token"))
            if not RE["sha256"].search(_js(t.get("hash", "undefined"))):
                out.append(_err("token.hash", "invalid", "token.hash is the SHA-256 hex of the token"))
            if is_token(t.get("hash")) or is_token(t.get("prefix")):
                out.append(_err("token", "invalid", "the token itself is never stored"))
            _check_ts(out, t, "issuedAt", or_blank=False)
            _check_ts(out, t, "rotatedAt")
    w = d.get("watch")
    if not is_obj(w) or not isinstance(w.get("on"), bool) or not isinstance(w.get("ring"), bool):
        out.append(_err("watch", "missing" if "watch" not in d else "invalid", "watch must be { on, ring } booleans"))
    up = d.get("urlPolicy")
    if not is_obj(up):
        out.append(_err("urlPolicy", "missing" if "urlPolicy" not in d else "invalid", "urlPolicy must be { mode, allowlist }"))
    else:
        _check_enum(out, up, "mode", URL_MODES)
        al = up.get("allowlist")
        if not isinstance(al, list) or len(al) > LIMITS["allowlist"] or any(not RE["host"].search(_js(h)) for h in al):
            out.append(_err("urlPolicy.allowlist", "invalid", f"urlPolicy.allowlist is a list of up to {LIMITS['allowlist']} host names"))
    for f in ("pairedAt", "lastSeenAt", "revokedAt", "updatedAt"):
        _check_ts(out, d, f)
    cs = d.get("capabilityState")
    if not is_obj(cs):
        out.append(_err("capabilityState", "missing" if "capabilityState" not in d else "invalid", "capabilityState is an object keyed by capability"))
    else:
        for k, v in cs.items():
            if not RE["capability"].search(k) or not is_obj(v):
                out.append(_err(f"capabilityState.{k}", "invalid", "capabilityState entries are objects keyed by capability"))
    if "migratedFrom" in d:
        m = d["migratedFrom"]
        if not is_obj(m) or not is_device_id(m.get("deviceId")) or not isinstance(m.get("app"), str) or not is_timestamp(m.get("at")):
            out.append(_err("migratedFrom", "invalid", "migratedFrom is { deviceId, app, at }"))
    return _verdict(out)


def validate_pairing(p: Any) -> dict[str, Any]:
    if not is_obj(p):
        return _verdict([_err("pairing", "invalid", "the pairing must be a JSON object")])
    out: list = []
    if p.get("$axf") != FRAMES["pairing"]:
        out.append(_err("$axf", "missing" if "$axf" not in p else "invalid", f'$axf must be "{FRAMES["pairing"]}"'))
    if blank(p.get("code")):
        out.append(_err("code", "missing", "code is missing"))
    elif not is_code(p["code"]):
        out.append(_err("code", "invalid", f"code must match {PATTERNS['code']}"))
    _check_ts(out, p, "issuedAt", or_blank=False)
    _check_ts(out, p, "expiresAt", or_blank=False)
    if is_timestamp(p.get("issuedAt")) and is_timestamp(p.get("expiresAt")) and ms(p["expiresAt"]) - ms(p["issuedAt"]) != HUB["pairingSeconds"] * 1000:
        out.append(_err("expiresAt", "invalid", f"expiresAt is issuedAt + {HUB['pairingSeconds']} s"))
    _check_actor(out, p, "issuedBy", FROM_KINDS)
    _check_enum(out, p, "state", PAIRING_STATES)
    if "deviceId" not in p:
        out.append(_err("deviceId", "missing", 'deviceId is missing ("" until claimed)'))
    elif p["deviceId"] != "" and not is_device_id(p["deviceId"]):
        out.append(_err("deviceId", "invalid", f"deviceId must match {PATTERNS['deviceId']}"))
    _check_ts(out, p, "claimedAt")
    if "claimedBy" not in p:
        out.append(_err("claimedBy", "missing", "claimedBy is missing (null until claimed)"))
    elif p["claimedBy"] is not None:
        _check_actor(out, p, "claimedBy", ["person"], person_only=True)
    if p.get("state") == "claimed" and (p.get("claimedBy") is None or p.get("deviceId") == "" or p.get("claimedAt") == ""):
        out.append(_err("state", "invalid", "a claimed pairing carries claimedBy (a person), deviceId and claimedAt"))
    _check_enum(out, p, "ended", ["", "claimed", "expired", "cancelled"])
    _check_ts(out, p, "endedAt")
    if p.get("state") != "pending" and p.get("ended") != p.get("state"):
        out.append(_err("ended", "invalid", "ended names the end state once the pairing is over"))
    if p.get("state") == "pending" and p.get("ended") != "":
        out.append(_err("ended", "invalid", "a pending pairing has not ended"))
    return _verdict(out)


def resolve_command(name: str) -> dict[str, str] | None:
    if name in COMMANDS:
        return {"command": name, "deprecated": ""}
    to = ALIASES.get(name)
    if not to:
        return None
    dep = f"{name} is deprecated: use phone.{to.replace('.', '_', 1)}" if name.startswith(DEPRECATED_PREFIX) else ""
    return {"command": to, "deprecated": dep}


def _lim(a: dict, k: str) -> Any:
    v = a.get(k)
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else LIMITS.get(v)


def argument_errors(command: str, args: Any) -> list[dict[str, str]]:
    c = COMMANDS.get(command)
    if not c:
        return [_err("command", "invalid", f'unknown command "{command}"')]
    if not is_obj(args):
        return [_err("arguments", "invalid", "arguments must be an object")]
    out: list = []
    forb = FORBIDDEN_ARGUMENTS.get(command, [])
    for k in forb:
        if k in args:
            out.append(_err(f"arguments.{k}", "invalid", f"{command} never carries {k}"))
    for k in args:
        if k not in c["arguments"] and k not in forb:
            out.append(_err(f"arguments.{k}", "invalid", f"{command} does not take {k}"))
    for k in c["required"]:
        if args.get(k) is None or args.get(k) == "":
            out.append(_err(f"arguments.{k}", "missing", f"{command} needs {k}"))
    for k, a in c["arguments"].items():
        if k not in args:
            continue
        v = args[k]
        f = f"arguments.{k}"
        if "enum" in a:
            if v not in a["enum"]:
                out.append(_err(f, "invalid", f"{f} must be one of {', '.join(a['enum'])}"))
        elif a.get("type") == "url":
            if not isinstance(v, str) or not v or len(v) > LIMITS["url"]:
                out.append(_err(f, "invalid", f"{f} is a url up to {LIMITS['url']} characters"))
        elif a.get("type") == "uuid":
            if not is_uuid(v):
                out.append(_err(f, "invalid", f"{f} is a uuid"))
        elif a.get("type") == "string":
            if not isinstance(v, str) or len(v) > _lim(a, "max"):
                out.append(_err(f, "invalid", f"{f} is a string up to {_lim(a, 'max')} characters"))
        elif a.get("type") == "integer":
            if not _int(v) or v < _lim(a, "min") or v > _lim(a, "max"):
                out.append(_err(f, "invalid", f"{f} is a whole number {_lim(a, 'min')}–{_lim(a, 'max')}"))
        elif a.get("type") == "list":
            if not isinstance(v, list) or any(x not in a["items"] for x in v) or len({json.dumps(x) for x in v}) != len(v):
                out.append(_err(f, "invalid", f"{f} is a list from {', '.join(a['items'])}"))
    if command == "voice" and args.get("mode") == "say" and blank(args.get("text")):
        out.append(_err("arguments.text", "missing", "voice say needs text"))
    return out


def ttl_for(command: str, args: dict | None = None) -> int:
    args = args or {}
    c = COMMANDS.get(command)
    if not c:
        return 0
    sl = args.get("secondsLeft")
    if command == "approval" and _int(sl) and sl > 0:
        return int(min(sl, LIMITS["ttlMax"]))
    if command == "voice":
        t = args.get("timeoutSeconds")
        return int(min((t if _int(t) else LIMITS["listenDefault"]) + 10, LIMITS["ttlMax"]))
    return c["ttl"]


def validate_command(c: Any) -> dict[str, Any]:
    if not is_obj(c):
        return _verdict([_err("command", "invalid", "the command must be a JSON object")])
    out: list = []
    names = ", ".join(COMMANDS)
    if c.get("$axf") != FRAMES["command"]:
        out.append(_err("$axf", "missing" if "$axf" not in c else "invalid", f'$axf must be "{FRAMES["command"]}"'))
    if blank(c.get("id")):
        out.append(_err("id", "missing", "id is missing (a uuid)"))
    elif not is_uuid(c["id"]):
        out.append(_err("id", "invalid", "id must be a uuid"))
    _check_ts(out, c, "at", or_blank=False)
    if blank(c.get("deviceId")):
        out.append(_err("deviceId", "missing", "deviceId is missing"))
    elif not is_device_id(c["deviceId"]):
        out.append(_err("deviceId", "invalid", f"deviceId must match {PATTERNS['deviceId']}"))
    known = isinstance(c.get("command"), str) and c["command"] in COMMANDS
    if blank(c.get("command")):
        out.append(_err("command", "missing", f"command is missing — one of {names}"))
    elif not known:
        out.append(_err("command", "invalid", f'command "{_js(c["command"])}" is not one of {names}'))
    if "arguments" not in c:
        out.append(_err("arguments", "missing", "arguments is missing (an object, {} when the command takes none)"))
    elif known:
        out.extend(argument_errors(c["command"], c["arguments"]))
    if "policy" not in c:
        out.append(_err("policy", "missing", "policy is missing (fixed per command)"))
    elif c["policy"] not in POLICIES:
        out.append(_err("policy", "invalid", f"policy must be one of {', '.join(POLICIES)}"))
    elif known and c["policy"] != COMMANDS[c["command"]]["policy"]:
        out.append(_err("policy", "invalid", f'{c["command"]} is always policy "{COMMANDS[c["command"]]["policy"]}"'))
    if "ttl" not in c:
        out.append(_err("ttl", "missing", "ttl is missing (seconds)"))
    elif not _int(c["ttl"]) or c["ttl"] < 1 or c["ttl"] > LIMITS["ttlMax"]:
        out.append(_err("ttl", "invalid", f"ttl is a whole number of seconds 1–{LIMITS['ttlMax']}"))
    _check_actor(out, c, "from", FROM_KINDS)
    cid = c.get("correlationId")
    if not isinstance(cid, str) or len(cid) > LIMITS["who"]:
        out.append(_err("correlationId", "missing" if "correlationId" not in c else "invalid", 'correlationId is a string ("" when none)'))
    if "approvalId" not in c:
        out.append(_err("approvalId", "missing", 'approvalId is missing ("" when none)'))
    elif c["approvalId"] != "" and not is_uuid(c["approvalId"]):
        out.append(_err("approvalId", "invalid", 'approvalId is a uuid or ""'))
    return _verdict(out)


def _error_errors(e: Any, f: str) -> list:
    if not is_obj(e):
        return [_err(f, "invalid" if e is not None else "missing", f"{f} is {{ code, message, retryable }}")]
    out: list = []
    code = e.get("code")
    known = isinstance(code, str) and code in ERROR_CODES
    if not known:
        out.append(_err(f"{f}.code", "invalid", f"{f}.code must be one of {', '.join(ERROR_CODES)}"))
    m = e.get("message")
    if not isinstance(m, str) or not m.strip():
        out.append(_err(f"{f}.message", "missing", f"{f}.message says what happened in plain words"))
    r = e.get("retryable")
    if not isinstance(r, bool):
        out.append(_err(f"{f}.retryable", "missing", f"{f}.retryable is a boolean"))
    elif known and r != ERROR_CODES[code]["retryable"]:
        out.append(_err(f"{f}.retryable", "invalid", f"{code} is {'' if ERROR_CODES[code]['retryable'] else 'not '}retryable"))
    return out


def validate_result(r: Any) -> dict[str, Any]:
    if not is_obj(r):
        return _verdict([_err("result", "invalid", "the result must be a JSON object")])
    out: list = []
    if r.get("$axf") != FRAMES["result"]:
        out.append(_err("$axf", "missing" if "$axf" not in r else "invalid", f'$axf must be "{FRAMES["result"]}"'))
    if blank(r.get("id")):
        out.append(_err("id", "missing", "id is missing (the command id)"))
    elif not is_uuid(r["id"]):
        out.append(_err("id", "invalid", "id must be the command's uuid"))
    if blank(r.get("deviceId")):
        out.append(_err("deviceId", "missing", "deviceId is missing"))
    elif not is_device_id(r["deviceId"]):
        out.append(_err("deviceId", "invalid", f"deviceId must match {PATTERNS['deviceId']}"))
    _check_enum(out, r, "command", list(COMMANDS))
    _check_ts(out, r, "at", or_blank=False)
    _check_enum(out, r, "stage", STAGES)
    if not isinstance(r.get("ok"), bool):
        out.append(_err("ok", "missing" if "ok" not in r else "invalid", "ok is a boolean"))
    if r.get("stage") == "ack":
        if "status" not in r:
            out.append(_err("status", "missing", f"an ack carries status — one of {', '.join(ACK_STATUSES)}"))
        elif r["status"] not in ACK_STATUSES:
            out.append(_err("status", "invalid", f"status must be one of {', '.join(ACK_STATUSES)}"))
        if r.get("ok") is False:
            out.append(_err("ok", "invalid", "an ack is never a failure (answer with stage done + error)"))
        if "state" in r:
            out.append(_err("state", "invalid", "an ack never changes state"))
    if r.get("stage") == "done":
        if r.get("ok") is False:
            out.extend(_error_errors(r.get("error"), "error"))
        if r.get("ok") is True and "error" in r:
            out.append(_err("error", "invalid", "a successful result carries no error"))
        if r.get("ok") is True and "data" in r and not is_obj(r["data"]):
            out.append(_err("data", "invalid", "data is an object"))
    if "by" in r:
        by = r["by"]
        if not is_obj(by) or by.get("kind") not in BY_KINDS:
            out.append(_err("by", "invalid", f"by.kind must be one of {', '.join(BY_KINDS)}"))
        elif by["kind"] == "person" and not is_uuid(by.get("tap")):
            out.append(_err("by.tap", "invalid", "by.tap is the tap's uuid when a person answered"))
    if "state" in r and r.get("stage") == "done":
        if not is_obj(r["state"]):
            out.append(_err("state", "invalid", "state is an object keyed by capability"))
        else:
            for k, v in r["state"].items():
                if not RE["capability"].search(k) or not is_obj(v):
                    out.append(_err(f"state.{k}", "invalid", "state entries are objects keyed by capability"))
    if "deprecated" in r and not isinstance(r["deprecated"], str):
        out.append(_err("deprecated", "invalid", "deprecated is a string"))
    return _verdict(out)


def rejection(errors: list) -> str:
    return "; ".join(e["message"] for e in errors)


def wire_error(code: Any, message: str = "", detail: Any = None) -> dict[str, Any]:
    c = code if isinstance(code, str) and code in ERROR_CODES else "unexpected"
    e = {"code": c, "message": message or ERROR_CODES[c]["doc"], "retryable": ERROR_CODES[c]["retryable"]}
    if detail:
        e["detail"] = detail
    return e


def make_command(command: Any = None, arguments: Any = None, deviceId: str = "", from_: Any = None, id: str = "", at: str = "",  # noqa: A002, N803
                 approvalId: str = "", correlationId: str = "", ttl: Any = None) -> dict[str, Any]:  # noqa: N803
    args = {} if arguments is None else arguments
    r = resolve_command(str(command if command is not None else ""))
    if not r:
        return {"ok": False, "error": wire_error("not_found", f'unknown command "{_js(command)}"', {"command": command})}
    c = COMMANDS[r["command"]]
    filled: dict[str, Any] = {}
    for k, a in c["arguments"].items():
        if "default" in a and (args if is_obj(args) else {}).get(k) is None:
            dv = a["default"]
            filled[k] = list(dv) if isinstance(dv, list) else (LIMITS[dv] if isinstance(dv, str) and a.get("type") == "integer" else dv)
    real = args if is_obj(args) else {}
    env = {"$axf": FRAMES["command"], "id": id, "at": at, "deviceId": deviceId, "command": r["command"], "arguments": {**filled, **real},
           "policy": c["policy"], "ttl": ttl if _int(ttl) else ttl_for(r["command"], real), "from": from_,
           "correlationId": correlationId, "approvalId": approvalId}
    v = validate_command(env)
    if not v["ok"]:
        return {"ok": False, "error": wire_error("validation", rejection(v["errors"]), {"fields": [e["field"] for e in v["errors"]]})}
    return {"ok": True, "command": env, "deprecated": r["deprecated"]}


def to_wire(command: dict) -> dict[str, Any]:
    w = COMMANDS[command["command"]]["wire"]
    tool = w if isinstance(w, str) else w[command["arguments"]["mode"]]
    return {"protocol": LINK["protocol"], "kind": "call", "id": command["id"], "payload": {"tool": tool, "arguments": dict(command["arguments"])}}


def from_wire(msg: Any, command: dict, at: str = "") -> dict[str, Any]:
    base = {"$axf": FRAMES["result"], "id": command["id"], "deviceId": command["deviceId"], "command": command["command"],
            "at": at or (msg.get("at") if is_obj(msg) else None)}
    if not is_obj(msg) or msg.get("protocol") != LINK["protocol"] or msg.get("correlationId") != command["id"]:
        return {**base, "stage": "done", "ok": False, "error": wire_error("invalid", "the reply is not an axpp@1 message for this command")}
    mb = msg.get("by")
    by = {"kind": "person", "tap": mb.get("tap")} if is_obj(mb) and mb.get("kind") == "person" else {"kind": "device"}
    kind = msg.get("kind")
    if kind == "ack":
        return {**base, "stage": "ack", "ok": True, "status": msg.get("status") if msg.get("status") in ACK_STATUSES else "queued", "by": by}
    if kind == "result":
        out = {**base, "stage": "done", "ok": True, "data": msg["payload"] if is_obj(msg.get("payload")) else {}, "by": by}
        if is_obj(msg.get("state")):
            out["state"] = msg["state"]
        return out
    if kind == "error":
        e = msg.get("error") if is_obj(msg.get("error")) else {}
        return {**base, "stage": "done", "ok": False, "error": wire_error(e.get("code"), e.get("message") or "", e.get("detail")), "by": by}
    return {**base, "stage": "done", "ok": False, "error": wire_error("invalid", f'unknown reply kind "{_js(kind)}"')}


def is_online(device: Any, at: str) -> bool:
    if not is_obj(device) or device.get("state") != "paired" or not is_timestamp(device.get("lastSeenAt")):
        return False
    d = ms(at) - ms(device["lastSeenAt"])
    return 0 <= d <= HUB["onlineSeconds"] * 1000


def _round(x: float) -> int:
    return math.floor(x + 0.5)  # JS Math.round


def ago(frm: str, to: str) -> str:
    s = max(0, _round((ms(to) - ms(frm)) / 1000))
    if s < 60:
        return f"{s} s ago"
    m = _round(s / 60)
    if m < 60:
        return f"{m} min ago"
    h = _round(m / 60)
    if h < 48:
        return f"{h} h ago"
    return f"{_round(h / 24)} days ago"


def presence(device: Any, at: str) -> str:
    if not is_obj(device) or device.get("state") in ("unpaired", "pending"):
        return "not paired"
    if device.get("state") == "revoked":
        return "revoked"
    if is_online(device, at):
        return "online"
    return f"offline: last seen {ago(device['lastSeenAt'], at)}" if is_timestamp(device.get("lastSeenAt")) else "offline: never seen"


def _host(url: str) -> tuple[str, str, bool]:
    """(scheme with colon, host[:port] lowercased, has user info) like WHATWG URL for the shapes we accept."""
    u = urlsplit(url)
    if not u.scheme:
        raise ValueError("no scheme")
    scheme = u.scheme.lower() + ":"
    if scheme not in ("http:", "https:", "ftp:", "ws:", "wss:"):
        return scheme, "", False
    host = (u.hostname or "").lower()
    if not host:
        raise ValueError("no host")
    port = u.port
    default = {"http:": 80, "https:": 443, "ws:": 80, "wss:": 443, "ftp:": 21}[scheme]
    return scheme, host + (f":{port}" if port and port != default else ""), bool(u.username or u.password)


def url_errors(url: Any, device: Any, origin: str) -> dict[str, Any] | None:
    if not isinstance(url, str) or not url or len(url) > LIMITS["url"]:
        return wire_error("validation", f"url is a string up to {LIMITS['url']} characters")
    try:
        scheme, host, userinfo = _host(url)
    except ValueError:
        return wire_error("validation", f'"{url[:80]}" is not a url')
    if scheme not in URL_SCHEMES:
        return wire_error("denied", f"{scheme} links never open on the phone (https only)", {"scheme": scheme})
    if userinfo:
        return wire_error("denied", "a link with user info never opens on the phone")
    up = device.get("urlPolicy") if is_obj(device) and is_obj(device.get("urlPolicy")) else {}
    mode = up.get("mode") or "own"
    if mode == "any":
        return None
    try:
        own = _host(origin)[1]
    except (ValueError, KeyError):
        own = ""
    allowed = [own] if mode == "own" else [own, *(up.get("allowlist") or [])]
    if host not in allowed:
        return wire_error("denied", f"{host} is outside this phone's url policy ({mode})", {"host": host, "mode": mode})
    return None


def dispatch_errors(command: Any, device: Any, at: str, origin: str = "") -> dict[str, Any] | None:
    if not is_obj(command) or command.get("command") not in COMMANDS:
        return wire_error("not_found", f'unknown command "{_js(command.get("command") if is_obj(command) else None)}"')
    v = validate_command(command)
    if not v["ok"]:
        return wire_error("validation", rejection(v["errors"]), {"fields": [e["field"] for e in v["errors"]]})
    if not is_obj(device) or device.get("state") == "revoked":
        return wire_error("revoked", f"{(device or {}).get('name') or 'this phone'} was revoked; pair it again")
    if device.get("state") != "paired":
        return wire_error("unpaired", "no phone is paired: open Settings → Plugins → Phone Connect for a code")
    if command["deviceId"] != device.get("deviceId"):
        return wire_error("not_found", f"no device {command['deviceId']}")
    spec = COMMANDS[command["command"]]
    cap = spec["capability"]
    if cap not in (device.get("capabilities") or []):
        return wire_error("not_found", f"{device.get('name')} cannot {command['command']} ({cap}): install the current app", {"capability": cap})
    if spec["policy"] == "confirm" and not command.get("approvalId"):
        return wire_error("confirmation_required", f"{command['command']} needs Brett's confirm first")
    if command["arguments"].get("url"):
        e = url_errors(command["arguments"]["url"], device, origin)
        if e:
            return e
    if not is_online(device, at):
        p = presence(device, at)
        return wire_error("offline", f"{device.get('name')} is offline: {re.sub(r'^offline: ', '', p)}. Open the app or switch the watch on.")
    if ms(at) > ms(command["at"]) + command["ttl"] * 1000:
        return wire_error("timeout", f"{command['command']} expired before it was sent (ttl {command['ttl']} s)")
    return None


def decision_errors(result: Any, command: Any, auth: Any) -> dict[str, Any] | None:
    data = result.get("data") if is_obj(result) else None
    decision = data.get("decision") if is_obj(data) else None
    if decision is None:
        return None
    if not is_obj(command) or command.get("command") != "approval" or result.get("command") != "approval":
        return wire_error("denied", "only an approval prompt carries a decision")
    if result.get("stage") != "done" or result.get("ok") is not True:
        return wire_error("denied", "a decision comes with a finished result")
    by = result.get("by")
    if not is_obj(by) or by.get("kind") != "person" or not is_uuid(by.get("tap")):
        return wire_error("denied", "an approval is decided only by Brett's own tap on the phone")
    if not is_obj(auth) or auth.get("kind") != "device":
        return wire_error("denied", f"a decision over {(auth.get('kind') if is_obj(auth) else None) or 'no'} credentials is dropped: only the paired phone's token carries one")
    actions = command["arguments"].get("actions") or ["approve", "deny"]
    if decision not in actions:
        return wire_error("denied", f'"{_js(decision)}" is not one of this prompt\'s actions ({", ".join(actions)})')
    return None


def auto_approvable(tool: str, all: bool = False) -> bool:  # noqa: A002
    if tool in NEVER_AUTO:
        return False
    return not (all and tool in NOT_IN_ALL)


# ---- pairing, tokens, device lifecycle

def _pick(alphabet: str, n: int, random: Callable[[], float]) -> str:
    return "".join(alphabet[math.floor(random() * len(alphabet)) % len(alphabet)] for _ in range(n))


def make_code(random: Callable[[], float]) -> str:
    return _pick(CODE_ALPHABET, HUB["codeLength"], random)


def make_token(random: Callable[[], float]) -> str:
    return "tok_" + _pick(TOKEN_ALPHABET, 32, random)


def token_at_rest(token: str, at: str, rotated_at: str = "") -> dict[str, str]:
    return {"prefix": token[: HUB["tokenPrefixChars"]], "hash": sha256hex(token), "issuedAt": at, "rotatedAt": rotated_at}


def issue_pairing(at: str, by: dict, random: Callable[[], float]) -> dict[str, Any]:
    return {"$axf": FRAMES["pairing"], "code": make_code(random), "issuedAt": at, "expiresAt": iso(ms(at) + HUB["pairingSeconds"] * 1000),
            "issuedBy": by, "state": "pending", "deviceId": "", "claimedAt": "", "claimedBy": None, "ended": "", "endedAt": ""}


def expire_pairing(p: dict, at: str) -> dict:
    return {**p, "state": "expired", "ended": "expired", "endedAt": at} if p.get("state") == "pending" else p


def cancel_pairing(p: dict, at: str) -> dict:
    return {**p, "state": "cancelled", "ended": "cancelled", "endedAt": at} if p.get("state") == "pending" else p


def pairing_expired(p: dict, at: str) -> bool:
    return ms(at) >= ms(p.get("expiresAt"))


def new_device(hello: Any, at: str) -> dict[str, Any]:
    d = hello.get("device") if is_obj(hello) and is_obj(hello.get("device")) else {}
    caps = list(dict.fromkeys(d["capabilities"])) if isinstance(d.get("capabilities"), list) else []
    return {"$axf": FRAMES["device"], "deviceId": d.get("deviceId"), "name": str(d.get("name") if d.get("name") is not None else "")[: LIMITS["name"]],
            "app": d.get("app"), "appVersion": str(d.get("appVersion") if d.get("appVersion") is not None else ""), "platform": d.get("platform") or "android",
            "capabilities": caps, "state": "unpaired", "owner": "", "token": None, "watch": {"on": False, "ring": True},
            "urlPolicy": {"mode": "own", "allowlist": []}, "pairedAt": "", "lastSeenAt": "", "revokedAt": "", "updatedAt": at,
            "capabilityState": d["capabilityState"] if is_obj(d.get("capabilityState")) else {}}


def claim_pairing(pairing: Any, hello: Any, at: str, random: Callable[[], float], device: Any = None) -> dict[str, Any]:
    if not is_obj(hello) or not is_obj(hello.get("device")):
        return {"ok": False, "error": wire_error("validation", "hello carries { code, device, person }")}
    if not is_obj(pairing) or pairing.get("state") != "pending" or not is_code(hello.get("code")) or hello["code"] != pairing.get("code"):
        return {"ok": False, "error": wire_error("denied", "wrong or unknown pairing code")}
    if pairing_expired(pairing, at):
        return {"ok": False, "error": wire_error("expired", f"the code is past its {HUB['pairingSeconds'] // 60} minutes: the console shows a new one")}
    person = hello.get("person")
    if not is_obj(person) or person.get("kind") != "person" or blank(person.get("who")):
        return {"ok": False, "error": wire_error("denied", "a pairing is claimed only by Brett's own signed-in session on the phone, never a session, agent, service or token")}
    base = device if is_obj(device) and device.get("deviceId") == hello["device"].get("deviceId") else new_device(hello, at)
    token = make_token(random)
    dev = {**base, **new_device(hello, at), "state": "paired", "owner": {"kind": "person", "who": person["who"]}, "token": token_at_rest(token, at),
           "watch": base["watch"], "urlPolicy": base["urlPolicy"], "pairedAt": at, "lastSeenAt": at, "revokedAt": "", "updatedAt": at}
    if base.get("migratedFrom"):
        dev["migratedFrom"] = base["migratedFrom"]
    v = validate_device(dev)
    if not v["ok"]:
        return {"ok": False, "error": wire_error("validation", rejection(v["errors"]), {"fields": [e["field"] for e in v["errors"]]})}
    claimed = {**pairing, "state": "claimed", "deviceId": dev["deviceId"], "claimedAt": at, "claimedBy": {"kind": "person", "who": person["who"]}, "ended": "claimed", "endedAt": at}
    return {"ok": True, "pairing": claimed, "device": dev, "token": token}


def verify_token(device: Any, token: Any) -> dict[str, Any] | None:
    if not is_obj(device):
        return wire_error("unpaired", "no phone is paired")
    if device.get("state") == "revoked":
        return wire_error("revoked", f"{device.get('name')} was revoked; pair it again")
    if device.get("state") != "paired" or not device.get("token"):
        return wire_error("unpaired", f"{device.get('name')} is not paired: open the console for a code")
    import hmac
    if not is_token(token) or not hmac.compare_digest(sha256hex(token), device["token"]["hash"]):
        return wire_error("denied", "bad device token")
    return None


def revoke_device(device: Any, by: Any, at: str) -> dict[str, Any]:
    if not is_obj(by) or by.get("kind") != "person":
        return {"ok": False, "error": wire_error("denied", "only the owner revokes a phone (a person's confirm, never a session)")}
    if not is_obj(device) or device.get("state") != "paired":
        return {"ok": False, "error": wire_error("unpaired", "nothing to revoke: no phone is paired")}
    return {"ok": True, "device": {**device, "state": "revoked", "token": None, "revokedAt": at, "updatedAt": at}}


def rotate_token(device: Any, token: Any, at: str, random: Callable[[], float]) -> dict[str, Any]:
    e = verify_token(device, token)
    if e:
        return {"ok": False, "error": e}
    fresh = make_token(random)
    return {"ok": True, "token": fresh, "device": {**device, "token": token_at_rest(fresh, device["token"]["issuedAt"], at), "updatedAt": at}}


def seen(device: dict, at: str, capability_state: Any = None) -> dict:
    out = {**device, "lastSeenAt": at, "updatedAt": at}
    if is_obj(capability_state):
        out["capabilityState"] = {**(device.get("capabilityState") or {}), **capability_state}
    return out


def migrate_device(old: Any, at: str) -> dict[str, Any]:
    o = old if is_obj(old) else {}
    did = o["deviceId"] if is_device_id(o.get("deviceId")) else "amberx-" + sha256hex(_js(o.get("deviceId") if o.get("deviceId") is not None else (o.get("name") if o.get("name") is not None else "")))[:16]
    return {"$axf": FRAMES["device"], "deviceId": did, "name": str(o.get("name") if o.get("name") is not None else "AmberX phone")[: LIMITS["name"]],
            "app": "amberx-droid", "appVersion": str(o.get("appVersion") if o.get("appVersion") is not None else ""), "platform": "android",
            "capabilities": ["open-url@1", "notify@1", "approvals@1", "recorder@1"], "state": "paired",
            "owner": {"kind": "person", "who": str(o.get("owner") if o.get("owner") is not None else "brett")}, "token": None,
            "watch": {"on": bool(o.get("watch")), "ring": o.get("ring") is not False}, "urlPolicy": {"mode": "own", "allowlist": []},
            "pairedAt": at, "lastSeenAt": "", "revokedAt": "", "updatedAt": at, "capabilityState": {},
            "migratedFrom": {"deviceId": str(o.get("deviceId") if o.get("deviceId") is not None else ""), "app": "amberx-droid", "at": at}}


def hello_errors(device: Any) -> dict[str, Any] | None:
    if is_obj(device) and device.get("state") == "paired" and not device.get("token"):
        return wire_error("unpaired", "this phone moved from AmberX: pair it once with the code the console shows", {"reason": "pair"})
    return None
