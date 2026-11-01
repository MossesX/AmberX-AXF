"""Ingesters: everything that turns a source into session@1 sessions in the store.

    claude.ai data export   parse_export(path)           the zip (or conversations.json) Brett downloads from
                                                         claude.ai → Settings → Privacy → Export data
    Claude Code sessions    sync_claude_code(store, dirs) ~/.claude/projects/<project>/<session>.jsonl, incremental
                                                         (byte offset + size + mtime per file)
    headless build logs     sync_build_logs(store, globs) /root/axf-builds/*/*.log, /home/axfbuild/wt-*/*.log
    hub drop folder         sync_hub_drop(store, folder)  <hub>/_data/sessions/claude-ai/<uuid>.json, written by claude.ai
                                                         sessions through axhub.memory_write ("sync my chats")

No ingester ever logs in anywhere or reads a browser's cookies: claude.ai has no API for a user's chats, so its chats
come only from the export Brett uploads or from the drop folder. Redaction happens in the store, for every source.
"""
from __future__ import annotations

import glob
import hashlib
import io
import json
import os
import re
import zipfile
from pathlib import Path
from typing import Any, Callable, Iterable

from . import schema as S

MAX_TOOL_TEXT = 4000
MAX_EXPORT_MEMBER = 2 * 1024 * 1024 * 1024  # 2 GB uncompressed conversations.json at most
_TAGS = re.compile(r"<(system-reminder|local-command-stdout|local-command-stderr|command-message|command-args|user-prompt-submit-hook|persisted-output)>[\s\S]*?</\1>")
_CMD = re.compile(r"<command-name>([^<]*)</command-name>")
_ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


def _clip(t: str, n: int) -> str:
    return t if len(t) <= n else t[:n] + f"… [{len(t) - n} more characters]"


def _title_from(text: str) -> str:
    for line in (text or "").splitlines():
        line = line.strip().lstrip("#").strip()
        if line:
            return line[:140]
    return ""


def _report() -> dict[str, Any]:
    return {"new": 0, "continued": 0, "changed": 0, "unchanged": 0, "errors": [], "sessions": []}


def _count(rep: dict[str, Any], change: str, sid: str, title: str) -> None:
    rep[change] = rep.get(change, 0) + 1
    if change != "unchanged" and len(rep["sessions"]) < 200:
        rep["sessions"].append({"id": sid, "title": title, "change": change})


# ---------------------------------------------------------------------------------------------- claude.ai data export

def _is_voice(conv: dict[str, Any]) -> bool:
    """claude.ai's export has no documented voice flag; voice-mode chats are recognised by any field naming voice
    (input_mode / mode / source / a voice_note or audio block). Hub-drop documents say it outright (source)."""
    def has_voice(d: Any, depth: int = 0) -> bool:
        if depth > 3:
            return False
        if isinstance(d, dict):
            for k, v in d.items():
                if k in ("input_mode", "mode", "source", "conversation_mode", "type") and isinstance(v, str) and ("voice" in v.lower() or v.lower() == "audio"):
                    return True
                if isinstance(v, (dict, list)) and k not in ("text",) and has_voice(v, depth + 1):
                    return True
        elif isinstance(d, list):
            return any(has_voice(x, depth + 1) for x in d[:200])
        return False
    if has_voice({k: v for k, v in conv.items() if k != "chat_messages"}):
        return True
    return any(has_voice({k: v for k, v in (m or {}).items() if k != "text"}) for m in (conv.get("chat_messages") or [])[:400])


def _block_text(c: Any) -> str:
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "\n".join(_block_text(x) for x in c if x)
    if isinstance(c, dict):
        if isinstance(c.get("text"), str):
            return c["text"]
        if "content" in c:
            return _block_text(c["content"])
    return ""


