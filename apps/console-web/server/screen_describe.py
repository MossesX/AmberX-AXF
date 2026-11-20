"""Screen descriptions and click-by-words for callers that cannot see an image (build screen-voice-drive, Nov 20 2026).

On a voice call the image part of a tool result never reaches the model, so `console_screenshot` alone left Amber blind.
This module turns a console screenshot into text she can act on:

  clickables(map, targets)   the numbered list of what can be clicked: the open console's screen map (words, kind,
                             console-control@1 address, reading order; framework/react/screenMap.ts), visible ones first,
                             then the ones scrolled out of sight. An older console page that sends no map: the live
                             target list, unplaced.
  describe(png, …)           a literal description of the PNG from a vision-capable Claude model, through the console's
                             shared model service (capability axf.llm@1: the same providers, keys and usage counters as
                             every other model call the console makes). Gives up after DESCRIBE_TIMEOUT_S; cached by
                             image hash for CACHE_TTL_S.
  find(items, text, …)       the item whose words match what was said: exact, then words in order, then all words, then
                             close spelling (a transcription slip); or a number from the last list.
  click_command(item, …)     the console-control@1 command that clicks it (press a button, open a tab, focus a row).

No plugin is named here: the model is reached by capability, so with no provider the answer says so and still carries
the image and the clickable list.
"""
from __future__ import annotations

import difflib
import hashlib
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from pathlib import Path
from typing import Any

DESCRIBE_TIMEOUT_S = 30.0
CACHE_TTL_S = 120.0
CACHE_MAX = 40
LAST_TTL_S = 600.0          # how long "click 4" may refer to the last list
MAX_LISTED = 200            # items written into the text (the structured list keeps them all)
FUZZY_MIN = 0.8             # spelling closeness that still counts as the same words
LLM_CAPABILITY = "axf.llm@1"
VISION_KINDS = ("anthropic",)   # provider kinds of the shared registry that take an image and answer as Claude
MODEL_RE = re.compile(r"claude-(opus|fable)", re.I)
DEFAULT_MODEL = "claude-opus-5-5"
MAX_TOKENS = 1100

_PRICING_FILE = Path(os.environ.get("AXF_ROOT", Path(__file__).resolve().parent.parent.parent.parent)) / "framework" / "schemas" / "model-pricing.json"

CLICKABLE_TARGET_KINDS = ("tab", "subtab", "button", "function", "row", "step", "setting", "plugin")
ROLE_OF_KIND = {"tab": "tab", "subtab": "tab", "button": "button", "function": "button", "row": "row", "step": "step", "setting": "input", "plugin": "plugin"}
# what a caller may say for `kind`, mapped to roles
KIND_WORDS = {"tab": "tab", "tabs": "tab", "button": "button", "btn": "button", "row": "row", "line": "row", "step": "step", "link": "link", "menu": "menu item",
              "menu item": "menu item", "menuitem": "menu item", "item": "menu item", "input": "input", "field": "input", "box": "input", "setting": "input",
              "switch": "switch", "toggle": "switch", "checkbox": "switch", "plugin": "plugin"}
FILLER = frozenset("the a an that this those these click press tap open select choose please on one called named labelled labeled says saying to go".split())
NUMBER_WORDS = {w: i for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split())}
NUMBER_RE = re.compile(r"^(?:(?:click|press|tap|open|select|choose)\s+)?(?:(?:number|item|option|no\.?|#)\s*)?(\d{1,3}|[a-z]+)\.?$")

SYSTEM = (
    "You describe one screenshot of a web developer console to a person on a voice call who cannot see it. "
    "Be literal and complete: report only what is visibly on the image. Never guess, never infer what a control does, "
    "never invent text. Where text is too small, cut off or blurred to read, say it is unreadable instead of guessing. "
    "Plain text only: short lines, no markdown tables, no emphasis marks."
)


def _now() -> float:
    return time.time()


# ---------------------------------------------------------------------- the clickable list

