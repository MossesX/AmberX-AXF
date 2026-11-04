"""Live sessions: recordings (claude-live-recording@1). Plain files, no FastAPI, so test.py drives it directly.

Every human session is recorded by default (Brett, Nov 4 2026, addendum 3): a timestamped event log of the context
window as it grew (context loaded, every turn, tool calls with arguments and results, compaction, memory reads,
approvals, errors) plus both sides of the voice (mic + Claude's speech, from AmberX), on one session clock (ms since
the session started). Layout under a storage root:

  sessions/<id>/meta.json            the session row when it started + ended, size, pin, topics, compaction report
  sessions/<id>/events.jsonl         {t, at, kind, role?, text?, tool?, args?, result?, tokens?}  (secrets redacted)
  sessions/<id>/audio/raw/<track>-<offsetMs>.<ext>      live audio as it arrived (kept N hours after compaction)
  sessions/<id>/audio/chunks.json    after compaction: [{track, startMs, endMs, file, bytes, sha256}]
  sessions/<id>/audio/chunks/<track>-<startMs>.opus     speech only; the gaps are timeline, not bytes (addendum 5)

Storage targets (addendum 4): `own-container` (the default: a dedicated data volume), `vps-container` (a path inside a
running container), `repo` (a GitHub repo, Git LFS; public repos are blocked unless Brett overrides), `local` (a device
keeps a synced copy). One primary, optional mirrors; recordings are append-only, so syncing never conflicts.
"""
from __future__ import annotations

import array
import hashlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import time
import wave
from pathlib import Path
from typing import Any, Callable, Iterable

TAG = "claude-live-recording@1"
EVENT_KINDS = ("context", "user", "assistant", "tool", "result", "compact", "memory", "approval", "error", "build", "note", "voice")
MARKER_KINDS = ("tool", "build", "approval", "error", "compact")
TRACKS = ("mic", "tts")
SID = re.compile(r"^[A-Za-z0-9._:-]{1,120}$")
MAX_TEXT = 20_000

# ---------------------------------------------------------------- redaction

