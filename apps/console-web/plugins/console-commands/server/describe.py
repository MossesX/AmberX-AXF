"""A console screenshot in words (build voice-console-control, Nov 20 2026).

On a voice call the image of a tool result never reaches Amber, so the console server reads the PNG itself: it sends
the image to a vision-capable Claude model through the console's own model route (capability `axf.llm@1`, the AI
assistant's provider profiles, keys and usage accounting; no other API path) and returns a literal description.

  describe(png, question="", state=None, settings=None) -> {description, model, profile, usage, ms, cached}
                                                         | {description: "", note, ...}   (never raises)

Rules the model is given: say only what is visible (screen, headings, tabs, buttons, labels, list and table rows with
their text and status, banners, errors, dialogs, open menus, numbers), no guessing. It gives up after
DESCRIBE_TIMEOUT_S and the caller still gets the image and the element map with a note. A description is kept for
DESCRIBE_CACHE_S per image hash and question, so asking twice about an unchanged screen costs one model call.

The profile must speak the Anthropic Messages protocol (images go as base64 blocks; the Claude Code CLI profile takes
text only). Model: `describeModel` in the plugin's server settings, else DESCRIBE_MODEL. Only Opus or Fable.
"""
from __future__ import annotations

import base64
import hashlib
import threading
import time
from typing import Any, Callable

import plugin_services

DESCRIBE_TIMEOUT_S = 30.0   # = CONSOLE_DESCRIBE_TIMEOUT_MS in core/engines/console-screen.mjs
DESCRIBE_CACHE_S = 120.0    # = CONSOLE_DESCRIBE_CACHE_MS
DESCRIBE_MODEL = "claude-opus-5-5"
DESCRIBE_MODELS = ("claude-opus-5-5", "claude-fable-5-2")
DESCRIBE_MAX_TOKENS = 1400
QUESTION_MAX = 500
CACHE_MAX = 40

SYSTEM = (
    "You describe one screenshot of a web console to a person who cannot see it and is listening on a voice call. "
    "Describe literally and completely what is visible, in this order: which screen it is and its heading; the tab rows "
    "and which tab is open; toolbars and their buttons; banners, warnings and errors (quote them); every list or table "
    "row with its text and its status; open dialogs and open menus with their items; counts and other numbers. "
    "Quote labels exactly as written. Say where things are (top right, left column) and their colour when it carries "
    "meaning (a green button, a red badge). Never guess: do not explain what something probably does, do not invent "
    "text that is cut off or too small to read (say it is cut off). Plain sentences and short lines, no markdown tables."
)

_lock = threading.Lock()
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
# tests swap the model call: (png_b64, system, prompt, model, profile) -> {text, usage, model, profile}
_model: Callable[[str, str, str, str, str], dict[str, Any]] | None = None


def set_model(fn: Callable[[str, str, str, str, str], dict[str, Any]] | None) -> None:
    """Replace the model call (tests), or restore the real one with None."""
    global _model
    _model = fn


def clear_cache() -> None:
    with _lock:
        _cache.clear()


def _vision_profile(svc: Any, wanted: str = "") -> str | None:
    """The profile to describe with: the one named in settings, else the first ready one that speaks Anthropic Messages."""
    try:
        profs = [p for p in svc.profiles() if isinstance(p, dict)]
    except Exception:  # noqa: BLE001 — a broken provider list reads as "no profile"
        return None
    ok = [p for p in profs if str(p.get("kind") or "") == "anthropic" or str(p.get("protocol") or "") == "anthropic"]
    if wanted:
        return next((str(p["id"]) for p in ok if p.get("id") == wanted), None)
    ready = [p for p in ok if p.get("keyReady") is not False]
    pick = next((p for p in ready if p.get("default")), None) or (ready[0] if ready else None)
    return str(pick["id"]) if pick else None


