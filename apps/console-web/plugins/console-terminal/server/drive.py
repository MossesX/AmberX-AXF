"""Drive a Terminal tab from the API (full-api-control, Nov 7 2026, Brett: "the API must be able to do anything I can do
by hand in the console … today it can open a terminal tab but can't type in it").

A caller (control@1 `plugins.console-terminal.*`, the console MCP, `axf plugin console-terminal …`, voice) opens a tab
on a target, types into it the way a person would (character by character at a readable speed, setting `typeCps`,
default 30 a second, then Enter) while Brett watches it run in his open console, sends keys (Ctrl-C, arrows, Tab…),
reads the tab's screen and closes it.

The server owns the session (sessions.MANAGER); the open console is told to show a tab attached to that same session
(action `terminal.show`, navigation only, through capability console-commands@1), so every character typed here is
drawn there live. No console open = the session still runs and answers; the show is queued by Console commands.

  POST drive/open   {target: console | vps | container:<name> | build:<axf-name> | attach:<tmux>, title?, cwd?, show?}
  POST drive/type   {id, text, enter?, cps?, wait?, timeoutS?, quietMs?}   → {typed, output, screen, …}
  POST drive/keys   {id, keys: "ctrl-c" | ["up", "enter"] …}
  GET  drive/screen?id=&lines=                                          → {screen, lines}
  POST drive/close  {id, kill?}                                          kill = end the tmux session too
  GET  drive/tabs                                                        the sessions it can type into

Write policy: typing, keys and close change things and go through whatever gate the caller came through (control@1
plugin commands: a POST is a write; the orchestrator's VPS gate takes over once orchestrator-vps-gate lands). Reads
(screen, tabs) are instant. A read-only mirror never takes input.
"""
from __future__ import annotations

import re
import secrets
import shlex
import subprocess
import time
import urllib.parse
from typing import Any

import plugin_services

from . import sessions, store

MAX_TEXT = 4000
MAX_TYPE_SECONDS = 180.0
DEFAULT_TIMEOUT_S = 30.0
DEFAULT_QUIET_MS = 1200
SCREEN_LINES = 60

_ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_][^\x1b]*\x1b\\|\x1b[@-Z\\-_()][0-9A-Za-z]?")

# Named keys → the bytes a terminal sends for them.
KEYS: dict[str, str] = {
    "enter": "\r", "return": "\r", "tab": "\t", "shift-tab": "\x1b[Z", "esc": "\x1b", "escape": "\x1b", "backspace": "\x7f",
    "delete": "\x1b[3~", "del": "\x1b[3~", "insert": "\x1b[2~", "space": " ",
    "up": "\x1b[A", "down": "\x1b[B", "right": "\x1b[C", "left": "\x1b[D",
    "home": "\x1b[H", "end": "\x1b[F", "pageup": "\x1b[5~", "pagedown": "\x1b[6~", "pgup": "\x1b[5~", "pgdn": "\x1b[6~",
    **{f"f{i}": s for i, s in enumerate(["", "\x1bOP", "\x1bOQ", "\x1bOR", "\x1bOS", "\x1b[15~", "\x1b[17~", "\x1b[18~", "\x1b[19~", "\x1b[20~", "\x1b[21~", "\x1b[23~", "\x1b[24~"]) if i},
}


def key_bytes(name: str) -> str:
    """One key name → its bytes. Accepts enter, tab, up, f5, ctrl-c / Ctrl+C / C-c / ^C, alt-x / M-x, or one character."""
    raw = str(name or "").strip()
    if len(raw) == 1:
        return raw
    k = raw.lower().replace("+", "-").replace("_", "-")
    if k in KEYS:
        return KEYS[k]
    m = re.fullmatch(r"(?:ctrl-|control-|c-|\^)(.)", k)
    if m:
        ch = m.group(1)
        if "a" <= ch <= "z":
            return chr(ord(ch) - 96)
        special = {"@": "\x00", "[": "\x1b", "\\": "\x1c", "]": "\x1d", "^": "\x1e", "_": "\x1f", "?": "\x7f", " ": "\x00"}
        if ch in special:
            return special[ch]
    m = re.fullmatch(r"(?:alt-|meta-|m-)(.+)", k)
    if m:
        return "\x1b" + key_bytes(m.group(1))
    raise ValueError(f"unknown key {raw!r} (enter, tab, esc, backspace, up/down/left/right, home, end, pageup, f1-f12, ctrl-<letter>, alt-<key>)")


