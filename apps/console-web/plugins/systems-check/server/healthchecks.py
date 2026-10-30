"""The systems check's own health@1 checks (registered on start; other plugins add theirs through `axf.health@1`).

Keys: Claude sign-in (Claude Code token), OpenAI and ElevenLabs keys when set, ntfy, the push path to AmberX, git push
credentials on the VPS checkout. System: CI on main, stuck builds, veto calls denied or expired, containers restarting,
disk over 85%. The GitHub, Anthropic, Hostinger, Coolify and axHub keys stay built-in checks (checks.py) and are tested
live on every banner load; the monitor gives them `since`, `breaks` and the push too.
"""
from __future__ import annotations

import calendar
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Callable

import console_context as cx
import plugin_services

from . import probes
from .health import Registry

OWNER = "systems-check"
HOUR_MS = 3600_000
STUCK_MS = 30 * 60_000        # a running build with no heartbeat for 30 minutes
QUICK_EXIT_MS = 2 * 60_000    # a launch that finished (failed) within 2 minutes of starting
RECENT_MS = 6 * HOUR_MS       # …in the last 6 hours
VETO_WINDOW_MS = 24 * HOUR_MS


def _alerts_files() -> tuple[Path, Path]:
    d = Path(os.environ.get("AXF_STATE") or (cx.ROOT / ".axf-console" / "state.json")).parent
    return d / "alerts-config.json", d / "alerts-secrets.json"


def _read(p: Path) -> dict[str, Any]:
    try:
        v = json.loads(p.read_text())
        return v if isinstance(v, dict) else {}
    except (OSError, ValueError):
        return {}


def _ms(iso: Any) -> float | None:
    try:
        return calendar.timegm(time.strptime(str(iso)[:19], "%Y-%m-%dT%H:%M:%S")) * 1000.0
    except (ValueError, TypeError):
        return None


def _ai_key(kind: str) -> str:
    svc = plugin_services.get("axf.ai-keys@1")
    try:
        return svc.active_key(kind) if svc is not None else ""
    except Exception:  # noqa: BLE001
        return ""


def _claude_token() -> str:
    return _ai_key("claude-code") or os.environ.get("CLAUDE_CODE_OAUTH_TOKEN", "")


# ---------------------------------------------------------------- system probes (pure: the self-test feeds them fakes)

def builds_stuck(entries: list[dict[str, Any]], now_ms: float) -> dict[str, Any]:
    """Running change-log entries with no heartbeat for 30 minutes, and launches that failed within 2 minutes of starting
    (like Oct 30's root / go-pass failures) in the last 6 hours."""
    stuck, quick = [], []
    for e in entries:
        st = e.get("status") or ""
        seen = _ms(e.get("lastSeenAt") or e.get("updatedAt"))
        if st == "running" and not e.get("closed") and seen is not None and now_ms - seen > STUCK_MS:
            stuck.append(f"{e.get('title') or e.get('id')} — no heartbeat for {int((now_ms - seen) // 60_000)} min ({e.get('host') or e.get('where') or 'unknown host'})")
        start, end = _ms(e.get("startedAt") or e.get("createdAt")), _ms(e.get("finishedAt"))
        if st in ("failed", "cancelled") and start and end and 0 <= end - start <= QUICK_EXIT_MS and now_ms - end <= RECENT_MS and not e.get("closed"):
            why = ((e.get("result") or {}).get("summary") or "").strip()
            quick.append(f"{e.get('title') or e.get('id')} — exited {int((end - start) // 1000)} s after it started{': ' + why[:120] if why else ''}")
    if not stuck and not quick:
        return {"status": "ok", "summary": "No stuck builds: every running build has a heartbeat."}
    parts = ([f"{len(stuck)} build{'s' if len(stuck) != 1 else ''} with no heartbeat for 30 min"] if stuck else []) + \
            ([f"{len(quick)} launch{'es' if len(quick) != 1 else ''} exited at once"] if quick else [])
    return {"status": "error", "summary": " and ".join(parts) + ".", "details": [*stuck, *quick][:12], "stuck": len(stuck), "quick": len(quick)}


VETO_BAD = re.compile(r"\b(denied|rejected|declined|expired)\b", re.I)


