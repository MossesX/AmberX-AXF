#!/usr/bin/env python3
"""Self-test for the Chat viewer plugin (routes through FastAPI's test client, scratch data + hub folders).

Covers: session@1 in Python against the shared fixtures (validator, redaction, chain hash); the claude.ai data export
(zip + bare conversations.json, voice detection, projects, upsert, new / continued / changed / unchanged, versions
and their messages); Claude Code JSONL incremental sync (byte offset, half-written last line, appended lines =
continued, rewritten file = changed, tool names across increments); headless build logs; the hub drop folder
(session@1 docs, export-shaped docs, bad docs named, the same uuid as the export merges); redaction on every ingest;
full-text search with snippets + seq; text / markdown / json export; settings; TTS keys never returned; and the audio
render with two voices (tone engine: the two voices really differ, pauses, offsets, chapters per hour, tool turns
skipped). With CHAT_VIEWER_PIPER_TTS=<a tts folder with venv/ + voices/> it also renders a short real Piper sample.

    python3 apps/console-web/plugins/chat-viewer/test.py
"""
from __future__ import annotations

import array
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import types
import wave
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
TMP = Path(tempfile.mkdtemp(prefix="axf-chat-viewer-test-"))
os.environ["AXF_CHAT_VIEWER_DIR"] = str(TMP / "data")
os.environ["AXF_CHAT_VIEWER_HUB"] = str(TMP / "hub")
os.environ["AXF_CHAT_VIEWER_TIMER"] = "off"

sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.chat_viewer_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)
S = sys.modules[spec.name + ".schema"]
A = sys.modules[spec.name + ".audio"]
ingest = sys.modules[spec.name + ".ingest"]

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)

passed = failed = 0


def ok(cond: bool, what: str, detail: object = "") -> None:
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"✗ {what}" + (f"\n  {detail}" if detail != "" else ""))


# ---------------------------------------------------------------- 1. session@1 fixtures (same as check-session.mjs)
fx = json.loads((REPO / "framework/spec/fixtures/session.json").read_text())
for name, f in fx["sessions"].items():
    v = S.validate_session(f["session"])
    ok(v["ok"] == f["ok"] and [e["field"] for e in v["errors"]] == f["errors"], f"fixture {name}", v["errors"])
for r in fx["redact"]:
    ok(S.redact(r["input"]) == r["output"], f"redact {r['input'][:40]!r}", S.redact(r["input"]))
    ok(S.redact(r["output"]) == r["output"], f"redact idempotent {r['input'][:30]!r}")
for h in fx["hashes"]:
    ok(S.chain_hash(h["messages"]) == h["hash"], f"chain hash ({len(h['messages'])})")
m3 = fx["sessions"]["valid voice chat"]["session"]["messages"]
ok(S.chain_hash(m3[1:], S.chain_hash(m3[:1])) == S.chain_hash(m3), "chain hash extends")
ok(S.iso("2024-06-01T12:34:56.789012Z") == "2024-06-01T12:34:56.789Z" and S.iso(1730000000) and S.iso("junk") == "", "iso()")

# ---------------------------------------------------------------- 2. claude.ai data export
SECRET = "sk-ant-api03-" + "Q" * 30


def conv(uuid: str, name: str, msgs: list[tuple[str, str, str]], voice: bool = False, updated: str = "2026-10-31T23:10:00Z") -> dict:
    out = {"uuid": uuid, "name": name, "created_at": "2026-10-31T22:00:00.000000Z", "updated_at": updated, "project_uuid": "p1", "chat_messages": []}
    for i, (sender, text, at) in enumerate(msgs):
        m = {"uuid": f"{uuid}-{i}", "sender": sender, "text": text, "created_at": at, "content": [{"type": "text", "text": text}]}
        if voice:
            m["input_mode"] = "voice"
        out["chat_messages"].append(m)
    return out


text_conv = conv("aaaa-1111", "Plan the chat viewer", [("human", f"My key is {SECRET}, store every session", "2026-10-31T22:00:00Z"), ("assistant", "Bet. SQLite with FTS5, kid.", "2026-10-31T22:00:10Z")])
text_conv["chat_messages"][1]["content"].append({"type": "tool_use", "name": "web_search", "input": {"query": "piper tts"}})
voice_conv = conv("bbbb-2222", "", [("human", "Hey Amber, read me the build list", "2026-10-31T22:59:00Z"), ("assistant", "Wicked long list, boss.", "2026-10-31T23:01:00Z"), ("human", "Next hour now", "2026-11-01T00:05:00Z")], voice=True)