def conversation_to_session(conv: dict[str, Any], projects: dict[str, str] | None = None, *, via: str = "export") -> dict[str, Any] | None:
    uuid = str(conv.get("uuid") or conv.get("id") or "").strip()
    if not uuid:
        return None
    voice = _is_voice(conv)
    kind = "speech" if voice else "text"
    msgs: list[dict[str, Any]] = []
    for m in conv.get("chat_messages") or conv.get("messages") or []:
        if not isinstance(m, dict):
            continue
        sender = m.get("sender") or m.get("role")
        role = "user" if sender in ("human", "user") else "assistant" if sender == "assistant" else None
        if not role:
            continue
        at = S.iso(m.get("created_at") or m.get("at") or m.get("updated_at"))
        blocks = m.get("content")
        if isinstance(blocks, list) and blocks:
            for b in blocks:
                if not isinstance(b, dict):
                    continue
                t = b.get("type")
                if t == "text" and (b.get("text") or "").strip():
                    msgs.append({"role": role, "text": b["text"], "at": at, "kind": kind})
                elif t == "tool_use":
                    msgs.append({"role": "tool", "text": _clip(json.dumps(b.get("input") or {}, ensure_ascii=False), MAX_TOOL_TEXT), "at": at, "kind": "tool", "toolName": str(b.get("name") or "tool")})
                elif t == "tool_result":
                    msgs.append({"role": "tool", "text": _clip(_block_text(b.get("content")), MAX_TOOL_TEXT), "at": at, "kind": "tool", "toolName": str(b.get("name") or "result")})
        elif (m.get("text") or "").strip():
            msgs.append({"role": role, "text": m["text"], "at": at, "kind": kind})
        for a in m.get("attachments") or []:
            if isinstance(a, dict) and (a.get("extracted_content") or "").strip():
                msgs.append({"role": "tool", "text": _clip(f"{a.get('file_name') or 'attachment'}:\n{a['extracted_content']}", MAX_TOOL_TEXT), "at": at, "kind": "tool", "toolName": "attachment"})
    started = S.iso(conv.get("created_at")) or next((m["at"] for m in msgs if m["at"]), "") or S.now_iso()
    updated = S.iso(conv.get("updated_at")) or next((m["at"] for m in reversed(msgs) if m["at"]), "") or started
    title = (conv.get("name") or conv.get("title") or "").strip() or _title_from(next((m["text"] for m in msgs if m["role"] == "user"), "")) or "Untitled chat"
    p = conv.get("project")
    proj = conv.get("project_uuid") or (p.get("uuid") if isinstance(p, dict) else None)
    project = (projects or {}).get(str(proj), "") if proj else ""
    if not project:
        project = p if isinstance(p, str) else str(p.get("name") or "") if isinstance(p, dict) else ""
    return {"$axf": S.TAG, "id": f"cai:{re.sub(r'[^A-Za-z0-9._:-]', '-', uuid)[:160]}", "source": "claude-ai-voice" if voice else "claude-ai-text", "title": title,
            "startedAt": started, "updatedAt": updated, "project": project or "", "messages": msgs, "via": via, "origin": uuid}


def parse_export(path: Path) -> tuple[list[dict[str, Any]], list[str]]:
    """The claude.ai data export (zip, or a bare conversations.json) → (sessions, problems)."""
    path = Path(path)
    problems: list[str] = []
    convs: Any = None
    projects: dict[str, str] = {}
    with open(path, "rb") as f:
        head = f.read(4)
    if head[:2] == b"PK":
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            conv_name = next((n for n in names if n.rsplit("/", 1)[-1] == "conversations.json"), None)
            if not conv_name:
                return [], ["the zip has no conversations.json — is it the claude.ai data export?"]
            info = z.getinfo(conv_name)
            if info.file_size > MAX_EXPORT_MEMBER:
                return [], ["conversations.json is larger than 2 GB"]
            with z.open(conv_name) as fh:
                convs = json.load(io.TextIOWrapper(fh, encoding="utf-8"))
            proj_name = next((n for n in names if n.rsplit("/", 1)[-1] == "projects.json"), None)
            if proj_name and z.getinfo(proj_name).file_size < 256 * 1024 * 1024:
                try:
                    with z.open(proj_name) as fh:
                        projects = {str(p.get("uuid")): str(p.get("name") or "") for p in json.load(io.TextIOWrapper(fh, encoding="utf-8")) if isinstance(p, dict)}
                except (ValueError, TypeError):
                    problems.append("projects.json could not be read (project names left empty)")
    else:
        with open(path, encoding="utf-8") as fh:
            convs = json.load(fh)
    if isinstance(convs, dict):
        convs = convs.get("conversations") or [convs]
    if not isinstance(convs, list):
        return [], ["conversations.json is not a list of conversations"]
    out = []
    for i, c in enumerate(convs):
        s = conversation_to_session(c, projects) if isinstance(c, dict) else None
        if not s:
            problems.append(f"conversation #{i + 1} has no uuid (skipped)")
            continue
        out.append(s)
    return out, problems