def veto_calls(jobs: list[dict[str, Any]], now_ms: float) -> dict[str, Any]:
    """Calls this console sent through axHub (Vinnie's veto commands, approval-held fixes) that were denied or expired in
    the last day."""
    bad = []
    for j in jobs:
        at = float(j.get("updatedAt") or j.get("startedAt") or 0)
        at = at if at > 1e12 else at * 1000
        if j.get("state") == "failed" and VETO_BAD.search(str(j.get("message") or "")) and now_ms - at <= VETO_WINDOW_MS:
            bad.append(f"{j.get('title') or j.get('id')}: {str(j.get('message'))[:160]}")
    if not bad:
        return {"status": "ok", "summary": "No denied or expired hub calls in the last day."}
    return {"status": "warn", "summary": f"{len(bad)} hub call{'s were' if len(bad) != 1 else ' was'} denied or expired in the last day: the command didn't run.", "details": bad[:12]}


def containers(items: list[dict[str, Any]]) -> dict[str, Any]:
    """Containers in a restart loop (Docker state `restarting`, or `exited` with a non-zero code while set to restart)."""
    bad = [c for c in items if str(c.get("state")) == "restarting" or ("Restarting" in str(c.get("status") or ""))]
    if not bad:
        return {"status": "ok", "summary": f"No container is restarting ({len(items)} checked)."}
    names = ", ".join(str(c.get("name")) for c in bad)
    return {"status": "error", "summary": f"{len(bad)} container{'s are' if len(bad) != 1 else ' is'} in a restart loop: {names}.",
            "details": [f"{c.get('name')}: {c.get('status')}" for c in bad], "names": [str(c.get("name")) for c in bad]}


# ---------------------------------------------------------------- registration

