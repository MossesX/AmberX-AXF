"""health@1 — live health checks for the banners (Brett, Oct 30 2026: "You need to make sure things like that go into one
of the banners. I need to see that kind of shit.").

  * **Registry** (capability `axf.health@1`): any plugin adds a check with `register({id, label, run, severity, service,
    breaks, fix, links, instructions, interval})`. `run()` answers a probe dict (status ok | warn | error | info |
    unknown, summary, details; `unreachable`, `expiresAt`, `link` optional). `severity` caps what a failure shows as
    (error = red, warn = amber). The systems check lists every registered check in its banner and dialog.
  * **Monitor**: runs the registry on a schedule (every 15 minutes, once when the console starts, and on Check now),
    caches the answers, and keeps a small memory per check (`health-state.json` in the plugin's dataDir): since when it
    has been in its state, and whether its red episode was already pushed.
  * **Annotate**: every item in the systems-check report (built-in checks too) gets `since` and `breaks`. A service that
    simply didn't answer stays amber for HOLD_S before it turns red, so one network blip doesn't page Brett.
  * **Push**: each item that turns red is raised once as a console alert (key `system:<id>`, the same key the alerts
    poller uses, so it's never two), which the AmberX app shows as a phone notification; it resolves when it's green.

No secret ever reaches a summary, a detail, the state file or the log.
"""
from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import storage

VERSION = 1
CAPABILITY = "axf.health@1"
INTERVAL_S = 15 * 60   # the schedule (Brett: every 15 minutes, plus console start and Check now)
FIRST_RUN_S = 20       # after the console starts, once its routes are up
MIN_FORCE_S = 30
HOLD_S = 10 * 60       # "couldn't reach it" stays amber this long before it turns red
STATUSES = ("ok", "warn", "error", "info", "unknown")

# What each check's failure breaks, in plain words (shown on the banner item and in the push). Plugins pass their own.
BREAKS: dict[str, str] = {
    "console-token": "Anyone who reaches the console can change the repo.",
    "github-token": "The push banner, auto-merge, branch cleanup, CI downloads and What's new can't reach GitHub.",
    "github-repo": "Console updates and builds pull from the wrong repo.",
    "anthropic-key": "The AI assistant and Mosses can't use the Anthropic API key.",
    "claude-credits": "The AI assistant, Mosses and Key Auto fix can't get answers from Claude.",
    "claude-code-token": "Headless Claude Code (Fix with Claude, build launches) can't sign in.",
    "hostinger-token": "DNS and VPS management from the console stop working.",
    "coolify": "Deploys and app status from the console stop working.",
    "axhub": "Approvals, shared data, Claude files sync, Mosses's hub calls and the /mcp proxy stop working.",
    "openai-key": "Voice features that use OpenAI stop working.",
    "elevenlabs-key": "Voice features that use ElevenLabs stop working.",
    "ntfy": "Phone alerts through ntfy stop arriving.",
    "push-path": "New red items don't reach the AmberX app on your phone.",
    "git-push": "Builds on the VPS can't push their branches, so their PRs never open.",
    "ci-main": "main is red: deploys and every new PR build on a broken base.",
    "builds-stuck": "The Build manager shows builds as running that nothing is working on.",
    "veto-calls": "A command a session sent through Vinnie never ran.",
    "containers": "That app is down or keeps crashing.",
    "disk": "Builds, Docker pulls, backups and databases fail once the disk fills.",
}

Item = dict[str, Any]


