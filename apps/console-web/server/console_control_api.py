"""Console control REST (console-control@1, framework/spec/CONSOLE-CONTROL.md): /api/console-control/*.

    GET  /targets?under=&kinds=&source=     every addressable target (the open console's live list, else the static inventory)
    GET  /state?address=                    the console's live state, or one target's state
    POST /do        {verb, address?, value?, confirm?, options?, scroll?, query?, by?, reason?, to?}   any verb
    GET  /search?q=&kinds=&limit=           ranked hits, each with its address (POST {q, kinds, limit} too)
    POST /focus     {address, options?}     bring a target into view (opens its screen, tab, row first) and highlight it
    POST /scroll    {dir, amount?, to?, address?}   scroll the active pane (or the pane of `address`)
    POST /plugins/{id}/enable|disable  {force?, by?}  turn a plugin on / off (server-side, no browser needed)
    POST /voice     {text, to?}             a spoken phrase → its command, run; `say` = the line to speak back
    GET  /audit?limit=&writes=&by=          the audit, newest first (by, reason, policy, outcome, decidedBy)
    GET  /screen                            what is on screen: view, open dialog, fields with values, buttons, headings, text
    GET  /fields                            the fields and buttons of the open dialog / screen (the same, without the text)
    POST /fill      {values: {field: value}, submit?, reason?}   type into several fields, then press `submit` (a button)

Fields and buttons on any screen (spec/CONSOLE-CONTROL.md → Fields and buttons on any screen): every input, select, switch,
choice group and button the open console shows has an address (`setting:field.<id>`, `button:<id>`), discovered on the page.
A field or button may be named by its label: `fill` and voice resolve "Project name" → `setting:field.project-name`, else by search.

Decisions (approve, deny, veto, sign off) are Brett's own: refused for every command, except one from Brett's own signed-in
session (a person's axHub sign-in on his browser or phone, never the shared console token an agent holds), which counts as his
own tap (`decidedBy`, audited). See `owner_of`.

Commands that need the page go to the open console over the console-commands relay (console-commands@1 `control`); the
answer is the console's own envelope with its live `state`. No console open → 503 `unavailable` with `openUrl`.
Server-side settings, plugin toggles, and search / targets / state of the static inventory answer without a browser.
"""
from __future__ import annotations

import json
import os
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

import console_control as cc

try:  # the shared console token's caller (an agent, a script, the MCP connector): never a person
    from wall import TOKEN_CALLER as _TOKEN_CALLER
except Exception:  # noqa: BLE001 — tests without the wall
    _TOKEN_CALLER = None

VERBS = ("open", "state", "press", "set", "scroll", "focus", "search", "list", "plugin.enable", "plugin.disable")
SCROLL_DIRS = ("up", "down", "page-up", "page-down", "top", "bottom", "to")  # = CONSOLE_CONTROL_SCROLL_DIRS
OWNER = "owner"
CONSOLE_URL = (os.environ.get("AXF_CONSOLE_PUBLIC_URL") or "https://console.amberxai.com").rstrip("/")


# ---------------------------------------------------------------------- guards (policy, permission, rate, audit)

# = CONSOLE_CONTROL_VERBS in core/engines/console-control-rules.mjs (effect, control@1 permission)
VERB_RULES: dict[str, tuple[str, str]] = {
    "open": ("navigate", "control.console.navigate"), "state": ("read", "control.console.read"), "press": ("write", "control.console.write"),
    "set": ("write", "control.console.write"), "scroll": ("navigate", "control.console.navigate"), "focus": ("navigate", "control.console.navigate"),
    "search": ("read", "control.console.read"), "list": ("read", "control.console.read"),
    "plugin.enable": ("write", "control.plugins.write"), "plugin.disable": ("write", "control.plugins.write"),
}
RATE_WINDOW_S = 10.0
RATE_MAX = 120         # commands per caller per window (reads and navigation)
RATE_MAX_WRITE = 20    # state-changing commands per caller per window
DATA_DIR = Path(os.environ.get("AXF_CONSOLE_CONTROL_DATA_DIR") or cc.APP.parent.parent / ".axf-console" / "console-control")
AUDIT_FILE = DATA_DIR / "audit.jsonl"
POLICY_FILE = cc.APP / "src" / "assets" / "uac-policy" / "console-access.json"
_rate: dict[str, deque[tuple[float, bool]]] = {}
_rate_lock = threading.Lock()
_audit_lock = threading.Lock()


