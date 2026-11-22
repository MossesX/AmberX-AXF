"""Approvals pop up on the phone (Brett, Nov 20 2026), with the console closed.

The console's banner and Approvals screen read axHub's approvals feed from Brett's browser, so nothing saw a new approval
while no console was open. This watcher runs in the console server instead: every few seconds, while a paired phone is
online and the Approval prompts switch is on, it reads the same feed through the approvals relay (capability
approvals-relay@1, the console's own owner sign-in to the hub) and queues one `approval` command per new approval or
veto countdown. The phone shows a high-priority notification with Approve and Deny on it.

Nothing here decides. The command only *shows* the prompt (phone-connect@1: a command never carries a decision); the
decision is Brett's tap on the phone, arriving over the device token and checked personOnly by the engine before the
relay passes it to the hub (service.take_reply → relay_decision).

One prompt per approval: `approvals.json` remembers what was pushed. A prompt whose command failed before Brett saw it
(the phone dropped off, the ttl ran out) is sent again while the approval still waits, at most MAX_PUSHES times.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Any

from . import engine as E
from . import service as svc
from . import store as S

POLL_S = 5.0  # the same beat the console banner reads the feed at (lib-approvals APPROVALS_POLL_MS)
MAX_PUSHES = 3
FORGET_S = 86400  # an approval gone from the feed this long is dropped from approvals.json
BY = {"kind": "service", "who": "approvals", "via": "hub"}
# the hub's words → the prompt's actions (phone-connect@1 APPROVAL_ACTIONS); the relay maps them back
PLAIN_ACTIONS = {"approve": "approve", "decline": "deny", "deny": "deny"}
VETO_ACTIONS = {"deny": "deny", "approve-now": "approve", "shelve": "shelve"}


def arguments(item: dict[str, Any]) -> dict[str, Any]:
    """One feed item (approvals-relay@1 `pending()`) → the `approval` command's arguments."""
    veto = item.get("kind") == "veto"
    words = VETO_ACTIONS if veto else PLAIN_ACTIONS
    actions = list(dict.fromkeys(words[a] for a in item.get("actions") or [] if a in words)) or (["deny"] if veto else ["approve", "deny"])
    args: dict[str, Any] = {"approvalId": item["id"], "kind": "veto" if veto else "approval", "actions": actions}
    for k, cap in (("tool", "tool"), ("title", "title"), ("summary", "summary")):
        v = str(item.get(k) or "").strip()[: E.LIMITS[cap]]
        if v:
            args[k] = v
    left = item.get("secondsLeft")
    if veto and isinstance(left, int) and not isinstance(left, bool) and 0 < left <= 86400:
        args["secondsLeft"] = left
    rev = item.get("rev")
    if isinstance(rev, int) and not isinstance(rev, bool) and 0 <= rev <= E.LIMITS["revMax"]:
        args["rev"] = rev
    return args


def ttl(item: dict[str, Any], at: str) -> int:
    """How long the prompt may be answered: a running countdown's seconds, else until the approval expires (≤ 1 h)."""
    top = E.LIMITS["ttlMax"]
    left = item.get("secondsLeft")
    if item.get("kind") == "veto" and not item.get("shelved") and isinstance(left, int) and left > 0:
        return max(1, min(left, top))
    exp = item.get("expiresAt")
    if E.is_timestamp(exp):
        return max(1, min(int((E.ms(exp) - E.ms(at)) / 1000), top))
    return top


