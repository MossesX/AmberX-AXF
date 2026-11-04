"""Two-voice audio renderer, run as its own process (the Chat viewer's audio jobs start it).

    <python> tts_worker.py job.json

Run with the plugin's TTS venv python (piper-tts + lameenc installed by /tts/setup), or any python for the `tone`
engine (tests) and the cloud engines (stdlib HTTP). job.json:
    {engine: piper|openai|elevenlabs|tone, voices: {user: <voice>, assistant: <voice>}, turns: [{role, text}],
     pauseMs, out: "<file without extension>", format: mp3|wav, model?}
Cloud keys come in the environment (CHAT_VIEWER_TTS_KEY), never in argv or the job file.

Prints one JSON object per line: {"progress": i, "total": n} while rendering, then
{"ok": true, "file": …, "format": …, "duration": seconds, "offsets": [start seconds per turn]} or {"ok": false, "error": …}.
Turns are mixed into one mono 16-bit track at the first voice's sample rate (others are resampled), with pauseMs of
silence between turns. Self-contained on purpose: it imports nothing from the console.
"""
from __future__ import annotations

import array
import json
import math
import os
import sys
import urllib.error
import urllib.request
import wave
from pathlib import Path


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def resample(samples: array.array, src: int, dst: int) -> array.array:
    if src == dst or not samples:
        return samples
    n = int(len(samples) * dst / src)
    out = array.array("h", bytes(2 * n))
    ratio = src / dst
    last = len(samples) - 1
    for i in range(n):
        x = i * ratio
        j = int(x)
        f = x - j
        a = samples[j]
        b = samples[j + 1] if j < last else a
        out[i] = int(a + (b - a) * f)
    return out


# ------------------------------------------------------------------------------------------- engines → (rate, samples)

def tone_engine(voice: str, text: str) -> tuple[int, array.array]:
    """Test engine: a beep per word, pitch from the voice (so two voices are measurably different)."""
    rate = 16000
    freq = float(voice) if voice.replace(".", "", 1).isdigit() else 220.0
    words = max(1, len(text.split()))
    out = array.array("h")
    for _ in range(min(words, 400)):
        out.extend(int(8000 * math.sin(2 * math.pi * freq * i / rate)) for i in range(int(rate * 0.12)))
        out.extend(array.array("h", bytes(2 * int(rate * 0.03))))
    return rate, out


_piper_cache: dict[str, object] = {}


def piper_engine(voice: str, text: str) -> tuple[int, array.array]:
    from piper import PiperVoice  # type: ignore  # installed in the TTS venv
    v = _piper_cache.get(voice)
    if v is None:
        v = _piper_cache[voice] = PiperVoice.load(voice)
    tmp = Path(os.environ.get("CHAT_VIEWER_TMP", "/tmp")) / f"cv-{os.getpid()}.wav"
    with wave.open(str(tmp), "wb") as w:
        v.synthesize_wav(text, w)  # type: ignore[attr-defined]
    with wave.open(str(tmp), "rb") as r:
        rate = r.getframerate()
        a = array.array("h", r.readframes(r.getnframes()))
    tmp.unlink(missing_ok=True)
    return rate, a


def _post(url: str, headers: dict, body: dict) -> bytes:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json", **headers}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:  # noqa: S310 — fixed https provider URLs
            return r.read(200 * 1024 * 1024)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{url.split('/')[2]} answered {e.code}: {e.read(400).decode('utf-8', 'replace')}") from None


def openai_engine(voice: str, text: str, model: str = "") -> tuple[int, array.array]:
    raw = _post("https://api.openai.com/v1/audio/speech", {"authorization": f"Bearer {os.environ.get('CHAT_VIEWER_TTS_KEY', '')}"},
                {"model": model or "gpt-4o-mini-tts", "voice": voice or "alloy", "input": text[:4000], "response_format": "pcm"})
    return 24000, array.array("h", raw[: len(raw) // 2 * 2])


def elevenlabs_engine(voice: str, text: str, model: str = "") -> tuple[int, array.array]:
    raw = _post(f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=pcm_22050", {"xi-api-key": os.environ.get("CHAT_VIEWER_TTS_KEY", "")},
                {"text": text[:5000], "model_id": model or "eleven_multilingual_v2"})
    return 22050, array.array("h", raw[: len(raw) // 2 * 2])


def render(job: dict) -> dict:
    engine = job.get("engine") or "piper"
    fn = {"tone": tone_engine, "piper": piper_engine, "openai": openai_engine, "elevenlabs": elevenlabs_engine}.get(engine)
    if not fn:
        return {"ok": False, "error": f"unknown engine {engine}"}
    voices = job.get("voices") or {}
    turns = job.get("turns") or []
    pause_ms = max(0, min(5000, int(job.get("pauseMs", 450))))
    model = str(job.get("model") or "")
    rate = 0
    track = array.array("h")
    offsets: list[float] = []
    for i, t in enumerate(turns):
        voice = str(voices.get(t.get("role"), voices.get("assistant", "")))
        r, samples = fn(voice, t["text"], model) if engine in ("openai", "elevenlabs") else fn(voice, t["text"])
        if not rate:
            rate = r
        samples = resample(samples, r, rate)
        if track:
            track.extend(array.array("h", bytes(2 * int(rate * pause_ms / 1000))))
        offsets.append(len(track) / rate)
        track.extend(samples)
        emit({"progress": i + 1, "total": len(turns)})
    rate = rate or 22050
    out = Path(job["out"])
    out.parent.mkdir(parents=True, exist_ok=True)
    fmt = job.get("format") or "mp3"
    if fmt == "mp3":
        try:
            import lameenc  # type: ignore
            enc = lameenc.Encoder()
            enc.set_bit_rate(64)
            enc.set_in_sample_rate(rate)
            enc.set_channels(1)
            enc.set_quality(5)
            data = enc.encode(track.tobytes()) + enc.flush()
            path = out.with_suffix(".mp3")
            path.write_bytes(data)
            return {"ok": True, "file": str(path), "format": "mp3", "duration": len(track) / rate, "offsets": offsets, "rate": rate}
        except ImportError:
            fmt = "wav"  # no encoder in this python: plain WAV instead
    path = out.with_suffix(".wav")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(track.tobytes())
    return {"ok": True, "file": str(path), "format": "wav", "duration": len(track) / rate, "offsets": offsets, "rate": rate}


def main() -> None:
    try:
        job = json.loads(Path(sys.argv[1]).read_text())
        emit(render(job))
    except Exception as e:  # noqa: BLE001 — the parent shows the reason
        emit({"ok": False, "error": f"{type(e).__name__}: {e}"[:600]})
        sys.exit(1)


if __name__ == "__main__":
    main()