def policy_of(cmd: dict[str, Any]) -> dict[str, Any]:
    """The axHub policy tag of a command (CONTROL.md → Recommended axHub policy): reads and navigation `allow` (never a
    veto countdown), writes `veto`, destructive presses `confirm`, deciding presses `person` (never by command)."""
    effect, requires = VERB_RULES.get(cmd.get("verb", ""), ("write", "control.console.write"))
    tag = "allow" if effect in ("read", "navigate") else "veto"
    destructive = False
    if cmd.get("verb") == "press":
        word = str(cmd.get("address") or "").rsplit("/", 1)[-1].split(":", 1)[-1]
        spec = cc.press_spec(str(cmd.get("address") or ""))
        if bool(spec and spec.get("personOnly")) or bool(cc.DECIDING_RE.search(word)):
            tag = "person"
        elif bool(spec and spec.get("destructive")) or bool(cc.DESTRUCTIVE_RE.search(word)):
            tag, destructive = "confirm", True
    return {"tag": tag, "effect": effect, "readOnly": effect in ("read", "navigate"), "destructive": destructive, "requires": requires}


def _role_grants(role: str) -> set[str]:
    try:
        roles = json.loads(POLICY_FILE.read_text()).get("data", {}).get("roles", [])
    except (OSError, ValueError):
        return set()
    r = next((x for x in roles if x.get("id") == role), None)
    return set(r.get("permissions") or []) if r else set()


def grants_of(request: Request) -> set[str]:
    """The console token and hub admins = everything; a hub user = their own perms plus their role's grants."""
    user = getattr(request.state, "axf_user", None)
    if user is None or getattr(user, "admin", False):
        return {"*"}
    return set(getattr(user, "perms", ()) or ()) | _role_grants(str(getattr(user, "role", "") or ""))


def granted(grants: set[str], perm: str) -> bool:
    """`*`, the permission itself, or a wildcard above it (`control.*`, `control.console.*`)."""
    if "*" in grants or perm in grants:
        return True
    parts = perm.split(".")
    return any(".".join(parts[:i]) + ".*" in grants for i in range(1, len(parts)))


def check_rate(who: str, write: bool, now: float | None = None) -> None:
    """At most RATE_MAX commands (RATE_MAX_WRITE state-changing ones) per caller per RATE_WINDOW_S. Raises unavailable."""
    t = now if now is not None else time.monotonic()
    with _rate_lock:
        q = _rate.setdefault(who, deque())
        while q and q[0][0] <= t - RATE_WINDOW_S:
            q.popleft()
        writes = sum(1 for _, w in q if w)
        if len(q) >= RATE_MAX or (write and writes >= RATE_MAX_WRITE):
            retry = max(0.1, RATE_WINDOW_S - (t - q[0][0])) if q else RATE_WINDOW_S
            raise cc.ControlError("unavailable", f"too many console-control commands: at most {RATE_MAX_WRITE if write else RATE_MAX} per {int(RATE_WINDOW_S)} s; try again in {retry:.1f} s",
                                  because="rate limit", retryAfterS=round(retry, 1))
        q.append((t, write))


def _shown_value(cmd: dict[str, Any]) -> Any:
    """The value for the audit line: never a secret setting's, and short."""
    if "value" not in cmd:
        return None
    spec = cc.setting_spec(str(cmd.get("address") or "")) if cmd.get("verb") == "set" else None
    if spec and spec.get("type") == "secret":
        return "(hidden)"
    v = cmd["value"]
    text = v if isinstance(v, str) else json.dumps(v, default=str)
    return text[:200]


NO_REASON = "(no reason given)"


