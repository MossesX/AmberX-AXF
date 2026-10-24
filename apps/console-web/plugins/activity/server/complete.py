"""What happens when an activity item finishes, and when one is closed from the banner (Brett, Oct 24 2026).

Settings (the feed's config.json, edited in Settings → Plugins → Activity → "When something finishes"):
  push        off | all | done | failed   send a phone notification through axHub when an item finishes
  pushLevel   info | warning | error      level of the console alert it raises (phones get error+ unless changed in
                                          Settings → Alerts); a failure is always raised as an error
  pushMinS    only push for work that ran at least this long (seconds)
  onClose     changes | delete            closing a finished item from the banner moves it to the Codebase changes
                                          banner (axf.changes@1), or just deletes it
  onAutoRemove delete | changes           same, when it leaves by itself (lingerS after it finished)
  (sound, toast, expandOnDone, openResult are done by the browser; the server only stores them)

Push through axHub: one hub-notification@1 file per notification in axHub's shared inbox
(`/projects/_shared/_data/notifications/inbox/<YYYY>/<MM>/`, `AXF_NOTIFY_INBOX` overrides, `off` = none; group
readable so the hub serves it), plus a console alert (key `activity:<id>`), which is what reaches the phone today
(Patches serves console alerts; ntfy / web push per Settings → Alerts). Nothing here holds a secret: titles and
details are already redacted by the feed.

Completions are found by watching states (``scan``): an item seen active and now finished, or one that started and
finished between two looks after this process started. ``seen.json`` keeps the last state per id, so a restart
doesn't push everything again.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import storage

ACTIVE = ("queued", "running", "waiting")
PUSH = ("off", "all", "done", "failed")
LEVELS = ("info", "warning", "error")
CLOSE = ("changes", "delete")
SOUND = ("off", "all", "failed")
DEFAULTS: dict[str, Any] = {
    "autoRemove": True, "keepFailed": False, "onClose": "changes", "onAutoRemove": "delete",
    "push": "off", "pushLevel": "error", "pushMinS": 0,
    "sound": "off", "toast": True, "expandOnDone": False, "openResult": False,
}
CHOICES = {"onClose": CLOSE, "onAutoRemove": CLOSE, "push": PUSH, "pushLevel": LEVELS, "sound": SOUND}
CHANGES = "axf.changes@1"
CHANGE_KIND = {"build": "build", "edit": "edit", "delete": "remove", "fix": "fix"}
MAX_SEEN = 600


def clean(c: dict[str, Any]) -> dict[str, Any]:
    """The completion settings out of a config dict, every value checked (unknown → default)."""
    out = {}
    for k, d in DEFAULTS.items():
        v = c.get(k, d)
        if k in CHOICES:
            out[k] = v if v in CHOICES[k] else d
        elif isinstance(d, bool):
            out[k] = v if isinstance(v, bool) else d
        else:
            out[k] = max(0, min(86400, int(v))) if isinstance(v, (int, float)) and not isinstance(v, bool) else d
    return out


def patch(cur: dict[str, Any], p: dict[str, Any]) -> dict[str, Any]:
    """Applies a settings patch; raises ValueError on a bad value (so the UI can say which)."""
    out = dict(cur)
    for k, d in DEFAULTS.items():
        if k not in p:
            continue
        v = p[k]
        if k in CHOICES:
            if v not in CHOICES[k]:
                raise ValueError(f"{k} is one of {', '.join(CHOICES[k])}")
        elif isinstance(d, bool):
            if not isinstance(v, bool):
                raise ValueError(f"{k} is true or false")
        else:
            if not isinstance(v, (int, float)) or isinstance(v, bool) or v < 0 or v > 86400:
                raise ValueError(f"{k} is a number of seconds (0–86400)")
            v = int(v)
        out[k] = v
    return out


def _iso(ms: Any) -> str | None:
    if not isinstance(ms, (int, float)):
        return None
    t = datetime.fromtimestamp(ms / 1000, timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


def inbox_dir() -> Path | None:
    env = os.environ.get("AXF_NOTIFY_INBOX")
    if env is not None:
        return Path(env) if env and env != "off" else None
    projects = Path(os.environ.get("AXHUB_PROJECTS_DIR") or "/projects")
    return projects / "_shared" / "_data" / "notifications" if projects.is_dir() else None


def wants_push(cfg: dict[str, Any], it: dict[str, Any]) -> bool:
    mode = cfg.get("push", "off")
    if mode == "off":
        return False
    failed = it["state"] in ("failed", "stale")
    if (mode == "done" and failed) or (mode == "failed" and not failed):
        return False
    took = ((it.get("finishedAt") or it["updatedAt"]) - it["startedAt"]) / 1000
    return took >= cfg.get("pushMinS", 0)


def notification(it: dict[str, Any], now_ms: int) -> dict[str, Any]:
    failed = it["state"] in ("failed", "stale")
    word = {"done": "Done", "failed": "Failed", "cancelled": "Cancelled", "stale": "No word"}.get(it["state"], "Finished")
    nid = f"{now_ms}-{hashlib.sha256(it['id'].encode()).hexdigest()[:10]}"
    return {"$axf": "hub-notification@1", "id": nid, "app": "axf-console", "source": "activity", "about": it["id"],
            "kind": it.get("kind", "task"), "state": it["state"], "title": f"{word}: {it['title']}"[:160],
            "body": (it.get("detail") or "")[:500], "url": it.get("url"), "priority": "high" if failed else "normal",
            "at": _iso(now_ms)}


class Completer:
    def __init__(self, data_dir: Path, snapshot: Callable[[], dict[str, Any]], config: Callable[[], dict[str, Any]],
                 dismiss: Callable[[str], bool], changes: Callable[[], Any] = lambda: None,
                 raise_alert: Callable[[dict[str, Any]], Any] = lambda a: None,
                 inbox: Callable[[], Path | None] = inbox_dir, now: Callable[[], float] = time.time) -> None:
        self.dir = data_dir
        self.snapshot = snapshot
        self.config = config
        self.dismiss = dismiss
        self.changes = changes
        self.raise_alert = raise_alert
        self.inbox = inbox
        self.now = now
        self.started_ms = int(now() * 1000)
        self.lock = threading.Lock()
        self.last_push: dict[str, Any] | None = None

    # ---------------- state record

    def _seen(self) -> dict[str, dict[str, Any]]:
        try:
            d = json.loads((self.dir / "seen.json").read_text("utf-8"))
            return {k: v for k, v in d.items() if isinstance(k, str) and isinstance(v, dict)} if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save(self, d: dict[str, dict[str, Any]]) -> None:
        if len(d) > MAX_SEEN:
            d = dict(list(d.items())[-MAX_SEEN:])
        self.dir.mkdir(parents=True, exist_ok=True)
        storage.write_json(self.dir / "seen.json", d, indent=None, dir_mode=None)

    # ---------------- watching

    def scan(self, items: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
        """Finds what finished since the last look and runs the completion actions. Returns the newly finished."""
        cfg = self.config()
        if items is None:
            items = self.snapshot()["items"]
        done: list[dict[str, Any]] = []
        with self.lock:
            prev = self._seen()
            rec: dict[str, dict[str, Any]] = {}
            for it in items:
                p = prev.get(it["id"])
                if it["state"] in ACTIVE:
                    rec[it["id"]] = {"s": it["state"]}
                    continue
                newly = (p is not None and p.get("s") in ACTIVE) or (p is None and (it.get("finishedAt") or 0) >= self.started_ms)
                if newly:
                    done.append(it)
                rec[it["id"]] = {"s": it["state"], "item": {k: it.get(k) for k in ("id", "kind", "source", "title", "detail", "state", "startedAt", "finishedAt", "updatedAt", "url")},
                                 "moved": bool(p and p.get("moved"))}
            # finished items that left by themselves (lingerS) → the Codebase changes banner when asked to
            if cfg.get("onAutoRemove") == "changes":
                for iid, p in prev.items():
                    if iid not in rec and p.get("item") and not p.get("moved"):
                        self._move(p["item"])
            self._save(rec)
        for it in done:
            if wants_push(cfg, it):
                self.push(it, cfg)
        return done

    # ---------------- push through axHub

    def push(self, it: dict[str, Any], cfg: dict[str, Any] | None = None) -> dict[str, Any]:
        cfg = cfg or self.config()
        now = int(self.now() * 1000)
        n = notification(it, now)
        res: dict[str, Any] = {"at": now, "title": n["title"], "hub": None, "alert": None}
        d = self.inbox()
        if d is None:
            res["hub"] = "axHub's shared folder isn't mounted here (/projects)"
        else:
            try:
                folder = d / "inbox" / n["at"][:4] / n["at"][5:7]
                folder.mkdir(parents=True, exist_ok=True)
                p = folder / f"{n['id']}.json"
                tmp = p.with_suffix(".tmp")
                tmp.write_text(json.dumps(n), "utf-8")
                os.chmod(tmp, 0o664)  # the hub reads it (same group, setgid tree)
                os.replace(tmp, p)
                res["hub"] = "sent"
            except OSError as e:
                res["hub"] = f"couldn't write to axHub: {e.strerror or e}"
        try:
            failed = it["state"] in ("failed", "stale")
            link = it.get("url") if str(it.get("url") or "").startswith("https://") else "settings:activity"
            self.raise_alert({"source": "activity", "severity": "error" if failed else cfg.get("pushLevel", "error"),
                              "title": n["title"], "body": n["body"][:300] or None, "key": f"activity:{it['id']}", "link": link})
            res["alert"] = "raised"
        except Exception as e:  # noqa: BLE001 — a push never breaks the feed
            res["alert"] = f"failed: {str(e)[:120]}"
        self.last_push = res
        return res

    # ---------------- closing from the banner

    def _move(self, it: dict[str, Any]) -> str | None:
        """A finished item into the Codebase changes log, open (not closed), so it shows in that banner."""
        if it.get("source") == "changes":
            return None  # it's already there
        svc = self.changes()
        if svc is None:
            return None
        st = it.get("state")
        res_state = {"done": "done", "failed": "failed", "cancelled": "cancelled", "stale": "failed"}.get(st, "partial")
        word = {"done": "Done", "failed": "Failed", "cancelled": "Cancelled", "stale": "No word from it (stopped without saying)"}.get(st, "Finished")
        entry = {"kind": CHANGE_KIND.get(it.get("kind"), "other"), "title": str(it.get("title") or "Activity")[:160],
                 "asked": str(it.get("detail") or "")[:600],
                 "result": {"state": res_state, "summary": f"{word} (from the Activity banner)" + (f"\n{it['detail']}" if it.get("detail") else "") + (f"\n{it['url']}" if it.get("url") else "")},
                 "status": "failed" if res_state == "failed" else "done", "surface": "activity"}
        for k in ("startedAt", "finishedAt"):
            v = _iso(it.get(k))
            if v:
                entry[k] = v
        try:
            e = svc.open(entry, "activity")
            return e.get("id")
        except Exception:  # noqa: BLE001
            return None

    def close(self, iid: str, items: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        """✕ on a finished item: moved to the Codebase changes banner (or deleted, per onClose), then off this banner
        on every device."""
        cfg = self.config()
        items = self.snapshot()["items"] if items is None else items
        it = next((i for i in items if i["id"] == iid), None)
        if it is None:
            raise KeyError(iid)
        if it["state"] in ACTIVE:
            raise ValueError("it's still going; close it once it has finished (or use the trash can when it's stuck)")
        moved = None
        if cfg.get("onClose") == "changes" and it.get("source") != "changes":
            moved = self._move(it)
            if moved is None:
                self.forget(iid)
                self.dismiss(iid)
                return {"removed": True, "movedTo": None, "note": "The Codebase changes plugin isn't on, so it was just removed."}
        self.forget(iid)  # never moved twice
        self.dismiss(iid)
        return {"removed": True, "movedTo": moved, "alreadyInChanges": it.get("source") == "changes"}

    def forget(self, iid: str) -> None:
        """Drop an item from the state record (the trash can: deleted, never moved by onAutoRemove)."""
        with self.lock:
            s = self._seen()
            if s.pop(iid, None) is not None:
                self._save(s)


def start_watcher(c: Completer, every_s: float = 15.0) -> threading.Thread:
    """Looks for finished items every 15 s, so pushes go out with no console page open."""
    def loop() -> None:
        while True:
            time.sleep(every_s)
            try:
                c.scan()
            except Exception:  # noqa: BLE001 — never stops
                pass
    t = threading.Thread(target=loop, name="activity-complete", daemon=True)
    t.start()
    return t
