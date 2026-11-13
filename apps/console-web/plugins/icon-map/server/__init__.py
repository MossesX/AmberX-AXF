"""Icon map (server part): the icon map from the files and the icon state (icon-map@1). Mounted at /api/plugins/icon-map/.

Reads come from the framework's own CLI (`node framework/cli/icon-map.mjs … --json`, the same engine the spec check and
the page use), so the map is never a second copy. The state (the icon pack in force + per-slot picks) is one JSON file
in the plugin's data folder; the open console reads it on load and every few seconds and writes it back when a pick is
made on screen, so REST, MCP, the CLI, voice and the page agree. plugin-commands@1 projects every route onto
/api/control/icon-map/<command>, the MCP tools icon-map_<command> and `axf icon-map <command>`.

  GET    map            ?q&app&owner&surface&kind&role&glyph&limit   slots (default limit 500) + total + counts
  GET    tree                                                           app → owner → surface → slots
  GET    roles | glyphs | packs | check                                  the vocabulary, the glyph set, the packs, the CI verdict
  GET    state                                                          { pack, slots, history }
  GET    slot/{id}                                                      one slot, with what it draws now and why
  GET    resolve        ?name&slot&role                                  what a place draws, and which step decided
  PUT    pack           { pack, by?, reason? }                           use a pack (id, name, style or tag word); '' = back to branding
  DELETE pack                                                            back to the branding's / skin's pack
  PUT    slot/{id}      { glyph, by?, reason? }                          one place draws this glyph
  DELETE slot/{id}                                                       drop the pick
  GET    template       ?from&id&name&style&fixed                       an icon-pack@1 file mapping every role to a glyph
  POST   slot/{id}/restore   { from: previous | hub, by?, reason? }      Restore previous edit / Restore from axHub
  POST   pack/restore        { from: previous | hub, by?, reason? }      the same for the pack in force
  PUT    hub-copy       { pack, slots, at? }                            the open console's last read of axHub's copy

Data: AXF_ICON_MAP_DIR or <repo>/.axf-console/plugins/icon-map/icons.json.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
ROOT = Path(__file__).resolve().parents[5]
CLI = ROOT / "framework" / "cli" / "icon-map.mjs"
SLOT_ID = re.compile(r"^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9_-]*/[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9_.-]*$")
GLYPH = re.compile(r"^[a-z][a-z0-9-]*$")
STATUS = {"invalid": 400, "not_found": 404, "unavailable": 503}
MAX_BODY = 16 * 1024
HISTORY = 50
CACHE_S = 20.0
PACK_KEY = "axf.icons.pack.app"


def data_dir() -> Path:
    return Path(os.environ.get("AXF_ICON_MAP_DIR") or (ROOT / ".axf-console" / "plugins" / FOLDER))


def state_file() -> Path:
    return data_dir() / "icons.json"


# ---------------------------------------------------------------------- the engine, through its CLI

_cache: dict[str, tuple[float, Any]] = {}


def cli(*args: str, timeout: int = 90, cache: bool = True) -> dict[str, Any]:
    key = " ".join(args)
    now = time.monotonic()
    if cache and key in _cache and now - _cache[key][0] < CACHE_S:
        return _cache[key][1]
    try:
        p = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "code": "unavailable", "message": f"the icon map engine could not run: {str(e)[:200]}"}
    try:
        value = json.loads(p.stdout) if p.stdout.strip() else None
    except json.JSONDecodeError:
        return {"ok": False, "code": "unexpected", "message": (p.stderr or p.stdout).strip()[-400:]}
    if value is None:
        return {"ok": False, "code": "unexpected", "message": p.stderr.strip()[-400:] or "no output"}
    out = {"ok": True, "value": value}
    if cache:
        _cache[key] = (now, out)
    return out


def answer(r: dict[str, Any]) -> JSONResponse:
    return JSONResponse(r, status_code=200 if r.get("ok") else STATUS.get(str(r.get("code")), 500))


def fail(code: str, message: str, **extra: Any) -> dict[str, Any]:
    return {"ok": False, "code": code, "message": message, **extra}


# ---------------------------------------------------------------------- the state file

def read_state() -> dict[str, Any]:
    try:
        raw = json.loads(state_file().read_text())
    except (OSError, ValueError):
        raw = {}
    pack = raw.get("pack") if isinstance(raw.get("pack"), str) else ""
    slots = {k: v for k, v in (raw.get("slots") or {}).items() if isinstance(k, str) and SLOT_ID.match(k) and isinstance(v, str) and GLYPH.match(v)} if isinstance(raw.get("slots"), dict) else {}
    history = [h for h in (raw.get("history") or []) if isinstance(h, dict)][-HISTORY:] if isinstance(raw.get("history"), list) else []
    hub = raw.get("hub") if isinstance(raw.get("hub"), dict) else None
    if hub is not None:
        hub = {"pack": hub.get("pack") if isinstance(hub.get("pack"), str) else "", "slots": {k: v for k, v in (hub.get("slots") or {}).items() if isinstance(k, str) and SLOT_ID.match(k) and isinstance(v, str) and GLYPH.match(v)} if isinstance(hub.get("slots"), dict) else {}, "at": str(hub.get("at") or "")[:40]}
    return {"$axf": "icon-state@1", "pack": pack, "packKey": PACK_KEY, "slots": slots, "history": history, "hub": hub}


def write_state(state: dict[str, Any]) -> None:
    d = data_dir()
    d.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(d, 0o700)
    except OSError:
        pass
    tmp = state_file().with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=1, sort_keys=True) + "\n")
    os.replace(tmp, state_file())


def note(state: dict[str, Any], what: str, by: str, reason: str, **fields: Any) -> None:
    state["history"] = (state.get("history") or [])[-(HISTORY - 1):] + [{"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "what": what, "by": by[:80], **({"reason": reason[:200]} if reason else {}), **fields}]


def _who(request: Request, body: dict[str, Any]) -> str:
    by = body.get("by")
    if isinstance(by, str) and by.strip():
        return by.strip()[:80]
    u = getattr(request.state, "axf_user", None)
    name = getattr(u, "name", None) or (u.get("name") if isinstance(u, dict) else None)
    return f"console:{str(name)[:40]}" if name and name != "console-token" else "console"


async def _body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > MAX_BODY:
        return {}
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


# ---------------------------------------------------------------------- packs and glyphs

def packs() -> list[dict[str, Any]]:
    r = cli("packs")
    return r["value"] if r.get("ok") and isinstance(r.get("value"), list) else []


def find_pack(words: str) -> dict[str, Any] | None:
    """A pack by id, else by a word of its name, style or tags ("duotone", "filled", "amberx")."""
    w = re.sub(r"\s+", " ", words.strip().lower())
    if not w:
        return None
    ps = packs()
    for p in ps:
        if p.get("id") == w:
            return p
    w2 = re.sub(r"\b(the|icon|icons|pack|set|please)\b", " ", w).strip()
    for p in ps:
        hay = " ".join([str(p.get("id", "")), str(p.get("name", "")).lower(), str(p.get("style", "")), *[str(t).lower() for t in p.get("tags") or []]])
        if w2 and all(part in hay for part in w2.split()):
            return p
    return None


def glyph_names() -> set[str]:
    r = cli("glyphs")
    v = r.get("value") if r.get("ok") else None
    if not isinstance(v, dict):
        return set()
    return set(v.get("names") or []) | set((v.get("aliases") or {}).keys())


def resolve(name: str, slot: str, role: str, state: dict[str, Any]) -> dict[str, Any]:
    if slot and slot in state["slots"]:
        return {"glyph": state["slots"][slot], "via": "override"}
    args = ["resolve", name or ""]
    if slot:
        args += ["--slot", slot]
    if role:
        args += ["--role", role]
    if state["pack"]:
        args += ["--pack", state["pack"]]
    r = cli(*args, cache=False)
    return r["value"] if r.get("ok") and isinstance(r.get("value"), dict) else {"glyph": "box", "via": "fallback", "problem": r.get("message", "")}


# ---------------------------------------------------------------------- reads

@router.get("/map")
async def get_map(request: Request) -> JSONResponse:
    q = request.query_params
    args = ["list"]
    for k in ("app", "owner", "surface", "kind", "role", "glyph", "screen"):
        v = q.get(k)
        if v and re.match(r"^[a-z0-9][a-z0-9_./-]*$", v):
            args += [f"--{k}", v]
    words = (q.get("q") or "").strip()[:120]
    if words:
        args += ["--q", words]
    try:
        limit = max(1, min(int(q.get("limit") or 500), 20000))
    except ValueError:
        limit = 500
    r = await run_in_threadpool(cli, *args)
    if not r.get("ok"):
        return answer(r)
    slots = r["value"] if isinstance(r["value"], list) else []
    counts_r = await run_in_threadpool(cli, "counts")
    counts = counts_r["value"] if counts_r.get("ok") and isinstance(counts_r.get("value"), dict) else {}
    state = read_state()
    for s in slots[:limit]:
        if s.get("id") in state["slots"]:
            s["picked"] = state["slots"][s["id"]]
    return answer({"ok": True, "$axf": "icon-map@1", "slots": slots[:limit], "total": len(slots), "limit": limit, "counts": counts, "pack": state["pack"]})


@router.get("/tree")
async def get_tree() -> JSONResponse:
    r = await run_in_threadpool(cli, "tree")
    return answer({"ok": True, "tree": r["value"]} if r.get("ok") else r)


@router.get("/roles")
async def get_roles() -> JSONResponse:
    r = await run_in_threadpool(cli, "roles")
    return answer({"ok": True, "roles": r["value"]} if r.get("ok") else r)


@router.get("/glyphs")
async def get_glyphs() -> JSONResponse:
    r = await run_in_threadpool(cli, "glyphs")
    return answer({"ok": True, **r["value"]} if r.get("ok") and isinstance(r.get("value"), dict) else r)


@router.get("/packs")
async def get_packs() -> JSONResponse:
    r = await run_in_threadpool(cli, "packs")
    state = read_state()
    return answer({"ok": True, "packs": r["value"], "active": state["pack"]} if r.get("ok") else r)


@router.get("/check")
async def get_check() -> JSONResponse:
    r = await run_in_threadpool(cli, "check", cache=False)
    return answer({"ok": True, **r["value"]} if r.get("ok") and isinstance(r.get("value"), dict) else r)


@router.get("/state")
async def get_state() -> JSONResponse:
    return answer({"ok": True, **read_state()})


@router.get("/slot/{slot_id:path}")
async def get_slot(slot_id: str) -> JSONResponse:
    if not SLOT_ID.match(slot_id):
        return answer(fail("invalid", "a slot id is <app>/<owner>/<surface>/<name> in lowercase words"))
    r = await run_in_threadpool(cli, "show", slot_id, cache=False)
    if not r.get("ok"):
        return answer(fail("not_found", f'no slot "{slot_id}"') if "no slot" in str(r.get("message", "")) else r)
    slot = r["value"]
    state = read_state()
    draws = await run_in_threadpool(resolve, slot.get("glyph", ""), slot_id, slot.get("role", ""), state)
    return answer({"ok": True, "slot": slot, "draws": draws, "picked": state["slots"].get(slot_id)})


@router.get("/resolve")
async def get_resolve(request: Request) -> JSONResponse:
    q = request.query_params
    name, slot, role = (q.get("name") or "")[:64], (q.get("slot") or "")[:160], (q.get("role") or "")[:48]
    if slot and not SLOT_ID.match(slot):
        return answer(fail("invalid", "slot must be a slot id"))
    if not name and not role and not slot:
        return answer(fail("invalid", "give a name, a slot or a role"))
    draws = await run_in_threadpool(resolve, name, slot, role, read_state())
    return answer({"ok": True, "name": name, "slot": slot, "role": role, **draws})


# ---------------------------------------------------------------------- writes

@router.put("/pack")
async def put_pack(request: Request) -> JSONResponse:
    body = await _body(request)
    words = body.get("pack")
    if not isinstance(words, str):
        return answer(fail("invalid", "body.pack must be a pack id, name or style word ('' = back to branding)"))
    state = read_state()
    by, reason = _who(request, body), str(body.get("reason") or "")
    if not words.strip():
        prev = state["pack"]
        state["pack"] = ""
        note(state, "pack-clear", by, reason, prev=prev)
        write_state(state)
        return answer({"ok": True, "pack": "", "applied": None, "message": "back to the branding's icon pack"})
    p = await run_in_threadpool(find_pack, words)
    if not p:
        return answer(fail("not_found", f'no icon pack matches "{words}"', packs=[x.get("id") for x in packs()]))
    prev = state["pack"]
    state["pack"] = p["id"]
    note(state, "pack-set", by, reason, pack=p["id"], prev=prev)
    write_state(state)
    return answer({"ok": True, "pack": p["id"], "applied": p, "message": f"{p.get('name') or p['id']} is the icon pack"})


@router.delete("/pack")
async def delete_pack(request: Request) -> JSONResponse:
    body = await _body(request)
    state = read_state()
    prev = state["pack"]
    state["pack"] = ""
    note(state, "pack-clear", _who(request, body), str(body.get("reason") or ""), prev=prev)
    write_state(state)
    return answer({"ok": True, "pack": "", "message": "back to the branding's icon pack"})


@router.put("/slot/{slot_id:path}")
async def put_slot(slot_id: str, request: Request) -> JSONResponse:
    body = await _body(request)
    glyph = body.get("glyph")
    if not SLOT_ID.match(slot_id):
        return answer(fail("invalid", "a slot id is <app>/<owner>/<surface>/<name> in lowercase words"))
    if not isinstance(glyph, str) or not GLYPH.match(glyph):
        return answer(fail("invalid", "body.glyph must be a glyph name (lowercase words with dashes)"))
    known = glyph in await run_in_threadpool(glyph_names)
    state = read_state()
    prev = state["slots"].get(slot_id)
    state["slots"][slot_id] = glyph
    note(state, "slot-set", _who(request, body), str(body.get("reason") or ""), slot=slot_id, glyph=glyph, prev=prev)
    write_state(state)
    return answer({"ok": True, "slot": slot_id, "glyph": glyph, "known": known, **({} if known else {"warning": f'"{glyph}" is not a framework glyph; it draws only if the active pack has it'})})


@router.delete("/slot/{slot_id:path}")
async def delete_slot(slot_id: str, request: Request) -> JSONResponse:
    body = await _body(request)
    if not SLOT_ID.match(slot_id):
        return answer(fail("invalid", "a slot id is <app>/<owner>/<surface>/<name> in lowercase words"))
    state = read_state()
    had = state["slots"].pop(slot_id, None)
    note(state, "slot-clear", _who(request, body), str(body.get("reason") or ""), slot=slot_id, prev=had)
    write_state(state)
    return answer({"ok": True, "slot": slot_id, "cleared": had is not None})


# ---------------------------------------------------------------------- template and restore

@router.get("/template")
async def get_template(request: Request) -> JSONResponse:
    q = request.query_params
    args = ["template"]
    for k in ("from", "id", "name", "style"):
        v = (q.get(k) or "").strip()[:80]
        if v:
            args += [f"--{k}", v]
    if (q.get("fixed") or "").lower() in ("1", "true", "yes"):
        args.append("--fixed")
    r = await run_in_threadpool(cli, *args, cache=False)
    if not r.get("ok"):
        return answer(fail("not_found", r.get("message", "")) if "no icon pack" in str(r.get("message", "")) else r)
    return answer({"ok": True, "pack": r["value"], "roles": len((r["value"].get("data") or {}).get("roles") or {})})


def previous_of(state: dict[str, Any], slot: str | None) -> tuple[bool, str | None]:
    """The value before the last edit of a slot (slot id) or of the pack (None): (found, value; None = no pick)."""
    for h in reversed(state.get("history") or []):
        if slot is None and h.get("what") in ("pack-set", "pack-clear", "pack-restore"):
            return True, h.get("prev") or ""
        if slot is not None and h.get("slot") == slot and h.get("what") in ("slot-set", "slot-clear", "slot-restore"):
            return True, h.get("prev")
    return False, None


@router.post("/slot/{slot_id:path}/restore")
async def restore_slot(slot_id: str, request: Request) -> JSONResponse:
    body = await _body(request)
    src = body.get("from") or "previous"
    if not SLOT_ID.match(slot_id):
        return answer(fail("invalid", "a slot id is <app>/<owner>/<surface>/<name> in lowercase words"))
    if src not in ("previous", "hub"):
        return answer(fail("invalid", "body.from is previous or hub"))
    state = read_state()
    if src == "previous":
        found, value = previous_of(state, slot_id)
        if not found:
            return answer(fail("not_found", f"no earlier edit of {slot_id} to go back to"))
    else:
        if state.get("hub") is None:
            return answer(fail("unavailable", "no axHub copy yet: open the console with axHub sync on (Settings -> Plugins -> axHub sync), it sends the hub's icons here"))
        value = state["hub"]["slots"].get(slot_id)
    cur = state["slots"].get(slot_id)
    if value:
        state["slots"][slot_id] = value
    else:
        state["slots"].pop(slot_id, None)
    note(state, "slot-restore", _who(request, body), str(body.get("reason") or ""), slot=slot_id, glyph=value, prev=cur, source=src)
    write_state(state)
    return answer({"ok": True, "slot": slot_id, "glyph": value, "from": src, "message": f"{slot_id} draws {value}" if value else f"{slot_id} follows the pack again"})


@router.post("/pack/restore")
async def restore_pack(request: Request) -> JSONResponse:
    body = await _body(request)
    src = body.get("from") or "previous"
    if src not in ("previous", "hub"):
        return answer(fail("invalid", "body.from is previous or hub"))
    state = read_state()
    if src == "previous":
        found, value = previous_of(state, None)
        if not found:
            return answer(fail("not_found", "no earlier pack change to go back to"))
    else:
        if state.get("hub") is None:
            return answer(fail("unavailable", "no axHub copy yet: open the console with axHub sync on, it sends the hub's icons here"))
        value = state["hub"]["pack"]
    cur = state["pack"]
    state["pack"] = value or ""
    note(state, "pack-restore", _who(request, body), str(body.get("reason") or ""), pack=state["pack"], prev=cur, source=src)
    write_state(state)
    return answer({"ok": True, "pack": state["pack"], "from": src})


@router.put("/hub-copy")
async def put_hub_copy(request: Request) -> JSONResponse:
    body = await _body(request)
    pack, slots = body.get("pack"), body.get("slots")
    if not isinstance(pack, str) or not isinstance(slots, dict):
        return answer(fail("invalid", "body is { pack: string, slots: { slot id: glyph } }"))
    state = read_state()
    state["hub"] = {"pack": pack[:80], "slots": {k: v for k, v in slots.items() if isinstance(k, str) and SLOT_ID.match(k) and isinstance(v, str) and GLYPH.match(v)}, "at": str(body.get("at") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))[:40]}
    write_state(state)
    return answer({"ok": True, "slots": len(state["hub"]["slots"]), "pack": state["hub"]["pack"]})