class Registry:
    """axf.health@1 — register / unregister / list health checks (plugins call this through plugin_services)."""
    version = VERSION

    def __init__(self) -> None:
        self._checks: dict[str, dict[str, Any]] = {}
        self._lock = threading.RLock()
        self.monitor: "Monitor | None" = None

    def register(self, spec: dict[str, Any], owner: str = "") -> str:
        cid = str(spec.get("id") or "").strip()
        if not cid or not callable(spec.get("run")):
            raise ValueError("a health check needs an id and a run() function")
        sev = spec.get("severity") if spec.get("severity") in ("error", "warn") else "error"
        with self._lock:
            self._checks[cid] = {"id": cid, "label": str(spec.get("label") or cid), "run": spec["run"], "severity": sev,
                                 "service": str(spec.get("service") or "health"), "breaks": str(spec.get("breaks") or BREAKS.get(cid, "")),
                                 "fix": spec.get("fix"), "links": list(spec.get("links") or []), "instructions": list(spec.get("instructions") or []),
                                 "interval": max(60, int(spec.get("interval") or INTERVAL_S)), "order": int(spec.get("order") or 80),
                                 "owner": owner or str(spec.get("owner") or ""), "when": spec.get("when")}
        return cid

    def unregister(self, cid: str) -> None:
        with self._lock:
            self._checks.pop(cid, None)
        if self.monitor:
            self.monitor.forget(cid)

    def unregister_owner(self, owner: str) -> None:
        for cid in [k for k, v in self.checks().items() if v["owner"] == owner]:
            self.unregister(cid)

    def checks(self) -> dict[str, dict[str, Any]]:
        with self._lock:
            return dict(self._checks)

    # service API for other plugins: read the latest answers, ask for a run
    def results(self) -> list[Item]:
        return self.monitor.items() if self.monitor else []

    def run(self, force: bool = True) -> list[Item]:
        return self.monitor.run(force) if self.monitor else []


