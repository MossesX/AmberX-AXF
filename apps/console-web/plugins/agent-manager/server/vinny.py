"""Vinny's command book (vinny-commands@1, Oct 24 2026): Vinny works without a Claude connection.

Brett: "Make the agent Vinny able to work without an active Claude connection … a list of VPS commands that he can run
… based off triggers or keywords or commands sent to him through code … if he receives the trigger he will execute on
the VPS. Do the same thing on GitHub." Each entry maps triggers (words or phrases, also found inside a whole paragraph)
and Auto fix keys (check ids / banner keys, `*` globs) to one command:

  kind vps     a shell command on the VPS (axHub `vps.run`, root)
  kind git     a git command in a folder on the VPS (`cd <repo> && git …`; one git command, no chaining, never a force
               push or a push to main/master)
  kind github  an axHub `github.*` tool with fixed arguments

No model runs anywhere here: matching is plain text, and every command goes to axHub through Vinny's own `axhub_call`
tool (agent manager builtin, `wait: false`), so axHub still asks Brett to approve each `vps.run` (Vinny's engine is on
axHub: Brett, Oct 24 2026). Placeholders {repo} {branch} {number} {check} are filled from the caller's context, shell-quoted
in vps/git commands and refused when they aren't plain names.

Every banner Auto fix tries Vinny first, then Mosses, then Claude (decision Oct 24 2026): the systems check and the push
banner call `axf.vinny@1` → find_fix / start before handing anything to Mosses.

Data lives on axHub (Brett, Oct 24 2026: "all offline agents' engines are on axHub"): `agents/vinny/commands.json`
(commands + settings) and `agents/vinny/runs.json` (last RUNS_KEEP runs) in the project's shared data folder
(/projects/amberx-axf/_data where the hub's volume is mounted; 0660 in the hub's setgid tree so axHub can read them).
AXF_VINNY_DIR overrides; without the hub folder they stay in the plugin's own data folder (0600).
"""
from __future__ import annotations

import fnmatch
import json
import os
from pathlib import Path
import re
import threading
import time
import uuid
from typing import Any, Callable

import plugin_services

from axf_server import storage

from . import hubtools, store

TAG = "vinny-commands@1"
VINNY = "vinny"
KINDS = ("vps", "git", "github")
FILE = "commands.json"
RUNS_FILE = "runs.json"
RUNS_KEEP = 100
MAX_COMMANDS = 200
MAX_TRIGGERS = 24
MAX_CMD = 3000
MAX_TEXT = 20_000
ID_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,47}\Z")
REPO_RE = re.compile(r"/[A-Za-z0-9._/-]{1,200}\Z")
GH_TOOL_RE = re.compile(r"github\.[A-Za-z0-9_./-]{1,80}\Z")
FIX_RE = re.compile(r"[A-Za-z0-9*?:#._/@-]{1,120}\Z")
PLACE_RE = re.compile(r"\{(repo|branch|number|check)\}")
SAFE_VALUE = re.compile(r"[A-Za-z0-9._/#:@+-]{1,200}\Z")
GIT_BAD = re.compile(r"[;&|`$<>\n\r\\]")
STATES_OPEN = ("asking", "waiting", "running")

DEFAULT_SETTINGS = {"listen": True, "maxPerMessage": 5, "autoFixFirst": True}

# App tokens on the VPS: (app, env key, file). Values are never printed.
APP_TOKENS = (("Patches", "APP_TOKEN", "/opt/patches-web/.app/env"),
              ("Build Pilot", "BP_TOKEN", "/opt/build-pilot/.build-pilot/env"),
              ("Dev Console", "AXF_TOKEN", "/opt/axf/.axf-console/env"))