_SECRET_PATTERNS = [
    re.compile(r"\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})"),
    re.compile(r"\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{30,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"(?i)\b(bearer|token|basic)\s+[A-Za-z0-9._~+/=-]{20,}"),
    re.compile(r"(?i)((?:api[_-]?key|secret|token|password|passwd|auth)[\"']?\s*[:=]\s*[\"']?)([^\s\"',}]{6,})"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
]


def redact(text: str) -> str:
    """Secrets out of a string before it is saved: tokens, keys, private keys, `password=…` values, JWTs."""
    s = str(text)
    for p in _SECRET_PATTERNS:
        if p.groups >= 2:
            s = p.sub(lambda m: m.group(1) + "[redacted]", s)
        else:
            s = p.sub("[redacted]", s)
    return s


def redact_value(v: Any, depth: int = 0) -> Any:
    if depth > 8:
        return "[…]"
    if isinstance(v, str):
        return redact(v)[:MAX_TEXT]
    if isinstance(v, dict):
        return {str(k)[:80]: ("[redacted]" if re.search(r"(?i)token|secret|password|api[_-]?key|authorization", str(k)) and isinstance(x, str) and x else redact_value(x, depth + 1))
                for k, x in list(v.items())[:200]}
    if isinstance(v, list):
        return [redact_value(x, depth + 1) for x in v[:500]]
    return v


def clean_event(e: dict[str, Any], start_ms: int, now_ms: int | None = None) -> dict[str, Any] | None:
    """One incoming event → what is saved (session clock `t`, known kind, redacted), or None when it isn't one."""
    kind = str(e.get("kind") or "")
    if kind not in EVENT_KINDS:
        return None
    at = int(e.get("atMs") or now_ms or time.time() * 1000)
    out: dict[str, Any] = {"t": max(0, at - start_ms) if start_ms else 0, "atMs": at, "kind": kind}
    for k in ("role", "tool", "model", "id"):
        if e.get(k):
            out[k] = str(e[k])[:120]
    for k in ("text", "result"):
        if e.get(k) is not None:
            out[k] = redact(e[k] if isinstance(e[k], str) else json.dumps(e[k], default=str))[:MAX_TEXT]
    if e.get("args") is not None:
        out["args"] = redact_value(e["args"])
    for k in ("tokens", "contextTokens", "durMs"):
        if isinstance(e.get(k), (int, float)):
            out[k] = int(e[k])
    if e.get("error") is True:
        out["error"] = True
    return out


# ---------------------------------------------------------------- the store

class Store:
    """Recordings under one root (the primary target's folder)."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def dir(self, sid: str) -> Path:
        if not SID.match(sid):
            raise ValueError("bad session id")
        return self.root / "sessions" / sid.replace(":", "_")

    def meta(self, sid: str) -> dict[str, Any]:
        try:
            return json.loads((self.dir(sid) / "meta.json").read_text())
        except (OSError, ValueError):
            return {}

    def write_meta(self, sid: str, meta: dict[str, Any]) -> None:
        d = self.dir(sid)
        d.mkdir(parents=True, exist_ok=True)
        tmp = d / f"meta.json.tmp-{os.getpid()}"
        tmp.write_text(json.dumps(meta, indent=1, default=str) + "\n")
        tmp.replace(d / "meta.json")

    def begin(self, sid: str, row: dict[str, Any], now_ms: int | None = None) -> dict[str, Any]:
        """Open (or keep) a recording for a human session; the session clock starts at its startedAt."""
        m = self.meta(sid)
        if m:
            return m
        now_ms = now_ms or int(time.time() * 1000)
        m = {"$axf": TAG, "id": sid, "startMs": int(row.get("startedAt") or now_ms), "endMs": 0, "row": row, "pinned": False, "favourite": False,
             "events": 0, "bytes": 0, "audio": {"raw": 0, "compacted": None}, "topics": [], "costUsd": row.get("costUsd")}
        self.write_meta(sid, m)
        return m

    def append(self, sid: str, events: Iterable[dict[str, Any]], now_ms: int | None = None) -> int:
        m = self.meta(sid)
        if not m:
            raise KeyError(sid)
        lines = [json.dumps(c, separators=(",", ":"), default=str) for c in (clean_event(e, m["startMs"], now_ms) for e in events) if c]
        if not lines:
            return 0
        with open(self.dir(sid) / "events.jsonl", "a") as f:
            f.write("\n".join(lines) + "\n")
        m["events"] = m.get("events", 0) + len(lines)
        m["lastMs"] = max(m.get("lastMs", 0), max(json.loads(x)["atMs"] for x in lines))
        m["bytes"] = self.size(sid)
        self.write_meta(sid, m)
        return len(lines)

    def events(self, sid: str, after: int = -1, limit: int = 100_000) -> list[dict[str, Any]]:
        out = []
        try:
            with open(self.dir(sid) / "events.jsonl") as f:
                for i, line in enumerate(f):
                    if i <= after:
                        continue
                    try:
                        e = json.loads(line)
                    except ValueError:
                        continue
                    e["seq"] = i
                    out.append(e)
                    if len(out) >= limit:
                        break
        except OSError:
            pass
        return out

    def add_audio(self, sid: str, track: str, offset_ms: int, data: bytes, ext: str = "webm") -> dict[str, Any]:
        if track not in TRACKS:
            raise ValueError("track is mic or tts")
        if not re.match(r"^[a-z0-9]{2,5}$", ext):
            raise ValueError("bad audio type")
        m = self.meta(sid)
        if not m:
            raise KeyError(sid)
        d = self.dir(sid) / "audio" / "raw"
        d.mkdir(parents=True, exist_ok=True)
        f = d / f"{track}-{int(offset_ms):010d}.{ext}"
        f.write_bytes(data)
        m["audio"]["raw"] = m["audio"].get("raw", 0) + len(data)
        m["bytes"] = self.size(sid)
        self.write_meta(sid, m)
        return {"track": track, "offsetMs": int(offset_ms), "file": f.name, "bytes": len(data)}

    def raw_audio(self, sid: str, after_ms: int = -1) -> list[dict[str, Any]]:
        d = self.dir(sid) / "audio" / "raw"
        out = []
        for f in sorted(d.glob("*-*.*")) if d.exists() else []:
            m = re.match(r"^(mic|tts)-(\d+)\.", f.name)
            if m and int(m.group(2)) > after_ms:
                out.append({"track": m.group(1), "offsetMs": int(m.group(2)), "file": f.name, "bytes": f.stat().st_size})
        return sorted(out, key=lambda x: (x["offsetMs"], x["track"]))

    def end(self, sid: str, now_ms: int | None = None) -> dict[str, Any]:
        m = self.meta(sid)
        if m and not m.get("endMs"):
            m["endMs"] = now_ms or m.get("lastMs") or int(time.time() * 1000)
            m["topics"] = topics(self.events(sid))
            self.write_meta(sid, m)
        return m

    def size(self, sid: str) -> int:
        return sum(f.stat().st_size for f in self.dir(sid).rglob("*") if f.is_file())

    def list(self) -> list[dict[str, Any]]:
        out = []
        base = self.root / "sessions"
        for d in base.iterdir() if base.exists() else []:
            try:
                m = json.loads((d / "meta.json").read_text())
            except (OSError, ValueError):
                continue
            out.append(m)
        return sorted(out, key=lambda m: -int(m.get("startMs") or 0))

    def delete(self, sid: str) -> bool:
        d = self.dir(sid)
        if not d.exists():
            return False
        shutil.rmtree(d)
        return True

    def used(self) -> int:
        base = self.root / "sessions"
        return sum(f.stat().st_size for f in base.rglob("*") if f.is_file()) if base.exists() else 0


def topics(events: list[dict[str, Any]], n: int = 8) -> list[str]:
    """Builds and tools a session touched, most used first (the browser's topics column)."""
    seen: dict[str, int] = {}
    for e in events:
        for m in re.findall(r"\b(?:build|branch|PR)[: #]+([A-Za-z0-9._/-]{3,60})", str(e.get("text") or "")):
            seen[m] = seen.get(m, 0) + 3
        if e.get("kind") == "tool" and e.get("tool"):
            seen[e["tool"]] = seen.get(e["tool"], 0) + 1
    return [k for k, _ in sorted(seen.items(), key=lambda kv: -kv[1])[:n]]


# ---------------------------------------------------------------- playback timeline

def timeline(meta: dict[str, Any], events: list[dict[str, Any]], chunks: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Everything the player needs on the one session clock: length, markers (tool calls, builds, approvals, errors,
    compactions), speech spans (from the compacted chunks; silence is the gaps between them) and, per event, the
    running context-token count, so 'what was in context at this moment' is a lookup."""
    end = max(int(meta.get("endMs") or 0) - int(meta.get("startMs") or 0), max((e["t"] for e in events), default=0),
              max((c["endMs"] for c in chunks or []), default=0))
    markers = [{"t": e["t"], "kind": "error" if e.get("error") else e["kind"], "label": (e.get("tool") or e.get("text") or e["kind"])[:80]}
               for e in events if e["kind"] in MARKER_KINDS or e.get("error")]
    ctx, running = [], 0
    for e in events:
        if e["kind"] == "compact":
            running = int(e.get("contextTokens") or running // 4)
        elif isinstance(e.get("contextTokens"), int):
            running = e["contextTokens"]
        else:
            running += int(e.get("tokens") or approx_tokens(e))
        ctx.append({"t": e["t"], "seq": e.get("seq"), "tokens": running})
    speech = sorted(({"track": c["track"], "from": c["startMs"], "to": c["endMs"]} for c in chunks or []), key=lambda s: s["from"])
    return {"durationMs": end, "markers": markers, "context": ctx, "speech": speech, "silenceMs": max(0, end - covered(speech))}


def approx_tokens(e: dict[str, Any]) -> int:
    n = len(str(e.get("text") or "")) + len(str(e.get("result") or "")) + (len(json.dumps(e["args"], default=str)) if e.get("args") else 0)
    return max(1, n // 4)


def covered(spans: list[dict[str, Any]]) -> int:
    """ms covered by the union of [from, to) spans."""
    total, cur_from, cur_to = 0, None, None
    for s in sorted(spans, key=lambda s: s["from"]):
        if cur_to is None or s["from"] > cur_to:
            if cur_to is not None:
                total += cur_to - cur_from
            cur_from, cur_to = s["from"], s["to"]
        else:
            cur_to = max(cur_to, s["to"])
    return total + ((cur_to - cur_from) if cur_to is not None else 0)


def context_at(events: list[dict[str, Any]], t: int) -> dict[str, Any]:
    """The context window at session time t: the events in it since the last compaction, its token count and how
    many earlier events had been compacted away."""
    upto = [e for e in events if e["t"] <= t]
    last_c = max((i for i, e in enumerate(upto) if e["kind"] == "compact"), default=-1)
    tl = timeline({"startMs": 0, "endMs": 0}, upto)
    return {"t": t, "events": upto[last_c + 1:] if last_c >= 0 else upto, "compacted": last_c + 1 if last_c >= 0 else 0,
            "summary": upto[last_c].get("text", "") if last_c >= 0 else "", "tokens": tl["context"][-1]["tokens"] if tl["context"] else 0}


def skip_silence(speech: list[dict[str, Any]], t: int) -> int:
    """Where 'skip silence' jumps from t: t itself inside speech, else the start of the next speech span (or t)."""
    for s in sorted(speech, key=lambda s: s["from"]):
        if s["from"] <= t < s["to"]:
            return t
        if s["from"] > t:
            return s["from"]
    return t


# ---------------------------------------------------------------- silence compaction (addendum 5)

def vad(samples: array.array, rate: int, frame_ms: int = 20, pad_ms: int = 200, min_speech_ms: int = 120, threshold: float | None = None) -> list[tuple[int, int]]:
    """Speech spans [(fromMs, toMs)] in 16-bit mono PCM by frame energy: frames above an adaptive threshold (noise floor
    × 3, at least -45 dBFS) are speech, runs shorter than min_speech_ms are dropped, each span gets pad_ms on both sides
    and spans that touch are merged."""
    n = max(1, rate * frame_ms // 1000)
    rms = []
    for i in range(0, len(samples), n):
        fr = samples[i:i + n]
        rms.append(math.sqrt(sum(x * x for x in fr) / len(fr)) if len(fr) else 0.0)
    if not rms:
        return []
    floor = sorted(rms)[len(rms) // 10]
    th = threshold if threshold is not None else max(floor * 3, 32768 * 10 ** (-45 / 20))
    spans, start = [], None
    for i, v in enumerate(rms + [0.0]):
        if v >= th and start is None:
            start = i
        elif v < th and start is not None:
            if (i - start) * frame_ms >= min_speech_ms:
                spans.append((start * frame_ms, i * frame_ms))
            start = None
    total = len(samples) * 1000 // rate
    padded: list[tuple[int, int]] = []
    for a, b in spans:
        a, b = max(0, a - pad_ms), min(total, b + pad_ms)
        if padded and a <= padded[-1][1]:
            padded[-1] = (padded[-1][0], max(b, padded[-1][1]))
        else:
            padded.append((a, b))
    return padded


def read_wav(data: bytes) -> tuple[array.array, int]:
    with wave.open(io.BytesIO(data)) as w:
        if w.getsampwidth() != 2:
            raise ValueError("16-bit PCM WAV only")
        ch, rate, frames = w.getnchannels(), w.getframerate(), w.readframes(w.getnframes())
    a = array.array("h", frames)
    if ch > 1:
        a = array.array("h", (int(sum(a[i:i + ch]) / ch) for i in range(0, len(a), ch)))
    return a, rate


def wav_bytes(samples: array.array, rate: int) -> bytes:
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(samples.tobytes())
    return b.getvalue()


def ffmpeg() -> str:
    return shutil.which("ffmpeg") or ""


def decode(path: Path, rate: int = 16_000) -> tuple[array.array, int]:
    """Any audio file → 16-bit mono PCM (WAV without ffmpeg; everything else needs ffmpeg in the console image)."""
    if path.suffix == ".wav":
        return read_wav(path.read_bytes())
    ff = ffmpeg()
    if not ff:
        raise RuntimeError("ffmpeg isn't installed, so only WAV audio can be compacted")
    p = subprocess.run([ff, "-v", "error", "-i", str(path), "-f", "s16le", "-ac", "1", "-ar", str(rate), "-"], capture_output=True, timeout=600)
    if p.returncode:
        raise RuntimeError(p.stderr.decode(errors="replace")[-300:] or "ffmpeg could not read the audio")
    return array.array("h", p.stdout[: len(p.stdout) // 2 * 2]), rate


def encode(samples: array.array, rate: int, out: Path) -> Path:
    """PCM → Opus (`.opus`, 24 kbps voice) with ffmpeg; WAV when ffmpeg is missing (the report says so)."""
    ff = ffmpeg()
    if not ff:
        out = out.with_suffix(".wav")
        out.write_bytes(wav_bytes(samples, rate))
        return out
    p = subprocess.run([ff, "-v", "error", "-y", "-f", "s16le", "-ac", "1", "-ar", str(rate), "-i", "-", "-c:a", "libopus", "-b:a", "24k", "-application", "voip", str(out)],
                       input=samples.tobytes(), capture_output=True, timeout=600)
    if p.returncode:
        raise RuntimeError(p.stderr.decode(errors="replace")[-300:] or "ffmpeg could not write Opus")
    return out


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def compact(store: Store, sid: str, pad_ms: int = 200, now_ms: int | None = None, log: Callable[[str], None] = lambda s: None) -> dict[str, Any]:
    """After a human session ends: keep only the speech of both tracks as chunks on the session clock, drop the silence.
    Resumable (a chunk already written for a span is kept), verified before the raw files are marked for deletion:
    every chunk lies inside its raw file's span, its decoded length matches the span, and every voice transcript event
    falls inside the session. The raw files stay until `purge_raw` runs after the keep-raw window."""
    m = store.meta(sid)
    if not m:
        raise KeyError(sid)
    d = store.dir(sid) / "audio"
    (d / "chunks").mkdir(parents=True, exist_ok=True)
    chunks: list[dict[str, Any]] = []
    raw_bytes = 0
    problems: list[str] = []
    for r in store.raw_audio(sid):
        src = d / "raw" / r["file"]
        raw_bytes += r["bytes"]
        try:
            pcm, rate = decode(src)
        except (RuntimeError, ValueError, wave.Error, EOFError) as e:
            problems.append(f"{r['file']}: {e}")
            continue
        dur = len(pcm) * 1000 // rate
        for a, b in vad(pcm, rate, pad_ms=pad_ms):
            start = r["offsetMs"] + a
            out = d / "chunks" / f"{r['track']}-{start:010d}.opus"
            done = next((x for x in [out, out.with_suffix(".wav")] if x.exists()), None)
            f = done or encode(pcm[a * rate // 1000: b * rate // 1000], rate, out)
            chunks.append({"track": r["track"], "startMs": start, "endMs": r["offsetMs"] + b, "file": f.name, "bytes": f.stat().st_size, "sha256": sha256(f),
                           "rawFile": r["file"], "rawFrom": r["offsetMs"], "rawTo": r["offsetMs"] + dur})
    # verify
    for c in chunks:
        if not (c["rawFrom"] <= c["startMs"] < c["endMs"] <= c["rawTo"]):
            problems.append(f"{c['file']}: outside its raw span")
        if c["file"].endswith(".wav"):
            pcm, rate = read_wav((d / "chunks" / c["file"]).read_bytes())
            if abs(len(pcm) * 1000 // rate - (c["endMs"] - c["startMs"])) > 40:
                problems.append(f"{c['file']}: length doesn't match its span")
    length = max(int(m.get("endMs") or m.get("lastMs") or 0) - int(m["startMs"]), max((c["rawTo"] for c in chunks), default=0))
    for e in store.events(sid):
        if e["kind"] == "voice" and not (0 <= e["t"] <= length + 1000):
            problems.append(f"voice line at {e['t']} ms is outside the session")
    kept = sum(c["bytes"] for c in chunks)
    (d / "chunks.json").write_text(json.dumps([{k: v for k, v in c.items()} for c in chunks], indent=1) + "\n")
    report = {"at": now_ms or int(time.time() * 1000), "chunks": len(chunks), "rawBytes": raw_bytes, "keptBytes": kept, "savedBytes": max(0, raw_bytes - kept),
              "speechMs": covered([{"from": c["startMs"], "to": c["endMs"]} for c in chunks]), "verified": not problems, "problems": problems[:20],
              "codec": "opus" if ffmpeg() else "wav (ffmpeg missing)"}
    m["audio"]["compacted"] = report
    m["bytes"] = store.size(sid)
    store.write_meta(sid, m)
    log(f"compacted {sid}: {len(chunks)} chunks, saved {report['savedBytes']} bytes{'' if report['verified'] else ' (NOT verified: raw kept)'}")
    return report


def chunks(store: Store, sid: str) -> list[dict[str, Any]]:
    try:
        return json.loads((store.dir(sid) / "audio" / "chunks.json").read_text())
    except (OSError, ValueError):
        return []


def purge_raw(store: Store, keep_raw_h: float, now_ms: int | None = None) -> list[str]:
    """Delete raw audio of sessions compacted (and verified) more than keep_raw_h hours ago."""
    now_ms = now_ms or int(time.time() * 1000)
    out = []
    for m in store.list():
        c = (m.get("audio") or {}).get("compacted")
        if c and c.get("verified") and not c.get("rawPurgedAt") and now_ms - int(c["at"]) >= keep_raw_h * 3600_000:
            raw = store.dir(m["id"]) / "audio" / "raw"
            if raw.exists():
                shutil.rmtree(raw)
            c["rawPurgedAt"] = now_ms
            m["bytes"] = store.size(m["id"])
            store.write_meta(m["id"], m)
            out.append(m["id"])
    return out


# ---------------------------------------------------------------- retention + size cap

def expired(metas: list[dict[str, Any]], keep_days: float, now_ms: int) -> list[str]:
    """Recordings past the retention window (pinned ones are kept forever; keep_days 0 = keep everything)."""
    if keep_days <= 0:
        return []
    return [m["id"] for m in metas if not m.get("pinned") and int(m.get("endMs") or m.get("startMs") or now_ms) < now_ms - keep_days * 86_400_000]


def cap_state(used: int, cap_mb: float) -> dict[str, Any]:
    """{level: ok|warn|full, pct}: warn at 80 % of the cap, full at 100 % (0 = no cap)."""
    if cap_mb <= 0:
        return {"level": "ok", "pct": 0, "usedBytes": used, "capBytes": 0}
    cap = int(cap_mb * 1024 * 1024)
    pct = round(used * 100 / cap, 1)
    return {"level": "full" if pct >= 100 else "warn" if pct >= 80 else "ok", "pct": pct, "usedBytes": used, "capBytes": cap}


# ---------------------------------------------------------------- storage targets (addendum 4)

TARGET_KINDS = ("own-container", "vps-container", "repo", "local")
DEFAULT_TARGET = {"id": "own", "kind": "own-container", "label": "Its own container (axf-recordings)", "path": "", "container": "", "repo": "", "branch": "recordings",
                  "folder": "recordings", "allowPublic": False, "keepDays": 90, "capMb": 20_480}


def norm_target(t: Any) -> dict[str, Any]:
    o = t if isinstance(t, dict) else {}
    kind = o.get("kind") if o.get("kind") in TARGET_KINDS else "own-container"
    out = {**DEFAULT_TARGET, "kind": kind}
    for k in ("id", "label", "path", "container", "repo", "branch", "folder"):
        if isinstance(o.get(k), str):
            out[k] = o[k].strip()[:200]
    out["id"] = re.sub(r"[^a-z0-9-]", "-", (out["id"] or kind).lower())[:40] or kind
    out["allowPublic"] = o.get("allowPublic") is True
    for k in ("keepDays", "capMb"):
        v = o.get(k)
        if isinstance(v, (int, float)) and v >= 0:
            out[k] = v
    return out


def check_target(t: dict[str, Any], repo_info: dict[str, Any] | None = None) -> list[str]:
    """Problems that stop a target being used ([] = fine). A public repo is refused unless Brett set allowPublic."""
    p: list[str] = []
    if t["kind"] == "vps-container" and not t["container"]:
        p.append("Pick a container.")
    if t["kind"] == "vps-container" and not t["path"].startswith("/"):
        p.append("Give an absolute path inside the container.")
    if t["kind"] == "repo":
        if not re.match(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", t["repo"]):
            p.append("Pick a repo (owner/name).")
        elif repo_info is not None and not repo_info.get("private", False) and not t["allowPublic"]:
            p.append(f"{t['repo']} is PUBLIC: voice recordings there would be world-readable. Use a private repo, or Brett confirms 'I understand'.")
        if not re.match(r"^[A-Za-z0-9._/-]{1,100}$", t["branch"] or ""):
            p.append("Give a branch for the recordings.")
    if t["path"] and ".." in t["path"].split("/"):
        p.append("The path can't go up (..).")
    return p


def norm_storage(s: Any) -> dict[str, Any]:
    o = s if isinstance(s, dict) else {}
    targets = [norm_target(t) for t in o.get("targets") or []][:8] or [norm_target(DEFAULT_TARGET)]
    ids = [t["id"] for t in targets]
    seen: set[str] = set()
    for t in targets:  # unique ids
        while t["id"] in seen:
            t["id"] = (t["id"] + "-2")[:40]
        seen.add(t["id"])
    primary = o.get("primary") if o.get("primary") in ids else targets[0]["id"]
    mirrors = [m for m in o.get("mirrors") or [] if m in ids and m != primary]
    return {"primary": primary, "mirrors": mirrors, "targets": targets}


def plan_move(src: list[dict[str, Any]], dst_have: dict[str, str]) -> list[dict[str, Any]]:
    """Which files a move copies: [{rel, sha256, action: copy|skip}], skip when the destination already has the same hash."""
    return [{"rel": f["rel"], "sha256": f["sha256"], "bytes": f.get("bytes", 0), "action": "skip" if dst_have.get(f["rel"]) == f["sha256"] else "copy"} for f in src]


def manifest(root: Path) -> list[dict[str, Any]]:
    base = Path(root) / "sessions"
    return [{"rel": str(f.relative_to(root)), "sha256": sha256(f), "bytes": f.stat().st_size} for f in sorted(base.rglob("*")) if f.is_file()] if base.exists() else []


def move(src_root: Path, dst_root: Path, delete_source: bool = True) -> dict[str, Any]:
    """Copy every recording file to another filesystem target, verify each hash there, and only then delete the
    source (nothing is lost: a mismatch stops before anything is deleted)."""
    src = manifest(src_root)
    have = {f["rel"]: f["sha256"] for f in manifest(dst_root)}
    plan = plan_move(src, have)
    for p in plan:
        if p["action"] == "copy":
            to = Path(dst_root) / p["rel"]
            to.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(Path(src_root) / p["rel"], to)
    bad = [p["rel"] for p in plan if sha256(Path(dst_root) / p["rel"]) != p["sha256"]]
    if bad:
        return {"ok": False, "copied": sum(1 for p in plan if p["action"] == "copy"), "mismatch": bad[:20], "deleted": 0}
    deleted = 0
    if delete_source:
        for p in plan:
            (Path(src_root) / p["rel"]).unlink(missing_ok=True)
            deleted += 1
    return {"ok": True, "copied": sum(1 for p in plan if p["action"] == "copy"), "skipped": sum(1 for p in plan if p["action"] == "skip"), "mismatch": [], "deleted": deleted,
            "bytes": sum(p["bytes"] for p in plan)}
