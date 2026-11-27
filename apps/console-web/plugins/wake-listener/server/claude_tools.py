"""Voice command catalog → Claude tools (wake-listener Claude mode; build voice-listener-use-claude-when-connected).

Each catalog entry (catalog.mjs `buildCatalog`: built-ins, plugin-commands@1 registry commands, control@1 targets) becomes
one tool: a safe name with a map back to the entry id, a description, a JSON input schema made from the entry's fields,
and the flags the router reads:

  destructive  the entry deletes / resets something;
  confirm      destructive, or the catalog says it is said back first (like the scripted wizard): Claude's pick returns
               `confirm: true` and runs only after a spoken yes;
  personOnly   a decision only Brett makes (approve, deny, reject, veto…): never offered as a tool. Spoken approvals keep
               their own path (the approvals review and the approvals-banner relay).

Pure: no I/O, no plugin names. Tests: test.py.
"""
from __future__ import annotations

import re
from typing import Any, Iterable

# The console's own word lists for destructive and deciding commands (apps/console-web/src/control/actions.ts
# DESTRUCTIVE_RE / DECIDING_RE), kept in step here.
DESTRUCTIVE_RE = re.compile(r"(^|[.:_/-])(delete|remove|purge|wipe|reset|uninstall|drop|clear|discard|revoke|destroy|erase|kill|force-?push|hard-?delete)([.:_/-]|$)", re.I)
DECIDING_RE = re.compile(r"(^|[.:_/-])(approve|approvals|deny|decline|reject|veto|shelve|decide|sign-?off)([.:_/-]|$)", re.I)
# Spoken approval words: these never go to Claude (s7), whatever the catalog says.
APPROVAL_WORDS = re.compile(r"\b(approve|approval|approvals|deny|denied|decline|reject|veto)\b", re.I)

NAME_RE = re.compile(r"[^a-zA-Z0-9_-]+")
MAX_NAME = 64
MAX_DESC = 300
MAX_TOOLS = 64
RANKED = 40
TYPES = {"string": "string", "number": "number", "boolean": "boolean", "duration": "string"}
_WORD = re.compile(r"[a-z0-9]+")
_STOP = {"the", "a", "an", "to", "of", "and", "my", "me", "for", "on", "in", "it", "is", "please", "can", "you", "set", "turn"}


def tool_name(entry_id: str, taken: set[str] | None = None) -> str:
    """`project-wizard/run` → `project-wizard__run`; `control:amberx.items:note` → `control__amberx_items__note`. Unique in `taken`."""
    base = NAME_RE.sub("_", entry_id.replace("/", "__").replace(":", "__").replace(".", "_")).strip("_")[:MAX_NAME] or "command"
    name, i = base, 2
    while taken is not None and name in taken:
        suffix = f"_{i}"
        name = base[: MAX_NAME - len(suffix)] + suffix
        i += 1
    if taken is not None:
        taken.add(name)
    return name


def is_person_only(entry: dict[str, Any]) -> bool:
    """A decision only Brett makes: approve / deny / reject / veto commands and the approvals group."""
    if entry.get("personOnly") is True or entry.get("group") == "approvals":
        return True
    eid = str(entry.get("id") or "")
    run = entry.get("run") or {}
    return bool(DECIDING_RE.search(eid) or DECIDING_RE.search(str(run.get("action") or "")) or DECIDING_RE.search(str((run.get("command") or {}).get("action") or "")))


def is_destructive(entry: dict[str, Any]) -> bool:
    """Deletes or resets something."""
    if entry.get("effect") == "destructive":
        return True
    eid = str(entry.get("id") or "")
    run = entry.get("run") or {}
    return bool(DESTRUCTIVE_RE.search(eid) or DESTRUCTIVE_RE.search(str(run.get("action") or "")) or (run.get("command") or {}).get("op") == "remove")


