"""Live voice from AmberX (live-audio@1): the frame lane next to the segment lane (`POST sessions/{id}/audio`).

AmberX's recorder encodes both tracks (mic = the human, tts = what the phone plays, i.e. Claude's voice) as Opus
packets of 20 ms, stamps each with the shared session clock, and posts small batches of them (about 200 ms) here.
The console keeps the last half minute per session in memory for Watch live (a server-sent event per batch, so the
player hears them within a few hundred ms), and folds them into Ogg Opus segments of about 10 s for the recording,
through the same `Store.add_audio` the segment lane uses, so playback, compaction and export need nothing new.

frames@1 (binary, big-endian, what `LiveStreamer.java` writes):
    b"AXLA" u8 version=1
    then per frame: u8 track (0 = mic, 1 = tts) · u32 seq · i64 atMs (epoch ms, already on the console's clock) ·
                    u16 length · length bytes of one Opus packet
The phone keeps its own clock offset from `serverNow` in every link answer (NTP-style midpoint), so `atMs` is the
console's time; the session clock is `atMs - recording.startMs`, the same clock the transcript events use.

Device links: AmberX long-polls `POST audio/link` (about every 25 s, or at once when the answer changes). The link says
whether it records and which recorder session it is in; the answer says which session it streams for, whether to
stream now (a voice watcher is on it, or it records and recording is on) and who is watching. No model, no network.
"""
from __future__ import annotations

import struct
import threading
import time
from collections import deque
from typing import Any, Callable

MAGIC = b"AXLA"
VERSION = 1
TRACK_NAMES = ("mic", "tts")
HEADER = struct.Struct(">BIqH")  # track, seq, atMs, length
MAX_PACKET = 1500
MAX_BODY = 256 * 1024
RING_MS = 30_000            # how much live audio is kept per session for watchers who join or fall behind
SEGMENT_MS = 10_000         # archive: one Ogg segment per track about every 10 s
GAP_MS = 2_000              # a hole this long closes the open segment (the next one starts at its own offset)
LINK_TTL_S = 70.0           # a link not heard from in this long is gone (its long poll is 25 s)
BEHIND_MS = 3_000           # a watcher whose next frame arrived this long ago jumps to live (arrival time: a gap in
JUMP_TO_MS = 500            # the audio isn't lag); it, and a new watcher, start with what arrived in the last 0.5 s
LINK_WAIT_MAX_S = 25.0


# ---------------------------------------------------------------- frames@1

def encode(frames: list[tuple[int, int, int, bytes]]) -> bytes:
    """[(track, seq, atMs, packet)] → frames@1 bytes (what the phone sends; used by the tests and the simulator)."""
    out = bytearray(MAGIC + bytes([VERSION]))
    for track, seq, at, pkt in frames:
        out += HEADER.pack(track, seq, at, len(pkt)) + pkt
    return bytes(out)


def decode(body: bytes) -> list[dict[str, Any]]:
    """frames@1 bytes → [{track, seq, atMs, data}]; ValueError on anything malformed (the whole batch is refused)."""
    if len(body) > MAX_BODY:
        raise ValueError(f"a batch is at most {MAX_BODY // 1024} KB")
    if body[:4] != MAGIC or len(body) < 5:
        raise ValueError("not frames@1 (AXLA)")
    if body[4] != VERSION:
        raise ValueError(f"frames@1 version {body[4]} is not supported")
    out, i = [], 5
    while i < len(body):
        if i + HEADER.size > len(body):
            raise ValueError("truncated frame header")
        track, seq, at, n = HEADER.unpack_from(body, i)
        i += HEADER.size
        if track >= len(TRACK_NAMES):
            raise ValueError("track is 0 (mic) or 1 (tts)")
        if n == 0 or n > MAX_PACKET or i + n > len(body):
            raise ValueError("bad frame length")
        out.append({"track": TRACK_NAMES[track], "seq": seq, "atMs": at, "data": bytes(body[i:i + n])})
        i += n
    return out


