"""Claude mode: understand a spoken command with Claude (wake-listener; build voice-listener-use-claude-when-connected).

Brett: "can we have a setting to make it use Claude if Claude's connected". `understand()` takes what was heard and
returns either

  {mode: 'claude', command, tool, args, missing, ask?, confirm?, run, prompt, pending?}
      command = the catalog entry id Claude picked, args = the fields it filled from what Brett said;
      ask     = a short question for one missing field (the next answer comes back with `pending`);
      confirm = the command is said back first and runs only after a spoken yes (`pending.confirm`);
      run     = nothing is missing and nothing needs a yes: the page runs it now;
or
  {mode: 'offline', reason, message}
      the page hands the same transcript to the scripted matcher and wizard. Reasons: off (the setting), approvals
      (approve / deny words: never sent to Claude), no-llm, not-claude, cooldown, timeout, error, no-credit,
      no-command (Claude picked none), refused (Claude named a tool it was not offered, an approve / deny one included).

Follow-ups: `pending` is what the last answer returned. With `pending.confirm` the answer is a yes / no, read here
(no Claude call): yes → run, no → cancelled. With `pending.ask` the answer goes to Claude with only that command's
tool, so it fills the missing fields and nothing else.

Claude is reached through axf.llm@1 only (the AI assistant's model service, the same one the Claude badge tests).
"Connected" is this module's own copy of the badge's test: the service is there, the last call answered from a Claude
model, and no failure in the last COOLDOWN_S seconds. Kept in memory and in `claude.json` in the plugin's data folder.
Pure apart from that file; the LLM, the catalog and the clock are passed in (tests: test.py with a fake LLM).
"""
from __future__ import annotations

import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from pathlib import Path
from typing import Any, Callable

try:
    from . import claude_tools as ct
except ImportError:  # loaded on its own (test.py)
    import claude_tools as ct  # type: ignore[no-redef]

COOLDOWN_S = 60
MAX_TEXT = 500
REASONS = ("off", "approvals", "no-llm", "not-claude", "cooldown", "timeout", "error", "no-credit", "no-command", "refused")
NO_CREDIT = re.compile(r"hit your (?:weekly |daily |session |5-hour )?limit|weekly limit|credit balance|out of credits?|insufficient[ _-]?(credit|funds|balance)|billing|usage limit|limit reached|quota|payment required|\b402\b", re.I)
YES = re.compile(r"^(yes|yeah|yep|yup|sure|ok|okay|do it|go|go ahead|confirm|correct|right|affirmative|please do)\b", re.I)
NO = re.compile(r"^(no|nope|cancel|never mind|nevermind|stop|forget it|don ?t|do not|quit|abort|negative)\b", re.I)
REASON_TEXT = {
    "off": "Claude mode is off.",
    "approvals": "Approvals stay on the spoken approve and deny words.",
    "no-llm": "The AI assistant isn't installed or enabled.",
    "not-claude": "The AI assistant isn't answering with a Claude model.",
    "cooldown": "Claude failed a moment ago; trying again shortly.",
    "timeout": "Claude took too long.",
    "error": "Claude couldn't be reached.",
    "no-credit": "Claude is out of credits.",
    "no-command": "Claude didn't pick a command.",
    "refused": "Claude picked something it may not run.",
}

SYSTEM = """You turn one spoken command for the AmberX console into exactly one tool call.
- Pick the one tool that does what Brett asked. Never call more than one tool.
- Fill arguments only from what Brett said. Never invent values; leave a required argument out when he did not say it.
- If nothing fits, call no tool.
- You cannot approve, deny, reject or veto anything: those are Brett's spoken decisions and are not your tools.
If tools are not available to you, answer with one JSON line and nothing else:
{"command": "<tool name or null>", "args": {...}, "ask": "<one short question for a missing required argument, or empty>"}"""

FOLLOW_UP = """Brett first said: "{first}".
You picked {tool} with {args}. Missing: {missing}. You asked: "{ask}".
Brett answered: "{answer}".
Call {tool} again with the arguments you had plus what the answer gives for the missing ones. Change nothing else."""


def offline(reason: str, detail: str = "") -> dict[str, Any]:
    return {"ok": True, "mode": "offline", "reason": reason, "message": (detail or REASON_TEXT.get(reason, reason))[:300]}


def is_claude_model(model: str) -> bool:
    return str(model or "").strip().lower().startswith("claude")


def approvals_words(text: str) -> bool:
    """Approve / deny / veto words: the scripted approvals path takes them, Claude never sees them."""
    return bool(ct.APPROVAL_WORDS.search(text or ""))


