"""Live sessions self-test: python3 apps/console-web/plugins/live-sessions/test.py (no model, no network)."""
from __future__ import annotations

import array
import json
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

print(f"live-sessions: {checks} checks ok")
