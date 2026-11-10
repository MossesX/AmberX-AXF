"""Where the conversations come from. Each reader is incremental (a cursor per file or document) and bounded per round.

    claude-code   ~/.claude/projects/<project>/<session>.jsonl: Brett's interactive Claude Code chats (user = Brett).
                  Headless build runs (the brief is the first user turn) are skipped unless `includeHeadless` is on;
                  their "Brett said (verbatim)" quote still feeds the ledger when they are read.
    claude-ai     claude.ai data exports (conversations.json) dropped in <dataDir>/imports/ or sent to POST import.
    recording     session recordings transcribed on the VPS (audio-transcript@1), through the capability service
                  axf.session-transcripts@1 (whoever provides it); none = this source is simply empty.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Callable, Iterable

from . import rag as R

REMINDER = re.compile(r"<system-reminder>.*?</system-reminder>|<(?:command-[a-z-]+|local-command-[a-z-]+)>.*?</(?:command-[a-z-]+|local-command-[a-z-]+)>", re.S)
HEADLESS = re.compile(r"^(?:# Build:|You are a headless|You run headless)|## Rules for this job|You run headless", re.M)
SAID = re.compile(r"\bBrett(?: \([^)\n]{1,40}\))?(?: said| says| asked| wrote)?\s*:\s*[\"“]([^\"”\n]{8,400})[\"”]")
QUOTE = re.compile(r"## Brett said \(verbatim\)\s*\n(?:At: (\S+)\s*\n)?((?:>.*\n?)+)")
MAX_BYTES_PER_ROUND = 40 * 1024 * 1024


def _text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(str(p.get("text") or "") for p in content if isinstance(p, dict) and p.get("type") == "text")
    return ""


def _is_tool_result(content: Any) -> bool:
    return isinstance(content, list) and any(isinstance(p, dict) and p.get("type") == "tool_result" for p in content)


def parse_claude_code(lines: Iterable[str]) -> list[dict[str, Any]]:
    """Claude Code JSONL lines → turns {role: brett|claude, text, at}. Tool calls, tool results, thinking and meta lines are dropped."""
    out = []
    for line in lines:
        try:
            r = json.loads(line)
        except (ValueError, TypeError):
            continue
        if not isinstance(r, dict) or r.get("isMeta") or r.get("isSidechain") or r.get("type") not in ("user", "assistant"):
            continue
        msg = r.get("message") or {}
        content = msg.get("content")
        if r["type"] == "user" and _is_tool_result(content):
            continue
        text = REMINDER.sub("", _text_of(content)).strip()
        if not text or text.startswith("Caveat: The messages below"):
            continue
        out.append({"role": "brett" if r["type"] == "user" else "claude", "text": text, "at": str(r.get("timestamp") or "")})
    return out


def brett_quotes(text: str) -> list[dict[str, Any]]:
    """The verbatim quote block of a headless brief → Brett turns (his words only)."""
    out = []
    for m in QUOTE.finditer(text or ""):
        words = "\n".join(l.lstrip("> ").rstrip() for l in m.group(2).splitlines())
        out.append({"role": "brett", "text": words.strip(), "at": m.group(1) or ""})
    seen = {q["text"] for q in out}
    for m in SAID.finditer(text or ""):
        if m.group(1) not in seen and not any(m.group(1) in q for q in seen):
            seen.add(m.group(1)); out.append({"role": "brett", "text": m.group(1).strip(), "at": ""})
    return out


def is_prompt(text: str) -> bool:
    """A user turn written by an agent or pasted (a brief, a long structured prompt), not Brett talking."""
    t = text or ""
    return len(t) > 1500 or len(re.findall(r"^\s*(?:#{1,4} |[-*] |\d+\. )", t, re.M)) >= 3 or bool(HEADLESS.search(t[:4000]))


def speakers(turns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Brett's turns that are really prompts become role 'prompt' (searchable, not the ledger); his quoted words in them
    are added as Brett turns, so the ledger only learns from what he said."""
    out = []
    for t in turns:
        if t["role"] == "brett" and is_prompt(t["text"]):
            out.append({**t, "role": "prompt"})
            out.extend({**q, "at": q["at"] or t["at"]} for q in brett_quotes(t["text"]))
        else:
            out.append(t)
    return out


