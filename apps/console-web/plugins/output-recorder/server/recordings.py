"""Recordings on the console (build move-amberx-web-app-into-the-console-amberx-andr, s7; contract section 4.6, C25–C30).

The phone uploads its recordings here instead of to the hub's data server; this writes exactly the files the hub's
data server held (`<projects>/amberx-recordings/_data/output-recorder/`: `parts/<id>/NNNN.json` audio-part@1 and
`recordings/<id>.json` audio-recording@1), so the transcript worker and every older reader see nothing new.

Pure helpers over a folder (`base`), no FastAPI: the routes in __init__.py call them and test_recordings.py drives them.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
import shutil
import time
from pathlib import Path
from typing import Any, Iterator

from .transcripts import ID, PART_FORMAT, read_json

INDEX_FORMAT = "audio-recording@1"
PART_MAX_B64 = 64 * 1024
MAX_PARTS = 20_000
CONFIRM_TTL_S = 300


class Bad(ValueError):
    """A request this can't take (answered 400)."""


def _write(p: Path, doc: dict[str, Any]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(f".{p.name}.{os.getpid()}")
    tmp.write_text(json.dumps(doc))
    os.replace(tmp, p)


def check_id(rid: str) -> str:
    if not isinstance(rid, str) or not ID.match(rid) or rid == "act":
        raise Bad("a recording id is 1–80 letters, digits, _ or -")
    return rid


def put_part(base: Path, rid: str, n: int, body: dict[str, Any]) -> dict[str, Any]:
    """C25: one audio-part@1 ({$axf, id, n, b64}); the same part again is a no-op. → {ok, n, sha256}."""
    check_id(rid)
    if not isinstance(n, int) or not 0 <= n < MAX_PARTS:
        raise Bad(f"n is a part number from 0 to {MAX_PARTS - 1}")
    if body.get("$axf") not in (None, PART_FORMAT) or body.get("id") not in (None, rid) or body.get("n") not in (None, n):
        raise Bad("the part's $axf, id and n must match the address")
    b64 = body.get("b64")
    if not isinstance(b64, str) or not b64 or len(b64) > PART_MAX_B64:
        raise Bad(f"b64 is the part's bytes in base64, at most {PART_MAX_B64} characters")
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError) as e:
        raise Bad("b64 is not base64") from e
    _write(base / "parts" / rid / f"{n:04d}.json", {"$axf": PART_FORMAT, "id": rid, "n": n, "b64": b64})
    return {"ok": True, "n": n, "sha256": hashlib.sha256(raw).hexdigest()}


def joined(base: Path, rid: str, parts: int) -> bytes | None:
    """Every part's bytes in order, or None while one is missing."""
    out = bytearray()
    for n in range(parts):
        doc = read_json(base / "parts" / rid / f"{n:04d}.json")
        if doc is None or doc.get("gone"):
            return None
        try:
            out += base64.b64decode(str(doc.get("b64") or ""), validate=False)
        except (binascii.Error, ValueError):
            return None
    return bytes(out)