def keys_of(v: Any) -> list[str]:
    """`keys` as a list (an array, or one string of space-separated names)."""
    if isinstance(v, list):
        return [str(x) for x in v if str(x).strip()][:200]
    return [x for x in str(v or "").split() if x][:200]


def strip_ansi(text: str) -> str:
    return _ANSI.sub("", text).replace("\r\n", "\n").replace("\r", "\n")


def parse_target(target: str) -> dict[str, Any]:
    """A drive target → what sessions.MANAGER.open takes. console | vps | container:<name> | build:<axf-…> | attach:<tmux>."""
    t = str(target or "console").strip()
    name = f"axt-api-{secrets.token_hex(4)}"
    if t in ("console", "shell", "local"):
        return {"kind": "console", "tmux": name}
    if t in ("vps", "host"):
        return {"kind": "vps", "tmux": name}
    if t.startswith("container:") and len(t) > 10:
        return {"kind": "container", "container": t[10:]}
    if t.startswith("build:") and len(t) > 6:  # a headless build's own session on the VPS (deploy/claude-headless.sh)
        n = t[6:]
        n = n if n.startswith("axf-") else f"axf-{n}"
        if not sessions.HEADLESS_RE.match(n):
            raise ValueError("build:<name> names a headless run (its axf-… tmux session; GET headless lists them)")
        return {"kind": "vps", "attach": n}
    if t.startswith("attach:") and len(t) > 7:  # any tmux session on the VPS (Brett's own, a tab)
        n = t[7:]
        if not sessions.ATTACH_RE.match(n):
            raise ValueError("attach:<name> is a tmux session name")
        return {"kind": "vps", "attach": n}
    raise ValueError("target is console, vps, container:<name>, build:<axf-name> or attach:<tmux session>")


def _session(sid: str) -> sessions.Session:
    s = sessions.MANAGER.get(str(sid or ""))
    if s.read_only:
        raise PermissionError("that tab is a read-only mirror: open it with Jump in (or drive/open attach:<name>) to type into it")
    return s


def _console_show(s: sessions.Session, by: str) -> dict[str, Any]:
    """Tell the open console to show this session in a Terminal tab (action terminal.show, navigation only)."""
    try:
        if not any(x["name"] == "console-commands@1" for x in plugin_services.available()):
            return {"ok": False, "message": "Console commands is off, so the tab isn't shown (the session still runs)"}
        svc = plugin_services.get("console-commands@1")
    except Exception:  # noqa: BLE001
        return {"ok": False, "message": "Console commands isn't available"}
    q = lambda v: urllib.parse.quote(str(v or ""), safe="")  # noqa: E731
    spec = ":".join(["terminal.show", q(s.id), q(s.kind), q(s.tmux), q(s.where), q(s.target), q(s.title)])
    r = svc.run({"op": "act", "target": "console.actions", "path": spec, "action": "run", "by": by or "api",
                 "reason": "Show the terminal tab the API is typing into"}, grants=["control.console.navigate"], by=by or "api")
    return {"ok": bool(r.get("ok")), "message": r.get("message", ""), "how": (r.get("delivery") or {}).get("how", ""), "queued": bool(r.get("queued"))}


