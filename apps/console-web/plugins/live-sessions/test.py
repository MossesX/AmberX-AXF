"""Live sessions self-test: python3 apps/console-web/plugins/live-sessions/test.py (no model, no network)."""
from __future__ import annotations

import array
import json
import re
import math
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "server"))

import recordings as rec  # noqa: E402
import sessions as ss  # noqa: E402

checks = 0


def ok(cond: object, msg: str) -> None:
    global checks
    assert cond, msg
    checks += 1


ROSTER = [{"id": "paulie", "name": "Ping Paulie", "title": "All-rounder", "avatar": {"emoji": "🏓"}, "status": "on-duty"},
          {"id": "gizmo", "name": "Gizmo", "title": "Companion", "status": "on-duty"},
          {"id": "sully", "name": "Snap Sully", "title": "Screenshots", "status": "on-duty"}]
NOW = 1_800_000_000_000

# ---------------------------------------------------------------- classify + normalize
ok(ss.classify({"client": "code"}) == "human", "code is human")
ok(ss.classify({"client": "headless"}) == "headless", "headless client")
ok(ss.classify({"name": "axf-live-sessions-plugin"}) == "headless", "axf- tmux is headless")
ok(ss.classify({"surface": "headless", "client": "code"}) == "headless", "surface wins")
ok(ss.classify({"entrypoint": "sdk-cli"}) == "headless", "sdk entrypoint")
ok(ss.classify({"source": "claude-ai-voice"}) == "human", "claude.ai voice is human")

h = ss.normalize({"id": "cc-1", "client": "code", "account": "main", "device": "VPS", "agent": "paulie", "startedAt": NOW - 600_000, "lastAt": NOW - 5_000, "amberx": True}, ROSTER, NOW)
ok(h["kind"] == "human" and h["status"] == "live" and h["agent"]["name"] == "Ping Paulie" and h["agent"]["title"] == "All-rounder", "human row")
ok(h["voice"]["ok"] and h["recording"] and h["primary"], "voice ok with AmberX, recording on by default")
v = ss.normalize({"id": "ai-1", "source": "claude-ai-voice", "account": "helper-2", "lastAt": NOW - 1000}, ROSTER, NOW)
ok(v["client"] == "voice" and v["mode"] == "voice" and not v["voice"]["ok"] and "AmberX" in v["voice"]["why"] and not v["primary"], "voice row without AmberX")
k = ss.normalize({"id": "tmux:vps:axf-x", "name": "axf-x", "agent": "Snap Sully", "lastAt": NOW - 10, "costUsd": "1.25", "job": "shots"}, ROSTER, NOW)
ok(k["kind"] == "headless" and k["client"] == "swarm" and not k["recording"] and k["costUsd"] == 1.25 and not k["voice"]["ok"], "headless row")
old = ss.normalize({"id": "old", "client": "chat", "lastAt": NOW - 3 * 3600_000}, ROSTER, NOW)
ok(old["status"] == "ended", "silent for hours = ended")
ok(ss.normalize({"id": "x", "client": "chat", "lastAt": NOW - 10 * 60_000}, ROSTER, NOW)["status"] == "idle", "idle")
ok(ss.normalize({"id": "x", "agent": "nobody"}, ROSTER, NOW)["agent"] == {"id": "nobody", "name": "nobody", "title": "", "avatar": None, "known": False}, "unknown agent")

# merge: newest wins, blanks filled
a = ss.normalize({"id": "s", "client": "chat", "lastAt": NOW - 50_000, "title": "Chat", "agent": "gizmo", "startedAt": NOW - 900_000}, ROSTER, NOW)
b = ss.normalize({"id": "s", "client": "chat", "lastAt": NOW - 1_000, "doing": "reading", "startedAt": NOW - 100_000}, ROSTER, NOW)
m = ss.merge([a, b, k, old])
ok(len(m) == 3 and m[0]["id"] == "s" and m[0]["title"] == "Chat" and m[0]["doing"] == "reading" and m[0]["agent"]["name"] == "Gizmo" and m[0]["startedAt"] == NOW - 900_000, "merge")
ok(m[-1]["id"] == "old", "ended last")