def export_zip(convs: list[dict]) -> bytes:
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("data-2026-11-01/conversations.json", json.dumps(convs))
        z.writestr("data-2026-11-01/projects.json", json.dumps([{"uuid": "p1", "name": "AmberX AXF"}]))
        z.writestr("data-2026-11-01/users.json", "[]")
    return b.getvalue()


r = c.post("/p/import?name=x", content=export_zip([text_conv, voice_conv]))
ok(r.status_code == 200 and r.json()["new"] == 2, "export zip: 2 new", r.text[:300])
rows = {x["id"]: x for x in c.get("/p/sessions").json()["sessions"]}
ok(rows.get("cai:aaaa-1111", {}).get("source") == "claude-ai-text" and rows["cai:aaaa-1111"]["project"] == "AmberX AXF", "text chat + project name", rows.get("cai:aaaa-1111"))
ok(rows.get("cai:bbbb-2222", {}).get("source") == "claude-ai-voice", "voice chat detected", rows.get("cai:bbbb-2222"))
ok(rows["cai:bbbb-2222"]["title"] == "Hey Amber, read me the build list", "untitled chat named from its first prompt")
doc = c.get("/p/sessions/cai:aaaa-1111").json()["session"]
ok(S.validate_session(doc)["ok"], "stored session is valid session@1", S.validate_session(doc)["errors"][:3])
ok(SECRET not in json.dumps(doc) and "[redacted:anthropic-key]" in doc["messages"][0]["text"], "secret redacted on ingest", doc["messages"][0]["text"])
ok(any(m["role"] == "tool" and m.get("toolName") == "web_search" for m in doc["messages"]), "tool_use kept as a tool message")
vdoc = c.get("/p/sessions/cai:bbbb-2222").json()["session"]
ok(all(m["kind"] == "speech" for m in vdoc["messages"]), "voice turns are speech")

r = c.post("/p/import?name=x", content=json.dumps([text_conv, voice_conv]).encode())
ok(r.json()["unchanged"] == 2 and r.json()["new"] == 0, "same export again: unchanged (bare conversations.json)", r.json())

text2 = json.loads(json.dumps(text_conv))
text2["chat_messages"].append({"uuid": "x", "sender": "human", "text": "Add audio too", "created_at": "2026-10-31T22:30:00Z", "content": [{"type": "text", "text": "Add audio too"}]})
voice2 = json.loads(json.dumps(voice_conv))
voice2["chat_messages"][1]["text"] = voice2["chat_messages"][1]["content"][0]["text"] = "Edited answer"
r = c.post("/p/import?name=x", content=export_zip([text2, voice2])).json()
ok(r["continued"] == 1 and r["changed"] == 1, "continued + changed detected", r)
d = c.get("/p/sessions/cai:bbbb-2222").json()
ok([v["change"] for v in d["versions"]] == ["new", "changed"] and d["row"]["version"] == 2 and not d["row"]["seen"], "versions recorded", d["versions"])
old = c.get("/p/sessions/cai:bbbb-2222/versions/1").json()["messages"]
ok(old[1]["text"] == "Wicked long list, boss." and d["session"]["messages"][1]["text"] == "Edited answer", "old version readable", old)
d2 = c.get("/p/sessions/cai:aaaa-1111").json()
ok(d2["row"]["change"] == "continued" and len(c.get("/p/sessions/cai:aaaa-1111/versions/1").json()["messages"]) == 3, "continued version = the first messages")
ok(c.post("/p/sessions/cai:aaaa-1111/seen").json()["ok"] and c.get("/p/sessions/cai:aaaa-1111").json()["row"]["seen"], "seen clears the badge")
bad = c.post("/p/import?name=x", content=export_zip([])[:30] + b"junk")
ok(bad.status_code == 400, "a broken zip is refused", bad.status_code)