def audit(cmd: dict[str, Any], r: dict[str, Any], by: str, audience: str, policy: dict[str, Any]) -> None:
    """One line per command: data/audit.jsonl and the console's terminal log. Every write names who (`by`) and why
    (`reason`; a write sent without one is marked NO_REASON, a voice command's reason is what was said)."""
    if not policy.get("readOnly") and not cmd.get("reason"):
        cmd = {**cmd, "reason": NO_REASON}
    line = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "by": by, "audience": audience, "verb": cmd.get("verb"), "address": cmd.get("address"),
            "value": _shown_value(cmd), "query": (cmd.get("query") or {}).get("q"), "reason": cmd.get("reason"), "policy": policy["tag"], "decidedBy": cmd.get("decidedBy"),
            "ok": bool(r.get("ok")), "code": r.get("code"), "source": r.get("source") or ("console" if r.get("client") else None), "client": r.get("client")}
    line = {k: v for k, v in line.items() if v not in (None, "")}
    try:
        with _audit_lock:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            with AUDIT_FILE.open("a", encoding="utf-8") as f:
                f.write(json.dumps(line, ensure_ascii=False) + "\n")
    except OSError:
        pass
    try:
        import console_context
        if console_context.log is not None:
            why = f" ({cmd['reason']})" if cmd.get("reason") and not policy.get("readOnly") else ""
            console_context.log("console-control", f"{by}: {cmd.get('verb')} {cmd.get('address') or (cmd.get('query') or {}).get('q') or ''}{why} → {'ok' if r.get('ok') else r.get('code')}")
    except Exception:  # noqa: BLE001 — tests without the console
        pass


def owner_of(request: Request) -> str | None:
    """Brett's own session: a person signed in to axHub as an admin on his browser or phone (the wall caller), never the
    shared console token (agents, scripts, MCP connectors all hold that one). Its name, else None."""
    user = getattr(request.state, "axf_user", None)
    if user is None or (_TOKEN_CALLER is not None and user is _TOKEN_CALLER) or not getattr(user, "admin", False):
        return None
    name = str(getattr(user, "name", "") or "").strip()
    return name or None


PERSON_REFUSED = ("{what} is a decision only Brett makes himself: say it from his own signed-in console or AmberX session "
                  "(voice), or tap it")


def guarded(cmd: dict[str, Any], by: str, audience: str, grants: set[str], to: str = "recent", owner: str | None = None) -> dict[str, Any]:
    """Permission, rate, then run; the answer carries its policy tag and is audited. `owner` = Brett's own signed-in
    session (owner_of): only then may a deciding press (approve, deny, veto) run, recorded as his decision."""
    policy = policy_of(cmd)
    decided = False
    try:
        if not granted(grants, policy["requires"]):
            raise cc.ControlError("denied", f"{cmd['verb']} needs {policy['requires']}", requires=policy["requires"])
        if policy["tag"] == "person":
            if not owner or audience != OWNER:
                raise cc.ControlError("denied", PERSON_REFUSED.format(what=cmd.get("address")), requires="person", personOnly=True)
            decided = True
        check_rate(f"{audience}|{by}", not policy["readOnly"])
        r = run({**cmd, **({"ownerDecision": True} if decided else {})}, by, audience, to)
    except cc.ControlError as e:
        r = e.envelope()
    r = {**r, "policy": {k: policy[k] for k in ("tag", "effect", "readOnly", "destructive")}}
    if decided:
        r["decidedBy"] = f"owner:{owner}"
    audit({**cmd, **({"decidedBy": f"owner:{owner}"} if decided else {})}, r, by, audience, policy)
    return r


def audit_lines(limit: int = 50, writes_only: bool = False, by: str = "") -> list[dict[str, Any]]:
    """The last `limit` audit lines (newest first): who, what, why, the policy tag, the outcome, a decision's decidedBy."""
    try:
        lines = AUDIT_FILE.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out: list[dict[str, Any]] = []
    for raw in reversed(lines):
        try:
            x = json.loads(raw)
        except ValueError:
            continue
        if writes_only and x.get("policy") == "allow":
            continue
        if by and str(x.get("by") or "") != by:
            continue
        out.append(x)
        if len(out) >= max(1, min(int(limit), 500)):
            break
    return out