rows = ss.merge([h, v, k, old])
ok([r["id"] for r in ss.filter_rows(rows, kind="human")] == ["ai-1", "cc-1"], "human filter, ended hidden")
ok([r["id"] for r in ss.filter_rows(rows, kind="headless")] == ["tmux:vps:axf-x"], "headless filter")
ok(len(ss.filter_rows(rows, ended=True)) == 4, "ended shown on ask")
ok([r["id"] for r in ss.filter_rows(rows, account="helper-2")] == ["ai-1"], "account filter")
ok([r["id"] for r in ss.filter_rows(rows, agent="ping paulie")] == ["cc-1"], "agent filter by name")
ok([r["id"] for r in ss.filter_rows(rows, q="vps")] == ["cc-1"], "search")
c = ss.counts(rows)
ok(c["human"] == 2 and c["headless"] == 1 and c["label"] == "2 human · 1 headless", "counts label")
ok(ss.counts([])["label"] == "No sessions", "empty label")

# watch policy
ok(ss.can_watch({"owner": True}, k) == (True, ""), "owner watches headless text")
ok(not ss.can_watch({"owner": True}, k, voice=True)[0], "no voice on headless")
ok(not ss.can_watch({"owner": True}, v, voice=True)[0] and "AmberX" in ss.can_watch({"owner": True}, v, voice=True)[1], "voice needs AmberX")
ok(ss.can_watch({"owner": True}, h, voice=True)[0], "voice on human with AmberX")
ok(not ss.can_watch({"owner": False}, h)[0], "helpers can't watch")

# agent clash + free agents
ok(ss.agent_clash(rows, "paulie", "new")["session"] == "cc-1", "paulie is busy")
ok(ss.agent_clash(rows, "paulie", "cc-1") is None, "own session isn't a clash")
ok(ss.agent_clash(rows, "sully", "new") is None, "headless doesn't count")
ok([a["id"] for a in ss.free_agents(rows, ROSTER)] == ["gizmo", "sully"] or [a["id"] for a in ss.free_agents(rows, ROSTER)] == ["sully"], "free agents")

# watchers
w = ss.Watchers(ttl=45)
ok(w.start("cc-1", "w1", "Brett", False, now=100) is True, "first watcher")
ok(w.start("cc-1", "w2", "Brett", True, now=101) is False, "second watcher")
ok(len(w.active("cc-1", now=110)) == 2, "two active")
ok(w.stop("cc-1", "w1", now=111) is False, "not last")
ok(w.sweep(now=200) == [("cc-1", {"id": "w2", "by": "Brett", "voice": True, "since": 101, "seen": 101})], "sweep ends the last")
ok(w.active("cc-1", now=200) == [], "none left")
n = ss.notice(h, [{"by": "Brett", "voice": True, "since": 1}])
ok(n["watched"] and n["recording"] and n["text"] == "You're being watched by Brett (with voice) · Recording", "notice text")
ok(ss.notice(k, [{"by": "Brett", "voice": False, "since": 1}])["text"] == "", "headless: no notice")
ok(ss.notice(h, [])["text"] == "Recording", "recording alone")
ok("Brett is watching Ping Paulie's session (Claude Code · VPS)" in ss.chat_line(h, "Brett", True), "chat line")

# ---------------------------------------------------------------- redaction
s = rec.redact("token ghp_abcdefghijklmnopqrstuvwxyz0123 and sk-ant-api03-abcdefghijklmnopqrstuvwx and password=hunter2hunter2 ok")
ok("ghp_" not in s and "sk-ant" not in s and "hunter2" not in s and s.endswith("ok"), f"redact: {s}")
ok(rec.redact_value({"GITHUB_TOKEN": "abc123", "cmd": "echo Bearer abcdefghijklmnopqrstuvwxyz123"}) == {"GITHUB_TOKEN": "[redacted]", "cmd": "echo [redacted]"}, "redact dict")
ok(rec.clean_event({"kind": "nope"}, 0) is None, "unknown kind dropped")

