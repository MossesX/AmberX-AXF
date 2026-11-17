"""Event feeds: how events outside the builds store reach the prompt engine.

  - emit(): any plugin fires an event without waiting for it (`plugin_services.get("axf.prompt-engine@1").emit(...)`).
    The engine runs in a node subprocess, so the producer (a UI Review submit, a push-banner merge) never waits on it
    and never fails because of it. Producers wired today: ui-review (ui-review.submitted / ui-review.decided),
    push-banner (merge.clash / merge.ci-failed when a merge or a Pull main in fails).
  - approvals(): axHub's held veto calls and waiting approvals, read through axf.approvals-feed@1 (approvals-banner,
    the console's owner sign-in) on the engine's tick; each approval id fires approval.held / approval.waiting once.
  - voice.phrase and custom events come in through the plugin's own commands (POST /voice, POST /fire), webhooks
    through POST /webhook/{hook}, schedules through the tick.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Callable

FEED_CAP = "axf.approvals-feed@1"
SEEN_MAX = 500


def classify_failure(failure: str) -> str:
    """The merge-queue event a push-banner failure is: merge.clash (conflicts), merge.ci-failed, or '' (neither)."""
    f = (failure or "").lower()
    if "conflict" in f:
        return "merge.clash"
    if "ci failed" in f or ("ci " in f and "fail" in f):
        return "merge.ci-failed"
    return ""


def emit_async(fire: Callable[[dict[str, Any], str], Any], event: dict[str, Any], by: str) -> threading.Thread:
    """fire(event, by) on a daemon thread; errors are swallowed (a feed never breaks its producer)."""
    def go() -> None:
        try:
            fire(event, by)
        except Exception:  # noqa: BLE001
            pass

    t = threading.Thread(target=go, name="prompt-engine-emit", daemon=True)
    t.start()
    return t


def _seen_file(data: Path) -> Path:
    return data / "feeds.json"


def _load_seen(data: Path) -> list[str]:
    try:
        v = json.loads(_seen_file(data).read_text())
        return [str(x) for x in v.get("approvals", [])] if isinstance(v, dict) else []
    except Exception:  # noqa: BLE001
        return []


def _save_seen(data: Path, seen: list[str]) -> None:
    data.mkdir(parents=True, exist_ok=True)
    _seen_file(data).write_text(json.dumps({"approvals": seen[-SEEN_MAX:]}))


def approval_events(items: list[dict[str, Any]], seen: list[str]) -> tuple[list[dict[str, Any]], list[str]]:
    """New feed items → approval.held / approval.waiting events; returns (events, seen ids after)."""
    out: list[dict[str, Any]] = []
    now_seen = list(seen)
    for it in items:
        aid = str(it.get("id") or "")
        kind = "held" if it.get("kind") == "held" else "waiting"
        key = f"{aid}:{kind}"
        if not aid or key in now_seen:
            continue
        now_seen.append(key)
        approval = {"id": aid, "tool": it.get("tool", ""), "summary": it.get("summary") or it.get("title", ""), "by": it.get("by", "")}
        if kind == "held":
            approval["secondsLeft"] = it.get("secondsLeft", 0)
        out.append({"source": "approvals", "event": f"approval.{kind}", "id": key, "payload": {"approval": approval}, "by": "axhub"})
    return out, now_seen


def approvals(get_cap: Callable[[str], Any], data: Path, fire: Callable[[dict[str, Any], str], Any]) -> dict[str, Any]:
    """One poll of axHub's approvals feed (tick). Fires each new held call / approval once."""
    feed = get_cap(FEED_CAP)
    if feed is None or not hasattr(feed, "pending"):
        return {"ok": False, "why": "no approvals feed (approvals-banner off)"}
    res = feed.pending()
    if not isinstance(res, dict) or not res.get("ok"):
        return {"ok": False, "why": (res or {}).get("message", "feed failed") if isinstance(res, dict) else "feed failed"}
    events, seen = approval_events(res.get("items") or [], _load_seen(data))
    for ev in events:
        fire(ev, "axhub")
    if events:
        _save_seen(data, seen)
    return {"ok": True, "fired": len(events)}
