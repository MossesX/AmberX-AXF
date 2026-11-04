"""Build to-do sync — server part. Mounted at /api/plugins/build-todo-sync/ (console token on every method, 404 when
the plugin is off).

The builds store (builds@1) is the source of truth; the AmberX to-do manager holds a synced view of every build
(Builds › <Category> › <name>, one item per orchestrator step). The rules are the framework's build-todo-sync@1
(framework/core/build-todo-sync.mjs, run through this plugin's sync.mjs); the to-do manager is reached only through the
control@1 capability (amberx.lists / amberx.items), and the orchestrator through its planner.builds target, so this
plugin depends on no other plugin's folder.

    GET  /state                 on/off, last sync, drift, open asks, builds still to name, subscriber health
    GET  /names?all=1           builds whose name / category await Brett, with suggestions
    GET  /suggest?title=&detail= a short name + category for a title
    POST /name                  {id, displayName?, category?, area?}: name a build / confirm the suggestion
    POST /sync                  {dry?, full?}: sync now (dry = plan only)
    GET  /asks                  open owner asks (an item Brett ticked / unticked in the to-do manager)
    POST /asks/{id}             {decision: approve | deny} — owner only
    GET  /settings · PUT /settings
    POST /events                a builds store event (framework/cli/builds-events.mjs) → a sync soon
    GET  /stream                server-sent events: {type: state | synced | ask | names}

Live: store events arrive on /events (debounced), a poll on the store file's mtime catches anything missed, and a full
reconcile every `reconcileMinutes` refreshes the sync note. Off (plugin disabled or setting `on` false): nothing syncs
and the Builds list's note says since when.
Data: .axf-console/plugins/build-todo-sync/ (AXF_BUILD_TODO_SYNC_DATA_DIR): settings.json, links.json, asks.json,
state.json, sync.log. Capability build-todo-sync@1: plugin_services.get("build-todo-sync@1").sync() / .state() / .name().
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

import console_context as cx
import plugin_services

router = APIRouter()
FOLDER = "build-todo-sync"
CAP = "build-todo-sync@1"
FRAME = "build-todo-sync@1"
ROOT = Path(__file__).resolve().parents[5]
SYNC_CLI = Path(__file__).resolve().parents[1] / "sync.mjs"
STORE_REL = "_claude/builds/store.json"
CATEGORIES = ("Plugin", "Plugin extension", "Add-on", "Framework", "App", "Feature", "Module")
HEALTH_ID = "build-todo-sync"
DEFAULTS: dict[str, Any] = {"on": True, "completedDays": 7, "reconcileMinutes": 10, "pollSeconds": 60, "linkBase": "", "autoPrompt": True, "debounceSeconds": 1.5}
MAX_LOG = 400

_lock = threading.Lock()          # one sync at a time
_state_lock = threading.Lock()
_clients: dict[str, dict[str, Any]] = {}
_pending = {"timer": None, "reasons": []}
_health_done = False


# ---------------------------------------------------------------------- files

def data_dir() -> Path:
    return Path(os.environ.get("AXF_BUILD_TODO_SYNC_DATA_DIR") or (ROOT / ".axf-console" / "plugins" / FOLDER))


def _read(name: str, default: Any) -> Any:
    try:
        return json.loads((data_dir() / name).read_text())
    except (OSError, ValueError):
        return default


def _write(name: str, value: Any) -> None:
    d = data_dir()
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f"{name}.tmp-{os.getpid()}"
    tmp.write_text(json.dumps(value, indent=1) + "\n")
    tmp.replace(d / name)


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _log(line: str) -> None:
    d = data_dir()
    d.mkdir(parents=True, exist_ok=True)
    f = d / "sync.log"
    try:
        lines = f.read_text().splitlines()[-(MAX_LOG - 1):] if f.exists() else []
    except OSError:
        lines = []
    lines.append(f"{_now_iso()} {line}")
    f.write_text("\n".join(lines) + "\n")
    cx.log("build-todo-sync", line, "info")


def settings() -> dict[str, Any]:
    s = _read("settings.json", {})
    out = dict(DEFAULTS)
    if isinstance(s, dict):
        for k, v in s.items():
            if k in DEFAULTS and type(v) is type(DEFAULTS[k]) or (k in DEFAULTS and isinstance(v, (int, float)) and isinstance(DEFAULTS[k], (int, float))):
                out[k] = v
    out["completedDays"] = max(0, min(90, int(out["completedDays"])))
    out["reconcileMinutes"] = max(1, min(240, int(out["reconcileMinutes"])))
    out["pollSeconds"] = max(10, min(3600, int(out["pollSeconds"])))
    out["linkBase"] = str(out["linkBase"])[:300]
    return out


def save_settings(patch: dict[str, Any], by: str) -> dict[str, Any]:
    cur = _read("settings.json", {})
    cur = cur if isinstance(cur, dict) else {}
    for k, v in patch.items():
        if k in DEFAULTS:
            cur[k] = v
    cur["updatedAt"] = _now_iso()
    cur["by"] = by[:80]
    _write("settings.json", cur)
    s = settings()
    broadcast({"type": "state", "settings": s})
    return s


def state() -> dict[str, Any]:
    st = _read("state.json", {})
    return st if isinstance(st, dict) else {}


def save_state(patch: dict[str, Any]) -> dict[str, Any]:
    with _state_lock:
        st = state()
        st.update(patch)
        _write("state.json", st)
    return st


def links() -> dict[str, Any]:
    l = _read("links.json", {})
    return l if isinstance(l, dict) else {}


def asks() -> list[dict[str, Any]]:
    a = _read("asks.json", [])
    return [x for x in a if isinstance(x, dict)] if isinstance(a, list) else []


def open_asks() -> list[dict[str, Any]]:
    return [a for a in asks() if a.get("state") == "open"]


# ---------------------------------------------------------------------- the capability services this plugin uses

def _control() -> Any | None:
    try:
        return plugin_services.get("control@1")
    except Exception:  # noqa: BLE001
        return None


def control(command: dict[str, Any]) -> dict[str, Any]:
    """One control@1 command as this plugin (full grants: it runs as the console). → the data part of the envelope."""
    svc = _control()
    if svc is None:
        raise RuntimeError("control@1 is not available (the Token control plugin is off): the to-do manager can't be reached")
    r = svc.run(command, ["*"], by=FOLDER)
    if not isinstance(r, dict):
        raise RuntimeError("control@1 answered nothing")
    if r.get("ok") is False:
        raise RuntimeError(f"{command.get('op')} {command.get('target')}: {r.get('message') or r.get('code') or 'refused'}")
    data = r.get("data")
    return data if isinstance(data, dict) else r


def _node(*args: str, stdin: str | None = None, timeout: int = 60) -> dict[str, Any]:
    env = {k: v for k, v in os.environ.items() if k not in ("AXF_APPROVER", "AXF_APPROVER_VIA")}
    proc = subprocess.run(["node", str(SYNC_CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=timeout, input=stdin, env=env)
    lines = proc.stdout.strip().splitlines()
    try:
        res = json.loads(lines[-1]) if lines else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        res = {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}
    if not res.get("ok"):
        raise RuntimeError(res.get("error") or "sync.mjs failed")
    return res


# ---------------------------------------------------------------------- the snapshot of the to-do manager

def _rows(data: dict[str, Any]) -> list[dict[str, Any]]:
    items = data.get("items")
    return [x for x in items if isinstance(x, dict)] if isinstance(items, list) else []


def snapshot(current_links: dict[str, Any]) -> dict[str, Any]:
    """Every AmberX list, and every item in the lists the mirror owns (the root's tree), as plan() wants them."""
    lists = _rows(control({"op": "list", "target": "amberx.lists"}))
    root_id = (current_links.get("lists") or {}).get("root") or next((l["id"] for l in lists if l.get("parent") in (None, "") and str(l.get("name", "")).strip().lower() == "builds"), None)
    items: list[dict[str, Any]] = []
    if root_id:
        by_parent: dict[str, list[dict[str, Any]]] = {}
        for l in lists:
            by_parent.setdefault(str(l.get("parent") or ""), []).append(l)
        # root's own items (the sync note) + every build list under every group: one query per list keeps each under the 500 cap
        want = [root_id] + [g["id"] for g in by_parent.get(root_id, [])] + [b["id"] for g in by_parent.get(root_id, []) for b in by_parent.get(g["id"], [])]
        seen: set[str] = set()
        for lid in want:
            for it in _rows(control({"op": "list", "target": "amberx.items", "select": {"list": lid, "deep": False, "limit": 500}})):
                if it.get("id") not in seen and it.get("list") == lid:
                    seen.add(it["id"])
                    items.append(it)
    return {"lists": [{"id": l["id"], "name": l.get("name", ""), "parent": l.get("parent"), "order": l.get("order", 0)} for l in lists if l.get("id")],
            "items": [{k: it.get(k) for k in ("id", "list", "title", "text", "status", "tags", "order", "url", "updatedAt", "doneAt")} for it in items]}


# ---------------------------------------------------------------------- running the plan

def _resolve(v: Any, refs: dict[str, str]) -> Any:
    if isinstance(v, str) and v.startswith("$ref:"):
        r = refs.get(v[5:])
        if not r:
            raise RuntimeError(f"unresolved {v}")
        return r
    if isinstance(v, list):
        return [_resolve(x, refs) for x in v]
    if isinstance(v, dict):
        return {k: _resolve(x, refs) for k, x in v.items()}
    return v


def run_ops(ops: list[dict[str, Any]]) -> tuple[dict[str, str], list[str]]:
    """Run the plan's control@1 commands in order; → (refs, errors). A failed op is logged and the rest go on."""
    refs: dict[str, str] = {}
    errors: list[str] = []
    for op in ops:
        cmd = {k: v for k, v in op.items() if k not in ("ref", "why")}
        try:
            cmd = _resolve(cmd, refs)
            cmd["by"] = FOLDER
            cmd.setdefault("reason", {"title": "Build to-do sync", "description": op.get("why") or "keep the build's to-do list equal to its steps"})
            r = control(cmd)
            if op.get("ref"):
                item = r.get("item") if isinstance(r.get("item"), dict) else {}
                if item.get("id"):
                    refs[op["ref"]] = str(item["id"])
                else:
                    errors.append(f"{op.get('ref')}: no id in the answer")
        except Exception as e:  # noqa: BLE001
            errors.append(f"{op.get('op')} {op.get('target')} {op.get('path') or op.get('ref') or ''}: {str(e)[:200]}")
    return refs, errors


def _resolve_links(l: dict[str, Any], refs: dict[str, str]) -> dict[str, Any]:
    out = {"$axf": FRAME, "lists": {}, "items": {}, "updatedAt": l.get("updatedAt") or _now_iso()}
    for k in ("lists", "items"):
        for name, id_ in (l.get(k) or {}).items():
            if isinstance(id_, str) and id_.startswith("$ref:"):
                r = refs.get(id_[5:])
                if r:
                    out[k][name] = r
            elif isinstance(id_, str) and id_:
                out[k][name] = id_
    return out


def _status_note(s: dict[str, Any], on: bool) -> dict[str, str]:
    when = time.strftime("%b %-d %Y %H:%M UTC", time.gmtime())
    if on:
        return {"title": "Synced by Build to-do sync", "text": f"These lists mirror the Build orchestrator (one list per build, one item per step; done builds in Done for {s['completedDays']} days, cancelled in Archive).\nLast sync: {when}. Ticking an item here asks Brett before it changes the step. If this time is old, Build to-do sync is off or stuck: Dev Console → Settings → Plugins → Build to-do sync."}
    return {"title": "Build to-do sync is OFF", "text": f"These lists stopped syncing with the Build orchestrator at {when}. Builds keep running; turn the plugin back on in the Dev Console (Settings → Plugins → Build to-do sync) and they catch up."}


def sync_now(reason: str = "manual", dry: bool = False, full: bool = False, by: str = "console") -> dict[str, Any]:
    """Plan against the store, run the commands, keep links / asks / state. Serialized; → a report."""
    s = settings()
    enabled = s["on"] and cx.plugin_enabled(FOLDER)
    if not _lock.acquire(timeout=120):
        return {"ok": False, "error": "a sync is already running", "reason": reason}
    started = time.time()
    try:
        cur_links = links()
        snap = snapshot(cur_links)
        payload = {"lists": snap["lists"], "items": snap["items"], "links": cur_links, "asks": asks(), "now": _now_iso(),
                   "opts": {"linkBase": s["linkBase"], "completedDays": s["completedDays"], "statusNote": _status_note(s, enabled)}}
        plan = _node("plan", stdin=json.dumps(payload), timeout=120)
        ops = plan.get("ops") or []
        if not enabled:
            # off: only the note changes (so the lists say so); nothing else is touched
            ops = [o for o in ops if o.get("ref") == "item:status-note" or (o.get("why") == "the sync note")]
        report: dict[str, Any] = {"ok": True, "reason": reason, "dry": dry, "enabled": enabled, "summary": plan.get("summary"), "drift": plan.get("drift") or [], "ops": len(ops), "errors": [], "at": _now_iso()}
        if dry:
            report["plan"] = ops
            return report
        refs, errors = run_ops(ops)
        report["errors"] = errors
        new_links = _resolve_links(plan.get("links") or cur_links, refs) if enabled else cur_links
        if enabled or refs:
            if not enabled:
                new_links = dict(cur_links)
                new_links.setdefault("items", {})
                if refs.get("item:status-note"):
                    new_links["items"]["status-note"] = refs["item:status-note"]
            _write("links.json", new_links)
        new_asks = plan.get("asks") if isinstance(plan.get("asks"), list) else asks()
        before = {a["id"] for a in open_asks()}
        _write("asks.json", new_asks)
        fresh = [a for a in new_asks if a.get("state") == "open" and a["id"] not in before]
        st = save_state({"lastSync": report["at"], "lastReason": reason, "lastOk": not errors, "lastError": "; ".join(errors)[:600], "lastSummary": plan.get("summary"), "lastMs": int((time.time() - started) * 1000),
                         "storeMtime": _store_mtime(), "builds": plan.get("builds") or [], "drift": report["drift"], "enabled": enabled, **({"lastFull": report["at"]} if full else {})})
        _log(f"sync ({reason}{', dry' if dry else ''}{'' if enabled else ', OFF'}): {len(ops)} op(s), {len(report['drift'])} drift, {len(errors)} error(s), {st['lastMs']} ms")
        # Brett's own ticks on the Planned & fixes items apply straight away (his checklist; the store stays the truth)
        for d in report["drift"]:
            if d.get("kind") in ("fix-ticked", "fix-unticked") and d.get("fix"):
                try:
                    control({"op": "act", "target": "planner.builds", "path": d["build"], "action": "fix-set", "input": {"fix": d["fix"], "done": d["kind"] == "fix-ticked"}, "by": "to-do manager",
                             "reason": {"title": f"{'Check' if d['kind'] == 'fix-ticked' else 'Reopen'} {d.get('fixId') or d['fix']} on {d['build']}", "description": "Brett ticked it in the to-do manager."}})
                except Exception as e:  # noqa: BLE001
                    errors.append(f"fix {d.get('fixId')}: {str(e)[:120]}")
        if enabled and (full or ops or by != "console"):
            plans_sync(by if by else FOLDER)
        broadcast({"type": "synced", "at": report["at"], "summary": plan.get("summary"), "errors": errors, "drift": len(report["drift"]), "openAsks": len([a for a in new_asks if a.get("state") == "open"])})
        for a in fresh:
            broadcast({"type": "ask", "ask": a})
            try:
                cx.raise_alert({"source": FOLDER, "severity": "info", "key": f"{FOLDER}:ask:{a['id']}", "title": a.get("title", "A to-do item changed"),
                                "body": "Approve to change the step in the Build orchestrator, deny to put the item back.", "link": "view:build-todo-sync"})
            except Exception:  # noqa: BLE001
                pass
        return report
    except Exception as e:  # noqa: BLE001
        msg = str(e)[:600]
        save_state({"lastSync": _now_iso(), "lastReason": reason, "lastOk": False, "lastError": msg})
        _log(f"sync ({reason}) failed: {msg}")
        broadcast({"type": "synced", "at": _now_iso(), "errors": [msg]})
        return {"ok": False, "error": msg, "reason": reason}
    finally:
        _lock.release()


def _store_mtime() -> float:
    try:
        return (ROOT / STORE_REL).stat().st_mtime
    except OSError:
        return 0.0


def sync_soon(reason: str) -> None:
    """Debounce: many store writes in a row = one sync."""
    s = settings()
    with _state_lock:
        _pending["reasons"].append(reason)
        if os.environ.get("AXF_BUILD_TODO_SYNC_NO_CLOCK") == "1":
            return  # tests run _run_pending() themselves
        t = _pending.get("timer")
        if t is not None:
            t.cancel()
        t = threading.Timer(float(s["debounceSeconds"]), _run_pending)
        t.daemon = True
        _pending["timer"] = t
        t.start()


def _run_pending() -> None:
    with _state_lock:
        reasons = list(_pending["reasons"])
        _pending["reasons"] = []
        _pending["timer"] = None
    sync_now(reason=f"event ×{len(reasons)}: {reasons[-1] if reasons else ''}"[:80])


# ---------------------------------------------------------------------- the clock: poll the store file, reconcile on a timer

def _tick() -> None:
    try:
        s = settings()
        st = state()
        last_full = st.get("lastFull") or ""
        due_full = not last_full or (time.time() - _parse(last_full)) > s["reconcileMinutes"] * 60
        if due_full:
            sync_now(reason="reconcile", full=True)
        elif _store_mtime() and _store_mtime() != st.get("storeMtime"):
            sync_now(reason="store changed")
    except Exception as e:  # noqa: BLE001
        _log(f"tick failed: {str(e)[:200]}")
    finally:
        _schedule_tick()


def _parse(iso: str) -> float:
    try:
        return time.mktime(time.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone
    except (ValueError, OverflowError):
        return 0.0


def _schedule_tick() -> None:
    if os.environ.get("AXF_BUILD_TODO_SYNC_NO_CLOCK") == "1":
        return
    t = threading.Timer(float(settings()["pollSeconds"]), _tick)
    t.daemon = True
    t.start()


# ---------------------------------------------------------------------- Plan Studio: a plan per build (plans@1), its Planned & fixes and docs

def _plans() -> Any | None:
    try:
        return plugin_services.get("plans@1")
    except Exception:  # noqa: BLE001
        return None


def plans_sync(by: str = FOLDER, only: list[str] | None = None) -> dict[str, Any]:
    """Every mirrored build gets a Plan Studio plan (same name, category, verbatim ask, steps, status) with a managed
    block for Planned & fixes and Docs; existing plans are refreshed, Brett's own text kept."""
    svc = _plans()
    if svc is None:
        return {"ok": False, "error": "plans@1 is not available (Plan Studio off): no plans synced", "created": 0, "changed": 0}
    s = settings()
    try:
        existing = svc.list()
        payload = {"plans": existing if isinstance(existing, list) else [], "now": _now_iso(), "opts": {"completedDays": s["completedDays"], "linkBase": s["linkBase"], **({"only": only} if only else {})}}
        r = _node("plans", stdin=json.dumps(payload), timeout=180)
    except Exception as e:  # noqa: BLE001
        save_state({"plans": {"at": _now_iso(), "ok": False, "error": str(e)[:300]}})
        return {"ok": False, "error": str(e)[:300], "created": 0, "changed": 0}
    errors: list[str] = []
    saved = 0
    for p in r.get("plans") or []:
        if not p.get("changed") or not isinstance(p.get("plan"), dict):
            continue
        try:
            res = svc.save(p["plan"], by, True)
            if isinstance(res, dict) and res.get("ok") is False:
                errors.append(f"{p['planId']}: {res.get('error') or 'refused'}")
            else:
                saved += 1
        except Exception as e:  # noqa: BLE001
            errors.append(f"{p.get('planId')}: {str(e)[:200]}")
    summary = {"at": _now_iso(), "ok": not errors, "builds": (r.get("summary") or {}).get("builds", 0), "created": (r.get("summary") or {}).get("created", 0), "changed": (r.get("summary") or {}).get("changed", 0), "saved": saved, "errors": errors[:20],
               "plans": {p["buildId"]: {"planId": p["planId"], "docsStatus": p.get("docsStatus")} for p in r.get("plans") or []}}
    save_state({"plans": summary})
    if saved or errors:
        _log(f"plans: {saved} saved, {len(errors)} error(s)")
    return {"ok": not errors, **summary}


def _build_view(build_id: str) -> dict[str, Any]:
    try:
        return _node("build", build_id, timeout=90)["build"]
    except RuntimeError as e:
        raise HTTPException(404, str(e)[:200]) from None


def _orch_act(build_id: str, action: str, inp: dict[str, Any], by: str, title: str, description: str) -> dict[str, Any]:
    r = control({"op": "act", "target": "planner.builds", "path": build_id, "action": action, "input": inp, "by": by, "reason": {"title": title[:120], "description": description[:400]}})
    sync_soon(action)
    item = r.get("item") if isinstance(r.get("item"), dict) else {}
    return {"ok": True, "build": {"id": item.get("id", build_id), "displayName": item.get("displayName"), "fixes": item.get("fixes", [])}, "log": r.get("log", [])}


def fix_add(build_id: str, text: str, kind: str, note: str, link: str, by: str) -> dict[str, Any]:
    if not text.strip():
        raise HTTPException(400, "text is required")
    k = kind if kind in ("planned", "fix", "bug") else "fix"
    return _orch_act(build_id, "fix-add", {"text": text.strip()[:500], "kind": k, "note": note[:2000], "link": link[:500]}, by, f"Add a {k} to {build_id}", f"{by} adds \"{text.strip()[:80]}\" to the build's Planned & fixes checklist (plan + to-do list follow).")


def fix_set(build_id: str, fix: str, patch: dict[str, Any], by: str) -> dict[str, Any]:
    inp: dict[str, Any] = {"fix": fix}
    for k in ("done", "text", "note", "link", "kind"):
        if k in patch and patch[k] is not None:
            inp[k] = patch[k]
    what = "checks off" if inp.get("done") is True else "reopens" if inp.get("done") is False else "edits"
    return _orch_act(build_id, "fix-set", inp, by, f"{what.capitalize()} {fix} on {build_id}", f"{by} {what} a Planned & fixes item.")


def fix_remove(build_id: str, fix: str, by: str) -> dict[str, Any]:
    return _orch_act(build_id, "fix-remove", {"fix": fix}, by, f"Remove {fix} from {build_id}", f"{by} removes a Planned & fixes item.")


def note_add(build_id: str, said: str, source: str, by: str) -> dict[str, Any]:
    """A later thing Brett said about a build: an addendum on its origin (build-origin@1, framework CLI), which the
    plan's comments and managed block pick up on the next plans sync."""
    if not said.strip():
        raise HTTPException(400, "said is required: Brett's words, verbatim")
    cli = ROOT / "framework" / "cli" / "build-origin.mjs"
    args = ["node", str(cli), "addendum", build_id, "--said", said.strip()[:8000], "--by", by[:80]]
    if source in ("voice", "chat", "console", "code"):
        args += ["--source", source]
    proc = subprocess.run([*args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=60)
    lines = proc.stdout.strip().splitlines()
    try:
        res = json.loads(lines[-1]) if lines else {"ok": False, "error": proc.stderr.strip()[-400:]}
    except json.JSONDecodeError:
        res = {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-400:]}
    if not res.get("ok", True):
        raise HTTPException(400, str(res.get("error") or "addendum refused")[:300])
    sync_soon("note")
    threading.Thread(target=plans_sync, args=(by, [build_id]), daemon=True).start()
    return {"ok": True, "build": build_id, "addendum": res}


def plan_of(build_id: str) -> dict[str, Any] | None:
    svc = _plans()
    if svc is None:
        return None
    try:
        for p in svc.list() or []:
            if isinstance(p, dict) and ((p.get("build") or {}).get("id") == build_id):
                return p
    except Exception:  # noqa: BLE001
        return None
    return None


def todo_list_of(build_id: str) -> dict[str, Any]:
    """The build's to-do list as the to-do manager holds it now (list + items), or what is missing."""
    cur = links()
    lid = (cur.get("lists") or {}).get(f"build:{build_id}")
    if not lid:
        return {"ok": True, "build": build_id, "list": None, "items": [], "note": "no list yet: run a sync"}
    items = _rows(control({"op": "list", "target": "amberx.items", "select": {"list": lid, "deep": False, "limit": 500}}))
    items.sort(key=lambda i: (i.get("order") or 0))
    lst = control({"op": "get", "target": "amberx.lists", "path": lid}).get("item")
    return {"ok": True, "build": build_id, "list": lst, "items": [{k: i.get(k) for k in ("id", "title", "status", "tags", "order", "url", "updatedAt", "doneAt")} for i in items]}


# ---------------------------------------------------------------------- names

def name_build(build_id: str, display_name: str | None, category: str | None, area: str | None, by: str) -> dict[str, Any]:
    """Name a build through the orchestrator (control@1 planner.builds act name): the id never changes."""
    if not build_id:
        raise HTTPException(400, "id is required")
    inp: dict[str, Any] = {}
    if display_name is not None:
        n = str(display_name).strip()[:48]
        if not n:
            raise HTTPException(400, "a build needs a short name")
        inp["displayName"] = n
    if category is not None:
        c = next((x for x in CATEGORIES if x.lower() == str(category).strip().lower()), None)
        if not c:
            raise HTTPException(400, f"category must be one of {', '.join(CATEGORIES)}")
        inp["category"] = c
    if area is not None:
        inp["area"] = str(area).strip()[:60]
    r = control({"op": "act", "target": "planner.builds", "path": build_id, "action": "name", "input": inp, "by": by,
                 "reason": {"title": f"Name build {build_id}", "description": f"{by} names the build \"{inp.get('displayName', '(as suggested)')}\" ({inp.get('category', 'category kept')}) for the to-do manager."}})
    item = r.get("item") if isinstance(r.get("item"), dict) else r
    broadcast({"type": "names", "build": build_id, "displayName": item.get("displayName"), "category": item.get("category")})
    _log(f"{build_id} named {json.dumps(inp)} by {by}")
    sync_soon("named")
    return {"ok": True, "build": item}


# ---------------------------------------------------------------------- asks (owner-only ticks)

def owner_of(request: Request) -> str:
    """Brett's own click (his signed-in hub session in the console) or a console with no token at all; else ''."""
    user = getattr(request.state, "axf_user", None)
    if user is None:
        return "console" if not cx.current_token() else ""
    if getattr(user, "via", "") == "session" and getattr(user, "admin", False):
        return str(getattr(user, "name", "") or "brett")[:80]
    return ""


def answer_ask(ask_id: str, decision: str, by: str) -> dict[str, Any]:
    all_asks = asks()
    a = next((x for x in all_asks if x.get("id") == ask_id), None)
    if not a:
        raise HTTPException(404, f"no ask {ask_id}")
    if a.get("state") != "open":
        raise HTTPException(409, f"ask {ask_id} is already {a.get('state')}")
    if decision not in ("approve", "deny"):
        raise HTTPException(400, "decision is approve or deny")
    done = a.get("kind") == "ticked"
    if decision == "approve":
        control({"op": "act", "target": "planner.builds", "path": a["build"], "action": "step", "input": {"step": a.get("stepId") or a["step"], "done": done}, "by": by,
                 "reason": {"title": f"{'Tick' if done else 'Reopen'} step {a.get('stepId') or a['step']} of {a['build']}", "description": f"{by} approved the change made in the to-do manager."}})
    else:
        step = _node("step", a["build"], a["step"]).get("step") or {}
        control({"op": "set", "target": "amberx.items", "path": a["item"], "value": {"status": "done" if step.get("done") else "open"}, "by": by,
                 "reason": {"title": "Put a to-do item back", "description": f"{by} denied the change; the item follows the step again."}})
    a["state"] = "approved" if decision == "approve" else "denied"
    a["by"] = by[:80]
    a["closedAt"] = _now_iso()
    _write("asks.json", all_asks)
    try:
        cx.resolve_alerts([f"{FOLDER}:ask:{ask_id}"])
    except Exception:  # noqa: BLE001
        pass
    _log(f"ask {ask_id} {a['state']} by {by}")
    broadcast({"type": "ask", "ask": a})
    sync_soon("ask answered")
    return {"ok": True, "ask": a}


# ---------------------------------------------------------------------- streams

def broadcast(frame: dict[str, Any]) -> int:
    msg = {"$axf": FRAME, "at": _now_iso(), **frame}
    n = 0
    with _state_lock:
        for c in list(_clients.values()):
            q, loop = c.get("queue"), c.get("loop")
            if q is not None and loop is not None:
                try:
                    loop.call_soon_threadsafe(q.put_nowait, msg)
                    n += 1
                except RuntimeError:
                    pass
    return n


# ---------------------------------------------------------------------- health (axf.health@1)

def health_probe() -> dict[str, Any]:
    s = settings()
    st = state()
    if not s["on"]:
        return {"status": "warning", "summary": "Build to-do sync is switched off: the to-do lists are not following the builds.", "details": ["Settings → Plugins → Build to-do sync → On."]}
    if _control() is None:
        return {"status": "error", "summary": "Build to-do sync can't reach the to-do manager: control@1 (Token control plugin) is off.", "details": ["Turn the Token control plugin on in the Plugin Manager."]}
    last = st.get("lastSync") or ""
    age = (time.time() - _parse(last)) / 60 if last else None
    opens = open_asks()
    missing = [d for d in (st.get("drift") or []) if d.get("kind") == "list-missing"]
    if last and not st.get("lastOk"):
        return {"status": "error", "summary": f"The last build to-do sync failed: {st.get('lastError', '')[:160]}", "details": ["Auto fix runs a sync again; the log is in the plugin's data folder (sync.log)."]}
    if age is None or age > 3 * s["reconcileMinutes"]:
        return {"status": "warning", "summary": f"No build to-do sync for {int(age) if age else '?'} min (it runs every {s['reconcileMinutes']}).", "details": ["Auto fix syncs now."]}
    extra = []
    if opens:
        extra.append(f"{len(opens)} item(s) ticked in the to-do manager wait for your OK (Build to-dos page).")
    if missing:
        extra.append(f"{len(missing)} build list(s) were deleted in the to-do manager and came back.")
    return {"status": "ok", "summary": f"Build to-do lists follow the builds (last sync {int(age)} min ago, {len((st.get('lastSummary') or {}).get('builds', 0) and [1]) and (st.get('lastSummary') or {}).get('builds', 0)} build(s))." if not extra else " ".join(extra), "details": extra}


def health_fix() -> dict[str, Any]:
    r = sync_now(reason="auto-fix", full=True, by="systems-check")
    return {"state": "done" if r.get("ok") and not r.get("errors") else "failed", "message": "synced" if r.get("ok") else str(r.get("error") or r.get("errors"))[:200]}


def ensure_health() -> bool:
    global _health_done
    if _health_done:
        return True
    reg = plugin_services.get("axf.health@1")
    if reg is None:
        return False
    try:
        reg.register({"id": HEALTH_ID, "label": "Build to-do lists follow the builds", "service": "console", "order": 64, "severity": "warning", "run": health_probe,
                      "breaks": "Brett's to-do manager stops showing live build progress; items he ticks there wait unanswered.",
                      "autoFix": {"label": "Sync now", "run": health_fix},
                      "instructions": ["Dev Console → Build to-dos → Sync now.", "On the VPS: `node apps/console-web/plugins/build-todo-sync/sync.mjs plan < snapshot.json` prints what would change."]}, FOLDER)
    except Exception:  # noqa: BLE001
        return False
    _health_done = True
    return True


def _register_later(tries: int = 12) -> None:
    if not ensure_health() and tries > 1:
        t = threading.Timer(5.0, _register_later, args=(tries - 1,))
        t.daemon = True
        t.start()


# ---------------------------------------------------------------------- routes

async def _body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > 65536:
        raise HTTPException(413, "too big")
    try:
        b = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "body must be JSON") from None
    if not isinstance(b, dict):
        raise HTTPException(400, "send a JSON object")
    return b


def _who(request: Request) -> str:
    user = getattr(request.state, "axf_user", None)
    return str(getattr(user, "name", "") or "console")[:80] if user is not None else "console"


@router.get("/state")
def get_state() -> dict[str, Any]:
    st = state()
    return {"ok": True, "settings": settings(), "enabled": settings()["on"] and cx.plugin_enabled(FOLDER), "control": _control() is not None,
            "lastSync": st.get("lastSync", ""), "lastOk": st.get("lastOk"), "lastError": st.get("lastError", ""), "lastSummary": st.get("lastSummary"), "lastReason": st.get("lastReason", ""), "lastFull": st.get("lastFull", ""),
            "builds": st.get("builds") or [], "drift": st.get("drift") or [], "openAsks": open_asks(), "links": {k: len(v) for k, v in links().items() if isinstance(v, dict)}, "clients": len(_clients)}


@router.get("/names")
def get_names(all: str = "") -> dict[str, Any]:  # noqa: A002 — the query parameter is called all
    r = _node("names", *(["--all"] if all in ("1", "true", "yes") else []))
    return {"ok": True, "builds": r.get("builds") or [], "categories": list(CATEGORIES)}


@router.get("/suggest")
def get_suggest(title: str = "", detail: str = "") -> dict[str, Any]:
    if not title.strip():
        raise HTTPException(400, "title is required")
    return _node("suggest", title.strip()[:300], *(["--detail", detail[:2000]] if detail else []))


@router.post("/name")
async def post_name(request: Request) -> dict[str, Any]:
    b = await _body(request)
    return await run_in_threadpool(name_build, str(b.get("id") or ""), b.get("displayName"), b.get("category"), b.get("area"), _who(request))


@router.post("/sync")
async def post_sync(request: Request) -> dict[str, Any]:
    b = await _body(request)
    return await run_in_threadpool(sync_now, "manual", b.get("dry") is True, b.get("full") is True, _who(request))


@router.get("/asks")
def get_asks(all: str = "") -> dict[str, Any]:  # noqa: A002
    return {"ok": True, "asks": asks() if all in ("1", "true", "yes") else open_asks()}


@router.post("/asks/{ask_id:path}")
async def post_ask(ask_id: str, request: Request) -> dict[str, Any]:
    b = await _body(request)
    who = owner_of(request)
    if not who:
        raise HTTPException(403, "only Brett answers an ask: his own signed-in console (not a token, a session or an agent)")
    return await run_in_threadpool(answer_ask, ask_id, str(b.get("decision") or ""), who)


@router.get("/plans")
def get_plans() -> dict[str, Any]:
    st = state()
    return {"ok": True, "plans": (st.get("plans") or {}), "available": _plans() is not None}


@router.post("/plans/sync")
async def post_plans_sync(request: Request) -> dict[str, Any]:
    b = await _body(request)
    only = [str(x) for x in b.get("builds", [])] if isinstance(b.get("builds"), list) else None
    return await run_in_threadpool(plans_sync, _who(request), only)


@router.get("/builds/{build_id}")
def get_build(build_id: str) -> dict[str, Any]:
    v = _build_view(build_id)
    p = plan_of(build_id)
    return {"ok": True, "build": v, "plan": {"id": p.get("id"), "status": p.get("status"), "title": p.get("title")} if p else None, "listId": (links().get("lists") or {}).get(f"build:{build_id}")}


@router.get("/builds/{build_id}/list")
def get_build_list(build_id: str) -> dict[str, Any]:
    return todo_list_of(build_id)


@router.get("/builds/{build_id}/plan")
def get_build_plan(build_id: str) -> dict[str, Any]:
    p = plan_of(build_id)
    if not p:
        return {"ok": True, "build": build_id, "plan": None, "note": "no plan yet: POST plan to make one"}
    return {"ok": True, "build": build_id, "plan": p, "open": f"nav:plan-studio?plan={p.get('id')}"}


@router.post("/builds/{build_id}/plan")
async def post_build_plan(build_id: str, request: Request) -> dict[str, Any]:
    _build_view(build_id)
    r = await run_in_threadpool(plans_sync, _who(request), [build_id])
    return {**r, "plan": plan_of(build_id)}


@router.get("/builds/{build_id}/docs")
def get_build_docs(build_id: str) -> dict[str, Any]:
    try:
        return _node("docs", build_id, timeout=90)
    except RuntimeError as e:
        raise HTTPException(404, str(e)[:200]) from None


@router.get("/builds/{build_id}/fixes")
def get_fixes(build_id: str) -> dict[str, Any]:
    v = _build_view(build_id)
    return {"ok": True, "build": build_id, "fixes": v.get("fixes", [])}


@router.post("/builds/{build_id}/fixes")
async def post_fix(build_id: str, request: Request) -> dict[str, Any]:
    b = await _body(request)
    return await run_in_threadpool(fix_add, build_id, str(b.get("text") or ""), str(b.get("kind") or "fix"), str(b.get("note") or ""), str(b.get("link") or ""), _who(request))


@router.put("/builds/{build_id}/fixes/{fix}")
async def put_fix(build_id: str, fix: str, request: Request) -> dict[str, Any]:
    b = await _body(request)
    return await run_in_threadpool(fix_set, build_id, fix, b, _who(request))


@router.delete("/builds/{build_id}/fixes/{fix}")
async def delete_fix(build_id: str, fix: str, request: Request) -> dict[str, Any]:
    return await run_in_threadpool(fix_remove, build_id, fix, _who(request))


@router.post("/builds/{build_id}/note")
async def post_note(build_id: str, request: Request) -> dict[str, Any]:
    b = await _body(request)
    return await run_in_threadpool(note_add, build_id, str(b.get("said") or b.get("text") or ""), str(b.get("source") or ""), _who(request))


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return {"ok": True, "settings": settings(), "defaults": DEFAULTS, "categories": list(CATEGORIES)}


@router.put("/settings")
async def put_settings(request: Request) -> dict[str, Any]:
    b = await _body(request)
    was = settings()["on"]
    s = save_settings(b.get("settings", b) if isinstance(b.get("settings", b), dict) else {}, _who(request))
    if s["on"] != was:
        _log(f"switched {'on' if s['on'] else 'off'}")
        sync_soon("switched")
    return {"ok": True, "settings": s}


@router.post("/events")
async def post_event(request: Request) -> dict[str, Any]:
    b = await _body(request)
    if b.get("$axf") != FRAME:
        raise HTTPException(400, f"not a {FRAME} frame")
    ids = [x.get("id") for x in (b.get("builds") or []) if isinstance(x, dict) and x.get("id")]
    sync_soon(f"{b.get('action') or 'write'} {', '.join(ids[:3])}".strip())
    return {"ok": True, "queued": True, "builds": ids}


@router.get("/stream")
async def stream(request: Request, client: str = "") -> StreamingResponse:
    cid = (client or f"c{int(time.time() * 1000)}")[:64]
    q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    loop = asyncio.get_running_loop()
    with _state_lock:
        _clients[cid] = {"queue": q, "loop": loop, "since": time.time()}

    async def gen():
        try:
            yield f"event: message\ndata: {json.dumps({'$axf': FRAME, 'type': 'hello', 'at': _now_iso(), 'state': get_state()})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    m = await asyncio.wait_for(q.get(), timeout=20)
                    yield f"event: message\ndata: {json.dumps(m)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            with _state_lock:
                if _clients.get(cid, {}).get("queue") is q:
                    del _clients[cid]
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------- capability

class BuildTodoSync:
    """build-todo-sync@1 for other plugins: state(), sync(reason, dry), name(id, displayName, category, area, by)."""

    router = router

    def state(self) -> dict[str, Any]:
        return get_state()

    def sync(self, reason: str = "plugin", dry: bool = False) -> dict[str, Any]:
        return sync_now(reason=reason, dry=dry)

    def name(self, build_id: str, display_name: str | None = None, category: str | None = None, area: str | None = None, by: str = "plugin") -> dict[str, Any]:
        return name_build(build_id, display_name, category, area, by)

    def fix(self, build_id: str, text: str, kind: str = "fix", note: str = "", link: str = "", by: str = "plugin") -> dict[str, Any]:
        return fix_add(build_id, text, kind, note, link, by)

    def plans(self, only: list[str] | None = None, by: str = "plugin") -> dict[str, Any]:
        return plans_sync(by, only)


plugin_services.provide(CAP, BuildTodoSync(), folder=FOLDER)
_register_later()
_schedule_tick()
