"""Automatic transcripts of the recorder's parts (build ui-review-notify-session-audio).

Brett: "automatically audio built in transcriptions automatic every session." Each uploaded chunk on the hub
(`/projects/<project>/_data/output-recorder/recordings/<id>.json` + parts) is put back together, checked against its
SHA-256, transcribed by a local model in its own low-priority process (whisper_job.py, one at a time) and saved beside
it as `transcripts/<id>.json` (audio-transcript@1), where AmberX and the console read it through the hub like the
recordings. The doc keeps the recording's session name and group: a session's group is its Claude session id, which
links the two. No key, no tokens, nothing leaves the VPS.

Nothing is retried for ever (MAX_TRIES), a deleted recording is skipped and the worker waits when the VPS is short of memory.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from importlib.util import find_spec
from pathlib import Path
from typing import Any, Callable

DEFAULT_PROJECT = "amberx-recordings"
FORMAT = "audio-transcript@1"
PART_FORMAT = "audio-part@1"
MODEL = "base.en"
THREADS = 2
MAX_TRIES = 3
DOC_MAX = 60_000  # the data server's documents stop at 64 KB
MEM_FLOOR_MB = 2048
ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
JOB = Path(__file__).resolve().parent / "whisper_job.py"


class Skip(Exception):
    """This chunk can't be done now (parts still uploading); not a failure."""


def folder(root: Path, project: str = DEFAULT_PROJECT) -> Path:
    return root / project / "_data" / "output-recorder"


def available() -> bool:
    return find_spec("faster_whisper") is not None


def memory_free_mb() -> int:
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) // 1024
    except (OSError, ValueError, IndexError):
        pass
    return 1 << 20


def read_json(p: Path) -> dict[str, Any] | None:
    try:
        d = json.loads(p.read_text())
        return d if isinstance(d, dict) else None
    except (OSError, ValueError):
        return None


def pending(base: Path, failed: dict[str, Any]) -> list[dict[str, Any]]:
    """Recordings still to transcribe, newest first (the session Brett just had comes before an old backlog)."""
    out = []
    try:
        names = sorted(p for p in (base / "recordings").iterdir() if p.suffix == ".json")
    except OSError:
        return []
    for p in names:
        rid = p.stem
        if not ID.match(rid) or (base / "transcripts" / f"{rid}.json").exists() or int((failed.get(rid) or {}).get("tries", 0)) >= MAX_TRIES:
            continue
        r = read_json(p)
        if r and not r.get("deleted"):
            out.append({**r, "id": rid})
    return sorted(out, key=lambda r: str(r.get("startedAt") or ""), reverse=True)


def assemble(base: Path, rec: dict[str, Any], to: Path) -> None:
    """The parts back into one file, checked like a download is."""
    rid, parts = rec["id"], int(rec.get("parts") or 0)
    if parts < 1:
        raise Skip("no parts yet")
    h = hashlib.sha256()
    with to.open("wb") as f:
        for n in range(parts):
            doc = read_json(base / "parts" / rid / f"{n:04d}.json")
            if doc is None:
                raise Skip(f"part {n + 1} of {parts} isn't there yet")
            if doc.get("gone"):
                raise ValueError("the recording was deleted")
            try:
                raw = base64.b64decode(str(doc.get("b64") or ""), validate=False)
            except binascii.Error as e:
                raise ValueError(f"part {n + 1} is damaged") from e
            h.update(raw)
            f.write(raw)
    want = str(rec.get("sha256") or "")
    if want and h.hexdigest() != want:
        raise ValueError("the parts don't match the recording's checksum")


def run_job(audio: Path, models: Path, model: str = MODEL, timeout: float = 3600) -> dict[str, Any]:
    """The transcription process → {language, text, segments}."""
    p = subprocess.run([sys.executable, str(JOB), str(audio), "--model", model, "--threads", str(THREADS), "--models-dir", str(models)],
                       capture_output=True, text=True, timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or "the transcription failed").strip()[-300:])
    return json.loads(p.stdout.strip().splitlines()[-1])


def document(rec: dict[str, Any], out: dict[str, Any], model: str, now: str) -> dict[str, Any]:
    """audio-transcript@1, under the data server's size: the timed lines go first if a long chunk doesn't fit."""
    text = str(out.get("text") or "")
    doc = {"$axf": FORMAT, "id": rec["id"], "name": str(rec.get("name") or rec["id"])[:200], "session": str(rec.get("session") or "")[:80], "group": str(rec.get("group") or "")[:80],
           "startedAt": str(rec.get("startedAt") or ""), "durationMs": int(rec.get("durationMs") or 0), "mic": bool(rec.get("mic")), "model": model, "language": str(out.get("language") or ""),
           "transcribedAt": now, "silent": not text.strip(), "text": text, "segments": out.get("segments") or []}
    if len(json.dumps(doc, ensure_ascii=False).encode()) > DOC_MAX:
        doc["segments"] = []
    size = len(json.dumps(doc, ensure_ascii=False).encode())
    if size > DOC_MAX:
        doc["text"] = text.encode()[:len(text.encode()) - (size - DOC_MAX) - 64].decode(errors="ignore")
        doc["truncated"] = True
    return doc


def write_doc(p: Path, doc: dict[str, Any]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False))
    os.replace(tmp, p)


def run_once(base: Path, state: dict[str, Any], models: Path, job: Callable[[Path, Path], dict[str, Any]] = run_job,
             free_mb: Callable[[], int] = memory_free_mb, now: Callable[[], str] = lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())) -> str:
    """One chunk at most. → "done" | "idle" | "waiting" (not now) | "failed". `state` keeps {failed: {id: {tries, error}}, last}."""
    failed = state.setdefault("failed", {})
    todo = pending(base, failed)
    state["waiting"] = len(todo)
    if not todo:
        return "idle"
    if free_mb() < MEM_FLOOR_MB:
        state["note"] = "waiting for memory"
        return "waiting"
    state["note"] = ""
    for rec in todo:
        with tempfile.TemporaryDirectory(prefix="axf-transcribe-") as d:
            audio = Path(d) / "chunk.m4a"
            try:
                assemble(base, rec, audio)
                out = job(audio, models)
            except Skip:
                continue
            except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as e:
                f = failed.setdefault(rec["id"], {"tries": 0})
                f.update(tries=int(f["tries"]) + 1, error=str(e)[:300], at=now(), name=str(rec.get("name") or ""))
                return "failed"
        write_doc(base / "transcripts" / f"{rec['id']}.json", document(rec, out, MODEL, now()))
        failed.pop(rec["id"], None)
        state["last"] = {"id": rec["id"], "name": str(rec.get("name") or ""), "at": now()}
        state["waiting"] = len(todo) - 1
        return "done"
    return "waiting"
