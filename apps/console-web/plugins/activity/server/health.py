"""Activity banner checks on the systems check (axf.health@1, optional: without the systems check nothing registers).

  activity-hooks   Claude Code hooks still report: every machine user's hook writes `hooks/<user>.json` (activity.mjs
                   noteHookEvent: last time per event + which events its settings lack). Red when an event is missing
                   from a user's settings (PostToolUse missing = command lines never close: the Oct 31 2026 ghosts),
                   when PreToolUse keeps arriving without PostToolUse, or when hook events stopped while a Codebase
                   changes entry shows a session working. Auto fix: `activity.mjs hooks ensure --all` on the VPS as a
                   veto call (the registry's `vps_run`, when the systems check offers it).
  activity-github  The banner's GitHub Actions part: red with GitHub's own words when a read fails, amber while it
                   backs off after a rate-limit answer (a used-up hourly limit is not a missing permission).
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Callable

import plugin_services

CAPABILITY = "axf.health@1"
OWNER = "activity"
EVENTS = ("UserPromptSubmit", "PreToolUse", "PostToolUse", "Notification", "Stop", "SessionEnd")
QUIET_S = 20 * 60        # no hook event this long while a session works = stopped arriving
WORKING_S = 10 * 60      # a Codebase changes entry seen this recently = a session is working
POST_LAG_S = 30 * 60     # PreToolUse this much newer than the last PostToolUse = PostToolUse isn't arriving


def fix_command() -> str:
    host = os.environ.get("AXF_HOST_DIR") or "/opt/axf"
    return f'node "{host}/apps/console-web/plugins/activity/activity.mjs" hooks ensure --all'


def read_hooks(data_dir: Path) -> list[dict[str, Any]]:
    out = []
    d = data_dir / "hooks"
    if not d.is_dir():
        return out
    for p in sorted(d.glob("*.json"))[:40]:
        try:
            if p.is_symlink() or p.stat().st_size > 16_000:
                continue
            j = json.loads(p.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(j, dict) and isinstance(j.get("user"), str):
            out.append(j)
    return out


def hooks_check(notes: list[dict[str, Any]], working: list[dict[str, Any]], now_ms: float) -> dict[str, Any]:
    """The verdict from the users' hook notes and the change-log entries working now (pure; test.py drives it)."""
    def ago(ms: float) -> str:
        m = int((now_ms - ms) / 60000)
        return f"{m} min ago" if m < 120 else f"{m // 60} h ago"

    bad, details = [], []
    for n in notes:
        ev = n.get("events") if isinstance(n.get("events"), dict) else {}
        missing = [e for e in n.get("missing") or [] if e in EVENTS]
        if missing:
            bad.append(f"{n['user']}'s Claude Code settings miss the {', '.join(missing)} hook" + ("s" if len(missing) > 1 else ""))
            details.append(f"{n['user']}: {n.get('settings') or '~/.claude/settings.json'} lacks {', '.join(missing)}"
                           + (" — push, pull, merge, delete and build lines never close" if "PostToolUse" in missing else ""))
            continue
        pre, post = float(ev.get("PreToolUse") or 0), float(ev.get("PostToolUse") or 0)
        if pre and now_ms - pre < 6 * 3600_000 and pre - post > POST_LAG_S * 1000:
            bad.append(f"PostToolUse stopped arriving for {n['user']}")
            details.append(f"{n['user']}: last PreToolUse {ago(pre)}, last PostToolUse {ago(post) if post else 'never'}")
    newest = max((float(v) for n in notes for v in (n.get("events") or {}).values() if isinstance(v, (int, float))), default=0.0)
    live = [w for w in working if now_ms - float(w.get("updatedAt") or 0) < WORKING_S * 1000]
    if live and now_ms - newest > QUIET_S * 1000:
        bad.append("Claude Code hook events stopped arriving" if newest else "no Claude Code hook has reported yet")
        details.append(f"last hook event: {ago(newest) if newest else 'never'}; working now per the Codebase changes log: "
                       + "; ".join(str(w.get("title") or w.get("id"))[:80] for w in live[:3]))
    if bad:
        return {"status": "error", "summary": "; ".join(bad)[:300] + ". The Activity banner can't show or close that work.", "details": details[:12]}
    if not notes:
        return {"status": "ok", "summary": "No Claude Code session has reported yet (nothing is working)."}
    users = ", ".join(n["user"] for n in notes)
    return {"status": "ok", "summary": f"Claude Code hooks report for {users} (all {len(EVENTS)} events); last event {ago(newest) if newest else 'never'}."}


def github_check(st: dict[str, Any], on: bool) -> dict[str, Any]:
    if not on:
        return {"status": "ok", "summary": "GitHub Actions is switched off in the Activity banner."}
    if st.get("backoffUntil"):
        at = time.strftime("%H:%M UTC", time.gmtime(st["backoffUntil"]))
        return {"status": "warn", "summary": f"GitHub runs paused until {at}: {st.get('backoffWhy') or 'rate limited.'}",
                "details": st.get("errors") or []}
    errs = [e for e in st.get("errors") or [] if e]
    if errs:
        return {"status": "error", "summary": f"The Activity banner can't read GitHub Actions: {errs[0][:200]}", "details": errs[:6]}
    return {"status": "ok", "summary": "GitHub Actions runs are read for the banner." if st.get("checkedAt") else "Not read yet (nobody has the console open)."}


_done = False


def ensure(feed: Any, data_dir: Path, changes: Callable[[], Any]) -> bool:
    """Registers both checks once the systems check provides axf.health@1 (plugins load in any order: the items route
    calls this again until it lands)."""
    global _done
    if _done:
        return True
    reg = plugin_services.get(CAPABILITY)
    if reg is None:
        return False

    def working() -> list[dict[str, Any]]:
        svc = changes()
        try:
            return [w for w in (svc.activity() if svc else []) if w.get("state") in ("running", "queued")]
        except Exception:  # noqa: BLE001 — no change log: only the notes count
            return []

    vps = getattr(reg, "vps_run", None)
    try:
        reg.register({"id": "activity-hooks", "label": "Claude Code hooks report to the Activity banner", "service": "claude", "order": 24,
                      "run": lambda: hooks_check(read_hooks(data_dir), working(), time.time() * 1000),
                      "breaks": "Claude Code sessions don't show in the Activity banner, or their push / pull / merge / delete / build lines never close (ghosts).",
                      "instructions": [f"On the VPS: {fix_command()}", "It adds only what is missing to ~/.claude/settings.json (root and every /home/<user> with a .claude folder) and keeps a .bak."],
                      **({"autoFix": {"label": "Re-register the hooks on the VPS", "run": lambda: vps(fix_command())}} if callable(vps) else {})}, OWNER)
        reg.register({"id": "activity-github", "label": "Activity banner reads GitHub Actions", "service": "github", "order": 16, "severity": "warn",
                      "run": lambda: github_check(feed.github_status(), feed.config()["sources"]["github"]),
                      "breaks": "GitHub Actions runs don't show in the Activity banner.",
                      "instructions": ["Reads go through axHub when the console has AXHUB_TOKEN (Settings → Plugins → Systems check → GitHub route), so the console's own GITHUB_TOKEN isn't spent on polling.",
                                       "A rate-limit answer clears by itself within the hour; a 401 means GITHUB_TOKEN is dead (Keys banner → GitHub)."]}, OWNER)
    except Exception:  # noqa: BLE001 — the banner works without its checks
        return False
    _done = True
    return True
