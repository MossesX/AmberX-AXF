"""
The handoff results browser on axHub (claude-handoff-results@1).

After each assembly the console writes what it produced into the hub's shared data folder, and axHub shows it at
https://axhub.amberxai.com/handoff behind its admin sign-in (axHub reads this folder by convention; it never runs
anything from it and draws its own escaped pages from the data):

    <projects>/_shared/_data/handoff/
        index.json                      {"$axf": "claude-handoff-results@1", updatedAt, runs: [summary, …]} newest first
        runs/<id>/run.json              the run: prompt, instructions, what was published, the installer's log, files
        runs/<id>/files/<kit path>      the kit's text files as they were for that prompt

Only the last KEEP runs are kept. `AXF_HANDOFF_RESULTS` overrides the folder (`off` = none); without it the folder
exists only where /projects is mounted (the console container). Files are group-readable (0664 / 2775) so the hub
(uid 1000, same group) can read them. The kit is already secret-free (redacted when built); nothing else is written.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import time
from pathlib import Path
from typing import Any

FORMAT = "claude-handoff-results@1"
KEEP = 10
MAX_FILE = 400_000
MAX_FILES = 300
MAX_TOTAL = 8_000_000
ID_RE = re.compile(r"^\d{8}-\d{6}-[a-z0-9]{4}$")
PATH_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.\-]{0,120}(/[A-Za-z0-9_][A-Za-z0-9_.\-]{0,120}){0,6}$")
FILE_MODE, DIR_MODE = 0o664, 0o2775


def results_dir() -> Path | None:
    env = os.environ.get("AXF_HANDOFF_RESULTS")
    if env is not None:
        return Path(env) if env and env != "off" else None
    projects = Path(os.environ.get("AXHUB_PROJECTS_DIR") or "/projects")
    return projects / "_shared" / "_data" / "handoff" if projects.is_dir() else None


def hub_origin() -> str:
    hub = (os.environ.get("AXF_WALL_HUB") or "https://axhub.amberxai.com").strip().rstrip("/")
    return hub if re.match(r"^https://[a-z0-9.-]+(:\d+)?$", hub, re.I) else "https://axhub.amberxai.com"


def run_url(run_id: str) -> str:
    return f"{hub_origin()}/handoff/{run_id}"


def new_id(at_ms: int) -> str:
    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime(at_ms / 1000))
    return f"{stamp}-{''.join(secrets.choice('abcdefghijklmnopqrstuvwxyz0123456789') for _ in range(4))}"


def _mkdir(p: Path) -> None:
    """Make p and any missing parents, each group-readable (setgid) so the hub can read them."""
    missing = []
    q = p
    while not q.exists():
        missing.append(q)
        q = q.parent
    for d in reversed(missing):
        d.mkdir(exist_ok=True)
        try:
            os.chmod(d, DIR_MODE)
        except OSError:
            pass


def _write(p: Path, data: bytes) -> None:
    _mkdir(p.parent)
    tmp = p.with_name(f".{p.name}.{os.getpid()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, FILE_MODE)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    os.chmod(tmp, FILE_MODE)
    os.replace(tmp, p)


def _write_json(p: Path, data: Any) -> None:
    _write(p, (json.dumps(data, indent=1, ensure_ascii=False) + "\n").encode("utf-8"))


def _read_json(p: Path, default: Any) -> Any:
    try:
        return json.loads(p.read_text("utf-8"))
    except Exception:  # noqa: BLE001
        return default


def kit_files(kit: Path) -> list[tuple[str, bytes]]:
    """The kit's text files (sorted, no symlinks, plain paths, capped by size and count)."""
    out: list[tuple[str, bytes]] = []
    total = 0
    if not kit.is_dir() or kit.is_symlink():
        return out
    for p in sorted(kit.rglob("*")):
        rel = p.relative_to(kit).as_posix()
        if p.is_symlink() or not p.is_file() or not PATH_RE.match(rel) or any(part.startswith(".") for part in rel.split("/")):
            continue
        data = p.read_bytes()
        if len(data) > MAX_FILE or total + len(data) > MAX_TOTAL:
            continue
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            continue
        out.append((rel, data))
        total += len(data)
        if len(out) >= MAX_FILES:
            break
    return out