def opus_samples(pkt: bytes) -> int:
    """Samples at 48 kHz in one Opus packet, from its TOC byte (RFC 6716 §3.1); 960 (20 ms) when it can't tell."""
    if not pkt:
        return 0
    toc = pkt[0]
    config, code = toc >> 3, toc & 3
    if config < 12:
        tenths = (100, 200, 400, 600)[config % 4]
    elif config < 16:
        tenths = (100, 200)[config % 2]
    else:
        tenths = (25, 50, 100, 200)[config % 4]
    frames = 1 if code == 0 else 2 if code in (1, 2) else (pkt[1] & 0x3F if len(pkt) > 1 else 0)
    n = frames * tenths * 48 // 10
    return n if 0 < n <= 5760 else 960


# ---------------------------------------------------------------- Ogg Opus (RFC 7845), so a segment plays anywhere

def _crc_table() -> list[int]:
    t = []
    for i in range(256):
        r = i << 24
        for _ in range(8):
            r = ((r << 1) ^ 0x04C11DB7) if r & 0x80000000 else (r << 1)
        t.append(r & 0xFFFFFFFF)
    return t


_CRC = _crc_table()


def _crc(data: bytes) -> int:
    c = 0
    for b in data:
        c = ((c << 8) ^ _CRC[((c >> 24) ^ b) & 0xFF]) & 0xFFFFFFFF
    return c