# ---------------------------------------------------------------- 3. Claude Code JSONL, incremental
cc = TMP / "claude" / "projects" / "-root-axf-builds-chat-viewer"
cc.mkdir(parents=True)
jl = cc / "0fd454a0-edbb-4eda-9f2c-d1502525ac3b.jsonl"


def rec(t: str, content: object, ts: str, **kw: object) -> str:
    return json.dumps({"type": t, "timestamp": ts, "cwd": "/root/axf-builds/chat-viewer", "gitBranch": "claude/chat-viewer", "sessionId": "s", "message": {"role": t, "content": content, **({"model": "claude-opus-5-5"} if t == "assistant" else {})}, **kw}) + "\n"


lines = [
    json.dumps({"type": "queue-operation", "timestamp": "2026-11-01T06:00:00Z"}) + "\n",
    rec("user", "<system-reminder>ignore me</system-reminder># Chat Viewer build\nStore every session", "2026-11-01T06:00:01Z"),
    rec("assistant", [{"type": "thinking", "thinking": "hmm"}, {"type": "text", "text": "Say less, boss."}], "2026-11-01T06:00:05Z"),
    rec("assistant", [{"type": "tool_use", "id": "tu1", "name": "Bash", "input": {"command": "git status", "description": "Show status"}}], "2026-11-01T06:00:06Z"),
]
jl.write_text("".join(lines))
mod.put_settings({"claudeDirs": [{"path": str(TMP / "claude" / "projects"), "label": "root"}], "logGlobs": [str(TMP / "builds" / "*" / "*.log")]})
r = c.post("/p/sync").json()
ok(r["bySource"]["claude-code"]["new"] == 1, "claude code: new session", r)
row = c.get("/p/sessions/cc:0fd454a0-edbb-4eda-9f2c-d1502525ac3b").json()
msgs = row["session"]["messages"]
ok(row["row"]["title"] == "Chat Viewer build" and row["row"]["project"] == "chat-viewer" and row["row"]["branch"] == "claude/chat-viewer" and row["row"]["model"] == "claude-opus-5-5", "title, project, branch, model", row["row"])
ok([m["role"] for m in msgs] == ["user", "assistant", "tool"] and "ignore me" not in msgs[0]["text"], "system reminders + thinking dropped", msgs)
ok(msgs[2]["toolName"] == "Bash" and msgs[2]["text"].startswith("git status"), "tool call summarised")
with open(jl, "a") as f:
    f.write(rec("user", [{"type": "tool_result", "tool_use_id": "tu1", "content": "On branch claude/chat-viewer"}], "2026-11-01T06:00:07Z"))
    f.write(rec("assistant", [{"type": "text", "text": "Clean tree."}], "2026-11-01T06:00:08Z")[:40])  # half-written line
r = c.post("/p/sync").json()
msgs = c.get("/p/sessions/cc:0fd454a0-edbb-4eda-9f2c-d1502525ac3b").json()["session"]["messages"]
ok(r["bySource"]["claude-code"]["continued"] == 1 and len(msgs) == 4 and msgs[3]["toolName"] == "Bash", "appended lines = continued; tool name from the earlier increment", msgs[-1:])
st = mod.store()
cur = st.cursor(str(jl))
ok(cur["offset"] < jl.stat().st_size, "a half-written line is left for next time", cur)
with open(jl, "a") as f:
    f.write(rec("assistant", [{"type": "text", "text": "Clean tree."}], "2026-11-01T06:00:08Z")[40:])
r = c.post("/p/sync").json()
msgs = c.get("/p/sessions/cc:0fd454a0-edbb-4eda-9f2c-d1502525ac3b").json()["session"]["messages"]
ok(len(msgs) == 5 and msgs[4]["text"] == "Clean tree.", "the finished line is read", msgs[-1])
r = c.post("/p/sync").json()
ok(r["bySource"]["claude-code"]["unchanged"] == 1 and r["bySource"]["claude-code"]["continued"] == 0, "nothing new = unchanged", r["bySource"])
ok(S.chain_hash(msgs) == c.get("/p/sessions/cc:0fd454a0-edbb-4eda-9f2c-d1502525ac3b").json()["row"]["hash"], "incremental hash = full hash")
jl.write_text("".join(lines[:2]) + rec("assistant", [{"type": "text", "text": "Rewritten."}], "2026-11-01T06:10:00Z"))
r = c.post("/p/sync").json()
d = c.get("/p/sessions/cc:0fd454a0-edbb-4eda-9f2c-d1502525ac3b").json()
ok(r["bySource"]["claude-code"]["changed"] == 1 and len(d["session"]["messages"]) == 2 and d["versions"][-2]["kept"], "a rewritten file = changed, old copy kept", d["versions"])