def _console_drop(sid: str, by: str) -> None:
    try:
        if any(x["name"] == "console-commands@1" for x in plugin_services.available()):
            plugin_services.get("console-commands@1").run({"op": "act", "target": "console.actions", "path": f"terminal.drop:{sid}", "action": "run",
                                                            "by": by or "api", "input": {"to": "all"}}, grants=["control.console.navigate"], by=by or "api")
    except Exception:  # noqa: BLE001 — the session is closed either way
        pass


def open_tab(body: dict[str, Any]) -> dict[str, Any]:
    req = parse_target(str(body.get("target") or "console"))
    cwd = str(body.get("cwd") or "").strip()
    if cwd:
        req["cwd"] = cwd
    req["cols"], req["rows"] = int(body.get("cols") or 120), int(body.get("rows") or 32)
    s = sessions.MANAGER.open(req)
    title = str(body.get("title") or "").strip()[:60]
    if title:
        s.title = title
    shown = _console_show(s, str(body.get("by") or "")) if body.get("show", True) is not False else {"ok": False, "message": "not shown (show: false)"}
    # a fresh shell prints its prompt: let it settle so the first typed line isn't mixed with the login banner
    _wait_quiet(s, s.offset, timeout=4.0, quiet=0.5, need_output=True)
    return {**s.info(), "shown": shown}


def _wait_quiet(s: sessions.Session, start: int, timeout: float, quiet: float, need_output: bool = True) -> bool:
    """Wait until the session's output has been still for `quiet` seconds (after some output, when `need_output`), or
    `timeout`. → True when it went quiet, False on the timeout."""
    end = time.time() + max(0.1, timeout)
    last_off, last_change = s.offset, time.time()
    while time.time() < end and not s.closed:
        time.sleep(0.05)
        if s.offset != last_off:
            last_off, last_change = s.offset, time.time()
        elif (not need_output or s.offset > start) and time.time() - last_change >= quiet:
            return True
    return False


def type_text(body: dict[str, Any]) -> dict[str, Any]:
    s = _session(str(body.get("id") or ""))
    text = str(body.get("text") if body.get("text") is not None else "")
    if len(text) > MAX_TEXT:
        raise ValueError(f"at most {MAX_TEXT} characters at a time")
    cps = float(body.get("cps") or store.settings().get("typeCps", 30))
    cps = max(1.0, min(cps, 400.0))
    if len(text) / cps > MAX_TYPE_SECONDS:
        cps = len(text) / MAX_TYPE_SECONDS  # long text speeds up so a call never types for more than 3 minutes
    enter = body.get("enter", True) is not False
    start_off = s.offset
    gap = 1.0 / cps
    for ch in text:
        if s.closed:
            raise KeyError("the session closed while typing")
        s.write(("\r" if ch == "\n" else ch).encode())
        time.sleep(gap)
    if enter:
        s.write(b"\r")
    out: dict[str, Any] = {"ok": True, "id": s.id, "typed": len(text), "enter": enter, "cps": round(cps, 1)}
    if body.get("wait", True) is False:
        return out
    timeout = max(0.5, min(float(body.get("timeoutS") or DEFAULT_TIMEOUT_S), 300.0))
    quiet = max(0.2, min(float(body.get("quietMs") or DEFAULT_QUIET_MS) / 1000, 30.0))
    settled = _wait_quiet(s, start_off, timeout, quiet)
    sc = screen_of(s, int(body.get("lines") or SCREEN_LINES))
    out.update({"settled": settled, "output": output_after(sc["lines"], text) if text else "", "screen": sc["screen"], "source": sc["source"]})
    if not settled:
        out["note"] = f"still printing after {timeout:g}s: read more with drive/screen, stop it with drive/keys ctrl-c"
    return out