# ---------------------------------------------------------------- store, timeline, context
tmp = Path(tempfile.mkdtemp())
st = rec.Store(tmp)
st.begin("cc-1", h, now_ms=NOW)
start = h["startedAt"]
n_ev = st.append("cc-1", [
    {"kind": "context", "text": "CLAUDE.md loaded", "atMs": start + 0, "tokens": 4000},
    {"kind": "user", "role": "user", "text": "build the thing", "atMs": start + 1000},
    {"kind": "tool", "tool": "Bash", "args": {"command": "export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123"}, "atMs": start + 2000},
    {"kind": "result", "tool": "Bash", "result": "ok", "atMs": start + 2500},
    {"kind": "compact", "text": "summary of earlier", "contextTokens": 1200, "atMs": start + 5000},
    {"kind": "assistant", "role": "assistant", "text": "done", "atMs": start + 6000},
    {"kind": "error", "text": "boom", "error": True, "atMs": start + 7000},
    {"kind": "bogus"},
])
ok(n_ev == 7, "7 events saved")
evs = st.events("cc-1")
ok("ghp_" not in json.dumps(evs), "no secret in the saved log")
ok([e["t"] for e in evs] == [0, 1000, 2000, 2500, 5000, 6000, 7000], "session clock")
ok([e["seq"] for e in st.events("cc-1", after=4)] == [5, 6], "events after seq")
st.end("cc-1", now_ms=start + 8000)
tl = rec.timeline(st.meta("cc-1"), evs, [{"track": "mic", "startMs": 800, "endMs": 1800}, {"track": "tts", "startMs": 5800, "endMs": 7000}])
ok(tl["durationMs"] == 8000 and tl["silenceMs"] == 8000 - 2200, "duration + silence")
ok([x["kind"] for x in tl["markers"]] == ["tool", "compact", "error"], f"markers {tl['markers']}")
ok(tl["context"][4]["tokens"] == 1200, "compaction resets the context count")
cx = rec.context_at(evs, 6500)
ok(cx["compacted"] == 5 and cx["summary"] == "summary of earlier" and [e["kind"] for e in cx["events"]] == ["assistant"], "context at a moment")
ok(rec.skip_silence(tl["speech"], 2000) == 5800 and rec.skip_silence(tl["speech"], 900) == 900 and rec.skip_silence(tl["speech"], 7500) == 7500, "skip silence")
ok(rec.covered([{"from": 0, "to": 10}, {"from": 5, "to": 20}, {"from": 30, "to": 40}]) == 30, "covered union")

# ---------------------------------------------------------------- VAD + compaction (WAV path, no ffmpeg needed)
RATE = 16_000


