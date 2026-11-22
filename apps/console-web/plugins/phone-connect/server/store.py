"""Phone Connect records through data-store@1 (namespace `phone`; the plugin folder maps there, data-store-paths.json).

    devices/<deviceId>.json   phone-device@1
    pairings/<code>.json      phone-pairing@1
    commands/<id>.json        phone-command@1 + {"results": [phone-result@1 …], "status": queued|sent|acked|done|failed}
    settings.json             per-feature switches (Settings → Plugins → Phone Connect)
    link.json                 the last device token the console refused (when, how often, why): "disconnected, re-pair"
    approvals.json            which waiting axHub approvals were already pushed to the phone (one prompt per approval)
    log.jsonl                 one line per issue, claim, revoke, command, ack, result, error (never a token)
"""
from __future__ import annotations

import threading
from typing import Any

import data_store

FOLDER = "phone-connect"
LOCK = threading.RLock()

# Per-feature switches; every one on by default. Open: a later feature adds its key here (the UI lists them all).
FEATURES: dict[str, dict[str, Any]] = {
    "open_url": {"label": "Open pages", "description": "The console and agents may open a page on the phone (inside its url policy). It opens by itself; a notification to tap is only the fallback."},
    "notify": {"label": "Notifications", "description": "FYIs, fix updates and alerts that pass the Notifications panel reach the phone."},
    "approval": {"label": "Approval prompts", "description": "Approvals and veto countdowns float over whatever is on the phone's screen with Approve and Deny on them (and as a notification); only your tap there decides."},
    "recorder": {"label": "Audio recorder", "description": "Start, stop and read the phone's audio-output recorder (a start always asks you first)."},
    "voice": {"label": "Voice line", "description": "The console assistant may say a line or listen once through the phone."},
    "follow": {"label": "Follow Amber on the phone", "description": "When Follow Amber is on and Amber shows a screen, the console also comes to the front on the phone at that screen."},
}
FEATURE_OF = {"open_url": "open_url", "notify": "notify", "approval": "approval", "recorder.start": "recorder",
              "recorder.stop": "recorder", "recorder.status": "recorder", "voice": "voice"}


def _pd() -> data_store.PluginData:
    return data_store.plugin(FOLDER)


def _list(kind: str) -> list[str]:
    return [f[: -len(".json")] for f in data_store.list_files(_pd().path(kind)) if f.endswith(".json") and "/" not in f]


# ---- devices

def device(device_id: str) -> dict | None:
    if not device_id or "/" in device_id or ".." in device_id:
        return None
    d = _pd().read_json(f"devices/{device_id}.json", None)
    return d if isinstance(d, dict) else None


def devices() -> list[dict]:
    out = [d for d in (device(i) for i in _list("devices")) if d]
    return sorted(out, key=lambda d: d.get("pairedAt") or d.get("updatedAt") or "", reverse=True)


def save_device(d: dict) -> dict:
    with LOCK:
        _pd().write_json(f"devices/{d['deviceId']}.json", d)
    return d


def forget_device(device_id: str) -> bool:
    with LOCK:
        return data_store.remove(_pd().path(f"devices/{device_id}.json"))


def paired() -> list[dict]:
    return [d for d in devices() if d.get("state") == "paired"]


# ---- pairings

def pairing(code: str) -> dict | None:
    if not code or not code.isalnum():
        return None
    p = _pd().read_json(f"pairings/{code}.json", None)
    return p if isinstance(p, dict) else None


def pairings() -> list[dict]:
    return [p for p in (pairing(c) for c in _list("pairings")) if p]


def pending_pairing() -> dict | None:
    for p in sorted(pairings(), key=lambda p: p.get("issuedAt") or "", reverse=True):
        if p.get("state") == "pending":
            return p
    return None


def save_pairing(p: dict) -> dict:
    with LOCK:
        _pd().write_json(f"pairings/{p['code']}.json", p)
    return p


# ---- commands

def command(cid: str) -> dict | None:
    if not cid or not all(ch.isalnum() or ch == "-" for ch in cid):
        return None
    c = _pd().read_json(f"commands/{cid}.json", None)
    return c if isinstance(c, dict) else None


def commands(device_id: str = "", limit: int = 100) -> list[dict]:
    out = [c for c in (command(i) for i in _list("commands")) if c and (not device_id or c.get("deviceId") == device_id)]
    return sorted(out, key=lambda c: c.get("at") or "", reverse=True)[:limit]


def save_command(c: dict) -> dict:
    with LOCK:
        _pd().write_json(f"commands/{c['id']}.json", c)
    return c


def drop_command(cid: str) -> bool:
    with LOCK:
        return data_store.remove(_pd().path(f"commands/{cid}.json"))


# ---- settings + log

LAYOUTS = ("tabs", "stacked", "split")  # the settings tab's layout (UI Review choice phone-connect-settings)


def settings() -> dict[str, Any]:
    s = _pd().read_json("settings.json", {})
    s = s if isinstance(s, dict) else {}
    feats = s.get("features") if isinstance(s.get("features"), dict) else {}
    layout = s.get("layout") if s.get("layout") in LAYOUTS else LAYOUTS[0]
    return {"features": {k: feats.get(k) is not False for k in FEATURES}, "layout": layout}


def save_settings(patch: dict[str, Any]) -> dict[str, Any]:
    with LOCK:
        cur = settings()
        feats = patch.get("features") if isinstance(patch.get("features"), dict) else {}
        for k, v in feats.items():
            if k in FEATURES and isinstance(v, bool):
                cur["features"][k] = v
        if patch.get("layout") in LAYOUTS:
            cur["layout"] = patch["layout"]
        _pd().write_json("settings.json", cur)
    return cur


def feature_on(command_name: str) -> bool:
    return settings()["features"].get(FEATURE_OF.get(command_name, ""), True)


def feature(key: str) -> bool:
    """A feature switch by its own key (the ones that are not one command: `follow`)."""
    return settings()["features"].get(key, True)


# ---- link (the last refused device token) + approvals already pushed

def link() -> dict[str, Any]:
    v = _pd().read_json("link.json", {})
    return v if isinstance(v, dict) else {}


def save_link(v: dict[str, Any]) -> dict[str, Any]:
    with LOCK:
        _pd().write_json("link.json", v)
    return v


def approvals() -> dict[str, Any]:
    v = _pd().read_json("approvals.json", {})
    v = v if isinstance(v, dict) else {}
    return {**v, "pushed": v.get("pushed") if isinstance(v.get("pushed"), dict) else {}}


def save_approvals(v: dict[str, Any]) -> dict[str, Any]:
    with LOCK:
        _pd().write_json("approvals.json", v)
    return v


def log(entry: dict[str, Any]) -> None:
    """One journal line; never a token. A log that can't be written never stops a call."""
    try:
        _pd().append_jsonl("log.jsonl", {k: v for k, v in entry.items() if k != "token"})
    except Exception:  # noqa: BLE001
        pass


def read_log(limit: int = 100) -> list[dict]:
    import json
    lines = (_pd().read_text("log.jsonl", "") or "").splitlines()[-limit:]
    out = []
    for ln in lines:
        try:
            out.append(json.loads(ln))
        except ValueError:
            pass
    return out
