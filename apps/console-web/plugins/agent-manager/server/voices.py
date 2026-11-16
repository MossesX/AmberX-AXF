"""Voice picker for agents and personas: the voice catalogue per TTS provider and the hint matcher.

The voice slot ({provider, voiceId, hint, rate?, pitch?}, agent-definition@1) is filled from one of the providers:

  browser      the device's own voices (Web Speech in a browser, the phone's TTS in AmberX); the list comes from the
               device, so callers pass it in (`voices`); voiceId is the device voice name
  openai       OpenAI text-to-speech voices (fixed list, traits below); key kept by the Agent voice plugin
  elevenlabs   the account's ElevenLabs voices (listed by the Agent voice plugin with its key); callers pass them in

`match(hint, provider, voices)` turns a free-text hint ("cat-like", "calm", "deep british narrator") into traits, scores
every voice on them and returns the best voice plus a speed and pitch that fit the hint (cloud voices take the speed;
the pitch applies where the device speaks the line, e.g. group chat audio). Pure: no I/O.
"""
from __future__ import annotations

import re
from typing import Any

PROVIDERS = [
    {"id": "browser", "label": "Device voice", "about": "This device's own voices (browser speech, the phone's TTS in AmberX). Free, works offline."},
    {"id": "openai", "label": "OpenAI", "about": "OpenAI text-to-speech. Needs an OpenAI key in Agent voice → Cloud voices."},
    {"id": "elevenlabs", "label": "ElevenLabs", "about": "Your ElevenLabs voices. Needs an ElevenLabs key in Agent voice → Cloud voices."},
]
PROVIDER_IDS = [p["id"] for p in PROVIDERS]

# OpenAI voices and how they sound (traits from the provider's own descriptions).
OPENAI = [
    {"id": "alloy", "name": "Alloy", "traits": ["neutral", "balanced", "clear"]},
    {"id": "ash", "name": "Ash", "traits": ["male", "clear", "confident"]},
    {"id": "ballad", "name": "Ballad", "traits": ["male", "expressive", "british", "warm"]},
    {"id": "coral", "name": "Coral", "traits": ["female", "warm", "friendly", "bright"]},
    {"id": "echo", "name": "Echo", "traits": ["male", "calm", "soft"]},
    {"id": "fable", "name": "Fable", "traits": ["british", "expressive", "storyteller", "playful"]},
    {"id": "nova", "name": "Nova", "traits": ["female", "bright", "energetic", "playful", "young"]},
    {"id": "onyx", "name": "Onyx", "traits": ["male", "deep", "authoritative"]},
    {"id": "sage", "name": "Sage", "traits": ["female", "calm", "wise", "soft"]},
    {"id": "shimmer", "name": "Shimmer", "traits": ["female", "soft", "gentle", "calm"]},
    {"id": "verse", "name": "Verse", "traits": ["male", "expressive", "warm", "storyteller"]},
]