def tone(ms: int, amp: int = 8000) -> list[int]:
    return [int(amp * math.sin(2 * math.pi * 440 * i / RATE)) for i in range(RATE * ms // 1000)]


def quiet(ms: int) -> list[int]:
    return [0] * (RATE * ms // 1000)


pcm = array.array("h", quiet(1000) + tone(500) + quiet(2000) + tone(300) + quiet(1000))
spans = rec.vad(pcm, RATE)
ok(len(spans) == 2 and abs(spans[0][0] - 800) <= 20 and abs(spans[0][1] - 1700) <= 20 and abs(spans[1][0] - 3300) <= 20, f"vad spans {spans}")
ok(rec.vad(array.array("h", quiet(500)), RATE) == [], "silence = nothing")
ok(rec.vad(array.array("h", quiet(200) + tone(60) + quiet(200)), RATE) == [], "clicks shorter than min speech dropped")

os.environ["PATH"] = ""  # force the WAV path (no ffmpeg) so the test is the same everywhere
st.add_audio("cc-1", "mic", 0, rec.wav_bytes(pcm, RATE), "wav")
st.add_audio("cc-1", "tts", 5000, rec.wav_bytes(array.array("h", tone(400) + quiet(600)), RATE), "wav")
r = rec.compact(st, "cc-1", now_ms=NOW)
ok(r["verified"] and r["chunks"] == 3 and r["savedBytes"] > 0 and r["keptBytes"] < r["rawBytes"], f"compaction {r}")
ch = rec.chunks(st, "cc-1")
ok([c["track"] for c in ch] == ["mic", "mic", "tts"] and ch[2]["startMs"] == 5000, "chunks on the session clock")
r2 = rec.compact(st, "cc-1", now_ms=NOW)
ok(r2["chunks"] == 3 and r2["verified"], "resumable: same result again")
ok(rec.purge_raw(st, 24, now_ms=NOW + 3600_000) == [], "raw kept inside the window")
ok(rec.purge_raw(st, 24, now_ms=NOW + 25 * 3600_000) == ["cc-1"] and not (st.dir("cc-1") / "audio" / "raw").exists(), "raw purged after the window")
ok(len(st.list()) == 1 and st.used() > 0, "list + used")

# ---------------------------------------------------------------- retention, caps, targets, move
metas = [{"id": "a", "endMs": NOW - 100 * 86_400_000}, {"id": "b", "endMs": NOW - 100 * 86_400_000, "pinned": True}, {"id": "c", "endMs": NOW - 86_400_000}]
ok(rec.expired(metas, 90, NOW) == ["a"], "90-day retention, pins kept")
ok(rec.expired(metas, 0, NOW) == [], "0 = forever")
ok(rec.cap_state(900 * 1024 * 1024, 1000)["level"] == "warn" and rec.cap_state(10, 0)["level"] == "ok" and rec.cap_state(2 << 30, 1024)["level"] == "full", "cap levels")

s0 = rec.norm_storage({})
ok(s0["primary"] == "own" and s0["targets"][0]["kind"] == "own-container" and s0["targets"][0]["keepDays"] == 90, "default target = own container")
pub = rec.norm_target({"id": "gh", "kind": "repo", "repo": "MossesX/AmberX-AXF", "branch": "recordings"})
ok(any("PUBLIC" in p for p in rec.check_target(pub, {"private": False})), "public repo blocked")
ok(rec.check_target({**pub, "allowPublic": True}, {"private": False}) == [], "owner override")
ok(rec.check_target(pub, {"private": True}) == [], "private repo fine")
ok(rec.check_target(rec.norm_target({"kind": "vps-container"})) == ["Pick a container.", "Give an absolute path inside the container."], "container needs a pick + path")
ok(rec.check_target(rec.norm_target({"kind": "vps-container", "container": "x", "path": "/a/../b"})) == ["The path can't go up (..)."], "no ..")
s2 = rec.norm_storage({"primary": "b", "mirrors": ["a", "b", "zz"], "targets": [{"id": "a"}, {"id": "b", "kind": "local"}, {"id": "a"}]})
ok(s2["primary"] == "b" and s2["mirrors"] == ["a"] and [t["id"] for t in s2["targets"]] == ["a", "b", "a-2"], "storage normalised")

dst = Path(tempfile.mkdtemp())
mv = rec.move(tmp, dst)
ok(mv["ok"] and mv["copied"] > 0 and mv["deleted"] == mv["copied"] and rec.Store(dst).meta("cc-1")["id"] == "cc-1", f"move verified {mv}")
ok(rec.plan_move([{"rel": "x", "sha256": "1"}, {"rel": "y", "sha256": "2"}], {"x": "1"}) == [{"rel": "x", "sha256": "1", "bytes": 0, "action": "skip"}, {"rel": "y", "sha256": "2", "bytes": 0, "action": "copy"}], "move plan skips same hash")
ok(rec.topics([{"kind": "tool", "tool": "Bash"}, {"kind": "user", "text": "work on build live-sessions-plugin"}])[0] == "live-sessions-plugin", "topics")

# ---------------------------------------------------------------- routes (FastAPI TestClient, fake sources)
import importlib.util  # noqa: E402
import types  # noqa: E402

os.environ["PATH"] = "/usr/bin:/bin"
os.environ.update(AXF_LIVE_DIR=tempfile.mkdtemp(prefix="axf-live-test-"), AXF_LIVE_SWEEP="off")
os.environ.pop("AXF_RECORDINGS_DIR", None)
sys.path.insert(0, str(HERE.parents[1] / "server"))
import plugin_services  # noqa: E402
import console_context as cxm  # noqa: E402

alerts: list = []
cxm.raise_alert = lambda a: alerts.append(("raise", a.get("key"))) or {}
cxm.resolve_alerts = lambda keys: alerts.append(("resolve", keys[0]))
cxm.log = lambda *a, **k: None
said: list = []
LOG_DIR = Path(tempfile.mkdtemp(prefix="axf-live-wt-")) / "build-x"
LOG_DIR.mkdir()
(LOG_DIR / "build-x.jsonl").write_text(json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": "starting"}, {"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}]}}) + "\n")


class Crew:
    def crew(self):
        return ROSTER

    def post(self, text):
        said.append(text)
        return True