def import_export(store: Any, path: Path) -> dict[str, Any]:
    rep = _report()
    sessions, problems = parse_export(path)
    rep["errors"].extend(problems)
    for s in sessions:
        v = S.validate_session({**s, "hash": "0" * 64})
        if not v["ok"]:
            rep["errors"].append(f"{s['title']}: {S.rejection(v['errors'])[:300]}")
            continue
        _count(rep, store.upsert(s), s["id"], s["title"])
    rep["total"] = len(sessions)
    return rep


# ---------------------------------------------------------------------------------------------- Claude Code JSONL

def _clean_user(text: str) -> str:
    cmd = _CMD.search(text)
    t = _TAGS.sub("", text)
    t = re.sub(r"</?command-[a-z]+>", "", t).strip()
    if cmd and not t.replace(cmd.group(1), "").strip():
        return cmd.group(1).strip()
    return t


def _tool_summary(name: str, inp: Any) -> str:
    if not isinstance(inp, dict):
        return _clip(str(inp), 1500)
    for k in ("command", "file_path", "pattern", "url", "query", "prompt", "description"):
        if isinstance(inp.get(k), str) and inp[k].strip():
            extra = f" ({inp['description']})" if k == "command" and isinstance(inp.get("description"), str) else ""
            return _clip(inp[k] + extra, 1500)
    return _clip(json.dumps(inp, ensure_ascii=False), 1500)


