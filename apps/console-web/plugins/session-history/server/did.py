"""What a run built, in plain English, from what really happened (pure apart from read-only git calls).

  * the run's own summary: the agent-run@1 report's ``summary``, else the result text, else its last reply
  * one line per commit the run made (found in its own tool output, ``[branch abc1234] subject``, plus the report's
    ``commits``): item = subject, what was wrong = the commit body's first paragraph, files with +/- counts and their
    before / after hunks from ``git show`` (or, when the checkout is gone, the run's own Edit calls in that window)
  * one line for edits made after the last commit (not committed)
  * the report's own ``changes`` ({item, wrong, before, after, files}) when an agent wrote them
Each line carries the turn range that produced it, so the price step can put an estimated cost on it.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any

from .runs import redact

COMMIT_OUT = re.compile(r"^\[([^\s\]]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$", re.M)
SHA = re.compile(r"^[0-9a-f]{7,40}$")
PR_URL = re.compile(r"https://github\.com/[\w.-]+/[\w.-]+/pull/\d+")
HUNK_LINES = 40     # before / after lines kept per file
FILES_MAX = 40      # files per commit with hunks


def _git(cwd: str, *args: str, timeout: int = 10) -> str | None:
    if not cwd or not Path(cwd).is_dir():
        return None
    try:
        p = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return None
    return p.stdout if p.returncode == 0 else None


def github_base(cwd: str) -> str | None:
    """https://github.com/<owner>/<repo> for the checkout's origin, or None."""
    url = (_git(cwd, "remote", "get-url", "origin") or "").strip()
    m = re.search(r"github\.com[:/]([\w.-]+)/([\w.-]+?)(?:\.git)?$", re.sub(r"https://[^@/]+@", "https://", url))
    return f"https://github.com/{m.group(1)}/{m.group(2)}" if m else None


def commits_in_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Commits the run made itself: ``git commit`` output in its tool results → [{sha, branch, subject, turn, n}]."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for e in events:
        if e.get("kind") != "tool_result" or "]" not in (e.get("text") or ""):
            continue
        for m in COMMIT_OUT.finditer(e["text"]):
            sha = m.group(2)
            if sha in seen:
                continue
            seen.add(sha)
            out.append({"sha": sha, "branch": m.group(1), "subject": m.group(3).strip()[:300], "turn": e.get("turn"), "n": e.get("n")})
    return out


def _hunks(diff: str) -> dict[str, dict[str, list[str]]]:
    """``git show`` patch → {path: {before: [...], after: [...]}} (removed / added lines, capped)."""
    files: dict[str, dict[str, list[str]]] = {}
    cur: dict[str, list[str]] | None = None
    for line in diff.splitlines():
        if line.startswith("diff --git "):
            m = re.match(r"diff --git a/(.+?) b/(.+)$", line)
            cur = files.setdefault(m.group(2) if m else line[11:], {"before": [], "after": []}) if len(files) < FILES_MAX else None
        elif cur is None or line.startswith(("--- ", "+++ ", "index ", "new file", "deleted file", "similarity", "rename ")):
            continue
        elif line.startswith("@@"):
            for side in ("before", "after"):
                if cur[side] and len(cur[side]) < HUNK_LINES:
                    cur[side].append("…")
        elif line.startswith("-") and len(cur["before"]) < HUNK_LINES:
            cur["before"].append(redact(line[1:], 400))
        elif line.startswith("+") and len(cur["after"]) < HUNK_LINES:
            cur["after"].append(redact(line[1:], 400))
    return files