class Monitor:
    def __init__(self, registry: Registry, item: Callable[..., Item], state_file: Callable[[], Path], *,
                 raise_alert: Callable[[dict[str, Any]], Any] = lambda a: None, resolve: Callable[[list[str]], Any] = lambda k: None,
                 log: Callable[..., None] = lambda *a, **k: None, clock: Callable[[], float] = time.time) -> None:
        self.reg = registry
        registry.monitor = self
        self.item = item
        self.state_file = state_file
        self.raise_alert = raise_alert
        self.resolve = resolve
        self.log = log
        self.clock = clock
        self._lock = threading.RLock()
        self._results: dict[str, tuple[float, Item]] = {}
        self._mem: dict[str, dict[str, Any]] | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.last_run = 0.0

    # ---------------------------------------------------- running

    def _one(self, spec: dict[str, Any]) -> Item | None:
        when = spec.get("when")
        try:
            if callable(when) and not when():
                return None  # not configured here (e.g. no OpenAI key): no item at all
            r = spec["run"]() or {}
        except Exception as e:  # noqa: BLE001 — a broken check is reported, never fatal
            r = {"status": "unknown", "summary": f"The check itself failed: {str(e)[:160]}"}
        st = r.get("status") if r.get("status") in STATUSES else "unknown"
        if st == "error" and spec["severity"] == "warn":
            st = "warn"
        fix = r.get("fix", spec["fix"])
        fix = fix() if callable(fix) else fix
        links = [*(r.get("links") or []), *spec["links"]]
        if r.get("link") and str(r["link"]).startswith("https://"):
            links.insert(0, {"label": "Open it", "url": str(r["link"])})
        it = self.item(spec["id"], spec["service"], spec["label"], st, str(r.get("summary") or "")[:400], details=[str(d)[:300] for d in (r.get("details") or [])][:12],
                       fix=fix if st in ("error", "warn") else None, instructions=spec["instructions"], links=links, order=spec["order"])
        it["health"] = True
        it["breaks"] = str(r.get("breaks") or spec["breaks"])
        for k in ("unreachable", "expiresAt", "expiring"):
            if r.get(k):
                it[k] = r[k]
        if spec["owner"]:
            it["owner"] = spec["owner"]
        return it

    def run(self, force: bool = False) -> list[Item]:
        now = self.clock()
        force = force and now - self.last_run >= MIN_FORCE_S  # many callers force; the services see at most one run per 30 s
        due = [s for s in self.reg.checks().values() if force or now - self._results.get(s["id"], (0.0, {}))[0] >= s["interval"]]
        if due:
            with ThreadPoolExecutor(max_workers=6) as ex:
                got = list(ex.map(self._one, due))
            with self._lock:
                for s, it in zip(due, got):
                    if it is None:
                        self._results.pop(s["id"], None)
                    else:
                        self._results[s["id"]] = (now, it)
            self.last_run = now
        return self.annotate(self.items())  # pushes new red items even when no browser is open

    def run_ids(self, ids: list[str]) -> list[Item]:
        """Run these checks now (a row's Check again); answers only the ones that apply here."""
        specs = [self.reg.checks()[i] for i in ids if i in self.reg.checks()]
        now = self.clock()
        out = []
        for s in specs:
            it = self._one(s)
            with self._lock:
                if it is None:
                    self._results.pop(s["id"], None)
                else:
                    self._results[s["id"]] = (now, it)
                    out.append(dict(it))
        return out

    def items(self) -> list[Item]:
        known = self.reg.checks()
        with self._lock:
            return [dict(it) for cid, (_, it) in self._results.items() if cid in known]

    def forget(self, cid: str) -> None:
        with self._lock:
            self._results.pop(cid, None)

    def start(self) -> None:
        if self._thread:
            return
        self._thread = threading.Thread(target=self._loop, name="systems-check-health", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        if self._stop.wait(FIRST_RUN_S):
            return
        while not self._stop.is_set():
            try:
                self.run(force=True)
            except Exception as e:  # noqa: BLE001
                self.log("system", f"health checks failed to run: {str(e)[:160]}", "warn")
            if self._stop.wait(INTERVAL_S):
                break

    # ---------------------------------------------------- memory: since when, pushed once

    def _load(self) -> dict[str, dict[str, Any]]:
        if self._mem is None:
            raw = storage.read_json(self.state_file(), {})
            self._mem = {k: v for k, v in (raw.get("checks") or {}).items() if isinstance(v, dict)} if isinstance(raw, dict) else {}
        return self._mem

    def _save(self) -> None:
        try:
            storage.write_json(self.state_file(), {"$axf": "systems-check-health-state@1", "checks": self._mem or {}}, indent=1)
        except OSError:
            pass

    def annotate(self, items: list[Item]) -> list[Item]:
        """Give every item `since` (ms) and `breaks`; hold "couldn't reach it" amber for HOLD_S; push each new red item
        once (and resolve it when it's green again). Changes `items` in place and returns it."""
        now = self.clock()
        pushes: list[Item] = []
        resolved: list[str] = []
        with self._lock:
            mem = self._load()
            changed = False
            for it in items:
                if it.get("annotated"):  # already done in this pass (run() annotates, then the report does)
                    continue
                it["annotated"] = True
                cid = str(it.get("id"))
                st = it.get("status")
                if not it.get("breaks") and BREAKS.get(cid):
                    it["breaks"] = BREAKS[cid]
                m = mem.get(cid)
                if st == "unknown":  # not checked this time: keeps its last state and since
                    if m:
                        it["since"] = int(m["since"] * 1000)
                    continue
                if not m or m.get("status") != st:
                    if m and m.get("wasRed") and st in ("ok", "info"):
                        resolved.append(f"system:{cid}")  # green again: the phone alert closes
                    # one push per red episode: only green (or info) starts a new one, flapping red ↔ amber doesn't
                    keep = bool(m) and st not in ("ok", "info")
                    m = {"status": st, "since": now, "pushed": keep and m.get("pushed", False), "wasRed": keep and m.get("wasRed", False)}
                    mem[cid] = m
                    changed = True
                it["since"] = int(m["since"] * 1000)
                if st == "error" and it.get("unreachable") and now - m["since"] < HOLD_S:
                    it["status"] = "warn"
                    it["holding"] = True
                    it["summary"] = f"{it['summary']} Checking again before it turns red."
                    continue
                if it.get("status") == "error" and not m.get("pushed"):
                    m["pushed"] = True
                    m["pushedAt"] = now
                    changed = True
                    pushes.append(it)
                if it.get("status") == "error" and not m.get("wasRed"):
                    m["wasRed"] = True
                    changed = True
            if changed:
                self._save()
        for it in pushes:
            self._push(it)
        if resolved:
            try:
                self.resolve(resolved)
            except Exception:  # noqa: BLE001
                pass
        return items

    def _push(self, it: Item) -> None:
        since = time.strftime("%b %d %H:%M UTC", time.gmtime(int(it.get("since") or 0) / 1000))
        body = "\n".join(x for x in (it.get("summary", ""), f"Breaks: {it['breaks']}" if it.get("breaks") else "", f"Since {since}.",
                                      "Open the console's systems check banner to fix it.") if x)
        try:
            self.raise_alert({"source": "system", "severity": "error", "key": f"system:{it['id']}", "title": f"Broken: {it.get('title')}"[:200],
                              "body": body[:2000], "link": "settings:system", "meta": {"check": str(it["id"]), "health": True}})
            self.log("system", f"health: {it.get('title')} is red, pushed to AmberX", "warn")
        except Exception as e:  # noqa: BLE001 — a push that fails is retried on the next red episode
            self.log("system", f"health: couldn't push {it.get('id')}: {str(e)[:120]}", "warn")
