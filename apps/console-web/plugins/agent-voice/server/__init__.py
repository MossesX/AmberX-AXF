"""Agent voice — server part. Mounted at /api/plugins/agent-voice/ (console token, 404 while disabled); AmberX reaches it
through its server's console forwarder (/api/console/plugins/agent-voice/, hub admins).

What lives here (everything in the plugin's data folder, 0600 files in a 0700 folder):
    GET    /store                         profiles + mic + pronunciations, the agents (axf.agents@1) and which cloud voices are set up
    PUT    /profiles/{agent_id}           save one agent's voice profile (agent-voice@1; the web core normalises it too)
    DELETE /profiles/{agent_id}           forget it
    PUT    /mic                           the Assistant microphone settings
    PUT    /pronunciations                the global pronunciation list
    PUT    /import                        merge an export (profiles + pronunciations)
    GET    /keys                          which cloud providers have a key (never the key)
    PUT    /keys/{provider}   {key}       store a key (tested first unless test=false)
    DELETE /keys/{provider}
    GET    /voices/{provider}             the provider's voices (OpenAI: fixed list; ElevenLabs: the account's voices)
    POST   /tts               {agentId, text, …}  cloud speech → audio/mpeg, only for agents whose profile allows cloud voices

Cloud keys: the stored key first, else OPENAI_API_KEY / ELEVENLABS_API_KEY. They never leave this server.
Spoken audio is cached (hash of provider, voice, model, style, speed, text) up to CACHE_MAX bytes, oldest first out.
Nothing here names another plugin: the agents come from the axf.agents@1 capability, or none.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import Response

import console_context as cx
import plugin_services
import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import storage

router = APIRouter()
_lock = threading.Lock()
SCHEMA = "agent-voice@1"
PROVIDERS = ("openai", "elevenlabs")
ENV_KEYS = {"openai": "OPENAI_API_KEY", "elevenlabs": "ELEVENLABS_API_KEY"}
AGENT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$")
MAX_PROFILE = 64 * 1024
MAX_TEXT = 4096
CACHE_MAX = int(os.environ.get("AXF_AGENT_VOICE_CACHE_MB", "64")) * 1024 * 1024
TIMEOUT = float(os.environ.get("AXF_AGENT_VOICE_TIMEOUT", "45"))
OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"]
OPENAI_MODELS = ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"]
ELEVEN_MODELS = ["eleven_multilingual_v2", "eleven_turbo_v2_5", "eleven_flash_v2_5"]

# Tests swap this for a fake: (url, headers, body bytes | None, method) → (status, content-type, bytes).
def _http(url: str, headers: dict[str, str], body: bytes | None, method: str = "POST") -> tuple[int, str, bytes]:
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:  # noqa: S310 — fixed https provider URLs only
            return r.status, r.headers.get("content-type", ""), r.read(25 * 1024 * 1024)
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("content-type", "") if e.headers else "", e.read(64 * 1024)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return 0, "", str(e).encode()


http = _http


def data_dir() -> Path:
    return Path(os.environ.get("AXF_AGENT_VOICE_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "agent-voice"))


def _store_path() -> Path:
    return data_dir() / "store.json"


def _keys_path() -> Path:
    return data_dir() / "keys.json"


def load_store() -> dict[str, Any]:
    raw = storage.read_json(_store_path(), {})
    if not isinstance(raw, dict):
        raw = {}
    profiles = raw.get("profiles") if isinstance(raw.get("profiles"), dict) else {}
    return {
        "$axf": SCHEMA,
        "profiles": {k: v for k, v in profiles.items() if isinstance(v, dict) and AGENT_ID.match(k)},
        "mic": raw.get("mic") if isinstance(raw.get("mic"), dict) else {},
        "pronunciations": raw.get("pronunciations") if isinstance(raw.get("pronunciations"), list) else [],
    }


def save_store(s: dict[str, Any]) -> None:
    storage.write_json(_store_path(), s, ensure_ascii=False)


def _keys() -> dict[str, str]:
    raw = storage.read_json(_keys_path(), {})
    return {k: v for k, v in (raw.items() if isinstance(raw, dict) else []) if k in PROVIDERS and isinstance(v, str) and v}


def key_for(provider: str) -> str:
    return _keys().get(provider) or (os.environ.get(ENV_KEYS[provider]) or "").strip()


def _agents() -> list[dict[str, Any]]:
    svc = plugin_services.get("axf.agents@1")
    if not svc:
        return []
    try:
        out = []
        for a in svc.list_agents() or []:
            if isinstance(a, dict) and a.get("id"):
                out.append({"id": str(a["id"]), "name": str(a.get("name") or a["id"]), "icon": str(a.get("icon") or ""), "description": str(a.get("description") or "")[:300]})
        return out
    except Exception:  # noqa: BLE001 — the agent manager's problem, not ours
        return []


def _check_agent(agent_id: str) -> str:
    if not AGENT_ID.match(agent_id or ""):
        raise HTTPException(400, "bad agent id")
    return agent_id


def _small(obj: Any, limit: int, what: str) -> Any:
    if len(json.dumps(obj, ensure_ascii=False)) > limit:
        raise HTTPException(413, f"{what} is too big (max {limit // 1024} KB)")
    return obj


# ---------------------------------------------------------------- store

@router.get("/store")
def get_store() -> dict[str, Any]:
    return {"store": load_store(), "agents": _agents(), "agentsService": plugin_services.get("axf.agents@1") is not None,
            "cloud": {p: bool(key_for(p)) for p in PROVIDERS}}


@router.put("/profiles/{agent_id}")
def put_profile(agent_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    _check_agent(agent_id)
    _small(body, MAX_PROFILE, "the profile")
    prof = {**body, "$axf": SCHEMA, "agentId": agent_id, "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    with _lock:
        s = load_store()
        s["profiles"][agent_id] = prof
        save_store(s)
    return {"ok": True, "profile": prof}


@router.delete("/profiles/{agent_id}")
def delete_profile(agent_id: str) -> dict[str, Any]:
    _check_agent(agent_id)
    with _lock:
        s = load_store()
        gone = s["profiles"].pop(agent_id, None) is not None
        save_store(s)
    return {"ok": True, "removed": gone}


@router.put("/mic")
def put_mic(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    _small(body, 8 * 1024, "the mic settings")
    with _lock:
        s = load_store()
        s["mic"] = body
        save_store(s)
    return {"ok": True}


@router.put("/pronunciations")
def put_pronunciations(body: list[Any] = Body(...)) -> dict[str, Any]:
    _small(body, 64 * 1024, "the pronunciation list")
    items = [p for p in body if isinstance(p, dict) and isinstance(p.get("from"), str) and p["from"].strip()][:200]
    with _lock:
        s = load_store()
        s["pronunciations"] = items
        save_store(s)
    return {"ok": True, "count": len(items)}


@router.put("/import")
def put_import(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    _small(body, 1024 * 1024, "the import")
    if body.get("$axf") != SCHEMA:
        raise HTTPException(400, f"that isn't an {SCHEMA} export")
    profiles = body.get("profiles") if isinstance(body.get("profiles"), dict) else {}
    n = 0
    with _lock:
        s = load_store()
        for k, v in profiles.items():
            if AGENT_ID.match(k) and isinstance(v, dict):
                s["profiles"][k] = {**v, "$axf": SCHEMA, "agentId": k}
                n += 1
        have = {str(p.get("from", "")).lower() for p in s["pronunciations"] if isinstance(p, dict)}
        for p in body.get("pronunciations") or []:
            if isinstance(p, dict) and isinstance(p.get("from"), str) and p["from"].lower() not in have:
                s["pronunciations"].append(p)
                have.add(p["from"].lower())
        s["pronunciations"] = s["pronunciations"][:200]
        save_store(s)
    return {"ok": True, "count": n}


# ---------------------------------------------------------------- cloud keys + voices

def _provider(p: str) -> str:
    if p not in PROVIDERS:
        raise HTTPException(404, f"unknown voice provider {p}")
    return p


def _err_text(raw: bytes) -> str:
    try:
        j = json.loads(raw.decode("utf-8", "replace"))
        if isinstance(j, dict):
            e = j.get("error") or j.get("detail") or j
            if isinstance(e, dict):
                e = e.get("message") or e.get("status") or json.dumps(e)[:200]
            return str(e)[:300]
    except ValueError:
        pass
    return raw.decode("utf-8", "replace")[:300]


def list_voices(provider: str, key: str) -> list[dict[str, str]]:
    if provider == "openai":
        return [{"id": v, "name": v.capitalize()} for v in OPENAI_VOICES]
    status, _ct, raw = http("https://api.elevenlabs.io/v1/voices", {"xi-api-key": key, "accept": "application/json"}, None, "GET")
    if status != 200:
        raise HTTPException(400 if status in (401, 403) else 502, f"ElevenLabs: {_err_text(raw) or 'no answer'}")
    data = json.loads(raw or b"{}")
    return [{"id": str(v.get("voice_id")), "name": str(v.get("name") or v.get("voice_id")), "category": str(v.get("category") or "")}
            for v in data.get("voices", []) if isinstance(v, dict) and v.get("voice_id")][:300]


@router.get("/keys")
def get_keys() -> dict[str, Any]:
    stored = _keys()
    return {"providers": [{"id": p, "set": bool(key_for(p)), "stored": p in stored, "env": bool((os.environ.get(ENV_KEYS[p]) or "").strip()), "envName": ENV_KEYS[p]} for p in PROVIDERS]}


@router.put("/keys/{provider}")
def put_key(provider: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    _provider(provider)
    key = str(body.get("key") or "").strip()
    if not key or len(key) > 400 or any(ch.isspace() for ch in key):
        raise HTTPException(400, "paste the whole key (no spaces)")
    if body.get("test", True):
        if provider == "openai":
            status, _ct, raw = http("https://api.openai.com/v1/models", {"authorization": f"Bearer {key}"}, None, "GET")
            if status != 200:
                raise HTTPException(400, f"OpenAI refused the key: {_err_text(raw) or status}")
        else:
            list_voices(provider, key)
    with _lock:
        k = _keys()
        k[provider] = key
        storage.write_json(_keys_path(), k)
    return {"ok": True}


@router.delete("/keys/{provider}")
def delete_key(provider: str) -> dict[str, Any]:
    _provider(provider)
    with _lock:
        k = _keys()
        k.pop(provider, None)
        storage.write_json(_keys_path(), k)
    return {"ok": True}


@router.get("/voices/{provider}")
def get_voices(provider: str) -> dict[str, Any]:
    _provider(provider)
    key = key_for(provider)
    if provider != "openai" and not key:
        raise HTTPException(400, "add an ElevenLabs key first (Agent voice → Cloud voices)")
    return {"voices": list_voices(provider, key), "models": OPENAI_MODELS if provider == "openai" else ELEVEN_MODELS}


# ---------------------------------------------------------------- speech

def _cache_dir() -> Path:
    d = data_dir() / "cache"
    d.mkdir(parents=True, exist_ok=True, mode=0o700)
    return d


def _trim_cache() -> None:
    files = sorted((p for p in _cache_dir().glob("*.mp3")), key=lambda p: p.stat().st_mtime)
    total = sum(p.stat().st_size for p in files)
    while files and total > CACHE_MAX:
        p = files.pop(0)
        total -= p.stat().st_size
        p.unlink(missing_ok=True)


def synth(provider: str, key: str, voice: str, model: str, text: str, style: str, speed: float, stability: float, similarity: float) -> bytes:
    if provider == "openai":
        body: dict[str, Any] = {"model": model if model in OPENAI_MODELS else OPENAI_MODELS[0], "voice": voice if voice in OPENAI_VOICES else "alloy",
                                "input": text, "response_format": "mp3", "speed": max(0.25, min(4.0, speed))}
        if style and body["model"] == "gpt-4o-mini-tts":
            body["instructions"] = style[:600]
        status, ct, raw = http("https://api.openai.com/v1/audio/speech", {"authorization": f"Bearer {key}", "content-type": "application/json"}, json.dumps(body).encode())
    else:
        vid = re.sub(r"[^A-Za-z0-9]", "", voice)[:64]
        if not vid:
            raise HTTPException(400, "pick an ElevenLabs voice")
        body = {"text": text, "model_id": model if model in ELEVEN_MODELS else ELEVEN_MODELS[0],
                "voice_settings": {"stability": max(0.0, min(1.0, stability)), "similarity_boost": max(0.0, min(1.0, similarity)), "speed": max(0.7, min(1.2, speed))}}
        status, ct, raw = http(f"https://api.elevenlabs.io/v1/text-to-speech/{vid}?output_format=mp3_44100_128",
                               {"xi-api-key": key, "content-type": "application/json", "accept": "audio/mpeg"}, json.dumps(body).encode())
    if status != 200 or not raw or "json" in (ct or ""):
        name = "OpenAI" if provider == "openai" else "ElevenLabs"
        raise HTTPException(400 if status in (400, 401, 403, 422) else 502, f"{name}: {_err_text(raw) or 'no answer'}")
    return raw


@router.post("/tts")
def tts(body: dict[str, Any] = Body(...)) -> Response:
    agent_id = _check_agent(str(body.get("agentId") or ""))
    text = str(body.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "nothing to say")
    if len(text) > MAX_TEXT:
        raise HTTPException(413, f"too much to say at once (max {MAX_TEXT} characters)")
    prof = load_store()["profiles"].get(agent_id) or {}
    if not (isinstance(prof.get("permissions"), dict) and prof["permissions"].get("cloud") is True):
        raise HTTPException(403, f"{agent_id} isn't allowed cloud voices (Agent voice → {agent_id} → Permissions → Cloud voices)")
    cloud = prof.get("cloud") if isinstance(prof.get("cloud"), dict) else {}
    provider = str(body.get("provider") or cloud.get("provider") or "openai")
    _provider(provider)
    key = key_for(provider)
    if not key:
        raise HTTPException(400, f"no {provider} key on the server (Agent voice → Cloud voices)")
    voice = str(body.get("voice") or cloud.get("voice") or "")[:120]
    model = str(body.get("model") or cloud.get("model") or "")[:80]
    style = str(body.get("style") if body.get("style") is not None else cloud.get("style") or "")[:600]
    def num(v: Any, d: float) -> float:
        try:
            return float(v)
        except (TypeError, ValueError):
            return d
    speed = num(body.get("rate"), num(prof.get("rate"), 1.0))
    stability = num(cloud.get("stability"), 0.5)
    similarity = num(cloud.get("similarity"), 0.75)
    h = hashlib.sha256(json.dumps([provider, voice, model, style, round(speed, 2), round(stability, 2), round(similarity, 2), text]).encode()).hexdigest()[:40]
    hit = _cache_dir() / f"{h}.mp3"
    if hit.exists():
        os.utime(hit)
        return Response(hit.read_bytes(), media_type="audio/mpeg", headers={"x-agent-voice-cache": "hit"})
    audio = synth(provider, key, voice, model, text, style, speed, stability, similarity)
    with _lock:
        tmp = hit.with_suffix(".tmp")
        tmp.write_bytes(audio)
        os.chmod(tmp, 0o600)
        tmp.replace(hit)
        _trim_cache()
    return Response(audio, media_type="audio/mpeg", headers={"x-agent-voice-cache": "miss"})


@router.delete("/cache")
def clear_cache() -> dict[str, Any]:
    n = 0
    for p in _cache_dir().glob("*.mp3"):
        p.unlink(missing_ok=True)
        n += 1
    return {"ok": True, "removed": n}


@router.get("/check")
def self_check() -> dict[str, Any]:
    """For the systems check / lifecycle checks: the data folder is writable and the store reads."""
    d = data_dir()
    d.mkdir(parents=True, exist_ok=True, mode=0o700)
    s = load_store()
    return {"ok": True, "profiles": len(s["profiles"]), "voiceAgents": sum(1 for p in s["profiles"].values() if p.get("enabled") is True),
            "cloud": {p: bool(key_for(p)) for p in PROVIDERS}}
