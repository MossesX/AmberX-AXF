"""Server part of the Demonstration Designer plugin. Mounted at /api/plugins/demonstration-designer/.

The console adds the console-token check (every method) and the 404 while disabled. Every route runs the plugin's own
Node tools (demos.mjs over engine.mjs + registry.mjs), so the CLI, this API, the MCP tools and the voice commands made
from it (plugin-commands@1) all do the same thing. Demos are demonstration@1 assets in the plugin's data folder;
recordings are clip@1 assets with their files under media/. No model, no tokens.

Routes: GET registry · GET demos · GET demo · POST generate · POST demo · DELETE demo · GET script · POST script ·
POST chain · GET walkthrough · GET share · GET settings · POST settings · GET media · POST media · GET media/file ·
POST export.
Capability demonstrations@1: topics(q), demos(), demo(id), generate(topic, minutes, save), walkthrough(id) for other
plugins (a plugin that wants a pitch of itself asks here).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse

import plugin_services

router = APIRouter()
HERE = Path(__file__).resolve().parents[1]
ROOT = Path(__file__).resolve().parents[5]  # the repo root (/axf in the console image)
DEMOS = HERE / "demos.mjs"
SELF = "demonstrations@1"
_SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,47}$")
_SAFE_TOPIC = re.compile(r"^[a-z][a-z0-9-]*:[^\s/\\]{1,200}$")
_MEDIA_NAME = re.compile(r"^[a-z0-9][a-z0-9-]*-\d{8}T\d{6}\.(webm|mp4|mkv|weba)$")
_MIMES = {".webm": "video/webm", ".mp4": "video/mp4", ".mkv": "video/x-matroska", ".weba": "audio/webm"}
_MAX_UPLOAD = 400 * 1024 * 1024


def data_dir() -> Path:
    return Path(os.environ.get("AXF_DEMO_DESIGNER_DIR") or (ROOT / ".axf-console" / "plugins" / "demonstration-designer"))


def _run(*args: str, timeout: int = 120) -> tuple[int, str, str]:
    env = {**os.environ, "AXF_REPO_ROOT": str(ROOT), "AXF_DEMO_DESIGNER_DIR": str(data_dir())}
    p = subprocess.run(["node", str(DEMOS), *args], cwd=str(ROOT), capture_output=True, text=True, timeout=timeout, env=env)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def _node_json(*args: str, timeout: int = 120) -> Any:
    """Run demos.mjs with --json and answer its JSON; its error line becomes the HTTP error."""
    try:
        code, out, err = _run(*args, "--json", timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise HTTPException(503, f"the demonstration tools didn't answer: {type(e).__name__}") from e
    if code != 0:
        msg = (err or out or "the demonstration tool failed").splitlines()[-1][-400:].replace("demos: ", "")
        raise HTTPException(404 if code == 2 else 400 if code == 1 else 500, msg)
    try:
        return json.loads(out.splitlines()[-1]) if out else None
    except json.JSONDecodeError:
        raise HTTPException(500, f"the demonstration tool answered no JSON: {out[-200:]}")


def _check_id(i: str) -> str:
    if not _SAFE_ID.match(i or ""):
        raise HTTPException(400, "id must be lowercase letters, digits and dashes (2 to 48)")
    return i


def _tmp_json(value: Any, suffix: str = ".json") -> Path:
    """The Node tools take an asset or a script from a file: write it beside the store (never in git)."""
    d = data_dir() / "tmp"
    d.mkdir(parents=True, exist_ok=True)
    f = d / f"in-{os.getpid()}-{threading.get_ident()}{suffix}"
    f.write_text(value if isinstance(value, str) else json.dumps(value))
    return f


# ---------------- topics (the registry) ----------------


@router.get("/registry")
def get_registry(q: str = "", kind: str = "") -> dict[str, Any]:
    """What can be pitched: every plugin, screen and UI element the repo registers, with the words the script is made from."""
    args = ["topics"]
    if kind:
        args += ["--kind", kind[:20]]
    if q:
        args += ["--q", q[:120]]
    return {"items": _node_json(*args) or []}


# ---------------- demos ----------------


@router.get("/demos")
def get_demos() -> dict[str, Any]:
    """Every saved pitch demo: name, steps, running time, topic, narrator, chain, recordings."""
    return {"items": _node_json("list") or []}


@router.get("/demo")
def get_demo(id: str) -> dict[str, Any]:  # noqa: A002 - the query parameter is called id
    """One demo: its demonstration@1 asset plus its pitch facts (length, topic, product, call to action)."""
    return _node_json("get", _check_id(id))


@router.post("/generate")
def post_generate(body: dict[str, Any] | None = None) -> dict[str, Any]:
    """Write the pitch script of a topic (zero tokens): hook, the best screens, call to action, fitted to the minutes asked."""
    b = body or {}
    topic = str(b.get("topic") or "").strip()
    if not _SAFE_TOPIC.match(topic):
        raise HTTPException(400, "topic is a registry id such as plugin:ui-review or screen:home")
    args = ["generate", topic]
    if b.get("minutes") is not None:
        try:
            minutes = int(b["minutes"])
        except (TypeError, ValueError):
            raise HTTPException(400, "minutes must be a whole number 1 to 30")
        if not 1 <= minutes <= 30:
            raise HTTPException(400, "minutes must be 1 to 30")
        args += ["--minutes", str(minutes)]
    if b.get("voice") is not None:
        args += ["--voice", str(b["voice"])[:120]]
    if b.get("speed") is not None:
        args += ["--speed", str(float(b["speed"]))]
    if b.get("save", True):
        args.append("--save")
    if b.get("build"):
        args += ["--build", str(b["build"])[:120]]
    return _node_json(*args)


@router.post("/demo")
def post_demo(body: dict[str, Any]) -> dict[str, Any]:
    """Save a demo (the asset@1 object with its data, optionally its pitch facts), validated against demonstration@1."""
    asset = body.get("asset", body)
    if not isinstance(asset, dict) or not isinstance(asset.get("data"), dict):
        raise HTTPException(400, "asset must be the asset@1 object with its data")
    f = _tmp_json(asset)
    try:
        return _node_json("save", str(f))
    finally:
        f.unlink(missing_ok=True)


@router.delete("/demo")
def delete_demo(id: str) -> dict[str, Any]:  # noqa: A002
    """Remove a demo (its recordings stay as clips)."""
    code, out, err = _run("delete", _check_id(id))
    if code != 0:
        raise HTTPException(400, (err or out)[-300:])
    return {"removed": "removed" in out, "id": id}


@router.get("/script", response_class=PlainTextResponse)
def get_script(id: str) -> str:  # noqa: A002
    """The demo's script as plain text: one block per step, '# Title' then the words."""
    code, out, err = _run("script", _check_id(id))
    if code != 0:
        raise HTTPException(404 if code == 2 else 400, (err or out)[-300:].replace("demos: ", ""))
    return out + "\n"