def parse_jsonl_records(lines: Iterable[str], tools: dict[str, str]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Claude Code JSONL lines → (messages, facts). `tools` maps tool_use ids to names across increments."""
    msgs: list[dict[str, Any]] = []
    facts: dict[str, Any] = {}
    for line in lines:
        line = line.strip()
        if not line or ('"type":"user"' not in line and '"type":"assistant"' not in line and '"type": "user"' not in line and '"type": "assistant"' not in line and '"cwd"' not in line):
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if not isinstance(d, dict):
            continue
        for k in ("cwd", "gitBranch", "sessionId", "version"):
            if isinstance(d.get(k), str) and d[k]:
                facts[k] = d[k]
        t = d.get("type")
        if t not in ("user", "assistant") or d.get("isSidechain") or d.get("isMeta"):
            continue
        at = S.iso(d.get("timestamp"))
        if at:
            facts.setdefault("first", at)
            facts["last"] = at
        m = d.get("message") or {}
        if t == "assistant" and isinstance(m.get("model"), str) and not m["model"].startswith("<"):
            facts["model"] = m["model"]
        content = m.get("content")
        if isinstance(content, str):
            content = [{"type": "text", "text": content}]
        if not isinstance(content, list):
            continue
        for b in content:
            if not isinstance(b, dict):
                continue
            bt = b.get("type")
            if bt == "text":
                text = b.get("text") or ""
                text = _clean_user(text) if t == "user" else text.strip()
                if text:
                    msgs.append({"role": t, "text": text, "at": at, "kind": "text"})
            elif bt == "tool_use":
                name = str(b.get("name") or "tool")
                if b.get("id"):
                    tools[str(b["id"])] = name
                msgs.append({"role": "tool", "text": _tool_summary(name, b.get("input")), "at": at, "kind": "tool", "toolName": name})
            elif bt == "tool_result":
                name = tools.get(str(b.get("tool_use_id") or ""), "result")
                text = _block_text(b.get("content")).strip()
                if text:
                    msgs.append({"role": "tool", "text": _clip(text, MAX_TOOL_TEXT), "at": at, "kind": "tool", "toolName": name})
            elif bt == "image":
                msgs.append({"role": "tool", "text": "[image]", "at": at, "kind": "tool", "toolName": "image"})
    return msgs, facts


def _project_of(cwd: str, folder: str) -> str:
    if cwd:
        return Path(cwd).name or cwd
    return folder.strip("-").rsplit("-", 1)[-1] or folder


def sync_claude_code(store: Any, dirs: list[dict[str, str]], *, max_files: int = 5000) -> dict[str, Any]:
    """Every <dir>/<project>/*.jsonl, read from where the last sync stopped. A file that shrank is read again whole."""
    rep = _report()
    files: list[tuple[Path, str]] = []
    for d in dirs:
        root = Path(d["path"])
        if root.is_dir():
            files.extend((p, d.get("label") or root.parent.parent.name) for p in sorted(root.glob("*/*.jsonl")))
    for path, label in files[:max_files]:
        try:
            _sync_one_jsonl(store, path, label, rep)
        except (OSError, ValueError) as e:  # one bad file never stops the sync
            rep["errors"].append(f"{path}: {e}")
    rep["files"] = len(files)
    return rep


def _sync_one_jsonl(store: Any, path: Path, label: str, rep: dict[str, Any]) -> None:
    st = path.stat()
    key = str(path)
    cur = store.cursor(key)
    sid = f"cc:{re.sub(r'[^A-Za-z0-9._:-]', '-', path.stem)[:150]}"
    exists = store.row(sid) is not None
    if cur and exists and cur["size"] == st.st_size and abs(cur["mtime"] - st.st_mtime) < 1e-6:
        rep["unchanged"] += 1
        return
    restart = not cur or not exists or st.st_size < cur["offset"]
    offset = 0 if restart else cur["offset"]
    extra = {} if restart else dict(cur.get("extra") or {})
    tools: dict[str, str] = extra.get("tools") or {}
    with open(path, "rb") as f:
        f.seek(offset)
        data = f.read()
    end = data.rfind(b"\n")
    if end < 0:
        store.set_cursor(key, st.st_size, st.st_mtime, offset, sid, extra)
        rep["unchanged"] += 1
        return
    chunk = data[: end + 1].decode("utf-8", "replace")
    msgs, facts = parse_jsonl_records(chunk.splitlines(), tools)
    facts = {**(extra.get("facts") or {}), **{k: v for k, v in facts.items() if k != "first"}, "first": (extra.get("facts") or {}).get("first") or facts.get("first", "")}
    first_user = next((m["text"] for m in msgs if m["role"] == "user"), "")
    title = extra.get("title") or _title_from(first_user)
    if not msgs and restart:
        store.set_cursor(key, st.st_size, st.st_mtime, offset + end + 1, sid, {**extra, "facts": facts, "tools": dict(list(tools.items())[-300:])})
        rep["unchanged"] += 1  # a file with no conversation yet (queue operations only)
        return
    proj_folder = path.parent.name
    s = {"$axf": S.TAG, "id": sid, "source": "claude-code", "title": title or f"Claude Code · {_project_of(facts.get('cwd', ''), proj_folder)}",
         "startedAt": facts.get("first") or S.iso(st.st_mtime), "updatedAt": facts.get("last") or S.iso(st.st_mtime),
         "project": _project_of(facts.get("cwd", ""), proj_folder), "messages": msgs, "via": "claude-code", "origin": key,
         "model": facts.get("model", ""), "branch": facts.get("gitBranch", ""), "cwd": facts.get("cwd", ""), "host": label}
    change = store.upsert(s, append=not restart)
    if restart and exists and change == "changed":
        pass  # a rewritten file: the old copy is kept as a version
    store.set_cursor(key, st.st_size, st.st_mtime, offset + end + 1, sid, {"facts": facts, "title": title, "tools": dict(list(tools.items())[-300:])})
    _count(rep, change, sid, s["title"])


# ---------------------------------------------------------------------------------------------- headless build logs

def parse_build_log(text: str, brief: str = "") -> tuple[list[dict[str, Any]], dict[str, str]]:
    """deploy/claude-headless.sh's coloured transcript → messages. `# model …` header, `▸ Tool: …` calls, `↳ …`
    results, everything else is what Claude said (consecutive lines joined)."""
    msgs: list[dict[str, Any]] = []
    facts: dict[str, str] = {}
    if brief.strip():
        msgs.append({"role": "user", "text": brief.strip(), "at": "", "kind": "text"})
    said: list[str] = []
    last_tool = "tool"

    def flush() -> None:
        if said and "\n".join(said).strip():
            msgs.append({"role": "assistant", "text": "\n".join(said).strip(), "at": "", "kind": "text"})
        said.clear()

    for raw in text.splitlines():
        line = _ANSI.sub("", raw).rstrip()
        if not line.strip():
            if said:
                said.append("")
            continue
        if line.startswith("# model "):
            parts = [p.strip() for p in line[2:].split("·")]
            facts["model"] = parts[0].replace("model", "", 1).strip()
            if len(parts) > 1:
                facts["cwd"] = parts[1]
            continue
        s = line.lstrip()
        if s.startswith("▸ "):
            flush()
            name, _, rest = s[2:].partition(":")
            last_tool = name.strip() or "tool"
            msgs.append({"role": "tool", "text": rest.strip(), "at": "", "kind": "tool", "toolName": last_tool[:80]})
        elif s.startswith("↳"):
            flush()
            r = s[1:].strip()
            if msgs and msgs[-1]["role"] == "tool" and msgs[-1].get("toolName") == last_tool and msgs[-1].get("_result"):
                msgs[-1]["text"] = _clip(msgs[-1]["text"] + "\n" + r, MAX_TOOL_TEXT)
            else:
                msgs.append({"role": "tool", "text": r, "at": "", "kind": "tool", "toolName": last_tool[:80], "_result": True})
        else:
            said.append(line)
    flush()
    for m in msgs:
        m.pop("_result", None)
    return msgs, facts


def sync_build_logs(store: Any, globs: list[str], *, max_files: int = 2000) -> dict[str, Any]:
    rep = _report()
    files = sorted({p for g in globs for p in glob.glob(g)})[:max_files]
    for p in files:
        path = Path(p)
        try:
            st = path.stat()
            brief_p = path.parent / ".brief.md"
            bst = brief_p.stat() if brief_p.is_file() else None
            sig = st.st_mtime + (bst.st_mtime if bst else 0)
            cur = store.cursor(p)
            sid = "build:" + hashlib.sha1(str(path.resolve()).encode()).hexdigest()[:16]
            if cur and cur["size"] == st.st_size and abs(cur["mtime"] - sig) < 1e-6 and store.row(sid):
                rep["unchanged"] += 1
                continue
            brief = brief_p.read_text(errors="replace")[:20000] if bst else ""
            msgs, facts = parse_build_log(path.read_text(errors="replace"), brief)
            if not msgs:
                store.set_cursor(p, st.st_size, sig, st.st_size, sid)
                rep["unchanged"] += 1
                continue
            title = f"{path.parent.name} · {path.stem}"
            bt = _title_from(brief)
            if bt:
                title = f"{bt[:110]} ({path.parent.name}/{path.name})"
            started = S.iso(bst.st_mtime if bst else st.st_ctime)
            s = {"$axf": S.TAG, "id": sid, "source": "headless", "title": title, "startedAt": min(started, S.iso(st.st_mtime)), "updatedAt": S.iso(st.st_mtime),
                 "project": "amberx-axf", "messages": msgs, "via": "build-log", "origin": p, "model": facts.get("model", ""), "cwd": facts.get("cwd", str(path.parent))}
            change = store.upsert(s)
            store.set_cursor(p, st.st_size, sig, st.st_size, sid)
            _count(rep, change, sid, title)
        except (OSError, ValueError) as e:
            rep["errors"].append(f"{p}: {e}")
    rep["files"] = len(files)
    return rep


# ---------------------------------------------------------------------------------------------- hub drop folder

def drop_to_session(doc: Any, name: str) -> tuple[dict[str, Any] | None, str]:
    """A hub-drop document → (session, problem). Accepts session@1 itself, or the claude.ai export's conversation
    shape ({uuid, name, chat_messages}) so a chat can paste either. See README → Hub drop folder."""
    if not isinstance(doc, dict):
        return None, "not a JSON object"
    if doc.get("$axf") == S.TAG:
        uuid = str(doc.get("uuid") or doc.get("origin") or doc.get("id", "").split(":", 1)[-1] or Path(name).stem)
        src = doc.get("source") if doc.get("source") in ("claude-ai-text", "claude-ai-voice") else "hub-drop"
        msgs = []
        for i, m in enumerate(doc.get("messages") or []):
            if not isinstance(m, dict):
                return None, f"messages[{i}] is not an object"
            role = m.get("role")
            kind = m.get("kind") or ("tool" if role == "tool" else "speech" if src == "claude-ai-voice" else "text")
            mm = {"role": role, "text": m.get("text") if isinstance(m.get("text"), str) else "", "at": S.iso(m.get("at")) if m.get("at") else "", "kind": kind}
            if m.get("toolName"):
                mm["toolName"] = str(m["toolName"])
            msgs.append(mm)
        s = {"$axf": S.TAG, "id": doc.get("id") if isinstance(doc.get("id"), str) and S.ID_RE.match(doc["id"]) else f"cai:{re.sub(r'[^A-Za-z0-9._:-]', '-', uuid)[:160]}",
             "source": src, "title": str(doc.get("title") or "").strip() or _title_from(next((m["text"] for m in msgs if m["role"] == "user"), "")) or "Untitled chat",
             "startedAt": S.iso(doc.get("startedAt")) or next((m["at"] for m in msgs if m["at"]), "") or S.now_iso(),
             "updatedAt": S.iso(doc.get("updatedAt")) or next((m["at"] for m in reversed(msgs) if m["at"]), "") or S.now_iso(),
             "project": str(doc.get("project") or ""), "messages": msgs, "via": "hub-drop", "origin": uuid}
    elif doc.get("chat_messages") is not None or doc.get("uuid"):
        s = conversation_to_session(doc, via="hub-drop")
        if not s:
            return None, "no uuid"
    else:
        return None, 'neither session@1 ("$axf": "session@1") nor a claude.ai conversation ({uuid, chat_messages})'
    v = S.validate_session({**s, "hash": "0" * 64})
    if not v["ok"]:
        return None, S.rejection(v["errors"])[:400]
    return s, ""


def sync_hub_drop(store: Any, folder: Path | None) -> dict[str, Any]:
    rep = _report()
    if not folder or not Path(folder).is_dir():
        rep["files"] = 0
        return rep
    files = sorted(Path(folder).glob("*.json"))
    for path in files:
        try:
            st = path.stat()
            cur = store.cursor(str(path))
            if cur and cur["size"] == st.st_size and abs(cur["mtime"] - st.st_mtime) < 1e-6 and cur["sessionId"] and store.row(cur["sessionId"]):
                rep["unchanged"] += 1
                continue
            s, problem = drop_to_session(json.loads(path.read_text()), path.name)
            if not s:
                rep["errors"].append(f"{path.name}: {problem}")
                store.set_cursor(str(path), st.st_size, st.st_mtime, 0, "")
                continue
            change = store.upsert(s)
            store.set_cursor(str(path), st.st_size, st.st_mtime, st.st_size, s["id"])
            _count(rep, change, s["id"], s["title"])
        except (OSError, ValueError) as e:
            rep["errors"].append(f"{path.name}: {e}")
    rep["files"] = len(files)
    return rep


# ---------------------------------------------------------------------------------------------- everything

def sync_all(store: Any, cfg: dict[str, Any], hub_drop: Path | None, progress: Callable[[str], None] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"at": S.now_iso(), "new": 0, "continued": 0, "changed": 0, "unchanged": 0, "errors": [], "bySource": {}, "sessions": []}
    steps = [("claude-code", lambda: sync_claude_code(store, cfg.get("claudeDirs") or [])),
             ("headless", lambda: sync_build_logs(store, cfg.get("logGlobs") or [])),
             ("hub-drop", lambda: sync_hub_drop(store, hub_drop))]
    for name, fn in steps:
        if progress:
            progress(name)
        r = fn()
        out["bySource"][name] = {k: r.get(k, 0) for k in ("new", "continued", "changed", "unchanged", "files")}
        for k in ("new", "continued", "changed", "unchanged"):
            out[k] += r.get(k, 0)
        out["errors"].extend(r["errors"][:50])
        out["sessions"].extend(r["sessions"][:100])
    return out


def existing_dirs(dirs: list[dict[str, str]]) -> list[dict[str, Any]]:
    return [{**d, "exists": os.path.isdir(d["path"])} for d in dirs]
