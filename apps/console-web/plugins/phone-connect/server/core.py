"""phone-connect@1 rules for the console server: a straight port of framework/core/phone-connect.mjs (the reference).

Only the parts the console needs: device records, pairing, presence, commands, open_url and auto-approval. The
golden fixture framework/spec/fixtures/phone-connect.json is replayed against this port by test.py, so the two can't
drift. Pure: no I/O, `at` is always passed in.
"""
from __future__ import annotations

import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlsplit

DEVICE_FRAME = "phone-device@1"
PAIRING_FRAME = "phone-pairing@1"
COMMAND_FRAME = "phone-command@1"
RESULT_FRAME = "phone-result@1"
APP = "phone-connect-droid"
LEGACY_APP = "amberx-droid"
PLATFORMS = ("android",)
CAPABILITIES = ("open-url@1", "notify@1", "approvals@1", "recorder@1")
PAIRING_STATES = ("unpaired", "pending", "paired", "revoked")
TRANSITIONS = {
    "unpaired": {"issue": "pending"},
    "pending": {"confirm": "paired", "expire": "unpaired", "cancel": "unpaired"},
    "paired": {"revoke": "revoked"},
    "revoked": {"issue": "pending", "forget": "unpaired"},
}
TOOLS = ("phone.open_url", "phone.notify", "phone.approvals_watch", "phone.recorder_start", "phone.recorder_stop", "phone.recorder_status")
TOOL_CAPABILITY = {
    "phone.open_url": "open-url@1", "phone.notify": "notify@1", "phone.approvals_watch": "approvals@1",
    "phone.recorder_start": "recorder@1", "phone.recorder_stop": "recorder@1", "phone.recorder_status": "recorder@1",
}
TOOL_POLICY = {
    "phone.open_url": "allow", "phone.notify": "allow", "phone.approvals_watch": "allow",
    "phone.recorder_start": "confirm", "phone.recorder_stop": "allow", "phone.recorder_status": "allow",
}
TOOL_ARGS = {
    "phone.open_url": ["url", "where", "browser"], "phone.notify": ["title", "body", "url", "channel", "priority"],
    "phone.approvals_watch": ["on", "ring"], "phone.recorder_start": ["session_name", "group", "note", "mic"],
    "phone.recorder_stop": [], "phone.recorder_status": [],
}
NEVER_AUTO = ("phone.recorder_start",)
NOT_IN_ALL = ("vps.run",)
ALIASES = {
    "amberx.open_url": "phone.open_url", "amberx.recorder_start": "phone.recorder_start",
    "amberx.recorder_stop": "phone.recorder_stop", "amberx.recorder_status": "phone.recorder_status",
}
VIAS = ("console", "mcp", "cli", "voice", "hub")
URL_POLICIES = ("own", "allowlist", "any")
OWN_DOMAINS = ("amberxai.com",)
URL_SCHEMES = ("https", "http")
OPEN_WHERE = ("overlay", "browser")
BROWSERS = ("chrome", "default")
NOTIFY_CHANNELS = ("alerts", "approvals", "console", "recorder")
NOTIFY_PRIORITIES = ("normal", "high")
ERROR_CODES = ("invalid", "denied", "not_found", "unavailable", "validation", "unexpected", "timeout", "confirmation_required", "offline", "unpaired", "revoked", "consent_required")
RETRYABLE = ("unavailable", "timeout", "offline", "consent_required")
ONLINE_SECONDS = 45
PAIRING_TTL_MINUTES = 10
NAME_MAX, TEXT_MAX, TITLE_MAX, URL_MAX, SESSION_NAME_MAX, CAPABILITIES_MAX = 80, 600, 120, 2000, 120, 16

DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
CODE_RE = re.compile(r"^[A-HJ-NP-Z2-9]{8}$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
HOST_RE = re.compile(r"^[a-z0-9-]+(\.[a-z0-9-]+)*$")
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class PhoneError(Exception):
    """A phone-connect@1 wire error: code (ERROR_CODES), message, retryable."""

    def __init__(self, code: str, message: str, **extra: Any):
        super().__init__(message)
        self.code = code if code in ERROR_CODES else "unexpected"
        self.message = _s(message, TEXT_MAX)
        self.extra = extra

    def as_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "retryable": self.code in RETRYABLE, **self.extra}