# Hint words → traits, and how each nudges speed and pitch (1 = as the voice is).
LEXICON: list[tuple[tuple[str, ...], list[str], float, float]] = [
    (("cat", "cat-like", "catlike", "feline", "kitten", "purr", "meow"), ["playful", "bright", "female", "young"], 1.1, 1.3),
    (("calm", "soothing", "relaxed", "chill", "serene", "peaceful"), ["calm", "soft"], 0.9, 0.95),
    (("gentle", "soft", "quiet", "whisper", "tender"), ["soft", "gentle", "calm"], 0.9, 1.0),
    (("deep", "low", "gravelly", "bass", "booming"), ["deep", "male"], 0.95, 0.75),
    (("authoritative", "boss", "commanding", "serious", "stern"), ["authoritative", "deep", "confident"], 0.95, 0.85),
    (("warm", "friendly", "kind", "cozy"), ["warm", "friendly"], 1.0, 1.0),
    (("bright", "cheerful", "happy", "sunny", "bubbly"), ["bright", "friendly", "energetic"], 1.1, 1.15),
    (("fast", "quick", "rapid", "snappy"), ["energetic"], 1.25, 1.0),
    (("energetic", "excited", "upbeat", "lively", "hyper", "peppy"), ["energetic", "bright"], 1.2, 1.1),
    (("slow", "measured", "deliberate", "unhurried"), ["calm"], 0.8, 1.0),
    (("high", "squeaky", "tiny", "small"), ["bright", "young"], 1.05, 1.35),
    (("playful", "cheeky", "mischievous", "fun", "silly", "witty"), ["playful", "expressive"], 1.1, 1.15),
    (("young", "kid", "child", "youthful"), ["young", "bright"], 1.1, 1.25),
    (("old", "elderly", "wise", "grandfather", "grandmother", "sage"), ["wise", "calm"], 0.85, 0.85),
    (("narrator", "storyteller", "story", "dramatic", "theatrical", "expressive"), ["storyteller", "expressive"], 0.95, 1.0),
    (("clear", "crisp", "precise", "direct", "professional"), ["clear", "confident"], 1.0, 1.0),
    (("confident", "bold", "assertive"), ["confident"], 1.0, 0.95),
    (("neutral", "plain", "balanced"), ["neutral", "balanced"], 1.0, 1.0),
    (("robot", "robotic", "monotone", "machine"), ["neutral"], 1.0, 0.6),
    (("female", "woman", "girl", "she", "her", "feminine", "lady"), ["female"], 1.0, 1.0),
    (("male", "man", "guy", "he", "him", "masculine", "dude"), ["male"], 1.0, 1.0),
    (("british", "uk", "english", "london", "posh"), ["british"], 1.0, 1.0),
    (("australian", "aussie"), ["australian"], 1.0, 1.0),
    (("irish",), ["irish"], 1.0, 1.0),
    (("scottish",), ["scottish"], 1.0, 1.0),
    (("indian",), ["indian"], 1.0, 1.0),
    (("american",), ["american"], 1.0, 1.0),
]
ACCENT_LANG = {"british": "en-GB", "australian": "en-AU", "irish": "en-IE", "scottish": "en-GB", "indian": "en-IN", "american": "en-US"}

# Device voice names that say who they are (macOS, Windows, Android, Chrome voices).
NAME_TRAITS: dict[str, list[str]] = {
    "samantha": ["female", "clear", "american"], "victoria": ["female", "calm"], "karen": ["female", "australian"],
    "moira": ["female", "irish", "warm"], "tessa": ["female", "bright"], "fiona": ["female", "scottish"],
    "zira": ["female", "clear"], "susan": ["female"], "hazel": ["female", "british", "soft"], "serena": ["female", "british", "calm"],
    "kate": ["female", "british"], "veena": ["female", "indian"], "allison": ["female", "warm"], "ava": ["female", "warm", "bright"],
    "daniel": ["male", "british", "calm"], "alex": ["male", "clear"], "fred": ["male", "neutral"], "david": ["male", "clear"],
    "mark": ["male", "confident"], "george": ["male", "british", "deep"], "rishi": ["male", "indian"], "tom": ["male", "friendly"],
    "oliver": ["male", "british"], "aaron": ["male"], "arthur": ["male", "british", "deep", "storyteller"], "junior": ["male", "young", "bright"],
    "whisper": ["soft", "gentle"], "bubbles": ["bright", "playful"], "bad news": ["deep"], "good news": ["bright", "energetic"],
    "female": ["female"], "male": ["male"], "natural": ["warm"], "neural": ["warm"], "enhanced": ["clear"], "premium": ["clear"],
}


def _words(text: str) -> list[str]:
    return [w for w in re.split(r"[^a-z\-]+", (text or "").lower()) if w]


