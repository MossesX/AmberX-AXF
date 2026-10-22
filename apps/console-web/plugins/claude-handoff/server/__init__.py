"""Server part of the Claude handoff plugin (claude-handoff@1). Mounted at /api/plugins/claude-handoff/.

The kit itself is built by handoff.mjs (same code as the CLI); this part runs it, keeps the plugin's state and the
6-hourly reminder: one developer alert with a fixed key (a repeat overwrites it, never a second one) plus the banner,
cleared when the kit is published or the reminder is dismissed.

Every route needs the console token and answers 404 while the plugin is off (the console adds both). Never on MCP.
Data only in .axf-console/plugins/claude-handoff/ (state, config, claude.ai list, machines, preview).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import console_context as cx

FOLDER = "claude-handoff"
HERE = Path(__file__).resolve().parent.parent
SCRIPT = HERE / "handoff.mjs"
ALERT_KEY = "claude-handoff:refresh"
ALERT_SOURCE = "claude-handoff"
HOST_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,62}$")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
KINDS = {"project", "artifact", "connector", "memory", "style", "other"}
MAX_MACHINE_BYTES = 4_000_000
DEFAULT_CONFIG: dict[str, Any] = {"remindHours": 6, "onlyWhenChanged": False, "autoPublish": False, "context": [], "collectConsole": True}

router = APIRouter()
_lock = threading.Lock()  # one writing action at a time (publish, preview, saves)


def _root() -> Path:
    return Path(os.environ.get("AXF_ROOT") or cx.ROOT).resolve()


def _data() -> Path:
    d = Path(os.environ.get("AXF_HANDOFF_DATA") or (_root() / ".axf-console" / "plugins" / FOLDER))
    d.mkdir(parents=True, exist_ok=True, mode=0o700)
    return d


def _read(p: Path, default: Any) -> Any:
    try:
        return json.loads(p.read_text("utf-8"))
    except Exception:  # noqa: BLE001
        return default


def _write(p: Path, data: Any) -> None:
    p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = p.with_name(f".{p.name}.{os.getpid()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    os.replace(tmp, p)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _state() -> dict[str, Any]:
    s = _read(_data() / "state.json", {})
    return s if isinstance(s, dict) else {}


def _set_state(**kw: Any) -> dict[str, Any]:
    s = {**_state(), **kw}
    _write(_data() / "state.json", s)
    return s


def _config() -> dict[str, Any]:
    c = _read(_data() / "config.json", {})
    out = {**DEFAULT_CONFIG, **(c if isinstance(c, dict) else {})}
    out["remindHours"] = min(48, max(1, int(out.get("remindHours") or 6)))
    return out


def _node(*args: str, timeout: int = 60) -> dict[str, Any]:
    env = {**os.environ, "AXF_ROOT": str(_root()), "AXF_HANDOFF_DATA": str(_data())}
    try:
        r = subprocess.run(["node", str(SCRIPT), *args, "--json"], capture_output=True, text=True, timeout=timeout, env=env, cwd=str(_root()))
    except subprocess.TimeoutExpired as e:
        raise HTTPException(504, f"handoff.mjs {args[0]} took too long") from e
    if r.returncode != 0:
        msg = (r.stderr or r.stdout).strip().splitlines()[-1:] or ["failed"]
        raise HTTPException(502, f"handoff.mjs {args[0]}: {msg[0][:300]}")
    lines = [ln for ln in r.stdout.strip().splitlines() if ln.startswith("{")]
    return json.loads(lines[-1]) if lines else {}


def _collect_console() -> None:
    """The console container's own ~/.claude (its Claude Code terminal tab) counts as a machine, at most every 10 min."""
    if not _config().get("collectConsole", True):
        return
    stamp = _data() / "machines" / "console.json"
    if stamp.exists() and time.time() - stamp.stat().st_mtime < 600:
        return
    try:
        _node("collect", "--host", "console", timeout=30)
    except HTTPException as e:
        cx.log("plugins", f"claude handoff: console collect failed: {e.detail}", "warn")


# ---------------- reminder ----------------

