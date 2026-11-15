"""Automatic transcripts: chunk selection, reassembly + checksum, retries, memory floor, document size, a fake engine.
  python3 apps/console-web/plugins/output-recorder/test_transcripts.py
"""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("recorder_transcripts", HERE / "server" / "transcripts.py")
T = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = T
spec.loader.exec_module(T)  # type: ignore[union-attr]

n = 0


def ok(cond: bool, what: str) -> None:
    global n
    assert cond, what
    n += 1


root = Path(tempfile.mkdtemp())
base = T.folder(root)
AUDIO = b"fake-m4a-" * 20_000
PART = 44_000


def put(rid: str, audio: bytes = AUDIO, parts: int | None = None, **index: object) -> None:
    (base / "recordings").mkdir(parents=True, exist_ok=True)
    chunks = [audio[i:i + PART] for i in range(0, len(audio), PART)]
    for i, c in enumerate(chunks):
        p = base / "parts" / rid / f"{i:04d}.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"$axf": T.PART_FORMAT, "id": rid, "n": i, "b64": base64.b64encode(c).decode()}))
    (base / "recordings" / f"{rid}.json").write_text(json.dumps({"$axf": "audio-recording@1", "id": rid, "name": f"Fix it - {rid}", "session": "Fix it", "group": "cs-1", "startedAt": f"2026-11-06T{rid[-2:]}:00:00Z",
                                                                 "durationMs": 1800000, "parts": len(chunks) if parts is None else parts, "sha256": hashlib.sha256(audio).hexdigest(), **index}))


seen: list[bytes] = []


def engine(audio: Path, models: Path) -> dict:
    seen.append(audio.read_bytes())
    return {"language": "en", "text": "wicked good transcript", "segments": [[0.0, "wicked good"], [2.5, "transcript"]]}


big = lambda: 8192  # noqa: E731
st: dict = {}
ok(T.run_once(base, st, root, engine, big) == "idle", "nothing recorded: idle")
put("20261106-100000-aa10")
put("20261106-110000-bb11")
ok(T.run_once(base, st, root, engine, lambda: 100) == "waiting" and st["note"] == "waiting for memory", "short of memory: waits, nothing started")
ok(not seen, "the engine never ran")
ok(T.run_once(base, st, root, engine, big) == "done", "one chunk per round")
ok(seen[-1] == AUDIO, "the parts go back together byte for byte")
doc = json.loads((base / "transcripts" / "20261106-110000-bb11.json").read_text())
ok(doc["$axf"] == T.FORMAT and doc["text"] == "wicked good transcript" and doc["group"] == "cs-1" and doc["session"] == "Fix it", "newest first, saved with its session and group")
ok(doc["segments"][1] == [2.5, "transcript"] and not doc["silent"], "timed lines kept")
ok(st["last"]["id"] == "20261106-110000-bb11" and st["waiting"] == 1, "status knows")
ok(T.run_once(base, st, root, engine, big) == "done" and T.run_once(base, st, root, engine, big) == "idle", "the backlog drains, then idle")
n_before = len(seen)
ok(T.run_once(base, st, root, engine, big) == "idle" and len(seen) == n_before, "never transcribed twice")

put("20261106-120000-cc12", parts=99)  # still uploading: part 3 isn't there
ok(T.run_once(base, st, root, engine, big) == "waiting" and not st["failed"], "still uploading: not a failure")
(base / "recordings" / "20261106-120000-cc12.json").unlink()
put("20261106-130000-dd13", deleted=True)
ok(T.run_once(base, st, root, engine, big) == "idle", "a deleted recording is skipped")

put("20261106-140000-ee14")
meta = json.loads((base / "recordings" / "20261106-140000-ee14.json").read_text())
meta["sha256"] = "0" * 64
(base / "recordings" / "20261106-140000-ee14.json").write_text(json.dumps(meta))
for i in range(T.MAX_TRIES):
    ok(T.run_once(base, st, root, engine, big) == "failed", f"a bad checksum fails (try {i + 1})")
ok(st["failed"]["20261106-140000-ee14"]["tries"] == T.MAX_TRIES and "checksum" in st["failed"]["20261106-140000-ee14"]["error"], "the reason is kept")
ok(T.run_once(base, st, root, engine, big) == "idle", "and it stops trying")

silent = T.document({"id": "x"}, {"text": "  ", "segments": []}, "base.en", "now")
ok(silent["silent"] is True, "silence is recorded, not redone")
long = T.document({"id": "x"}, {"text": "word " * 30_000, "segments": [[i, "word"] for i in range(30_000)]}, "base.en", "now")
ok(len(json.dumps(long, ensure_ascii=False).encode()) <= T.DOC_MAX and long.get("truncated") and long["segments"] == [], "a huge chunk still fits the data server, and says it was cut")
mid = T.document({"id": "x"}, {"text": "word " * 5_000, "segments": [[i, "word " * 3] for i in range(5_000)]}, "base.en", "now")
ok(mid["segments"] == [] and not mid.get("truncated"), "timed lines go first")
print(f"✓ transcripts — {n} checks")
