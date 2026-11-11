"""Per-agent console API control (agent-api-access@1) — who may drive the console through its API.

Brett (Nov 10 2026): "I want the individual agents and the AI assistant to have API access, not all of them, just a
couple. I need to be able to give it to them in their employee control panel. Give Amber and Molly control by default."

Console API / control access is a permission per agent, off by default. Each grant has scopes:

    screens   open screens, dialogs and deep links (console_show / console_open)
    settings  read and change settings (control@1 tokens, plugin settings)
    commands  run console commands and plugin commands
    builds    file and queue builds (build orchestrator)

`amber` is the AI assistant itself (no agent picked in its chat); every other id is an Agent manager agent or a crew
member from `axf.swarm-roster@1`. Amber and Molly are on with every scope until someone changes them; everyone else is
off. Every change is audited (who, when, from, to, why) in the same file and shows on the employee card.

    <dataDir>/api-access.json   {"$axf": "agent-api-access@1", "agents": {id: grant}, "audit": [change, …]}

Capability `axf.agent-api@1` (provided in __init__.py): `grant(id)`, `allowed(id, scope)`, `scopes(id)`, `set(...)`,
`list()`, `audit(id)`. The AI assistant asks it which console tools the agent picked in its chat may use.
"""
from __future__ import annotations

from typing import Any

from . import store

FORMAT = "agent-api-access@1"
FILE = "api-access.json"
ASSISTANT_ID = "amber"
SCOPES: list[dict[str, str]] = [
    {"id": "screens", "label": "Open screens", "hint": "Open screens, dialogs and deep links (console_show / console_open)."},
    {"id": "settings", "label": "Change settings", "hint": "Read and change settings (control@1 tokens, plugin settings)."},
    {"id": "commands", "label": "Run commands", "hint": "Run console commands and plugin commands."},
    {"id": "builds", "label": "File and queue builds", "hint": "File, queue and start builds in the build orchestrator."},
]
SCOPE_IDS = [s["id"] for s in SCOPES]
DEFAULT_ON = {ASSISTANT_ID, "molly"}
AUDIT_MAX = 500


def _path():
    return store.DATA / FILE


def _load() -> dict[str, Any]:
    d = store._read(_path(), {})  # noqa: SLF001 — the store's own private-file reader (0600, same folder)
    if not isinstance(d, dict):
        d = {}
    return {"$axf": FORMAT, "agents": d.get("agents") if isinstance(d.get("agents"), dict) else {},
            "audit": d.get("audit") if isinstance(d.get("audit"), list) else []}


def _save(d: dict[str, Any]) -> None:
    d["audit"] = d["audit"][-AUDIT_MAX:]
    store._write(_path(), d)  # noqa: SLF001


def default_grant(agent_id: str) -> dict[str, Any]:
    on = agent_id in DEFAULT_ON
    return {"on": on, "scopes": list(SCOPE_IDS) if on else [], "default": True, "by": "", "at": 0, "note": ""}


def clean_scopes(scopes: Any) -> list[str]:
    if scopes is None:
        return list(SCOPE_IDS)
    if not isinstance(scopes, (list, tuple)):
        raise ValueError("scopes must be a list")
    bad = [s for s in scopes if s not in SCOPE_IDS]
    if bad:
        raise ValueError(f"unknown scope {', '.join(map(str, bad))}; scopes are {', '.join(SCOPE_IDS)}")
    return [s for s in SCOPE_IDS if s in scopes]


def grant(agent_id: str) -> dict[str, Any]:
    """The agent's grant: its saved record, or the default (Amber and Molly on, everyone else off)."""
    aid = str(agent_id or ASSISTANT_ID)
    rec = _load()["agents"].get(aid)
    if not isinstance(rec, dict):
        return {"agent": aid, **default_grant(aid)}
    on = bool(rec.get("on"))
    return {"agent": aid, "on": on, "scopes": clean_scopes(rec.get("scopes") or []) if on else [], "default": False,
            "by": str(rec.get("by") or ""), "at": int(rec.get("at") or 0), "note": str(rec.get("note") or "")}