def _reminder_view(st: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    every = cfg["remindHours"] * 3600_000
    base = max(int(st.get("lastPublishedAt") or 0), int(st.get("lastRemindedAt") or 0), int(st.get("startedAt") or 0))
    return {"open": bool(st.get("reminderOpen")), "everyHours": cfg["remindHours"], "lastRemindedAt": st.get("lastRemindedAt"), "dueAt": base + every, "reason": st.get("reminderReason", "")}


def check_reminder(now: int | None = None, status: dict[str, Any] | None = None) -> bool:
    """Raise (or overwrite) the one reminder alert when it is due. Returns True when it fired."""
    now = now or _now_ms()
    st = _state()
    if not st.get("startedAt"):
        st = _set_state(startedAt=now)
    cfg = _config()
    if now < _reminder_view(st, cfg)["dueAt"]:
        return False
    try:
        status = status or _node("status")
    except HTTPException:
        status = {}
    current = bool(status.get("current"))
    if cfg.get("onlyWhenChanged") and current:
        _set_state(lastRemindedAt=now)
        return False
    if cfg.get("autoPublish") and not current and os.environ.get("GITHUB_TOKEN"):
        try:
            _publish()
            return False
        except HTTPException as e:
            cx.log("plugins", f"claude handoff: auto publish failed: {e.detail}", "warn")
    n = int((status.get("changes") or {}).get("count") or 0)
    machines = sum(1 for m in status.get("machines", []) if not m.get("inKit"))
    if not status.get("kit"):
        reason = "No handoff kit on GitHub yet."
    elif current:
        reason = "Nothing changed in the repo files; check the claude.ai items and collect from every machine."
    else:
        bits = [f"{n} repo file{'s' if n != 1 else ''} changed"] if n else []
        if machines:
            bits.append(f"{machines} machine{'s' if machines != 1 else ''} sent newer ~/.claude files")
        reason = (", ".join(bits) or "Sources changed") + " since the kit was published."
    cx.raise_alert({"source": ALERT_SOURCE, "key": ALERT_KEY, "severity": "warning", "title": "Refresh the Claude handoff kit",
                    "body": f"{reason} Tools → Claude handoff → Publish keeps the prompt for a new Claude account current.", "link": "view:claude-handoff"})
    _set_state(lastRemindedAt=now, reminderOpen=True, reminderReason=reason)
    return True


def _clear_reminder() -> None:
    _set_state(reminderOpen=False, reminderReason="")
    cx.resolve_alerts([ALERT_KEY])


def _loop() -> None:
    time.sleep(20)
    while True:
        try:
            if cx.plugin_enabled(FOLDER):
                check_reminder()
        except Exception as e:  # noqa: BLE001 — the reminder must never take the console down
            cx.log("plugins", f"claude handoff reminder: {type(e).__name__}: {str(e)[:200]}", "warn")
        time.sleep(300)


if os.environ.get("AXF_HANDOFF_NO_THREAD") != "1":
    threading.Thread(target=_loop, name="claude-handoff-reminder", daemon=True).start()


# ---------------- routes ----------------

def _publish() -> dict[str, Any]:
    if not os.environ.get("GITHUB_TOKEN"):
        raise HTTPException(409, "Publishing needs GITHUB_TOKEN with Contents: write on the repo (Systems check → Keys).")
    with _lock:
        r = _node("publish", timeout=240)
    _set_state(lastPublishedAt=_now_ms(), lastPublishSha=r.get("sha", ""), lastFingerprint=r.get("fingerprint", ""))
    _clear_reminder()
    return r


@router.get("/status")
def get_status() -> dict[str, Any]:
    _collect_console()
    s = _node("status")
    st = _state()
    cfg = _config()
    return {**s, "state": {k: st.get(k) for k in ("lastPublishedAt", "lastPublishSha", "lastAssembledAt")},
            "reminder": _reminder_view(st, cfg), "config": cfg, "canPublish": bool(os.environ.get("GITHUB_TOKEN"))}


@router.post("/publish")
def post_publish() -> dict[str, Any]:
    return _publish()


class AssembleReq(BaseModel):
    publish: bool = True


@router.post("/assemble")
def post_assemble(req: AssembleReq) -> dict[str, Any]:
    """The button: make the kit current on GitHub (when it can), then hand back the prompt for the new account."""
    status = _node("status")
    published: dict[str, Any] | None = None
    note = ""
    if req.publish and not status.get("current"):
        if os.environ.get("GITHUB_TOKEN"):
            published = _publish()
            status = _node("status")
        else:
            note = "The kit on GitHub is out of date and this console has no GITHUB_TOKEN to publish it: the prompt points at the last published kit."
    prompt = (published or {}).get("prompt") or _node("build", "--out", str(_data() / "preview" / "handoff"))["prompt"]
    _set_state(lastAssembledAt=_now_ms())
    return {"prompt": prompt, "current": bool(status.get("current")), "published": published, "note": note, "kit": status.get("kit")}


@router.post("/preview")
def post_preview() -> dict[str, Any]:
    with _lock:
        r = _node("build", "--out", str(_data() / "preview" / "handoff"))
    base = _data() / "preview" / "handoff"
    files = sorted(str(p.relative_to(base)) for p in base.rglob("*") if p.is_file())
    return {"files": [{"path": f, "bytes": (base / f).stat().st_size} for f in files], "prompt": r.get("prompt", ""), "fingerprint": r.get("fingerprint")}


@router.get("/preview/file")
def preview_file(path: str) -> dict[str, Any]:
    base = (_data() / "preview" / "handoff").resolve()
    p = (base / path).resolve()
    if not str(p).startswith(str(base) + os.sep) or not p.is_file() or p.is_symlink():
        raise HTTPException(404, "no such kit file (build the preview first)")
    return {"path": path, "text": p.read_text("utf-8", errors="replace")[:400_000]}


def _claude_ai() -> dict[str, Any]:
    saved = _read(_data() / "claude-ai.json", None)
    if isinstance(saved, dict) and isinstance(saved.get("items"), list):
        return saved
    kit = _read(_root() / "_claude" / "handoff" / "sources" / "claude-ai.json", None)
    if isinstance(kit, dict) and isinstance(kit.get("items"), list):
        return kit
    r = subprocess.run(["node", "--input-type=module", "-e", "import { defaultClaudeAi } from './handoff-core.mjs'; import { readFileSync } from 'node:fs';"
                        f"let m = {{}}; try {{ m = JSON.parse(readFileSync({json.dumps(str(_root() / 'project.manifest.json'))}, 'utf8')); }} catch {{}}"
                        "console.log(JSON.stringify(defaultClaudeAi(m)));"], capture_output=True, text=True, cwd=str(HERE), timeout=20)
    return json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() else {"items": [], "memory": "", "projectInstructions": ""}


def claude_ai_error(r: Any) -> str:
    """Same checks as handoff-core.mjs claudeAiError."""
    if not isinstance(r, dict) or not isinstance(r.get("items"), list):
        return "items must be a list"
    if len(r["items"]) > 100:
        return "at most 100 items"
    for it in r["items"]:
        if not isinstance(it, dict) or not isinstance(it.get("id"), str) or not ID_RE.match(it["id"]):
            return "every item needs an id (lowercase, dashes)"
        if it.get("kind") not in KINDS:
            return f"kind must be one of {', '.join(sorted(KINDS))}"
        for k in ("name", "url", "notes", "recreate"):
            if k in it and (not isinstance(it[k], str) or len(it[k]) > 2000):
                return f"{k} must be text (≤ 2000)"
        if it.get("url") and not it["url"].startswith("https://"):
            return "urls must be https"
    for k in ("memory", "projectInstructions"):
        if k in r and (not isinstance(r[k], str) or len(r[k]) > 100_000):
            return f"{k} must be text (≤ 100 000)"
    return ""


@router.get("/claude-ai")
def get_claude_ai() -> dict[str, Any]:
    return _claude_ai()


@router.put("/claude-ai")
async def put_claude_ai(request: Request) -> dict[str, Any]:
    body = await request.body()
    if len(body) > 400_000:
        raise HTTPException(413, "too large")
    try:
        r = json.loads(body)
    except ValueError as e:
        raise HTTPException(400, "not JSON") from e
    err = claude_ai_error(r)
    if err:
        raise HTTPException(400, err)
    out = {"$axf": "claude-handoff-claude-ai@1", "items": [{k: it.get(k, "") for k in ("id", "kind", "name", "url", "notes", "recreate")} for it in r["items"]],
           "memory": r.get("memory", ""), "projectInstructions": r.get("projectInstructions", ""), "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    with _lock:
        _write(_data() / "claude-ai.json", out)
    return out


class ConfigReq(BaseModel):
    remindHours: int = Field(default=6, ge=1, le=48)
    onlyWhenChanged: bool = False
    autoPublish: bool = False
    collectConsole: bool = True
    context: list[str] = Field(default_factory=list, max_length=60)


@router.get("/config")
def get_config() -> dict[str, Any]:
    return _config()


@router.put("/config")
def put_config(req: ConfigReq) -> dict[str, Any]:
    for p in req.context:
        if not p or len(p) > 300 or ".." in p or p.startswith("/") or not re.match(r"^[A-Za-z0-9_./-]+$", p):
            raise HTTPException(400, f"context paths are plain repo-relative paths: {p[:80]}")
    with _lock:
        _write(_data() / "config.json", req.model_dump())
    return _config()


@router.get("/machines")
def get_machines() -> dict[str, Any]:
    d = _data() / "machines"
    out = []
    for p in sorted(d.glob("*.json")) if d.exists() else []:
        m = _read(p, {})
        if isinstance(m, dict) and m.get("host"):
            out.append({"host": m["host"], "collectedAt": m.get("collectedAt"), "files": len(m.get("files") or []), "hooks": len(((m.get("settings") or {}).get("hooks")) or []), "secrets": m.get("secrets") or []})
    return {"machines": out}


def machine_error(m: Any) -> str:
    """Same checks as handoff-core.mjs machineError (the CLI redacts before sending; this only gates shape and size)."""
    if not isinstance(m, dict) or m.get("$axf") != "claude-handoff-machine@1":
        return "not a claude-handoff-machine@1 record"
    if not isinstance(m.get("host"), str) or not HOST_RE.match(m["host"]):
        return "host must be lowercase letters, digits, dots, dashes"
    files = m.get("files")
    if not isinstance(files, list) or len(files) > 400:
        return "files must be a list of at most 400"
    for f in files:
        if not isinstance(f, dict) or not isinstance(f.get("path"), str) or not isinstance(f.get("content"), str) or ".." in f["path"] or f["path"].startswith("/"):
            return "bad file entry"
        name = f["path"].rsplit("/", 1)[-1].lower()
        if re.match(r"^\.env(\.|$)", name) or re.search(r"\.(pem|key|p12|pfx|keystore|jks)$", name) or re.match(r"^id_(rsa|ed25519|ecdsa|dsa)", name) or re.search(r"(^|[._-])(secrets?|credentials?)(\.|$)", name):
            return f"secret-looking file refused: {f['path'][:80]}"
    return ""


@router.post("/machines")
async def post_machine(request: Request) -> dict[str, Any]:
    body = await request.body()
    if len(body) > MAX_MACHINE_BYTES:
        raise HTTPException(413, "too large")
    try:
        m = json.loads(body)
    except ValueError as e:
        raise HTTPException(400, "not JSON") from e
    err = machine_error(m)
    if err:
        raise HTTPException(400, err)
    with _lock:
        _write(_data() / "machines" / f"{m['host']}.json", m)
    return {"ok": True, "host": m["host"], "files": len(m["files"])}


@router.delete("/machines/{host}")
def delete_machine(host: str) -> dict[str, Any]:
    if not HOST_RE.match(host):
        raise HTTPException(400, "bad host")
    p = _data() / "machines" / f"{host}.json"
    with _lock:
        existed = p.exists()
        p.unlink(missing_ok=True)
    return {"ok": True, "removed": existed}


@router.post("/reminder/dismiss")
def dismiss_reminder() -> dict[str, Any]:
    _clear_reminder()
    return {"ok": True}


@router.post("/reminder/check")
def reminder_check() -> dict[str, Any]:
    """Run the 5-minute check now (used by tests and the settings tab)."""
    fired = check_reminder()
    return {"fired": fired, "reminder": _reminder_view(_state(), _config())}