def register_builtins(reg: Registry, *, root: Path, repo: str, hub_jobs: Callable[[], list[dict[str, Any]]]) -> None:
    tok = lambda: os.environ.get("GITHUB_TOKEN", "")  # noqa: E731

    reg.register({"id": "claude-code-token", "label": "Claude sign-in (Claude Code)", "service": "claude", "order": 22,
                  "when": lambda: bool(_claude_token()), "run": lambda: probes.claude_code_token(_claude_token()),
                  "fix": {"type": "settings", "tab": "ai-keys", "label": "Sign in again", "action": "ai-keys.open"},
                  "instructions": ["Settings → Plugins → AI keys: add a fresh Claude sign-in (or run claude /login on the VPS)."]}, OWNER)
    reg.register({"id": "openai-key", "label": "OpenAI key", "service": "claude", "order": 27,
                  "when": lambda: bool(os.environ.get("OPENAI_API_KEY")), "run": lambda: probes.openai_key(os.environ.get("OPENAI_API_KEY", "")),
                  "links": [{"label": "OpenAI → API keys", "url": "https://platform.openai.com/api-keys"}],
                  "instructions": ["Make a new key on OpenAI and set OPENAI_API_KEY for the console (Coolify → axf-console → Environment)."]}, OWNER)
    reg.register({"id": "elevenlabs-key", "label": "ElevenLabs key", "service": "claude", "order": 28,
                  "when": lambda: bool(os.environ.get("ELEVENLABS_API_KEY")), "run": lambda: probes.elevenlabs_key(os.environ.get("ELEVENLABS_API_KEY", "")),
                  "links": [{"label": "ElevenLabs → API keys", "url": "https://elevenlabs.io/app/settings/api-keys"}],
                  "instructions": ["Make a new key on ElevenLabs and set ELEVENLABS_API_KEY for the console."]}, OWNER)

    def ntfy() -> dict[str, Any]:
        cfg, sec = (_read(f) for f in _alerts_files())
        n = cfg.get("ntfy") or {}
        return probes.ntfy(str(n.get("server") or "https://ntfy.sh"), str(n.get("topic") or ""), str(sec.get("ntfyToken") or ""))
    reg.register({"id": "ntfy", "label": "ntfy topic", "service": "console", "order": 6, "run": ntfy,
                  "when": lambda: bool((_read(_alerts_files()[0]).get("ntfy") or {}).get("enabled")),
                  "fix": {"type": "settings", "tab": "alerts", "label": "Open alert settings"},
                  "instructions": ["Settings → Alerts → ntfy: check the topic and token, then Send a test."]}, OWNER)

    def push_path() -> dict[str, Any]:
        cfg = _read(_alerts_files()[0])
        if (cfg.get("sources") or {}).get("system") is False:
            return {"status": "error", "summary": "System alerts are switched off in Settings → Alerts, so broken keys and checks never reach AmberX."}
        rules = (cfg.get("rules") or {}).get("channels") or {}
        bell = (rules.get("bell") or {"min": "info"}).get("min", "info")
        if bell == "off":
            return {"status": "error", "summary": "The console's alert list is off, and that's what the AmberX app reads: nothing reaches your phone."}
        return {"status": "ok", "summary": "Red items are raised as console alerts; the AmberX app turns them into phone notifications."}
    reg.register({"id": "push-path", "label": "Push to AmberX", "service": "console", "order": 5, "run": push_path,
                  "fix": {"type": "settings", "tab": "alerts", "label": "Open alert settings"},
                  "instructions": ["Settings → Alerts: turn the System source on and keep the bell on.", "AmberX → Monitor: Dev Console alerts on."]}, OWNER)

    reg.register({"id": "git-push", "label": "git push from the VPS checkout", "service": "github", "order": 13,
                  "when": lambda: (root / ".git").exists(), "run": lambda: probes.git_push(str(root)),
                  "fix": {"type": "host", "command": "gh auth setup-git && git -C /opt/axf push --dry-run origin HEAD:refs/heads/axf-health-probe"},
                  "instructions": ["On the VPS: gh auth login (or store a token with git's credential helper), then gh auth setup-git.",
                                   "The check runs git push --dry-run, which signs in and stops before sending anything."]}, OWNER)

    reg.register({"id": "ci-main", "label": "CI on main", "service": "github", "order": 14, "when": lambda: bool(tok()),
                  "run": lambda: probes.github_ci_main(tok(), repo),
                  "links": [{"label": "Actions on main", "url": f"https://github.com/{repo}/actions?query=branch%3Amain"}],
                  "instructions": ["Open the failing run, fix it on a branch, merge the fix."]}, OWNER)

    def stuck() -> dict[str, Any]:
        svc = plugin_services.get("axf.changes@1")
        return builds_stuck(svc.summaries(), time.time() * 1000)
    reg.register({"id": "builds-stuck", "label": "Stuck builds", "service": "console", "order": 7, "interval": 5 * 60,
                  "when": lambda: plugin_services.get("axf.changes@1") is not None, "run": stuck,
                  "fix": {"type": "action", "label": "Mark them stalled"},
                  "instructions": ["Mark them stalled finishes each stuck entry as failed (it stays in the log), so the Build manager stops showing it running.",
                                   "To carry one on, open it in the Build manager and use its resume prompt."]}, OWNER)

    reg.register({"id": "veto-calls", "label": "Hub calls denied or expired", "service": "axhub", "order": 62, "severity": "warn",
                  "run": lambda: veto_calls(hub_jobs(), time.time() * 1000),
                  "links": [{"label": "axHub approvals", "url": "https://axhub.amberxai.com/auth/admin/approvals"}],
                  "instructions": ["Denied on purpose? Nothing to do. Expired? Run the fix again from its row and approve it in time."]}, OWNER)

    def ctr() -> dict[str, Any]:
        svc = plugin_services.get("axf.containers@1")
        if not svc.status().get("ok"):
            return {"status": "unknown", "summary": "The Docker proxy isn't reachable, so containers can't be listed."}
        r = containers(svc.list())
        if r.get("names"):
            r["fix"] = {"type": "host", "command": f"docker logs --tail 80 {r['names'][0]}"}
        return r
    reg.register({"id": "containers", "label": "Containers restarting", "service": "vps", "order": 35,
                  "when": lambda: plugin_services.get("axf.containers@1") is not None, "run": ctr,
                  "instructions": ["Read the container's last log lines (Fix runs docker logs through axHub), fix the cause, then redeploy it in Coolify."]}, OWNER)

    reg.register({"id": "disk", "label": "Disk space", "service": "vps", "order": 36, "run": lambda: probes.disk("/"),
                  "fix": {"type": "host", "command": "docker builder prune -af --filter until=72h && docker image prune -af --filter until=168h && df -h /"},
                  "instructions": ["Fix clears Docker build cache older than 3 days and unused images older than a week (you approve it on axHub)."]}, OWNER)


def fix_builds_stuck() -> str:
    """Mark stalled: every stuck entry is finished as failed (stalled) through axf.changes@1; it stays in the log."""
    svc = plugin_services.get("axf.changes@1")
    if svc is None:
        raise RuntimeError("the Codebase changes plugin isn't installed")
    now = time.time() * 1000
    n = 0
    for e in svc.summaries():
        seen = _ms(e.get("lastSeenAt") or e.get("updatedAt"))
        if (e.get("status") == "running" and not e.get("closed") and seen is not None and now - seen > STUCK_MS) or \
                (e.get("status") in ("failed", "cancelled") and not e.get("closed") and _quick(e, now)):
            svc.abandon(str(e["id"]), by="systems-check")
            n += 1
    return f"marked {n} stuck build{'s' if n != 1 else ''} stalled"


def _quick(e: dict[str, Any], now: float) -> bool:
    start, end = _ms(e.get("startedAt") or e.get("createdAt")), _ms(e.get("finishedAt"))
    return bool(start and end and 0 <= end - start <= QUICK_EXIT_MS and now - end <= RECENT_MS)
