#!/usr/bin/env python3
"""Maintenance host runner (maintenance-host@1): the Maintenance plugin's actions, run on the VPS host itself.

Runs as root under systemd (``axf-maintenance.service``, installed by ``deploy/host.sh up``), outside every container,
so it keeps working while the console is down and can restart Docker itself. It does not depend on docker.service.

- Measures the server every 10 minutes (``maint.py`` snapshot, at low priority) into the plugin's data folder, which the
  console reads from the checkout it mounts (this replaces the old cron line).
- Answers the console on a Unix socket in the data folder (``host/hostd.sock``, root only): one JSON request per line,
  one JSON answer per line. The console UI just calls it.
- Every action is a job with its state in ``host/jobs/<id>.json``, written as it goes, so the console can show it again
  after it was restarted (a Docker restart restarts the console too).

Ops: ``ping`` · ``status`` · ``snapshot`` (measure now) · ``docker-cache`` (clear the Docker build cache and dangling
images; restart Docker if it is stuck, unless ``restart`` is false) · ``docker-restart`` · ``job`` {id} · ``jobs``.
Approved clean-up plans still run only through axHub's held ``vps.run`` (``maint.py run``), never from here.

    python3 hostd.py serve                         the service (systemd runs this)
    python3 hostd.py call <op> [--json '{...}']    ask the running service; runs the op here when it isn't running
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import socket
import socketserver
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve().parent
SCHEMA = "maintenance-host@1"
VERSION = 1
UNIT = "axf-maintenance.service"
SNAPSHOT_EVERY_S = 10 * 60
HEARTBEAT_S = 30
KEEP_JOBS = 50


def _load_maint() -> Any:
    name = "axf_plugin_maintenance_engine"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, HERE / "maint.py")
    mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    sys.modules[name] = mod
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


maint = _load_maint()


def host_dir(data_dir: Path | None = None) -> Path:
    d = Path(data_dir or maint.DATA_DIR) / "host"
    d.mkdir(parents=True, exist_ok=True)
    return d


def socket_path(data_dir: Path | None = None) -> Path:
    return Path(os.environ.get("AXF_MAINT_SOCKET") or host_dir(data_dir) / "hostd.sock")


# ------------------------------------------------------------------ jobs

class Runner:
    """The runner's state: one job at a time per kind, jobs persisted as they go."""

    def __init__(self, data_dir: Path | None = None, run: Callable[..., Any] | None = None,
                 sleep: Callable[[float], None] = time.sleep) -> None:
        self.data_dir = Path(data_dir or maint.DATA_DIR)
        self.run = run or maint._run
        self.sleep = sleep
        self.started = maint.now_iso()
        self.lock = threading.RLock()
        self.active: dict[str, str] = {}  # kind → job id
        self.last_snapshot: float = 0.0
        jd = self.jobs_dir()
        for f in jd.glob("*.json"):  # a job the runner was killed in the middle of can't still be running
            j = maint.read_json(f)
            if isinstance(j, dict) and j.get("state") == "running":
                maint.write_json(f, {**j, "state": "failed", "error": "the host runner stopped while this ran", "endedAt": maint.now_iso()})

    def jobs_dir(self) -> Path:
        d = host_dir(self.data_dir) / "jobs"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _save(self, job: dict[str, Any]) -> None:
        maint.write_json(self.jobs_dir() / f"{job['id']}.json", job)

    def job(self, job_id: str) -> dict[str, Any] | None:
        if not job_id or "/" in job_id or ".." in job_id:
            return None
        j = maint.read_json(self.jobs_dir() / f"{job_id}.json")
        return j if isinstance(j, dict) else None

    def jobs(self, limit: int = 20, kind: str | None = None) -> list[dict[str, Any]]:
        files = sorted(self.jobs_dir().glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True)
        out = []
        for f in files:
            j = maint.read_json(f)
            if isinstance(j, dict) and (kind is None or j.get("kind") == kind):
                out.append(j)
            if len(out) >= limit:
                break
        for f in files[KEEP_JOBS:]:
            f.unlink(missing_ok=True)
        return out

    def start(self, kind: str, fn: Callable[[dict[str, Any], Callable[[dict[str, Any]], None]], dict[str, Any]],
              by: str = "console", wait: bool = False, **opts: Any) -> dict[str, Any]:
        """Start a job in its own thread (or inline with wait); a second one of a kind joins the running one."""
        with self.lock:
            running = self.job(self.active.get(kind, ""))
            if running and running.get("state") == "running":
                return {**running, "joined": True}
            job = {"$axf": SCHEMA, "id": f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}", "kind": kind, "by": by[:40],
                   "opts": opts, "state": "running", "at": maint.now_iso()}
            self.active[kind] = job["id"]
            self._save(job)

        def body() -> None:
            def progress(partial: dict[str, Any]) -> None:
                self._save({**job, "progress": partial.get("steps", [])})
            try:
                res = fn(opts, progress)
                job.update(state="done" if res.get("ok") else "failed", result=res, **({"error": res["error"]} if res.get("error") else {}))
            except Exception as e:  # noqa: BLE001 — a job never takes the runner down
                job.update(state="failed", error=f"{type(e).__name__}: {e}"[:300])
            job["endedAt"] = maint.now_iso()
            job.pop("progress", None)
            self._save(job)
            if kind != "snapshot":  # measure again so the page shows the space now (after the job is shown as ended)
                self._refresh_snapshot()

        if wait:
            body()
            return self.job(job["id"]) or job
        threading.Thread(target=body, name=f"maint-{kind}", daemon=True).start()
        return job

    # ---------------------------------------------------------------- the actions

    def _snapshot(self, _opts: dict[str, Any], _p: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
        snap = maint.snapshot(maint.load_settings(self.data_dir), self.run)
        maint.write_json(self.data_dir / "snapshot.json", snap)
        self.last_snapshot = time.time()
        return {"ok": True, "at": snap["at"], "tookMs": snap.get("tookMs"), "disk": snap.get("disk")}

    def _docker_cache(self, opts: dict[str, Any], progress: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
        return maint.clear_docker_cache(self.run, allow_restart=bool(opts.get("restart", True)), sleep=self.sleep, progress=progress)

    def _docker_restart(self, _opts: dict[str, Any], progress: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
        ok, msg = maint.restart_docker(self.run, self.sleep)
        res = {"ok": ok, "restarted": True, "steps": [{"at": maint.now_iso(), "step": "docker-up", "ok": ok, "detail": msg}]}
        if not ok:
            res["error"] = msg
        return res

    def _refresh_snapshot(self) -> None:
        try:
            self._snapshot({}, lambda _r: None)
        except Exception:  # noqa: BLE001 — the next tick measures again
            pass

    def handle(self, req: dict[str, Any]) -> dict[str, Any]:
        op = str(req.get("op") or "")
        by = str(req.get("by") or "console")
        wait = bool(req.get("wait"))
        if op == "ping":
            return {"ok": True, "$axf": SCHEMA, "version": VERSION, "pid": os.getpid(), "startedAt": self.started}
        if op == "status":
            return {"ok": True, **self.status()}
        if op == "snapshot":
            return {"ok": True, "job": self.start("snapshot", self._snapshot, by=by, wait=wait)}
        if op == "docker-cache":
            return {"ok": True, "job": self.start("docker-cache", self._docker_cache, by=by, wait=wait, restart=req.get("restart", True) is not False)}
        if op == "docker-restart":
            return {"ok": True, "job": self.start("docker-restart", self._docker_restart, by=by, wait=wait)}
        if op == "job":
            j = self.job(str(req.get("id") or ""))
            return {"ok": True, "job": j} if j else {"ok": False, "error": "no such job"}
        if op == "jobs":
            kind = req.get("kind")
            return {"ok": True, "jobs": self.jobs(int(req.get("limit") or 20), str(kind) if kind else None)}
        return {"ok": False, "error": f"unknown op {op!r} (ping, status, snapshot, docker-cache, docker-restart, job, jobs)"}

    def status(self) -> dict[str, Any]:
        alive, info = maint.docker_alive(self.run, 10)
        return {"$axf": SCHEMA, "version": VERSION, "pid": os.getpid(), "startedAt": self.started, "at": maint.now_iso(),
                "docker": {"alive": alive, "info": info}, "running": {k: v for k, v in self.active.items()
                                                                      if (self.job(v) or {}).get("state") == "running"},
                "lastSnapshot": maint.now_iso(self.last_snapshot) if self.last_snapshot else None}

    def heartbeat(self) -> None:
        maint.write_json(host_dir(self.data_dir) / "runner.json", {**self.status(), "socket": str(socket_path(self.data_dir))})


# ------------------------------------------------------------------ the socket

def _server(runner: Runner, path: Path) -> socketserver.ThreadingUnixStreamServer:
    class Handler(socketserver.StreamRequestHandler):
        def handle(self) -> None:  # noqa: D401
            line = self.rfile.readline(65536)
            try:
                req = json.loads(line or b"{}")
                out = runner.handle(req if isinstance(req, dict) else {})
            except (ValueError, TypeError) as e:
                out = {"ok": False, "error": f"bad request: {e}"[:200]}
            self.wfile.write((json.dumps(out) + "\n").encode())

    path.unlink(missing_ok=True)
    srv = socketserver.ThreadingUnixStreamServer(str(path), Handler)
    srv.daemon_threads = True
    os.chmod(path, 0o600)
    return srv


def call(op: str, data_dir: Path | None = None, timeout: float = 10.0, **args: Any) -> dict[str, Any]:
    """One request to the running runner. Raises OSError when it isn't there."""
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(timeout)
        s.connect(str(socket_path(data_dir)))
        s.sendall((json.dumps({"op": op, **args}) + "\n").encode())
        buf = b""
        while not buf.endswith(b"\n"):
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
    return json.loads(buf or b"{}")


def _remove_self() -> None:
    """The plugin folder is gone: take the unit out so nothing is left behind."""
    subprocess.run(["systemctl", "disable", UNIT], capture_output=True, timeout=30)
    Path(f"/etc/systemd/system/{UNIT}").unlink(missing_ok=True)
    subprocess.run(["systemctl", "daemon-reload"], capture_output=True, timeout=30)


def serve(data_dir: Path | None = None) -> int:
    runner = Runner(data_dir)
    path = socket_path(data_dir)
    srv = _server(runner, path)
    threading.Thread(target=srv.serve_forever, name="maint-socket", daemon=True).start()
    print(f"[axf-maintenance] host runner on {path}", flush=True)
    try:
        os.nice(10)  # measuring is background work; the actions themselves are short
    except OSError:
        pass
    beat = 0.0
    while True:
        if not (HERE / "maint.py").exists():
            srv.shutdown()
            path.unlink(missing_ok=True)
            _remove_self()
            return 0
        now = time.time()
        if now - runner.last_snapshot >= SNAPSHOT_EVERY_S:
            runner.last_snapshot = now  # also on a failed one: the next try is the next period
            runner.start("snapshot", runner._snapshot, by="schedule")
        if now - beat >= HEARTBEAT_S:
            beat = now
            try:
                runner.heartbeat()
            except OSError:
                pass
        if not path.exists():  # someone removed the socket: put it back
            srv.shutdown()
            srv = _server(runner, path)
            threading.Thread(target=srv.serve_forever, name="maint-socket", daemon=True).start()
        time.sleep(5)


def _main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="hostd.py", description="AXF maintenance host runner (maintenance-host@1)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("serve")
    c = sub.add_parser("call")
    c.add_argument("op")
    c.add_argument("--json", default="{}", help="extra request fields as a JSON object")
    args = ap.parse_args(argv)
    if args.cmd == "serve":
        return serve()
    extra = json.loads(args.json)
    try:
        out = call(args.op, **extra)
    except OSError:
        if args.op == "ping":
            print(json.dumps({"ok": False, "error": f"the host runner isn't running (no answer on {socket_path()})"}))
            return 1
        # the service isn't running (or this is a shell without it): run the op here and wait for it
        out = Runner().handle({"op": args.op, "by": "cli", **extra, "wait": True})
    print(json.dumps(out, indent=1))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