def hint_traits(hint: str) -> dict[str, Any]:
    """Traits, speed and pitch from a free-text hint. Unknown words are ignored; no hint = neutral."""
    words = _words(hint)
    joined = " " + " ".join(words) + " "
    traits: list[str] = []
    rate = pitch = 1.0
    hits: list[str] = []
    for keys, ts, r, p in LEXICON:
        if any((" " + k + " ") in joined or (k.endswith("-like") and k in joined) for k in keys) or any(w.startswith(k) and len(k) > 3 for w in words for k in keys):
            hits.append(keys[0])
            for t in ts:
                if t not in traits:
                    traits.append(t)
            rate *= r
            pitch *= p
    if "female" in traits and "male" in traits:  # "female" also matches "male": keep the one the hint said
        traits.remove("male" if any(w in ("female", "woman", "girl", "she", "her", "feminine", "lady") for w in words) else "female")
    lang = next((ACCENT_LANG[t] for t in traits if t in ACCENT_LANG), "")
    return {"traits": traits, "rate": round(min(2.0, max(0.5, rate)), 2), "pitch": round(min(2.0, max(0.0, pitch)), 2), "lang": lang, "matched": hits}


def voice_traits(provider: str, v: dict[str, Any]) -> list[str]:
    """What a voice sounds like: OpenAI's known traits, else words in its name / labels / description."""
    if provider == "openai":
        hit = next((o for o in OPENAI if o["id"] == v.get("id")), None)
        if hit:
            return list(hit["traits"])
    text = " ".join(str(v.get(k) or "") for k in ("name", "category", "description", "gender", "accent", "labels")).lower()
    out: list[str] = []
    for name, ts in NAME_TRAITS.items():
        if re.search(r"\b" + re.escape(name) + r"\b", text):
            out += [t for t in ts if t not in out]
    for _keys, ts, _r, _p in LEXICON:
        for k in _keys:
            if len(k) > 3 and re.search(r"\b" + re.escape(k) + r"\b", text):
                out += [t for t in ts if t not in out]
    if "female" in out and "male" in out and not re.search(r"\bmale\b", text):
        out.remove("male")
    lang = str(v.get("lang") or "").lower()
    for t, code in ACCENT_LANG.items():
        if lang == code.lower() and t not in out:
            out.append(t)
    return out


def catalogue(provider: str, voices: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """The voices of one provider with their traits. browser / elevenlabs lists come from the caller."""
    if provider not in PROVIDER_IDS:
        raise ValueError(f"unknown voice provider {provider!r} (one of {', '.join(PROVIDER_IDS)})")
    raw = [dict(o) for o in OPENAI] if provider == "openai" and not voices else list(voices or [])
    out = []
    for v in raw[:300]:
        if not isinstance(v, dict):
            continue
        vid = str(v.get("id") or v.get("voiceId") or v.get("name") or "").strip()[:200]
        if not vid:
            continue
        item = {"id": vid, "name": str(v.get("name") or vid)[:200], "traits": voice_traits(provider, {**v, "id": vid})}
        if v.get("lang"):
            item["lang"] = str(v["lang"])[:20]
        out.append(item)
    return out


def match(hint: str, provider: str = "browser", voices: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Best voice for a hint: {provider, voiceId, name, rate, pitch, score, why, traits}. With no voices to choose from
    (a device list not sent yet) voiceId is '' and only speed and pitch are set; the device picks its default voice."""
    want = hint_traits(hint)
    cat = catalogue(provider, voices)
    best: dict[str, Any] | None = None
    best_score = -1.0
    lang_pref = want["lang"] or "en"
    for v in cat:
        score = 0.0
        for t in want["traits"]:
            if t in v["traits"]:
                score += 3 if t in ("female", "male") else 2
        if ("female" in want["traits"] and "male" in v["traits"]) or ("male" in want["traits"] and "female" in v["traits"]):
            score -= 4
        lang = str(v.get("lang") or "").lower()
        if lang:
            score += 1.5 if lang.startswith(lang_pref.lower()) else (-3 if not lang.startswith("en") else 0)
        if score > best_score:
            best, best_score = v, score
    why = (f"“{hint.strip()}” → " + (", ".join(want["traits"]) or "neutral")) if hint.strip() else "no hint: a neutral voice"
    if best:
        why += f"; {best['name']} ({', '.join(best['traits']) or 'no known traits'})"
    return {
        "provider": provider, "voiceId": best["id"] if best else "", "name": best["name"] if best else "",
        "rate": want["rate"], "pitch": want["pitch"],
        "score": round(max(best_score, 0.0), 2), "why": why, "traits": want["traits"],
    }