def _clean(v: Any, cap: int = 160) -> str:
    return re.sub(r"\s+", " ", str(v if v is not None else "")).strip()[:cap]


def clickables(screen_map: Any, targets: Any = None, view: str = "") -> dict[str, Any]:
    """The numbered clickable list. `screen_map` = the open console's map ({items: [{address, kind, role, text, on, …}]},
    already in reading order); `targets` = the live console-control target list, used when the page sent no map.
    → {source: screen|targets|none, visible: [...], scroll: [...], items: [...all, numbered from 1...]}"""
    items: list[dict[str, Any]] = []
    source = "none"
    raw = screen_map.get("items") if isinstance(screen_map, dict) else None
    if isinstance(raw, list):
        source = "screen"
        seen: set[str] = set()
        for it in raw:
            if not isinstance(it, dict):
                continue
            address, text = _clean(it.get("address"), 400), _clean(it.get("text"))
            if not address or not text or address in seen:
                continue
            seen.add(address)
            kind = _clean(it.get("kind"), 20) or "button"
            row = {"text": text, "kind": _clean(it.get("role"), 20) or ROLE_OF_KIND.get(kind, "button"), "address": address, "controlKind": kind,
                   "on": "scroll" if it.get("on") == "scroll" else "screen"}
            if _clean(it.get("label")) and _clean(it.get("label")).lower() != text.lower():
                row["label"] = _clean(it.get("label"))
            for k in ("disabled", "destructive"):
                if it.get(k) is True:
                    row[k] = True
            if isinstance(it.get("value"), (str, int, float, bool)) and it.get("value") != "":
                row["value"] = it["value"] if not isinstance(it["value"], str) else _clean(it["value"], 80)
            items.append(row)
    elif isinstance(targets, list):
        source = "targets"
        for t in targets:
            if not isinstance(t, dict) or t.get("virtual") or t.get("kind") not in CLICKABLE_TARGET_KINDS:
                continue
            address, text = _clean(t.get("address"), 400), _clean(t.get("label"))
            leaf = address.rsplit("/", 1)[-1]
            if not address or not text or (t["kind"] in ("tab", "subtab") and "=" not in leaf):
                continue
            if view and address.startswith("view:") and not address.startswith(f"view:{view}/"):
                continue
            row = {"text": text, "kind": ROLE_OF_KIND[t["kind"]], "address": address, "controlKind": t["kind"], "on": "unplaced"}
            if t.get("disabled") is True:
                row["disabled"] = True
            if t.get("destructive") is True:
                row["destructive"] = True
            if isinstance(t.get("value"), (str, int, float, bool)) and t.get("value") != "":
                row["value"] = t["value"] if not isinstance(t["value"], str) else _clean(t["value"], 80)
            items.append(row)
    ordered = [i for i in items if i["on"] != "scroll"] + [i for i in items if i["on"] == "scroll"]
    for n, it in enumerate(ordered, 1):
        it["n"] = n
    out = {"source": source, "visible": [i for i in ordered if i["on"] != "scroll"], "scroll": [i for i in ordered if i["on"] == "scroll"], "items": ordered}
    if isinstance(screen_map, dict) and screen_map.get("truncated"):
        out["truncated"] = True
    return out


def _line(it: dict[str, Any]) -> str:
    notes: list[str] = []
    v = it.get("value")
    if it["kind"] == "tab" and v is True:
        notes.append("open")
    elif it["kind"] == "switch" and isinstance(v, bool):
        notes.append("on" if v else "off")
    elif isinstance(v, bool):
        notes.append("on" if v else "off")
    elif v not in (None, ""):
        notes.append(f'shows "{v}"')
    if it.get("disabled"):
        notes.append("disabled")
    if it.get("destructive"):
        notes.append("deletes or resets: needs confirm")
    kind = it["kind"] + (f" ({', '.join(notes)})" if notes else "")
    return f'{it["n"]}. "{it["text"]}" | {kind} | {it["address"]}'


