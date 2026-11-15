"""Phone notifications for UI Review (build ui-review-notify-session-audio): one alert per group, read by the AmberX app.

Brett: "Anything that's ready for UI review, send me a notification through the AmberX." Plain code, no model: a
submit raises (or refreshes) the group's console alert (alert@1, source `ui-review`), AmberX's watch reads
`/api/alerts` and shows it on its high-importance channel, and a tap opens this group in UI Review through the alert's
`link`. Items decided = the alert resolves and the phone takes the notification away.

Switch: Claude setting `notify.uiReview` (Settings → Plugins → Claude). Off = no alert; nothing else changes.
"""
from __future__ import annotations

import os
from typing import Any, Iterable
from urllib.parse import quote

import console_context as cx
import plugin_services

KEY = "ui-review:group:"
PARAM = "axf-review-group"
LABEL = "UI Review"


def _console_url() -> str:
    return (os.environ.get("AXF_CONSOLE_PUBLIC_URL") or "https://console.amberxai.com").rstrip("/")


def enabled() -> bool:
    svc = plugin_services.get("axf.claude-settings@1")
    if svc is None:
        return True
    try:
        return next((s.get("value") for s in svc.get().get("settings") or [] if s.get("key") == "notify.uiReview"), True) is not False
    except Exception:  # noqa: BLE001 — a settings hiccup must not lose a notification
        return True


def link(group_id: str) -> str:
    return f"{_console_url()}/?{PARAM}={quote(group_id, safe='')}"


def waiting(doc: dict[str, Any], group_id: str) -> list[dict[str, Any]]:
    return [it for it in doc.get("items") or [] if isinstance(it, dict) and it.get("group") == group_id and it.get("status", "waiting") == "waiting"]


def message(group: dict[str, Any], items: list[dict[str, Any]]) -> dict[str, Any]:
    """The alert for a group with `items` waiting: the build's name (else the group's) and how many."""
    n = len(items)
    name = next((str(it.get("build")) for it in items if it.get("build")), "") or str(group.get("name") or "UI Review")
    gid = str(group.get("id") or "")
    return {"source": "ui-review", "severity": "warning", "key": KEY + gid, "title": f"{name}: {n} item{'' if n == 1 else 's'} waiting"[:200],
            "body": f"Ready for your review in {group.get('name') or name}. Tap to open it."[:300], "link": link(gid), "meta": {"label": LABEL, "group": gid, "count": n}}


def ready(doc: dict[str, Any], group: dict[str, Any]) -> None:
    """A group got new items: buzz. Resolved first, so an alert Brett already read comes back instead of staying read."""
    if not enabled():
        return
    items = waiting(doc, str(group.get("id") or ""))
    if not items:
        return
    try:
        cx.resolve_alerts([KEY + str(group["id"])])
        cx.raise_alert(message(group, items))
    except Exception as e:  # noqa: BLE001 — a failed notification never fails the submit
        cx.log("ui-review", f"phone notification failed: {str(e)[:200]}", "warn")


def decided(doc: dict[str, Any], group_ids: Iterable[str]) -> None:
    """Items were decided: a group with nothing waiting loses its notification, the others show the new count."""
    groups = {g.get("id"): g for g in doc.get("groups") or [] if isinstance(g, dict)}
    for gid in {g for g in group_ids if g}:
        items = waiting(doc, gid)
        try:
            if not items:
                cx.resolve_alerts([KEY + gid])
            elif enabled() and gid in groups:
                cx.raise_alert(message(groups[gid], items))
        except Exception as e:  # noqa: BLE001
            cx.log("ui-review", f"phone notification update failed: {str(e)[:200]}", "warn")