def _s(v: Any, n: int = 300) -> str:
    return v.strip()[:n] if isinstance(v, str) else ""


def _parse(v: Any) -> datetime | None:
    if not isinstance(v, str) or not v:
        return None
    try:
        d = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _iso(v: Any) -> str:
    return v if _parse(v) else ""


def iso_at(d: datetime) -> str:
    return d.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def now_iso() -> str:
    return iso_at(datetime.now(timezone.utc))


def new_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))


# ------------------------------------------------------------------ device record

def norm_device(d: Any, at: str = "") -> dict[str, Any]:
    x = d if isinstance(d, dict) else {}
    caps: list[str] = []
    for c in x.get("capabilities") or []:
        if c in CAPABILITIES and c not in caps:
            caps.append(c)
    cap_state = {k: v for k, v in (x.get("capabilityState") or {}).items() if k in caps and isinstance(v, dict)} if isinstance(x.get("capabilityState"), dict) else {}
    state = x.get("state") if x.get("state") in PAIRING_STATES else "unpaired"
    out = {
        "$axf": DEVICE_FRAME, "deviceId": x["deviceId"] if DEVICE_ID_RE.match(str(x.get("deviceId") or "")) else "",
        "name": _s(x.get("name"), NAME_MAX), "app": LEGACY_APP if x.get("app") == LEGACY_APP else APP,
        "appVersion": _s(x.get("appVersion"), 40), "platform": x.get("platform") if x.get("platform") in PLATFORMS else "android",
        "capabilities": caps[:CAPABILITIES_MAX], "state": state, "owner": _s(x.get("owner"), NAME_MAX),
        "pairedAt": _iso(x.get("pairedAt")), "lastSeenAt": _iso(x.get("lastSeenAt")), "revokedAt": _iso(x.get("revokedAt")),
        "capabilityState": cap_state, "updatedAt": _iso(x.get("updatedAt")) or _iso(at),
    }
    if state != "paired" and state != "revoked":
        out["pairedAt"] = ""
    if state != "revoked":
        out["revokedAt"] = ""
    mf = x.get("migratedFrom")
    if isinstance(mf, dict):
        out["migratedFrom"] = {"deviceId": _s(mf.get("deviceId"), 64), "app": _s(mf.get("app"), 40), "at": _iso(mf.get("at"))}
    if x.get("note"):
        out["note"] = _s(x.get("note"), TEXT_MAX)
    return out


def device_errors(d: Any, path: str = "device") -> list[str]:
    out: list[str] = []
    x = d if isinstance(d, dict) else {}
    if x.get("$axf") != DEVICE_FRAME:
        out.append(f"{path}.$axf is {DEVICE_FRAME}")
    if not DEVICE_ID_RE.match(str(x.get("deviceId") or "")):
        out.append(f"{path}.deviceId matches ^[A-Za-z0-9_-]{{8,64}}$")
    if not isinstance(x.get("name"), str) or len(x.get("name") or "") > NAME_MAX:
        out.append(f"{path}.name is text up to {NAME_MAX} characters")
    if x.get("state") not in PAIRING_STATES:
        out.append(f"{path}.state is one of {', '.join(PAIRING_STATES)}")
    if x.get("state") == "paired" and not _iso(x.get("pairedAt")):
        out.append(f"{path}.pairedAt is an ISO date-time when paired")
    if x.get("state") == "paired" and not x.get("owner"):
        out.append(f"{path}.owner names who paired it")
    return out


def is_online(device: dict[str, Any], at: str) -> bool:
    seen_at, now = _parse(device.get("lastSeenAt")), _parse(at)
    if device.get("state") != "paired" or not seen_at or not now:
        return False
    gap = (now - seen_at).total_seconds()
    return 0 <= gap <= ONLINE_SECONDS