def _page(serial: int, seq: int, granule: int, packets: list[bytes], flags: int) -> bytes:
    lacing = bytearray()
    for p in packets:
        n = len(p)
        lacing += bytes([255] * (n // 255) + [n % 255])
    head = struct.pack("<4sBBqIIIB", b"OggS", 0, flags, granule, serial, seq, 0, len(lacing)) + bytes(lacing)
    page = bytearray(head + b"".join(packets))
    struct.pack_into("<I", page, 22, _crc(bytes(page)))
    return bytes(page)


PRE_SKIP = 312


def ogg_opus(packets: list[bytes], serial: int = 0x41584C41) -> bytes:
    """Opus packets (mono, 48 kHz) → one Ogg Opus file: OpusHead, OpusTags, data pages of at most 50 packets."""
    head = b"OpusHead" + struct.pack("<BBHIhB", 1, 1, PRE_SKIP, 48_000, 0, 0)
    vendor = b"axf live-audio@1"
    tags = b"OpusTags" + struct.pack("<I", len(vendor)) + vendor + struct.pack("<I", 0)
    out = [_page(serial, 0, 0, [head], 0x02), _page(serial, 1, 0, [tags], 0)]
    granule, seq = PRE_SKIP, 2
    for i in range(0, len(packets), 50):
        group = packets[i:i + 50]
        granule += sum(opus_samples(p) for p in group)
        last = i + 50 >= len(packets)
        out.append(_page(serial, seq, granule, group, 0x04 if last else 0))
        seq += 1
    return b"".join(out)


# ---------------------------------------------------------------- per-session live state

class Session:
    """One session's live audio: the frame ring (both tracks, arrival order) and the open archive segment per track."""

    def __init__(self) -> None:
        self.ring: deque[dict[str, Any]] = deque()
        self.base = 0                     # index of ring[0] since the session's first frame
        self.last_seq: dict[str, int] = {}
        self.stream_id = ""
        self.open: dict[str, dict[str, Any]] = {}   # track → {startT, lastT, packets}
        self.received = 0
        self.dupes = 0
        self.last_at = 0.0

    @property
    def head(self) -> int:
        return self.base + len(self.ring)


class Live:
    """Every session's live audio + the AmberX device links. Thread-safe; `changed` wakes long polls and SSE loops.

    `archive(sid, track, offset_ms, ogg_bytes)` writes a finished segment (the plugin passes `Store.add_audio`)."""

    def __init__(self, archive: Callable[[str, str, int, bytes], Any] | None = None, clock: Callable[[], float] = time.time) -> None:
        self.archive = archive
        self.clock = clock
        self.lock = threading.RLock()
        self.sessions: dict[str, Session] = {}
        self.links: dict[str, dict[str, Any]] = {}
        self.version = 0          # any change (frames, links): wakes SSE loops
        self.links_version = 0    # links only: the session list is recomputed when it moves

    def _bump(self, links: bool = False) -> None:
        self.version += 1
        if links:
            self.links_version += 1

    # ---- frames in

    def push(self, sid: str, start_ms: int, frames: list[dict[str, Any]], stream_id: str = "") -> dict[str, Any]:
        """A batch from the phone. Frames already seen (same stream, seq not newer) are skipped, so a retried batch never
        plays twice; a new stream id (the recorder restarted) starts the sequence over."""
        with self.lock:
            s = self.sessions.setdefault(sid, Session())
            if stream_id and stream_id != s.stream_id:
                self._flush(sid, s, force=True)
                s.stream_id, s.last_seq = stream_id, {}
            took = 0
            for f in sorted(frames, key=lambda x: (x["atMs"], x["seq"])):
                tr = f["track"]
                if f["seq"] <= s.last_seq.get(tr, -1):
                    s.dupes += 1
                    continue
                s.last_seq[tr] = f["seq"]
                t = max(0, int(f["atMs"]) - int(start_ms))
                fr = {"track": tr, "seq": f["seq"], "t": t, "data": f["data"], "i": s.head, "arrived": self.clock()}
                s.ring.append(fr)
                self._archive_add(sid, s, fr)
                took += 1
            s.received += took
            s.last_at = self.clock()
            # keep about RING_MS of audio (by session time, both tracks)
            if s.ring:
                newest = s.ring[-1]["t"]
                while s.ring and newest - s.ring[0]["t"] > RING_MS:
                    s.ring.popleft()
                    s.base += 1
            if took:
                self._bump()
            return {"took": took, "dupes": s.dupes, "head": s.head}

    def _archive_add(self, sid: str, s: Session, fr: dict[str, Any]) -> None:
        seg = s.open.get(fr["track"])
        if seg and (fr["t"] - seg["lastT"] > GAP_MS or fr["t"] - seg["startT"] >= SEGMENT_MS or fr["t"] < seg["lastT"]):
            self._close(sid, fr["track"], seg)
            seg = None
        if not seg:
            seg = s.open[fr["track"]] = {"startT": fr["t"], "lastT": fr["t"], "packets": []}
        seg["packets"].append(fr["data"])
        seg["lastT"] = fr["t"]

    def _close(self, sid: str, track: str, seg: dict[str, Any]) -> None:
        s = self.sessions.get(sid)
        if s and s.open.get(track) is seg:
            s.open.pop(track, None)
        if seg["packets"] and self.archive:
            try:
                self.archive(sid, track, seg["startT"], ogg_opus(seg["packets"]))
            except Exception:  # noqa: BLE001 — the live lane never fails because the archive did
                pass

    def _flush(self, sid: str, s: Session, force: bool = False) -> int:
        n = 0
        for track, seg in list(s.open.items()):
            if force or self.clock() - s.last_at > GAP_MS / 1000:
                self._close(sid, track, seg)
                n += 1
        return n

    def flush_idle(self, force: bool = False) -> int:
        """Close open segments of sessions that went quiet (or all, with force). Returns how many were written."""
        with self.lock:
            n = sum(self._flush(sid, s, force) for sid, s in list(self.sessions.items()))
            for sid, s in list(self.sessions.items()):
                if not s.open and self.clock() - s.last_at > RING_MS / 1000 * 4:
                    self.sessions.pop(sid, None)  # two minutes quiet: the ring goes (the archive has it)
            return n

    # ---- frames out (Watch live)

    def since(self, sid: str, cursor: int) -> tuple[list[dict[str, Any]], int, bool]:
        """Frames after `cursor` (a ring index; -1 = start near live). (frames, new cursor, skipped ahead?)."""
        with self.lock:
            s = self.sessions.get(sid)
            if not s or not s.ring:
                return [], max(cursor, s.head if s else 0), False
            now = self.clock()
            skipped = False
            if cursor < 0:
                cursor = self._index_at(s, now - JUMP_TO_MS / 1000)
            elif cursor < s.base or (cursor < s.head and now - s.ring[cursor - s.base]["arrived"] > BEHIND_MS / 1000):
                cursor, skipped = self._index_at(s, now - JUMP_TO_MS / 1000), True
            out = [s.ring[k] for k in range(cursor - s.base, len(s.ring))] if cursor < s.head else []
            return out, s.head, skipped

    @staticmethod
    def _index_at(s: Session, arrived: float) -> int:
        """The first frame that arrived at or after `arrived` (clock seconds)."""
        for k in range(len(s.ring) - 1, -1, -1):
            if s.ring[k]["arrived"] < arrived:
                return s.base + k + 1
        return s.base

    def stats(self, sid: str) -> dict[str, Any]:
        with self.lock:
            s = self.sessions.get(sid)
            if not s:
                return {"live": False}
            return {"live": self.clock() - s.last_at < 3, "received": s.received, "dupes": s.dupes, "bufferedMs": (s.ring[-1]["t"] - s.ring[0]["t"]) if s.ring else 0}

    # ---- device links

    def link(self, device: str, info: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            old = self.links.get(device) or {}
            ln = {**old, **{k: info.get(k) for k in ("name", "recording", "mic", "recSession", "session", "streaming", "stats") if k in info},
                  "device": device, "seen": self.clock()}
            changed = any(old.get(k) != ln.get(k) for k in ("name", "recording", "recSession", "session", "streaming"))
            self.links[device] = ln
            if changed:
                self._bump(links=True)
            return ln

    def live_links(self) -> list[dict[str, Any]]:
        with self.lock:
            now = self.clock()
            gone = [d for d, ln in self.links.items() if now - ln["seen"] > LINK_TTL_S]
            for d in gone:
                self.links.pop(d, None)
            if gone:
                self._bump(links=True)
            return list(self.links.values())


# ---------------------------------------------------------------- which session a phone streams for

def _live_human(r: dict[str, Any]) -> bool:
    return r.get("kind") == "human" and r.get("status") != "ended"


def pick_target(rows: list[dict[str, Any]], link: dict[str, Any]) -> dict[str, Any] | None:
    """The session an AmberX link streams for, most specific first:
    1. the session id the phone was given (`session`), 2. a live human row on this device (`device` = its name or id),
    3. a live human row titled like the recorder session (`amberx.recorder_start` session_name), 4. the one live voice
    session someone is watching, 5. the newest live voice session. None = nothing to stream for."""
    human = [r for r in rows if _live_human(r)]
    sid = str(link.get("session") or "")
    if sid:
        hit = next((r for r in human if r["id"] == sid), None)
        if hit:
            return hit
    names = {str(link.get("name") or "").lower(), str(link.get("device") or "").lower()} - {""}
    hit = next((r for r in human if str(r.get("device") or "").lower() in names), None)
    if hit:
        return hit
    rs = str(link.get("recSession") or "").strip().lower()
    if rs:
        hit = next((r for r in human if str(r.get("title") or "").strip().lower() == rs), None)
        if hit:
            return hit
    voice = [r for r in human if r.get("mode") == "voice"]
    watched = [r for r in voice if r.get("watchers")]
    if len(watched) == 1:
        return watched[0]
    return max(voice, key=lambda r: r.get("lastAt") or 0) if voice else None


def answer(link: dict[str, Any], target: dict[str, Any] | None, record_on: bool, server_now_ms: int) -> dict[str, Any]:
    """What the phone does now. stream = a voice watcher is on the target, or the phone records and recording is on."""
    watchers = (target or {}).get("watchers") or []
    voice_watchers = sum(1 for w in watchers if w.get("voice"))
    stream = bool(target) and (voice_watchers > 0 or (bool(link.get("recording")) and record_on))
    notice = (target or {}).get("notice") or {"watched": False, "recording": False, "text": "", "by": []}
    return {
        "$axf": "live-audio-link@1",
        "session": {"id": target["id"], "title": target.get("title") or "", "startedAt": target.get("startedAt") or 0} if target else None,
        "stream": stream,
        "why": "" if stream else ("no live voice session to stream for" if not target else "nobody is listening and the phone isn't recording"),
        "watchers": sorted({w["by"] for w in watchers}), "voiceWatchers": voice_watchers,
        "notice": notice, "serverNow": server_now_ms,
        "frameMs": 20, "batchMs": 200, "kbps": 24,
    }


def signature(a: dict[str, Any]) -> str:
    """What changes an answer enough to wake the phone's long poll (not the clock)."""
    s = a.get("session") or {}
    return f"{s.get('id', '')}|{int(a['stream'])}|{','.join(a['watchers'])}|{a['voiceWatchers']}|{a['notice'].get('text', '')}"