def map_text(cm: dict[str, Any]) -> str:
    """The clickable list as plain lines (what a voice caller reads): visible ones in reading order, then scroll to see."""
    if not cm.get("items"):
        return "Clickable: nothing the console can click was found on this screen."
    out: list[str] = []
    if cm.get("source") == "targets":
        out.append("Clickable (from the console's target list; this console page is older than the screen map, so the order is not reading order and "
                   "some may be out of sight; reload the console for the full map):")
    else:
        out.append("Clickable now, in reading order (number. \"words\" | kind | address). Click one with console_click_text (its words or its number):")
    left = MAX_LISTED
    for it in cm["visible"][:left]:
        out.append(_line(it))
    left -= min(left, len(cm["visible"]))
    if cm.get("scroll"):
        out.append("Scroll to see (drawn, but out of sight):")
        for it in cm["scroll"][:left]:
            out.append(_line(it))
        left -= min(left, len(cm["scroll"]))
    hidden = len(cm["items"]) - (MAX_LISTED - left)
    if hidden > 0 or cm.get("truncated"):
        out.append(f"(and {hidden} more not listed)" if hidden > 0 else "(the screen has more than the map holds)")
    return "\n".join(out)


# ---------------------------------------------------------------------- the last list per console ("click 4")

_last: dict[str, tuple[float, dict[str, Any]]] = {}
_last_lock = threading.Lock()


def remember(to: str, cm: dict[str, Any]) -> None:
    with _last_lock:
        _last[to or "recent"] = (_now(), cm)
        for k in [k for k, (at, _) in _last.items() if _now() - at > LAST_TTL_S]:
            _last.pop(k, None)


def last(to: str) -> dict[str, Any] | None:
    with _last_lock:
        hit = _last.get(to or "recent")
    return hit[1] if hit and _now() - hit[0] <= LAST_TTL_S else None


# ---------------------------------------------------------------------- find by words

def _norm(s: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).strip()


def number_of(text: str) -> int | None:
    """"4", "click 4", "number four", "#4" → 4. Anything else → None."""
    m = NUMBER_RE.match(re.sub(r"\s+", " ", str(text or "").strip().lower()))
    if not m:
        return None
    w = m.group(1)
    if w.isdigit():
        return int(w)
    return NUMBER_WORDS.get(w)


def _tier(q: str, words: str) -> float:
    """How well the said words match an item's words: 4 exact, 3 the words in order, 2 every word, 1.x close spelling, 0 no."""
    if not q or not words:
        return 0
    if q == words:
        return 4
    if f" {q} " in f" {words} ":
        return 3 + (0.5 if words.startswith(q + " ") else 0)
    if q.replace(" ", "") == words.replace(" ", ""):
        return 3  # the same letters, spaced another way ("re try")
    qs, ws = q.split(), words.split()
    if all(w in ws or (len(w) >= 3 and any(x.startswith(w) for x in ws)) for w in qs):
        return 2
    # close spelling: each said word against the item's nearest word (a slip of transcription: "pendding", "orchestrater")
    if all(any(difflib.SequenceMatcher(None, a, b).ratio() >= FUZZY_MIN for b in ws) for a in qs):
        return 1 + min(0.9, difflib.SequenceMatcher(None, q, words).ratio() * 0.9)
    whole = difflib.SequenceMatcher(None, q, words).ratio()
    return 1 + whole * 0.5 if whole >= FUZZY_MIN else 0


