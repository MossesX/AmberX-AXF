"""Recordings on the console (s7): part and index upload with the confirmation rule, list / get / audio with Range,
two-step delete (tombstone, transcript gone), transcribe, device status, settings, remote start without axHub.

    python apps/console-web/plugins/output-recorder/test.py
"""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "server"))
sys.path.insert(0, str(HERE.parents[3] / "framework" / "python"))
ROOT = Path(tempfile.mkdtemp(prefix="axf-recorder-"))
os.environ.update({"AXF_OUTPUT_RECORDER_NO_WORKER": "1", "AXF_RECORDINGS_ROOT": str(ROOT), "AXF_OUTPUT_RECORDER_DIR": str(ROOT / "plugin")})
os.environ.pop("AXHUB_TOKEN", None)

spec = importlib.util.spec_from_file_location("output_recorder_server", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
assert spec.loader is not None
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router)
c = TestClient(app)
n = 0


def ok(cond: bool, what: str) -> None:
    global n
    if not cond:
        print(f"FAIL {what}")
        sys.exit(1)
    n += 1


AUDIO = bytes(range(256)) * 400  # 102 400 bytes
PART = 44_000
chunks = [AUDIO[i:i + PART] for i in range(0, len(AUDIO), PART)]
RID = "rec-20261112-1"
SHA = hashlib.sha256(AUDIO).hexdigest()
INDEX = {"$axf": "audio-recording@1", "id": RID, "name": "Standup", "startedAt": "2026-11-12T10:00:00Z", "parts": len(chunks), "sha256": SHA, "mic": True, "mime": "audio/mp4"}

ok(c.put(f"/recordings/{RID}/parts/0", json={"b64": "not base64!"}).status_code == 400, "bad base64 refused")
ok(c.put("/recordings/bad id/parts/0", json={"b64": "AA=="}).status_code in (400, 404), "bad id refused")
ok(c.put(f"/recordings/{RID}/parts/0", json={"$axf": "audio-part@1", "id": "other", "n": 0, "b64": "AA=="}).status_code == 400, "id must match")
r = c.put(f"/recordings/{RID}/parts/0", json={"$axf": "audio-part@1", "id": RID, "n": 0, "b64": base64.b64encode(chunks[0]).decode()}).json()
ok(r["sha256"] == hashlib.sha256(chunks[0]).hexdigest(), "part answers its SHA-256")
r = c.put(f"/recordings/{RID}", json=INDEX).json()
ok(r["confirmed"] is False and r["missing"] == [1, 2], f"not confirmed while parts are missing {r}")
for i, ch in enumerate(chunks[1:], start=1):
    c.put(f"/recordings/{RID}/parts/{i}", json={"b64": base64.b64encode(ch).decode()})
r = c.put(f"/recordings/{RID}", json=INDEX).json()
ok(r["confirmed"] is True and r["missing"] == [], "confirmed once every part is in and the checksum matches")
ok(c.put(f"/recordings/{RID}", json={**INDEX, "sha256": "0" * 64}).json()["confirmed"] is False, "a wrong checksum is never confirmed")
c.put(f"/recordings/{RID}", json=INDEX)

lst = c.get("/recordings").json()
ok(lst["total"] == 1 and lst["recordings"][0]["name"] == "Standup" and lst["recordings"][0]["transcribed"] is False, f"listed {lst}")
ok(c.get("/recordings?since=2026-11-12T11:00:00Z").json()["total"] == 0, "since filters")
ok(c.get(f"/recordings/{RID}").json()["recording"]["id"] == RID, "get one")
ok(c.get("/recordings/nope").status_code == 404, "unknown recording")
a = c.get(f"/recordings/{RID}/audio")
ok(a.status_code == 200 and a.content == AUDIO and a.headers["content-type"] == "audio/mp4", "audio joined")
a = c.get(f"/recordings/{RID}/audio", headers={"range": "bytes=10-19"})
ok(a.status_code == 206 and a.content == AUDIO[10:20] and a.headers["content-range"] == f"bytes 10-19/{len(AUDIO)}", "range")
ok(c.get(f"/recordings/{RID}/audio", headers={"range": f"bytes={len(AUDIO)}-"}).status_code == 416, "unsatisfiable range")

tdir = ROOT / "amberx-recordings" / "_data" / "output-recorder" / "transcripts"
tdir.mkdir(parents=True, exist_ok=True)
(tdir / f"{RID}.json").write_text('{"text": "hello"}')
ok(c.get(f"/recordings/{RID}").json()["transcript"]["text"] == "hello", "transcript with the recording")
ok(c.post(f"/recordings/{RID}/transcribe").json()["queued"] is False, "already transcribed")

first = c.delete(f"/recordings/{RID}")
ok(first.status_code == 409 and first.json()["code"] == "confirmation_required", "delete asks first")
ok(c.delete(f"/recordings/{RID}?confirm=wrong").status_code == 409, "a wrong token asks again")
ok(c.delete(f"/recordings/{RID}?confirm={first.json()['confirm']}").json()["removed"] == 1, "deleted with the token")
ok(c.get(f"/recordings/{RID}").status_code == 404 and not (tdir / f"{RID}.json").exists(), "gone with its transcript")
ok(c.get("/recordings").json()["total"] == 0, "not listed after delete")

ok(c.post("/recordings/act/start", json={}).status_code == 400, "start needs a session")
r = c.post("/recordings/act/start", json={"session": "standup"}).json()
ok(r["ok"] is False and "axHub" in r["message"], f"start without axHub says why {r}")
ok(c.post("/recordings/act/pause", json={}).status_code == 404, "unknown verb")

ok(c.get("/device/status").json()["known"] is False, "no device yet")
c.post("/device/status", json={"on": True, "session": "standup", "uploadedParts": 3, "secret": {"x": 1}})
d = c.get("/device/status").json()
ok(d["on"] is True and d["uploadedParts"] == 3 and "secret" not in d, "device status kept, only known fields")

ok(c.put("/settings", json={"listLimit": 5}).status_code == 400, "listLimit range")
ok(c.put("/settings", json={"autoTranscribe": False}).json()["settings"]["autoTranscribe"] is False, "autoTranscribe off")
ok(mod.enabled() is False, "the worker follows autoTranscribe")

print(f"output-recorder recordings ok ({n} checks)")