def _relay() -> Any:
    try:
        import plugin_services
        return plugin_services.get("console-commands@1")
    except Exception:  # noqa: BLE001 — tests without the console
        return None


def audience_of(request: Request) -> tuple[str, str]:
    """(audience, name): the console token and hub admins reach the owner's consoles; a hub user only their own."""
    user = getattr(request.state, "axf_user", None)
    if user is None:
        return OWNER, "console"
    name = str(getattr(user, "name", "") or "console")
    return (OWNER if getattr(user, "admin", False) else f"user:{name}"), name


def answer(r: dict[str, Any]) -> JSONResponse:
    status = 200 if r.get("ok") else 429 if r.get("because") == "rate limit" else cc.STATUS.get(str(r.get("code") or "unexpected"), 500)
    headers = {"X-AXF-Policy": str(r["policy"]["tag"])} if isinstance(r.get("policy"), dict) else {}
    if r.get("retryAfterS"):
        headers["Retry-After"] = str(int(float(r["retryAfterS"]) + 0.999))
    return JSONResponse(r, status_code=status, headers=headers)


def fail(e: cc.ControlError) -> JSONResponse:
    return answer(e.envelope())


async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:  # noqa: BLE001 — empty or non-JSON = no fields
        return {}


def normalize(b: dict[str, Any]) -> dict[str, Any]:
    """A command from a request body, checked for shape (the console checks it fully). Raises invalid."""
    verb = str(b.get("verb") or "").strip()
    if verb not in VERBS:
        raise cc.ControlError("invalid", f"verb must be one of {', '.join(VERBS)}", field="verb")
    cmd: dict[str, Any] = {"$axf": cc.FRAME, "verb": verb}
    address = str(b.get("address") or "").strip()
    if address:
        cmd["address"] = address
    elif verb in ("open", "press", "set", "focus", "plugin.enable", "plugin.disable"):
        raise cc.ControlError("invalid", f"{verb} needs an address", field="address")
    for k in ("value", "options", "confirm", "reason"):
        if k in b and b[k] not in (None, ""):
            cmd[k] = b[k]
    if verb == "scroll":
        s = b.get("scroll") if isinstance(b.get("scroll"), dict) else {k: b[k] for k in ("dir", "amount", "to") if k in b}
        if str(s.get("dir") or "") not in SCROLL_DIRS:
            raise cc.ControlError("invalid", f"scroll.dir must be one of {', '.join(SCROLL_DIRS)}", field="scroll.dir")
        if s.get("dir") == "to" and not s.get("to"):
            raise cc.ControlError("invalid", "scroll to needs scroll.to (an address)", field="scroll.to")
        cmd["scroll"] = {k: v for k, v in s.items() if k in ("dir", "amount", "to") and v not in (None, "")}
    if verb == "search":
        q = b.get("query") if isinstance(b.get("query"), dict) else {"q": b.get("q"), "kinds": b.get("kinds"), "limit": b.get("limit")}
        if not str(q.get("q") or "").strip():
            raise cc.ControlError("invalid", "search needs words (query.q)", field="query.q")
        cmd["query"] = {k: v for k, v in q.items() if v not in (None, "", [])}
    return cmd


def server_side(cmd: dict[str, Any], by: str) -> dict[str, Any] | None:
    """Commands that need no browser: plugin toggles and server-run settings. Prechecks for the rest (refusals that
    don't depend on the page: owner-only settings, deciding / destructive presses). None = send it to the console."""
    verb, address = cmd["verb"], cmd.get("address", "")
    if verb in ("plugin.enable", "plugin.disable"):
        return cc.toggle_plugin(address, verb == "plugin.enable", by=by, force=bool(cmd.get("value") == "force" or (cmd.get("options") or {}).get("force")))
    if verb in ("set", "state") and address:
        spec = cc.setting_spec(address)
        if spec is not None:
            if verb == "state" and spec.get("runs") == "server":
                return cc.ok("state", spec["address"], state=cc.setting_state(spec))
            if verb == "set":
                if spec.get("runs") == "server":
                    return cc.set_server_setting(spec, cmd.get("value"), by)
                cc.refuse_person_only(spec, cmd.get("value"))
        if verb == "set" and address.rsplit("/", 1)[-1].startswith("plugin:"):
            on = str(cmd.get("value")).strip().lower() in cc.TRUE_WORDS
            return cc.toggle_plugin(address, on, by=by)
        if verb == "state" and address.rsplit("/", 1)[-1].startswith("plugin:"):
            p = cc.plugin_spec(address)
            if p is not None:
                return cc.ok("state", p["address"], state=cc.plugin_state(p))
    if verb == "press":
        cc.check_press(cc.press_spec(address), address, cmd.get("confirm"), owner=bool(cmd.get("ownerDecision")))
    return None