def find(cm: dict[str, Any], text: str, nth: int = 0, kind: str = "", by_number: dict[str, Any] | None = None) -> dict[str, Any]:
    """The item to click. → {pick} | {matches: [...]} (several: say which, by `nth`) | {none: True, nearest: [...]}.
    `by_number` = the list a bare number refers to (the last description's; default this one)."""
    said = _clean(text, 200)
    role = KIND_WORDS.get(_norm(kind), _norm(kind)) if kind else ""
    pool = [i for i in cm.get("items") or [] if not role or i.get("kind") == role or i.get("controlKind") == role]
    q = _norm(said)
    num = number_of(said)
    exact = [i for i in pool if q and q in (_norm(i["text"]), _norm(i.get("label")))]
    if num is not None and not exact:
        src = by_number if by_number is not None else cm
        hit = next((i for i in src.get("items") or [] if i.get("n") == num), None)
        if hit is None:
            return {"none": True, "message": f"there is no number {num} in the last list ({len(src.get('items') or [])} items)", "nearest": []}
        return {"pick": hit, "how": "number"}
    def rank(words: str, among: list[dict[str, Any]]) -> list[tuple[float, dict[str, Any]]]:
        got = ((max(_tier(words, _norm(i["text"])), _tier(words, _norm(i.get("label")))), i) for i in among)
        return sorted(((s, i) for s, i in got if s > 0), key=lambda p: -p[0])

    scored = rank(q, pool)
    if not scored:
        # said as a sentence ("click the retry button"): without the filler, and with a kind it names
        words = [w for w in q.split() if w not in FILLER]
        named = next((KIND_WORDS[w] for w in words if w in KIND_WORDS), "") if not role else ""
        bare = " ".join(w for w in words if not (named and KIND_WORDS.get(w) == named))
        if bare and bare != q:
            scored = rank(bare, [i for i in pool if not named or i.get("kind") == named or i.get("controlKind") == named]) or rank(" ".join(words), pool)
    if not scored:
        near = difflib.get_close_matches(q, [_norm(i["text"]) for i in pool], n=5, cutoff=0.5)
        return {"none": True, "message": f'nothing on the screen says "{said}"' + (f" (as a {role})" if role else ""),
                "nearest": [i for i in pool if _norm(i["text"]) in near][:5]}
    best = int(scored[0][0])  # the tier: every match in it is as good a reading of the words as the first
    hits = [i for s, i in scored if int(s) == best]
    on_screen = [i for i in hits if i.get("on") != "scroll"]
    hits = sorted(on_screen or hits, key=lambda i: i.get("n", 0))
    if len(hits) == 1:
        return {"pick": hits[0], "how": ("", "close spelling", "every word", "words in order", "exact")[best]}
    if nth:
        if 1 <= nth <= len(hits):
            return {"pick": hits[nth - 1], "how": f"match {nth} of {len(hits)}"}
        return {"matches": hits, "message": f'{len(hits)} things match "{said}": nth must be 1 to {len(hits)}'}
    return {"matches": hits, "message": f'{len(hits)} things match "{said}": say which (nth = 1 to {len(hits)}, or the number in the list)'}


def click_command(item: dict[str, Any], confirm: bool = False, reason: str = "", to: str = "recent") -> dict[str, Any]:
    """The console-control@1 command that does what a click on the item does: a button or function is pressed, a tab is
    opened, a row or step is brought into focus and expanded, a setting gets the focus, a plugin is opened."""
    kind = item.get("controlKind") or "button"
    verb = {"button": "press", "function": "press", "tab": "open", "subtab": "open", "plugin": "open"}.get(kind, "focus")
    body: dict[str, Any] = {"verb": verb, "address": item["address"], "to": to or "recent"}
    if verb == "focus":
        body["options"] = {"select": True, "expand": True}
    if confirm:
        body["confirm"] = True
    if reason:
        body["reason"] = reason
    return body


# ---------------------------------------------------------------------- the description

_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_cache_lock = threading.Lock()
_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="screen-describe")


def cache_key(png_b64: str, question: str = "") -> str:
    return hashlib.sha256(png_b64.encode() + b"\0" + question.strip().lower().encode()).hexdigest()


def _cached(key: str) -> dict[str, Any] | None:
    with _cache_lock:
        hit = _cache.get(key)
        if hit and _now() - hit[0] <= CACHE_TTL_S:
            return hit[1]
        _cache.pop(key, None)
    return None