TOKENS_COMMAND = "; ".join(
    f"v=$(sed -n 's/^{k}=//p' {f} 2>/dev/null | head -n1); "
    f"if [ -n \"$v\" ]; then echo \"{a} {k}: set, ${{#v}} characters, fingerprint $(printf %s \"$v\" | sha256sum | cut -c1-8), in {f}\"; "
    f"else echo \"{a} {k}: not found in {f}\"; fi; "
    f"echo \"  to copy it yourself: sudo sed -n 's/^{k}=//p' {f}\""
    for a, k, f in APP_TOKENS) + "; unset v"

DEFAULT_COMMANDS: list[dict[str, Any]] = [
    {"id": "health", "name": "Server health", "kind": "vps", "triggers": ["vps health", "server health", "/health"],
     "command": "uptime; free -h; df -h -x tmpfs -x overlay", "timeout": 60, "fixes": []},
    {"id": "containers", "name": "List containers", "kind": "vps", "triggers": ["list containers", "docker ps", "/containers"],
     "command": "docker ps -a --format 'table {{.Names}}\\t{{.Status}}\\t{{.Image}}'", "timeout": 60, "fixes": []},
    {"id": "console-doctor", "name": "Console doctor report", "kind": "vps", "triggers": ["run the doctor", "console doctor", "/doctor"],
     "command": "bash /opt/axf/deploy/console-doctor.sh --report", "timeout": 600, "fixes": ["host-report"]},
    {"id": "restart-console", "name": "Restart the console", "kind": "vps", "triggers": ["restart the console", "/restart-console"],
     "command": "docker restart axf-console", "timeout": 120, "fixes": []},
    {"id": "console-git-status", "name": "Console checkout: git status", "kind": "git", "triggers": ["console git status", "/git-status"],
     "repo": "/opt/axf", "command": "git status --short --branch", "timeout": 60, "fixes": []},
    # Oct 25 2026 (Gizmo: "add token commands to Vinny"): where each app's token is saved and whether it's there. Never
    # the value: the output passes through axHub, the run log and the dialog, so only length + an 8-character
    # fingerprint, plus the command Brett runs himself to copy it (into Project settings, never into chat).
    {"id": "app-tokens", "name": "App tokens: where they are (never the value)", "kind": "vps",
     "triggers": ["app tokens", "app token", "token status", "where are the tokens", "patches token", "pilot token", "console token", "/tokens"],
     "command": TOKENS_COMMAND, "timeout": 60, "fixes": []},
]
# Defaults added after a book was first written are added to it once (a removal afterwards is respected).
FIRST_DEFAULTS = ("health", "containers", "console-doctor", "restart-console", "console-git-status")


class VinnyError(ValueError):
    pass


# ---------------------------------------------------------------- pure rules (tested in test.py)

def norm(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "").lower()).strip()


def trigger_hits(trigger: str, text: str) -> bool:
    """A trigger is found anywhere in the text as whole words, case and spacing ignored ("Vinny, please run the
    doctor now" hits "run the doctor"; "doctorate" doesn't hit "doctor")."""
    t = norm(trigger)
    if not t:
        return False
    return re.search(r"(?<![a-z0-9_])" + re.escape(t) + r"(?![a-z0-9_])", norm(text)) is not None


def matches(commands: list[dict[str, Any]], text: str, limit: int = 5) -> list[dict[str, Any]]:
    """Enabled commands whose triggers appear in the text, in the order they appear there (first hit first)."""
    low = norm(text[:MAX_TEXT])
    hits: list[tuple[int, dict[str, Any]]] = []
    for c in commands:
        if c.get("enabled", True) is False:
            continue
        at = [m.start() for t in c.get("triggers") or [] if t and (m := re.search(r"(?<![a-z0-9_])" + re.escape(norm(t)) + r"(?![a-z0-9_])", low))]
        if at:
            hits.append((min(at), c))
    hits.sort(key=lambda h: h[0])
    return [c for _, c in hits][: max(1, int(limit))]


