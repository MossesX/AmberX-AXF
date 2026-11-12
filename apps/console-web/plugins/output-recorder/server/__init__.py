"""Audio Output Recorder, server part: the automatic transcripts (transcripts.py). Mounted at /api/plugins/output-recorder/.

  GET  status   the worker: on/off, what's waiting, the last one done, what failed
  POST run      look now instead of at the next round

Recordings on the console (s7, contract C25–C30; recordings.py):
  PUT    recordings/{id}/parts/{n}      one audio-part@1 from the phone → {ok, n, sha256} (idempotent)
  PUT    recordings/{id}                the audio-recording@1 index → {ok, confirmed, missing[]}
  GET    recordings?since=&limit=       every recording, newest first; GET recordings/{id} → index + transcript
  GET    recordings/{id}/audio          the parts joined (Range honoured)
  DELETE recordings/{id}?confirm=       two-step: the first call answers 409 confirmation_required with a token
  POST   recordings/{id}/transcribe     transcribe it next (clears its failed tries)
  POST   recordings/act/start {session, mic?} · POST recordings/act/stop   the phone's recorder, through axHub's
                                        amberx.recorder_start / _stop (start is an axHub approval, never automatic)
  GET    device/status · POST device/status {on, since, session, file, uploadedParts, queue}   what the phone last said
  GET    settings · PUT settings {autoTranscribe?, listLimit?}

The recording itself stays on the phone and the hub; the transcripts are written beside the recordings on the hub, so
AmberX and the console read them the same way. Setting: Claude setting `recording.transcribe`. A missing engine or a
failed chunk shows on the systems check (health@1).
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response

import console_context as cx
import plugin_services

from . import recordings as R
from . import transcripts as T

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
HEALTH_ID = "session-transcripts"
ROUND_S = 90.0
_wake = threading.Event()
_lock = threading.Lock()
_health_done = False


def data_dir() -> Path:
    return Path(os.environ.get("AXF_OUTPUT_RECORDER_DIR") or (cx.ROOT / ".axf-console" / "plugins" / FOLDER))


def hub_root() -> Path:
    exact = os.environ.get("AXF_RECORDINGS_ROOT")
    if exact:
        return Path(exact)
    root = cx.persist_root()
    return root.parent if root else Path("/projects")


def base() -> Path:
    return T.folder(hub_root(), os.environ.get("AXF_RECORDINGS_PROJECT") or T.DEFAULT_PROJECT)


def _state_file() -> Path:
    return data_dir() / "transcribe.json"


def load_state() -> dict[str, Any]:
    return T.read_json(_state_file()) or {"failed": {}}


def save_state(st: dict[str, Any]) -> None:
    data_dir().mkdir(parents=True, exist_ok=True)
    tmp = _state_file().with_suffix(".tmp")
    tmp.write_text(json.dumps(st))
    os.replace(tmp, _state_file())


def enabled() -> bool:
    if not read_settings()["autoTranscribe"]:
        return False
    svc = plugin_services.get("axf.claude-settings@1")
    if svc is None:
        return True
    try:
        return next((s.get("value") for s in svc.get().get("settings") or [] if s.get("key") == "recording.transcribe"), True) is not False
    except Exception:  # noqa: BLE001 — default on
        return True


def tick() -> str:
    """One round: at most one chunk."""
    if not enabled():
        return "off"
    if not T.available():
        return "no-engine"
    with _lock:
        st = load_state()
        r = T.run_once(base(), st, data_dir() / "models")
        save_state(st)
    return r


def _loop() -> None:
    while True:
        r = ""
        try:
            if cx.plugin_enabled(FOLDER):
                r = tick()
        except Exception as e:  # noqa: BLE001 — the worker never takes the console down
            cx.log("output-recorder", f"transcripts: {str(e)[:200]}", "warn")
        if r != "done":  # a backlog runs straight on, one at a time
            _wake.wait(ROUND_S)
            _wake.clear()
        else:
            time.sleep(2)


@router.get("/status")
def status() -> dict[str, Any]:
    st = load_state()
    return {"on": enabled(), "engine": T.available(), "model": T.MODEL, "waiting": len(T.pending(base(), st.get("failed") or {})), "last": st.get("last"),
            "note": st.get("note", ""), "failed": [{"id": k, **v} for k, v in (st.get("failed") or {}).items()][:20]}


@router.post("/run")
def run_now() -> dict[str, Any]:
    _wake.set()
    return {"ok": True}


def health_probe() -> dict[str, Any]:
    st = status()
    if not st["on"]:
        return {"status": "ok", "summary": "Transcripts are switched off (Settings → Plugins → Claude)."}
    if not st["engine"]:
        return {"status": "error", "summary": "The transcription engine isn't installed, so session recordings aren't being transcribed.",
                "details": ["faster-whisper is missing from the console image: redeploy it."]}
    dead = [f for f in st["failed"] if int(f.get("tries", 0)) >= T.MAX_TRIES]
    if dead:
        return {"status": "warn", "summary": f"{len(dead)} recording part(s) couldn't be transcribed.", "details": [f"{f.get('name') or f['id']}: {f.get('error', '')}" for f in dead[:10]]}
    return {"status": "ok", "summary": f"Transcripts running: {st['waiting']} part(s) waiting."}


def ensure_health() -> bool:
    global _health_done
    if _health_done:
        return True
    reg = plugin_services.get("axf.health@1")
    if reg is None:
        return False
    try:
        reg.register({"id": HEALTH_ID, "label": "Session transcripts", "service": "console", "order": 63, "severity": "warn", "run": health_probe,
                      "breaks": "Session recordings stay on axHub without a transcript, so they can't be searched.",
                      "instructions": ["Open Audio Output Recorder to see which recordings have a transcript.",
                                       "`GET /api/plugins/output-recorder/status` says what is waiting and what failed; POST `run` looks again now."]}, FOLDER)
    except Exception:  # noqa: BLE001 — recording works without its health item
        return False
    _health_done = True
    return True


def _register_later(tries: int = 12) -> None:
    if not ensure_health() and tries > 1:
        t = threading.Timer(5.0, _register_later, args=(tries - 1,))
        t.daemon = True
        t.start()


if not os.environ.get("AXF_OUTPUT_RECORDER_NO_WORKER"):
    threading.Thread(target=_loop, name="output-recorder-transcripts", daemon=True).start()
    _register_later()


# ---- recordings on the console (s7) ----

SETTINGS_DEFAULTS: dict[str, Any] = {"autoTranscribe": True, "listLimit": 50}
HUB_TOOLS = {"start": "amberx.recorder_start", "stop": "amberx.recorder_stop"}


def read_settings() -> dict[str, Any]:
    out = dict(SETTINGS_DEFAULTS)
    saved = T.read_json(data_dir() / "settings.json") or {}
    if isinstance(saved.get("autoTranscribe"), bool):
        out["autoTranscribe"] = saved["autoTranscribe"]
    v = saved.get("listLimit")
    if isinstance(v, int) and not isinstance(v, bool) and 10 <= v <= 500:
        out["listLimit"] = v
    return out


def _secret() -> str:
    p = data_dir() / "confirm.key"
    try:
        return p.read_text().strip()
    except OSError:
        data_dir().mkdir(parents=True, exist_ok=True)
        key = os.urandom(24).hex()
        p.write_text(key)
        os.chmod(p, 0o600)
        return key


def _bad(e: Exception) -> HTTPException:
    return HTTPException(400, str(e))


async def _json(request: Request, cap: int = R.PART_MAX_B64 + 4096) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > cap:
        raise HTTPException(413, f"at most {cap} bytes")
    try:
        b = json.loads(raw or b"{}")
    except ValueError as e:
        raise HTTPException(400, "send JSON") from e
    if not isinstance(b, dict):
        raise HTTPException(400, "send a JSON object")
    return b


@router.put("/recordings/{rid}/parts/{n}")
async def put_part(rid: str, n: int, request: Request) -> dict[str, Any]:
    body = await _json(request)
    try:
        return await run_in_threadpool(R.put_part, base(), rid, n, body)
    except R.Bad as e:
        raise _bad(e) from e


@router.put("/recordings/{rid}")
async def put_index(rid: str, request: Request) -> dict[str, Any]:
    body = await _json(request, 16 * 1024)
    try:
        r = await run_in_threadpool(R.put_index, base(), rid, body)
    except R.Bad as e:
        raise _bad(e) from e
    if r["confirmed"]:
        _wake.set()
    return r


@router.get("/recordings")
def list_recordings(since: str = "", limit: int = 0) -> dict[str, Any]:
    return R.listing(base(), since[:40], limit or read_settings()["listLimit"])


@router.get("/recordings/{rid}")
def get_recording(rid: str) -> dict[str, Any]:
    try:
        r = R.one(base(), rid)
    except R.Bad as e:
        raise _bad(e) from e
    if r is None:
        raise HTTPException(404, f"no recording {rid}")
    return r


@router.get("/recordings/{rid}/audio")
def get_audio(rid: str, request: Request) -> Response:
    try:
        got = R.audio(base(), rid)
    except R.Bad as e:
        raise _bad(e) from e
    if got is None:
        raise HTTPException(404, f"no audio for {rid} (unknown, deleted or still uploading)")
    data, mime = got
    rng = request.headers.get("range", "")
    if rng:
        span = R.byte_range(rng, len(data))
        if span is None:
            return Response(status_code=416, headers={"content-range": f"bytes */{len(data)}"})
        a, b = span
        return Response(data[a:b + 1], status_code=206, media_type=mime, headers={"content-range": f"bytes {a}-{b}/{len(data)}", "accept-ranges": "bytes"})
    return Response(data, media_type=mime, headers={"accept-ranges": "bytes"})


@router.delete("/recordings/{rid}")
def delete_recording(rid: str, confirm: str = "") -> JSONResponse:
    try:
        r = R.one(base(), rid)
    except R.Bad as e:
        raise _bad(e) from e
    if r is None:
        raise HTTPException(404, f"no recording {rid}")
    if not confirm or not R.confirm_ok(_secret(), rid, confirm):
        name = r["recording"].get("name") or rid
        return JSONResponse({"ok": False, "code": "confirmation_required", "message": f"Delete the recording {name}? Its audio and transcript go for good. Repeat with confirm.",
                             "confirm": R.confirm_token(_secret(), rid), "irreversible": True}, status_code=409)
    return JSONResponse(R.remove(base(), rid))


@router.post("/recordings/{rid}/transcribe")
def transcribe(rid: str) -> dict[str, Any]:
    try:
        r = R.one(base(), rid)
    except R.Bad as e:
        raise _bad(e) from e
    if r is None:
        raise HTTPException(404, f"no recording {rid}")
    with _lock:
        st = load_state()
        (st.get("failed") or {}).pop(rid, None)
        save_state(st)
    _wake.set()
    return {"ok": True, "id": rid, "queued": r["transcript"] is None, "note": "" if read_settings()["autoTranscribe"] else "automatic transcripts are off in this plugin's settings: it waits until they are on"}


def _hub_tool(tool: str, args: dict[str, Any], reason: dict[str, str]) -> dict[str, Any]:
    """One axHub tool call (the console's AXHUB_TOKEN, https only); the hub's own veto and approvals apply."""
    import uuid

    from axf_server import http as axf_http, hub_session

    url = (os.environ.get("AXHUB_URL") or "https://axhub.amberxai.com").rstrip("/")
    tok = os.environ.get("AXHUB_TOKEN", "")
    if not tok or not url.startswith("https://"):
        return {"ok": False, "message": "axHub isn't connected (AXHUB_TOKEN and an https AXHUB_URL), so the phone can't be reached"}

    def rpc(sid: str | None, method: str, params: dict[str, Any], timeout: float) -> tuple[dict[str, Any], str | None]:
        headers = {"authorization": f"Bearer {tok}", "content-type": "application/json", "accept": "application/json, text/event-stream", **hub_session.headers()}
        if sid:
            headers["mcp-session-id"] = sid
        r = axf_http.request("POST", f"{url}/mcp", headers=headers, body=json.dumps({"jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": method, "params": params}).encode(),
                             timeout=timeout, max_bytes=200_000, truncate=True)
        if not r.ok:
            raise RuntimeError(f"axHub answered {r.status}")
        raw = r.text()
        msgs = [json.loads(ln[5:].strip()) for ln in raw.splitlines() if ln.startswith("data:") and ln[5:].strip()] if "text/event-stream" in r.headers.get("content-type", "") else [json.loads(raw or "{}")]
        msg = next((m for m in reversed(msgs) if "result" in m or "error" in m), {})
        if "error" in msg:
            raise RuntimeError(str(msg["error"].get("message", "axHub error"))[:300])
        return msg.get("result") or {}, r.headers.get("mcp-session-id") or sid

    try:
        _, sid = rpc(None, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "axf-console-recorder", "version": "1"}}, 15)
        res, _ = rpc(sid, "tools/call", {"name": "call", "arguments": {"tool": tool, "arguments": args, "reason": reason, "timeout_seconds": 30}}, 60)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "message": f"couldn't reach axHub: {str(e)[:200]}"}
    text = "\n".join(c.get("text", "") for c in res.get("content", []) if isinstance(c, dict))
    return {"ok": not res.get("isError"), "answer": text[:2000]}


@router.post("/recordings/act/{verb}")
async def recorder_act(verb: str, request: Request) -> dict[str, Any]:
    if verb not in HUB_TOOLS:
        raise HTTPException(404, "start or stop")
    b = await _json(request, 4096)
    args: dict[str, Any] = {}
    if verb == "start":
        session = b.get("session")
        if not isinstance(session, str) or not session.strip():
            raise HTTPException(400, "send { session, mic? }: what the recording is for")
        args = {"session": session.strip()[:80], **({"mic": bool(b["mic"])} if "mic" in b else {})}
    reason = {"title": f"{'Start' if verb == 'start' else 'Stop'} recording on Brett's phone",
              "description": str(b.get("reason") or (f"Record the phone's audio for {args.get('session')}" if verb == "start" else "Stop the phone's recorder"))[:300]}
    r = await run_in_threadpool(_hub_tool, HUB_TOOLS[verb], args, reason)
    return {**r, "verb": verb, **({"note": "axHub asks Brett first; the phone then asks for its own Android consent"} if verb == "start" else {})}


@router.get("/device/status")
def device_status() -> dict[str, Any]:
    st = T.read_json(data_dir() / "device.json")
    return {"ok": True, "known": st is not None, **(st or {"on": False})}


@router.post("/device/status")
async def post_device_status(request: Request) -> dict[str, Any]:
    b = await _json(request, 8192)
    keep = {k: b[k] for k in ("on", "since", "session", "file", "uploadedParts", "queue", "mic", "device") if k in b and isinstance(b[k], (bool, int, float, str, type(None)))}
    keep["at"] = int(time.time() * 1000)
    data_dir().mkdir(parents=True, exist_ok=True)
    tmp = data_dir() / f".device-{os.getpid()}"
    tmp.write_text(json.dumps(keep))
    os.replace(tmp, data_dir() / "device.json")
    return {"ok": True, **keep}


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return {"ok": True, "settings": read_settings(), "defaults": SETTINGS_DEFAULTS}


@router.put("/settings")
async def put_settings(request: Request) -> dict[str, Any]:
    b = await _json(request, 4096)
    if not b:
        raise HTTPException(400, "send { autoTranscribe?: true|false, listLimit?: 10-500 }")
    for k, v in b.items():
        if k == "autoTranscribe" and isinstance(v, bool):
            continue
        if k == "listLimit" and isinstance(v, int) and not isinstance(v, bool) and 10 <= v <= 500:
            continue
        raise HTTPException(400, f"{k}: autoTranscribe is true or false, listLimit a whole number from 10 to 500")
    s = {**read_settings(), **b}
    data_dir().mkdir(parents=True, exist_ok=True)
    tmp = data_dir() / f".settings-{os.getpid()}"
    tmp.write_text(json.dumps(s))
    os.replace(tmp, data_dir() / "settings.json")
    if s["autoTranscribe"]:
        _wake.set()
    return {"ok": True, "settings": s, "changed": sorted(b)}