def instructions(project: str, repo: str) -> str:
    return "\n".join([
        f"# Move {project} to a new Claude account",
        "",
        f"1. Sign in to the new Claude account and open claude.ai/code (connect GitHub as {repo.split('/')[0]} if it asks).",
        f"2. Start a new session on the repo {repo}. Keep working on that same repo: no new repository, no fork.",
        "3. Paste the prompt below as the first message and send it.",
        "4. Claude reads _claude/handoff/HANDOFF.md, then gives you the claude.ai Project's name, description, instructions and the files to upload. Make the Project with them.",
        "5. Give Claude each secret it asks for (SECRETS.md lists names only). Never paste a secret anywhere else.",
        "6. Claude goes through SETUP.md and tells you what is done and what still needs you.",
        "",
        "The files below are the kit as it was for this prompt (`_claude/handoff/` in the repo).",
    ])


def summary(run: dict[str, Any]) -> dict[str, Any]:
    return {k: run.get(k) for k in ("id", "at", "project", "repo", "commit", "published", "files", "failed", "note")}


def publish(folder: Path, *, at_ms: int, project: str, repo: str, commit: str, result: dict[str, Any], kit: Path,
            run: dict[str, Any] | None = None) -> dict[str, Any]:
    """Write one assembly's results, add it to the index (newest first) and drop runs past the last KEEP."""
    run_id = new_id(at_ms)
    _mkdir(folder)
    base = folder / "runs" / run_id
    files = kit_files(kit)
    for rel, data in files:
        _write(base / "files" / rel, data)
    pub = result.get("published") or {}
    record = {
        "$axf": FORMAT, "id": run_id, "at": at_ms, "project": project, "repo": repo, "commit": commit[:40],
        "prompt": str(result.get("prompt", ""))[:20_000], "note": str(result.get("note", ""))[:2000],
        "current": bool(result.get("current")),
        "published": {"pushed": bool(pub.get("pushed")), "sha": str(pub.get("sha", ""))[:40]} if pub else None,
        "instructions": instructions(project, repo),
        "files": [{"path": rel, "bytes": len(data)} for rel, data in files],
        "run": run, "failed": bool(run and run.get("failed")),
    }
    _write_json(base / "run.json", record)
    _update_index(folder, record)
    return {"id": run_id, "url": run_url(run_id)}


def attach_run(folder: Path, run_id: str, run: dict[str, Any]) -> bool:
    """The installer finished: add its log, time and counts to that run."""
    if not ID_RE.match(run_id):
        return False
    p = folder / "runs" / run_id / "run.json"
    rec = _read_json(p, None)
    if not isinstance(rec, dict):
        return False
    rec["run"] = run
    rec["failed"] = bool(run.get("failed"))
    _write_json(p, rec)
    _update_index(folder, rec)
    return True


def _update_index(folder: Path, record: dict[str, Any]) -> None:
    idx = _read_json(folder / "index.json", {})
    runs = [r for r in (idx.get("runs") if isinstance(idx, dict) else None) or [] if isinstance(r, dict) and r.get("id") != record["id"]]
    runs = sorted([summary(record), *runs], key=lambda r: r.get("at") or 0, reverse=True)
    keep, drop = runs[:KEEP], runs[KEEP:]
    _write_json(folder / "index.json", {"$axf": FORMAT, "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "runs": keep})
    kept = {r["id"] for r in keep}
    runs_dir = folder / "runs"
    for r in drop:
        kept.discard(r.get("id"))
    # remove run folders that are no longer listed (only our own id-shaped folders, never through a symlink)
    if runs_dir.is_dir() and not runs_dir.is_symlink():
        for d in runs_dir.iterdir():
            if ID_RE.match(d.name) and d.name not in kept and d.is_dir() and not d.is_symlink():
                shutil.rmtree(d, ignore_errors=True)