def fix_for(commands: list[dict[str, Any]], key: str, text: str = "") -> dict[str, Any] | None:
    """The command for an Auto fix: one whose `fixes` names this key (globs allowed) wins, else the first trigger hit in
    the check's text. None = Vinny has nothing for it (the banner moves on to Mosses)."""
    on = [c for c in commands if c.get("enabled", True) is not False]
    for c in on:
        if any(fnmatch.fnmatchcase(key, p) for p in c.get("fixes") or []):
            return c
    m = matches(on, text, 1) if text else []
    return m[0] if m else None


def sq(v: str) -> str:
    return "'" + str(v).replace("'", "'\\''") + "'"


def fill(template: str, ctx: dict[str, Any], quote: bool) -> str:
    def rep(m: re.Match[str]) -> str:
        v = str(ctx.get(m.group(1), "") if ctx else "")
        if not SAFE_VALUE.match(v):
            raise VinnyError(f"{{{m.group(1)}}} isn't set to a plain name for this run")
        return sq(v) if quote else v
    return PLACE_RE.sub(rep, template)


def check_git(cmd: str) -> None:
    if not cmd.startswith("git ") or GIT_BAD.search(cmd):
        raise VinnyError("a git command is one `git …` command: no ; & | $ ` < > or new lines")
    words = cmd.split()
    if "push" in words:
        if any(w in ("-f", "--force", "--force-with-lease", "--mirror", "--delete", "-d") or w.startswith(("--force", "+")) for w in words):
            raise VinnyError("Vinny never force-pushes or deletes a branch")
        if any(w in ("main", "master") or w.endswith((":main", ":master", "/main", "/master")) for w in words[2:]):
            raise VinnyError("Vinny never pushes to main or master")


def build(c: dict[str, Any], ctx: dict[str, Any] | None = None) -> tuple[str, dict[str, Any]]:
    """The axHub call for a command: (tool, arguments). Raises VinnyError for anything unsafe."""
    ctx = ctx or {}
    kind = c.get("kind")
    timeout = int(c.get("timeout") or 300)
    if kind == "vps":
        return "vps.run", {"command": fill(str(c["command"]), ctx, True), "timeout_seconds": timeout}
    if kind == "git":
        cmd = fill(str(c["command"]), ctx, True)
        check_git(cmd)
        repo = fill(str(c.get("repo") or ""), ctx, False)
        if not REPO_RE.match(repo) or ".." in repo.split("/"):
            raise VinnyError("the git folder is an absolute path on the VPS (no ..)")
        return "vps.run", {"command": f"cd {sq(repo)} && {cmd}", "timeout_seconds": timeout}
    if kind == "github":
        args = json.loads(fill(json.dumps(c.get("arguments") or {}), ctx, False))
        return str(c["tool"]), args
    raise VinnyError(f"kind is one of {', '.join(KINDS)}")


