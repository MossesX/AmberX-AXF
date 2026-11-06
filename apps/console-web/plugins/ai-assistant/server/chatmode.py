"""Chat mode (Nov 5 2026, Brett: "So we didn't load the tools, so I could talk quick"): how one chat turn runs.

A plain message is a *chat* turn: no tool definitions, a short prompt, the fastest model the policy allows, nothing else
loaded. A message that needs live data or an action is a *tools* turn with only the relevant tool groups, and the next
message drops back to chat. Two checks decide, the first costs nothing and the second costs nothing unless it fires:

  1. decide()  plain-code words (editable in settings): action verbs where a sentence starts, live-data words anywhere.
  2. Guard     a chat turn the words missed: the model answers with MARKER instead of guessing, and the turn is run
               again with tools before anything of it is shown.

Pure, no I/O and no provider knowledge: the turn engine (server/__init__.py) applies the Route.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any

from axf.contracts.assistant import TOOL_MODES

MARKER = "[[tools]]"

DEFAULTS: dict[str, Any] = {
    # auto: tools load per turn. chat: never (a chat can still choose). tools: always, the full Claude Code session.
    "default": "auto",
    # count where a sentence starts ("check the queue", "can you check the queue"), so "I'd check that out" stays chat
    "actionWords": ["check", "open", "show me", "show", "run", "deploy", "redeploy", "restart", "merge", "land", "queue", "build", "rebuild",
                    "add", "remove", "delete", "install", "update", "fix", "find", "search", "look up", "look at", "read", "list", "edit", "change", "switch",
                    "turn on", "turn off", "set", "send", "pull up", "take me to", "do the", "do a", "do an", "do it", "do that", "do this"],
    # count anywhere in the message
    "liveWords": ["builds", "building", "orchestrator", "pending", "queue", "merge", "pr", "prs", "pull request", "ci", "github", "commit", "branch",
                  "vps", "server", "docker", "container", "containers", "deployed", "logs", "disk", "dns", "subdomain", "repo", "repository", "codebase",
                  "ui review", "banner", "banners", "crew", "is main", "on main", "main green", "how's main", "status", "do it", "do that", "do this",
                  "go ahead", "please do", "run it", "the console", "plugin"],
    # a chat turn may ask for tools itself (MARKER)
    "escalate": True,
    # policy: the fastest model the model policy allows on Claude providers. conversation: the chat's own model.
    "model": "policy",
    "historyMessages": 16,
    # how long a chat keeps its agent, persona and memory before reading them again
    "cacheSec": 600,
}

# Words that may come before the action: "hey gizmo, can you please check…"
_LEAD = re.compile(r"^(?:hey|hi|yo|ok|okay|alright|so|and|now|then|please|just|gizmo|amber|amberx|go|can you|could you|would you|will you|let's|lets|i need you to|i want you to|you should|you gotta)\b[,:]?\s+", re.I)
_SENTENCE = re.compile(r"[.!?\n]+")


def normalize(raw: Any) -> dict[str, Any]:
    """A config value with every key present and in range (a broken save never breaks a chat)."""
    r = raw if isinstance(raw, dict) else {}
    out = {**DEFAULTS, **{k: v for k, v in r.items() if k in DEFAULTS}}
    out["default"] = out["default"] if out["default"] in TOOL_MODES else "auto"
    out["model"] = out["model"] if out["model"] in ("policy", "conversation") else "policy"
    for k in ("actionWords", "liveWords"):
        out[k] = ([str(w).strip().lower()[:60] for w in out[k] if str(w).strip()] if isinstance(out[k], list) else list(DEFAULTS[k]))[:300]
    out["escalate"] = bool(out["escalate"])
    out["historyMessages"] = max(2, min(int(out["historyMessages"] or 16), 200))
    out["cacheSec"] = max(0, min(int(out["cacheSec"] or 0), 86_400))
    return out


def _has(text: str, word: str) -> bool:
    return re.search(rf"(?<![\w-]){re.escape(word)}(?![\w-])", text) is not None


def _sentences(text: str) -> list[str]:
    out = []
    for s in _SENTENCE.split(text):
        s = s.strip()
        while True:
            t = _LEAD.sub("", s, count=1)
            if t == s:
                break
            s = t
        if s:
            out.append(s)
    return out


def needs_tools(text: str, conf: dict[str, Any], tool_names: list[str] | None = None) -> str:
    """The word that makes this message a tools turn, or '' for plain talk."""
    t = re.sub(r"[’`]", "'", text or "").lower()
    for s in _sentences(t):
        for w in conf["actionWords"]:
            if s == w or s.startswith(w + " ") or s.startswith(w + ","):
                return w
    for w in [*conf["liveWords"], *(n.lower() for n in tool_names or [])]:
        if _has(t, w):
            return w
    return ""


def pick_groups(text: str, groups: list[dict[str, Any]], names: list[str]) -> tuple[list[str], set[str] | None]:
    """Which tool groups a message needs: (their names, the tools to load). Tools in no group always load, they are
    small and generic. No group matched: every tool (None), because the turn already needs tools and a wrong guess
    would leave the model without the one it wants."""
    t = (text or "").lower()
    hit = [g for g in groups if any(_has(t, str(w).lower()) for w in g.get("triggers") or [])]
    if not hit:
        return [], None
    grouped = {n for g in groups for n in g.get("tools") or []}
    return [str(g.get("name") or g.get("id")) for g in hit], {n for g in hit for n in g.get("tools") or []} | {n for n in names if n not in grouped}


@dataclass
class Route:
    mode: str  # chat | tools
    reason: str = ""
    groups: list[str] = field(default_factory=list)
    names: set[str] | None = None  # tools to load; None = all of them
    lean: bool = True  # False: the full Claude Code session (forced tools)
    escalate: bool = False  # a chat turn that may ask for tools
    escalated: bool = False

    def public(self) -> dict[str, Any]:
        return {"mode": self.mode, "reason": self.reason, **({"groups": self.groups} if self.groups else {}), **({"escalated": True} if self.escalated else {})}


def tools_route(text: str, groups: list[dict[str, Any]], names: list[str], reason: str, escalated: bool = False) -> Route:
    picked, load = pick_groups(text, groups, names)
    return Route("tools", reason, picked, load, escalated=escalated)


def decide(text: str, setting: Any, conf: dict[str, Any], *, images: bool = False, groups: list[dict[str, Any]] | None = None, names: list[str] | None = None) -> Route:
    """How this turn runs. `setting`: the chat's toolMode ('' = the configured default); `names`: the tools this caller
    may use (none = chat, whatever else is asked)."""
    groups, names = groups or [], names or []
    mode = setting if setting in TOOL_MODES else conf["default"]
    if not names:
        return Route("chat", "no tools in this chat")
    if mode == "chat":
        return Route("chat", "chat mode is forced")
    if mode == "tools":
        return Route("tools", "tools are forced", lean=False)
    if images:
        return Route("tools", "an image is attached")
    word = needs_tools(text, conf, names)
    if word:
        return tools_route(text, groups, names, f"asked: {word}")
    return Route("chat", "plain talk", escalate=bool(conf["escalate"]))


class Guard:
    """Filters a chat turn's streamed text: passes it through at once, holding back only what could be the start of
    MARKER. `feed` returns (text to show, the model asked for tools)."""

    def __init__(self, on: bool):
        self.on = on
        self.buf = ""

    def feed(self, text: str) -> tuple[str, bool]:
        if not self.on:
            return text, False
        self.buf += text
        i = self.buf.find(MARKER)
        if i >= 0:
            out, self.buf = self.buf[:i], ""
            return out, True
        for n in range(min(len(MARKER) - 1, len(self.buf)), 0, -1):
            if self.buf.endswith(MARKER[:n]):
                out, self.buf = self.buf[:-n], self.buf[-n:]
                return out, False
        out, self.buf = self.buf, ""
        return out, False

    def flush(self) -> str:
        out, self.buf = self.buf, ""
        return out


def chat_system(identity: str, who: str, route: Route, *, voice: bool = False, instructions: str = "", memory: str = "", context: str = "", when: float | None = None) -> str:
    """The short prompt of a chat turn."""
    parts = [identity.strip(), f"You're in quick chat with {who}: answer straight away, like a friend on the phone. One to three short sentences unless asked for more."]
    if voice:
        parts.append("Your reply is spoken aloud: plain sentences, no markdown, no lists.")
    if route.escalate:
        parts.append(f"You have no tools and no live data in this turn. If you're asked to do something, or for anything live or that has to be looked up (builds, PRs, CI, files, the server, the console, any current status), reply with exactly {MARKER} and nothing else: the tools load and you answer then. Never guess or invent live facts.")
    else:
        parts.append("You have no tools and no live data in this chat. If something needs them, say so in one line. Never guess or invent live facts.")
    if instructions.strip():
        parts.append(f"Instructions: {instructions.strip()[:600]}")
    if memory.strip():
        parts.append(f"What you remember (use it when it helps):\n{memory.strip()[:1500]}")
    if context.strip():
        parts.append(context.strip()[:6000])
    parts.append(f"It is {time.strftime('%A %B %d, %Y, %H:%M %Z', time.localtime(when))}.")
    return "\n\n".join(parts)