def send_keys(body: dict[str, Any]) -> dict[str, Any]:
    s = _session(str(body.get("id") or ""))
    names = keys_of(body.get("keys"))
    if not names:
        raise ValueError("keys: one name or a list (enter, tab, ctrl-c, up …)")
    seq = [key_bytes(k) for k in names]  # all checked before any is sent
    gap = 1.0 / max(1.0, min(float(body.get("cps") or store.settings().get("typeCps", 30)), 400.0))
    start = s.offset
    for b in seq:
        s.write(b.encode())
        time.sleep(gap)
    out: dict[str, Any] = {"ok": True, "id": s.id, "sent": names}
    if body.get("wait", True) is not False:
        _wait_quiet(s, start, min(float(body.get("timeoutS") or 3.0), 60.0), 0.4, need_output=False)
        sc = screen_of(s, int(body.get("lines") or SCREEN_LINES))
        out.update({"screen": sc["screen"], "source": sc["source"]})
    return out


def _capture(name: str, where: str | None, lines: int) -> str | None:
    """The tmux pane's text (no colours, wrapped lines joined), or None when it can't be read."""
    cmd = f"tmux capture-pane -p -J -S -{max(1, lines)} -t ={shlex.quote(name)}:"
    try:
        if where == "console":
            r = sessions.RUNNER(["sh", "-c", cmd], capture_output=True, text=True, timeout=10, env=sessions.clean_env(), stdin=subprocess.DEVNULL)
            return r.stdout if r.returncode == 0 else None
        if where == "vps":
            out, why = sessions._vps_run(store.settings(), cmd, 15)  # noqa: SLF001 — the plugin's own helper
            return None if why else out
    except Exception:  # noqa: BLE001
        return None
    return None


def screen_of(s: sessions.Session, lines: int = SCREEN_LINES) -> dict[str, Any]:
    lines = max(1, min(int(lines or SCREEN_LINES), 2000))
    text = _capture(s.tmux, s.where, lines) if s.tmux else None
    source = "tmux"
    if text is None:  # no tmux (a container tab): the session's own output, colours and cursor moves stripped
        with s.lock:
            raw = bytes(s.buf[-256 * 1024:])
        text, source = strip_ansi(raw.decode("utf-8", "replace")), "stream"
    rows = text.rstrip("\n").split("\n")
    while rows and not rows[-1].strip():
        rows.pop()
    rows = [r.rstrip() for r in rows[-lines:]]
    return {"screen": "\n".join(rows), "lines": rows, "source": source}


def output_after(rows: list[str], typed: str) -> str:
    """What a typed command printed: the lines after the last line showing it, without the prompt that follows."""
    probe = typed.strip().split("\n")[-1].strip()[:60]
    idx = -1
    if probe:
        for i in range(len(rows) - 1, -1, -1):
            if probe in rows[i]:
                idx = i
                break
    after = rows[idx + 1:] if idx >= 0 else rows[:]
    if after and re.search(r"[$#%>❯]\s*$", after[-1]):
        after = after[:-1]  # the next prompt
    return "\n".join(after).strip("\n")


def read_screen(sid: str, lines: int = SCREEN_LINES) -> dict[str, Any]:
    s = sessions.MANAGER.get(str(sid or ""))
    return {"id": s.id, **{k: v for k, v in screen_of(s, lines).items() if k != "lines"}, "info": s.info()}


def close_tab(body: dict[str, Any]) -> dict[str, Any]:
    sid = str(body.get("id") or "")
    s = sessions.MANAGER.get(sid)
    name, where = s.tmux, s.where
    sessions.MANAGER.close(sid, "closed by the API")
    killed = False
    # an API tab's own tmux (axt-api-…) ends with it; any other only when asked (kill: true)
    if name and where and (body.get("kill") is True or name.startswith("axt-api-")):
        try:
            sessions.kill_tmux(name, where)
            killed = True
        except Exception:  # noqa: BLE001 — already gone
            pass
    _console_drop(sid, str(body.get("by") or ""))
    return {"ok": True, "id": sid, "tmux": name, "killed": killed}


def tabs() -> dict[str, Any]:
    return {"items": [{**i, "writable": not i.get("readOnly")} for i in sessions.MANAGER.list()], "typeCps": store.settings().get("typeCps", 30)}