@router.post("/script")
def post_script(body: dict[str, Any]) -> dict[str, Any]:
    """Apply a tweaked script: the text (blocks split on blank lines) becomes the steps' words; actions and targets stay."""
    demo_id = _check_id(str(body.get("id") or ""))
    text = body.get("text")
    if not isinstance(text, str) or not text.strip():
        raise HTTPException(400, "text is the script, one block per step")
    f = _tmp_json(text[:60000], ".txt")
    try:
        return _node_json("script", demo_id, "--text", str(f))
    finally:
        f.unlink(missing_ok=True)


@router.post("/chain")
def post_chain(body: dict[str, Any]) -> dict[str, Any]:
    """Set the demos played after this one (a tour): chain = list of demo ids, empty to clear."""
    demo_id = _check_id(str(body.get("id") or ""))
    chain = body.get("chain", [])
    if isinstance(chain, str):
        chain = [c for c in chain.split(",") if c.strip()]
    if not isinstance(chain, list):
        raise HTTPException(400, "chain is a list of demo ids")
    return _node_json("chain", demo_id, ",".join(_check_id(str(c).strip()) for c in chain))


@router.get("/walkthrough")
def get_walkthrough(id: str) -> dict[str, Any]:  # noqa: A002
    """The demo and its chain as one walkthrough@1 (what the stage, Molly's guide and the recorder play)."""
    return _node_json("walkthrough", _check_id(id))


@router.get("/share")
def get_share(id: str, request: Request) -> dict[str, Any]:  # noqa: A002
    """The deep link that opens the designer on this demo (and the one that plays it at once)."""
    origin = str(request.headers.get("origin") or "").strip()
    args = ["share", _check_id(id)]
    if origin.startswith("https://") or origin.startswith("http://"):
        args += ["--origin", origin[:200]]
    return _node_json(*args)


# ---------------- settings (pitch-settings@1) ----------------


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    """Every setting of the designer: script, narration, stage, music, export, advanced."""
    return _node_json("settings")


