"""Claude badge — server part. Mounted at /api/plugins/claude-badge/ (console token, 404 when disabled).

POST /test runs one tiny request through the AI assistant's model service (axf.llm@1) and says whether AI answers and
which model did, and which of three states it is in: `ok` (answers), `no-credit` (the account or key works but is out
of credits / over its usage limit) or `error` (can't connect: bad token, invalid account, no assistant); GET /status returns the last result (kept in the plugin's data folder, no reply text, no keys).
Nothing here names another plugin: no service = "AI unavailable".
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import console_context as cx
import plugin_services
import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import storage

router = APIRouter()
_lock = threading.Lock()
# Same wording the AI assistant's credit check matches (ai-assistant `_NO_CREDIT`); kept here so no plugin is named.
NO_CREDIT = re.compile(r"hit your (?:weekly |daily |session |5-hour )?limit|weekly limit|credit balance|out of credits?|insufficient[ _-]?(credit|funds|balance)|billing|usage limit|limit reached|quota|payment required|\b402\b", re.I)
STATES = ("ok", "no-credit", "error")
PROMPT = "Connection check from the AmberX console. Reply with one word: OK."


def data_dir() -> Path:
    return Path(os.environ.get("AXF_CLAUDE_BADGE_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "claude-badge"))


def pretty_model(model: str) -> str:
    """claude-opus-5-5 → Claude Opus 5.5; claude-sonnet-5-5-20261001 → Claude Sonnet 5.5; anything else as given."""
    m = re.match(r"^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$", (model or "").strip().lower())
    if m:
        fam, major, minor = m.groups()
        return f"Claude {fam.capitalize()} {major}{'.' + minor if minor else ''}"
    m = re.match(r"^claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)", (model or "").strip().lower())  # older claude-3-5-sonnet style
    if m:
        major, minor, fam = m.groups()
        return f"Claude {fam.capitalize()} {major}{'.' + minor if minor else ''}"
    return (model or "").strip()[:60]


def classify(ok: bool, error: str) -> str:
    """ok → `ok`; an error saying the account is out of credits / over its limit → `no-credit`; anything else → `error`."""
    if ok:
        return "ok"
    return "no-credit" if NO_CREDIT.search(error or "") else "error"


def _save(res: dict[str, Any]) -> None:
    p = data_dir() / "status.json"
    with _lock:
        storage.write_json(p, res, indent=None)  # atomic, 0600, folder 0700 (axf_server.storage)


def run_test() -> dict[str, Any]:
    started = time.time()
    llm = plugin_services.get("axf.llm@1")
    res: dict[str, Any] = {"at": int(started * 1000), "ok": False, "model": "", "name": "", "provider": "", "ms": 0, "error": ""}
    if not llm:
        res["error"] = "The AI assistant isn't installed or enabled"
    else:
        try:
            out = llm.complete([{"role": "user", "content": PROMPT}], params={"temperature": 0, "max_tokens": 16})
            text = str(out.get("text") or "").strip()
            res.update(ok=bool(text), model=str(out.get("model") or ""), provider=str(out.get("profile") or ""), error="" if text else "the model answered with nothing")
        except Exception as e:  # noqa: BLE001
            res["error"] = (str(e).strip("'\"") or e.__class__.__name__)[:300]
    res["ms"] = int((time.time() - started) * 1000)
    res["name"] = pretty_model(res["model"]) if res["ok"] else ""
    res["claude"] = res["name"].startswith("Claude")
    res["state"] = classify(res["ok"], res["error"])
    keys = plugin_services.get("axf.ai-keys@1")  # the signed-in Claude account's email, when the AI keys plugin has one
    try:
        acct = keys.active_account("claude-code") if keys and hasattr(keys, "active_account") else {}
    except Exception:  # noqa: BLE001 — the badge never fails over the email
        acct = {}
    res["account"] = str((acct or {}).get("email") or "")
    _save(res)
    said = {"ok": "ok, " + (res["name"] or "model unknown"), "no-credit": "out of credits (" + res["error"][:120] + ")", "error": "unavailable (" + res["error"][:120] + ")"}
    cx.log("system", f"AI connection: {said[res['state']]}", "ok" if res["ok"] else "warn")
    return res


@router.post("/test")
def test() -> dict[str, Any]:
    return run_test()


@router.get("/status")
def status() -> dict[str, Any]:
    try:
        last = json.loads((data_dir() / "status.json").read_text("utf-8"))
    except (OSError, ValueError):
        return {"last": None}
    if isinstance(last, dict) and last.get("state") not in STATES:  # saved before the out-of-credits state existed
        last["state"] = classify(bool(last.get("ok")), str(last.get("error") or ""))
    return {"last": last}



# ---------------------------------------------------------------------- the badge's look and animations
# Brett, Nov 4 2026 (build follow-amber-switch): ~20 badge looks (badge assets in looks.json, brand-icon looks among
# them), any brand-package icon as the badge's icon, and an animation per state (Follow Amber on / Amber just opened
# something / connecting / error). One style per console, kept in the plugin's data folder (style.json), so REST, MCP
# (claude_badge_styles_list / _style_set / _animation_set) and the CLI (axf claude-badge styles-list …) all change it.

LOOKS_FILE = Path(__file__).resolve().parents[1] / "looks.json"
TONES = ("neutral", "success", "warning", "danger", "accent", "muted")
HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
ICON = re.compile(r"^(?:icon:[a-z0-9-]{1,40}|mark:[a-z0-9-]{1,60}|anim:[a-z0-9-]{1,60}|glyph:[a-z0-9-]{1,60}/[a-z0-9-]{1,40})$")


def looks() -> dict[str, Any]:
    try:
        return json.loads(LOOKS_FILE.read_text("utf-8"))
    except (OSError, ValueError):
        return {"looks": [], "motions": [], "states": []}


def default_style() -> dict[str, Any]:
    lk = looks()
    return {"look": "pill", "icon": "", "tone2": "accent", "color2": "",
            "animations": {s["id"]: dict(s["default"]) for s in lk.get("states", [])}}


def load_style() -> dict[str, Any]:
    st = default_style()
    try:
        saved = json.loads((data_dir() / "style.json").read_text("utf-8"))
    except (OSError, ValueError):
        return st
    if isinstance(saved, dict):
        for k in ("look", "icon", "tone2", "color2"):
            if isinstance(saved.get(k), str):
                st[k] = saved[k]
        for sid, a in (saved.get("animations") or {}).items():
            if sid in st["animations"] and isinstance(a, dict):
                st["animations"][sid].update({k: v for k, v in a.items() if k in ("motion", "speed", "intensity", "loop")})
    return st


def _bad(msg: str) -> None:
    raise HTTPException(400, msg)


def check_animation(a: dict[str, Any], motions: set[str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if "motion" in a:
        if a["motion"] not in motions:
            _bad(f"motion is one of {', '.join(sorted(motions))}")
        out["motion"] = a["motion"]
    for k, lo, hi in (("speed", 0.3, 30), ("intensity", 0, 1)):
        if k in a:
            v = a[k]
            if isinstance(v, str):
                try:
                    v = float(v)
                except ValueError:
                    _bad(f"{k} must be a number")
            if not isinstance(v, (int, float)) or isinstance(v, bool) or not lo <= v <= hi:
                _bad(f"{k} must be a number from {lo} to {hi}")
            out[k] = float(v)
    if "loop" in a:
        v = a["loop"]
        if isinstance(v, str) and v in ("true", "false"):
            v = v == "true"
        if not isinstance(v, bool):
            _bad("loop must be true or false")
        out["loop"] = v
    return out


def save_style(patch: dict[str, Any]) -> dict[str, Any]:
    lk = looks()
    ids = {l["data"]["look"] for l in lk.get("looks", [])}
    motions = {m["id"] for m in lk.get("motions", [])}
    st = load_style()
    if "look" in patch:
        look = str(patch["look"]).removeprefix("claude-look-")
        if look not in ids:
            _bad(f"look is one of {', '.join(sorted(ids))}")
        st["look"] = look
    if "icon" in patch:
        icon = str(patch["icon"] or "")
        if icon and not ICON.match(icon):
            _bad("icon is '' (the look's own), icon:<name>, mark:<logo-mark id>, anim:<animated-logo id> or glyph:<icon-pack id>/<glyph>")
        st["icon"] = icon
    if "tone2" in patch:
        if patch["tone2"] not in TONES:
            _bad(f"tone2 is one of {', '.join(TONES)}")
        st["tone2"] = patch["tone2"]
    if "color2" in patch:
        c = str(patch["color2"] or "")
        if c and not HEX.match(c):
            _bad("color2 is '' (use tone2) or #rgb / #rrggbb")
        st["color2"] = c
    for sid, a in (patch.get("animations") or {}).items():
        if sid not in st["animations"]:
            _bad(f"animation state is one of {', '.join(st['animations'])}")
        if not isinstance(a, dict):
            _bad("each animation is {motion?, speed?, intensity?, loop?}")
        st["animations"][sid].update(check_animation(a, motions))
    with _lock:
        storage.write_json(data_dir() / "style.json", st, indent=1)
    return st


async def _json(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
    except Exception:  # noqa: BLE001 — no body = no fields
        return {}
    if isinstance(b, dict) and isinstance(b.get("input"), dict):
        b = {**b["input"], **{k: v for k, v in b.items() if k != "input"}}
    return b if isinstance(b, dict) else {}


@router.get("/styles-list")
def styles_list() -> dict[str, Any]:
    """Every badge look (with its data), every animation, the four animation states and the style in use."""
    lk = looks()
    return {"ok": True, "looks": [{"id": l["data"]["look"], "asset": l["id"], "name": l["name"], "description": l.get("description", ""),
                                   "brand": "brand" in l.get("tags", []), "data": l["data"]} for l in lk.get("looks", [])],
            "motions": lk.get("motions", []), "states": lk.get("states", []), "style": load_style()}


@router.get("/style")
def style_get() -> dict[str, Any]:
    return {"ok": True, "style": load_style()}


@router.post("/style-set")
async def style_set(request: Request) -> dict[str, Any]:
    """Change the look: {look?, icon?, tone2?, color2?, animations?: {state: {motion?, speed?, intensity?, loop?}}}."""
    b = await _json(request)
    st = save_style({k: b[k] for k in ("look", "icon", "tone2", "color2", "animations") if k in b})
    cx.log("system", f"Claude badge look: {st['look']}{' · icon ' + st['icon'] if st['icon'] else ''}", "ok")
    return {"ok": True, "style": st}


@router.post("/animation-set")
async def animation_set(request: Request) -> dict[str, Any]:
    """One state's animation: {state: follow|opened|connecting|error, motion?, speed?, intensity?, loop?}."""
    b = await _json(request)
    sid = str(b.get("state") or "follow")
    st = save_style({"animations": {sid: {k: b[k] for k in ("motion", "speed", "intensity", "loop") if k in b}}})
    return {"ok": True, "state": sid, "animation": st["animations"][sid], "style": st}