def commit_detail(cwd: str, sha: str) -> dict[str, Any] | None:
    """Subject, body, date and per-file +/- and before / after of one commit, read from the checkout."""
    if not SHA.match(sha):
        return None
    head = _git(cwd, "show", "-s", "--format=%H%x1f%aI%x1f%s%x1f%b", sha)
    if not head:
        return None
    full, at, subject, body = (head.rstrip("\n").split("\x1f") + ["", "", "", ""])[:4]
    stats: dict[str, tuple[int | None, int | None]] = {}
    for line in (_git(cwd, "show", "--numstat", "--format=", sha) or "").splitlines():
        parts = line.split("\t")
        if len(parts) == 3:
            a, d, path = parts
            stats[path] = (int(a) if a.isdigit() else None, int(d) if d.isdigit() else None)
    hunks = _hunks(_git(cwd, "show", "--format=", "--unified=1", "--no-color", sha, timeout=20) or "")
    files = [{"path": p, "added": a, "removed": d, **hunks.get(p, {"before": [], "after": []})} for p, (a, d) in list(stats.items())[:200]]
    wrong = body.strip().split("\n\n")[0].strip()
    if wrong.lower().startswith("co-authored-by"):
        wrong = ""
    return {"sha": full, "at": at, "subject": subject, "wrong": redact(wrong, 1200), "files": files}


def _edit_files(events: list[dict[str, Any]], lo: int, hi: int) -> list[dict[str, Any]]:
    """The run's own file edits between two event indexes → per-file before / after (old_string → new_string)."""
    by: dict[str, dict[str, Any]] = {}
    for e in events:
        if not (lo <= e.get("n", -1) < hi) or e.get("kind") != "tool_use" or e.get("tool") not in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
            continue
        i = e.get("input") if isinstance(e.get("input"), dict) else {}
        path = str(i.get("file_path") or i.get("notebook_path") or "?")
        f = by.setdefault(path, {"path": path, "added": None, "removed": None, "before": [], "after": [], "edits": 0})
        f["edits"] += 1
        pairs = [(i.get("old_string"), i.get("new_string"))] if e["tool"] == "Edit" else \
            [(x.get("old_string"), x.get("new_string")) for x in i.get("edits") or [] if isinstance(x, dict)] if e["tool"] == "MultiEdit" else \
            [("", i.get("content") or i.get("new_source"))]
        for old, new in pairs:
            for side, text in (("before", old), ("after", new)):
                lines = str(text or "").splitlines()
                if f[side] and lines and len(f[side]) < HUNK_LINES:
                    f[side].append("…")
                f[side].extend(redact(x, 400) for x in lines[: max(0, HUNK_LINES - len(f[side]))])
    return list(by.values())


def commits_in_window(cwd: str, branch: str, start: str | None, end: str | None) -> list[tuple[str, str]]:
    """Commits on the run's branch made while it ran (``git commit -q`` prints nothing, so the log is asked too)."""
    if not (start and end and branch) or not re.match(r"^[\w./-]{1,200}$", branch) or branch.startswith("-"):
        return []
    from .runs import iso, parse_ts
    hi = iso((parse_ts(end) or 0) + 120)
    out = _git(cwd, "log", "--no-merges", "--format=%H%x1f%aI", f"--since={start}", f"--until={hi}", branch, "--") or ""
    rows = [tuple(x.split("\x1f")[:2]) for x in out.splitlines() if "\x1f" in x]
    lo = parse_ts(start) or 0
    return [(h, a) for h, a in reversed(rows) if (parse_ts(a) or 0) >= lo - 5][:200]


def _place(made: list[dict[str, Any]], events: list[dict[str, Any]], cwd: str) -> None:
    """Commits without a place in the event list get one from their time (the last event at or before it), then
    everything is put in event order."""
    from .runs import parse_ts
    for c in made:
        if isinstance(c.get("n"), int):
            continue
        at = (_git(cwd, "show", "-s", "--format=%aI", c["sha"]) or "").strip() if SHA.match(c["sha"]) else ""
        t = parse_ts(at)
        if t is None:
            continue
        best = None
        for e in events:
            et = parse_ts(e.get("at"))
            if et is not None and et <= t + 1:
                best = e
        if best is not None:
            c["n"], c["turn"] = best["n"], best.get("turn")
    made.sort(key=lambda c: c["n"] if isinstance(c.get("n"), int) else 1 << 30)