def presence(device: dict[str, Any], at: str) -> str:
    if device.get("state") == "revoked":
        return "revoked"
    if device.get("state") != "paired":
        return "not paired"
    if is_online(device, at):
        return "online"
    seen_at, now = _parse(device.get("lastSeenAt")), _parse(at)
    if not seen_at or not now:
        return "offline: never seen"
    m = max(0, int((now - seen_at).total_seconds() // 60))
    if m < 1:
        return "offline: last seen under a minute ago"
    if m < 60:
        return f"offline: last seen {m} min ago"
    if m < 1440:
        return f"offline: last seen {m // 60} h ago"
    return f"offline: last seen {m // 1440} d ago"


def transition(state: str, event: str) -> str | None:
    return TRANSITIONS.get(state, {}).get(event)


# ------------------------------------------------------------------ pairing

def issue_pairing(code: str, at: str, by: str, device_id: str = "") -> dict[str, Any]:
    issued = _parse(at)
    return {
        "$axf": PAIRING_FRAME, "code": code if CODE_RE.match(str(code or "")) else "", "state": "pending",
        "issuedAt": _iso(at), "expiresAt": iso_at(issued + timedelta(minutes=PAIRING_TTL_MINUTES)) if issued else "",
        "by": _s(by, NAME_MAX), "deviceId": device_id if DEVICE_ID_RE.match(str(device_id or "")) else "", "endedAt": "", "ended": "",
    }


def pairing_expired(p: dict[str, Any], at: str) -> bool:
    exp, now = _parse(p.get("expiresAt")), _parse(at)
    return bool(exp and now and now > exp)


def device_from_hello(h: dict[str, Any], at: str) -> dict[str, Any]:
    return norm_device({"deviceId": h.get("deviceId"), "name": h.get("name"), "app": h.get("app"), "appVersion": h.get("appVersion"),
                        "platform": "android", "capabilities": h.get("capabilities"), "capabilityState": h.get("state"),
                        "state": "unpaired", "lastSeenAt": _iso(at)}, at)


def confirm_pairing(p: dict[str, Any], hello: dict[str, Any], at: str, owner: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """The phone's claim with a code. Returns (device, pairing) or raises PhoneError; nothing changes on an error."""
    if p.get("state") != "pending":
        raise PhoneError("not_found", "No pairing is waiting. Start one on the console.")
    if pairing_expired(p, at):
        raise PhoneError("timeout", f"The pairing code expired after {PAIRING_TTL_MINUTES} minutes. Start a new one on the console.")
    code = str(hello.get("code") or "").upper()
    if not CODE_RE.match(code) or code != p.get("code"):
        raise PhoneError("denied", "That pairing code is not the one waiting.")
    device = norm_device({**device_from_hello(hello, at), "state": "paired", "owner": owner, "pairedAt": _iso(at), "lastSeenAt": _iso(at)}, at)
    errs = device_errors(device)
    if errs:
        raise PhoneError("invalid", f"The phone's hello is not a device record: {errs[0]}.")
    if p.get("deviceId") and p["deviceId"] != device["deviceId"]:
        raise PhoneError("denied", "This pairing was started for another phone.")
    return device, {**p, "state": "paired", "deviceId": device["deviceId"], "endedAt": _iso(at), "ended": "confirm"}


def end_pairing(p: dict[str, Any], ended: str, at: str) -> dict[str, Any]:
    if p.get("state") != "pending" or ended not in ("expire", "cancel"):
        return p
    return {**p, "state": "unpaired", "endedAt": _iso(at), "ended": ended}


def seen(device: dict[str, Any], payload: dict[str, Any], at: str) -> dict[str, Any]:
    d = norm_device(device, at)
    if d["state"] == "revoked":
        raise PhoneError("revoked", "This phone was revoked. Pair it again from the console.")
    if d["state"] != "paired":
        raise PhoneError("unpaired", "This phone is not paired. Pair it from the console.")
    caps = [c for c in payload.get("capabilities") or [] if c in CAPABILITIES]
    state = payload.get("state") if isinstance(payload.get("state"), dict) else {}
    return norm_device({**d, "name": payload.get("name") or d["name"], "appVersion": payload.get("appVersion") or d["appVersion"],
                        "capabilities": caps or d["capabilities"], "capabilityState": {**d["capabilityState"], **state},
                        "lastSeenAt": _iso(at), "updatedAt": _iso(at)}, at)


def revoke(device: dict[str, Any], at: str, by: str, why: str = "") -> dict[str, Any]:
    d = norm_device(device, at)
    if transition(d["state"], "revoke") != "revoked":
        raise PhoneError("invalid", f"A {d['state']} phone cannot be revoked.")
    note = f"Revoked by {by}: {why}" if why else f"Revoked by {by}."
    return norm_device({**d, "state": "revoked", "revokedAt": _iso(at), "updatedAt": _iso(at), "note": note}, at)


# ------------------------------------------------------------------ commands

def resolve_tool(name: Any) -> dict[str, Any]:
    n = _s(name, 80)
    if n in TOOLS:
        return {"tool": n, "deprecated": False, "alias": ""}
    if n in ALIASES:
        return {"tool": ALIASES[n], "deprecated": True, "alias": n}
    return {"tool": "", "deprecated": False, "alias": ""}


def auto_approves(approve_all: bool, list_on: bool, allowed: str, tool: str) -> bool:
    t = resolve_tool(tool)["tool"] or _s(tool, 80)
    if t in NEVER_AUTO:
        return False
    if approve_all and t not in NOT_IN_ALL:
        return True
    if not list_on:
        return False
    items = [s for s in re.split(r"[,\s]+", str(allowed or "")) if s]
    return any(p == t or p == "*" or (p.endswith(".*") and t.startswith(p[:-1])) for p in items)


def args_errors(tool: str, args: Any, path: str = "arguments") -> list[str]:
    a = args if isinstance(args, dict) else {}
    t = resolve_tool(tool)["tool"]
    if not t:
        return [f"tool is one of {', '.join(TOOLS)}"]
    out = [f"{path}.{k} is not an argument of {t}" for k in a if k not in TOOL_ARGS[t]]
    if t == "phone.open_url":
        url = a.get("url")
        if not isinstance(url, str) or not url.strip():
            out.append(f"{path}.url is required")
        elif len(url) > URL_MAX:
            out.append(f"{path}.url is at most {URL_MAX} characters")
        if "where" in a and a["where"] not in OPEN_WHERE:
            out.append(f"{path}.where is one of {', '.join(OPEN_WHERE)}")
        if "browser" in a and a["browser"] not in BROWSERS:
            out.append(f"{path}.browser is one of {', '.join(BROWSERS)}")
    elif t == "phone.notify":
        title = a.get("title")
        if not isinstance(title, str) or not title.strip():
            out.append(f"{path}.title is required")
        elif len(title) > TITLE_MAX:
            out.append(f"{path}.title is at most {TITLE_MAX} characters")
        if "body" in a and (not isinstance(a["body"], str) or len(a["body"]) > TEXT_MAX):
            out.append(f"{path}.body is text up to {TEXT_MAX} characters")
        if "channel" in a and a["channel"] not in NOTIFY_CHANNELS:
            out.append(f"{path}.channel is one of {', '.join(NOTIFY_CHANNELS)}")
        if "priority" in a and a["priority"] not in NOTIFY_PRIORITIES:
            out.append(f"{path}.priority is one of {', '.join(NOTIFY_PRIORITIES)}")
    elif t == "phone.approvals_watch":
        if not isinstance(a.get("on"), bool):
            out.append(f"{path}.on is true or false")
    elif t == "phone.recorder_start":
        sn = a.get("session_name")
        if not isinstance(sn, str) or not sn.strip():
            out.append(f"{path}.session_name is required")
        elif len(sn) > SESSION_NAME_MAX:
            out.append(f"{path}.session_name is at most {SESSION_NAME_MAX} characters")
        if "mic" in a and not isinstance(a["mic"], bool):
            out.append(f"{path}.mic is true or false")
    return out


def norm_command(c: dict[str, Any], at: str = "") -> dict[str, Any]:
    r = resolve_tool(c.get("tool"))
    args_in = c.get("arguments") if isinstance(c.get("arguments"), dict) else {}
    args = {k: args_in[k] for k in TOOL_ARGS.get(r["tool"], []) if k in args_in}
    frm = c.get("from") if isinstance(c.get("from"), dict) else {}
    out: dict[str, Any] = {
        "$axf": COMMAND_FRAME, "id": c["id"] if UUID_RE.match(str(c.get("id") or "")) else "", "at": _iso(c.get("at")) or _iso(at),
        "deviceId": c["deviceId"] if DEVICE_ID_RE.match(str(c.get("deviceId") or "")) else "", "tool": r["tool"], "arguments": args,
        "policy": TOOL_POLICY[r["tool"]] if r["tool"] else "confirm",
        "from": {"who": _s(frm.get("who"), NAME_MAX), "via": frm.get("via") if frm.get("via") in VIAS else "console"},
    }
    if r["deprecated"]:
        out["alias"] = r["alias"]
    if c.get("correlationId"):
        out["correlationId"] = _s(c["correlationId"], 80)
    if c.get("approvalId"):
        out["approvalId"] = _s(c["approvalId"], 64)
    return out


def dispatch_error(command: dict[str, Any], device: dict[str, Any]) -> PhoneError | None:
    """Why `command` can't be queued for `device` (offline is not a reason: the queue holds it), or None."""
    c = norm_command(command)
    d = norm_device(device)
    if not c["tool"]:
        return PhoneError("invalid", f"Unknown tool \"{_s(command.get('tool'), 80)}\".")
    if d["state"] == "revoked":
        return PhoneError("revoked", f"{d['name'] or 'The phone'} was revoked. Pair it again from the console.")
    if d["state"] != "paired":
        return PhoneError("unpaired", "No phone is paired. Pair one from the console.")
    if TOOL_CAPABILITY[c["tool"]] not in d["capabilities"]:
        return PhoneError("not_found", f"{d['name'] or 'The phone'} cannot do {c['tool']} (it lacks {TOOL_CAPABILITY[c['tool']]}). Install the current app.")
    if c["policy"] == "confirm" and not c.get("approvalId"):
        return PhoneError("confirmation_required", f"{c['tool']} needs Brett's approval on axHub first.")
    return None


def own_domain(host: str, domains: tuple[str, ...] | list[str] = OWN_DOMAINS) -> bool:
    h = _s(host, 253).lower()
    if not h or h.endswith("."):
        return False
    return any(d and (h == d or h.endswith("." + d)) for d in domains)


def open_url_allowed(raw: Any, policy: str = "own", allowlist: list[str] | None = None) -> str:
    """The URL the phone may open, else PhoneError. `own` = https on amberxai.com and its subdomains, default port."""
    s = _s(raw, URL_MAX + 1)
    if not s:
        raise PhoneError("validation", "url is required.")
    if len(s) > URL_MAX:
        raise PhoneError("validation", "url is too long.")
    try:
        u = urlsplit(s)
        port = u.port
    except ValueError:
        raise PhoneError("validation", "url isn't a valid address.") from None
    scheme = u.scheme.lower()
    if scheme not in URL_SCHEMES:
        raise PhoneError("denied", f"Only http(s) pages can be opened, not {scheme}:.")
    if u.username or u.password:
        raise PhoneError("denied", "url can't carry a user name or password.")
    host = (u.hostname or "").lower()
    if not HOST_RE.match(host):
        raise PhoneError("validation", "url isn't a valid address.")
    p = policy if policy in URL_POLICIES else "own"
    if p == "own":
        if scheme != "https":
            raise PhoneError("denied", "Only https pages can be opened.")
        if port not in (None, 443):
            raise PhoneError("denied", "url can't name a port.")
        if not own_domain(host):
            raise PhoneError("denied", f"The phone only opens Brett's own sites ({', '.join(OWN_DOMAINS)}), not \"{host}\".")
    elif p == "allowlist" and not own_domain(host, [*OWN_DOMAINS, *[str(h).lower() for h in allowlist or []]]):
        raise PhoneError("denied", f"\"{host}\" is not on the phone's allowlist.")
    return s