def to_console(cmd: dict[str, Any], by: str, audience: str, to: str = "recent") -> dict[str, Any]:
    relay = _relay()
    if relay is None or not hasattr(relay, "control"):
        return {"$axf": cc.FRAME, "ok": False, "code": "unavailable", "because": "no relay",
                "message": "the Console commands plugin is off, so no console can be reached (turn it on in Settings › Plugins)", "openUrl": CONSOLE_URL + "/"}
    return relay.control({k: v for k, v in cmd.items() if k != "ownerDecision"}, by, audience, to)


def run(cmd: dict[str, Any], by: str, audience: str, to: str = "recent") -> dict[str, Any]:
    """One command: server-side when it can be, else the open console; read-only verbs fall back to the inventory."""
    try:
        r = server_side(cmd, by)
    except cc.ControlError as e:
        return e.envelope()
    if r is not None:
        return {**r, "source": "server"}
    out = to_console(cmd, by, audience, to)
    if out.get("ok") or out.get("code") != "unavailable":
        return out
    # no console open: what the inventory can answer, it answers (marked), with the link to open the console
    link = {"openUrl": out.get("openUrl")} if out.get("openUrl") else {}
    try:
        if cmd["verb"] == "search":
            q = cmd["query"]
            return cc.ok("search", hits=cc.search(q.get("q", ""), q.get("kinds"), q.get("limit")), source="inventory", console=False, **link)
        if cmd["verb"] == "list":
            return cc.ok("list", targets=_static(cmd.get("address")), source="inventory", console=False, **link)
        if cmd["verb"] == "state" and not cmd.get("address"):
            return {**out, "state": None}
    except cc.ControlError as e:
        return e.envelope()
    return out


def _static(under: str | None, kinds: list[str] | None = None) -> list[dict[str, Any]]:
    ts = cc.static_targets()
    if under:
        ts = [t for t in ts if t["address"] == under or t["address"].startswith(under + "/") or t["address"].startswith(under + "=")]
    if kinds:
        ts = [t for t in ts if t.get("kind") in kinds]
    return ts


def targets(under: str = "", kinds: list[str] | None = None, source: str = "auto", by: str = "console", audience: str = OWNER, grants: set[str] | None = None) -> dict[str, Any]:
    """Every addressable target: the open console's live list (source console / auto), else the static inventory."""
    if source != "inventory":
        live = guarded({"$axf": cc.FRAME, "verb": "list", **({"address": under} if under else {})}, by, audience, grants if grants is not None else {"*"})
        if live.get("ok") and live.get("source") != "inventory":
            ts = [t for t in live.get("targets") or [] if not kinds or t.get("kind") in kinds]
            return {"$axf": cc.TARGETS_FRAME, "ok": True, "source": "console", "client": live.get("client"), "view": live.get("view"), "targets": ts, "state": live.get("state")}
        if source == "console":
            return live if not live.get("ok") else {**live, "ok": False, "code": "unavailable", "because": "no console open", "message": "no console open: open the console (openUrl), then ask again"}
    return {"$axf": cc.TARGETS_FRAME, "ok": True, "source": "inventory", "targets": _static(under or None, kinds), "counts": cc.inventory().get("counts", {})}


def command(b: dict[str, Any], by: str = "", audience: str = OWNER, grants: set[str] | None = None, owner: str | None = None) -> dict[str, Any]:
    """One command from a body ({verb, address, value, …, to}) → the guarded answer (what /do answers; MCP and the CLI use it)."""
    try:
        cmd = normalize(b)
    except cc.ControlError as e:
        return e.envelope()
    return guarded(cmd, str(b.get("by") or by or "api")[:80], audience, grants if grants is not None else {"*"}, str(b.get("to") or "recent"), owner)


