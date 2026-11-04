"""session@1 in Python: the same validator, redaction and chain hash as framework/core/session-schema.mjs.

Reads the registry snapshot framework/schemas/session.json (written by `axf schemas`), so the redaction patterns and
the enums live in one place. Replays framework/spec/fixtures/session.json in the plugin's test.py.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[5]
REGISTRY: dict[str, Any] = json.loads((_REPO / "framework" / "schemas" / "session.json").read_text())
TAG = REGISTRY["tag"]
SOURCES = tuple(REGISTRY["sources"])
ROLES = tuple(REGISTRY["roles"])
KINDS = tuple(REGISTRY["kinds"])
CHANGES = tuple(REGISTRY["changes"])
ID_RE = re.compile(REGISTRY["idPattern"])
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
US = "\u001f"

_RULES = [(r["id"], re.compile(r["pattern"], re.I if "i" in r["flags"] else 0), int(r["pre"]), int(r["post"])) for r in REGISTRY["redact"]]


def redact(text: Any) -> Any:
    """Every secret-looking value → [redacted:<id>]; idempotent."""
    if not isinstance(text, str) or not text:
        return text
    out = text
    for rid, rx, pre, post in _RULES:
        out = rx.sub(lambda m, rid=rid, pre=pre, post=post: f"{(m.group(pre) or '') if pre else ''}[redacted:{rid}]{(m.group(post) or '') if post else ''}", out)
    return out


def chain_hash(messages: list[dict[str, Any]], prev: str = "") -> str:
    h = prev
    for m in messages:
        h = hashlib.sha256(f"{h}\n{m['role']}{US}{m['kind']}{US}{m.get('toolName') or ''}{US}{m['text']}".encode()).hexdigest()
    return h


def is_timestamp(v: Any) -> bool:
    if not isinstance(v, str) or not ISO_RE.match(v):
        return False
    try:
        datetime.fromisoformat(v.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def iso(v: Any) -> str:
    """Any timestamp (ISO text, epoch seconds or ms) → ISO UTC with milliseconds, or '' when unknown."""
    if v in (None, ""):
        return ""
    try:
        if isinstance(v, (int, float)):
            d = datetime.fromtimestamp(v / 1000 if v > 1e11 else v, timezone.utc)
        else:
            s = str(v).strip().replace("Z", "+00:00")
            d = datetime.fromisoformat(s)
            if d.tzinfo is None:
                d = d.replace(tzinfo=timezone.utc)
        return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"
    except (ValueError, OverflowError, OSError):
        return ""


def now_iso() -> str:
    return iso(datetime.now(timezone.utc).isoformat())


def _err(field: str, code: str, message: str) -> dict[str, str]:
    return {"field": field, "code": code, "message": message}


def _blank(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not v.strip())


def validate_message(m: Any, i: int = 0) -> list[dict[str, str]]:
    p = f"messages[{i}]"
    if not isinstance(m, dict):
        return [_err(p, "invalid", f"{p} must be an object")]
    out = []
    if m.get("role") not in ROLES:
        out.append(_err(f"{p}.role", "missing" if _blank(m.get("role")) else "invalid", f"{p}.role must be one of {', '.join(ROLES)}"))
    if not isinstance(m.get("text"), str):
        out.append(_err(f"{p}.text", "missing", f"{p}.text must be a string"))
    elif len(m["text"]) > REGISTRY["maxText"]:
        out.append(_err(f"{p}.text", "invalid", f"{p}.text is longer than {REGISTRY['maxText']}"))
    at = m.get("at")
    if not isinstance(at, str):
        out.append(_err(f"{p}.at", "missing", f"{p}.at must be an ISO timestamp or \"\""))
    elif at and not is_timestamp(at):
        out.append(_err(f"{p}.at", "invalid", f"{p}.at \"{at}\" is not an ISO timestamp"))
    if m.get("kind") not in KINDS:
        out.append(_err(f"{p}.kind", "missing" if _blank(m.get("kind")) else "invalid", f"{p}.kind must be one of {', '.join(KINDS)}"))
    if "toolName" in m and not isinstance(m["toolName"], str):
        out.append(_err(f"{p}.toolName", "invalid", f"{p}.toolName must be a string"))
    if m.get("kind") == "tool" and m.get("role") == "user":
        out.append(_err(f"{p}.kind", "invalid", f"{p} is a tool message from the user (use role tool)"))
    return out


def validate_session(s: Any) -> dict[str, Any]:
    if not isinstance(s, dict):
        return {"ok": False, "errors": [_err("session", "invalid", "the session must be a JSON object")]}
    errors: list[dict[str, str]] = []
    if s.get("$axf") != TAG:
        errors.append(_err("$axf", "missing" if "$axf" not in s else "invalid", f'$axf must be "{TAG}"'))
    if _blank(s.get("id")):
        errors.append(_err("id", "missing", "id is missing"))
    elif not isinstance(s["id"], str) or not ID_RE.match(s["id"]):
        errors.append(_err("id", "invalid", f"id \"{s['id']}\" must look like \"cai:<uuid>\""))
    if _blank(s.get("source")):
        errors.append(_err("source", "missing", "source is missing"))
    elif s["source"] not in SOURCES:
        errors.append(_err("source", "invalid", f"source \"{s['source']}\" is not one of {', '.join(SOURCES)}"))
    t = s.get("title")
    if not isinstance(t, str) or not t.strip():
        errors.append(_err("title", "missing", "title is missing"))
    elif len(t) > REGISTRY["maxTitle"]:
        errors.append(_err("title", "invalid", f"title is longer than {REGISTRY['maxTitle']}"))
    for f in ("startedAt", "updatedAt"):
        if _blank(s.get(f)):
            errors.append(_err(f, "missing", f"{f} is missing"))
        elif not is_timestamp(s[f]):
            errors.append(_err(f, "invalid", f"{f} \"{s[f]}\" is not an ISO timestamp"))
    if not isinstance(s.get("project"), str):
        errors.append(_err("project", "missing", "project is missing"))
    msgs = s.get("messages")
    if not isinstance(msgs, list):
        errors.append(_err("messages", "missing", "messages must be a list"))
    else:
        for i, m in enumerate(msgs):
            errors.extend(validate_message(m, i))
    h = s.get("hash")
    if _blank(h):
        errors.append(_err("hash", "missing", "hash is missing"))
    elif not isinstance(h, str) or not HEX64.match(h):
        errors.append(_err("hash", "invalid", "hash must be 64 hex characters"))
    vs = s.get("versions")
    if vs is not None:
        if not isinstance(vs, list):
            errors.append(_err("versions", "invalid", "versions must be a list"))
        else:
            for i, v in enumerate(vs):
                if not isinstance(v, dict):
                    errors.append(_err(f"versions[{i}]", "invalid", "must be an object"))
                    continue
                if not isinstance(v.get("version"), int) or isinstance(v.get("version"), bool) or v["version"] < 1:
                    errors.append(_err(f"versions[{i}].version", "invalid", "a whole number from 1"))
                if v.get("change") not in CHANGES:
                    errors.append(_err(f"versions[{i}].change", "invalid", f"one of {', '.join(CHANGES)}"))
                if not isinstance(v.get("messageCount"), int) or v["messageCount"] < 0:
                    errors.append(_err(f"versions[{i}].messageCount", "invalid", "a whole number"))
    return {"ok": not errors, "errors": errors}


def rejection(errors: list[dict[str, str]]) -> str:
    return "; ".join(e["message"] for e in errors)