# ---------------------------------------------------------------- 4. headless build logs
bd = TMP / "builds" / "chat-viewer"
bd.mkdir(parents=True)
(bd / ".brief.md").write_text("# Chat Viewer: store every session\n\nRead CLAUDE.md first.")
(bd / "chat-viewer.log").write_text("\x1b[2m# model claude-opus-5-5 · /root/axf-builds/chat-viewer · 43 tools\x1b[0m\n\x1b[36m▸ Bash: git status\x1b[0m\n\x1b[2m  ↳ On branch claude/chat-viewer\x1b[0m\nReading the plugin template first.\nThen the schema.\n\x1b[36m▸ Read: server/__init__.py\x1b[0m\nDone, boss.\n")
r = c.post("/p/sync").json()
ok(r["bySource"]["headless"]["new"] == 1, "build log: new", r["bySource"])
hl = [x for x in c.get("/p/sessions?source=headless").json()["sessions"]]
hd = c.get(f"/p/sessions/{hl[0]['id']}").json()
hm = hd["session"]["messages"]
ok(hd["row"]["title"].startswith("Chat Viewer: store every session") and hd["row"]["model"] == "claude-opus-5-5", "title from the brief, model from the header", hd["row"])
ok([m["role"] for m in hm] == ["user", "tool", "tool", "assistant", "tool", "assistant"] and hm[3]["text"] == "Reading the plugin template first.\nThen the schema.", "log → brief, tools, results, joined text", [(m["role"], m["text"][:30]) for m in hm])

# ---------------------------------------------------------------- 5. hub drop folder
drop = TMP / "hub" / "sessions" / "claude-ai"
drop.mkdir(parents=True)
(drop / "cccc-3333.json").write_text(json.dumps({"$axf": "session@1", "uuid": "cccc-3333", "source": "claude-ai-voice", "title": "Voice chat from the phone",
                                                  "startedAt": "2026-11-01T02:00:00Z", "updatedAt": "2026-11-01T03:15:00Z", "project": "amberx-axf",
                                                  "messages": [{"role": "user", "text": "Sync my chats", "at": "2026-11-01T02:00:00Z"}, {"role": "assistant", "text": "On it, kid. password=hunter2222", "at": "2026-11-01T03:10:00Z"}]}))
(drop / "aaaa-1111.json").write_text(json.dumps(text2))  # the export's shape, same uuid as the export
(drop / "bad.json").write_text(json.dumps({"$axf": "session@1", "uuid": "dddd", "messages": [{"role": "robot", "text": "x"}]}))
r = c.post("/p/sync").json()
hb = r["bySource"]["hub-drop"]
ok(hb["new"] == 1 and hb["unchanged"] == 1 and hb["files"] == 3, "hub drop: new + same-uuid merge", hb)
ok(any("bad.json" in e and "role" in e for e in r["errors"]), "a bad drop file is named with the field", r["errors"])
dd = c.get("/p/sessions/cai:cccc-3333").json()["session"]
ok(dd["source"] == "claude-ai-voice" and dd["messages"][0]["kind"] == "speech" and "hunter2222" not in dd["messages"][1]["text"], "drop: voice, speech, redacted", dd["messages"])
ok(len([x for x in c.get("/p/sessions").json()["sessions"] if x["id"] == "cai:aaaa-1111"]) == 1, "export + drop of one chat = one session")

# ---------------------------------------------------------------- 6. search
hits = c.get("/p/search?q=edited").json()["hits"]
ok(any(h["sessionId"] == "cai:bbbb-2222" and "\x02" in h["snippet"] and h["seq"] >= 0 for h in hits), "search finds a word with a marked snippet + seq", hits)
ok(any(h["seq"] == -1 for h in c.get("/p/search?q=phone").json()["hits"]), "search finds titles (seq -1)")
ok(c.get("/p/search?q=hunter2222").json()["hits"] == [] and c.get(f"/p/search?q={SECRET}").json()["hits"] == [], "secrets are not searchable")
ok(len(c.get("/p/search?q=tem").json()["hits"]) >= 1, "last word is a prefix (tem → template)")
ok(c.get('/p/search?q="); DROP TABLE x;--').status_code == 200, "odd queries are safe")