class Status:
    """Is Claude connected (this module's copy of the badge's test), and how the last command went."""

    def __init__(self, path: Path | None = None, clock: Callable[[], float] = time.time):
        self.path = path
        self.clock = clock
        self.lock = threading.Lock()
        self.data: dict[str, Any] = {"connected": None, "model": "", "checkedAt": 0, "failedAt": 0, "error": "", "lastMode": "", "lastFallbackReason": "", "lastAt": 0}
        if path and path.exists():
            try:
                self.data.update(json.loads(path.read_text()))
            except (OSError, ValueError):
                pass

    def _save(self) -> None:
        if not self.path:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data))
            tmp.chmod(0o600)
            tmp.replace(self.path)
        except OSError:
            pass

    def cooling(self) -> bool:
        return bool(self.data.get("failedAt")) and self.clock() - float(self.data["failedAt"]) < COOLDOWN_S

    def connected_now(self, llm_present: bool) -> bool:
        """What the indicator shows: the service is there and the last test was a Claude answer, not cooling down."""
        return llm_present and self.data.get("connected") is True and not self.cooling()

    def ok(self, model: str) -> None:
        with self.lock:
            self.data.update(connected=True, model=model, checkedAt=self.clock(), failedAt=0, error="")
            self._save()

    def fail(self, reason: str, error: str = "") -> None:
        with self.lock:
            now = self.clock()
            self.data.update(connected=False, checkedAt=now, failedAt=now if reason in ("timeout", "error", "no-credit", "not-claude") else self.data.get("failedAt", 0), error=error[:300])
            self._save()

    def handled(self, mode: str, reason: str = "") -> None:
        with self.lock:
            self.data.update(lastMode=mode, lastFallbackReason=reason if mode != "claude" else "", lastAt=self.clock())
            self._save()

    def view(self, llm_present: bool, use_claude: bool) -> dict[str, Any]:
        d = self.data
        connected = self.connected_now(llm_present)
        mode = "claude" if use_claude and connected else "scripted"
        why = "" if mode == "claude" else ("off" if not use_claude else "no-llm" if not llm_present else "cooldown" if self.cooling() else (d.get("lastFallbackReason") or ("error" if d.get("connected") is False else "untested")))
        return {"mode": mode, "useClaude": use_claude, "claudeConnected": connected, "claudeModel": d.get("model") or "", "claudeCheckedAt": int(float(d.get("checkedAt") or 0) * 1000),
                "claudeError": d.get("error") or "", "lastMode": d.get("lastMode") or "", "lastFallbackReason": d.get("lastFallbackReason") or "", "lastHandledAt": int(float(d.get("lastAt") or 0) * 1000),
                "offlineReason": why, "offline": use_claude and mode != "claude"}


# ---------------------------------------------------------------- one reply → a pick

_JSON = re.compile(r"\{.*\}", re.S)


def read_reply(out: dict[str, Any]) -> tuple[str, dict[str, Any], str] | None:
    """The model's reply → (tool name, args, question) from its first tool call, else from a JSON line in its text."""
    calls = out.get("tool_calls") or []
    if calls:
        c = calls[0]
        args = c.get("arguments") if isinstance(c.get("arguments"), dict) else {}
        return str(c.get("name") or ""), args, ""
    m = _JSON.search(str(out.get("text") or ""))
    if not m:
        return None
    try:
        j = json.loads(m.group(0))
    except ValueError:
        return None
    if not isinstance(j, dict) or not j.get("command"):
        return None
    return str(j["command"]), j.get("args") if isinstance(j.get("args"), dict) else {}, str(j.get("ask") or "")


def clean_args(tool: dict[str, Any], args: dict[str, Any]) -> dict[str, str]:
    """Only the tool's own fields, as strings (the catalog's slots); enum values that don't fit are dropped."""
    props = tool["parameters"].get("properties") or {}
    out: dict[str, str] = {}
    for k, v in (args or {}).items():
        if k not in props or v is None or v == "" or isinstance(v, (dict, list)):
            continue
        s = ("true" if v else "false") if isinstance(v, bool) else str(v).strip()[:300]
        enum = props[k].get("enum")
        if enum:
            hit = next((e for e in enum if e.lower() == s.lower()), None)
            if hit is None:
                continue
            s = hit
        out[k] = s
    return out


def missing_of(tool: dict[str, Any], args: dict[str, str]) -> list[str]:
    return [k for k in tool["parameters"].get("required") or [] if not args.get(k)]


def summary(entry: dict[str, Any] | None, tool: dict[str, Any], args: dict[str, str]) -> str:
    title = str((entry or {}).get("title") or tool["description"].split(".")[0])
    filled = ", ".join(f"{k} {v}" for k, v in args.items())
    s = f"{title}{' with ' + filled if filled else ''}"
    return s[:1].upper() + s[1:]


def _ask_for(entry: dict[str, Any] | None, field: str) -> str:
    for f in (entry or {}).get("fields") or []:
        if f.get("name") == field and f.get("ask"):
            return str(f["ask"])
    return f"What {field.replace('_', ' ')}?"


def answer_for(tool: dict[str, Any], entry: dict[str, Any] | None, args: dict[str, str], first: str, ask: str = "") -> dict[str, Any]:
    """A pick → the route's answer: ask for what is missing, else confirm, else run."""
    missing = missing_of(tool, args)
    base = {"ok": True, "mode": "claude", "command": tool["id"], "tool": tool["name"], "args": args, "missing": missing, "destructive": tool["destructive"]}
    if missing:
        q = ask.strip() or _ask_for(entry, missing[0])
        return {**base, "ask": q, "prompt": q, "run": False, "pending": {"command": tool["id"], "tool": tool["name"], "args": args, "missing": missing, "ask": q, "first": first}}
    if tool["confirm"]:
        p = f"{summary(entry, tool, args)}. Yes or no?"
        return {**base, "confirm": True, "prompt": p, "run": False, "pending": {"command": tool["id"], "tool": tool["name"], "args": args, "missing": [], "confirm": True, "first": first}}
    return {**base, "prompt": "", "run": True}