def clean(raw: dict[str, Any], existing: set[str]) -> dict[str, Any]:
    """Validate one command from the settings dialog; returns the stored shape."""
    if not isinstance(raw, dict):
        raise VinnyError("a command is an object")
    name = str(raw.get("name") or "").strip()[:80]
    if not name:
        raise VinnyError("give the command a name")
    cid = str(raw.get("id") or "").strip() or store.slug(name, "command")
    if not ID_RE.match(cid):
        raise VinnyError("id: lowercase letters, digits and -")
    if not raw.get("id"):
        base, n = cid, 2
        while cid in existing:
            cid, n = f"{base[:44]}-{n}", n + 1
    kind = str(raw.get("kind") or "vps")
    if kind not in KINDS:
        raise VinnyError(f"kind is one of {', '.join(KINDS)}")
    trig = [t for t in (norm(x)[:80] for x in (raw.get("triggers") or []) if isinstance(x, str)) if len(t) >= 2]
    trig = list(dict.fromkeys(trig))[:MAX_TRIGGERS]
    fixes = [str(x).strip() for x in (raw.get("fixes") or []) if isinstance(x, str) and str(x).strip()][:20]
    bad = [f for f in fixes if not FIX_RE.match(f)]
    if bad:
        raise VinnyError(f"Auto fix keys are check ids or banner keys (globs with *): {bad[0][:40]}")
    if not trig and not fixes:
        raise VinnyError("add at least one trigger or Auto fix key")
    try:
        timeout = max(10, min(1800, int(raw.get("timeout") or 300)))
    except (TypeError, ValueError):
        raise VinnyError("timeout is a number of seconds") from None
    out: dict[str, Any] = {"id": cid, "name": name, "kind": kind, "enabled": raw.get("enabled", True) is not False, "triggers": trig, "fixes": fixes,
                           "timeout": timeout, "note": str(raw.get("note") or "")[:300], "updatedAt": store.now_ms()}
    if kind in ("vps", "git"):
        cmd = str(raw.get("command") or "").strip()
        if not cmd or len(cmd) > MAX_CMD:
            raise VinnyError(f"the command is 1–{MAX_CMD} characters")
        out["command"] = cmd
    if kind == "git":
        out["repo"] = str(raw.get("repo") or "").strip()
    if kind == "github":
        tool = str(raw.get("tool") or "").strip()
        if not GH_TOOL_RE.match(tool):
            raise VinnyError("the GitHub tool is an axHub github.* tool, e.g. github.create_pull_request")
        args = raw.get("arguments") or {}
        if isinstance(args, str):
            try:
                args = json.loads(args or "{}")
            except ValueError:
                raise VinnyError("arguments are a JSON object") from None
        if not isinstance(args, dict) or len(json.dumps(args)) > hubtools.MAX_ARGS:
            raise VinnyError("arguments are a JSON object under 3800 characters")
        out["tool"], out["arguments"] = tool, args
    # a dry build with sample values catches an unsafe git command or folder before it's saved
    build(out, {"repo": "repo", "branch": "branch", "number": "1", "check": "check"})
    return out


# ---------------------------------------------------------------- storage (on axHub)

_lock = threading.RLock()


def data_dir() -> Path:
    exact = os.environ.get("AXF_VINNY_DIR")
    if exact:
        return Path(exact)
    try:
        import console_context as cx
        root = cx.persist_root()
    except Exception:  # noqa: BLE001 — outside the console (tests)
        root = None
    return Path(root) / "agents" / "vinny" if root else store.DATA / "vinny"


def _shared(p: Path) -> bool:
    d = p.resolve()
    while True:
        try:
            return bool(os.stat(d).st_mode & 0o2000)
        except OSError:
            if d.parent == d:
                return False
            d = d.parent


def _read(name: str, default: Any) -> Any:
    return storage.read_json(data_dir() / name, default)


def _write(name: str, data: Any) -> None:
    d = data_dir()
    fm, dm = (0o660, 0o2770) if _shared(d) else (0o600, 0o700)
    storage.write_json(d / name, data, ensure_ascii=False, mode=fm, dir_mode=dm)


def load() -> dict[str, Any]:
    with _lock:
        raw = _read(FILE, None)
        if not isinstance(raw, dict):
            raw = {"$axf": TAG, "commands": [dict(c, enabled=True, note="", updatedAt=0) for c in DEFAULT_COMMANDS], "settings": dict(DEFAULT_SETTINGS)}
            _write(FILE, raw)
        cmds = [c for c in raw.get("commands") or [] if isinstance(c, dict) and ID_RE.match(str(c.get("id", "")))]
        st = raw.get("settings") if isinstance(raw.get("settings"), dict) else {}
        seen = st.get("defaultsAdded") if isinstance(st.get("defaultsAdded"), list) else list(FIRST_DEFAULTS)
        have = {c["id"] for c in cmds}
        new = [c for c in DEFAULT_COMMANDS if c["id"] not in seen]
        if new or "defaultsAdded" not in st:
            cmds += [dict(c, enabled=True, note="", updatedAt=0) for c in new if c["id"] not in have]
            st = {**st, "defaultsAdded": list(dict.fromkeys([*seen, *(c["id"] for c in DEFAULT_COMMANDS)]))}
            raw = {**raw, "commands": cmds, "settings": st}
            _write(FILE, raw)
        return {"$axf": TAG, "commands": cmds, "settings": {**DEFAULT_SETTINGS, **(raw.get("settings") or {})}}


