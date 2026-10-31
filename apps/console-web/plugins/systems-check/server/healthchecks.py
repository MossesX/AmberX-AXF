"""The systems check's own health@1 checks (registered on start; other plugins add theirs through `axf.health@1`).

Keys: Claude sign-in (Claude Code token), OpenAI and ElevenLabs keys when set, ntfy, the push path to AmberX, git push
credentials on the VPS checkout. System: CI on main, stuck builds, veto calls denied or expired, containers restarting,
disk over 85%. The GitHub, Anthropic, Hostinger, Coolify and axHub keys stay built-in checks (checks.py) and are tested
live on every banner load; the monitor gives them `since`, `breaks` and the push too.

Auto-fixes (Oct 30 2026, "fix it yourself"): a dead console GitHub token → GitHub goes through axHub (github@1, the
hub's own token; worked around until a new local token is saved); disk over 85% → the
Docker clean-up as a veto call on the VPS (Brett can stop it on the countdown); stuck builds → marked stalled, ask
first by default (it closes change-log entries, his call). The rest need his hands or a choice.
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


def _keys_fix(label: str) -> dict[str, Any]:
    """The keys plugin's settings tab + dialog, from its capability (axf.ai-keys@1), never by folder name."""
    svc = plugin_services.get("axf.ai-keys@1")
    tab, action = getattr(svc, "settings_tab", "") or "plugins", getattr(svc, "open_action", "")
    return {"type": "settings", "tab": tab, "label": label, **({"action": action} if action else {})}


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

DISK_FIX = "docker builder prune -af --filter until=72h && docker image prune -af --filter until=168h && df -h /"
_RUNS_AT = re.compile(r'"?runsAt"?\s*[:=]\s*"?([0-9T:.\-Z+]{10,40}|\d{10,13})')
_JOB_ID = re.compile(r'"?job_?[iI]d"?\s*[:=]\s*"?([0-9a-f-]{8,64})')


def veto_fix(command: str, call: Callable[..., dict[str, Any]], now: float | None = None) -> dict[str, Any]:
    """Send one fixed VPS command through axHub as a veto call (Vinnie runs it after the countdown unless Brett denies
    it). Never polled: the monitor checks again once it should have run."""
    now = time.time() if now is None else now
    r = call("vps.run", {"command": command, "timeout_seconds": 600})
    if "confirm" in r:
        return {"state": "started", "message": "Waiting for your approval on axHub.", "waitS": 30 * 60,
                "link": f"https://axhub.amberxai.com/auth/admin/approvals/{r['confirm']}"}
    text = str(r.get("ok") or "")
    if re.search(r"^exit 0\b", text, re.M):
        return {"state": "done", "message": "Ran on the VPS."}
    if re.search(r"^exit -?\d+", text, re.M):
        return {"state": "failed", "message": "The VPS command failed: " + " / ".join([ln for ln in text.strip().splitlines() if ln.strip()][-2:])[:200]}
    wait = 5 * 60.0
    m = _RUNS_AT.search(text)
    if m:
        v = m.group(1)
        at = (float(v) / (1000 if len(v) > 11 else 1)) if v.isdigit() else (_ms(v) or 0) / 1000
        if at > now:
            wait = at - now + 120
    j = _JOB_ID.search(text)
    return {"state": "started", "message": "Sent as a veto call: it runs after the countdown unless you deny it.", "waitS": min(wait, 30 * 60),
            **({"jobId": j.group(1)} if j else {})}


def register_builtins(reg: Registry, *, root: Path, repo: str, hub_jobs: Callable[[], list[dict[str, Any]]],
                      github_svc: Any = None, vps_call: Callable[..., dict[str, Any]] | None = None) -> None:
    tok = lambda: os.environ.get("GITHUB_TOKEN", "")  # noqa: E731

    reg.register({"id": "claude-code-token", "label": "Claude sign-in (Claude Code)", "service": "claude", "order": 22,
                  "when": lambda: bool(_claude_token()), "run": lambda: probes.claude_code_token(_claude_token()),
                  "fix": _keys_fix("Sign in again"),
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

    gh_ci = github_svc.client(user_agent="axf-console-health") if github_svc is not None else None
    reg.register({"id": "ci-main", "label": "CI on main", "service": "github", "order": 14,
                  "when": lambda: bool(tok()) or (github_svc is not None and github_svc.hub.configured()),
                  "run": lambda: probes.github_ci_main_via(gh_ci, repo) if gh_ci is not None else probes.github_ci_main(tok(), repo),
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
                  "fix": {"type": "host", "command": DISK_FIX},
                  **({"autoFix": {"label": "Clear old Docker build cache and images", "run": lambda: veto_fix(DISK_FIX, vps_call)}} if vps_call else {}),
                  "instructions": ["Auto fix clears Docker build cache older than 3 days and unused images older than a week, as a veto call (deny it on the countdown to stop it)."]}, OWNER)

    # Ask first by default: marking stalled closes change-log entries, and closing one is Brett's call (repo rule).
    reg.add_autofix("builds-stuck", {"label": "Mark the stuck builds stalled", "mode": "ask", "run": lambda: {"state": "done", "message": fix_builds_stuck()}}, OWNER)

    if github_svc is not None:
        register_github(reg, github_svc)


def register_github(reg: Registry, svc: Any) -> None:
    """github@1: the hub route's own check, and the dead console token's auto-fix (switch to the hub route)."""
    def hub_check() -> dict[str, Any]:
        st = svc.status(refresh=True)
        if st.get("ok"):
            who = f" as {st['login']}" if st.get("login") else ""
            return {"status": "ok", "summary": f"GitHub through axHub works{who} (route: {'axHub first' if st.get('route') == 'hub' else 'local token first'})."}
        return {"status": "error", "summary": f"GitHub through axHub doesn't work: {st.get('why') or 'no answer'}.",
                "breaks": "If the console's own GitHub token dies too, the console can't reach GitHub at all."}
    reg.register({"id": "github-hub", "label": "GitHub through axHub", "service": "github", "order": 12, "severity": "warn",
                  "when": lambda: svc.hub.configured(), "run": hub_check,
                  "links": [{"label": "axHub services", "url": "https://axhub.amberxai.com/#/services"}],
                  "instructions": ["axHub → Services → github: check its token there (it stays in the hub vault)."]}, OWNER)

    def switch() -> dict[str, Any]:
        st = svc.status(refresh=True)
        if not st.get("ok"):
            return {"state": "failed", "message": f"GitHub through axHub doesn't work either ({st.get('why') or 'no answer'})"}
        before = svc.route()
        if before != "hub":
            svc.set_route("hub", by="auto-fix")
        who = f" as {st['login']}" if st.get("login") else ""
        return {"state": "done", "mitigated": True,
                "message": f"console GitHub calls go through axHub{who} ({'switched from the local token' if before != 'hub' else 'already the route'}). "
                           "Helpers not on github@1 yet (push banner) still need a new local token."}
    reg.add_autofix("github-token", {"label": "Send GitHub calls through axHub", "run": switch,
                                     "mitigated": lambda: svc.route() == "hub" and bool(svc.status().get("ok"))}, OWNER)


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
