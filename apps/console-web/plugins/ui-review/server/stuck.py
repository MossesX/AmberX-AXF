"""Stuck UI Review work in build worktrees: items and screenshots a build saved into its own checkout instead of the
console (no console token, a refused submit), and the failure markers the CLIs leave when a submit to the console fails.

A build worktree's UI Review data lives in `<worktree>/.axf-console/plugins/ui-review/` (items.json, screenshots/index.json,
submit-failed.json, sent.json). Brett never sees it there and it is deleted with the worktree, so the health check
`ui-review-stuck` turns red (systems check banner + one phone alert) as soon as anything is found, and
`review.mjs resubmit` sends it to the console.

Roots: AXF_UI_REVIEW_STUCK_ROOTS (comma separated), else /hostfs/axf-builds (the console container's mount of the
host's /root/axf-builds) and /root/axf-builds, whichever exist.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Iterable

REL = Path(".axf-console") / "plugins" / "ui-review"
MARKER = "submit-failed.json"
SENT = "sent.json"  # {"ids": [...]}: local items / shots already re-submitted to the console (review.mjs resubmit)
DEFAULT_ROOTS = ("/hostfs/axf-builds", "/root/axf-builds")


def roots(env: dict[str, str] | None = None) -> list[Path]:
    env = os.environ if env is None else env
    raw = env.get("AXF_UI_REVIEW_STUCK_ROOTS")
    names = [r.strip() for r in raw.split(",") if r.strip()] if raw else list(DEFAULT_ROOTS)
    seen: set[str] = set()
    out: list[Path] = []
    for n in names:
        p = Path(n)
        try:
            key = str(p.resolve())
            if p.is_dir() and key not in seen:
                seen.add(key)
                out.append(p)
        except OSError:
            continue
    return out


def _read(p: Path) -> Any:
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return None


def scan_worktree(wt: Path, known_items: set[str], known_shots: set[str]) -> dict[str, Any] | None:
    """What one worktree holds that the console doesn't, or None when nothing is stuck there."""
    d = wt / REL
    if not d.is_dir():
        return None
    sent_doc = _read(d / SENT)
    sent = {str(i) for i in (sent_doc.get("ids") or [])} if isinstance(sent_doc, dict) else set()
    known_items, known_shots = known_items | sent, known_shots | sent
    doc = _read(d / "items.json")
    items = [{"id": str(it.get("id")), "name": str(it.get("name") or it.get("title") or "")}
             for it in (doc.get("items", []) if isinstance(doc, dict) else [])
             if isinstance(it, dict) and it.get("id") and str(it.get("id")) not in known_items]
    idx = _read(d / "screenshots" / "index.json")
    shots = [{"id": str(s.get("id")), "name": str(s.get("name") or "")}
             for s in (idx.get("shots", []) if isinstance(idx, dict) else [])
             if isinstance(s, dict) and s.get("id") and str(s.get("id")) not in known_shots]
    m = _read(d / MARKER)
    failure = {k: str(m.get(k) or "")[:300] for k in ("at", "code", "reason", "what")} if isinstance(m, dict) else None
    if not items and not shots and not failure:
        return None
    return {"worktree": wt.name, "path": str(wt), "items": items, "shots": shots, "failure": failure}


def scan(root_dirs: Iterable[Path], known_items: set[str], known_shots: set[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for root in root_dirs:
        try:
            kids = sorted(p for p in root.iterdir() if p.is_dir())
        except OSError:
            continue
        for wt in kids:
            r = scan_worktree(wt, known_items, known_shots)
            if r:
                out.append(r)
    return out


def probe(found: list[dict[str, Any]]) -> dict[str, Any]:
    """The health check's answer for what scan() found."""
    if not found:
        return {"status": "ok", "summary": "No build has UI Review items, screenshots or failed submits stuck in its worktree."}
    n_items = sum(len(f["items"]) for f in found)
    n_shots = sum(len(f["shots"]) for f in found)
    fails = [f for f in found if f["failure"]]
    parts = []
    if n_items:
        parts.append(f"{n_items} review item(s)")
    if n_shots:
        parts.append(f"{n_shots} screenshot(s)")
    head = f"{' and '.join(parts)} stuck in {len(found)} build worktree(s), not in UI Review" if parts else ""
    if fails:
        why = fails[0]["failure"].get("reason") or fails[0]["failure"].get("code") or "failed"
        head = (head + "; " if head else "") + f"{len(fails)} build(s) had a UI Review submit fail ({fails[0]['worktree']}: {why[:120]})"
    details = []
    for f in found[:30]:
        bits = []
        if f["items"]:
            bits.append(f"{len(f['items'])} item(s): " + ", ".join(i["name"] or i["id"] for i in f["items"][:3]))
        if f["shots"]:
            bits.append(f"{len(f['shots'])} shot(s)")
        if f["failure"]:
            bits.append(f"submit failed {f['failure'].get('at', '')}: {f['failure'].get('reason', '')[:160]}")
        details.append(f"{f['worktree']}: " + " · ".join(bits))
    return {"status": "error", "summary": head + ".", "details": details}
