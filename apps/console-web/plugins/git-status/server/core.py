"""Git status board: the pure part (no I/O, no LLM). Turns what the push banner, the local git scan, the builds store,
UI Review, the holds and the containers say into rows, each in every section it belongs to, with a plain-English lead
line and what blocks it (and what clears that). Tested in test.py.

Sections (SECTIONS): push (local commits not on GitHub, or pushed branches with no PR yet), pull (behind main), ci
(checks running / queued / failed / missing), ready (green, not held), held (UI Review, conflicts, a draft, a hold, a
dependency PR), merged (today), deployed (which app runs which commit), stale (way behind main or no activity).
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

SECTIONS = [
    {"id": "push", "label": "Needs push", "icon": "upload"},
    {"id": "pull", "label": "Needs pull", "icon": "download"},
    {"id": "ci", "label": "In CI", "icon": "activity"},
    {"id": "ready", "label": "Ready to merge", "icon": "check-circle"},
    {"id": "held", "label": "Held", "icon": "pause"},
    {"id": "merged", "label": "Merged today", "icon": "git-merge"},
    {"id": "deployed", "label": "Deployed", "icon": "server"},
    {"id": "stale", "label": "Stale", "icon": "clock"},
]
SECTION_IDS = [s["id"] for s in SECTIONS]
STALE_DAYS = 3
STALE_BEHIND = 150

# Conventional-commit and bot prefixes that say nothing to a person reading the row.
_PREFIX = re.compile(r"^\s*(?:\[[^\]]{1,30}\]\s*|(?:feat|fix|chore|docs|refactor|test|tests|ci|build|perf|style)(?:\([^)]{0,40}\))?!?:\s*)+", re.I)
_TAIL = re.compile(r"\s*\[(?:skip ci|ci skip|no ci)\]\s*$", re.I)
_DEPENDS = re.compile(r"(?:depends on|after|needs|blocked by|on top of)\s+#(\d{1,6})", re.I)
_AGENT = re.compile(r"(?i:assigned agent|assigned|agent|built by|crew)\s*[:=-]\s*([A-Z][A-Za-z'’]+(?:\s+(?:the\s+)?[A-Z][A-Za-z'’]+)?)")


def parse_time(s: Any) -> float | None:
    """Seconds since the epoch for an ISO time (GitHub's Z form included), else None."""
    if isinstance(s, (int, float)) and not isinstance(s, bool):
        return float(s) / (1000 if s > 1e11 else 1)
    if not isinstance(s, str) or not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def age_days(at: Any, now: float) -> float | None:
    t = parse_time(at)
    return None if t is None else max(0.0, (now - t) / 86400)


def clean_title(t: Any) -> str:
    """A PR title / commit subject without commit-type prefixes and [skip ci] tails."""
    s = _TAIL.sub("", _PREFIX.sub("", str(t or ""))).strip()
    return (s[:1].upper() + s[1:]) if s else ""


def first_sentence(text: Any, n: int = 160) -> str:
    """The first plain sentence of a markdown text: skips headings, tables, quotes, list markers and front matter."""
    for raw in str(text or "").splitlines():
        ln = raw.strip()
        if not ln or ln.startswith(("#", "|", ">", "```", "---", "<!--")) or re.fullmatch(r"[-=*_ ]+", ln):
            continue
        ln = re.sub(r"^[-*+]\s+|^\d+[.)]\s+", "", ln)
        ln = re.sub(r"\*\*|__|`", "", ln)
        ln = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", ln).strip()
        if len(ln) < 12:
            continue
        m = re.match(r"(.+?[.!?])(?:\s|$)", ln)
        s = (m.group(1) if m else ln).strip()
        return s if len(s) <= n else s[: n - 1].rstrip() + "…"
    return ""


def short_name(title: Any) -> str:
    """A build's name without its trailing explanation: 'Git status board (grids …)' → 'Git status board'."""
    s = re.split(r"\s+[(:–—-]\s*|\s*\(", str(title or "").strip(), maxsplit=1)[0].strip()
    return s[:70]


def _overlaps(name: str, t: str) -> bool:
    """The PR title already names the build ('Banner reference links: tap …' for build 'Banner reference links')."""
    a, b = name.lower().strip(), t.lower().strip()
    if not a or not b:
        return False
    fa, fb = re.split(r"[\s:]+", a)[0], re.split(r"[\s:]+", b)[0]
    return b.startswith(a[:18]) or (len(fa) >= 4 and fa == fb)


def lead_line(number: int | None, pr_title: Any = "", build: dict[str, Any] | None = None, summary: str = "") -> str:
    """'#187 Audio extract: pulls audio out of screen recordings' from the build's name and its report / origin summary,
    else the PR title. Plain text from what exists; never generated. A PR title that already names the build is the
    whole line (no 'Name: Name: …')."""
    head = f"#{number} " if number else ""
    t = clean_title(pr_title)
    if build:
        name = short_name(build.get("title")) or t
        what = summary or first_sentence(build.get("said") or "")
        if what and _overlaps(name, what):
            what = ""
        if not what and t:
            if _overlaps(name, t):
                return f"{head}{t}".strip()
            what = t
        if what and what.lower().rstrip(".") != name.lower():
            what = what[:1].lower() + what[1:] if what[:2] != what[:2].upper() else what
            return f"{head}{name}: {what}".strip()
        return f"{head}{name}".strip()
    return f"{head}{t or 'untitled'}".strip()


def agent_of(build: dict[str, Any] | None) -> str:
    """Who built it: 'Assigned agent: Snap Sully' / 'Agent: Earl the Ear' in the build's detail or notes."""
    if not build:
        return ""
    texts = [str(build.get("detail") or "")] + [str(n.get("text") or "") for n in build.get("notes") or [] if isinstance(n, dict)]
    for t in texts:
        m = _AGENT.search(t)
        if m:
            return m.group(1).strip().rstrip(".")
    return ""


def depends_on(body: Any) -> list[int]:
    return sorted({int(n) for n in _DEPENDS.findall(str(body or ""))})


def blockers(pr: dict[str, Any], ui: dict[str, Any] | None, hold: dict[str, Any] | None, open_numbers: set[int], deps: list[int]) -> list[dict[str, str]]:
    """What keeps an open PR from merging, each with what clears it (plain English). CI is listed too ('ci' kind)."""
    out: list[dict[str, str]] = []
    if hold:
        out.append({"kind": "hold", "why": f"On hold: {hold.get('reason') or 'put on hold by hand'}", "clears": "Release the hold (Hold button again)"})
    if ui and ui.get("holds"):
        st = ui.get("state") or "waiting"
        out.append({"kind": "ui", "why": {"waiting": "UI Review is waiting for Brett", "changes": "UI Review asked for changes",
                                          "rejected": "UI Review rejected the screens"}.get(st, f"UI Review: {st}"),
                    "clears": "Brett approves its screenshots in UI Review" if st == "waiting" else "Fix the screens, send new shots to UI Review"})
    if pr.get("draft"):
        out.append({"kind": "draft", "why": "It's a draft", "clears": "Mark it ready for review on GitHub"})
    if pr.get("mergeable") is False or pr.get("mergeState") == "dirty":
        out.append({"kind": "conflict", "why": "Conflicts with main", "clears": "Update from main (or Fix sends it to Merge Max)"})
    for n in deps:
        if n in open_numbers and n != pr.get("number"):
            out.append({"kind": "depends", "why": f"Waits for #{n}", "clears": f"Merge #{n} first"})
    ci = pr.get("ci")
    if ci == "failure":
        out.append({"kind": "ci", "why": "CI failed", "clears": "Fix (Merge Max) or Re-run CI"})
    elif ci == "running":
        out.append({"kind": "ci", "why": "CI is running", "clears": "Wait for it to finish"})
    elif ci in ("none", "unknown", None):
        out.append({"kind": "ci", "why": "No CI result yet", "clears": "Push a commit or Re-run CI"})
    return out


def pr_sections(pr: dict[str, Any], blocks: list[dict[str, str]], now: float) -> list[str]:
    s: list[str] = []
    held = [b for b in blocks if b["kind"] != "ci"]
    if pr.get("ci") != "success":
        s.append("ci")
    if held:
        s.append("held")
    if pr.get("ci") == "success" and not held:
        s.append("ready")
    days = age_days(pr.get("updated"), now)
    if (days is not None and days > STALE_DAYS) or (pr.get("behind") or 0) > STALE_BEHIND:
        s.append("stale")
    return s


def status_of(sections: list[str], blocks: list[dict[str, str]], ci: str | None) -> tuple[str, str]:
    """(badge text, tone) for a PR row."""
    held = [b for b in blocks if b["kind"] != "ci"]
    if held:
        return ({"hold": "on hold", "ui": "UI review", "draft": "draft", "conflict": "conflicts", "depends": "waits"}.get(held[0]["kind"], "held"), "warning")
    if ci == "failure":
        return "CI failed", "danger"
    if ci == "running":
        return "CI running", "info"
    if "ready" in sections:
        return "ready", "success"
    return "no CI", "muted"


def pr_row(repo: str, pr: dict[str, Any], *, build: dict[str, Any] | None, summary: str, ui: dict[str, Any] | None, hold: dict[str, Any] | None,
           open_numbers: set[int], behind: int | None, ahead: int | None, cost: float | None, batch: str, now: float) -> dict[str, Any]:
    deps = depends_on(pr.get("body"))
    p = {**pr, "behind": behind}
    blocks = blockers(p, ui, hold, open_numbers, deps)
    secs = pr_sections(p, blocks, now)
    status, tone = status_of(secs, blocks, pr.get("ci"))
    return {
        "key": f"{repo}#{pr.get('number')}", "kind": "pr", "repo": repo, "number": pr.get("number"), "branch": pr.get("head") or "",
        "title": pr.get("title") or "", "lead": lead_line(pr.get("number"), pr.get("title"), build, summary),
        "agent": agent_of(build), "author": pr.get("author") or "", "status": status, "tone": tone, "ci": pr.get("ci") or "none",
        "ahead": ahead, "behind": behind, "at": pr.get("updated") or pr.get("created") or "", "cost": cost, "url": pr.get("url") or "",
        "sha": pr.get("sha") or "", "draft": bool(pr.get("draft")), "mergeable": pr.get("mergeable"), "blockers": blocks, "sections": secs,
        "build": build_ref(build), "ui": ui_ref(ui), "hold": hold, "batch": batch, "dependsOn": deps,
    }


def branch_row(repo: str, b: dict[str, Any], *, build: dict[str, Any] | None, summary: str, cost: float | None, now: float) -> dict[str, Any]:
    """A pushed branch ahead of main with no PR yet."""
    secs = ["push"]
    days = age_days(b.get("date"), now)
    if (days is not None and days > STALE_DAYS) or (b.get("behind") or 0) > STALE_BEHIND:
        secs.append("stale")
    if (b.get("behind") or 0) > 0:
        secs.append("pull")
    return {
        "key": f"{repo}:{b.get('name')}", "kind": "branch", "repo": repo, "number": None, "branch": b.get("name") or "",
        "title": b.get("subject") or "", "lead": lead_line(None, b.get("subject"), build, summary), "agent": agent_of(build),
        "status": "no PR yet", "tone": "info", "ci": b.get("ci") or "none", "ahead": b.get("ahead"), "behind": b.get("behind"),
        "at": b.get("date") or "", "cost": cost, "url": b.get("url") or "", "sha": b.get("sha") or "",
        "blockers": [{"kind": "nopr", "why": "Pushed, but no PR yet", "clears": "The push banner opens one next round (or Open PR)"}],
        "sections": secs, "build": build_ref(build), "ui": None, "hold": None, "batch": "", "dependsOn": [],
    }


def worktree_row(w: dict[str, Any], *, build: dict[str, Any] | None, summary: str, pr: dict[str, Any] | None, cost: float | None, now: float) -> dict[str, Any]:
    """A local checkout on the VPS (a build worktree or /opt/axf)."""
    secs: list[str] = []
    unpushed, dirty, behind = w.get("unpushed") or 0, w.get("dirty") or 0, w.get("behind")
    if unpushed or dirty:
        secs.append("push")
    if (behind or 0) > 0:
        secs.append("pull")
    days = age_days(w.get("at"), now)
    if not pr and ((days is not None and days > STALE_DAYS) or (behind or 0) > STALE_BEHIND):
        secs.append("stale")
    bits = []
    if unpushed:
        bits.append(f"{unpushed} commit{'s' if unpushed != 1 else ''} not on GitHub")
    if dirty:
        bits.append(f"{dirty} uncommitted file{'s' if dirty != 1 else ''}")
    if behind:
        bits.append(f"{behind} behind main")
    blocks = []
    if unpushed:
        blocks.append({"kind": "push", "why": f"{unpushed} local commit{'s' if unpushed != 1 else ''} not pushed", "clears": "The build pushes its branch (git push origin HEAD)"})
    if dirty:
        blocks.append({"kind": "dirty", "why": f"{dirty} file{'s' if dirty != 1 else ''} changed but not committed", "clears": "The build commits them, or they are build-store status files that go live by themselves"})
    status, tone = ("not pushed", "warning") if unpushed else ("uncommitted", "info") if dirty else ("behind", "muted") if behind else ("up to date", "success")
    return {
        "key": f"wt:{w.get('path')}", "kind": "worktree", "repo": w.get("repo") or "", "number": (pr or {}).get("number"), "branch": w.get("branch") or "",
        "title": w.get("subject") or "", "lead": lead_line((pr or {}).get("number"), w.get("subject"), build, summary) if build or pr else (w.get("subject") or w.get("branch") or ""),
        "agent": agent_of(build), "status": status, "tone": tone, "ci": (pr or {}).get("ci") or "", "ahead": w.get("ahead"), "behind": behind,
        "unpushed": unpushed, "dirty": dirty, "path": w.get("path") or "", "at": w.get("at") or "", "cost": cost, "url": (pr or {}).get("url") or "",
        "sha": w.get("sha") or "", "blockers": blocks, "sections": secs, "build": build_ref(build), "ui": None, "hold": None, "batch": "",
        "dependsOn": [], "detailLine": " · ".join(bits),
    }


def merged_row(m: dict[str, Any], *, build: dict[str, Any] | None, summary: str, cost: float | None) -> dict[str, Any]:
    return {
        "key": f"{m.get('repo')}#{m.get('number')}:merged", "kind": "merged", "repo": m.get("repo") or "", "number": m.get("number"),
        "branch": m.get("head") or "", "title": m.get("title") or "", "lead": lead_line(m.get("number"), m.get("title"), build, summary),
        "agent": agent_of(build), "author": m.get("author") or "", "status": "merged", "tone": "success", "ci": "success", "ahead": None, "behind": None,
        "at": m.get("mergedAt") or "", "cost": cost, "url": m.get("url") or "", "sha": m.get("sha") or "", "blockers": [], "sections": ["merged"],
        "build": build_ref(build), "ui": None, "hold": None, "batch": "", "dependsOn": [],
    }


def deploy_row(c: dict[str, Any]) -> dict[str, Any]:
    commit = c.get("commit") or {}
    how = "image tag" if c.get("exact") else "main when it was built"
    lead = f"{c.get('name')} runs {(commit.get('sha') or '?')[:8]}" + (f": {clean_title(commit.get('subject'))}" if commit.get("subject") else "")
    return {
        "key": f"deploy:{c.get('name')}", "kind": "deploy", "repo": c.get("repo") or "", "number": commit.get("pr"), "branch": "main",
        "title": c.get("name") or "", "lead": lead, "agent": "", "status": c.get("state") or "", "tone": "success" if c.get("state") == "running" else "warning",
        "ci": "", "ahead": None, "behind": c.get("behind"), "at": c.get("startedAt") or "", "cost": None, "url": "", "sha": commit.get("sha") or "",
        "blockers": ([{"kind": "behind", "why": f"{c['behind']} commit{'s' if c['behind'] != 1 else ''} on main since it was built", "clears": "Redeploy it"}] if c.get("behind") else []),
        "sections": ["deployed"], "build": None, "ui": None, "hold": None, "batch": "", "dependsOn": [], "image": c.get("image") or "",
        "detailLine": f"commit from the {how}" + (f" · {c.get('status')}" if c.get("status") else ""),
    }


def build_ref(b: dict[str, Any] | None) -> dict[str, Any] | None:
    if not b:
        return None
    steps = [s for s in b.get("steps") or [] if isinstance(s, dict) and not s.get("skip")]
    return {"id": b.get("id"), "title": b.get("title") or "", "status": b.get("status") or "", "done": sum(1 for s in steps if s.get("done")), "total": len(steps),
            "steps": [{"id": s.get("id"), "text": s.get("title") or s.get("text") or "", "model": s.get("model") or "", "done": bool(s.get("done"))} for s in steps][:40],
            "profiles": b.get("profiles") or []}


def ui_ref(ui: dict[str, Any] | None) -> dict[str, Any] | None:
    if not ui or ui.get("state") in (None, "none"):
        return None
    return {"state": ui.get("state"), "holds": bool(ui.get("holds")), "items": (ui.get("items") or [])[:10]}


def counts(rows: list[dict[str, Any]]) -> dict[str, int]:
    c = {s: 0 for s in SECTION_IDS}
    for r in rows:
        for s in r.get("sections") or []:
            if s in c:
                c[s] += 1
    return c


def batch_view(batch: dict[str, Any], rows_by_key: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """A push batch with its live badges and its PRs in merge order (merged ones first, then the order Brett set)."""
    items = []
    for k in batch.get("items") or []:
        r = rows_by_key.get(k)
        items.append(r if r else {"key": k, "kind": "gone", "lead": f"{k} (closed or merged)", "status": "gone", "tone": "muted", "sections": []})
    badge = {"ready": 0, "ci": 0, "held": 0, "failed": 0, "gone": 0}
    for r in items:
        secs = r.get("sections") or []
        if r.get("kind") == "gone":
            badge["gone"] += 1
        if "ready" in secs:
            badge["ready"] += 1
        if "held" in secs:
            badge["held"] += 1
        if "ci" in secs:
            badge["ci"] += 1
        if r.get("ci") == "failure":
            badge["failed"] += 1
    nxt = next((r for r in items if "ready" in (r.get("sections") or [])), None)
    return {**{k: batch.get(k) for k in ("id", "title", "createdAt", "by")}, "items": items, "badges": badge,
            "next": nxt.get("key") if nxt else "", "state": "done" if items and badge["gone"] == len(items) else "ready" if nxt else "waiting"}


def now_utc() -> float:
    return datetime.now(timezone.utc).timestamp()
