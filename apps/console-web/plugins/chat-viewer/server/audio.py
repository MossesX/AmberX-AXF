"""Audio export: a session (or a range of it) read out by two voices, Brett's and Amber's.

Free by default: Piper (offline neural TTS, CPU only) in its own venv in the plugin's data folder, set up from the
viewer (POST /tts/setup: `python -m venv`, `pip install piper-tts lameenc`, two voice models from Hugging Face
rhasspy/piper-voices). OpenAI or ElevenLabs voices are used instead when chosen and a key is saved (PUT /tts/keys/…,
0600 in the data folder) or set as OPENAI_API_KEY / ELEVENLABS_API_KEY; keys go to the worker in its environment only.

Only spoken and text turns are read (tool calls and results are skipped), code blocks and links are shortened, a short
pause sits between turns, and a chapter starts at every hour of the conversation's clock. Files land on the hub
(<hub data>/chat-viewer/audio/) with a .json sidecar (session, range, voices, duration, chapters).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from . import schema as S

WORKER = Path(__file__).resolve().parent / "tts_worker.py"
HF = "https://huggingface.co/rhasspy/piper-voices/resolve/main"
# Piper voices offered in the viewer (an open list: any rhasspy/piper-voices id works in settings).
PIPER_VOICES = [
    {"id": "en_US-ryan-medium", "label": "Ryan (US, male)", "gender": "male"},
    {"id": "en_US-joe-medium", "label": "Joe (US, male)", "gender": "male"},
    {"id": "en_US-hfc_male-medium", "label": "HFC male (US)", "gender": "male"},
    {"id": "en_GB-alan-medium", "label": "Alan (UK, male)", "gender": "male"},
    {"id": "en_US-amy-medium", "label": "Amy (US, female)", "gender": "female"},
    {"id": "en_US-lessac-medium", "label": "Lessac (US, female)", "gender": "female"},
    {"id": "en_US-hfc_female-medium", "label": "HFC female (US)", "gender": "female"},
    {"id": "en_GB-jenny_dioco-medium", "label": "Jenny (UK, female)", "gender": "female"},
]
VOICE_ID = re.compile(r"^[a-z]{2}_[A-Z]{2}-[a-z0-9_]+-(x_low|low|medium|high)$")
OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"]
ENV_KEYS = {"openai": "OPENAI_API_KEY", "elevenlabs": "ELEVENLABS_API_KEY"}
ENGINES = ("piper", "openai", "elevenlabs", "tone")
MAX_TURN = 3000

_CODE = re.compile(r"```[\s\S]*?```")
_INLINE = re.compile(r"`([^`]{1,80})`")
_URL = re.compile(r"https?://\S+")
_MD = re.compile(r"[*_#>|~]+")
_REDACTED = re.compile(r"\[redacted:[a-z-]+\]")


def speech_text(text: str) -> str:
    """What a voice reads: no code blocks, links or markdown marks; one line."""
    t = _CODE.sub(" (code block skipped) ", text or "")
    t = _INLINE.sub(r"\1", t)
    t = _URL.sub(" link ", t)
    t = _REDACTED.sub(" redacted ", t)
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", t)
    t = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", t)
    t = _MD.sub(" ", t)
    t = re.sub(r"\s+", " ", t).strip()
    if len(t) > MAX_TURN:
        t = t[:MAX_TURN].rsplit(" ", 1)[0] + " … the rest of this turn is skipped."
    return t


def pick_turns(messages: list[dict[str, Any]], start: int = 0, end: int | None = None) -> list[dict[str, Any]]:
    """The spoken and text turns between seq start (inclusive) and end (exclusive), tool noise dropped."""
    out = []
    for i, m in enumerate(messages):
        if i < start or (end is not None and i >= end):
            continue
        if m.get("role") not in ("user", "assistant") or m.get("kind") == "tool":
            continue
        t = speech_text(m.get("text") or "")
        if t:
            out.append({"role": m["role"], "text": t, "at": m.get("at") or "", "seq": i})
    return out


def _hour_label(at: str) -> str:
    try:
        d = datetime.fromisoformat(at.replace("Z", "+00:00"))
        return d.strftime("%b %-d, %-I %p UTC")
    except ValueError:
        return at


def chapters(turns: list[dict[str, Any]], offsets: list[float]) -> list[dict[str, Any]]:
    """A chapter at the first turn, then at every turn whose clock hour differs from the previous chapter's."""
    out: list[dict[str, Any]] = []
    last = None
    for t, off in zip(turns, offsets):
        hour = t["at"][:13] if t.get("at") else None
        if not out or (hour and hour != last):
            out.append({"title": _hour_label(t["at"]) if hour else "Start", "start": round(off, 2), "seq": t["seq"]})
            last = hour or last
    return out


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:50] or "session"


