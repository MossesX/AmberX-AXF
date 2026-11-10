"""Clean up build profiles: the console side of ``engine/profiles.mjs`` (profile-cleanup@1).

Basic mode is the engine's own audit (exact matches only). Deep mode starts from it and asks an AI model (the
``axf.llm@1`` capability, when a plugin provides it) to re-judge only the open builds Basic kept, with real evidence
to point at: recent commits on main, build reports, the catalog's built items and the other builds. An AI verdict
counts only when its proof is one of those; anything else stays ``keep``. Running and waiting builds are never sent.

Every preview, apply and undo raises one console notification that says which mode ran. Nothing is applied without
Brett: a scheduled run only makes a preview and tells him it is ready.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any, Callable

import console_context as cx
import plugin_services

PLUGIN_DIR = Path(__file__).resolve().parents[1]
ENGINE = PLUGIN_DIR / "engine" / "profiles.mjs"
LLM_CAP = "axf.llm@1"
ALERT_SOURCE = "maintenance"
ALERT_KEY = "maintenance:profiles"
RUN_ID = re.compile(r"^pc-\d{8}-\d{6}-[a-z0-9]{4}$")
DEEP_VERDICTS = ("done", "not-needed", "duplicate", "keep")
BATCH = 20


class ProfileError(Exception):
    pass


def _root() -> Path:
    return Path(os.environ.get("AXF_ROOT") or cx.ROOT)


def node(data_dir: Path, *args: str, stdin: str | None = None, timeout: int = 180) -> Any:
    """Run the engine with --json and return its JSON (ProfileError with the engine's message otherwise)."""
    env = {**os.environ, "AXF_MAINT_DATA_DIR": str(data_dir)}
    try:
        p = subprocess.run(["node", str(ENGINE), *args, "--json"], cwd=_root(), input=stdin, capture_output=True, text=True,
                           timeout=timeout, env=env)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise ProfileError(f"the profile engine didn't run ({type(e).__name__})") from None
    try:
        out = json.loads((p.stdout or "").strip().splitlines()[-1]) if p.stdout.strip() else None
    except (ValueError, IndexError):
        out = None
    if isinstance(out, dict) and out.get("error"):
        raise ProfileError(str(out["error"])[:300])
    if p.returncode != 0 or out is None:
        raise ProfileError((p.stderr or "the profile engine failed").strip()[-300:])
    return out


def llm() -> Any:
    svc = plugin_services.get(LLM_CAP)
    return svc if svc is not None and hasattr(svc, "complete") else None


def _notify(severity: str, title: str, body: str) -> None:
    cx.raise_alert({"source": ALERT_SOURCE, "key": ALERT_KEY, "severity": severity, "title": title, "body": body,
                    "link": "view:maintenance"})


# ------------------------------------------------------------------ Deep mode

def _git(*args: str) -> str:
    try:
        p = subprocess.run(["git", *args], cwd=_root(), capture_output=True, text=True, timeout=30)
        return p.stdout if p.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


def evidence() -> dict[str, Any]:
    """What the AI may point at as proof: commits on main, reports, catalog items marked built."""
    ref = next((r for r in ("origin/main", "main") if _git("rev-parse", "--verify", "-q", r).strip()), "HEAD")
    commits = []
    for line in _git("log", ref, "--format=%h\t%s", "-n", "400").splitlines():
        sha, _, subj = line.partition("\t")
        if sha and not subj.startswith("Builds live:"):
            commits.append({"sha": sha, "subject": subj[:140]})
    reports = sorted(str(p.relative_to(_root())) for p in (_root() / "_claude" / "builds" / "reports").glob("*.md"))[:400]
    try:
        status = json.loads((_root() / "framework" / "catalog" / "status.json").read_text("utf-8"))
    except (OSError, ValueError):
        status = {}
    built = sorted(k for k, v in status.items() if isinstance(v, dict) and v.get("status") == "built")[:600]
    return {"ref": ref, "commits": commits[:300], "reports": reports, "built": built}


PROMPT = """You audit Brett's open builds in the AmberX AXF build profiles. For each build below, decide:
- "done": main already has it. Proof MUST be "commit:<sha>" from the commit list, or "report:<path>" from the report list.
- "not-needed": nothing needs it any more (e.g. it belongs to something retired). Proof MUST be "commit:<sha>" or "report:<path>".
- "duplicate": another build already covers it. Proof MUST be "build:<id>" from the builds list (not itself).
- "keep": still to do, or you are not sure. Use keep whenever in doubt.
Reply with JSON only: {{"verdicts": [{{"key": "...", "verdict": "...", "reason": "one short plain line", "proof": "..."}}]}}

Commits on main (newest first):
{commits}

Reports:
{reports}

Catalog items built: {built}

All builds (id: title [status]):
{builds}

Builds to judge:
{todo}
"""


def deep_review(plan: dict[str, Any], svc: Any, ev: dict[str, Any] | None = None, repo: str = "") -> dict[str, Any]:
    """Re-judge the unlocked keep builds with the AI. Only verdicts with valid proof are taken; the rest stay keep."""
    ev = ev or evidence()
    items = [i for p in plan["profiles"] for i in p["items"]]
    by_id = {i["id"]: i for i in items if i["kind"] == "build"}
    todo = [i for i in items if i["kind"] == "build" and i["verdict"] == "keep" and not i.get("locked") and i.get("about")]
    shas = {c["sha"] for c in ev["commits"]}
    reports = set(ev["reports"])
    stats = {"asked": len(todo), "changed": 0, "batches": 0, "errors": 0}
    all_builds = "\n".join(f"{i['id']}: {i['title'][:100]} [{i['status']}]" for i in items if i["kind"] == "build")
    for start in range(0, len(todo), BATCH):
        batch = todo[start:start + BATCH]
        stats["batches"] += 1
        text = PROMPT.format(
            commits="\n".join(f"{c['sha']} {c['subject']}" for c in ev["commits"]),
            reports="\n".join(ev["reports"]), built=", ".join(ev["built"]), builds=all_builds,
            todo=json.dumps([{"key": i["key"], "id": i["id"], "title": i["title"], **i["about"]} for i in batch], ensure_ascii=False))
        try:
            out = svc.complete([{"role": "user", "content": text}], system="You are careful and literal. Reply with JSON only.",
                               params={"temperature": 0, "max_tokens": 4000})
            m = re.search(r"\{.*\}", (out or {}).get("text") or "", re.S)
            got = json.loads(m.group(0)).get("verdicts", []) if m else []
        except Exception:  # noqa: BLE001 — a failed batch keeps its Basic verdicts
            stats["errors"] += 1
            continue
        keys = {i["key"]: i for i in batch}
        for v in got if isinstance(got, list) else []:
            it = keys.get(str((v or {}).get("key")))
            verdict = str((v or {}).get("verdict"))
            if not it or verdict not in DEEP_VERDICTS or verdict == "keep":
                continue
            kind, _, ref = str(v.get("proof") or "").partition(":")
            proof = None
            if verdict in ("done", "not-needed") and kind == "commit" and ref in shas:
                proof = {"label": f"commit {ref}", "url": f"{repo}/commit/{ref}" if repo else ""}
            elif verdict in ("done", "not-needed") and kind == "report" and ref in reports:
                proof = {"label": "report", "path": ref}
            elif verdict == "duplicate" and kind == "build" and ref in by_id and ref != it["id"]:
                proof = {"label": ref, "path": "_claude/builds/store.json"}
            if not proof:
                continue
            reason = re.sub(r"\s+", " ", str(v.get("reason") or "")).strip()[:200] or verdict
            it.update(verdict=verdict, reason=f"{reason} (AI)", proof=proof, by="ai")
            if verdict == "duplicate":
                t = by_id[ref]
                if t["status"] in ("running", "waiting"):
                    it.update(verdict="keep", reason=f"Same as {ref}, which is running: merge it once that finishes (AI)")
                elif t["status"] == "built":
                    it["into"] = ref
                else:
                    it.update(verdict="merge", into=ref)
            stats["changed"] += 1
    _retotal(plan)
    plan["mode"] = "deep"
    plan["deep"] = stats
    return plan


def _retotal(plan: dict[str, Any]) -> None:
    verdicts = ("keep", "done", "not-needed", "duplicate", "merge")
    for p in plan["profiles"]:
        p["totals"] = {v: sum(1 for i in p["items"] if i["verdict"] == v) for v in verdicts}
        p["emptyAfter"] = not p.get("base") and all(i["kind"] != "build" or i["verdict"] != "keep" for i in p["items"])
    items = [i for p in plan["profiles"] for i in p["items"]]
    plan["totals"] = {"items": len(items), **{v: sum(1 for i in items if i["verdict"] == v) for v in verdicts}}
    plan["empty"] = [p["id"] for p in plan["profiles"] if p["emptyAfter"]]


def _strip(plan: dict[str, Any]) -> dict[str, Any]:
    for p in plan["profiles"]:
        for i in p["items"]:
            i.pop("about", None)
    return plan


# ------------------------------------------------------------------ preview / apply / undo

def _cleanups(plan: dict[str, Any]) -> int:
    return sum(1 for p in plan["profiles"] for i in p["items"] if i["verdict"] != "keep" and not i.get("locked"))


def preview(data_dir: Path, mode: str = "auto", by: str = "console", svc_of: Callable[[], Any] = llm) -> dict[str, Any]:
    """Make and save a preview. mode: auto (Deep when an AI model is there) | basic | deep (fails without one)."""
    svc = svc_of() if mode in ("auto", "deep") else None
    if mode == "deep" and svc is None:
        raise ProfileError("Deep mode needs an AI model (install or set up the AI assistant), or use Basic")
    if svc is None:
        plan = node(data_dir, "audit", "--save")
        why = "no AI model is set up" if mode == "auto" else "Basic was picked"
    else:
        plan = node(data_dir, "audit", "--details")
        plan = deep_review(plan, svc, repo=_repo_url())
        plan = node(data_dir, "save", stdin=json.dumps(_strip(plan)))
        why = f"AI re-checked {plan['deep']['asked']} open build(s), changed {plan['deep']['changed']}"
        if plan["deep"]["errors"]:
            why += f"; {plan['deep']['errors']} batch(es) failed and kept their Basic verdicts"
    plan["by"] = by
    n = _cleanups(plan)
    label = "Deep (AI)" if plan["mode"] == "deep" else "Basic (no AI, exact matches only)"
    _notify("info", f"Build profile clean-up preview ready: {n} to clean up",
            f"Ran in {label} mode because {why}. {plan['totals']['items']} items checked across "
            f"{sum(1 for p in plan['profiles'] if p['items'])} profiles. Open Maintenance to review and apply it.")
    return plan


def apply(data_dir: Path, run: str, skip: list[str], by: str = "console") -> dict[str, Any]:
    if not RUN_ID.match(run):
        raise ProfileError("run: a preview id from the clean-up")
    plan = node(data_dir, "plan", run)
    args = ["apply", run, "--by", by[:40]]
    if skip:
        args += ["--skip", ",".join(skip)]
    r = node(data_dir, *args, timeout=300)
    label = "Deep (AI)" if (plan or {}).get("mode") == "deep" else "Basic"
    body = f"{len(r.get('applied', []))} cleaned up, {len(r.get('skipped', []))} skipped ({label} preview). Undo is on the run in Maintenance."
    if r.get("empty"):
        body += f" Nothing left to build in: {', '.join(r['empty'])} (flagged, not removed)."
    _notify("success", "Build profiles cleaned up", body)
    return r


def undo(data_dir: Path, run: str, by: str = "console") -> dict[str, Any]:
    if not RUN_ID.match(run):
        raise ProfileError("run: a clean-up run id")
    r = node(data_dir, "undo", run, "--by", by[:40], timeout=300)
    u = r.get("undo") or {}
    left = u.get("left") or []
    _notify("warning" if left else "info", "Build profile clean-up undone",
            f"Put back {len(u.get('restored') or [])} build(s)" + (f"; {len(left)} changed since and left as they are." if left else "."))
    return r


def runs(data_dir: Path) -> list[dict[str, Any]]:
    return node(data_dir, "runs")


def read_plan(data_dir: Path, run: str) -> dict[str, Any]:
    if not RUN_ID.match(run):
        raise ProfileError("run: a preview id")
    p = node(data_dir, "plan", run)
    if not isinstance(p, dict) or "profiles" not in p:
        raise ProfileError(f"no preview {run}")
    return p


def _repo_url() -> str:
    m = re.search(r"github\.com[/:]([^/]+/[^/.]+?)(?:\.git)?$", _git("remote", "get-url", "origin").strip())
    return f"https://github.com/{m.group(1)}" if m else ""


def due(s: dict[str, Any], last: str | None, now: float) -> bool:
    """Is the scheduled preview due now (once per day at profileHour; weekly on profileWeekday)?"""
    if s.get("profileSchedule") not in ("daily", "weekly"):
        return False
    lt = time.localtime(now)
    if lt.tm_hour != s.get("profileHour"):
        return False
    if s["profileSchedule"] == "weekly" and lt.tm_wday != s.get("profileWeekday"):
        return False
    return last != time.strftime("%Y-%m-%d", lt)