# ---------------------------------------------------------------- 7. export
md = c.get("/p/sessions/cai:aaaa-1111/export?format=md")
ok(md.status_code == 200 and "**Brett**" in md.text and "**Amber**" in md.text and "<details>" in md.text and "attachment" in md.headers["content-disposition"], "markdown export", md.text[:200])
tx = c.get("/p/sessions/cai:aaaa-1111/export?format=txt").text
ok("Brett [2026-10-31 22:00]" in tx and "Tool: web_search" in tx, "text export", tx[:300])
js = c.get("/p/sessions/cai:aaaa-1111/export?format=json").json()
ok(js["$axf"] == "session@1" and S.validate_session(js)["ok"], "json export is session@1")

# ---------------------------------------------------------------- 8. settings + keys
s = c.put("/p/settings", json={"intervalMin": 5, "audio": {"engine": "openai", "pauseMs": 900, "voices": {"openai": {"user": "echo"}}}}).json()["settings"]
ok(s["intervalMin"] == 5 and s["audio"]["engine"] == "openai" and s["audio"]["voices"]["openai"] == {"user": "echo", "assistant": ""} and s["audio"]["voices"]["piper"]["user"] == "en_US-ryan-medium", "settings merge", s["audio"])
ok(c.put("/p/settings", json={"claudeDirs": [{"path": "relative/no"}]}).json()["settings"]["claudeDirs"] == [], "relative paths dropped")
mod.put_settings({"claudeDirs": [{"path": str(TMP / "claude" / "projects"), "label": "root"}], "audio": {"engine": "piper", "pauseMs": 450}})
k = c.put("/p/tts/keys/openai", json={"key": "sk-test-1234567890abcdefghij"}).json()
ok(k["keys"]["openai"] is True and "sk-test" not in json.dumps(c.get("/p/tts").json()) and "sk-test" not in json.dumps(c.get("/p/status").json()), "keys are stored, never returned")
ok(oct((TMP / "data" / "tts-keys.json").stat().st_mode)[-3:] == "600", "keys file 0600")
ok(c.put("/p/tts/keys/nope", json={"key": "x"}).status_code == 400 and c.delete("/p/tts/keys/openai").json()["keys"]["openai"] is False, "key provider checked; delete")
ok(c.post("/p/audio", json={"sessionId": "cai:aaaa-1111", "engine": "piper"}).status_code == 400, "piper not installed = clear refusal")
ok(c.post("/p/tts/setup", json={"voices": ["../../etc"]}).status_code == 400, "voice ids checked")

# ---------------------------------------------------------------- 9. audio: two voices (tone engine)
turns = A.pick_turns(c.get("/p/sessions/cai:aaaa-1111").json()["session"]["messages"])
ok([t["role"] for t in turns] == ["user", "assistant", "user"] and all("[redacted" not in t["text"] for t in turns), "tool turns skipped, redaction marks not read", turns)
ok(A.speech_text("See ```code\nx=1``` at https://x.io and **bold** `axf`") == "See (code block skipped) at link and bold axf", "speech text cleanup", A.speech_text("See ```code\nx=1``` at https://x.io and **bold** `axf`"))
doc = c.get("/p/sessions/cai:bbbb-2222").json()["session"]
job = A.Audio(mod.data_dir, mod.audio_dir).render(doc, {"engine": "tone", "voices": {"user": "300", "assistant": "900"}, "pauseMs": 500, "format": "wav"}, wait=True)
ok(job["state"] == "done", "tone render done", job.get("error"))
meta = job["result"] or {}
wav_path = mod.audio_dir() / meta.get("file", "missing.wav")
with wave.open(str(wav_path), "rb") as w:
    rate = w.getframerate()
    pcm = array.array("h", w.readframes(w.getnframes()))