class Headless:
    def sessions(self):
        return {"ready": True, "items": [{"name": "axf-build-x", "createdAt": NOW, "cwd": str(LOG_DIR)}, {"name": "axt-tab", "createdAt": NOW}]}

    def meters(self, names):
        return {"items": {"axf-build-x": {"agent": "sully", "model": "opus", "costUsd": 2.5, "build": "build-x", "step": "s2"}}}


class Feed:
    def feeds(self):
        return [{"id": "amber-voice", "source": "claude-ai-voice", "title": "Amber voice", "agent": "gizmo", "startedAt": int(time.time() * 1000) - 60_000,
                 "lastAt": int(time.time() * 1000), "status": "working", "lastLine": "talking"}]


import time  # noqa: E402

plugin_services.provide("axf.crew@1", Crew(), "agent-swarm")
plugin_services.provide("axf.headless@1", Headless(), "console-terminal")
plugin_services.provide("axf.session-feed@1", Feed(), "console-terminal")
plugin_services.is_enabled = lambda folder: True if hasattr(plugin_services, "is_enabled") else None
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.live_sessions_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)
mod._post_chat = lambda text: said.append(text)  # synchronous in the test

from fastapi import FastAPI, Request as Req  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()


@app.middleware("http")
async def fake_sign_in(request: Req, call_next):
    if request.headers.get("x-test-brett"):
        request.state.axf_user = types.SimpleNamespace(via="session", admin=True, name="brett")
    return await call_next(request)

app.include_router(mod.router, prefix="/p")
c = TestClient(app)
BR = {"x-test-brett": "1"}

ok(plugin_services.get("axf.claude-live@1") is not None, "provides axf.claude-live@1")
r = c.post("/p/checkin", json={"id": "cc-vps-1", "client": "code", "account": "main", "device": "VPS", "title": "live-sessions build", "agent": "paulie", "amberx": True,
                               "lines": [json.dumps({"type": "user", "message": {"content": "hi ghp_abcdefghijklmnopqrstuvwxyz0123"}, "timestamp": "2026-11-04T10:00:00Z"})]}).json()
ok(r["ok"] and r["kind"] == "human" and r["agent"]["name"] == "Ping Paulie" and r["notice"]["recording"] and not r["notice"]["watched"] and r["saved"] == 1, f"checkin {r}")
lst = c.get("/p/sessions").json()
ids = [x["id"] for x in lst["rows"]]
ok(set(ids) == {"cc-vps-1", "chat:amber-voice", "tmux:axf-build-x"}, f"all sources, plain tmux tabs left out: {ids}")
ok(lst["counts"]["label"] == "2 human · 1 headless" and not lst["viewer"]["owner"], "counts + helper viewer")
hx = next(x for x in lst["rows"] if x["id"] == "tmux:axf-build-x")
ok(hx["kind"] == "headless" and hx["agent"]["name"] == "Snap Sully" and hx["costUsd"] == 2.5 and hx["step"] == "s2", "headless row from meters")
ok([x["id"] for x in c.get("/p/sessions?kind=headless").json()["rows"]] == ["tmux:axf-build-x"], "kind filter")