def scopes(agent_id: str) -> list[str]:
    g = grant(agent_id)
    return list(g["scopes"]) if g["on"] else []


def allowed(agent_id: str, scope: str) -> bool:
    return scope in scopes(agent_id)


def set_grant(agent_id: str, on: bool, scope_list: Any = None, *, by: str = "console", source: str = "console", reason: str = "") -> dict[str, Any]:
    """Turn an agent's API control on or off (and pick its scopes); audited. Turning on with no scopes means all."""
    aid = str(agent_id or "").strip()
    if not aid or not store.ID_RE.match(aid):
        raise ValueError("a valid agent id is required")
    picked = clean_scopes(scope_list) if on else []
    if on and not picked:
        raise ValueError("pick at least one scope, or turn API control off")
    before = grant(aid)
    after = {"on": bool(on), "scopes": picked, "by": str(by or "console")[:80], "at": store.now_ms(), "note": str(reason or "")[:300]}
    with store._lock:  # noqa: SLF001
        d = _load()
        d["agents"][aid] = after
        if (before["on"], before["scopes"]) != (after["on"], after["scopes"]):
            d["audit"].append({"at": after["at"], "agent": aid, "by": after["by"], "source": str(source or "")[:40],
                               "from": {"on": before["on"], "scopes": before["scopes"]}, "to": {"on": after["on"], "scopes": picked},
                               "reason": after["note"]})
        _save(d)
    return grant(aid)


def reset(agent_id: str, *, by: str = "console", source: str = "console", reason: str = "") -> dict[str, Any]:
    """Back to the default for this agent (Amber and Molly on, everyone else off); audited."""
    aid = str(agent_id or "").strip()
    before = grant(aid)
    with store._lock:  # noqa: SLF001
        d = _load()
        d["agents"].pop(aid, None)
        after = default_grant(aid)
        if (before["on"], before["scopes"]) != (after["on"], after["scopes"]):
            d["audit"].append({"at": store.now_ms(), "agent": aid, "by": str(by)[:80], "source": str(source)[:40],
                               "from": {"on": before["on"], "scopes": before["scopes"]}, "to": {"on": after["on"], "scopes": after["scopes"]},
                               "reason": (str(reason or "") or "reset to default")[:300]})
        _save(d)
    return grant(aid)


def audit(agent_id: str = "", limit: int = 100) -> list[dict[str, Any]]:
    rows = [r for r in _load()["audit"] if not agent_id or r.get("agent") == agent_id]
    return list(reversed(rows))[: max(1, min(int(limit or 100), AUDIT_MAX))]


def last_change(agent_id: str) -> dict[str, Any] | None:
    rows = audit(agent_id, 1)
    return rows[0] if rows else None


def summary(g: dict[str, Any]) -> str:
    """One line for cards and voice: 'on: open screens, change settings' or 'off'."""
    if not g.get("on"):
        return "off"
    labels = [s["label"].lower() for s in SCOPES if s["id"] in g.get("scopes", [])]
    return "on: " + (", ".join(labels) if len(labels) < len(SCOPE_IDS) else "full")


def roster(agents: list[dict[str, Any]], crew: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Everyone who can hold a grant: Amber (the AI assistant), the Agent manager agents, then the crew."""
    out: list[dict[str, Any]] = [{"id": ASSISTANT_ID, "name": "Amber", "kind": "assistant", "role": "AI assistant"}]
    seen = {ASSISTANT_ID}
    for a in agents:
        if a.get("id") and a["id"] not in seen:
            seen.add(a["id"])
            out.append({"id": a["id"], "name": a.get("name") or a["id"], "kind": "agent", "role": a.get("description") or ""})
    for a in crew:
        if a.get("id") and a["id"] not in seen:
            seen.add(a["id"])
            out.append({"id": a["id"], "name": a.get("name") or a["id"], "kind": "crew", "role": a.get("role") or ""})
    rows = []
    for r in out:
        g = grant(r["id"])
        rows.append({**r, "grant": g, "summary": summary(g), "lastChange": last_change(r["id"])})
    return rows