def _keep(key: str, value: dict[str, Any]) -> None:
    with _cache_lock:
        _cache[key] = (_now(), value)
        for k in [k for k, (at, _) in _cache.items() if _now() - at > CACHE_TTL_S]:
            _cache.pop(k, None)
        for k in sorted(_cache, key=lambda k: _cache[k][0])[:max(0, len(_cache) - CACHE_MAX)]:
            _cache.pop(k, None)


def _llm() -> Any | None:
    try:
        import plugin_services  # the console's registry (absent in stdio mode)
    except ImportError:
        return None
    return plugin_services.get(LLM_CAPABILITY)


def pick_profile(llm: Any) -> tuple[str, str] | None:
    """The provider that describes: AXF_SCREEN_DESCRIBE_PROFILE when set, else the first ready Claude API provider (they
    take images; the Claude Code subscription provider is text only). → (profile id, model) or None.
    The model is that provider's own when it is Opus or Fable, else Opus; AXF_SCREEN_DESCRIBE_MODEL overrides it."""
    try:
        profiles = [p for p in llm.profiles() if isinstance(p, dict) and p.get("enabled", True) is not False]
    except Exception:  # noqa: BLE001 — a provider store that cannot be read is no provider
        return None
    want = os.environ.get("AXF_SCREEN_DESCRIBE_PROFILE", "").strip()
    prof = next((p for p in profiles if p.get("id") == want), None) if want else None
    if prof is None:
        prof = next((p for p in profiles if p.get("kind") in VISION_KINDS and p.get("keyReady", True)), None)
    if prof is None:
        return None
    own = str(prof.get("defaultModel") or "")
    model = os.environ.get("AXF_SCREEN_DESCRIBE_MODEL", "").strip() or (own if MODEL_RE.search(own) else DEFAULT_MODEL)
    return str(prof["id"]), model


def usd_of(model: str, usage: dict[str, Any]) -> float | None:
    """What one call cost, from its token counts and framework/schemas/model-pricing.json. None when the model has no price."""
    try:
        doc = json.loads(_PRICING_FILE.read_text())
    except (OSError, ValueError):
        return None
    key = next((k for k in ("fable", "opus", "sonnet", "haiku") if k in str(model or "").lower()), "")
    p = (doc.get("models") or {}).get(key)
    if not p or p.get("input") is None or p.get("output") is None:
        return None
    return round((int(usage.get("input", 0) or 0) * p["input"] + int(usage.get("output", 0) or 0) * p["output"]) / 1e6, 4)


def prompt(state: dict[str, Any] | None, cm: dict[str, Any], question: str = "") -> str:
    s = state or {}
    facts = [f"Screen (from the console): {s.get('screenLabel') or s.get('screen') or 'unknown'}"]
    if s.get("dialog"):
        facts.append(f"Open dialog: {s['dialog']}")
    if isinstance(s.get("tabs"), dict) and s["tabs"]:
        facts.append("Open tab of each tab row: " + "; ".join(f"{k} = {v}" for k, v in list(s["tabs"].items())[:12]))
    listed = "\n".join(_line(i) for i in cm.get("visible", [])[:80]) or "(none found)"
    ask = (f'First answer this question about the screen in one or two lines, starting with "Answer:": {question.strip()}\nThen the description.\n\n'
           if question.strip() else "")
    return (
        f"{ask}Describe this screenshot.\n\n" + "\n".join(facts) + "\n\n"
        "The console says these controls are visible (number. \"exact words\" | kind | address):\n" + listed + "\n\n"
        "Write, in this order, one short line each, leaving out a part that is not on the image:\n"
        "Screen: its name and what it is showing.\n"
        "Headings: every visible heading and section title, exact words.\n"
        "Tabs: every tab, exact words, and which one is open.\n"
        "Buttons and labels: every visible button, label, field and menu item, exact words. When one is in the list above, "
        "put its number after it in square brackets, like Save [4]; do not repeat addresses.\n"
        "Rows: each list or table row with its text and its status (running, failed, done, counts, times), top to bottom.\n"
        "Banners, errors, dialogs: exact words of any banner, warning, error, toast or dialog.\n"
        "Numbers: counts, totals, percentages, dates and times that are shown, with what they belong to.\n"
        "Unreadable: anything too small or cut off to read.\n"
        "At most 350 words. No guessing."
    )