def sync_claude_code(idx: R.Index, dirs: list[Path], known: list[str], include_headless: bool = False, budget: int = MAX_BYTES_PER_ROUND) -> dict[str, int]:
    rep = {"files": 0, "chunks": 0, "skipped": 0, "more": False}
    files: list[Path] = []
    for d in dirs:
        if d.is_dir():
            files.extend(d.glob("*/*.jsonl"))
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)  # newest first: today's talk is searchable on the first round
    for p in files:
        if budget <= 0:
            rep["more"] = True
            break
        try:
            st = p.stat()
        except OSError:
            continue
        key = f"cc:{p}"
        cur = idx.cursor(key)
        if cur and cur["size"] == st.st_size and cur["mtime"] == st.st_mtime:
            continue
        pos = int(cur["pos"]) if cur and st.st_size >= cur["size"] else 0
        extra = dict(cur["extra"]) if cur and pos else {}
        sid = f"claude-code:{p.stem}"
        if pos == 0 and cur:
            idx.drop_session(sid)
        if not include_headless and (extra.get("headless") or pos == 0):
            if extra.get("headless"):  # known build run: nothing more to read
                idx.set_cursor(key, st.st_size, st.st_mtime, st.st_size, extra)
                rep["skipped"] += 1
                continue
            with p.open("rb") as f:
                head = f.read(256 * 1024)
            hl = head[: head.rfind(b"\n") + 1].decode("utf-8", "ignore").splitlines()
            ht = parse_claude_code(hl)
            first = next((t for t in ht if t["role"] == "brett"), None)
            if (first and HEADLESS.search(first["text"][:4000])) or (not first and any('"queue-operation"' in l and HEADLESS.search(l[:6000]) for l in hl[:20])):
                extra["headless"] = True
                quotes = brett_quotes(first["text"]) if first else []
                if quotes:
                    title = (re.search(r"^# Build: (.+)$", first["text"], re.M) or [None, p.stem])[1]
                    rep["chunks"] += idx.add({"id": sid, "source": "claude-code", "title": f"Brief: {title}", "at": quotes[0]["at"] or first["at"], "meta": {"headless": True, "file": p.name}}, quotes, known)
                idx.set_cursor(key, st.st_size, st.st_mtime, st.st_size, extra)
                rep["skipped"] += 1
                budget -= len(head)
                continue
        with p.open("rb") as f:
            f.seek(pos)
            raw = f.read(min(st.st_size - pos, budget + 1024 * 1024))
        end = raw.rfind(b"\n") + 1
        if end <= 0:
            continue
        budget -= end
        lines = raw[:end].decode("utf-8", "ignore").splitlines()
        turns = parse_claude_code(lines)
        if "headless" not in extra and turns:
            first = next((t for t in turns if t["role"] == "brett"), None)
            extra["headless"] = bool(first and HEADLESS.search(first["text"][:4000]))
        elif "headless" not in extra:
            for line in lines[:20]:  # a run's queued brief comes before the first turn
                if '"queue-operation"' in line and HEADLESS.search(line[:6000]):
                    extra["headless"] = True
        if extra.get("headless"):
            first = next((t for t in turns if t["role"] == "brett"), None)
            quotes = brett_quotes(first["text"]) if first and pos == 0 else []
            if not include_headless:
                if quotes:
                    title = (re.search(r"^# Build: (.+)$", first["text"], re.M) or [None, p.stem])[1]
                    rep["chunks"] += idx.add({"id": sid, "source": "claude-code", "title": f"Brief: {title}", "at": quotes[0]["at"], "meta": {"headless": True, "file": p.name}}, quotes, known)
                idx.set_cursor(key, st.st_size, st.st_mtime, pos + end, extra)
                rep["skipped"] += 1
                continue
            if first:
                first["role"] = "prompt"
                turns = quotes + turns
        turns = speakers(turns)
        if turns:
            title = extra.get("title") or next((t["text"][:90].replace("\n", " ") for t in turns if t["role"] in ("brett", "prompt")), p.stem)
            extra["title"] = title
            rep["chunks"] += idx.add({"id": sid, "source": "claude-code", "title": title, "at": turns[0]["at"], "meta": {"project": p.parent.name, "file": p.name, "headless": bool(extra.get("headless"))}}, turns, known)
        idx.set_cursor(key, st.st_size, st.st_mtime, pos + end, extra)
        rep["files"] += 1
    return rep