def last_reply(events: list[dict[str, Any]]) -> str:
    for e in reversed(events):
        if e.get("kind") == "text" and e.get("role") == "assistant" and not e.get("sidechain") and (e.get("text") or "").strip():
            return e["text"]
    return ""


def what_it_did(run: dict[str, Any], events: list[dict[str, Any]]) -> dict[str, Any]:
    cwd = run.get("cwd") or ""
    gh = github_base(cwd)
    report = run.get("report") or {}
    summary = str(report.get("summary") or run.get("resultText") or last_reply(events) or "")
    lines: list[dict[str, Any]] = []

    for c in report.get("changes") or []:
        if isinstance(c, dict) and c.get("item"):
            files = [str(f)[:400] for f in c.get("files") or [] if isinstance(f, str)][:40]
            lines.append({"kind": "report", "item": redact(c.get("item"), 300), "wrong": redact(c.get("wrong") or "", 1200),
                          "before": redact(c.get("before") or "", 2000), "after": redact(c.get("after") or "", 2000), "files": [{"path": f} for f in files]})

    made = commits_in_events(events)
    known = {c["sha"][:7] for c in made}
    extra = [s for s in run.get("commits") or [] if isinstance(s, str) and SHA.match(s)]
    extra += [s for s, _ in commits_in_window(cwd, run.get("branch") or "", run.get("startedAt"), run.get("lastAt"))]
    for sha in extra:
        if sha[:7] not in known:
            made.append({"sha": sha, "branch": run.get("branch") or "", "subject": "", "turn": None, "n": None})
            known.add(sha[:7])
    _place(made, events, cwd)
    prev_n, prev_turn = 0, 0
    for c in made:
        hi = c["n"] if isinstance(c.get("n"), int) else len(events)
        d = commit_detail(cwd, c["sha"])
        files = d["files"] if d else _edit_files(events, prev_n, hi)
        sha = d["sha"] if d else c["sha"]
        lines.append({
            "kind": "commit", "sha": sha, "branch": c.get("branch"), "at": (d or {}).get("at"), "item": (d or {}).get("subject") or c["subject"] or sha[:10],
            "wrong": (d or {}).get("wrong", ""), "files": files, "fromGit": bool(d),
            "url": f"{gh}/commit/{sha}" if gh and len(sha) >= 7 else None,
            "turns": [prev_turn, c["turn"]] if isinstance(c.get("turn"), int) else None,
        })
        if isinstance(c.get("n"), int):
            prev_n, prev_turn = c["n"] + 1, (c["turn"] or 0) + 1
    rest = _edit_files(events, prev_n, len(events) + 1)
    if rest:
        last_turn = max((e.get("turn") or 0 for e in events), default=0)
        lines.append({"kind": "uncommitted", "item": "Edits not in a commit" if made else "File edits", "wrong": "", "files": rest,
                      "turns": [prev_turn, last_turn]})

    for f in (x for ln in lines for x in ln.get("files") or []):
        p = str(f.get("path") or "")
        if cwd and p.startswith(cwd.rstrip("/") + "/"):
            p = f["path"] = p[len(cwd.rstrip("/")) + 1:]
        if gh and p and not p.startswith("/") and run.get("branch"):
            f["url"] = f"{gh}/blob/{run['branch']}/{p}"

    prs = list(dict.fromkeys(([run["pr"]] if run.get("pr") else []) + [m.group(0) for e in events if e.get("kind") in ("tool_result", "text") for m in PR_URL.finditer(e.get("text") or "")]))[:5]
    return {
        "summary": redact(summary, 4000), "lines": lines,
        "links": {"repo": gh, "branch": f"{gh}/tree/{run['branch']}" if gh and run.get("branch") else None, "prs": prs},
    }