def _save(book: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        _write(FILE, {"$axf": TAG, "commands": book["commands"][:MAX_COMMANDS], "settings": book["settings"]})
    return load()


def upsert(raw: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        book = load()
        ids = {c["id"] for c in book["commands"]}
        if not raw.get("id") and len(ids) >= MAX_COMMANDS:
            raise VinnyError(f"Vinny holds up to {MAX_COMMANDS} commands")
        c = clean(raw, ids)
        book["commands"] = [c if x["id"] == c["id"] else x for x in book["commands"]] if c["id"] in ids else [*book["commands"], c]
        _save(book)
        return c


def remove(cid: str) -> bool:
    with _lock:
        book = load()
        n = len(book["commands"])
        book["commands"] = [c for c in book["commands"] if c["id"] != cid]
        _save(book)
        return len(book["commands"]) < n


def save_settings(patch: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        book = load()
        s = book["settings"]
        if "listen" in patch:
            s["listen"] = bool(patch["listen"])
        if "autoFixFirst" in patch:
            s["autoFixFirst"] = bool(patch["autoFixFirst"])
        if "maxPerMessage" in patch:
            try:
                s["maxPerMessage"] = max(1, min(10, int(patch["maxPerMessage"])))
            except (TypeError, ValueError):
                raise VinnyError("maxPerMessage is 1–10") from None
        return _save(book)["settings"]


def reset_defaults() -> dict[str, Any]:
    """Add back the shipped commands that are missing (never overwrites one Brett edited)."""
    with _lock:
        book = load()
        have = {c["id"] for c in book["commands"]}
        book["commands"] += [dict(c, enabled=True, note="", updatedAt=store.now_ms()) for c in DEFAULT_COMMANDS if c["id"] not in have]
        return _save(book)


# ---------------------------------------------------------------- running (through Vinny's axhub_call, no model)

def agents() -> Any:
    return plugin_services.get("axf.agents@1")


def ready() -> tuple[bool, str]:
    svc = agents()
    a = svc.get_agent(VINNY) if svc else None
    if not a:
        return False, "Vinny isn't installed (Agent manager → Add-on agents → Vinny)."
    if not any(t.get("name") == hubtools.TOOL for t in a.get("tools") or []):
        return False, "Vinny can't reach axHub: allow him dangerous tools in Settings → Plugins → Agent manager → Safety."
    return True, ""


def hub_call(tool: str, arguments: dict[str, Any], confirmation_id: str | None = None, timeout: float = 600, reason: str = "Vinny command") -> dict[str, Any]:
    """One axHub call through Vinny's axhub_call: {"ok": text} | {"confirm": id}; hubtools.HubError otherwise."""
    ok, why = ready()
    if not ok:
        raise hubtools.HubError(why)
    args: dict[str, Any] = {"tool": tool, "arguments": arguments, "wait": False, "reason": reason[:200]}
    if confirmation_id:
        args["confirmation_id"] = confirmation_id
    try:
        r = json.loads(agents().run_tool(VINNY, hubtools.TOOL, args))
    except Exception as e:  # noqa: BLE001
        raise hubtools.HubError(f"Vinny couldn't take it: {str(e)[:200]}") from None
    if r.get("status") == "confirm" and r.get("confirmationId"):
        return {"confirm": str(r["confirmationId"])}
    if r.get("status") == "ok":
        return {"ok": str(r.get("output", ""))}
    raise hubtools.HubError(str(r.get("message") or "axHub refused it")[:400])


def exit_code(out: str) -> int | None:
    m = re.search(r"^exit (-?\d+)\b", out, re.M)
    return int(m.group(1)) if m else None


class Runner:
    """Vinny's runs: one thread each, asking → waiting (approval on axHub) → running → done / failed."""

    def __init__(self, call: Callable[..., dict[str, Any]] = hub_call, delays: Callable[[], list[float]] = hubtools.retry_delays,
                 sleep: Callable[[float], None] = time.sleep, persist: bool = True) -> None:
        self.call, self.delays, self.sleep, self.persist = call, delays, sleep, persist
        self.runs: dict[str, dict[str, Any]] = {}
        self.lock = threading.RLock()
        if persist:
            for r in _read(RUNS_FILE, []):
                if isinstance(r, dict) and r.get("id"):
                    if r.get("state") in STATES_OPEN:
                        r = {**r, "state": "failed", "message": "The console restarted while it ran."}
                    self.runs[r["id"]] = r

    def get(self, rid: str) -> dict[str, Any] | None:
        with self.lock:
            r = self.runs.get(rid)
            return dict(r) if r else None

    def all(self, since: int = 0) -> list[dict[str, Any]]:
        with self.lock:
            return sorted((dict(r) for r in self.runs.values() if int(r.get("at") or 0) > since), key=lambda r: r["at"])

    def _set(self, rid: str, **kw: Any) -> None:
        with self.lock:
            self.runs[rid].update(kw, updatedAt=store.now_ms())
            if self.persist and kw.get("state") not in (None, "asking"):
                keep = sorted(self.runs.values(), key=lambda r: r["at"])[-RUNS_KEEP:]
                self.runs = {r["id"]: r for r in keep}
                _write(RUNS_FILE, keep)

    def start(self, c: dict[str, Any], source: str = "code", ctx: dict[str, Any] | None = None, wait: bool = False) -> dict[str, Any]:
        tool, args = build(c, ctx)  # VinnyError before anything is sent
        rid = uuid.uuid4().hex[:16]
        shown = args.get("command") if isinstance(args.get("command"), str) else f"{tool} {json.dumps(args)[:400]}"
        with self.lock:
            self.runs[rid] = {"id": rid, "at": store.now_ms(), "commandId": c["id"], "name": c.get("name", c["id"]), "kind": c.get("kind"), "tool": tool,
                              "command": str(shown)[:MAX_CMD + 200], "source": str(source)[:60], "state": "asking", "message": "Sending it to axHub…",
                              "confirmationId": None, "link": "", "output": "", "exit": None}
        t = threading.Thread(target=self._run, args=(rid, tool, args, c), daemon=True)
        t.start()
        if wait:
            t.join(float(c.get("timeout") or 300) + 31 * 60)
        return self.get(rid) or {}

    def _run(self, rid: str, tool: str, args: dict[str, Any], c: dict[str, Any]) -> None:
        timeout = float(c.get("timeout") or 300)
        reason = f"Vinny: {c.get('name', c['id'])}"
        try:
            r = self.call(tool, args, None, timeout, reason)
            if "confirm" in r:
                conf = r["confirm"]
                self._set(rid, state="waiting", confirmationId=conf, link=hubtools.approval_link(conf), message="Approve it on axHub (it shows the exact command).")
                deadline = time.time() + hubtools.WAIT_S
                waits = iter(self.delays())
                while "confirm" in r:
                    if time.time() > deadline:
                        self._set(rid, state="failed", message="The approval expired."); return
                    self.sleep(next(waits, 60.0))
                    try:
                        r = self.call(tool, args, conf, timeout, reason)
                    except hubtools.HubError as e:
                        m = str(e).lower()
                        self._set(rid, state="failed", rejected="reject" in m,
                                  message="Rejected on the hub." if "reject" in m else "The approval expired." if "expired" in m else str(e)[:300]); return
            out = str(r.get("ok", ""))
            code = exit_code(out) if tool == "vps.run" else 0
            good = code == 0 or (code is None and tool != "vps.run")
            self._set(rid, state="done" if good else "failed", output=out[-4000:], exit=code,
                      message="Done." if good else f"The command failed (exit {code})." if code is not None else "No exit code came back.")
        except hubtools.HubError as e:
            self._set(rid, state="failed", message=str(e)[:300])
        except Exception as e:  # noqa: BLE001
            self._set(rid, state="failed", message=f"Stopped ({type(e).__name__}).")


RUNNER: Runner | None = None


def runner() -> Runner:
    global RUNNER
    if RUNNER is None:
        RUNNER = Runner()
    return RUNNER


def handle(text: str, source: str = "code", ctx: dict[str, Any] | None = None, wait: bool = False) -> list[dict[str, Any]]:
    """A message to Vinny (from code, the dialog's Send box, a task): every trigger in it runs its command. No model."""
    book = load()
    if not book["settings"].get("listen", True):
        return []
    out = []
    for c in matches(book["commands"], str(text or ""), int(book["settings"].get("maxPerMessage") or 5)):
        try:
            out.append(runner().start(c, source, ctx, wait))
        except VinnyError as e:
            out.append({"commandId": c["id"], "name": c.get("name"), "state": "failed", "message": str(e)})
    return out


class VinnyService:
    """axf.vinny@1 — Vinny's command book for other plugins (the banners' Auto fix asks him first)."""
    version = 1

    def ready(self) -> tuple[bool, str]:
        return ready()

    def auto_fix_first(self) -> bool:
        return bool(load()["settings"].get("autoFixFirst", True))

    def find_fix(self, key: str, text: str = "") -> dict[str, Any] | None:
        c = fix_for(load()["commands"], str(key), str(text or ""))
        return {k: v for k, v in c.items() if k in ("id", "name", "kind")} if c else None

    def start_fix(self, key: str, text: str = "", ctx: dict[str, Any] | None = None, source: str = "auto-fix") -> dict[str, Any] | None:
        """Start the command for this Auto fix (None when Vinny has none or isn't ready); poll with get_run."""
        if not self.auto_fix_first() or not ready()[0]:
            return None
        c = fix_for(load()["commands"], str(key), str(text or ""))
        if not c:
            return None
        try:
            return runner().start(c, source, ctx)
        except VinnyError as e:
            return {"commandId": c["id"], "name": c.get("name"), "state": "failed", "message": str(e)}

    def handle(self, text: str, source: str = "code", ctx: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        return handle(text, source, ctx)

    def get_run(self, rid: str) -> dict[str, Any] | None:
        return runner().get(rid)

    def call(self, tool: str, arguments: dict[str, Any], confirmation_id: str | None = None, timeout: float = 600, reason: str = "Auto fix") -> dict[str, Any]:
        """axHub call through Vinny's tool (same answers as Mosses's route), for the Auto fix chain."""
        return hub_call(tool, arguments, confirmation_id, timeout, reason)


def wait_run(svc: Any, run: dict[str, Any], sleep: Callable[[float], None] = time.sleep, poll_s: float = 3, limit_s: float = 40 * 60,
             on_change: Callable[[dict[str, Any]], Any] | None = None) -> dict[str, Any]:
    """For callers: follow a run until it's done or failed (on_change gets each new state)."""
    end, last = time.time() + limit_s, None
    while run and run.get("state") in STATES_OPEN and run.get("id"):
        if run.get("state") != last and on_change:
            on_change(run)
        last = run.get("state")
        if time.time() > end:
            return {**run, "state": "failed", "message": "Vinny's run took too long."}
        sleep(poll_s)
        run = svc.get_run(run["id"]) or run
    return run


plugin_services.provide("axf.vinny@1", VinnyService(), store.PLUGIN_DIR.name)


def summary(runs: list[dict[str, Any]]) -> str:
    """Vinny's plain reply for runs he did without a model."""
    lines = []
    for r in runs:
        mark = "✓" if r.get("state") == "done" else "✗" if r.get("state") == "failed" else "…"
        tail = [ln for ln in str(r.get("output") or "").strip().splitlines() if ln.strip()][-3:]
        lines.append(f"{mark} {r.get('name')}: {r.get('message', '')}" + (f"\n  {' / '.join(tail)[:300]}" if tail else ""))
    return "\n".join(lines) or "Nothing to run."
