"""UI Review in the decision dialog (decisions@1; build decision-dialog-ui-review-other, Nov 13 2026).

Brett: "anytime something goes to UI review I'm gonna get a notification, and another type of dialogue just pops up".
A submitted item raises a `ui-review` decision through the capability decisions@1 (absent = nothing happens, the queue
and its own notification stay as they are); deciding it in UI Review takes the decision back. His answer in the dialog
comes back through `answer`: Approve / Request changes / Reject on the item, or Pick option N on its choices.

Pure glue: `h` is the plugin module (decide_many, _items_doc, _lock, _save_items, decide, _now, data_dir, notify, PACKS,
_ITEM_SHOT, _PACK_SHOT); the screenshots stay in UI Review and the dialog reads them through `shot_file`.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import console_context as cx
import plugin_services

from . import choices as choices_mod

CAP = "decisions@1"
SOURCE = "ui-review"
HANDLER = "ui-review@1"
BUTTONS = {"approve": "approve", "changes": "changes", "reject": "reject"}


def _shots(item: dict) -> list[dict]:
    return [{"src": s.get("src", ""), "device": s.get("device", ""), "name": s.get("name", "")} for s in item.get("shots") or [] if isinstance(s, dict) and s.get("src")]


def _options(item: dict, shots: list[dict]) -> list[dict]:
    c = item.get("choices")
    if not isinstance(c, dict):
        return []
    out = []
    for o in choices_mod.norm_choices(c)["options"]:
        mine = [s for s in shots if o["id"] in (s["src"] + " " + s["name"]).lower()]
        out.append({"id": o["id"], "label": o["label"], "notes": o.get("notes", ""), "shots": mine})
    return out


def fields(item: dict) -> dict:
    """The decision@1 fields for one item (pure): options carry their own pictures, the rest show under them."""
    shots = _shots(item)
    options = _options(item, shots)
    picked = {s["src"] for o in options for s in o["shots"]}
    return {"type": "ui-review", "source": SOURCE, "ref": item["id"], "handler": HANDLER, "title": item.get("title") or "UI Review item",
            "body": str(item.get("notes") or "")[:2000], "build": item.get("build", ""), "app": item.get("app", ""), "openAction": f"ui-review.item:{item['id']}",
            "openLabel": "Open in UI Review", "shots": [s for s in shots if s["src"] not in picked], "options": options}


def raised(item: dict) -> None:
    """A new item: pop it up. Never fails the submit."""
    svc = plugin_services.get(CAP)
    if svc is None:
        return
    try:
        svc.raise_decision(fields(item))
    except Exception as e:  # noqa: BLE001
        cx.log("ui-review", f"decision dialog: {str(e)[:200]}", "warn")


def decided(items: list[dict]) -> None:
    """Decided in UI Review itself: the dialog no longer asks."""
    svc = plugin_services.get(CAP)
    if svc is None:
        return
    for it in items:
        if it.get("status") != "waiting":
            try:
                svc.withdraw(SOURCE, str(it.get("id") or ""))
            except Exception:  # noqa: BLE001
                pass


def answer(h: Any, ref: str, button: str, option: str, note: str, by: str) -> dict:
    """Brett's answer from the dialog (or voice / API through it)."""
    if button == "pick":
        with h._lock:
            doc = h._items_doc()
            it = next((x for x in doc["items"] if isinstance(x, dict) and x.get("id") == ref), None)
            if not it or not isinstance(it.get("choices"), dict):
                raise LookupError("no such UI Review item with options")
            at = h._now()
            c = choices_mod.choose(choices_mod.norm_choices(it["choices"]), [option], by or "brett", at)
            label = next(o["label"] for o in c["options"] if o["id"] == option)
            done = {**h.decide(it, "approve", note or f"Chose {label}", by or "brett", at), "choices": c}
            doc["items"] = [done if x is it else x for x in doc["items"]]
            h._save_items(doc)
            snapshot = {"items": list(doc["items"]), "groups": list(doc.get("groups") or [])}
        h.notify.decided(snapshot, [str(done.get("group") or "")])
        return {"ok": True, "id": ref, "status": done["status"], "chosen": c["chosen"]}
    d = BUTTONS.get(button)
    if not d:
        raise ValueError(f'UI Review takes approve, changes, reject or pick, not "{button}"')
    res = h.decide_many([ref], d, note, by or "brett")
    if not res["changed"]:
        raise LookupError("no such UI Review item")
    return {"ok": True, "id": ref, "status": d}


def shot_file(h: Any, src: str) -> Path | None:
    """The file behind a screenshot src, or None (same rules as GET shot)."""
    if h._PACK_SHOT.match(src):
        base, f = h.PACKS, h.PACKS / src
    else:
        m = h._ITEM_SHOT.match(src)
        if not m:
            return None
        base = h.data_dir() / "shots"
        f = base / m.group(1) / m.group(2)
    f = f.resolve()
    return f if base.resolve() in f.parents and f.is_file() else None