# ---------------------------------------------------------------- the call

def understand(text: str, *, llm: Any, entries: list[dict[str, Any]], status: Status, use_claude: bool, timeout_s: float,
               context: dict[str, Any] | None = None, pending: dict[str, Any] | None = None) -> dict[str, Any]:
    text = str(text or "").strip()[:MAX_TEXT]
    if not use_claude:
        return offline("off")  # nothing is sent to Claude, not even the probe
    if not text:
        return {"ok": False, "code": "invalid", "message": "send { text }"}
    by_id = {str(e.get("id")): e for e in entries if isinstance(e, dict)}

    # a confirm answer is a yes / no read here: no Claude call
    if pending and pending.get("confirm"):
        tool_id = str(pending.get("command") or "")
        entry = by_id.get(tool_id)
        if not entry or ct.is_person_only(entry):
            return offline("refused", "That command can't be run from here.")
        tool = ct.to_tool(entry)
        args = clean_args(tool, pending.get("args") or {})
        t = re.sub(r"[^a-z' ]+", " ", text.lower()).replace("'", " ").strip()
        if YES.match(t):
            return {"ok": True, "mode": "claude", "command": tool["id"], "tool": tool["name"], "args": args, "missing": [], "destructive": tool["destructive"], "confirmed": True, "prompt": "", "run": True}
        if NO.match(t):
            return {"ok": True, "mode": "claude", "command": tool["id"], "tool": tool["name"], "args": args, "missing": [], "cancelled": True, "prompt": "Cancelled.", "run": False}
        p = f"Yes or no? {summary(entry, tool, args)}."
        return {"ok": True, "mode": "claude", "command": tool["id"], "tool": tool["name"], "args": args, "missing": [], "destructive": tool["destructive"], "confirm": True, "prompt": p, "run": False, "pending": {**pending, "args": args}}

    if approvals_words(text) and not pending:
        return offline("approvals")
    if llm is None:
        status.fail("no-llm")
        return offline("no-llm")
    if status.cooling():
        return offline("cooldown")

    if pending and pending.get("command"):
        entry = by_id.get(str(pending["command"]))
        if not entry or ct.is_person_only(entry):
            return offline("refused", "That command can't be run from here.")
        tools = [ct.to_tool(entry)]
        prompt = FOLLOW_UP.format(first=str(pending.get("first") or "")[:MAX_TEXT], tool=tools[0]["name"], args=json.dumps(pending.get("args") or {}),
                                  missing=", ".join(pending.get("missing") or []) or "nothing", ask=str(pending.get("ask") or ""), answer=text)
        first = str(pending.get("first") or text)
    else:
        tools = ct.select_tools(entries, text)
        ctx = context or {}
        where = f" (Brett is on: {str(ctx.get('screen'))[:80]})" if ctx.get("screen") else ""
        prompt = f'Brett said: "{text}"{where}'
        first = text
    offered = ct.by_name(tools)

    pool = ThreadPoolExecutor(max_workers=1)
    fut = pool.submit(llm.complete, [{"role": "user", "content": prompt}], system=SYSTEM, tools=ct.provider_tools(tools), params={"temperature": 0, "max_tokens": 400})
    try:
        out = fut.result(timeout=max(1.0, float(timeout_s)))
    except FutureTimeout:
        status.fail("timeout", f"no answer in {timeout_s:g} s")
        return offline("timeout", f"Claude took longer than {timeout_s:g} seconds.")
    except Exception as e:  # noqa: BLE001 — classified, never raised
        msg = (str(e).strip("'\"") or e.__class__.__name__)[:300]
        reason = "no-credit" if NO_CREDIT.search(msg) else "error"
        status.fail(reason, msg)
        return offline(reason, f"{REASON_TEXT[reason]} {msg}"[:300])
    finally:
        pool.shutdown(wait=False)

    model = str((out or {}).get("model") or "")
    if not is_claude_model(model):
        status.fail("not-claude", f"answered by {model or 'an unknown model'}")
        return offline("not-claude", f"The AI assistant answered with {model or 'an unknown model'}, not Claude.")
    status.ok(model)
    pick = read_reply(out or {})
    if not pick:
        return offline("no-command")
    name, raw_args, ask = pick
    tool = offered.get(name) or next((t for t in offered.values() if t["id"] == name), None)
    if not tool:
        # a tool it was not offered: an approve / deny one, another command, or made up
        return offline("refused", f"Claude named {name[:60]}, which it may not run.")
    entry = by_id.get(tool["id"])
    args = clean_args(tool, {**((pending or {}).get("args") or {}), **raw_args}) if pending else clean_args(tool, raw_args)
    return answer_for(tool, entry, args, first, ask)
