"""drag-move@1 command validator (framework/spec/DRAG-MOVE.md), the Python twin of `dragMoveErrors` / `normalizeDragMove`
in framework/core/engines/drag-move.ts. The server checks a command's shape before it relays it to the open console;
the console plans it against the live hosts (unknown container / item, zones, limits are the console's answers).

Kept equal to the engine by tests/test_drag.py, which replays every case of framework/spec/fixtures/drag-move.json whose
outcome is decided by the shape alone (`invalid`, `unknown_kind`) and checks every valid case normalizes the same.
"""
from __future__ import annotations

from typing import Any

CONTRACT = "drag-move@1"
RESULT_FRAME = "drag-move-result@1"
ID_MAX = 160
OPS = ("move", "add", "remove")
ZONES = ("before", "after", "into", "side")
CODES = ("invalid", "unknown_kind", "unknown_container", "unknown_item", "unknown_ref", "invalid_zone", "out_of_range",
         "not_allowed", "duplicate", "limit", "no_change", "confirmation_required", "failed")
# = DRAG_KINDS (append-only). A plugin kind registered in the browser is added here with register_kind.
KINDS: list[str] = ["banner-widget", "toolbar-item", "tab", "dock-pane", "grid-column", "grid-row", "list-item", "layout-slot"]
# HTTP status per wire code (REST answers; the body is always the envelope)
STATUS = {"invalid": 400, "unknown_kind": 404, "unknown_container": 404, "unknown_item": 404, "unknown_ref": 404,
          "invalid_zone": 422, "out_of_range": 422, "not_allowed": 403, "duplicate": 409, "limit": 409, "no_change": 409,
          "confirmation_required": 409, "failed": 500, "denied": 403, "unavailable": 503, "not_found": 404}


def register_kind(kind: str) -> None:
    if isinstance(kind, str) and 1 <= len(kind) <= ID_MAX and kind not in KINDS:
        KINDS.append(kind)


def _obj(v: Any) -> bool:
    return isinstance(v, dict)


def _id(v: Any) -> bool:
    return isinstance(v, str) and 1 <= len(v) <= ID_MAX


def _int(v: Any) -> bool:
    """Number.isInteger: an int, or a whole float (JSON 2.0); never a bool."""
    return (isinstance(v, int) and not isinstance(v, bool)) or (isinstance(v, float) and v.is_integer())


def errors(raw: Any) -> list[str]:
    """Every problem with a raw command, in field order; [] when it is a valid drag-move@1 command."""
    e: list[str] = []
    if not _obj(raw):
        return ["command must be an object"]
    if "$axf" in raw and raw["$axf"] != CONTRACT:  # `!== undefined`: a null $axf is wrong too
        e.append(f"$axf must be {CONTRACT}")
    op = raw.get("op") if raw.get("op") is not None else "move"  # `?? 'move'`
    if op not in OPS:
        e.append(f"op must be one of {', '.join(OPS)}")
    kind = raw.get("kind")
    if not _id(kind):
        e.append("kind is required")
    elif kind not in KINDS:
        e.append(f"unknown kind {kind}")
    src = raw.get("source")
    if not _obj(src):
        e.append("source is required")
    else:
        if not _id(src.get("id")):
            e.append(f"source.id is required (1 to {ID_MAX} characters)")
        if "container" in src and not _id(src["container"]):
            e.append("source.container must be an id")
        if "type" in src and not _id(src["type"]):
            e.append("source.type must be an id")
        if op in ("move", "remove") and "container" not in src:
            e.append(f"source.container is required for {op}")
    tgt = raw.get("target")
    if op == "remove":
        if "target" in raw:
            e.append("remove takes no target")
    elif not _obj(tgt):
        e.append(f"target is required for {op}")
    else:
        if not _id(tgt.get("container")):
            e.append("target.container is required")
        if "zone" in tgt and tgt["zone"] not in ZONES:
            e.append(f"target.zone must be one of {', '.join(ZONES)}")
        if "ref" in tgt and not _id(tgt["ref"]):
            e.append("target.ref must be an id")
        if "side" in tgt and not _id(tgt["side"]):
            e.append("target.side must be a side name")
        if "index" in tgt and not _int(tgt["index"]):
            e.append("target.index must be an integer")
        zone = tgt["zone"] if tgt.get("zone") is not None else ("after" if "ref" in tgt else "side" if "side" in tgt else "into")
        if zone in ("before", "after") and "ref" not in tgt:
            e.append(f"zone {zone} needs target.ref")
        if zone == "into" and "ref" in tgt:
            e.append("zone into takes no target.ref")
        if zone in ("before", "after") and "index" in tgt:
            e.append(f"zone {zone} takes no target.index")
        if zone == "side" and "side" not in tgt:
            e.append("zone side needs target.side")
        if zone != "side" and "side" in tgt:
            e.append(f"zone {zone} takes no target.side")
    if "confirm" in raw and not isinstance(raw["confirm"], bool):
        e.append("confirm must be a boolean")
    if "by" in raw and not isinstance(raw["by"], str):
        e.append("by must be a string")
    if "reason" in raw and not isinstance(raw["reason"], str):
        e.append("reason must be a string")
    return e


class DragMoveError(Exception):
    def __init__(self, code: str, message: str, nearest: list[str] | None = None) -> None:
        super().__init__(message)
        self.code, self.message, self.nearest = code, message, nearest

    def envelope(self) -> dict[str, Any]:
        return {"$axf": RESULT_FRAME, "ok": False, "code": self.code, "message": self.message, **({"nearest": self.nearest} if self.nearest else {})}


def normalize(raw: Any) -> dict[str, Any]:
    """A clean command (defaults filled: $axf, op, target.zone), or DragMoveError (invalid / unknown_kind)."""
    errs = errors(raw)
    if errs:
        r = raw if _obj(raw) else {}
        code = "unknown_kind" if _id(r.get("kind")) and r.get("kind") not in KINDS and len(errs) == 1 else "invalid"
        raise DragMoveError(code, "; ".join(errs), list(KINDS) if code == "unknown_kind" else None)
    src = raw["source"]
    out: dict[str, Any] = {"$axf": CONTRACT, "op": raw.get("op") or "move", "kind": raw["kind"], "source": {"id": src["id"]}}
    for k in ("container", "type"):
        if k in src:
            out["source"][k] = src[k]
    t = raw.get("target")
    if _obj(t):
        zone = t["zone"] if t.get("zone") is not None else ("after" if "ref" in t else "side" if "side" in t else "into")
        out["target"] = {"container": t["container"], "zone": zone}
        for k in ("ref", "side"):
            if k in t:
                out["target"][k] = t[k]
        if "index" in t:
            out["target"]["index"] = int(t["index"])
    for k in ("confirm", "by", "reason"):
        if k in raw:
            out[k] = raw[k]
    return out