@router.post("/settings")
def post_settings(body: dict[str, Any] | None = None) -> dict[str, Any]:
    """Change settings: either { section: { key: value } } or { key: 'section.key', value }. Unknown keys are dropped."""
    b = body or {}
    if "key" in b:
        key = str(b.get("key") or "")
        if not re.match(r"^[a-z]+\.[a-zA-Z]+$", key):
            raise HTTPException(400, "key is section.key, e.g. music.volume")
        return _node_json("settings", "set", key, json.dumps(b.get("value")) if not isinstance(b.get("value"), str) else b["value"])
    patch = {k: v for k, v in b.items() if isinstance(v, dict)}
    if not patch:
        raise HTTPException(400, "give { section: { key: value } } or { key, value }")
    out: dict[str, Any] | None = None
    for sec, vals in patch.items():
        for k, v in vals.items():
            if not re.match(r"^[a-zA-Z]+$", f"{k}") or not re.match(r"^[a-z]+$", sec):
                raise HTTPException(400, f"bad setting {sec}.{k}")
            out = _node_json("settings", "set", f"{sec}.{k}", v if isinstance(v, str) else json.dumps(v))
    return out or _node_json("settings")


# ---------------- recordings ----------------


@router.get("/media")
def get_media() -> dict[str, Any]:
    """Every recording kept (clip@1): the demo it shows, its file, seconds, whether an MP4 exists."""
    return {"items": _node_json("media") or []}


@router.post("/media")
async def post_media(request: Request, id: str, seconds: float = 0, mime: str = "video/webm") -> dict[str, Any]:  # noqa: A002
    """Upload a recording the stage made (raw video bytes in the body): kept under media/, registered as a clip, MP4 made when ffmpeg is here."""
    demo_id = _check_id(id)
    ext = {"video/webm": ".webm", "video/mp4": ".mp4", "video/x-matroska": ".mkv"}.get(mime.split(";")[0].strip())
    if not ext:
        raise HTTPException(400, "mime must be video/webm, video/mp4 or video/x-matroska")
    body = await request.body()
    if not body or len(body) > _MAX_UPLOAD:
        raise HTTPException(400, "the recording is empty or over 400 MB")
    d = data_dir() / "tmp"
    d.mkdir(parents=True, exist_ok=True)
    f = d / f"up-{os.getpid()}-{threading.get_ident()}{ext}"
    f.write_bytes(body)
    try:
        r = _node_json("media", "add", demo_id, str(f), "--seconds", str(max(0.0, float(seconds))), "--mime", mime.split(";")[0].strip())
    finally:
        f.unlink(missing_ok=True)
    settings = _node_json("settings")
    if settings.get("export", {}).get("transcode") and ext != ".mp4" and r and r.get("clip"):
        try:
            x = _node_json("media", "export", r["clip"], timeout=600)
            r["mp4"] = Path(x["mp4"]).name
        except HTTPException as e:
            r["mp4"] = ""
            r["note"] = e.detail
    return r


@router.get("/media/file")
def get_media_file(name: str) -> FileResponse:
    """One recording file by name (media/<demo>-<stamp>.<ext>)."""
    n = Path(name).name
    if not _MEDIA_NAME.match(n):
        raise HTTPException(400, "not a recording name")
    f = (data_dir() / "media" / n).resolve()
    if (data_dir() / "media").resolve() not in f.parents or not f.is_file():
        raise HTTPException(404, f"no recording {n}")
    return FileResponse(str(f), media_type=_MIMES.get(f.suffix, "application/octet-stream"), filename=n)


@router.post("/export")
def post_export(body: dict[str, Any]) -> dict[str, Any]:
    """Make the MP4 of a recording (clip id) with the server's ffmpeg; says so when there is none."""
    clip = _check_id(str(body.get("clip") or ""))
    return _node_json("media", "export", clip, timeout=600)


class Service:
    """demonstrations@1 for other plugins: topics, demos, one demo, generate, walkthrough."""

    def topics(self, q: str = "", kind: str = "") -> list[dict[str, Any]]:
        return get_registry(q, kind)["items"]

    def demos(self) -> list[dict[str, Any]]:
        return get_demos()["items"]

    def demo(self, demo_id: str) -> dict[str, Any]:
        return get_demo(demo_id)

    def generate(self, topic: str, minutes: int | None = None, save: bool = True) -> dict[str, Any]:
        return post_generate({"topic": topic, "minutes": minutes, "save": save})

    def walkthrough(self, demo_id: str) -> dict[str, Any]:
        return get_walkthrough(demo_id)


plugin_services.provide(SELF, Service(), HERE.name)