def input_schema(fields: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """The entry's fields → a JSON schema object: type, enum, the field's question as its description, required ones."""
    props: dict[str, Any] = {}
    required: list[str] = []
    for f in fields or []:
        name = str(f.get("name") or "")
        if not name or not re.fullmatch(r"[a-zA-Z0-9_.-]{1,64}", name):
            continue
        p: dict[str, Any] = {"type": TYPES.get(str(f.get("type") or "string"), "string")}
        desc = str(f.get("ask") or "").strip()
        if f.get("type") == "duration":
            desc = (desc + " Say it as words, e.g. two hours.").strip()
        if desc:
            p["description"] = desc[:200]
        if isinstance(f.get("enum"), list) and f["enum"]:
            p["enum"] = [str(v) for v in f["enum"]][:30]
            p["type"] = "string"
        props[name] = p
        if not f.get("optional"):
            required.append(name)
    out: dict[str, Any] = {"type": "object", "properties": props, "additionalProperties": False}
    if required:
        out["required"] = required
    return out


def describe(entry: dict[str, Any]) -> str:
    title = str(entry.get("title") or entry.get("id") or "").strip()
    say = [s for s in entry.get("say") or [] if isinstance(s, str)]
    bits = [title]
    if say:
        bits.append(f'Said like: "{say[0]}"')
    if entry.get("group"):
        bits.append(f"Group: {entry['group']}")
    if entry.get("effect") in ("read", "navigate"):
        bits.append("Read only." if entry["effect"] == "read" else "Opens a screen.")
    return ". ".join(b.rstrip(".") for b in bits if b)[:MAX_DESC]


def to_tool(entry: dict[str, Any], taken: set[str] | None = None) -> dict[str, Any]:
    """One catalog entry → one tool: {name, description, parameters, id, destructive, confirm, personOnly}. The provider
    reads name / description / parameters; the rest stays on this side."""
    return {
        "name": tool_name(str(entry.get("id") or ""), taken),
        "description": describe(entry),
        "parameters": input_schema(entry.get("fields") or []),
        "id": str(entry.get("id") or ""),
        "destructive": is_destructive(entry),
        "confirm": is_destructive(entry) or entry.get("confirm") is True,
        "personOnly": is_person_only(entry),
    }


def tools_from_catalog(entries: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Every entry → a tool, personOnly ones left out (never offered to Claude)."""
    taken: set[str] = set()
    out = []
    for e in entries or []:
        if not isinstance(e, dict) or not e.get("id"):
            continue
        if is_person_only(e):
            continue
        out.append(to_tool(e, taken))
    return out


def _words(s: str) -> set[str]:
    return {w for w in _WORD.findall(s.lower()) if w not in _STOP and len(w) > 1}


def select_tools(entries: list[dict[str, Any]], transcript: str, ranked: int = RANKED, cap: int = MAX_TOOLS) -> list[dict[str, Any]]:
    """The tools for one request: built-ins and phrasebook entries always, plus the `ranked` registry / control entries
    sharing the most words with what was said (the catalog has ~1000 entries; one request can't carry them all)."""
    said = _words(transcript)
    core: list[dict[str, Any]] = []
    scored: list[tuple[float, int, dict[str, Any]]] = []
    for i, e in enumerate(entries or []):
        if not isinstance(e, dict) or not e.get("id") or is_person_only(e):
            continue
        if (e.get("run") or {}).get("kind") == "voice" or e.get("source") in ("builtin", "phrasebook"):
            core.append(e)
            continue
        hay = _words(" ".join([str(e.get("id") or ""), str(e.get("title") or ""), " ".join(e.get("say") or [])]))
        hit = len(said & hay)
        if hit:
            scored.append((hit / (1 + len(hay) ** 0.5), -i, e))
    scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
    picked = core + [e for _, _, e in scored[:ranked]]
    return tools_from_catalog(picked[:cap])


def provider_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """What the model sees: name, description, parameters only."""
    return [{"name": t["name"], "description": t["description"], "parameters": t["parameters"]} for t in tools]


def by_name(tools: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {t["name"]: t for t in tools}