# ---------------------------------------------------------------------- fields, buttons and the screen read-back

def field_address(key: str) -> str:
    """A field named by address or by label: "setting:field.name" stays, "Project name" → "setting:field.project-name"."""
    k = str(key or "").strip()
    return k if ":" in k else f"setting:field.{cc.slug(k)}"


def button_address(key: str) -> str:
    """A button named by address or by label: "Create project" → "button:create-project"."""
    k = str(key or "").strip()
    return k if ":" in k else f"button:{cc.slug(k)}"


def screen(by: str = "api", audience: str = OWNER, grants: set[str] | None = None, to: str = "recent", text: bool = True) -> dict[str, Any]:
    """What is on screen in the open console (state with no address → state.report): view, title, open dialog, fields
    with their values, buttons, headings and (text=True) the visible text. No console open: unavailable + openUrl."""
    r = guarded({"$axf": cc.FRAME, "verb": "state"}, by, audience, grants if grants is not None else {"*"}, to)
    sc = ((r.get("state") or {}) if isinstance(r.get("state"), dict) else {}).get("report")
    if not r.get("ok") or not isinstance(sc, dict):
        if r.get("ok"):
            return {**r, "ok": False, "code": "unavailable", "because": "no screen report", "message": "the open console does not report its screen yet (reload it to pick up the new build)"}
        return r
    if not text:
        sc = {k: v for k, v in sc.items() if k != "text"}
    return {"$axf": cc.FRAME, "ok": True, "verb": "state", "screen": sc, "say": say_screen(sc), **({"client": r["client"]} if r.get("client") else {})}


def say_screen(sc: dict[str, Any]) -> str:
    """One or two plain lines for a voice to speak (console_control.screen_line = screenLine)."""
    return cc.screen_line(sc)


def _resolve_field(key: str, by: str, audience: str, grants: set[str], to: str) -> str:
    """A label that is not an exact slug: the best search hit among the settings on screen, else the slug guess."""
    guess = field_address(key)
    if ":" in str(key):
        return guess
    r = guarded({"$axf": cc.FRAME, "verb": "search", "query": {"q": str(key), "kinds": ["setting"], "limit": 5}}, by, audience, grants, to)
    hits = [h for h in r.get("hits") or [] if "/setting:field." in str(h.get("address"))]
    return str(hits[0]["address"]) if hits else guess


def fill(values: dict[str, Any], submit: str = "", by: str = "api", audience: str = OWNER, grants: set[str] | None = None, to: str = "recent",
         reason: str = "", owner: str | None = None) -> dict[str, Any]:
    """Type into several fields of the open dialog / screen in order (label or address → value), then press `submit`.
    Stops at the first field that fails and says which. The answer ends with the screen read back, so the caller sees
    what landed (a validation error, the wizard's next page)."""
    g = grants if grants is not None else {"*"}
    done: list[dict[str, Any]] = []
    for key, value in (values or {}).items():
        address = field_address(key)
        r = guarded({"$axf": cc.FRAME, "verb": "set", "address": address, "value": value, **({"reason": reason} if reason else {})}, by, audience, g, to)
        if not r.get("ok") and r.get("code") in ("not_found", "ambiguous"):
            alt = _resolve_field(key, by, audience, g, to)
            if alt != address:
                address = alt
                r = guarded({"$axf": cc.FRAME, "verb": "set", "address": address, "value": value, **({"reason": reason} if reason else {})}, by, audience, g, to)
        done.append({"field": key, "address": address, "ok": bool(r.get("ok")), **({"value": r.get("value")} if r.get("ok") else {"code": r.get("code"), "message": r.get("message")})})
        if not r.get("ok"):
            return {"$axf": cc.FRAME, "ok": False, "code": r.get("code") or "unexpected", "message": f"{key}: {r.get('message')}", "filled": done,
                    **({"openUrl": r["openUrl"]} if r.get("openUrl") else {})}
    out: dict[str, Any] = {"$axf": cc.FRAME, "ok": True, "filled": done}
    if submit:
        p = guarded({"$axf": cc.FRAME, "verb": "press", "address": button_address(submit), **({"reason": reason} if reason else {})}, by, audience, g, to, owner)
        out["pressed"] = {"button": submit, "address": button_address(submit), "ok": bool(p.get("ok")), **({} if p.get("ok") else {"code": p.get("code"), "message": p.get("message")})}
        if not p.get("ok"):
            out.update({"ok": False, "code": p.get("code"), "message": f"{submit}: {p.get('message')}"})
    sc = screen(by, audience, g, to, text=False)
    if sc.get("ok"):
        out["screen"] = sc["screen"]
    return out