def _call(png_b64: str, system: str, prompt: str, model: str, profile: str) -> dict[str, Any]:
    svc = plugin_services.get("axf.llm@1")
    if svc is None:
        raise RuntimeError("no model route: the AI assistant plugin (axf.llm@1) is off")
    pid = _vision_profile(svc, profile)
    if pid is None:
        raise RuntimeError("no Claude provider that takes images is set up (Settings → Plugins → AI assistant: an Anthropic key)")
    out = svc.complete([{"role": "user", "content": prompt, "images": [{"media_type": "image/png", "data": png_b64}]}],
                       system=system, profile=pid, model=model, params={"max_tokens": DESCRIBE_MAX_TOKENS})
    return {"text": str(out.get("text") or ""), "usage": out.get("usage") or {}, "model": out.get("model") or model, "profile": out.get("profile") or pid}


def _prompt(question: str, state: dict[str, Any] | None) -> str:
    s = state or {}
    known = [f"screen: {s.get('screenLabel') or s.get('screen')}" if s.get("screen") or s.get("screenLabel") else "",
             f"open dialog: {s['dialog']}" if s.get("dialog") else "",
             "open tabs: " + ", ".join(f"{k.rsplit(':', 1)[-1]}={v}" for k, v in list((s.get("tabs") or {}).items())[:8]) if s.get("tabs") else ""]
    head = "; ".join(k for k in known if k)
    text = "Describe this screenshot of the console." + (f" The console reports: {head}." if head else "")
    q = " ".join(str(question or "").split())[:QUESTION_MAX]
    if q:
        text += f"\nThen answer this from what is visible only (say so if the screenshot does not show it): {q}"
    return text


def describe(png: bytes, question: str = "", state: dict[str, Any] | None = None, settings: dict[str, Any] | None = None,
             timeout: float | None = None) -> dict[str, Any]:
    """The screenshot in words. Never raises: a failure or a timeout is `note` with an empty description."""
    cfg = settings or {}
    model = str(cfg.get("describeModel") or DESCRIBE_MODEL)
    if model not in DESCRIBE_MODELS:
        model = DESCRIBE_MODEL
    profile = str(cfg.get("describeProfile") or "")
    q = " ".join(str(question or "").split())[:QUESTION_MAX]
    key = hashlib.sha256(png).hexdigest() + "|" + hashlib.sha256(f"{model}|{q}".encode()).hexdigest()[:16]
    now = time.monotonic()
    with _lock:
        for k in [k for k, (at, _) in _cache.items() if now - at > DESCRIBE_CACHE_S]:
            del _cache[k]
        hit = _cache.get(key)
    if hit is not None:
        return {**hit[1], "cached": True, "ms": 0}
    call = _model or _call
    box: dict[str, Any] = {}
    t0 = time.monotonic()

    def work() -> None:
        try:
            box["out"] = call(base64.b64encode(png).decode(), SYSTEM, _prompt(q, state), model, profile)
        except Exception as e:  # noqa: BLE001 — every provider failure becomes a note
            box["error"] = " ".join(str(e).split())[:300] or type(e).__name__
        # a description that arrives after the caller gave up is still worth keeping for the next ask
        out = box.get("out")
        if out and str(out.get("text") or "").strip():
            with _lock:
                if len(_cache) >= CACHE_MAX:
                    _cache.pop(min(_cache, key=lambda k: _cache[k][0]), None)
                _cache[key] = (time.monotonic(), _result(out, model))

    t = threading.Thread(target=work, name="console-describe", daemon=True)
    t.start()
    wait = DESCRIBE_TIMEOUT_S if timeout is None else timeout
    t.join(wait)
    ms = int((time.monotonic() - t0) * 1000)
    if t.is_alive():
        return {"description": "", "note": f"the description took longer than {int(wait)} s and was skipped: the image and the element map are here; ask again in a moment", "timedOut": True, "model": model, "ms": ms}
    if "error" in box:
        return {"description": "", "note": f"no description: {box['error']}", "model": model, "ms": ms}
    res = _result(box.get("out") or {}, model)
    if not res["description"]:
        return {"description": "", "note": "no description: the model answered with nothing", "model": res["model"], "ms": ms}
    return {**res, "cached": False, "ms": ms}


def _result(out: dict[str, Any], model: str) -> dict[str, Any]:
    usage = out.get("usage") if isinstance(out.get("usage"), dict) else {}
    return {"description": str(out.get("text") or "").strip(), "model": str(out.get("model") or model), "profile": str(out.get("profile") or ""),
            "usage": {"input": int(usage.get("input") or 0), "output": int(usage.get("output") or 0)}}