def put_index(base: Path, rid: str, body: dict[str, Any]) -> dict[str, Any]:
    """C26: the audio-recording@1 index. `confirmed` only when every part is here and the SHA-256 matches, which is
    when the phone may delete its own copy."""
    check_id(rid)
    if body.get("$axf") not in (None, INDEX_FORMAT) or body.get("id") not in (None, rid):
        raise Bad("the index's $axf and id must match the address")
    parts = body.get("parts")
    if not isinstance(parts, int) or not 0 < parts <= MAX_PARTS:
        raise Bad("parts is how many parts the recording has")
    sha = str(body.get("sha256") or "")
    keep = {k: body[k] for k in ("name", "startedAt", "endedAt", "durationMs", "bytes", "session", "group", "mic", "mime", "device") if k in body}
    doc = {"$axf": INDEX_FORMAT, "id": rid, "parts": parts, "sha256": sha, **keep, "uploadedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    _write(base / "recordings" / f"{rid}.json", doc)
    data = joined(base, rid, parts)
    confirmed = data is not None and (not sha or hashlib.sha256(data).hexdigest() == sha)
    missing = [n for n in range(parts) if not (base / "parts" / rid / f"{n:04d}.json").exists()][:50]
    return {"ok": True, "confirmed": confirmed, "missing": missing, **({"reason": "the parts don't match the checksum"} if data is not None and not confirmed else {})}


def summary(base: Path, rec: dict[str, Any]) -> dict[str, Any]:
    rid = rec["id"]
    t = read_json(base / "transcripts" / f"{rid}.json")
    return {k: rec.get(k) for k in ("id", "name", "startedAt", "endedAt", "durationMs", "bytes", "parts", "session", "group", "mic", "device", "uploadedAt") if k in rec} | {
        "transcribed": t is not None, **({"transcriptPreview": str(t.get("text") or "")[:160]} if t else {})}


def listing(base: Path, since: str = "", limit: int = 50) -> dict[str, Any]:
    """C27: every recording, newest first (`since` = an ISO time: only those started after it)."""
    rows = []
    try:
        names = [p for p in (base / "recordings").iterdir() if p.suffix == ".json"]
    except OSError:
        names = []
    for p in names:
        r = read_json(p)
        if not r or r.get("deleted") or not ID.match(p.stem):
            continue
        r["id"] = p.stem
        if since and str(r.get("startedAt") or "") <= since:
            continue
        rows.append(summary(base, r))
    rows.sort(key=lambda r: str(r.get("startedAt") or ""), reverse=True)
    return {"ok": True, "recordings": rows[: max(1, min(limit, 500))], "total": len(rows)}


def one(base: Path, rid: str) -> dict[str, Any] | None:
    check_id(rid)
    r = read_json(base / "recordings" / f"{rid}.json")
    if not r or r.get("deleted"):
        return None
    r["id"] = rid
    return {"ok": True, "recording": summary(base, r), "index": r, "transcript": read_json(base / "transcripts" / f"{rid}.json")}


def audio(base: Path, rid: str) -> tuple[bytes, str] | None:
    """The recording's bytes joined (None while parts are missing) and its type."""
    r = read_json(base / "recordings" / f"{check_id(rid)}.json")
    if not r or r.get("deleted"):
        return None
    data = joined(base, rid, int(r.get("parts") or 0))
    return (data, str(r.get("mime") or "audio/webm")) if data is not None else None


def byte_range(header: str, size: int) -> tuple[int, int] | None:
    """`bytes=a-b` / `bytes=a-` / `bytes=-n` → (start, end inclusive), None when it isn't satisfiable or isn't one range."""
    if not header.startswith("bytes=") or "," in header:
        return None
    a, _, b = header[6:].strip().partition("-")
    try:
        if a == "":
            n = int(b)
            return (max(0, size - n), size - 1) if n > 0 else None
        start = int(a)
        end = int(b) if b else size - 1
    except ValueError:
        return None
    if start >= size or start > end:
        return None
    return start, min(end, size - 1)


def confirm_token(secret: str, rid: str, now: float | None = None) -> str:
    """The two-step delete's token for one recording, good for CONFIRM_TTL_S (and the window after)."""
    slot = int((now or time.time()) // CONFIRM_TTL_S)
    return hmac.new(secret.encode(), f"remove|{rid}|{slot}".encode(), hashlib.sha256).hexdigest()[:20]


def confirm_ok(secret: str, rid: str, token: str, now: float | None = None) -> bool:
    t = now or time.time()
    return any(hmac.compare_digest(token, confirm_token(secret, rid, t - k * CONFIRM_TTL_S)) for k in (0, 1))


def remove(base: Path, rid: str) -> dict[str, Any]:
    """C28: irreversible. The parts and the transcript go; the index stays as a tombstone so a phone's older upload of
    the same id is not taken for a new recording."""
    check_id(rid)
    shutil.rmtree(base / "parts" / rid, ignore_errors=True)
    (base / "transcripts" / f"{rid}.json").unlink(missing_ok=True)
    _write(base / "recordings" / f"{rid}.json", {"$axf": INDEX_FORMAT, "id": rid, "deleted": True, "deletedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    return {"ok": True, "removed": 1, "id": rid}


def chunks(data: bytes, start: int, end: int, size: int = 64 * 1024) -> Iterator[bytes]:
    for i in range(start, end + 1, size):
        yield data[i:min(i + size, end + 1)]