def voice(text: str, by: str = "voice", audience: str = OWNER, grants: set[str] | None = None, to: str = "recent", owner: str | None = None) -> dict[str, Any]:
    """A spoken phrase → its command (console_control.voice_intent), words resolved by the same search, then run with the
    same guards. The answer carries `heard`, `intent`, `command` and `say` (the line to speak back)."""
    g = grants if grants is not None else {"*"}
    intent = cc.voice_intent(text)
    if intent is None:
        return {"$axf": cc.FRAME, "ok": False, "code": "invalid", "message": "not a console command", "heard": text, "intent": None, "say": "That isn't a console command I know."}
    if intent.get("help"):
        return {"$axf": cc.FRAME, "ok": True, "verb": "state", "heard": text, "intent": intent, "command": None, "say": cc.VOICE_HELP}
    if intent.get("screen"):
        sc = screen(by, audience, g, to)
        return {**sc, "heard": text, "intent": intent, "command": {"verb": "state"}, **({} if sc.get("ok") else {"say": cc.voice_reply(intent, sc)})}
    hit: dict[str, Any] | None = None
    if intent.get("find"):
        r = guarded({"$axf": cc.FRAME, "verb": "search", "query": {"q": intent["find"]["q"], "kinds": intent["find"]["kinds"], "limit": 10}}, by, audience, g, to)
        hits = r.get("hits") or []
        within = intent.get("within")
        hit = next((h for h in hits if within and h["address"].startswith(within + "/")), None) or (hits[0] if hits else None)
        if hit is None:
            return {"$axf": cc.FRAME, "ok": False, "code": "not_found", "message": f"nothing called {intent['find']['q']}", "heard": text, "intent": intent,
                    "say": f"I couldn't find {intent['find']['q']}.", **({"openUrl": r["openUrl"]} if r.get("openUrl") else {})}
    cmd = {"$axf": cc.FRAME, **cc.intent_command(intent, hit["address"] if hit else None), "reason": f"said: {text[:160]}"}
    if hit and hit.get("value") is not None and cmd["verb"] in ("open", "press"):
        cmd["verb"], cmd["value"] = "press", hit["value"]
    ans = guarded(cmd, by, audience, g, to, owner)
    return {**ans, "heard": text, "intent": intent, "command": {k: v for k, v in cmd.items() if k not in ("$axf", "reason")}, "say": cc.voice_reply(intent, ans, (hit or {}).get("label", ""))}


def _kinds(v: str | None) -> list[str] | None:
    ks = [k.strip() for k in (v or "").split(",") if k.strip()]
    return ks or None