class Audio:
    def __init__(self, data_dir: Callable[[], Path], out_dir: Callable[[], Path]):
        self._data = data_dir
        self._out = out_dir
        self.jobs: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._busy = threading.Semaphore(1)  # one render at a time: the VPS has 4 cores and other builds running

    # ------------------------------------------------------------------ paths + status

    def tts_dir(self) -> Path:
        return self._data() / "tts"

    def venv_python(self) -> Path:
        return self.tts_dir() / "venv" / "bin" / "python"

    def voice_path(self, vid: str) -> Path:
        return self.tts_dir() / "voices" / f"{vid}.onnx"

    def piper_ready(self) -> bool:
        py = self.venv_python()
        return py.exists() and any((self.tts_dir() / "venv" / "lib").glob("python*/site-packages/piper"))

    def keys(self) -> dict[str, str]:
        try:
            return json.loads((self._data() / "tts-keys.json").read_text())
        except (OSError, ValueError):
            return {}

    def key_for(self, provider: str) -> str:
        return (self.keys().get(provider) or os.environ.get(ENV_KEYS.get(provider, ""), "")).strip()

    def set_key(self, provider: str, key: str | None) -> None:
        if provider not in ENV_KEYS:
            raise ValueError("provider must be openai or elevenlabs")
        k = self.keys()
        if key:
            k[provider] = key.strip()
        else:
            k.pop(provider, None)
        p = self._data() / "tts-keys.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(k))
        tmp.chmod(0o600)
        tmp.replace(p)

    def status(self) -> dict[str, Any]:
        installed = sorted(p.stem for p in (self.tts_dir() / "voices").glob("*.onnx")) if (self.tts_dir() / "voices").is_dir() else []
        return {"piper": {"ready": self.piper_ready(), "voices": installed}, "catalog": PIPER_VOICES, "openaiVoices": OPENAI_VOICES,
                "keys": {p: bool(self.key_for(p)) for p in ENV_KEYS}, "engines": list(ENGINES[:3]),
                "jobs": sorted(self.jobs.values(), key=lambda j: j["createdAt"], reverse=True)[:20]}

    # ------------------------------------------------------------------ jobs

    def _job(self, kind: str, title: str) -> dict[str, Any]:
        j = {"id": uuid.uuid4().hex[:12], "kind": kind, "title": title, "state": "queued", "progress": 0, "total": 0, "message": "",
             "createdAt": S.now_iso(), "result": None, "error": ""}
        with self._lock:
            self.jobs[j["id"]] = j
            if len(self.jobs) > 60:
                for k in sorted(self.jobs, key=lambda k: self.jobs[k]["createdAt"])[:-60]:
                    self.jobs.pop(k, None)
        return j

    def setup(self, voices: list[str], *, run: Callable[..., Any] = subprocess.run, fetch: Callable[[str, Path], None] | None = None, wait: bool = False) -> dict[str, Any]:
        bad = [v for v in voices if not VOICE_ID.match(v)]
        if bad:
            raise ValueError(f"not a Piper voice id: {', '.join(bad)}")
        j = self._job("setup", "Install Piper + voices")

        def go() -> None:
            j["state"] = "running"
            try:
                d = self.tts_dir()
                d.mkdir(parents=True, exist_ok=True)
                if not self.piper_ready():
                    j["message"] = "Making the Piper venv"
                    run([sys.executable, "-m", "venv", str(d / "venv")], check=True, capture_output=True, timeout=600)
                    j["message"] = "Installing piper-tts and lameenc (a few minutes)"
                    run([str(self.venv_python()), "-m", "pip", "install", "-q", "piper-tts", "lameenc"], check=True, capture_output=True, timeout=1800)
                j["total"] = len(voices)
                for i, v in enumerate(voices):
                    if not self.voice_path(v).exists():
                        j["message"] = f"Downloading voice {v}"
                        (fetch or _download)(v, self.voice_path(v))
                    j["progress"] = i + 1
                j["state"], j["message"] = "done", "Piper is ready"
            except Exception as e:  # noqa: BLE001
                j["state"], j["error"] = "failed", (getattr(e, "stderr", b"") or b"").decode("utf-8", "replace")[-500:] if isinstance(getattr(e, "stderr", None), bytes) else str(e)[:500]
        t = threading.Thread(target=go, daemon=True)
        t.start()
        if wait:
            t.join()
        return j

    def render(self, session: dict[str, Any], opts: dict[str, Any], *, wait: bool = False) -> dict[str, Any]:
        engine = opts.get("engine") or "piper"
        if engine not in ENGINES:
            raise ValueError(f"engine must be one of {', '.join(ENGINES)}")
        start = max(0, int(opts.get("from") or 0))
        end = opts.get("to")
        end = int(end) if end not in (None, "") else None
        turns = pick_turns(session["messages"], start, end)
        if not turns:
            raise ValueError("nothing to read in that range (only tool calls, or empty)")
        voices = dict(opts.get("voices") or {})
        py = sys.executable
        env = {k: v for k, v in os.environ.items() if not k.endswith(("_KEY", "_TOKEN", "_SECRET")) and k not in ("AXF_TOKEN", "GITHUB_TOKEN")}
        if engine == "piper":
            if not self.piper_ready():
                raise ValueError("Piper isn't installed yet: Audio → Set up free voices first")
            missing = [v for v in voices.values() if not self.voice_path(v).exists()]
            if missing:
                raise ValueError(f"voice not downloaded: {', '.join(missing)} (Set up free voices)")
            voices = {r: str(self.voice_path(v)) for r, v in voices.items()}
            py = str(self.venv_python())
        elif engine in ENV_KEYS:
            key = self.key_for(engine)
            if not key:
                raise ValueError(f"no {engine} key saved (Audio → Voices → key) and {ENV_KEYS[engine]} isn't set")
            env["CHAT_VIEWER_TTS_KEY"] = key
            if self.venv_python().exists():
                py = str(self.venv_python())  # has lameenc for mp3
        title = session["title"]
        j = self._job("render", title)
        j["total"] = len(turns)
        stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
        name = f"{_slug(title)}-{stamp}-{j['id'][:4]}"
        out_dir = self._out()
        meta_base = {"$axf": "chat-audio@1", "sessionId": session["id"], "title": title, "range": {"from": start, "to": end}, "engine": engine,
                     "voices": {r: Path(v).stem if engine == "piper" else v for r, v in voices.items()}, "turns": len(turns), "createdAt": S.now_iso()}

        def go() -> None:
            with self._busy:
                j["state"] = "running"
                job_file = self._data() / "tmp" / f"{j['id']}.json"
                try:
                    job_file.parent.mkdir(parents=True, exist_ok=True)
                    job_file.write_text(json.dumps({"engine": engine, "voices": voices, "turns": [{"role": t["role"], "text": t["text"]} for t in turns],
                                                    "pauseMs": int(opts.get("pauseMs") or 450), "out": str(out_dir / name), "format": opts.get("format") or "mp3",
                                                    "model": opts.get("model") or ""}))
                    env["CHAT_VIEWER_TMP"] = str(job_file.parent)
                    p = subprocess.Popen([py, str(WORKER), str(job_file)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
                    result: dict[str, Any] = {}
                    for line in p.stdout or []:
                        try:
                            msg = json.loads(line)
                        except ValueError:
                            continue
                        if "progress" in msg:
                            j["progress"] = msg["progress"]
                        else:
                            result = msg
                    p.wait()
                    if not result.get("ok"):
                        raise RuntimeError(result.get("error") or (p.stderr.read()[-500:] if p.stderr else "the renderer stopped"))
                    f = Path(result["file"])
                    meta = {**meta_base, "file": f.name, "format": result["format"], "duration": round(result["duration"], 2),
                            "chapters": chapters(turns, result["offsets"]), "bytes": f.stat().st_size}
                    f.with_suffix(".json").write_text(json.dumps(meta, indent=1))
                    j["state"], j["result"] = "done", meta
                except Exception as e:  # noqa: BLE001
                    j["state"], j["error"] = "failed", str(e)[:600]
                finally:
                    job_file.unlink(missing_ok=True)
        t = threading.Thread(target=go, daemon=True)
        t.start()
        if wait:
            t.join()
        return j

    def exports(self, session_id: str = "") -> list[dict[str, Any]]:
        d = self._out()
        if not d.is_dir():
            return []
        out = []
        for p in d.glob("*.json"):
            try:
                m = json.loads(p.read_text())
            except (OSError, ValueError):
                continue
            if m.get("$axf") == "chat-audio@1" and (not session_id or m.get("sessionId") == session_id) and (d / m.get("file", "")).is_file():
                out.append(m)
        return sorted(out, key=lambda m: m.get("createdAt", ""), reverse=True)

    def file(self, name: str) -> Path | None:
        if not re.match(r"^[a-z0-9-]+\.(mp3|wav|json)$", name):
            return None
        p = self._out() / name
        return p if p.is_file() else None

    def remove(self, name: str) -> bool:
        p = self.file(name)
        if not p or p.suffix == ".json":
            return False
        p.unlink()
        p.with_suffix(".json").unlink(missing_ok=True)
        return True


def _download(vid: str, dest: Path) -> None:
    lang, rest = vid.split("-", 1)
    name, quality = rest.rsplit("-", 1)
    base = f"{HF}/{lang.split('_')[0]}/{lang}/{name}/{quality}/{vid}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    for suffix in (".onnx.json", ".onnx"):
        tmp = dest.parent / f".{vid}{suffix}.part"
        with urllib.request.urlopen(base + suffix, timeout=600) as r, open(tmp, "wb") as f:  # noqa: S310 — fixed https host
            while chunk := r.read(1 << 20):
                f.write(chunk)
        tmp.replace(dest.parent / f"{vid}{suffix}")