def parse_claude_ai(doc: Any) -> list[dict[str, Any]]:
    """A claude.ai export (conversations.json: a list, or one conversation) → [{id, title, at, turns}]."""
    convs = doc if isinstance(doc, list) else [doc] if isinstance(doc, dict) else []
    out = []
    for c in convs:
        if not isinstance(c, dict):
            continue
        turns: list[dict[str, Any]] = []
        for m in c.get("chat_messages") or c.get("messages") or []:
            if not isinstance(m, dict):
                continue
            text = str(m.get("text") or "") or _text_of(m.get("content"))
            sender = str(m.get("sender") or m.get("role") or "")
            turns.append({"role": "brett" if sender in ("human", "user") else "claude", "text": text, "at": str(m.get("created_at") or "")})
        turns = speakers(turns)
        cid = str(c.get("uuid") or c.get("id") or R.ledger_id(json.dumps(turns[:2])))
        out.append({"id": f"claude-ai:{cid}", "title": str(c.get("name") or c.get("title") or "claude.ai chat"), "at": str(c.get("created_at") or ""), "turns": turns})
    return out


def import_claude_ai(idx: R.Index, doc: Any, known: list[str]) -> dict[str, int]:
    rep = {"conversations": 0, "chunks": 0}
    for c in parse_claude_ai(doc):
        idx.drop_session(c["id"])
        rep["chunks"] += idx.add({"id": c["id"], "source": "claude-ai", "title": c["title"], "at": c["at"]}, c["turns"], known)
        rep["conversations"] += 1
    return rep


def sync_imports(idx: R.Index, folder: Path, known: list[str]) -> dict[str, int]:
    rep = {"files": 0, "chunks": 0}
    if not folder.is_dir():
        return rep
    for p in sorted(folder.glob("*.json")):
        st = p.stat()
        key = f"import:{p.name}"
        cur = idx.cursor(key)
        if cur and cur["size"] == st.st_size and cur["mtime"] == st.st_mtime:
            continue
        try:
            doc = json.loads(p.read_text())
        except (OSError, ValueError):
            continue
        rep["chunks"] += import_claude_ai(idx, doc, known)["chunks"]
        rep["files"] += 1
        idx.set_cursor(key, st.st_size, st.st_mtime, st.st_size)
    return rep


def transcript_turns(doc: dict[str, Any]) -> list[dict[str, Any]]:
    """audio-transcript@1 → turns, one per segment, with its offset in seconds (a deep link plays from there)."""
    base = str(doc.get("startedAt") or "")
    role = "brett" if doc.get("mic") else "voice"
    segs = doc.get("segments") or []
    if segs:
        return [{"role": role, "text": str(s.get("text") or ""), "at": base, "offset": float(s.get("start") or 0)} for s in segs if isinstance(s, dict)]
    return [{"role": role, "text": str(doc.get("text") or ""), "at": base, "offset": 0.0}]


def sync_transcripts(idx: R.Index, service: Any, known: list[str]) -> dict[str, int]:
    """Through axf.session-transcripts@1: service.docs() → [{key, version, doc, link}] (link = the deep link to the recording)."""
    rep = {"transcripts": 0, "chunks": 0}
    if service is None:
        return rep
    try:
        items = list(service.docs())
    except Exception:  # noqa: BLE001 — the recorder being down leaves this source as it was
        return rep
    for it in items:
        doc = it.get("doc") or {}
        if doc.get("silent"):
            continue
        key = f"rec:{it.get('key') or doc.get('id')}"
        ver = str(it.get("version") or doc.get("transcribedAt") or "")
        cur = idx.cursor(key)
        if cur and cur["extra"].get("version") == ver:
            continue
        sid = f"recording:{doc.get('id')}"
        idx.drop_session(sid)
        meta = {"group": doc.get("group") or "", "claudeSession": doc.get("group") or "", "durationMs": doc.get("durationMs") or 0, "mic": bool(doc.get("mic"))}
        rep["chunks"] += idx.add({"id": sid, "source": "recording", "title": str(doc.get("name") or doc.get("id")), "at": str(doc.get("startedAt") or ""), "link": str(it.get("link") or ""), "meta": meta},
                                 transcript_turns(doc), known)
        idx.set_cursor(key, 0, 0.0, 0, {"version": ver})
        rep["transcripts"] += 1
    return rep


def claude_dirs() -> list[Path]:
    env = os.environ.get("AXF_RAG_CLAUDE_DIRS")
    if env:
        return [Path(p) for p in env.split(":") if p]
    return [Path("/root/.claude/projects"), Path("/home/axfbuild/.claude/projects"), Path.home() / ".claude" / "projects"]


def known_builds(root: Path) -> list[str]:
    try:
        s = json.loads((root / "_claude" / "builds" / "store.json").read_text())
    except (OSError, ValueError):
        return []
    items = s.get("builds") if isinstance(s, dict) else s
    return sorted({str(b.get("id")) for b in items or [] if isinstance(b, dict) and b.get("id")})


Reader = Callable[[], dict[str, int]]