def tick(at: str = "") -> dict[str, Any]:
    """One pass: read what waits, push what the phone has not been shown. Never raises; says what it did."""
    at = at or svc.now()
    if not S.feature_on("approval"):
        return _note({"ok": True, "watching": False, "message": "Approval prompts are switched off."}, at)
    d = svc.default_device()
    if not d or not E.is_online(d, at):
        return _note({"ok": True, "watching": False, "message": "No phone is online, so approvals wait in the console and on axHub."}, at)
    relay = svc._relay()  # noqa: SLF001
    if relay is None or not hasattr(relay, "pending"):
        return _note({"ok": False, "watching": False, "code": "unavailable", "message": "The approvals banner plugin is off, so the console can't read what waits on axHub."}, at)
    owner = (d.get("owner") or {}).get("who", "") if isinstance(d.get("owner"), dict) else ""
    try:
        feed = relay.pending(owner)
    except Exception as e:  # noqa: BLE001 — a relay that throws never stops the watcher
        feed = {"ok": False, "code": "unexpected", "message": f"The approvals relay failed ({type(e).__name__})."}
    if not feed.get("ok"):
        return _note({"ok": False, "watching": False, "code": feed.get("code", "unexpected"), "message": str(feed.get("message") or "The hub's approvals could not be read.")[:300]}, at)
    items = [i for i in feed.get("items") or [] if isinstance(i, dict) and E.is_uuid(i.get("id"))]
    pushed_now: list[str] = []
    errors: list[str] = []
    with S.LOCK:
        state = S.approvals()
        pushed: dict[str, Any] = state["pushed"]
        waiting = {i["id"] for i in items}
        for i in items:
            rec = pushed.get(i["id"])
            if rec and not _again(rec):
                rec["seenAt"] = at
                continue
            try:
                r = svc.send("approval", arguments(i), BY, d["deviceId"], ttl=ttl(i, at), at=at)
            except svc.PhoneError as e:
                errors.append(e.err["message"])  # offline, feature off, an old app: tried again on the next pass
                continue
            pushed[i["id"]] = {"at": at, "seenAt": at, "commandId": r["id"], "kind": i.get("kind", "approval"), "pushes": int((rec or {}).get("pushes") or 0) + 1}
            pushed_now.append(i["id"])
        for aid in [a for a, rec in pushed.items() if a not in waiting and (E.ms(at) - E.ms(rec.get("seenAt") or rec["at"])) / 1000 > FORGET_S]:
            del pushed[aid]
        S.save_approvals({"pushed": pushed})
    for aid in pushed_now:
        S.log({"at": at, "op": "approval-push", "approvalId": aid})
    return _note({"ok": not errors, "watching": True, "waiting": len(items), "pushed": pushed_now,
                  "message": errors[0] if errors else f"{len(items)} waiting on axHub, {len(pushed_now)} new on the phone."}, at)


def _again(rec: dict[str, Any]) -> bool:
    """Push once more? Only when the last prompt failed before it was answered and the cap is not reached."""
    c = S.command(str(rec.get("commandId") or ""))
    return bool(c) and c.get("status") == "failed" and int(rec.get("pushes") or 1) < MAX_PUSHES


_last: dict[str, Any] = {"ok": True, "watching": False, "message": "The approvals watcher has not run yet.", "at": ""}


def _note(r: dict[str, Any], at: str) -> dict[str, Any]:
    global _last
    _last = {**r, "at": at}
    return _last


def last() -> dict[str, Any]:
    """What the last pass did (status → `approvals`)."""
    return dict(_last)


# ---- the watcher thread (one per console server)

_thread: threading.Thread | None = None
_stop = threading.Event()


def _enabled() -> bool:
    try:
        import console_context as cx
        return bool(cx.plugin_enabled(S.FOLDER))
    except Exception:  # noqa: BLE001 — outside the console (tests) there is no plugin switch
        return True


def _run() -> None:
    while not _stop.wait(POLL_S):
        try:
            if _enabled():
                tick()
        except Exception:  # noqa: BLE001 — the watcher outlives any one bad pass
            time.sleep(POLL_S)


def start() -> bool:
    """Starts the watcher once. `AXF_PHONE_CONNECT_APPROVALS=off` keeps it off (self-tests drive `tick` themselves)."""
    global _thread
    if (os.environ.get("AXF_PHONE_CONNECT_APPROVALS") or "").strip().lower() == "off":
        return False
    if _thread is not None and _thread.is_alive():
        return True
    _stop.clear()
    _thread = threading.Thread(target=_run, name="phone-connect-approvals", daemon=True)
    _thread.start()
    return True


def stop() -> None:
    _stop.set()