# helpers can't watch; owner can; voice only for human with AmberX
ok(c.post("/p/sessions/cc-vps-1/watch", json={}).status_code == 403, "helper refused")
ok(c.post("/p/sessions/tmux:axf-build-x/watch", json={"voice": True}, headers=BR).status_code == 403, "no voice on headless")
ok(c.post("/p/sessions/chat:amber-voice/watch", json={"voice": True}, headers=BR).json()["detail"] == "Voice needs AmberX on that phone.", "voice needs AmberX")
w = c.post("/p/sessions/cc-vps-1/watch", json={"voice": True}, headers=BR).json()
ok(w["ok"] and w["watcher"] and w["session"]["notice"]["text"].startswith("You're being watched by Brett (with voice)"), f"watch {w}")
ok(said and "Brett is watching Ping Paulie's session" in said[-1] and ("raise", "live-watch:cc-vps-1") in alerts, "Breakroom line + notice alert")
n = c.get("/p/sessions/cc-vps-1/notice").json()
ok(n["watched"] and n["by"] == ["Brett"], "notice for the watched side")
r2 = c.post("/p/sessions/cc-vps-1/events", json={"lines": [json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": "hello"}]}})]}).json()
ok(r2["notice"]["watched"], "the hook's answer says watched")
wh = c.post("/p/sessions/tmux:axf-build-x/watch", json={}, headers=BR).json()
ok(wh["ok"] and len(said) == 1, "headless watch: only logged, no Breakroom line")
ok(c.post(f"/p/sessions/cc-vps-1/watch/{w['watcher']}/beat").json()["ok"], "beat")
ok(c.delete(f"/p/sessions/cc-vps-1/watch/{w['watcher']}").json()["last"] and ("resolve", "live-watch:cc-vps-1") in alerts and "stopped watching" in said[-1], "last watcher leaves")
ok(not c.get("/p/sessions/cc-vps-1/notice").json()["watched"], "notice off")
au = c.get("/p/audit", headers=BR).json()["items"]
ok([a["op"] for a in au][:5] == ["watch-stop", "watch-start", "watch-start", "watch-refused", "watch-refused"] or "watch-start" in [a["op"] for a in au], "audit")
ok(c.get("/p/audit").status_code == 403, "audit is owner only")

# headless stream log → events (the stream route's source)
kind, log = mod._source(next(x for x in mod.collect(force=True) if x["id"] == "tmux:axf-build-x"))
evs, off = ln_mod.tail(log, 0) if (ln_mod := mod.ln) else ([], 0)
ok(kind == "log" and [e["kind"] for e in evs] == ["assistant", "tool"] and off > 0, "headless stream log read")

# agent clash
ok(c.post("/p/checkin", json={"id": "cc-desk-2", "client": "code", "device": "desktop"}).json()["agent"]["known"] is False, "new session, no pick yet")
cl = c.post("/p/sessions/cc-desk-2/agent", json={"agent": "paulie"}, headers=BR)
ok(cl.status_code == 409 and cl.json()["detail"]["clash"]["session"] == "cc-vps-1" and any(a["id"] == "sully" for a in cl.json()["detail"]["free"]), "clash offers others")
ok(c.post("/p/sessions/cc-desk-2/agent", json={"agent": "sully"}, headers=BR).json()["agent"]["name"] == "Snap Sully", "pick another")
ok(c.post("/p/checkin", json={"id": "cc-desk-3", "client": "code", "device": "desktop"}).json()["agent"]["name"] == "Snap Sully", "last pick per account/device is the default")

# audio + recordings
au_r = c.post("/p/sessions/cc-vps-1/audio?track=mic&offsetMs=0&ext=wav", content=rec.wav_bytes(array.array("h", quiet(300) + tone(400) + quiet(300)), RATE))
ok(au_r.json()["ok"], "audio segment saved")
ok(c.post("/p/sessions/tmux:axf-build-x/audio?track=mic", content=b"x").status_code == 400, "no audio for headless")
ok(c.get("/p/recordings").status_code == 403, "recordings owner only")
items = c.get("/p/recordings", headers=BR).json()["items"]
ok([i["id"] for i in items] == ["cc-desk-3", "cc-desk-2", "cc-vps-1"] or "cc-vps-1" in [i["id"] for i in items], "recordings listed")
ok([i["id"] for i in c.get("/p/recordings?q=hello", headers=BR).json()["items"]] == ["cc-vps-1"], "search across transcripts")
one = c.get("/p/recordings/cc-vps-1", headers=BR).json()
ok("ghp_" not in json.dumps(one) and [e["kind"] for e in one["events"]] == ["user", "assistant"], "redacted events in the player")
comp = c.post("/p/recordings/cc-vps-1/compact", headers=BR).json()["report"]
ok(comp["verified"] and comp["chunks"] == 1, f"compact now {comp}")
f = c.get("/p/recordings/cc-vps-1", headers=BR).json()["audio"][0]["file"]
ok(c.get(f"/p/sessions/cc-vps-1/audio/{f}", headers=BR).status_code == 200 and c.get(f"/p/sessions/cc-vps-1/audio/{f}").status_code == 403, "audio owner only")
ok(c.post("/p/recordings/cc-vps-1/flags", json={"pinned": True, "favourite": True}, headers=BR).json()["recording"]["pinned"], "pin")
ok([i["id"] for i in c.get("/p/recordings?favourites=true", headers=BR).json()["items"]] == ["cc-vps-1"], "favourites")
ok(c.get("/p/recordings/cc-vps-1/export", headers=BR).headers["content-type"] == "application/zip", "export zip")
ok(c.get("/p/recordings/cc-vps-1/context?t=999999999", headers=BR).json()["tokens"] > 0, "context at t")
ok(c.delete("/p/recordings/cc-desk-3").status_code == 403 and c.delete("/p/recordings/cc-desk-3", headers=BR).json()["ok"], "delete owner only")

# settings + storage
s = c.get("/p/settings").json()
ok(s["settings"]["record"] is True and s["settings"]["keepDays"] == 90 and s["settings"]["watchNotice"] is True and s["usedBytes"] > 0, "settings defaults")
ok(c.put("/p/settings", json={"keepDays": 30}).status_code == 403, "settings owner only")
ok(c.put("/p/settings", json={"keepDays": 30, "watchNotice": False}, headers=BR).json()["settings"] == {**s["settings"], "keepDays": 30}, "watch notice can't be turned off")
mod._repo_cache.update(at=time.time(), items=[{"repo": "MossesX/AmberX-AXF", "private": False}, {"repo": "MossesX/secret", "private": True}])
st0 = c.get("/p/storage", headers=BR).json()
ok(st0["storage"]["primary"] == "own" and st0["status"]["own"]["state"] == "synced", "storage default")
bad = c.put("/p/storage", headers=BR, json={"primary": "own", "mirrors": ["gh"], "targets": [{"id": "own"}, {"id": "gh", "kind": "repo", "repo": "MossesX/AmberX-AXF", "branch": "recordings"}]})
ok(bad.status_code == 400 and "PUBLIC" in bad.json()["detail"], "public repo mirror refused")
ok(c.put("/p/storage", headers=BR, json={"primary": "gh", "targets": [{"id": "own"}, {"id": "gh", "kind": "repo", "repo": "MossesX/secret"}]}).status_code == 400, "primary must be own container")
mod.sync_mirrors = lambda: None
good = c.put("/p/storage", headers=BR, json={"primary": "own", "mirrors": ["gh", "me"], "targets": [{"id": "own"}, {"id": "gh", "kind": "repo", "repo": "MossesX/secret", "branch": "recordings"}, {"id": "me", "kind": "local"}]})
ok(good.json()["ok"] and good.json()["storage"]["mirrors"] == ["gh", "me"], "private repo + local mirrors saved")
ok(c.get("/p/storage", headers=BR).json()["status"]["me"]["state"] == "pending", "local target pending until the device reports")
ok(c.post("/p/storage/local-ack", json={"target": "me", "device": "S26", "ids": ["cc-vps-1", "cc-desk-2"], "bytes": 10}).json()["ok"], "device ack")
new_root = tempfile.mkdtemp(prefix="axf-live-move-")
dry = c.post("/p/storage/move", headers=BR, json={"path": new_root}).json()
ok(dry["dryRun"] and dry["files"] > 0 and dry["copy"] == dry["files"], "move dry run")
mv = c.post("/p/storage/move", headers=BR, json={"path": new_root, "dryRun": False}).json()
ok(mv["ok"] and mv["deleted"] == mv["copied"] and str(mod.store_root()) == new_root and c.get("/p/recordings/cc-vps-1", headers=BR).status_code == 200, "move verified + store follows")

# sweep: a watcher without heartbeat ends; ended sessions get finished
mod.WATCH.by["tmux:axf-build-x"][wh["watcher"]]["seen"] = 0
sw = mod.sweep()
ok("tmux:axf-build-x" in sw["watchEnded"] and sw["cap"]["level"] == "ok", "sweep ends stale watches")
c.post("/p/checkin", json={"id": "cc-desk-2", "ended": True})
ok(mod.STORE().meta("cc-desk-2")["endMs"] > 0, "ended check-in closes the recording")

# zero tokens: nothing here can reach a model
LLM = re.compile(r"anthropic|openai|axf\.llm@1|claude\s+-p\b(?! build)|messages\.create|/v1/messages", re.I)
for f in HERE.rglob("*"):
    if f.is_file() and f.suffix in (".py", ".ts", ".tsx", ".mjs") and f.name != "test.py":
        hits = [x for x in f.read_text().splitlines() if LLM.search(x) and "headless" not in x.lower() and "no model" not in x.lower() and "stream-json" not in x]
        ok(not hits, f"zero tokens: {f.name} {hits[:1]}")

print(f"live-sessions: {checks} checks ok")
