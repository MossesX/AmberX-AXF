"""What's new since this browser last opened the console: commits on the console's clone, plugin changes, and (with
AI on) a plain-English summary written by Mosses, saved per commit range so it's still there when AI is off."""
from __future__ import annotations

import hashlib
import re
import subprocess
import time
from typing import Any

import console_context as cx
import plugin_services

from . import store

SHA = re.compile(r"^[0-9a-f]{7,40}$")


def _git(*args: str) -> str:
    r = subprocess.run(["git", "-C", str(cx.ROOT), *args], capture_output=True, text=True, timeout=15)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip()[:200] or "git failed")
    return r.stdout


def head() -> str:
    try:
        return _git("rev-parse", "HEAD").strip()
    except (OSError, RuntimeError, subprocess.SubprocessError):
        return ""


def commits(since: str, limit: int = 80) -> dict[str, Any]:
    h = head()
    if not h:
        return {"head": "", "commits": [], "known": False, "error": "the console's folder isn't a git clone"}
    known = bool(since) and bool(SHA.match(since))
    if known:
        try:
            _git("cat-file", "-e", f"{since}^{{commit}}")
            _git("merge-base", "--is-ancestor", since, "HEAD")
        except (RuntimeError, subprocess.SubprocessError):
            known = False
    rng = [f"{since}..HEAD"] if known else ["-n", "15"]
    raw = _git("log", "--no-merges", f"--max-count={limit + 1}", "--format=%H%x1f%h%x1f%s%x1f%an%x1f%ct", *rng)
    out = []
    for line in raw.splitlines():
        parts = line.split("\x1f")
        if len(parts) == 5:
            out.append({"sha": parts[0], "short": parts[1], "subject": parts[2][:300], "author": parts[3][:80], "at": int(parts[4]) * 1000})
    return {"head": h, "commits": out[:limit], "truncated": len(out) > limit, "known": known}


def plugins() -> list[dict[str, Any]]:
    from .derive import plugin_manifests
    return [{"folder": m["folder"], "name": m.get("name", m["folder"]), "version": m.get("version", "")} for m in plugin_manifests() if not m.get("error")]


def summarize(cs: list[dict[str, Any]]) -> dict[str, Any]:
    """Mosses writes a short summary of the commits (cached per range; reused when AI is off)."""
    if not cs:
        return {"text": "", "cached": False}
    key = hashlib.sha256((cs[-1]["sha"] + ".." + cs[0]["sha"]).encode()).hexdigest()[:24]
    hit = store.summary(key)
    if hit:
        return {**hit, "cached": True}
    from .derive import MOSSES, requirement_status
    if not requirement_status()["ok"]:
        raise PermissionError("AI needs the AI assistant and the Mosses agent installed")
    llm = plugin_services.get("axf.llm@1")
    agent = plugin_services.get("axf.agents@1").get_agent(MOSSES) or {}
    lst = "\n".join(f"- {c['subject']}" for c in cs[:80])
    prompt = ("Brett just opened his AmberX Dev Console. Tell him what changed since his last visit, from these commits (newest first). "
              "Group them under 2–5 short headings, one bullet per real change in plain English, most important first, "
              "and skip housekeeping. Keep it phone-readable: under 180 words. A touch of your voice is fine.\n\n" + lst)
    out = llm.complete([{"role": "user", "content": prompt}], system=agent.get("system_prompt"), params={"temperature": 0.3, "max_tokens": 1200})
    data = {"text": (out.get("text") or "").strip()[:6000], "agent": agent.get("name") or MOSSES, "model": out.get("model"),
            "at": int(time.time() * 1000), "range": [cs[-1]["sha"], cs[0]["sha"]], "count": len(cs)}
    store.save_summary(key, data)
    return {**data, "cached": False}