ok(meta["turns"] == 3 and abs(meta["duration"] - len(pcm) / rate) < 0.01, "duration matches the file", meta)
ok([ch["title"] for ch in meta["chapters"]] == ["Oct 31, 10 PM UTC", "Oct 31, 11 PM UTC", "Nov 1, 12 AM UTC"], "a chapter per hour", meta["chapters"])


def zero_crossings(a: array.array) -> float:
    return sum(1 for i in range(1, len(a)) if (a[i - 1] < 0) != (a[i] < 0)) / max(1, len(a)) * rate / 2


offs = [ch["start"] for ch in meta["chapters"]]
seg = lambda t0: pcm[int(t0 * rate): int(t0 * rate) + int(0.1 * rate)]  # noqa: E731
f_user, f_amber = zero_crossings(seg(offs[0])), zero_crossings(seg(offs[1]))
ok(abs(f_user - 300) < 40 and abs(f_amber - 900) < 60, "Brett's and Amber's voices are different voices", (f_user, f_amber))
gap = pcm[int((offs[1] - 0.45) * rate): int((offs[1] - 0.05) * rate)]
ok(max(abs(x) for x in gap) == 0, "a pause of silence between turns")
lst = c.get("/p/audio?sessionId=cai:bbbb-2222").json()["audio"]
ok(len(lst) == 1 and lst[0]["voices"] == {"user": "300", "assistant": "900"}, "export listed with its sidecar", lst)
f = c.get(f"/p/audio/file/{meta['file']}")
ok(f.status_code == 200 and f.headers["content-type"] == "audio/wav" and f.content[:4] == b"RIFF", "audio file served")
ok(c.get("/p/audio/file/..%2F..%2Fetc%2Fpasswd").status_code == 404, "file names checked")
ok(str(mod.audio_dir()).startswith(str(TMP / "hub")), "audio is stored on the hub")
part = A.Audio(mod.data_dir, mod.audio_dir).render(doc, {"engine": "tone", "voices": {"user": "300", "assistant": "900"}, "from": 1, "to": 2, "format": "wav"}, wait=True)
ok(part["state"] == "done" and part["result"]["turns"] == 1 and part["result"]["range"] == {"from": 1, "to": 2}, "a range renders only that range", part.get("error"))
ok(c.delete(f"/p/audio/file/{meta['file']}").json()["ok"] and not wav_path.exists() and not wav_path.with_suffix(".json").exists(), "delete removes file + sidecar")

# real Piper, when a TTS folder is given (the console container has one after Set up free voices)
piper_dir = os.environ.get("CHAT_VIEWER_PIPER_TTS")
if piper_dir and (Path(piper_dir) / "venv" / "bin" / "python").exists():
    (TMP / "data" / "tts").symlink_to(piper_dir, target_is_directory=True) if not (TMP / "data" / "tts").exists() else None
    au = A.Audio(mod.data_dir, mod.audio_dir)
    j = au.render(doc, {"engine": "piper", "voices": {"user": "en_US-ryan-medium", "assistant": "en_US-amy-medium"}, "to": 2, "format": "mp3"}, wait=True)
    ok(j["state"] == "done" and j["result"]["format"] == "mp3" and j["result"]["duration"] > 1, "real Piper: two-voice mp3", j.get("error") or j.get("result"))
    if j["state"] == "done":
        shutil.copy(mod.audio_dir() / j["result"]["file"], TMP.parent / "chat-viewer-sample.mp3")
        print(f"  real sample: {TMP.parent / 'chat-viewer-sample.mp3'} ({j['result']['duration']:.1f} s)")
else:
    print("  (real Piper render skipped: set CHAT_VIEWER_PIPER_TTS to a folder with venv/ + voices/)")

# ---------------------------------------------------------------- 10. status + forget
stt = c.get("/p/status").json()
ok(stt["counts"]["sessions"] >= 5 and stt["last"] and "claude-code" in stt["counts"]["bySource"], "status counts + last check", stt["counts"])
ok(c.delete("/p/sessions/cai:cccc-3333").json()["ok"] and c.get("/p/sessions/cai:cccc-3333").status_code == 404, "forget a session")
ok(c.post("/p/sync").json()["bySource"]["hub-drop"]["new"] == 1, "the next check brings a live source back")

mod.store().close()
shutil.rmtree(TMP, ignore_errors=True)
print(f"chat-viewer: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