def router_for(auth: Any) -> APIRouter:
    from fastapi import Depends
    r = APIRouter(prefix="/api/console-control", dependencies=[Depends(auth)])

    async def go(request: Request, cmd: dict[str, Any], to: str = "recent") -> JSONResponse:
        audience, name = audience_of(request)
        by = str(cmd.pop("by", "") or "") or name
        return answer(await run_in_threadpool(guarded, cmd, by, audience, grants_of(request), to, owner_of(request)))

    async def from_body(request: Request, b: dict[str, Any]) -> JSONResponse:
        try:
            cmd = normalize(b)
        except cc.ControlError as e:
            return fail(e)
        if b.get("by"):
            cmd["by"] = str(b["by"])[:80]
        return await go(request, cmd, str(b.get("to") or "recent"))

    @r.get("/targets")
    async def targets_route(request: Request, under: str = "", kinds: str = "", source: str = "auto") -> JSONResponse:
        """source=inventory: the static list only; console: the open console's live list (503 when none); auto: live, else static."""
        audience, name = audience_of(request)
        return answer(await run_in_threadpool(targets, under, _kinds(kinds), source, name, audience, grants_of(request)))

    @r.get("/state")
    async def state(request: Request, address: str = "") -> JSONResponse:
        return await go(request, {"$axf": cc.FRAME, "verb": "state", **({"address": address} if address else {})})

    @r.post("/do")
    async def do(request: Request) -> JSONResponse:
        return await from_body(request, await _body(request))

    @r.get("/search")
    async def search_get(request: Request, q: str = "", kinds: str = "", limit: int = cc.SEARCH_DEFAULT_LIMIT) -> JSONResponse:
        return await from_body(request, {"verb": "search", "query": {"q": q, "kinds": _kinds(kinds), "limit": limit}})

    @r.post("/search")
    async def search_post(request: Request) -> JSONResponse:
        b = await _body(request)
        return await from_body(request, {**b, "verb": "search"})

    @r.post("/focus")
    async def focus(request: Request) -> JSONResponse:
        b = await _body(request)
        return await from_body(request, {**b, "verb": "focus"})

    @r.post("/scroll")
    async def scroll(request: Request) -> JSONResponse:
        b = await _body(request)
        return await from_body(request, {**b, "verb": "scroll"})

    @r.post("/voice")
    async def voice_route(request: Request) -> JSONResponse:
        """{text, to?}: a spoken phrase (AmberX) → the command it maps to, run, with `say` to speak back."""
        b = await _body(request)
        audience, name = audience_of(request)
        text = str(b.get("text") or "").strip()[:300]
        if not text:
            return fail(cc.ControlError("invalid", "voice needs text", field="text"))
        return answer(await run_in_threadpool(voice, text, str(b.get("by") or "voice")[:80], audience, grants_of(request), str(b.get("to") or "recent"), owner_of(request)))

    @r.get("/audit")
    async def audit_route(limit: int = 50, writes: bool = False, by: str = "") -> JSONResponse:
        """The audit (newest first): every console-control command with by, reason, policy, outcome and decidedBy."""
        return JSONResponse({"$axf": cc.FRAME, "ok": True, "lines": await run_in_threadpool(audit_lines, limit, writes, by)})

    @r.get("/screen")
    async def screen_route(request: Request, to: str = "recent", text: bool = True) -> JSONResponse:
        """What is on screen: view, open dialog, fields with values, buttons, headings, text, and `say` (one line to speak)."""
        audience, name = audience_of(request)
        return answer(await run_in_threadpool(screen, name, audience, grants_of(request), to, text))

    @r.get("/fields")
    async def fields_route(request: Request, to: str = "recent") -> JSONResponse:
        audience, name = audience_of(request)
        return answer(await run_in_threadpool(screen, name, audience, grants_of(request), to, False))

    @r.post("/fill")
    async def fill_route(request: Request) -> JSONResponse:
        """{values: {label or address: value}, submit?: button label or address, reason?, by?, to?}."""
        b = await _body(request)
        audience, name = audience_of(request)
        values = b.get("values") if isinstance(b.get("values"), dict) else {}
        if not values and not b.get("submit"):
            return fail(cc.ControlError("invalid", "fill needs values {field: value} or submit", field="values"))
        return answer(await run_in_threadpool(fill, values, str(b.get("submit") or ""), str(b.get("by") or name)[:80], audience, grants_of(request),
                                              str(b.get("to") or "recent"), str(b.get("reason") or ""), owner_of(request)))

    @r.post("/plugins/{ref}/{op}")
    async def plugin(request: Request, ref: str, op: str) -> JSONResponse:
        if op not in ("enable", "disable"):
            return fail(cc.ControlError("invalid", "use /plugins/<id>/enable or /disable", field="op"))
        b = await _body(request)
        return await from_body(request, {**b, "verb": f"plugin.{op}", "address": ref, **({"options": {"force": True}} if b.get("force") else {})})

    return r
