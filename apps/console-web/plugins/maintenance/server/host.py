"""The console's side of the host runner (engine/hostd.py, maintenance-host@1).

The runner is a systemd service on the VPS host; the console only calls it, over the Unix socket in the plugin's data
folder (the checkout the console mounts). When the socket doesn't answer, the console still reads what the runner wrote
last (``host/runner.json`` and ``host/jobs/*.json``), so a job that restarted Docker, and with it the console, is shown
with its result once the console is back.
"""
from __future__ import annotations

import json
import socket
from pathlib import Path
from typing import Any, Callable

HEARTBEAT_STALE_S = 3 * 60


class HostError(Exception):
    pass


def socket_path(data_dir: Path) -> Path:
    return data_dir / "host" / "hostd.sock"


def _call(data_dir: Path, op: str, timeout: float, **args: Any) -> dict[str, Any]:
    path = socket_path(data_dir)
    if not path.exists():
        raise HostError("the host runner isn't installed or isn't running (no socket)")
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            s.connect(str(path))
            s.sendall((json.dumps({"op": op, **args}) + "\n").encode())
            buf = b""
            while not buf.endswith(b"\n"):
                chunk = s.recv(65536)
                if not chunk:
                    break
                buf += chunk
    except OSError as e:
        raise HostError(f"the host runner didn't answer ({type(e).__name__})") from None
    try:
        out = json.loads(buf or b"{}")
    except ValueError:
        raise HostError("the host runner sent a bad answer") from None
    if not out.get("ok"):
        raise HostError(str(out.get("error") or "the host runner refused it")[:300])
    return out


# swapped out by the tests
transport: Callable[..., dict[str, Any]] = _call


def call(data_dir: Path, op: str, timeout: float = 15.0, **args: Any) -> dict[str, Any]:
    return transport(data_dir, op, timeout, **args)


def _read(p: Path) -> Any:
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return None


def last_heartbeat(data_dir: Path) -> dict[str, Any] | None:
    hb = _read(data_dir / "host" / "runner.json")
    return hb if isinstance(hb, dict) else None


def jobs_on_disk(data_dir: Path, kind: str | None = None, limit: int = 10) -> list[dict[str, Any]]:
    d = data_dir / "host" / "jobs"
    if not d.is_dir():
        return []
    out = []
    for f in sorted(d.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True):
        j = _read(f)
        if isinstance(j, dict) and (kind is None or j.get("kind") == kind):
            out.append(j)
        if len(out) >= limit:
            break
    return out


def job_on_disk(data_dir: Path, job_id: str) -> dict[str, Any] | None:
    if not job_id or "/" in job_id or ".." in job_id:
        return None
    j = _read(data_dir / "host" / "jobs" / f"{job_id}.json")
    return j if isinstance(j, dict) else None