def _run(llm: Any, profile: str, model: str, png_b64: str, mime: str, state: dict[str, Any] | None, cm: dict[str, Any], question: str, key: str) -> dict[str, Any]:
    t0 = _now()
    r = llm.complete([{"role": "user", "content": prompt(state, cm, question), "images": [{"media_type": mime or "image/png", "data": png_b64}]}],
                     system=SYSTEM, profile=profile, model=model, params={"max_tokens": MAX_TOKENS})
    text = str(r.get("text") or "").strip()
    if not text:
        raise RuntimeError("the model answered with no text")
    usage = r.get("usage") if isinstance(r.get("usage"), dict) else {}
    out = {"text": text, "by": {"profile": str(r.get("profile") or profile), "model": str(r.get("model") or model), "seconds": round(_now() - t0, 1),
                                "tokens": {"input": int(usage.get("input", 0) or 0), "output": int(usage.get("output", 0) or 0)},
                                "usd": usd_of(str(r.get("model") or model), usage), "cached": False}}
    _keep(key, out)
    return out


def describe(png_b64: str, mime: str = "image/png", state: dict[str, Any] | None = None, cm: dict[str, Any] | None = None, question: str = "",
             llm: Any | None = None, timeout: float = DESCRIBE_TIMEOUT_S) -> dict[str, Any]:
    """Describe one screenshot. → {text, by: {profile, model, seconds, tokens, usd, cached}} or {text: "", note: why}.
    Never raises: a missing provider, a model error and a timeout each come back as `note`. A call that timed out keeps
    running and fills the cache, so asking again within two minutes answers at once."""
    key = cache_key(png_b64, question)
    hit = _cached(key)
    if hit is not None:
        return {**hit, "by": {**hit["by"], "cached": True, "usd": 0.0, "seconds": 0.0}}
    llm = llm if llm is not None else _llm()
    if llm is None:
        return {"text": "", "note": "no description: the console has no model service running (capability axf.llm@1, the AI assistant). The image and the clickable list are still here."}
    pick = pick_profile(llm)
    if pick is None:
        return {"text": "", "note": "no description: no Claude API provider is set up for images (Settings → Plugins → AI assistant). The image and the clickable list are still here."}
    fut = _pool.submit(_run, llm, pick[0], pick[1], png_b64, mime, state, cm or {"visible": [], "items": []}, question, key)
    try:
        return fut.result(timeout=timeout)
    except FutureTimeout:
        return {"text": "", "note": f"no description yet: {pick[1]} took longer than {int(timeout)} s. The image and the clickable list are here; ask again in a moment for the description (it is still being written)."}
    except Exception as e:  # noqa: BLE001 — the screenshot still goes back
        return {"text": "", "note": f"no description: the model call failed ({type(e).__name__}: {str(e)[:200]}). The image and the clickable list are still here."}


def screen_text(state: dict[str, Any] | None, cm: dict[str, Any], desc: dict[str, Any] | None, lead: str = "") -> str:
    """What a caller that drops images reads: the lead line (what was clicked), the description (or why there is none),
    then the numbered clickable list."""
    s = state or {}
    parts: list[str] = [lead] if lead else []
    head = f"Screen: {s.get('screenLabel') or s.get('screen') or 'unknown'}" + (f" (dialog open: {s['dialog']})" if s.get("dialog") else "")
    if desc is None:
        parts.append(head)
    elif desc.get("text"):
        parts.append(desc["text"])
    else:
        parts.append(f"{head}\n{desc.get('note') or 'no description'}")
    parts.append(map_text(cm))
    return "\n\n".join(parts)

